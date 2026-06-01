/**
 * Relationship Tracker — storage adapters.
 *
 * Helpers for reading and writing relationship state on character-card
 * extensions. Pure functions; no storage I/O. The integration layer
 * (agent-runner.ts, prompt-assembly.ts, writeback wiring) composes these
 * with the actual persistence adapters.
 *
 * See docs/agents/relationship-tracker.md §2 (Storage location) — relationships
 * live on `CharacterExtensions.relationships` keyed by `personaId`.
 */

import type {
  CharacterRelationship,
} from "../../contracts/types/character";
import { buildCurrentStateBlock } from "./hydration";

// ──────────────────────────────────────────────
// Shapes — narrowed to what these adapters need
// ──────────────────────────────────────────────

/**
 * Minimal extensions shape this module reads from. The real
 * `CharacterExtensions` has many fields; we touch only `relationships`. Using
 * a structural type here avoids depending on the entire extensions interface
 * at the storage-adapter layer.
 */
export interface RelationshipBearingExtensions {
  relationships?: CharacterRelationship[];
}

// ──────────────────────────────────────────────
// Read adapters
// ──────────────────────────────────────────────

/**
 * Get the relationship edge for a specific persona, or null if none exists.
 * Returns a **shallow defensive copy** — mutating the result's `events`/
 * `preservedEvents`/`sessionSummaries` arrays or `lifetime` object does NOT
 * affect the input extensions. This is symmetric with `listRelationships`
 * which also returns a defensive copy.
 *
 * Duplicate entries for the same personaId (data corruption) → returns the
 * one with the latest `updatedAt`. Missing/undefined `updatedAt` is treated
 * as the empty string (the smallest possible lexicographic value), so a
 * record without a timestamp can never win over a record with one.
 */
export function getRelationshipForPersona(
  extensions: RelationshipBearingExtensions | null | undefined,
  personaId: string,
): CharacterRelationship | null {
  const arr = extensions?.relationships;
  if (!arr || arr.length === 0) return null;

  let best: CharacterRelationship | null = null;
  for (const r of arr) {
    if (r.personaId !== personaId) continue;
    if (best === null) {
      best = r;
      continue;
    }
    // Latest-wins on duplicates. Coerce undefined/missing updatedAt to ""
    // so a corrupt record can't sort *after* a valid ISO string (which
    // would happen if undefined coerced to the string "undefined").
    const bestAt = best.updatedAt ?? "";
    const candidateAt = r.updatedAt ?? "";
    if (candidateAt > bestAt) best = r;
  }
  if (best === null) return null;
  return copyRelationship(best);
}

function copyRelationship(rel: CharacterRelationship): CharacterRelationship {
  return {
    ...rel,
    events: [...rel.events],
    sessionSummaries: [...rel.sessionSummaries],
    preservedEvents: [...rel.preservedEvents],
    lifetime: {
      ...rel.lifetime,
      tally: {
        minor: { ...rel.lifetime.tally.minor },
        moderate: { ...rel.lifetime.tally.moderate },
        major: { ...rel.lifetime.tally.major },
      },
      initiatorTally: { ...rel.lifetime.initiatorTally },
      latchedMilestones: Object.fromEntries(
        Object.entries(rel.lifetime.latchedMilestones).map(([k, v]) => [k, { ...v }]),
      ),
    },
  };
}

/**
 * List all relationships on this character (across all personas). Returns
 * an array of per-relationship defensive copies — both the array AND the
 * individual relationship objects are safe to mutate without affecting the
 * input. Symmetric with `getRelationshipForPersona`.
 */
export function listRelationships(
  extensions: RelationshipBearingExtensions | null | undefined,
): CharacterRelationship[] {
  const arr = extensions?.relationships;
  if (!arr) return [];
  return arr.map(copyRelationship);
}

// ──────────────────────────────────────────────
// Write adapters
// ──────────────────────────────────────────────

