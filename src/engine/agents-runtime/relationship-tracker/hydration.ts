/**
 * Relationship Tracker — read-side hydration.
 *
 * Pure functions for building the agent's context blocks and gating
 * whether the agent should run at all on a given turn. Wired into the
 * production agent pipeline by `agent-runner.ts`.
 */

import type { CharacterRelationship } from "../../contracts/types/character";
import type { LorebookEntry } from "../../contracts/types/lorebook";
import { deriveRelationshipMetrics } from "./fold";

// ──────────────────────────────────────────────
// Pre-LLM gate
// ──────────────────────────────────────────────

export interface GateMessage {
  /** "user" | "assistant" | "system" — the standard message role */
  role: string;
  content: string;
}

export interface GateCharacter {
  id: string;
  name: string;
  aliases?: string[];
}

/**
 * Decide whether the agent should run on this turn. Cheap heuristic: skip
 * the LLM call if no present character was mentioned in the recent message
 * slice. Per docs §10 step 1, the goal is to avoid the agent firing on
 * pure scene-setting, travel, or mechanics-only turns.
 *
 * v1 implementation is permissive: any name/alias appearance in any
 * non-system message counts as "acted/spoke/was-acted-upon." Tightening
 * this heuristic is future work — start liberal, observe false-positive
 * agent runs, then constrain.
 */
