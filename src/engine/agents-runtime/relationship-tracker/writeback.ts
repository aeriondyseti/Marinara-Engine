/**
 * Relationship Tracker — writeback layer.
 *
 * Routes proposals to either the approval queue or auto-apply, applies
 * accepted events to a character's relationship ledger, and orchestrates
 * session-boundary rollup. All functions are pure — they take the current
 * state and return the next state without touching storage. The integration
 * layer is responsible for persisting the returned shapes.
 *
 * See docs/agents/relationship-tracker.md §7 (Settings — approvalMode),
 * §10 (Pipeline Lifecycle — routing + apply + rollup), §13 (Storage & Rollup).
 */

import type {
  RelationshipConfidence,
  RelationshipEventProposal,
  RelationshipMagnitude,
} from "../../contracts/types/agent";
import type {
  CharacterRelationship,
  RelationshipEventRecord,
  RelationshipLifetimeAggregate,
  RelationshipSessionSummary,
} from "../../contracts/types/character";
import {
  findMilestoneTriggers,
  rollSessionToSummary,
  rollSummaryToLifetime,
  shouldCollapseOldestSummary,
} from "./rollup";

// ──────────────────────────────────────────────
// Settings
// ──────────────────────────────────────────────

export type ApprovalMode = "manual" | "significant" | "auto";

export interface ApprovalSettings {
  approvalMode: ApprovalMode;
  /**
   * Reserved for future use: a numeric significance cutoff if we move away
   * from the magnitude-bucket-based routing in `"significant"` mode. v1
   * routing uses magnitude directly, ignoring this number. Kept for forward
   * compatibility with the original v1.1 design.
   */
  significantThreshold?: number;
  /** Tier-1 hot-window size (see docs §7). Used by rollup orchestration. */
  hotEventWindow?: number;
  /** Tier-2 session-summary retention window. */
  sessionHistoryWindow?: number;
  /** Highlights preserved per session summary. */
  sessionHighlightsKept?: number;
}

export const DEFAULT_APPROVAL_SETTINGS: Readonly<Required<ApprovalSettings>> = Object.freeze({
  approvalMode: "significant" as ApprovalMode,
  significantThreshold: 0,
  hotEventWindow: 30,
  sessionHistoryWindow: 50,
  sessionHighlightsKept: 2,
});

/**
 * Merge user-supplied partial settings over the defaults, returning a fully-
 * populated config. Use this at the integration boundary instead of reading
 * partial settings directly — any optional field accessed on the partial
 * would yield `undefined` (not the default).
 */
export function resolveApprovalSettings(
  partial: ApprovalSettings | undefined | null,
): Required<ApprovalSettings> {
  return { ...DEFAULT_APPROVAL_SETTINGS, ...(partial ?? {}) };
}

// ──────────────────────────────────────────────
// Routing
// ──────────────────────────────────────────────

export type RoutingDecision =
  | { kind: "auto_apply" }
  | { kind: "queue"; reason: QueueReason };

export type QueueReason =
  | "mode_manual"
  | "low_confidence"
  | "medium_confidence_in_significant_mode"
  | "first_event_in_chat"
  | "significant_magnitude";

export interface RoutingContext {
  mode: ApprovalMode;
  /**
   * True if this proposal would be the first event the agent emits for the
   * (characterId, currentChatId) pair. First impressions of a chat ALWAYS
   * queue regardless of mode — see docs §7 mandatory-queue table.
   */
  isFirstEventInChat: boolean;
}

/**
 * Decide whether a proposal auto-applies or queues for user review.
 *
 * Mandatory-queue conditions (override mode):
 * - `confidence: "low"` — flagged by the agent as possibly wrong
 * - `isFirstEventInChat` — first event on this character this chat
 *
 * After the mandatory checks:
 * - "manual" → always queue
 * - "significant" → minor + high confidence auto; moderate/major queue
 * - "auto" → everything auto
 */
