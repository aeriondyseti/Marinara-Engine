export type SecretPlotDirection = { direction: string; fulfilled?: boolean };

export function normalizeSecretPlotSceneDirections(raw: unknown): SecretPlotDirection[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry === "string") {
      const direction = entry.trim();
      return direction ? [{ direction, fulfilled: false }] : [];
    }
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as { direction?: unknown; fulfilled?: unknown };
    if (typeof candidate.direction !== "string") return [];
    const direction = candidate.direction.trim();
    return direction ? [{ direction, fulfilled: candidate.fulfilled === true }] : [];
  });
}

export function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry !== "string") return [];
    const text = entry.trim();
    return text ? [text] : [];
  });
}

// ──────────────────────────────────────────────
// Relationship Tracker normalization
//
// Validates and coerces the raw `relationship_event` agent output into a
// list of `RelationshipEventProposal`s ready for the writeback layer. See
// docs/agents/relationship-tracker.md §6 (Output Schema) and §11 (Failure
// Modes) for the contract this implements.
// ──────────────────────────────────────────────

import type {
  RelationshipConfidence,
  RelationshipEventProposal,
  RelationshipInitiator,
  RelationshipMagnitude,
  RelationshipValence,
} from "../contracts/types/agent";

/** Why a single raw entry was dropped during normalization. Telemetry-only. */
export interface RelationshipEventDropReason {
  reason:
    | "bad_root_type"
    | "not_object"
    | "missing_characterId"
    | "missing_personaId"
    | "characterId_not_present"
    | "personaId_mismatch"
    | "bad_magnitude"
    | "bad_valence"
    | "bad_initiator"
    | "bad_confidence"
    | "empty_description"
    | "duplicate_character_lower_confidence"
    | "duplicate_character_tie_broken";
  raw: unknown;
}

export interface RelationshipEventNormalizationResult {
  events: RelationshipEventProposal[];
  /** Reasons individual raw entries were dropped — for debug logging. */
  dropped: RelationshipEventDropReason[];
  /**
   * Events that survived validation but whose description begins with a
   * first-person actor ("I ..."), suggesting a Rule 4 violation (description
   * should describe the OTHER party's action, from the subject's POV). Not
   * dropped — passed through with telemetry.
   */
  flaggedFirstPerson: RelationshipEventProposal[];
}

const MAGNITUDE_SYNONYMS: Record<string, RelationshipMagnitude> = {
  minor: "minor",
  small: "minor",
  light: "minor",
  moderate: "moderate",
  medium: "moderate",
  mid: "moderate",
  major: "major",
  large: "major",
  big: "major",
  severe: "major",
};

const VALENCE_SYNONYMS: Record<string, RelationshipValence> = {
  positive: "positive",
  good: "positive",
  pos: "positive",
  "+": "positive",
  negative: "negative",
  bad: "negative",
  neg: "negative",
  "-": "negative",
  neutral: "neutral",
  "0": "neutral",
  // Deliberately NOT mapped: "mixed", "none" — these are semantically
  // ambiguous (ambivalence vs. absence vs. genuine neutrality) and silently
  // coercing them to "neutral" loses the prompt-tuning signal that the model
  // is producing unexpected outputs. Let them fail validation with
  // `bad_valence` instead.
};

const INITIATOR_SYNONYMS: Record<string, RelationshipInitiator> = {
  persona: "persona",
  player: "persona",
  user: "persona",
  character: "character",
  npc: "character",
  mutual: "mutual",
  both: "mutual",
  shared: "mutual",
  external: "external",
  other: "external",
  environment: "external",
  // Deliberately NOT mapped: "self" — ambiguous between subject-character
  // and persona-acting-on-its-own. Let it fail validation.
};

const CONFIDENCE_SYNONYMS: Record<string, RelationshipConfidence> = {
  high: "high",
  certain: "high",
  sure: "high",
  medium: "medium",
  med: "medium",
  moderate: "medium",
  low: "low",
  unsure: "low",
  uncertain: "low",
};

function coerceEnum<T extends string>(
  raw: unknown,
  synonyms: Record<string, T>,
): T | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  // Guard against prototype pollution: `synonyms['constructor']` (and other
  // inherited Object.prototype properties) returns a function, not undefined.
  // `?? null` only catches null/undefined, so the inherited value would slip
  // through as a falsely-validated enum value. Object.hasOwn restricts the
  // lookup to own enumerable properties.
  if (!Object.hasOwn(synonyms, key)) return null;
  return synonyms[key];
}

/**
 * Validate + coerce one raw event entry into a RelationshipEventProposal.
 * Returns null if the entry can't be salvaged, along with a drop reason
 * (returned via the out-parameter array to keep the signature simple).
 */
