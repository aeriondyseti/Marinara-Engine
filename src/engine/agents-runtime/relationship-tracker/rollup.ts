/**
 * Relationship Tracker — tier transitions (rollup).
 *
 * Compresses tier-1 hot events into tier-2 per-session summaries, then merges
 * aging summaries into the tier-3 lifetime aggregate. Milestone-triggering
 * events bypass rollup permanently and move to `preservedEvents`.
 *
 * Triggered by the writeback layer at chat session start for the previous
 * session — atomic, idempotent, never mid-chat.
 */

import type {
  RelationshipEventRecord,
  RelationshipLifetimeAggregate,
  RelationshipSessionSummary,
} from "../../contracts/types/character";
import { MAGNITUDE_WEIGHT, MILESTONE_DEFINITIONS, type MilestoneId } from "./fold";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

type Magnitude = "minor" | "moderate" | "major";
type Valence = "positive" | "negative" | "neutral";

function valenceSign(v: Valence): number {
  if (v === "positive") return 1;
  if (v === "negative") return -1;
  return 0;
}

function emptyMagValTally(): RelationshipSessionSummary["tally"] {
  return {
    minor: { positive: 0, negative: 0, neutral: 0 },
    moderate: { positive: 0, negative: 0, neutral: 0 },
    major: { positive: 0, negative: 0, neutral: 0 },
  };
}

function emptyInitiatorTally(): RelationshipSessionSummary["initiatorTally"] {
  return { persona: 0, character: 0, mutual: 0, external: 0 };
}

function magnitudeRank(m: Magnitude): number {
  if (m === "major") return 3;
  if (m === "moderate") return 2;
  return 1;
}

/**
 * Pick the earlier of two ISO-or-empty timestamps. Empty string is treated
 * as "no value", not as "smaller than any real timestamp" — lexicographic
 * comparison would otherwise corrupt firstEventAt when an empty-session
 * summary lands on a populated lifetime.
 */
function pickEarlierFirstEvent(a: string, b: string): string {
  if (a === "") return b;
  if (b === "") return a;
  return a < b ? a : b;
}

// ──────────────────────────────────────────────
// Tier 1 → Tier 2: per-session summary
// ──────────────────────────────────────────────

/**
 * Compress a session's events into a SessionSummary. Counts are lossless;
 * descriptions are dropped except for the top `highlightsKept` by magnitude.
 *
 * The caller (writeback layer) is responsible for filtering out events that
 * trigger a milestone — those are preserved separately via
 * `findMilestoneTriggers` and never reach this function.
 *
 * Pure; idempotent given the same input.
 */
export function rollSessionToSummary(
  sessionId: string,
  events: RelationshipEventRecord[],
  highlightsKept: number = 2,
): RelationshipSessionSummary {
  const tally = emptyMagValTally();
  const initiatorTally = emptyInitiatorTally();
  let netValence = 0;
  let startedAt = "";
  let endedAt = "";

  for (const e of events) {
    tally[e.magnitude][e.valence] += 1;
    initiatorTally[e.initiator] += 1;
    netValence += valenceSign(e.valence) * MAGNITUDE_WEIGHT[e.magnitude];
    // Skip empty-string `at` values when computing min/max — lexicographic
    // comparison would treat '' as the smallest possible string, corrupting
    // startedAt for any subsequent real timestamp.
    if (e.at !== "") {
      if (startedAt === "" || e.at < startedAt) startedAt = e.at;
      if (endedAt === "" || e.at > endedAt) endedAt = e.at;
    }
  }

  // Pick highlights: highest magnitude first, ties broken by most recent.
  // Comparator returns 0 for equals to preserve sort stability — required
  // for deterministic output when two events share an identical `at`.
  const highlights = [...events]
    .sort((a, b) => {
      const rankDiff = magnitudeRank(b.magnitude) - magnitudeRank(a.magnitude);
      if (rankDiff !== 0) return rankDiff;
      if (a.at === b.at) return 0;
      return a.at < b.at ? 1 : -1; // descending by time
    })
    .slice(0, Math.max(0, highlightsKept))
    .map((e) => e.description);

  return {
    sessionId,
    startedAt,
    endedAt,
    eventCount: events.length,
    tally,
    initiatorTally,
    highlights,
    netValence,
  };
}

// ──────────────────────────────────────────────
// Tier 2 → Tier 3: merge into lifetime aggregate
// ──────────────────────────────────────────────

/**
 * Merge a session summary into the lifetime aggregate. Tallies sum; the
 * lifetime's `firstEventAt` updates only if the summary's earliest event
 * predates it. `latchedMilestones` are not touched here — milestones are
 * latched separately at preservation time via `findMilestoneTriggers`.
 *
 * Pure; idempotent given the same input.
 */