export function routeProposal(
  proposal: RelationshipEventProposal,
  ctx: RoutingContext,
): RoutingDecision {
  // Mandatory-queue overrides come first — see docs §7.
  if (proposal.confidence === "low") {
    return { kind: "queue", reason: "low_confidence" };
  }
  if (ctx.isFirstEventInChat) {
    return { kind: "queue", reason: "first_event_in_chat" };
  }

  if (ctx.mode === "manual") {
    return { kind: "queue", reason: "mode_manual" };
  }

  if (ctx.mode === "auto") {
    return { kind: "auto_apply" };
  }

  // "significant" mode: auto-apply only minor events with high confidence.
  // Distinguish the reason for the queue path so telemetry shows the actual
  // reason (medium confidence ≠ significant magnitude).
  if (proposal.magnitude === "minor" && proposal.confidence === "high") {
    return { kind: "auto_apply" };
  }
  if (proposal.magnitude !== "minor") {
    return { kind: "queue", reason: "significant_magnitude" };
  }
  // Minor + medium confidence.
  return { kind: "queue", reason: "medium_confidence_in_significant_mode" };
}

/**
 * Check whether a proposal is the first event the agent emits for the
 * (character, chat) pair. Use this to populate `RoutingContext.isFirstEventInChat`.
 *
 * DO NOT use `rel.lastChatId === chatId` as a proxy — `applyEventToRelationship`
 * overwrites `lastChatId` on every apply, so by the second proposal in the
 * same chat the lastChatId check would already match. Scanning `rel.events`
 * is the correct check.
 */
export function isFirstEventInChatId(
  rel: import("../../contracts/types/character").CharacterRelationship | null,
  chatId: string,
): boolean {
  if (rel === null) return true;
  return !rel.events.some((e) => e.chatId === chatId);
}

/**
 * Convenience helper: count how many proposals would auto-apply vs queue
 * under a given routing config. Useful for UI summaries.
 */
export function summarizeRouting(
  proposals: ReadonlyArray<{ proposal: RelationshipEventProposal; ctx: RoutingContext }>,
): { autoApply: number; queued: number } {
  let autoApply = 0;
  let queued = 0;
  for (const { proposal, ctx } of proposals) {
    const decision = routeProposal(proposal, ctx);
    if (decision.kind === "auto_apply") autoApply += 1;
    else queued += 1;
  }
  return { autoApply, queued };
}

// ──────────────────────────────────────────────
// Apply
// ──────────────────────────────────────────────

export interface ApplyOptions {
  /** ISO timestamp to stamp on the new event. */
  at: string;
  /** Chat where the event originated; sets `lastChatId` and `event.chatId`. */
  chatId: string;
}

/**
 * Apply a proposal to the character's relationship ledger. Returns the
 * next-state relationship (immutable: input is not mutated). If `rel` is
 * null, creates a fresh relationship entry for this persona.
 *
 * Newly applied events go to tier-1 (hot events). Milestone preservation
 * happens at session rollup (`runSessionRollup`), not here — applying
 * events one at a time should be fast and side-effect-free.
 */
export function applyEventToRelationship(
  rel: CharacterRelationship | null,
  proposal: RelationshipEventProposal,
  options: ApplyOptions,
): CharacterRelationship {
  const event: RelationshipEventRecord = {
    at: options.at,
    chatId: options.chatId,
    magnitude: proposal.magnitude,
    valence: proposal.valence,
    initiator: proposal.initiator,
    confidence: proposal.confidence,
    description: proposal.description,
  };

  if (rel === null) {
    return {
      personaId: proposal.personaId,
      events: [event],
      sessionSummaries: [],
      lifetime: emptyLifetime(),
      preservedEvents: [],
      lastChatId: options.chatId,
      updatedAt: options.at,
    };
  }

  return {
    ...rel,
    events: [...rel.events, event],
    lastChatId: options.chatId,
    // Guard against updatedAt regressing backward when an out-of-order
    // proposal (e.g., a replay or late-arriving event) applies — ISO
    // strings compare lexicographically in chronological order.
    updatedAt: options.at > rel.updatedAt ? options.at : rel.updatedAt,
  };
}

function emptyLifetime(): RelationshipLifetimeAggregate {
  return {
    totalEventCount: 0,
    tally: {
      minor: { positive: 0, negative: 0, neutral: 0 },
      moderate: { positive: 0, negative: 0, neutral: 0 },
      major: { positive: 0, negative: 0, neutral: 0 },
    },
    initiatorTally: { persona: 0, character: 0, mutual: 0, external: 0 },
    firstEventAt: "",
    latchedMilestones: {},
  };
}

// ──────────────────────────────────────────────
// Session rollup orchestration
// ──────────────────────────────────────────────

