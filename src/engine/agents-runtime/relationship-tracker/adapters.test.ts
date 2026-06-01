import { describe, expect, it } from "vitest";
import type {
  CharacterRelationship,
  RelationshipLifetimeAggregate,
} from "../../contracts/types/character";
import {
  buildNextTurnInjection,
  getRelationshipForPersona,
  listRelationships,
  removeRelationshipForPersona,
  setRelationshipForPersona,
  type RelationshipBearingExtensions,
} from "./adapters";

// ──────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────

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

function makeRel(
  personaId: string,
  updatedAt = "2026-05-31T00:00:00Z",
): CharacterRelationship {
  return {
    personaId,
    events: [],
    sessionSummaries: [],
    lifetime: emptyLifetime(),
    preservedEvents: [],
    lastChatId: "",
    updatedAt,
  };
}

// ──────────────────────────────────────────────
// getRelationshipForPersona
// ──────────────────────────────────────────────

describe("getRelationshipForPersona", () => {
  it("returns null when extensions is null/undefined", () => {
    expect(getRelationshipForPersona(null, "p1")).toBeNull();
    expect(getRelationshipForPersona(undefined, "p1")).toBeNull();
  });

  it("returns null when relationships is empty", () => {
    expect(getRelationshipForPersona({ relationships: [] }, "p1")).toBeNull();
  });

  it("returns null when no relationship matches the personaId", () => {
    const ext = { relationships: [makeRel("p1")] };
    expect(getRelationshipForPersona(ext, "p2")).toBeNull();
  });

  it("returns the matching relationship as a defensive copy", () => {
    const rel = makeRel("p1");
    const ext = { relationships: [makeRel("p2"), rel, makeRel("p3")] };
    const result = getRelationshipForPersona(ext, "p1");
    // Defensive copy — value-equal but not reference-equal to input.
    expect(result).toEqual(rel);
    expect(result).not.toBe(rel);
  });

  it("self-heals duplicate personaIds by picking the latest updatedAt", () => {
    const older = makeRel("p1", "2026-01-01T00:00:00Z");
    const newer = makeRel("p1", "2026-05-01T00:00:00Z");
    const ext = { relationships: [older, newer] };
    const result = getRelationshipForPersona(ext, "p1");
    expect(result?.updatedAt).toBe("2026-05-01T00:00:00Z");
  });

  it("mutation of the result does NOT affect the input (defensive copy)", () => {
    const rel = makeRel("p1");
    rel.events = [];
    const ext = { relationships: [rel] };
    const result = getRelationshipForPersona(ext, "p1");
    // Pre-fix: result.events was the same array reference as rel.events
    expect(result).not.toBeNull();
    result!.events.push({
      at: "2026-05-31T00:00:01Z",
      chatId: "chat-1",
      magnitude: "minor",
      valence: "positive",
      initiator: "persona",
      confidence: "high",
      description: "mutated through result",
    });
    expect(rel.events).toHaveLength(0);
  });

  it("handles undefined/missing updatedAt without picking the corrupt record as 'latest'", () => {
    // Pre-fix: undefined.updatedAt would coerce in lexicographic compare such
    // that "undefined" > any ISO Z-suffix string, silently picking the corrupt
    // record over the valid one.
    const corrupt = makeRel("p1");
    (corrupt as { updatedAt?: string }).updatedAt = undefined as unknown as string;
    const valid = makeRel("p1", "2026-05-01T00:00:00Z");
    const ext = { relationships: [corrupt, valid] };
    const result = getRelationshipForPersona(ext, "p1");
    expect(result?.updatedAt).toBe("2026-05-01T00:00:00Z");
  });
});

// ──────────────────────────────────────────────
// listRelationships
// ──────────────────────────────────────────────