/**
 * Set or replace the relationship for a specific persona, returning a new
 * extensions object. Other persona edges are preserved. Pure: input is not
 * mutated. **Always returns a new object** (no identity-preservation), so
 * callers using reference equality to detect changes always see a "changed"
 * result — this is symmetric with `removeRelationshipForPersona`.
 *
 * Rejects entries with empty `rel.personaId` — an empty personaId is
 * semantically invalid (could match other corrupted records during dedup
 * cleanup). Returns input unchanged when called with an empty personaId.
 *
 * If a duplicate `personaId` entry exists in the input (data corruption),
 * ALL matching entries are removed and replaced with the single new entry —
 * the function self-heals duplicate corruption.
 */
export function setRelationshipForPersona<
  E extends RelationshipBearingExtensions,
>(extensions: E, rel: CharacterRelationship): E {
  if (!rel.personaId) {
    // Refuse to write an entry with an empty personaId. Returning input
    // unchanged is safer than appending and corrupting the per-persona index.
    return extensions;
  }
  const existing = extensions.relationships ?? [];
  const others = existing.filter((r) => r.personaId !== rel.personaId);
  return {
    ...extensions,
    relationships: [...others, rel],
  };
}

/**
 * Remove the relationship for a specific persona, returning a new extensions
 * object. **Always returns a new object** (no identity-preservation), symmetric
 * with `setRelationshipForPersona`. Callers that need a fast no-op gate
 * should check whether a relationship exists before calling.
 *
 * `relationships` is always an array in the result (`[]` when no edges
 * remain) — not toggled to `undefined`. Downstream consumers all use the
 * `relationships ?? []` idiom and don't distinguish "never had" from "had
 * and erased"; collapsing to either would be pointless ceremony.
 */
export function removeRelationshipForPersona<
  E extends RelationshipBearingExtensions,
>(extensions: E, personaId: string): E {
  const existing = extensions.relationships ?? [];
  const filtered = existing.filter((r) => r.personaId !== personaId);
  return {
    ...extensions,
    relationships: filtered,
  };
}

// ──────────────────────────────────────────────
// Next-turn injection
// ──────────────────────────────────────────────

export interface InjectionCharacterInput {
  id: string;
  name: string;
  extensions: RelationshipBearingExtensions | null | undefined;
}

export interface InjectionContext {
  /** Active persona ID — relationships are filtered to this persona only. */
  activePersonaId: string;
  /** Turn / session anchors used by the fold for time-decay computations. */
  currentTurn: number;
  currentSession: number;
  /** How many tier-1 events to render verbatim per character (default 5). */
  recentEventsKept?: number;
}

/**
 * Build ONLY the `<current_state>` block for the main generation's next
 * turn. Per docs §5, the agent's full context normally includes five blocks
 * (`<persona>`, `<present_characters>`, `<current_state>`, `<character_lore>`,
 * `<recent_messages>`); this function produces just the `<current_state>`
 * one. The integration layer (prompt-assembly.ts) is responsible for
 * threading any other blocks the main generation should see.
 *
 * Filters each character's relationships array to the active persona's edge
 * (via `getRelationshipForPersona`), then delegates to `buildCurrentStateBlock`.
 *
 * Returns `null` ONLY when `presentCharacters` is empty. When characters
 * are present but none have a prior relationship for the active persona,
 * the function returns a non-null block containing "first encounter" lines
 * per character — this is correct behavior, since first impressions are
 * load-bearing context the model needs to see. Callers should check for
 * null-or-empty as the "skip injection" gate, not just null.
 */
export function buildNextTurnInjection(
  presentCharacters: ReadonlyArray<InjectionCharacterInput>,
  context: InjectionContext,
): string | null {
  if (presentCharacters.length === 0) return null;

  const characters = presentCharacters.map((ch) => ({
    id: ch.id,
    name: ch.name,
    relationship: getRelationshipForPersona(ch.extensions, context.activePersonaId),
  }));

  return buildCurrentStateBlock({
    characters,
    context: {
      currentTurn: context.currentTurn,
      currentSession: context.currentSession,
    },
    recentEventsKept: context.recentEventsKept,
  });
}
