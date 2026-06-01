/**
 * Relationship Tracker — deterministic folds over the durable event ledger.
 *
 * Every metric exposed by the Relationship Tracker is a pure function of the
 * stored `CharacterRelationship` (tier 1 hot events + tier 2 session summaries
 * + tier 3 lifetime aggregate + preserved milestone events). The agent never
 * computes numbers; the fold does, here.
 *
 * See docs/agents/relationship-tracker.md §4 and §13 for the contracts these
 * functions implement.
 */

import type {
  CharacterRelationship,
  RelationshipEventRecord,
  RelationshipLifetimeAggregate,
  RelationshipSessionSummary,
} from "../../contracts/types/character";

// ──────────────────────────────────────────────
// Tunable constants — starting points, expected to be config-driven later.
// ──────────────────────────────────────────────

export const MAGNITUDE_WEIGHT = { minor: 1, moderate: 4, major: 16 } as const;

/** Soft decay half-life ≈ 14 sessions (e^(-14/20) ≈ 0.5). */
const AFFINITY_DECAY_SESSIONS = 20;

/** Scaling so a moderate-positive event lands ~+4 affinity at zero age. */
const AFFINITY_SCALE = 1;

/** Trust grows slowly with major positives, collapses fast on major negatives. */
const TRUST_POSITIVE_WEIGHT = 10;
const TRUST_NEGATIVE_WEIGHT = 25;

/** Familiarity curve constants. */
const FAMILIARITY_COUNT_WEIGHT = 4;
const FAMILIARITY_MODES_WEIGHT = 3;
const FAMILIARITY_NEGLECT_DECAY = 0.5;

const DEFAULT_RECENT_VALENCE_WINDOW = 20;

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

type Magnitude = "minor" | "moderate" | "major";
type Valence = "positive" | "negative" | "neutral";
type Initiator = "persona" | "character" | "mutual" | "external";

const EMPTY_TALLY = (): Record<Magnitude, Record<Valence, number>> => ({
  minor: { positive: 0, negative: 0, neutral: 0 },
  moderate: { positive: 0, negative: 0, neutral: 0 },
  major: { positive: 0, negative: 0, neutral: 0 },
});

const EMPTY_INITIATOR_TALLY = (): Record<Initiator, number> => ({
  persona: 0,
  character: 0,
  mutual: 0,
  external: 0,
});

function valenceSign(v: Valence): number {
  if (v === "positive") return 1;
  if (v === "negative") return -1;
  return 0;
}

function addTallies(
  a: Record<Magnitude, Record<Valence, number>>,
  b: Record<Magnitude, Record<Valence, number>>,
): Record<Magnitude, Record<Valence, number>> {
  return {
    minor: {
      positive: a.minor.positive + b.minor.positive,
      negative: a.minor.negative + b.minor.negative,
      neutral: a.minor.neutral + b.minor.neutral,
    },
    moderate: {
      positive: a.moderate.positive + b.moderate.positive,
      negative: a.moderate.negative + b.moderate.negative,
      neutral: a.moderate.neutral + b.moderate.neutral,
    },
    major: {
      positive: a.major.positive + b.major.positive,
      negative: a.major.negative + b.major.negative,
      neutral: a.major.neutral + b.major.neutral,
    },
  };
}