describe("listRelationships", () => {
  it("returns empty array for null/undefined", () => {
    expect(listRelationships(null)).toEqual([]);
    expect(listRelationships(undefined)).toEqual([]);
  });

  it("returns a defensive array — mutating it doesn't affect input", () => {
    const rel = makeRel("p1");
    const ext = { relationships: [rel] };
    const result = listRelationships(ext);
    result.push(makeRel("p2"));
    expect(ext.relationships).toHaveLength(1);
  });

  it("returns deep-copied entries — mutating an entry doesn't affect input", () => {
    const rel = makeRel("p1");
    rel.events = [];
    const ext = { relationships: [rel] };
    const result = listRelationships(ext);
    result[0].events.push({
      at: "2026-05-31T00:00:01Z",
      chatId: "chat-1",
      magnitude: "minor",
      valence: "positive",
      initiator: "persona",
      confidence: "high",
      description: "mutated through result",
    });
    expect(rel.events).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────
// setRelationshipForPersona
// ──────────────────────────────────────────────

describe("setRelationshipForPersona", () => {
  it("appends a new relationship to empty extensions", () => {
    const rel = makeRel("p1");
    const ext: RelationshipBearingExtensions = {};
    const next = setRelationshipForPersona(ext, rel);
    expect(next.relationships).toEqual([rel]);
  });

  it("replaces an existing edge for the same persona", () => {
    const old = makeRel("p1", "2026-01-01T00:00:00Z");
    const replacement = makeRel("p1", "2026-05-01T00:00:00Z");
    const ext = { relationships: [old] };
    const next = setRelationshipForPersona(ext, replacement);
    expect(next.relationships).toHaveLength(1);
    expect(next.relationships?.[0]).toBe(replacement);
  });

  it("preserves edges for other personas", () => {
    const a = makeRel("p1");
    const b = makeRel("p2");
    const ext = { relationships: [a] };
    const next = setRelationshipForPersona(ext, b);
    expect(next.relationships).toHaveLength(2);
  });

  it("removes duplicate personaId entries and replaces with the new one", () => {
    const dup1 = makeRel("p1", "2026-01-01T00:00:00Z");
    const dup2 = makeRel("p1", "2026-02-01T00:00:00Z");
    const replacement = makeRel("p1", "2026-05-01T00:00:00Z");
    const ext = { relationships: [dup1, dup2, makeRel("p2")] };
    const next = setRelationshipForPersona(ext, replacement);
    const p1Matches = next.relationships?.filter((r) => r.personaId === "p1") ?? [];
    expect(p1Matches).toHaveLength(1);
    expect(p1Matches[0]).toBe(replacement);
  });

  it("does not mutate the input extensions", () => {
    const ext = { relationships: [makeRel("p1")] };
    const before = JSON.stringify(ext);
    setRelationshipForPersona(ext, makeRel("p2"));
    expect(JSON.stringify(ext)).toBe(before);
  });

  it("preserves extra fields on the extensions object", () => {
    interface ExtraExt extends RelationshipBearingExtensions {
      backstory: string;
      appearance: string;
    }
    const ext: ExtraExt = {
      backstory: "ancient mage",
      appearance: "tall",
      relationships: [],
    };
    const next = setRelationshipForPersona(ext, makeRel("p1"));
    expect(next.backstory).toBe("ancient mage");
    expect(next.appearance).toBe("tall");
  });
});

// ──────────────────────────────────────────────
// removeRelationshipForPersona
// ──────────────────────────────────────────────

describe("removeRelationshipForPersona", () => {
  it("returns a new object (no identity preservation) even on no-op — symmetric with set", () => {
    const ext = { relationships: [makeRel("p1")] };
    const next = removeRelationshipForPersona(ext, "p2");
    // Content unchanged but a new object is returned.
    expect(next).not.toBe(ext);
    expect(next.relationships).toEqual(ext.relationships);
  });

  it("handles missing relationships field gracefully — sets it to an empty array", () => {
    const ext: RelationshipBearingExtensions = {};
    const next = removeRelationshipForPersona(ext, "p1");
    expect(next.relationships).toEqual([]);
  });

  it("removes the matching relationship", () => {
    const a = makeRel("p1");
    const b = makeRel("p2");
    const ext = { relationships: [a, b] };
    const next = removeRelationshipForPersona(ext, "p1");
    expect(next.relationships).toEqual([b]);
  });

  it("removes ALL matching entries when duplicates exist", () => {
    const dup1 = makeRel("p1", "2026-01-01T00:00:00Z");
    const dup2 = makeRel("p1", "2026-02-01T00:00:00Z");
    const other = makeRel("p2");
    const ext = { relationships: [dup1, dup2, other] };
    const next = removeRelationshipForPersona(ext, "p1");
    expect(next.relationships).toEqual([other]);
  });

  it("leaves relationships as an empty array when removing the last entry", () => {
    // Consumers all use `relationships ?? []` so the distinction between
    // empty array and undefined is invisible downstream. Always-array is
    // simpler — no special case in remove.
    const ext = { relationships: [makeRel("p1")] };
    const next = removeRelationshipForPersona(ext, "p1");
    expect(next.relationships).toEqual([]);
  });

  it("does not mutate the input", () => {
    const ext = { relationships: [makeRel("p1"), makeRel("p2")] };
    const before = JSON.stringify(ext);
    removeRelationshipForPersona(ext, "p1");
    expect(JSON.stringify(ext)).toBe(before);
  });
});

// ──────────────────────────────────────────────
// buildNextTurnInjection
// ──────────────────────────────────────────────

describe("regression — Phase 7 review fixes", () => {
  it("setRelationshipForPersona rejects empty personaId without writing", () => {
    const ext = { relationships: [makeRel("p1")] };
    const orphan = makeRel("");
    const next = setRelationshipForPersona(ext, orphan);
    // No write occurred — the existing relationship is unchanged.
    expect(next.relationships).toEqual(ext.relationships);
  });

  it("buildNextTurnInjection passes recentEventsKept through to buildCurrentStateBlock", () => {
    const rel = makeRel("p_active");
    // Add 10 events; expect only the last 2 to be rendered when
    // recentEventsKept=2.
    for (let i = 0; i < 10; i += 1) {
      rel.events.push({
        at: `2026-05-31T00:00:${String(i).padStart(2, "0")}Z`,
        chatId: "chat-1",
        magnitude: "minor",
        valence: "positive",
        initiator: "persona",
        confidence: "high",
        description: `event ${i}`,
      });
    }
    const block = buildNextTurnInjection(
      [{ id: "c1", name: "Dottore", extensions: { relationships: [rel] } }],
      {
        activePersonaId: "p_active",
        currentTurn: 1,
        currentSession: 1,
        recentEventsKept: 2,
      },
    );
    expect(block).toContain("event 8");
    expect(block).toContain("event 9");
    expect(block).not.toContain("event 0");
    expect(block).not.toContain("event 7");
  });

  it("buildNextTurnInjection: duplicate-personaId on a present character resolves to latest via getRelationshipForPersona", () => {
    const older = makeRel("p_active", "2026-01-01T00:00:00Z");
    older.events.push({
      at: "2026-01-01T00:00:01Z",
      chatId: "chat-1",
      magnitude: "minor",
      valence: "positive",
      initiator: "persona",
      confidence: "high",
      description: "OLDER event",
    });
    const newer = makeRel("p_active", "2026-05-01T00:00:00Z");
    newer.events.push({
      at: "2026-05-01T00:00:01Z",
      chatId: "chat-1",
      magnitude: "minor",
      valence: "positive",
      initiator: "persona",
      confidence: "high",
      description: "NEWER event",
    });
    const block = buildNextTurnInjection(
      [{ id: "c1", name: "Dottore", extensions: { relationships: [older, newer] } }],
      { activePersonaId: "p_active", currentTurn: 1, currentSession: 1 },
    );
    expect(block).toContain("NEWER event");
    expect(block).not.toContain("OLDER event");
  });
});

describe("buildNextTurnInjection", () => {
  it("returns null when no characters present", () => {
    expect(
      buildNextTurnInjection([], {
        activePersonaId: "p1",
        currentTurn: 1,
        currentSession: 1,
      }),
    ).toBeNull();
  });

  it("filters each character's relationships to the active persona", () => {
    // Character has edges to two personas; only the active persona's edge
    // should appear in the rendered output.
    const charExt = {
      relationships: [makeRel("p_other"), makeRel("p_active")],
    };
    const block = buildNextTurnInjection(
      [{ id: "c1", name: "Dottore", extensions: charExt }],
      { activePersonaId: "p_active", currentTurn: 1, currentSession: 1 },
    );
    expect(block).not.toBeNull();
    expect(block).toContain("Dottore");
  });

  it("renders 'first encounter' when no edge exists for the active persona", () => {
    const charExt = { relationships: [makeRel("p_other")] };
    const block = buildNextTurnInjection(
      [{ id: "c1", name: "Alice", extensions: charExt }],
      { activePersonaId: "p_active", currentTurn: 1, currentSession: 1 },
    );
    expect(block).toContain("first encounter");
  });

  it("handles a character with null extensions", () => {
    const block = buildNextTurnInjection(
      [{ id: "c1", name: "Bob", extensions: null }],
      { activePersonaId: "p_active", currentTurn: 1, currentSession: 1 },
    );
    expect(block).toContain("Bob");
    expect(block).toContain("first encounter");
  });

  it("wraps output in <current_state> tags", () => {
    const block = buildNextTurnInjection(
      [{ id: "c1", name: "Bob", extensions: null }],
      { activePersonaId: "p_active", currentTurn: 1, currentSession: 1 },
    );
    expect(block?.startsWith("<current_state>")).toBe(true);
    expect(block?.endsWith("</current_state>")).toBe(true);
  });
});
