// ──────────────────────────────────────────────
// Relationship Tracker — UI-side writeback adapter
// ──────────────────────────────────────────────
//
// The Relationship Tracker agent emits proposals (one per character) for
// how an NPC felt about the persona's actions on a given turn. This module
// is the bridge between the agent's structured output and the storage
// layer: it normalizes proposals, routes each one (auto-apply vs queue
// for review per docs §7), persists auto-applied events to character
// extensions, and returns the proposals that should land in the
// `PendingRelationshipProposal` queue.
//
// The user-approved path (modal "Approve") calls `applyRelationshipProposal`
// directly with the queued entry — same write path as auto-apply, just
// gated by user click.

import type { QueryClient } from "@tanstack/react-query";
import { storageApi } from "../../../../shared/api/storage-api";
import type { Chat } from "../../../../engine/contracts/types/chat";
import { chatKeys } from "../../chats/index";
import { characterKeys } from "../query-keys";
import {
  applyEventToRelationship,
  getRelationshipForPersona,
  isFirstEventInChatId,
  resolveApprovalSettings,
  routeProposal,
  setRelationshipForPersona,
  type ApprovalSettings,
} from "../../../../engine/agents-runtime/relationship-tracker";
import { normalizeRelationshipEvents } from "../../../../engine/generation/agent-normalizers";
import { parseRecord } from "../../../../engine/generation/runtime-records";
import { createId } from "../../../../engine/core/ids";
import type { RelationshipEventProposal } from "../../../../engine/contracts/types/agent";
import type { CharacterExtensions } from "../../../../engine/contracts/types/character";
import type { PendingRelationshipProposal } from "../../../../shared/stores/agent.store";

/**
 * Read approval settings from the persisted agent record. Stored agent rows
 * use UUIDs as `id` and the agent kind is in the `type` field — so a direct
 * `get("agents", "relationship-tracker")` always misses. Mirrors the
 * list-and-filter pattern used by every other agent reader in the codebase
 * (start-generation.ts, agent-runner.ts).
 *
 * Falls back to defaults when no row exists yet or the lookup fails. Only
 * the keys named in `ApprovalSettings` are forwarded — values not matching
 * the expected union are ignored so corrupt/typo'd settings can't downgrade
 * routing safety.
 */
async function loadApprovalSettings(): Promise<ReturnType<typeof resolveApprovalSettings>> {
  const rows = await storageApi.list<Record<string, unknown>>("agents").catch(() => []);
  const row = rows.find((r) => typeof r.type === "string" && r.type === "relationship-tracker");
  const stored = parseRecord(row?.settings);
  const settings: Partial<ApprovalSettings> = {};
  if (
    stored.approvalMode === "manual" ||
    stored.approvalMode === "significant" ||
    stored.approvalMode === "auto"
  ) {
    settings.approvalMode = stored.approvalMode;
  }
  if (typeof stored.hotEventWindow === "number" && stored.hotEventWindow > 0) {
    settings.hotEventWindow = stored.hotEventWindow;
  }
  if (typeof stored.sessionHistoryWindow === "number" && stored.sessionHistoryWindow > 0) {
    settings.sessionHistoryWindow = stored.sessionHistoryWindow;
  }
  if (typeof stored.sessionHighlightsKept === "number" && stored.sessionHighlightsKept > 0) {
    settings.sessionHighlightsKept = stored.sessionHighlightsKept;
  }
  if (typeof stored.significantThreshold === "number") {
    settings.significantThreshold = stored.significantThreshold;
  }
  return resolveApprovalSettings(settings as ApprovalSettings);
}

interface CharacterRow {
  id: string;
  name?: string;
  data?: unknown;
  extensions?: unknown;
}

/**
 * Parse the character row's `data` blob — sometimes a JSON string (V2 card
 * import), sometimes a plain object. Returns `{}` on parse failure.
 */