function addInitiatorTallies(
  a: Record<Initiator, number>,
  b: Record<Initiator, number>,
): Record<Initiator, number> {
  return {
    persona: a.persona + b.persona,
    character: a.character + b.character,
    mutual: a.mutual + b.mutual,
    external: a.external + b.external,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Compute one event's tally contribution from a tier-1 event.
 */
function eventToTally(event: RelationshipEventRecord): Record<Magnitude, Record<Valence, number>> {
  const tally = EMPTY_TALLY();
  tally[event.magnitude][event.valence] = 1;
  return tally;
}

/**
 * Combine tier-1 events + tier-2 summaries + tier-3 lifetime + preserved
 * events into one full magnitude×valence tally. Lossless across all tiers.
 *
 * preservedEvents are milestone-triggering events that bypass rollup. They
 * still contribute to dimensional metrics — excluding them would cause a
 * discontinuous drop at the moment of preservation.
 */
function combinedTally(rel: CharacterRelationship): Record<Magnitude, Record<Valence, number>> {
  let total = EMPTY_TALLY();
  for (const e of allEventRecords(rel)) total = addTallies(total, eventToTally(e));
  for (const s of rel.sessionSummaries) total = addTallies(total, s.tally);
  total = addTallies(total, rel.lifetime.tally);
  return total;
}

/**
 * Combine initiator counts across tiers, including preserved events.
 */
function combinedInitiatorTally(rel: CharacterRelationship): Record<Initiator, number> {
  const total = EMPTY_INITIATOR_TALLY();
  for (const e of allEventRecords(rel)) total[e.initiator] += 1;
  for (const s of rel.sessionSummaries) {
    total.persona += s.initiatorTally.persona;
    total.character += s.initiatorTally.character;
    total.mutual += s.initiatorTally.mutual;
    total.external += s.initiatorTally.external;
  }
  return addInitiatorTallies(total, rel.lifetime.initiatorTally);
}

/**
 * Sort events ascending by `at` timestamp, defensively. Caller-supplied
 * events should already be in order, but the fold doesn't trust that.
 */
function sortedEvents(events: readonly RelationshipEventRecord[]): RelationshipEventRecord[] {
  return [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/**
 * Canonical iterator for all individual event records on a relationship.
 * Returns tier-1 hot events plus preserved milestone events. Excludes
 * tier-2 session summaries and the tier-3 lifetime aggregate — those
 * surface as tally-level data only.
 *
 * **Use this in every per-event loop in the fold module.** The bug class
 * "per-event loop read only rel.events and missed preservedEvents" has been
 * caught three times in review (Phase 2/3/5 fixes). The recurrence is a
 * structural signal: too many loops, no canonical accessor. This helper
 * is the canonical accessor — any new per-event metric should call it.
 *
 * Returns a fresh array each call. Use `sortedEvents(allEventRecords(rel))`
 * when chronological order matters.
 */
function allEventRecords(rel: CharacterRelationship): RelationshipEventRecord[] {
  return [...rel.events, ...rel.preservedEvents];
}

// ──────────────────────────────────────────────
// Dimensions
// ──────────────────────────────────────────────

/**
 * Time-decayed weighted sum of valence × magnitude. Tier-1 events contribute
 * with per-event decay; tier-2 summaries contribute via their `netValence`
 * (themselves already aggregated, with decay applied at rollup time); tier-3
 * lifetime contributes a small floor proportional to lifetime tally.
 *
 * Returns clamped to [-100, +100].
 */
export function deriveAffinity(rel: CharacterRelationship, currentSession: number): number {
  // currentSession reserved for richer per-event session-age decay once
  // the writeback layer stamps session indexes on events.
  void currentSession;
  let raw = 0;

  // Tier 1 + preserved: per-event with decay. Preserved events are part of
  // the durable ledger and contribute to dimensions exactly like tier-1
  // events (the only difference is they bypass rollup, not folding).
  for (const e of allEventRecords(rel)) {
    const sign = valenceSign(e.valence);
    if (sign === 0) continue;
    const weight = MAGNITUDE_WEIGHT[e.magnitude];
    // Session-age approximation from chatId would require a session index;
    // for now, treat all tier-1 events as recent (age = 0).
    raw += sign * weight * AFFINITY_SCALE;
  }

  // Tier 2: each summary's netValence is its weighted sum at session age.
  // Apply additional decay based on how many sessions ago it was.
  // Newer summaries are at the end of the array; older at the start.
  for (let i = 0; i < rel.sessionSummaries.length; i += 1) {
    const s = rel.sessionSummaries[i];
    const positionFromEnd = rel.sessionSummaries.length - 1 - i;
    const ageDecay = Math.exp(-positionFromEnd / AFFINITY_DECAY_SESSIONS);
    raw += s.netValence * AFFINITY_SCALE * ageDecay;
  }

  // Tier 3: a small persistent floor from lifetime aggregate. Treated as
  // very-decayed history — present but won't dominate recent state.
  const lifetimeFloor = lifetimeNetValence(rel.lifetime) * AFFINITY_SCALE * 0.1;
  raw += lifetimeFloor;

  return clamp(Math.round(raw), -100, 100);
}

function lifetimeNetValence(lifetime: RelationshipLifetimeAggregate): number {
  let raw = 0;
  for (const mag of ["minor", "moderate", "major"] as Magnitude[]) {
    const w = MAGNITUDE_WEIGHT[mag];
    raw += w * lifetime.tally[mag].positive;
    raw -= w * lifetime.tally[mag].negative;
  }
  return raw;
}

/**
 * Cumulative ratio of major positive vs major negative events.
 * Asymmetric — trust collapses faster than it builds.
 */
export function deriveTrust(rel: CharacterRelationship): number {
  const tally = combinedTally(rel);
  const positivesMajor = tally.major.positive;
  const negativesMajor = tally.major.negative;
  const raw = positivesMajor * TRUST_POSITIVE_WEIGHT - negativesMajor * TRUST_NEGATIVE_WEIGHT;
  return clamp(Math.round(raw), -100, 100);
}

/**
 * Non-monotonic familiarity. Grows fast initially (sqrt curve), plateaus,
 * decays with neglect. Reads tier-1 individual events for distinct-modes
 * computation; uses combined counts for the volume term.
 */
export function deriveFamiliarity(
  rel: CharacterRelationship,
  currentTurn: number,
): number {
  const tally = combinedTally(rel);
  let totalCount = 0;
  for (const mag of ["minor", "moderate", "major"] as Magnitude[]) {
    for (const val of ["positive", "negative", "neutral"] as Valence[]) {
      totalCount += tally[mag][val];
    }
  }

  // Distinct magnitude×valence combinations from tier-1 (high-res).
  // Tier-2/3 distinct-count is approximated by which combos have nonzero count.
  const distinctModes = new Set<string>();
  for (const e of rel.events) {
    distinctModes.add(`${e.magnitude}-${e.valence}`);
  }
  for (const mag of ["minor", "moderate", "major"] as Magnitude[]) {
    for (const val of ["positive", "negative", "neutral"] as Valence[]) {
      if (tally[mag][val] > 0) distinctModes.add(`${mag}-${val}`);
    }
  }

  // Turns since last event drives decay. Guard against Infinity (returned by
  // turnsSinceLastEvent when no tier-1 events exist) — propagating it through
  // arithmetic collapses familiarity to 0 even for relationships with rich
  // tier-2 history. The decay term is computed only when turnsSince is finite.
  const turnsSince = turnsSinceLastEvent(rel, currentTurn);
  const decay = totalCount > 0 && Number.isFinite(turnsSince)
    ? turnsSince * FAMILIARITY_NEGLECT_DECAY
    : 0;

  const raw =
    Math.sqrt(totalCount) * FAMILIARITY_COUNT_WEIGHT +
    distinctModes.size * FAMILIARITY_MODES_WEIGHT -
    decay;

  return clamp(Math.round(raw), 0, 100);
}

// ──────────────────────────────────────────────
// Composition metrics
// ──────────────────────────────────────────────

export function magnitudeTally(
  rel: CharacterRelationship,
): { minor: number; moderate: number; major: number } {
  const tally = combinedTally(rel);
  return {
    minor: tally.minor.positive + tally.minor.negative + tally.minor.neutral,
    moderate: tally.moderate.positive + tally.moderate.negative + tally.moderate.neutral,
    major: tally.major.positive + tally.major.negative + tally.major.neutral,
  };
}

export function valenceTally(
  rel: CharacterRelationship,
): { positive: number; negative: number; neutral: number } {
  const tally = combinedTally(rel);
  return {
    positive: tally.minor.positive + tally.moderate.positive + tally.major.positive,
    negative: tally.minor.negative + tally.moderate.negative + tally.major.negative,
    neutral: tally.minor.neutral + tally.moderate.neutral + tally.major.neutral,
  };
}

/**
 * Gottman-style positive:negative ratio. Returns +Infinity when there are
 * positives but no negatives; returns 0 when there are no positives.
 */
export function posNegRatio(rel: CharacterRelationship): number {
  const v = valenceTally(rel);
  if (v.negative === 0) return v.positive > 0 ? Number.POSITIVE_INFINITY : 0;
  return v.positive / v.negative;
}

export function dominantMode(
  rel: CharacterRelationship,
): { magnitude: Magnitude; valence: Valence; count: number } | null {
  const tally = combinedTally(rel);
  let best: { magnitude: Magnitude; valence: Valence; count: number } | null = null;
  for (const mag of ["minor", "moderate", "major"] as Magnitude[]) {
    for (const val of ["positive", "negative", "neutral"] as Valence[]) {
      const count = tally[mag][val];
      if (count > 0 && (best === null || count > best.count)) {
        best = { magnitude: mag, valence: val, count };
      }
    }
  }
  return best;
}

export function distinctCombinations(rel: CharacterRelationship): number {
  const tally = combinedTally(rel);
  let count = 0;
  for (const mag of ["minor", "moderate", "major"] as Magnitude[]) {
    for (const val of ["positive", "negative", "neutral"] as Valence[]) {
      if (tally[mag][val] > 0) count += 1;
    }
  }
  return count;
}

// ──────────────────────────────────────────────
// Trajectory metrics
// ──────────────────────────────────────────────

/**
 * Mean valence of the last N events from tier 1 plus preserved events.
 * Returns 0 if no events.
 *
 * Per-event loops in this module must include `preservedEvents` to keep
 * dimensional metrics consistent across the rollup boundary (an event
 * that triggers a milestone latch moves to preservedEvents but should
 * still influence recency-based metrics).
 */
export function recentValence(
  rel: CharacterRelationship,
  windowSize: number = DEFAULT_RECENT_VALENCE_WINDOW,
): number {
  const events = sortedEvents(allEventRecords(rel));
  const slice = events.slice(-windowSize);
  if (slice.length === 0) return 0;
  let sum = 0;
  for (const e of slice) sum += valenceSign(e.valence) * MAGNITUDE_WEIGHT[e.magnitude];
  return sum / slice.length;
}

/**
 * Mean valence across all stored events (tier 1 + tier 2 net valences + tier 3).
 */
export function lifetimeValence(rel: CharacterRelationship): number {
  let totalWeighted = 0;
  let totalCount = 0;

  for (const e of allEventRecords(rel)) {
    totalWeighted += valenceSign(e.valence) * MAGNITUDE_WEIGHT[e.magnitude];
    totalCount += 1;
  }
  for (const s of rel.sessionSummaries) {
    totalWeighted += s.netValence;
    totalCount += s.eventCount;
  }
  totalWeighted += lifetimeNetValence(rel.lifetime);
  totalCount += rel.lifetime.totalEventCount;

  if (totalCount === 0) return 0;
  return totalWeighted / totalCount;
}

/**
 * The trailing run of same-valence events from tier 1 + preserved events,
 * ending at the latest. Returns null if no events.
 */
export function currentStreak(
  rel: CharacterRelationship,
): { valence: Valence; length: number } | null {
  const events = sortedEvents(allEventRecords(rel));
  if (events.length === 0) return null;
  const last = events[events.length - 1];
  let length = 1;
  for (let i = events.length - 2; i >= 0; i -= 1) {
    if (events[i].valence === last.valence) length += 1;
    else break;
  }
  return { valence: last.valence, length };
}

/**
 * Longest same-valence streak across tier 1 + preserved events. Tier 2
 * streaks would require per-event order which sessionSummaries doesn't
 * preserve; documented limitation.
 */
export function longestStreak(rel: CharacterRelationship): number {
  const events = sortedEvents(allEventRecords(rel));
  if (events.length === 0) return 0;
  let longest = 1;
  let current = 1;
  for (let i = 1; i < events.length; i += 1) {
    if (events[i].valence === events[i - 1].valence) {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 1;
    }
  }
  return longest;
}

// ──────────────────────────────────────────────
// Time metrics
// ──────────────────────────────────────────────

/**
 * Approximate the number of turns since the last tier-1 event using
 * elapsed wall-clock time. We don't stamp turn numbers onto events yet,
 * but every event carries an ISO `at` timestamp; the gap between
 * `now` and that timestamp, divided by an assumed average turn duration,
 * is a usable proxy until per-event turn anchoring lands.
 *
 * Returns 0 when an event was emitted in the very recent past (< 1 avg
 * turn ago) and Number.POSITIVE_INFINITY when no tier-1 event exists.
 *
 * `currentTurn` is accepted for API symmetry but not consumed in the
 * approximation — the timestamp-based math is more accurate today than
 * an integer turn count whose semantics aren't yet defined at write time.
 * `now` defaults to `Date.now()` but accepts an explicit value so tests
 * and other deterministic callers can avoid wall-clock dependence.
 */
const APPROX_TURN_DURATION_MS = 60_000;

export function turnsSinceLastEvent(
  rel: CharacterRelationship,
  currentTurn: number,
  now: number = Date.now(),
): number {
  void currentTurn;
  if (rel.events.length === 0) return Number.POSITIVE_INFINITY;

  const events = sortedEvents(rel.events);
  const lastEvent = events[events.length - 1];
  if (!lastEvent) return Number.POSITIVE_INFINITY;

  const elapsedMs = now - Date.parse(lastEvent.at);
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return Math.floor(elapsedMs / APPROX_TURN_DURATION_MS);
}

/**
 * Sessions since the last event (counted by sessionSummaries length proxy).
 * Hydration may pass richer session context if available.
 */
export function sessionsSinceLastEvent(
  rel: CharacterRelationship,
  currentSession: number,
): number {
  if (rel.events.length > 0) return 0;
  if (rel.sessionSummaries.length === 0) return Number.POSITIVE_INFINITY;
  // Without explicit session-index data, infer from the position of the
  // most recent summary. The writeback layer is responsible for keeping
  // sessionSummaries ordered ascending by session start.
  void currentSession;
  return 1; // at least one session has passed since the last hot event
}

// ──────────────────────────────────────────────
// Milestone latches
// ──────────────────────────────────────────────

export const MILESTONE_DEFINITIONS = {
  has_been_seriously_wronged: (e: RelationshipEventRecord) =>
    e.magnitude === "major" && e.valence === "negative",
  has_been_seriously_helped: (e: RelationshipEventRecord) =>
    e.magnitude === "major" && e.valence === "positive",
  has_been_vulnerable_with: (e: RelationshipEventRecord) =>
    e.magnitude === "major" && e.valence === "positive" && e.initiator === "character",
  has_seen_persona_at_worst: (e: RelationshipEventRecord) =>
    e.magnitude === "major" && e.valence === "negative" && e.initiator === "persona",
  has_shared_silence: (e: RelationshipEventRecord) =>
    e.valence === "neutral" && e.initiator === "mutual",
} as const;

export type MilestoneId = keyof typeof MILESTONE_DEFINITIONS;

/**
 * Returns the set of milestones currently latched. A milestone is considered
 * latched if either (a) it's recorded in `lifetime.latchedMilestones` (the
 * durable record) or (b) any current tier-1 or preserved event qualifies.
 *
 * The writeback layer is responsible for promoting newly-qualifying events
 * to `lifetime.latchedMilestones`; the fold only reads.
 */
export function checkMilestones(rel: CharacterRelationship): Record<MilestoneId, boolean> {
  const result = {
    has_been_seriously_wronged: false,
    has_been_seriously_helped: false,
    has_been_vulnerable_with: false,
    has_seen_persona_at_worst: false,
    has_shared_silence: false,
  };

  // Use the canonical accessor — covers tier-1 + preservedEvents in one
  // place, consistent with every other per-event metric in this module.
  const allEvents = allEventRecords(rel);
  for (const id of Object.keys(result) as MilestoneId[]) {
    if (rel.lifetime.latchedMilestones[id] !== undefined) {
      result[id] = true;
      continue;
    }
    const check = MILESTONE_DEFINITIONS[id];
    if (allEvents.some(check)) {
      result[id] = true;
    }
  }

  return result;
}

// ──────────────────────────────────────────────
// Initiator metrics
// ──────────────────────────────────────────────

export function initiatorTally(rel: CharacterRelationship): Record<Initiator, number> {
  return combinedInitiatorTally(rel);
}

/**
 * character-initiated / max(1, persona-initiated). Higher = character is
 * doing more of the reaching.
 */
export function pursuitRatio(rel: CharacterRelationship): number {
  const tally = combinedInitiatorTally(rel);
  return tally.character / Math.max(1, tally.persona);
}

// ──────────────────────────────────────────────
// Derived status
// ──────────────────────────────────────────────

export type StatusLabel =
  | "stranger"
  | "acquaintance"
  | "friend"
  | "close"
  | "rival"
  | "estranged"
  | "complicated";

/**
 * Categorical label computed from dimensions and time. Purely a UI affordance;
 * downstream consumers that need precise values read the dimensions directly.
 */
export function deriveStatus(
  rel: CharacterRelationship,
  context: { currentTurn: number; currentSession: number },
): StatusLabel {
  const aff = deriveAffinity(rel, context.currentSession);
  const trust = deriveTrust(rel);
  const fam = deriveFamiliarity(rel, context.currentTurn);
  const turnsSince = turnsSinceLastEvent(rel, context.currentTurn);

  // Estrangement check first — overrides other labels.
  if (fam > 20 && turnsSince > 50 && recentValence(rel, 3) < 0) return "estranged";

  if (fam < 10) return "stranger";
  if (fam < 30 && Math.abs(aff) < 20) return "acquaintance";

  if (aff > 60 && trust > 40 && fam > 50) return "close";
  if (aff > 30 && trust > 20) return "friend";
  // Doc §4 defines rival as "affinity < -20 AND respect > 30". Respect is
  // deferred to v2 (see §4 deferred dimensions). For v1 we substitute
  // negative trust — a deeply distrusted figure with negative affinity is
  // the closest available stand-in. When respect lands, this condition
  // should be reconciled with the spec; see Open Item in docs §14.
  if (aff < -20 && trust < -10) return "rival";

  return "complicated";
}

// ──────────────────────────────────────────────
// Master fold
// ──────────────────────────────────────────────

export interface RelationshipMetrics {
  affinity: number;
  trust: number;
  familiarity: number;
  magnitudeTally: { minor: number; moderate: number; major: number };
  valenceTally: { positive: number; negative: number; neutral: number };
  posNegRatio: number;
  dominantMode: { magnitude: Magnitude; valence: Valence; count: number } | null;
  distinctCombinations: number;
  recentValence: number;
  lifetimeValence: number;
  currentStreak: { valence: Valence; length: number } | null;
  longestStreak: number;
  turnsSinceLastEvent: number;
  sessionsSinceLastEvent: number;
  milestones: Record<MilestoneId, boolean>;
  initiatorTally: Record<Initiator, number>;
  pursuitRatio: number;
  status: StatusLabel;
}

/**
 * Single entry point that computes every metric the agent and downstream
 * consumers need. Pure function; takes the durable relationship and a
 * context object, returns a flat structure.
 */
export function deriveRelationshipMetrics(
  rel: CharacterRelationship,
  context: {
    currentTurn: number;
    currentSession: number;
    recentValenceWindow?: number;
  },
): RelationshipMetrics {
  return {
    affinity: deriveAffinity(rel, context.currentSession),
    trust: deriveTrust(rel),
    familiarity: deriveFamiliarity(rel, context.currentTurn),
    magnitudeTally: magnitudeTally(rel),
    valenceTally: valenceTally(rel),
    posNegRatio: posNegRatio(rel),
    dominantMode: dominantMode(rel),
    distinctCombinations: distinctCombinations(rel),
    recentValence: recentValence(rel, context.recentValenceWindow),
    lifetimeValence: lifetimeValence(rel),
    currentStreak: currentStreak(rel),
    longestStreak: longestStreak(rel),
    turnsSinceLastEvent: turnsSinceLastEvent(rel, context.currentTurn),
    sessionsSinceLastEvent: sessionsSinceLastEvent(rel, context.currentSession),
    milestones: checkMilestones(rel),
    initiatorTally: initiatorTally(rel),
    pursuitRatio: pursuitRatio(rel),
    status: deriveStatus(rel, context),
  };
}

// Re-export for tests and downstream consumers that don't need the full doc dep.
export type { RelationshipEventRecord, RelationshipSessionSummary, RelationshipLifetimeAggregate };