export function shouldRunForTurn(
  recentMessages: readonly GateMessage[],
  presentCharacters: readonly GateCharacter[],
): boolean {
  if (recentMessages.length === 0) return false;
  if (presentCharacters.length === 0) return false;

  // Word-boundary matching, not substring. A short alias like "Al" would
  // otherwise match "always"/"almost"/"although" and fire the agent on
  // nearly every turn — exactly the cost the gate exists to avoid.
  const needles: string[] = [];
  for (const ch of presentCharacters) {
    const trimmedName = ch.name.trim();
    if (trimmedName) needles.push(trimmedName);
    if (ch.aliases) {
      for (const a of ch.aliases) {
        const trimmedAlias = a.trim();
        if (trimmedAlias) needles.push(trimmedAlias);
      }
    }
  }
  if (needles.length === 0) return false;

  const pattern = new RegExp(`\\b(?:${needles.map(escapeRegExp).join("|")})\\b`, "i");
  for (const msg of recentMessages) {
    if (msg.role === "system") continue;
    if (pattern.test(msg.content)) return true;
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ──────────────────────────────────────────────
// <current_state> block
// ──────────────────────────────────────────────

export interface CurrentStateBlockInput {
  characters: ReadonlyArray<{
    id: string;
    name: string;
    relationship: CharacterRelationship | null;
  }>;
  /** Turn / session anchors used by the fold for time-decay computations. */
  context: {
    currentTurn: number;
    currentSession: number;
  };
  /** How many tier-1 events to render verbatim per character (default 5). */
  recentEventsKept?: number;
}

/**
 * Render the `<current_state>` context block for the agent. One section
 * per present character, showing derived metrics and the last N tier-1
 * events. Characters without an existing relationship render as
 * "first encounter" — the agent must use action: "create" for them.
 *
 * Pure; deterministic.
 */
export function buildCurrentStateBlock(input: CurrentStateBlockInput): string {
  const eventsKept = input.recentEventsKept ?? 5;
  const sections: string[] = ["<current_state>"];

  for (const ch of input.characters) {
    sections.push(`Character: ${ch.name} (id: ${ch.id})`);
    if (!ch.relationship || isEmptyRelationship(ch.relationship)) {
      sections.push("  (no prior interactions — first encounter)");
      sections.push("");
      continue;
    }

    const metrics = deriveRelationshipMetrics(ch.relationship, input.context);
    sections.push(`  affinity: ${metrics.affinity}`);
    sections.push(`  trust: ${metrics.trust}`);
    sections.push(`  familiarity: ${metrics.familiarity}`);
    sections.push(`  status: ${metrics.status}`);

    // Combine tier-1 events with preserved milestone events, then take the
    // last N by timestamp. A preserved event chronologically newer than
    // any tier-1 event should appear in "recent events" — milestone-status
    // shouldn't make an event invisible to the model.
    const combined = [...ch.relationship.events, ...ch.relationship.preservedEvents].sort(
      (a, b) => {
        if (a.at === b.at) return 0;
        return a.at < b.at ? -1 : 1;
      },
    );
    const recent = lastN(combined, eventsKept);
    if (recent.length > 0) {
      sections.push(`  recent events (last ${recent.length}):`);
      for (const e of recent) {
        sections.push(`    [${e.magnitude}+${e.valence}, ${e.initiator}]: ${formatDescription(e.description)}`);
      }
    }
    sections.push("");
  }

  sections.push("</current_state>");
  return sections.join("\n");
}

function isEmptyRelationship(rel: CharacterRelationship): boolean {
  return (
    rel.events.length === 0 &&
    rel.preservedEvents.length === 0 &&
    rel.sessionSummaries.length === 0 &&
    rel.lifetime.totalEventCount === 0
  );
}

function lastN<T>(arr: readonly T[], n: number): T[] {
  if (n <= 0) return [];
  return arr.slice(-n);
}

/**
 * Render a free-form string field (event description, lore content) into a
 * prompt block safely. Escapes embedded double-quotes so the surrounding
 * `"..."` delimiters can't be broken, and replaces internal newlines with
 * spaces so a single rendered line stays on one line. Strips angle-bracket
 * pairs that look like XML-ish closing tags to prevent a malicious or
 * accidental `</character_lore>` inside content from prematurely closing
 * the context block.
 */
function formatDescription(text: string): string {
  const stripped = text
    .replace(/<\/?(?:current_state|character_lore|present_characters|persona|recent_messages)>/gi, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/"/g, '\\"');
  return `"${stripped}"`;
}

// ──────────────────────────────────────────────
// Lore ranking + packing
// ──────────────────────────────────────────────

/**
 * Lorebook entry tags that count as "relationship-relevant" for the
 * scoring bonus per docs §12. Conservative initial set; user-extensible
 * later via configuration.
 */
const RELATIONSHIP_RELEVANT_TAGS = new Set([
  "relationship",
  "history",
  "backstory",
  "lore",
  "character",
]);

/**
 * Default scoring weights, per docs §12 table. These are tunable — callers
 * may pass partial overrides via LoreScoringContext.weights.
 *
 * Note: the `important` weight is unused in v1. The doc §12 marks it as
 * "if schema supports" — and the schema doesn't. We deliberately do NOT
 * use LorebookEntry.constant as a proxy: `constant: true` in this codebase
 * means "always inject into every prompt" (global activation override), not
 * "important for relationship scoring." A world-map entry marked constant
 * for ambient injection would otherwise score +100 here for no good reason.
 * Reserved for a future dedicated priority field on LorebookEntry.
 */
export const LORE_SCORING_WEIGHTS = {
  important: 100,
  mentionsPersona: 50,
  mentionsSubject: 30,
  relationshipTag: 25,
  crossReferencesPresent: 15,
  recentlyUpdated: 10,
  recentlyActivated: 8,
  lengthPenaltyPer100Tokens: -2,
} as const;

/**
 * Loose-type variant for overrides — `as const` on LORE_SCORING_WEIGHTS
 * gives each key a literal-number type, which would refuse plain numeric
 * overrides. Callers passing weight overrides see a Record<key, number>.
 */
export type LoreScoringWeights = Record<keyof typeof LORE_SCORING_WEIGHTS, number>;

const RECENT_UPDATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const LENGTH_PENALTY_BASELINE_TOKENS = 200;

export interface LoreScoringContext {
  /** Names + aliases + ID of the persona. Lowercased; caller normalizes. */
  personaNeedles: string[];
  /** Lowercased name/alias/id of OTHER present characters (excluding the subject). */
  otherPresentNeedles: string[];
  /** Lowercased name/alias/id of the SUBJECT character (this entry's character). */
  subjectNeedles: string[];
  /** Wall-clock reference for "recently updated" — caller passes `now` (ISO or millis). */
  nowMillis: number;
  /** Optional set of entry IDs activated by keyword scanner in last 3 turns. */
  recentlyActivatedEntryIds?: Set<string>;
  /** Optional weight overrides — defaults from LORE_SCORING_WEIGHTS. */
  weights?: Partial<LoreScoringWeights>;
}

/**
 * Score a single lorebook entry per docs §12. Higher score → packed earlier.
 * Each signal contributes independently; missing context just zeroes that signal.
 *
 * Pure; deterministic given the same input.
 */
export function scoreLoreEntry(entry: LorebookEntry, ctx: LoreScoringContext): number {
  let score = 0;
  const weights = { ...LORE_SCORING_WEIGHTS, ...(ctx.weights ?? {}) };

  // Defensive field access — entries from `AgentContext.activatedLorebookEntries`
  // are a slim 4-field shape (id, name, content, tag) without description/
  // updatedAt/constant. The agent-runner wiring should pass full LorebookEntry
  // records, but we coerce missing fields rather than throw.
  const content = entry.content ?? "";
  const name = entry.name ?? "";
  const description = entry.description ?? "";
  const tag = entry.tag ?? "";
  const updatedAtRaw = entry.updatedAt ?? "";

  const haystack = (content + " " + name + " " + description).toLowerCase();

  // `entry.constant` is intentionally NOT used here. In this codebase
  // `constant: true` means "always inject into every prompt" (global
  // activation override) — not "important for relationship scoring." A
  // world-rules entry marked constant for ambient injection would otherwise
  // get a +100 bonus it doesn't deserve. The `important` weight is reserved
  // for a future dedicated priority field.

  if (containsAny(haystack, ctx.personaNeedles)) score += weights.mentionsPersona;
  if (containsAny(haystack, ctx.subjectNeedles)) score += weights.mentionsSubject;
  if (containsAny(haystack, ctx.otherPresentNeedles)) {
    score += weights.crossReferencesPresent;
  }

  if (RELATIONSHIP_RELEVANT_TAGS.has(tag.toLowerCase())) {
    score += weights.relationshipTag;
  }

  const updatedAt = Date.parse(updatedAtRaw);
  if (!Number.isNaN(updatedAt) && ctx.nowMillis - updatedAt <= RECENT_UPDATE_WINDOW_MS) {
    score += weights.recentlyUpdated;
  }

  if (ctx.recentlyActivatedEntryIds?.has(entry.id)) {
    score += weights.recentlyActivated;
  }

  // Length penalty: -2 per 100 tokens over a 200-token baseline. Use
  // characters/4 as a rough token proxy (good enough for ranking).
  const approxTokens = Math.ceil(content.length / 4);
  if (approxTokens > LENGTH_PENALTY_BASELINE_TOKENS) {
    const overage = approxTokens - LENGTH_PENALTY_BASELINE_TOKENS;
    score += weights.lengthPenaltyPer100Tokens * Math.floor(overage / 100);
  }

  return score;
}

function containsAny(haystack: string, needles: readonly string[]): boolean {
  for (const n of needles) {
    if (n && haystack.includes(n)) return true;
  }
  return false;
}

// ──────────────────────────────────────────────
// Lore packing
// ──────────────────────────────────────────────

export interface ScoredLoreEntry {
  entry: LorebookEntry;
  score: number;
  /** Approx token count (chars / 4). */
  approxTokens: number;
}

export interface LorePackBudget {
  /** Total token budget across all characters. */
  total: number;
  /** Per-character allocation cap (in tokens). */
  perCharacter: number;
  /**
   * Minimum guaranteed share per present character, as a fraction of total.
   * Per docs §12: min(0.20, 1 / N_present) — scales down so >5 characters
   * doesn't oversubscribe the budget.
   */
  perCharacterFloorFraction: number;
}

export const DEFAULT_LORE_BUDGET: LorePackBudget = {
  total: 2000,
  perCharacter: 500,
  perCharacterFloorFraction: 0.2,
};

export interface PackedLore {
  /** Entries that survived packing, keyed by the character they're attached to. */
  byCharacter: Map<string, LorebookEntry[]>;
  /** Entries dropped due to budget — keyed by character for sentinel emission. */
  droppedByCharacter: Map<string, LorebookEntry[]>;
  /** Approximate total tokens used. */
  tokensUsed: number;
}

export interface CharacterLoreInput {
  characterId: string;
  /** Pre-scored entries attached to this character, in any order. */
  entries: ReadonlyArray<ScoredLoreEntry>;
}

/**
 * Pack ranked lore entries within a budget, respecting per-character floors.
 *
 * Per docs §12 packing rules:
 * - Per-character floor = min(perCharacterFloorFraction, 1/N_present) × total
 * - Within each character's allocation, pack highest-scored first.
 * - Single-entry override: a character's top-scored entry is included even
 *   if it exceeds their allocation — load-bearing single entries beat
 *   budget cleanliness.
 *
 * Returns both kept and dropped entries (for sentinel emission).
 */
export function packLoreEntries(
  characters: ReadonlyArray<CharacterLoreInput>,
  budget: LorePackBudget = DEFAULT_LORE_BUDGET,
): PackedLore {
  const byCharacter = new Map<string, LorebookEntry[]>();
  const droppedByCharacter = new Map<string, LorebookEntry[]>();
  let tokensUsed = 0;

  if (characters.length === 0 || budget.total <= 0) {
    return { byCharacter, droppedByCharacter, tokensUsed };
  }

  // Per-character floor: min(configured fraction, 1 / N_present). The floor
  // is a MINIMUM guarantee, not a cap — every present character gets at
  // least this many tokens before any character can use its full perCharacter
  // allocation.
  const floorFraction = Math.min(
    Math.max(budget.perCharacterFloorFraction, 0),
    1 / characters.length,
  );
  const perCharFloor = Math.floor(budget.total * floorFraction);

  // Each character's allocation: at least the floor, at most the configured
  // perCharacter cap. The previous formulation `min(perCharacter, max(floor, 0))`
  // inverted the floor's purpose by capping the allocation at the floor.
  const allocation = Math.max(perCharFloor, Math.min(budget.perCharacter, budget.total));

  // Sort each character's entries by descending score (ties by descending updatedAt).
  for (const ch of characters) {
    const sorted = [...ch.entries].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Use updatedAt as the deterministic tiebreaker — ISO format compares
      // lexicographically in chronological order. Parse defensively for
      // unexpected non-ISO timestamp strings.
      const aMs = Date.parse(a.entry.updatedAt);
      const bMs = Date.parse(b.entry.updatedAt);
      if (Number.isNaN(aMs) || Number.isNaN(bMs)) {
        // Fall back to string compare if either side is unparseable.
        if (a.entry.updatedAt === b.entry.updatedAt) return 0;
        return a.entry.updatedAt < b.entry.updatedAt ? 1 : -1;
      }
      return bMs - aMs;
    });

    const kept: LorebookEntry[] = [];
    const dropped: LorebookEntry[] = [];
    let charTokens = 0;

    for (let i = 0; i < sorted.length; i += 1) {
      const scored = sorted[i];
      const isFirst = i === 0;

      // Single-entry override applies to BOTH the per-character allocation
      // check AND the global budget check — a load-bearing single entry is
      // worth more than budget cleanliness (per docs §12). The overage is
      // intentional and is communicated through the tokensUsed return value
      // (callers can compare to budget.total to detect overruns).
      if (isFirst) {
        kept.push(scored.entry);
        charTokens += scored.approxTokens;
        tokensUsed += scored.approxTokens;
        continue;
      }

      if (charTokens + scored.approxTokens > allocation) {
        dropped.push(scored.entry);
        continue;
      }

      if (tokensUsed + scored.approxTokens > budget.total) {
        dropped.push(scored.entry);
        continue;
      }

      kept.push(scored.entry);
      charTokens += scored.approxTokens;
      tokensUsed += scored.approxTokens;
    }

    if (kept.length > 0) byCharacter.set(ch.characterId, kept);
    if (dropped.length > 0) droppedByCharacter.set(ch.characterId, dropped);
  }

  return { byCharacter, droppedByCharacter, tokensUsed };
}

// ──────────────────────────────────────────────
// <character_lore> block
// ──────────────────────────────────────────────

export interface CharacterLoreBlockInput {
  characters: ReadonlyArray<{ id: string; name: string }>;
  packed: PackedLore;
}

/**
 * Render the `<character_lore>` block per docs §4. One section per
 * character. If entries were dropped due to budget, emit a sentinel
 * showing the top dropped IDs so the agent knows context is incomplete.
 *
 * Per docs §12 visibility rules: NEVER silent on truncation.
 */
export function buildCharacterLoreBlock(input: CharacterLoreBlockInput): string {
  const sections: string[] = ["<character_lore>"];

  for (const ch of input.characters) {
    const kept = input.packed.byCharacter.get(ch.id) ?? [];
    const dropped = input.packed.droppedByCharacter.get(ch.id) ?? [];

    sections.push(`Character: ${ch.name} (id: ${ch.id})`);
    if (kept.length === 0 && dropped.length === 0) {
      sections.push("  (no lore entries attached to this character)");
    } else {
      for (const entry of kept) {
        sections.push(`  - ${formatDescription(entry.content)}`);
      }
      if (dropped.length > 0) {
        const topDroppedIds = dropped.slice(0, 3).map((e) => e.id).join(", ");
        sections.push(
          `  [${dropped.length} entries omitted due to budget; top dropped: ${topDroppedIds}]`,
        );
      }
    }
    sections.push("");
  }

  sections.push("</character_lore>");
  return sections.join("\n");
}