export interface SessionRollupOptions {
  /**
   * Session ID of the chat that is CLOSING — events with this chatId in
   * `rel.events` will be considered for rollup. Events from other chats are
   * left in place (and may be trimmed independently if they exceed
   * `hotEventWindow`).
   */
  closingChatId: string;
  /**
   * Tier-1 hot ring cap. After the closing session has been rolled up, any
   * remaining tier-1 events past this count are also rolled up (oldest
   * first) into a separate per-chat summary. Without this, tier-1 grows
   * unbounded since only events from explicitly-closed chats get rolled.
   */
  hotEventWindow: number;
  /** Tier-2 retention window. Older summaries collapse into lifetime. */
  sessionHistoryWindow: number;
  /** Highlight count preserved per session summary. */
  highlightsKept: number;
}

/**
 * Run the full session-boundary rollup sequence on a relationship. This is
 * the orchestrator that prior code-review rounds flagged as missing — having
 * the entire sequence in one place eliminates the misordering risk that
 * caller-side composition would carry (see docs §13 "Rollup operations").
 *
 * Sequence:
 *   1. Slice `rel.events` into closing-session vs current.
 *   2. Identify milestone triggers among closing-session events
 *      (findMilestoneTriggers — also splits into toPreserve + toSummarize).
 *   3. Compress non-milestone closing-session events into a SessionSummary.
 *   4. Append summary to sessionSummaries, preserved events to
 *      preservedEvents, new latches to lifetime.latchedMilestones.
 *   5. If sessionSummaries exceeds the retention window, collapse the
 *      oldest summary into the lifetime aggregate.
 *
 * Idempotent given the same input set, but the caller is responsible for
 * invoking it exactly once per session-close (the function does NOT detect
 * duplicate invocations — see rollSummaryToLifetime contract).
 */