function parseCharacterData(row: CharacterRow): Record<string, unknown> {
  if (typeof row.data === "string") {
    try {
      return JSON.parse(row.data) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return parseRecord(row.data);
}

/**
 * Resolve the character's extensions object. Engine writers (scene-service,
 * connected-commands, agent-card-update flows) all store extensions under
 * `data.extensions` — that's the only location used in production.
 */
function extensionsFromCharacterRow(row: CharacterRow): CharacterExtensions {
  return parseRecord(parseCharacterData(row).extensions) as CharacterExtensions;
}

function characterNameFromRow(row: CharacterRow): string {
  const explicit = typeof row.name === "string" ? row.name.trim() : "";
  if (explicit) return explicit;
  const parsed = parseCharacterData(row);
  const fromData = typeof parsed.name === "string" ? parsed.name.trim() : "";
  return fromData || row.id;
}

async function loadCharacterRow(
  queryClient: QueryClient,
  characterId: string,
): Promise<CharacterRow | null> {
  const cached = queryClient.getQueryData<CharacterRow>(characterKeys.detail(characterId));
  if (cached) return cached;
  return storageApi.get<CharacterRow>("characters", characterId).catch(() => null);
}

interface RoutedProposal {
  characterId: string;
  characterName: string;
  proposal: RelationshipEventProposal;
  decision: ReturnType<typeof routeProposal>;
}

/**
 * Build the routing decision for each proposal. Runs the agent output
 * through `normalizeRelationshipEvents` first — that's the canonical
 * validator with synonym coercion ("big"→"major", etc.) and per-character
 * dedup-by-confidence. Without it, strict literal checks would silently
 * drop common LLM synonym outputs and let the writer race on same-character
 * duplicates.
 *
 * Filters proposals whose characters aren't in the chat (defensive: an
 * agent shouldn't emit events for absent characters but we drop them if it
 * does). Returns an empty array when no persona is selected — the agent's
 * proposals are persona-scoped, so without an active persona there's
 * nothing to route.
 */
async function routeRelationshipProposals(
  queryClient: QueryClient,
  chatId: string,
  rawData: unknown,
): Promise<RoutedProposal[]> {
  const chat =
    queryClient.getQueryData<Chat>(chatKeys.detail(chatId)) ??
    (await storageApi.get<Chat>("chats", chatId).catch(() => null));
  if (!chat) return [];

  const activePersonaId = readChatPersonaId(chat);
  if (!activePersonaId) return [];

  const chatCharacterIds = collectChatCharacterIds(chat);
  if (chatCharacterIds.size === 0) return [];

  const normalized = normalizeRelationshipEvents(rawData, chatCharacterIds, activePersonaId);
  if (normalized.events.length === 0) return [];

  // Settings load + per-proposal row loads are independent — fan out so the
  // wall-clock cost is one round-trip rather than N+1.
  const [settings, loadedRows] = await Promise.all([
    loadApprovalSettings(),
    Promise.all(normalized.events.map((p) => loadCharacterRow(queryClient, p.characterId))),
  ]);

  const routed: RoutedProposal[] = [];
  for (let i = 0; i < normalized.events.length; i += 1) {
    const proposal = normalized.events[i]!;
    const row = loadedRows[i];
    if (!row) continue;

    const extensions = extensionsFromCharacterRow(row);
    const existing = getRelationshipForPersona(extensions, proposal.personaId);
    const decision = routeProposal(proposal, {
      mode: settings.approvalMode,
      isFirstEventInChat: isFirstEventInChatId(existing, chatId),
    });
    routed.push({
      characterId: proposal.characterId,
      characterName: characterNameFromRow(row),
      proposal,
      decision,
    });
  }

  return routed;
}

function readChatPersonaId(chat: Chat | Record<string, unknown>): string {
  const value = (chat as unknown as { personaId?: unknown }).personaId;
  return typeof value === "string" ? value.trim() : "";
}

function collectChatCharacterIds(chat: Chat | Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  const field = (chat as unknown as { characterIds?: unknown }).characterIds;
  if (Array.isArray(field)) {
    for (const id of field) {
      if (typeof id === "string" && id.trim()) ids.add(id.trim());
    }
  }
  return ids;
}

export interface BuildResult {
  /** Pending proposals to push into the agent store's review queue. */
  queued: PendingRelationshipProposal[];
  /** Auto-applied proposals — already persisted; surface a toast count. */
  appliedCount: number;
}

/**
 * Process a `relationship_event` agent result end-to-end: route each
 * proposal, auto-apply or queue per decision, return both the queue
 * entries and the count of auto-applied writes. Auto-apply writes hit
 * storage immediately; the caller is responsible for surfacing the
 * applied count to the user (toast) and invalidating React Query caches.
 *
 * Writes for distinct characters fan out in parallel. Writes targeting the
 * same character chain sequentially within their group — each apply
 * re-reads the row before writing (see `persistAppliedEvent`), so two
 * proposals targeting the same character must serialize to avoid the
 * second clobbering the first.
 */
export async function buildPendingRelationshipDecisions(
  queryClient: QueryClient,
  chatId: string,
  agentName: string,
  rawData: unknown,
): Promise<BuildResult> {
  const routed = await routeRelationshipProposals(queryClient, chatId, rawData);
  if (routed.length === 0) return { queued: [], appliedCount: 0 };

  const timestamp = Date.now();
  const queued: PendingRelationshipProposal[] = [];
  const applyGroups = new Map<string, RoutedProposal[]>();

  for (const entry of routed) {
    if (entry.decision.kind === "queue") {
      queued.push({
        id: createId(`relationship-proposal-${entry.characterId}`),
        chatId,
        characterId: entry.characterId,
        characterName: entry.characterName,
        personaId: entry.proposal.personaId,
        agentName,
        proposal: entry.proposal,
        queueReason: entry.decision.reason,
        timestamp: timestamp + queued.length,
      });
      continue;
    }
    const group = applyGroups.get(entry.characterId) ?? [];
    group.push(entry);
    applyGroups.set(entry.characterId, group);
  }

  const writtenCharacterIds = new Set<string>();
  await Promise.all(
    Array.from(applyGroups.entries(), async ([characterId, group]) => {
      // Within one character's group, serialize so each write sees the
      // previous write's effect. Between groups, run in parallel.
      for (const entry of group) {
        try {
          const written = await persistAppliedEvent(entry.characterId, entry.proposal, chatId);
          if (written) writtenCharacterIds.add(characterId);
        } catch (err) {
          // Don't abort sibling groups if one write fails — record nothing
          // for this entry and continue. Prior successful writes still get
          // their cache invalidation below.
          console.error("[relationship-tracker] auto-apply write failed", err);
        }
      }
    }),
  );

  if (writtenCharacterIds.size > 0) {
    await Promise.all([
      ...Array.from(writtenCharacterIds, (id) =>
        queryClient.invalidateQueries({ queryKey: characterKeys.detail(id) }),
      ),
      queryClient.invalidateQueries({ queryKey: characterKeys.list() }),
    ]);
  }

  return { queued, appliedCount: writtenCharacterIds.size };
}

/**
 * Persist one event by re-reading the row fresh from storage. Re-reading is
 * deliberate — two same-character proposals in one batch would otherwise
 * both build off the routing-time snapshot and the second write would
 * clobber the first. By going through storage on every call, the write
 * always sees the most recent ledger state.
 *
 * Note this doesn't fully defend against concurrent batches (no optimistic
 * locking on the storage layer); a parallel writer could still race. Within
 * a single batch processed sequentially per character, the read-then-write
 * is correctly serialized.
 */
async function persistAppliedEvent(
  characterId: string,
  proposal: RelationshipEventProposal,
  chatId: string,
): Promise<boolean> {
  const row = await storageApi.get<CharacterRow>("characters", characterId).catch(() => null);
  if (!row) return false;

  const extensions = extensionsFromCharacterRow(row);
  const existing = getRelationshipForPersona(extensions, proposal.personaId);
  const nextRelationship = applyEventToRelationship(existing, proposal, {
    at: new Date().toISOString(),
    chatId,
  });
  const nextExtensions = setRelationshipForPersona(extensions, nextRelationship);

  const patch = buildExtensionsPatch(row, nextExtensions);
  await storageApi.update("characters", row.id, patch);
  return true;
}

/**
 * Build the storage patch for the character row's extensions. Writes
 * extensions nested under `data` — the canonical V2-card location used by
 * every other character writer (scene-service.ts:500, connected-commands.ts:608).
 */
function buildExtensionsPatch(
  row: CharacterRow,
  nextExtensions: CharacterExtensions,
): Record<string, unknown> {
  const parsed = parseCharacterData(row);
  return { data: { ...parsed, extensions: nextExtensions } };
}

/**
 * Persist a single queued proposal (called from the modal's "Approve").
 * Returns true on success, false when the character row vanished mid-flight
 * (deleted between routing and approval). Re-reads the row through storage
 * on every call to avoid stale-snapshot races (see `persistAppliedEvent`).
 */
export async function applyRelationshipProposal(
  queryClient: QueryClient,
  entry: PendingRelationshipProposal,
): Promise<boolean> {
  const written = await persistAppliedEvent(entry.characterId, entry.proposal, entry.chatId);
  if (written) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: characterKeys.detail(entry.characterId) }),
      queryClient.invalidateQueries({ queryKey: characterKeys.list() }),
    ]);
  }
  return written;
}