export function rollSummaryToLifetime(
  summary: RelationshipSessionSummary,
  lifetime: RelationshipLifetimeAggregate,
): RelationshipLifetimeAggregate {
  const merged: RelationshipLifetimeAggregate = {
    totalEventCount: lifetime.totalEventCount + summary.eventCount,
    tally: {
      minor: {
        positive: lifetime.tally.minor.positive + summary.tally.minor.positive,
        negative: lifetime.tally.minor.negative + summary.tally.minor.negative,
        neutral: lifetime.tally.minor.neutral + summary.tally.minor.neutral,
      },
      moderate: {
        positive: lifetime.tally.moderate.positive + summary.tally.moderate.positive,
        negative: lifetime.tally.moderate.negative + summary.tally.moderate.negative,
        neutral: lifetime.tally.moderate.neutral + summary.tally.moderate.neutral,
      },
      major: {
        positive: lifetime.tally.major.positive + summary.tally.major.positive,
        negative: lifetime.tally.major.negative + summary.tally.major.negative,
        neutral: lifetime.tally.major.neutral + summary.tally.major.neutral,
      },
    },
    initiatorTally: {
      persona: lifetime.initiatorTally.persona + summary.initiatorTally.persona,
      character: lifetime.initiatorTally.character + summary.initiatorTally.character,
      mutual: lifetime.initiatorTally.mutual + summary.initiatorTally.mutual,
      external: lifetime.initiatorTally.external + summary.initiatorTally.external,
    },
    firstEventAt: pickEarlierFirstEvent(lifetime.firstEventAt, summary.startedAt),
    // Deep-copy nested latch records so callers can't mutate them and reach
    // back into the input `lifetime` object — pure-function contract.
    latchedMilestones: Object.fromEntries(
      Object.entries(lifetime.latchedMilestones).map(([k, v]) => [k, { ...v }]),
    ),
  };
  return merged;
}

// ──────────────────────────────────────────────
// Milestone preservation
// ──────────────────────────────────────────────

/**
 * Single latched-milestone record. Mirrors the value shape in
 * `RelationshipLifetimeAggregate.latchedMilestones` but constrained to a
 * tight key type at the rollup boundary so typos in milestone IDs fail
 * compilation rather than silently passing through.
 */
export type LatchedMilestoneRecord = {
  triggeredAt: string;
  sessionId: string;
  description: string;
};

export interface MilestonePreservationResult {
  /** Events that qualified for a not-yet-latched milestone — caller appends
   *  to `preservedEvents`. Events appear in chronological order. */
  toPreserve: RelationshipEventRecord[];
  /** The complement: events to roll into the session summary. Pre-computed
   *  to avoid the reference-equality pitfall of `events.filter(e => !toPreserve.includes(e))`,
   *  which silently fails after a JSON round-trip from storage. */
  toSummarize: RelationshipEventRecord[];
  /** Latches to merge into `lifetime.latchedMilestones`. Tighter typing than
   *  the durable storage shape — only valid MilestoneId keys compile. */
  newLatches: Partial<Record<MilestoneId, LatchedMilestoneRecord>>;
}

/**
 * Identify events that should bypass rollup because they trigger an
 * unlatched milestone. The caller appends `toPreserve` to the relationship's
 * `preservedEvents` array, passes `toSummarize` to `rollSessionToSummary`,
 * and merges `newLatches` into the lifetime's `latchedMilestones`.
 *
 * Only first-of-its-kind triggers per milestone — if a milestone is already
 * latched in `alreadyLatched`, subsequent qualifying events are NOT preserved
 * (they roll into the session summary normally). This preserves the
 * "first betrayal" / "first vulnerability" semantics.
 *
 * Events are sorted chronologically by `at` before milestone scanning so that
 * "first qualifying event" is robust to input ordering — callers may pass
 * events in any order without breaking the latch semantics.
 *
 * Pure; idempotent given the same input.
 */
export function findMilestoneTriggers(
  events: RelationshipEventRecord[],
  alreadyLatched: RelationshipLifetimeAggregate["latchedMilestones"],
): MilestonePreservationResult {
  // Sort defensively — caller-supplied events should already be chronological,
  // but the fold doesn't trust that.
  const sortedByTime = [...events].sort((a, b) => {
    if (a.at === b.at) return 0;
    return a.at < b.at ? -1 : 1;
  });

  const newLatches: Partial<Record<MilestoneId, LatchedMilestoneRecord>> = {};
  const claimedEvents = new Set<RelationshipEventRecord>();

  for (const id of Object.keys(MILESTONE_DEFINITIONS) as MilestoneId[]) {
    if (alreadyLatched[id] !== undefined) continue;
    const predicate = MILESTONE_DEFINITIONS[id];

    // First qualifying event by chronological order triggers the latch.
    // Multiple milestones may share the same triggering event — we preserve
    // it once (Set dedup by reference) and latch each milestone independently.
    for (const ev of sortedByTime) {
      if (!predicate(ev)) continue;
      newLatches[id] = {
        triggeredAt: ev.at,
        sessionId: ev.chatId,
        description: ev.description,
      };
      claimedEvents.add(ev);
      break;
    }
  }

  // toPreserve in chronological order (Set is keyed by event reference, and
  // we iterate sortedByTime to build it).
  const toPreserve: RelationshipEventRecord[] = [];
  const toSummarize: RelationshipEventRecord[] = [];
  for (const ev of sortedByTime) {
    if (claimedEvents.has(ev)) {
      toPreserve.push(ev);
    } else {
      toSummarize.push(ev);
    }
  }

  return { toPreserve, toSummarize, newLatches };
}

// ──────────────────────────────────────────────
// Tier-2 collapse check
// ──────────────────────────────────────────────

/**
 * True if the oldest session summary should be collapsed into lifetime aggregate
 * to keep tier-2 bounded by `sessionHistoryWindow`. The caller uses this to
 * decide whether to invoke `rollSummaryToLifetime` after appending a new summary.
 */
export function shouldCollapseOldestSummary(
  sessionSummaries: RelationshipSessionSummary[],
  sessionHistoryWindow: number,
): boolean {
  return sessionSummaries.length > sessionHistoryWindow;
}