function normalizeOne(
  raw: unknown,
  presentCharacterIds: Set<string>,
  personaId: string,
  drops: RelationshipEventDropReason[],
): RelationshipEventProposal | null {
  if (!raw || typeof raw !== "object") {
    drops.push({ reason: "not_object", raw });
    return null;
  }
  const obj = raw as Record<string, unknown>;

  // Trim ID strings — models occasionally emit accidental whitespace and
  // the Set.has() / equality checks below would otherwise produce silent
  // false negatives.
  const characterId =
    typeof obj.characterId === "string" ? obj.characterId.trim() : null;
  const rawPersonaId =
    typeof obj.personaId === "string" ? obj.personaId.trim() : null;
  if (!characterId) {
    drops.push({ reason: "missing_characterId", raw });
    return null;
  }
  if (!rawPersonaId) {
    drops.push({ reason: "missing_personaId", raw });
    return null;
  }
  if (!presentCharacterIds.has(characterId)) {
    drops.push({ reason: "characterId_not_present", raw });
    return null;
  }
  if (rawPersonaId !== personaId) {
    drops.push({ reason: "personaId_mismatch", raw });
    return null;
  }

  const magnitude = coerceEnum<RelationshipMagnitude>(obj.magnitude, MAGNITUDE_SYNONYMS);
  if (!magnitude) {
    drops.push({ reason: "bad_magnitude", raw });
    return null;
  }
  const valence = coerceEnum<RelationshipValence>(obj.valence, VALENCE_SYNONYMS);
  if (!valence) {
    drops.push({ reason: "bad_valence", raw });
    return null;
  }
  const initiator = coerceEnum<RelationshipInitiator>(obj.initiator, INITIATOR_SYNONYMS);
  if (!initiator) {
    drops.push({ reason: "bad_initiator", raw });
    return null;
  }
  const confidence = coerceEnum<RelationshipConfidence>(obj.confidence, CONFIDENCE_SYNONYMS);
  if (!confidence) {
    drops.push({ reason: "bad_confidence", raw });
    return null;
  }

  const description = typeof obj.description === "string" ? obj.description.trim() : "";
  if (description === "") {
    drops.push({ reason: "empty_description", raw });
    return null;
  }

  return {
    characterId,
    personaId,
    magnitude,
    valence,
    initiator,
    confidence,
    description,
  };
}

/**
 * Heuristic: description begins with a first-person actor pronoun ("I "
 * followed by anything). Per Rule 4, the description should describe what
 * the OTHER party did from the subject's POV — first-person subject action
 * is a likely violation. Flagged but not dropped (false positives are
 * possible — "I confess, you were right" reports the persona's action).
 */
function looksLikeFirstPersonActor(description: string): boolean {
  return /^I\s/.test(description.trimStart());
}

const CONFIDENCE_RANK: Record<RelationshipConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/**
 * Normalize the raw `relationship_event` agent output. Returns the validated
 * events, drop reasons for telemetry, and any descriptions that look like
 * Rule 4 violations.
 *
 * Rules enforced:
 * - characterId must be in `presentCharacterIds` (otherwise dropped)
 * - personaId must equal `personaId` (otherwise dropped)
 * - magnitude/valence/initiator/confidence coerced via synonym tables
 * - description must be a non-empty string after trim
 * - At most one event per character — if multiple, keep highest confidence;
 *   ties broken by input order (first wins).
 */
export function normalizeRelationshipEvents(
  raw: unknown,
  presentCharacterIds: Set<string>,
  personaId: string,
): RelationshipEventNormalizationResult {
  const drops: RelationshipEventDropReason[] = [];
  const flaggedFirstPerson: RelationshipEventProposal[] = [];

  // Find the events array — accept either { events: [...] } or a raw array.
  // Anything else is a structural failure; record it in `dropped` so the
  // empty-events result is distinguishable from "model returned garbage".
  let rawEvents: unknown[] = [];
  if (Array.isArray(raw)) {
    rawEvents = raw;
  } else if (raw && typeof raw === "object" && Array.isArray((raw as { events?: unknown }).events)) {
    rawEvents = (raw as { events: unknown[] }).events;
  } else {
    return {
      events: [],
      dropped: [{ reason: "bad_root_type", raw }],
      flaggedFirstPerson: [],
    };
  }

  // First pass: validate and coerce each entry.
  const candidates: RelationshipEventProposal[] = [];
  for (const entry of rawEvents) {
    const normalized = normalizeOne(entry, presentCharacterIds, personaId, drops);
    if (normalized) candidates.push(normalized);
  }

  // Second pass: dedupe by characterId, keeping highest confidence (first
  // wins on tie). The dedup drop reason distinguishes "lost on confidence"
  // from "lost on tie-break" so telemetry can tell genuine confidence
  // losses from arbitrary ordering decisions.
  const bestByCharacter = new Map<string, RelationshipEventProposal>();
  for (const candidate of candidates) {
    const existing = bestByCharacter.get(candidate.characterId);
    if (existing === undefined) {
      bestByCharacter.set(candidate.characterId, candidate);
      continue;
    }
    const candidateRank = CONFIDENCE_RANK[candidate.confidence];
    const existingRank = CONFIDENCE_RANK[existing.confidence];
    if (candidateRank > existingRank) {
      drops.push({ reason: "duplicate_character_lower_confidence", raw: existing });
      bestByCharacter.set(candidate.characterId, candidate);
    } else if (candidateRank < existingRank) {
      drops.push({ reason: "duplicate_character_lower_confidence", raw: candidate });
    } else {
      // Equal confidence — tie broken by input order (first wins).
      drops.push({ reason: "duplicate_character_tie_broken", raw: candidate });
    }
  }

  const events = Array.from(bestByCharacter.values());

  // Build flaggedFirstPerson AFTER dedup so it's strictly a subset of the
  // returned events — a Rule 4 violation on an event that lost dedup is
  // moot. Use shallow copies so downstream mutation of the flagged entries
  // can't corrupt the canonical events list.
  for (const e of events) {
    if (looksLikeFirstPersonActor(e.description)) {
      flaggedFirstPerson.push({ ...e });
    }
  }

  return {
    events,
    dropped: drops,
    flaggedFirstPerson,
  };
}