export function runSessionRollup(
  rel: CharacterRelationship,
  options: SessionRollupOptions,
): CharacterRelationship {
  // 1. Split tier-1 events by closing session.
  const closingEvents: RelationshipEventRecord[] = [];
  let remainingEvents: RelationshipEventRecord[] = [];
  for (const e of rel.events) {
    if (e.chatId === options.closingChatId) closingEvents.push(e);
    else remainingEvents.push(e);
  }

  // Detect overflow in the surviving tier-1 ring. Without trimming here, tier-1
  // grows unbounded over many sessions (only the closing chat's events get
  // rolled up by the explicit slice above). Per docs §13, the hot window caps
  // tier-1; anything past it rolls up too. We group overflow by chatId so it
  // ends up in its own session summary, not mingled with the closing session's.
  const overflowByChat = new Map<string, RelationshipEventRecord[]>();
  if (remainingEvents.length > options.hotEventWindow) {
    const overflowCount = remainingEvents.length - options.hotEventWindow;
    // Use chronological order: sort by `at`, then take the oldest `overflowCount`.
    const sorted = [...remainingEvents].sort((a, b) =>
      a.at === b.at ? 0 : a.at < b.at ? -1 : 1,
    );
    const overflow = sorted.slice(0, overflowCount);
    const keepSet = new Set(sorted.slice(overflowCount));
    remainingEvents = remainingEvents.filter((e) => keepSet.has(e));
    for (const e of overflow) {
      const list = overflowByChat.get(e.chatId) ?? [];
      list.push(e);
      overflowByChat.set(e.chatId, list);
    }
  }

  if (closingEvents.length === 0 && overflowByChat.size === 0) {
    // Nothing to roll up — return rel unchanged (object identity preserved
    // for callers that compare by reference).
    return rel;
  }

  // 2. Identify milestone triggers from the closing session — splits into
  //    {toPreserve, toSummarize, newLatches}. Returns empty arrays/object
  //    when closingEvents is empty.
  const closingResult = findMilestoneTriggers(
    closingEvents,
    rel.lifetime.latchedMilestones,
  );

  // 3. Build next-lifetime, deep-copying nested latch records so the input
  //    rel.lifetime.latchedMilestones cannot be mutated through the result.
  //    (Symmetric with rollSummaryToLifetime which already deep-copies.)
  let nextLifetime: RelationshipLifetimeAggregate = {
    ...rel.lifetime,
    latchedMilestones: deepCopyLatchedMilestones({
      ...rel.lifetime.latchedMilestones,
      ...closingResult.newLatches,
    }),
  };

  // 4. Compress non-milestone closing events into a session summary.
  let nextSummaries: RelationshipSessionSummary[] = [...rel.sessionSummaries];
  if (closingEvents.length > 0) {
    const newSummary = rollSessionToSummary(
      options.closingChatId,
      closingResult.toSummarize,
      options.highlightsKept,
    );
    if (newSummary.eventCount > 0) nextSummaries.push(newSummary);
  }

  // 5. Also roll up overflow events from other chats — each chat's overflow
  //    becomes its own summary, with its own milestone-trigger pass against
  //    the cumulative latch state.
  let preservedAccum: RelationshipEventRecord[] = [
    ...rel.preservedEvents,
    ...closingResult.toPreserve,
  ];
  for (const [chatId, events] of overflowByChat) {
    const ovResult = findMilestoneTriggers(events, nextLifetime.latchedMilestones);
    nextLifetime = {
      ...nextLifetime,
      latchedMilestones: deepCopyLatchedMilestones({
        ...nextLifetime.latchedMilestones,
        ...ovResult.newLatches,
      }),
    };
    preservedAccum = [...preservedAccum, ...ovResult.toPreserve];
    const overflowSummary = rollSessionToSummary(
      chatId,
      ovResult.toSummarize,
      options.highlightsKept,
    );
    if (overflowSummary.eventCount > 0) nextSummaries.push(overflowSummary);
  }

  // 6. Sort summaries chronologically before the collapse loop. Overflow
  //    summaries from other chats can land out of order with the closing
  //    chat's summary; without this sort, shouldCollapseOldestSummary
  //    would treat the array head as "oldest" and could collapse a newer
  //    summary into lifetime while an older one survives the window.
  nextSummaries.sort((a, b) => {
    if (a.startedAt === b.startedAt) return 0;
    return a.startedAt < b.startedAt ? -1 : 1;
  });

  // Collapse oldest summary into lifetime if we're over the window.
  // Safety cap: never iterate more than nextSummaries.length times.
  let safetyCap = nextSummaries.length + 1;
  while (
    shouldCollapseOldestSummary(nextSummaries, options.sessionHistoryWindow) &&
    safetyCap-- > 0
  ) {
    const [oldest, ...rest] = nextSummaries;
    nextLifetime = rollSummaryToLifetime(oldest, nextLifetime);
    nextSummaries = rest;
  }

  return {
    ...rel,
    events: remainingEvents,
    sessionSummaries: nextSummaries,
    preservedEvents: preservedAccum,
    lifetime: nextLifetime,
    // lastChatId/updatedAt are not touched here — rollup is meant to be
    // invoked at session-close as a pure projection. The integration layer
    // is responsible for any further timestamp bookkeeping it needs.
  };
}

function deepCopyLatchedMilestones(
  latched: RelationshipLifetimeAggregate["latchedMilestones"],
): RelationshipLifetimeAggregate["latchedMilestones"] {
  // Mirror of the precaution in rollSummaryToLifetime: deep-copy nested
  // latch records so callers can't mutate them back into the input rel.
  return Object.fromEntries(
    Object.entries(latched).map(([k, v]) => [k, { ...v }]),
  );
}

// ──────────────────────────────────────────────
// Undo (for autoApply mode audit trail)
// ──────────────────────────────────────────────

/**
 * Reverse the application of an event by chatId + at timestamp. Used by the
 * audit-trail UI's "Undo" button on auto-applied entries. Returns the next
 * state with the matching event removed from tier-1 events; if no match,
 * returns the input unchanged.
 *
 * The function intentionally does NOT search `preservedEvents` —
 * milestone-preserved events were promoted through the user-approved rollup
 * boundary and shouldn't be undone via this fast path. Manual edit UI would
 * be the appropriate channel.
 */
export function undoAppliedEvent(
  rel: CharacterRelationship,
  match: { at: string; chatId: string },
): CharacterRelationship {
  const idx = rel.events.findIndex(
    (e) => e.at === match.at && e.chatId === match.chatId,
  );
  if (idx === -1) return rel;
  const events = [...rel.events];
  events.splice(idx, 1);
  return { ...rel, events };
}

// ──────────────────────────────────────────────
// Re-exports for the integration layer
// ──────────────────────────────────────────────

export type { RelationshipMagnitude, RelationshipConfidence };
