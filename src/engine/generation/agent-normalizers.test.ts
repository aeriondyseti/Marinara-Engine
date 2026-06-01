import { describe, expect, it } from "vitest";
import { normalizeRelationshipEvents } from "./agent-normalizers";

const PRESENT = new Set(["char_a", "char_b"]);
const PERSONA = "persona_xyz";

function validRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    characterId: "char_a",
    personaId: PERSONA,
    magnitude: "moderate",
    valence: "positive",
    initiator: "persona",
    confidence: "high",
    description: "you did a thing",
    ...overrides,
  };
}

describe("normalizeRelationshipEvents — input shape", () => {
  it("accepts { events: [...] } wrapper", () => {
    const result = normalizeRelationshipEvents(
      { events: [validRaw()] },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toHaveLength(1);
    expect(result.dropped).toEqual([]);
  });

  it("accepts a bare array", () => {
    const result = normalizeRelationshipEvents([validRaw()], PRESENT, PERSONA);
    expect(result.events).toHaveLength(1);
  });

  it("returns empty result for non-array, non-object input", () => {
    expect(normalizeRelationshipEvents(null, PRESENT, PERSONA).events).toEqual([]);
    expect(normalizeRelationshipEvents("string", PRESENT, PERSONA).events).toEqual([]);
    expect(normalizeRelationshipEvents(42, PRESENT, PERSONA).events).toEqual([]);
    expect(normalizeRelationshipEvents({}, PRESENT, PERSONA).events).toEqual([]);
  });

  it("returns empty result for {events: <not an array>}", () => {
    expect(normalizeRelationshipEvents({ events: "x" }, PRESENT, PERSONA).events).toEqual([]);
  });

  it("returns empty events array for empty input array", () => {
    const result = normalizeRelationshipEvents({ events: [] }, PRESENT, PERSONA);
    expect(result.events).toEqual([]);
    expect(result.dropped).toEqual([]);
  });
});

describe("normalizeRelationshipEvents — field validation", () => {
  it("drops entries without characterId", () => {
    const raw = validRaw();
    delete raw.characterId;
    const result = normalizeRelationshipEvents({ events: [raw] }, PRESENT, PERSONA);
    expect(result.events).toEqual([]);
    expect(result.dropped[0].reason).toBe("missing_characterId");
  });

  it("drops entries whose characterId is not in presentCharacterIds", () => {
    const result = normalizeRelationshipEvents(
      { events: [validRaw({ characterId: "char_not_present" })] },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toEqual([]);
    expect(result.dropped[0].reason).toBe("characterId_not_present");
  });

  it("drops entries with mismatched personaId", () => {
    const result = normalizeRelationshipEvents(
      { events: [validRaw({ personaId: "wrong_persona" })] },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toEqual([]);
    expect(result.dropped[0].reason).toBe("personaId_mismatch");
  });

  it("drops entries with empty description after trim", () => {
    const result = normalizeRelationshipEvents(
      { events: [validRaw({ description: "   " })] },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toEqual([]);
    expect(result.dropped[0].reason).toBe("empty_description");
  });

  it("drops entries with non-string description", () => {
    const result = normalizeRelationshipEvents(
      { events: [validRaw({ description: 42 })] },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toEqual([]);
    expect(result.dropped[0].reason).toBe("empty_description");
  });

  it("trims surrounding whitespace from description", () => {
    const result = normalizeRelationshipEvents(
      { events: [validRaw({ description: "  hello  " })] },
      PRESENT,
      PERSONA,
    );
    expect(result.events[0].description).toBe("hello");
  });
});

describe("normalizeRelationshipEvents — enum coercion", () => {
  it("accepts canonical enum values", () => {
    const cases = [
      { magnitude: "minor", valence: "positive", initiator: "persona", confidence: "high" },
      { magnitude: "moderate", valence: "negative", initiator: "character", confidence: "medium" },
      { magnitude: "major", valence: "neutral", initiator: "mutual", confidence: "low" },
    ];
    for (const enumValues of cases) {
      const result = normalizeRelationshipEvents(
        { events: [validRaw(enumValues)] },
        PRESENT,
        PERSONA,
      );
      expect(result.events).toHaveLength(1);
      expect(result.events[0].magnitude).toBe(enumValues.magnitude);
      expect(result.events[0].valence).toBe(enumValues.valence);
      expect(result.events[0].initiator).toBe(enumValues.initiator);
      expect(result.events[0].confidence).toBe(enumValues.confidence);
    }
  });

  it("coerces synonyms to canonical enum values", () => {
    const result = normalizeRelationshipEvents(
      {
        events: [
          validRaw({
            magnitude: "big",       // → major
            valence: "good",        // → positive
            initiator: "player",    // → persona
            confidence: "certain",  // → high
          }),
        ],
      },
      PRESENT,
      PERSONA,
    );
    expect(result.events[0].magnitude).toBe("major");
    expect(result.events[0].valence).toBe("positive");
    expect(result.events[0].initiator).toBe("persona");
    expect(result.events[0].confidence).toBe("high");
  });

  it("normalizes case and trims when coercing enums", () => {
    const result = normalizeRelationshipEvents(
      {
        events: [
          validRaw({
            magnitude: "  MAJOR  ",
            valence: "Negative",
            initiator: "NPC",
            confidence: "LOW",
          }),
        ],
      },
      PRESENT,
      PERSONA,
    );
    expect(result.events[0].magnitude).toBe("major");
    expect(result.events[0].valence).toBe("negative");
    expect(result.events[0].initiator).toBe("character");
    expect(result.events[0].confidence).toBe("low");
  });

  it("drops out-of-vocabulary enum values", () => {
    const result = normalizeRelationshipEvents(
      { events: [validRaw({ magnitude: "epic" })] },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toEqual([]);
    expect(result.dropped[0].reason).toBe("bad_magnitude");
  });

  it("drops non-string enum fields", () => {
    const result = normalizeRelationshipEvents(
      { events: [validRaw({ confidence: 99 })] },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toEqual([]);
    expect(result.dropped[0].reason).toBe("bad_confidence");
  });
});

describe("normalizeRelationshipEvents — duplicate character", () => {
  it("keeps highest confidence on collision", () => {
    const low = validRaw({ confidence: "low", description: "low event" });
    const high = validRaw({ confidence: "high", description: "high event" });
    const result = normalizeRelationshipEvents(
      { events: [low, high] },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].description).toBe("high event");
    // The dropped one is reported in dropped[]
    expect(
      result.dropped.some((d) => d.reason === "duplicate_character_lower_confidence"),
    ).toBe(true);
  });

  it("breaks ties by input order (first wins)", () => {
    const first = validRaw({ confidence: "high", description: "first" });
    const second = validRaw({ confidence: "high", description: "second" });
    const result = normalizeRelationshipEvents(
      { events: [first, second] },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].description).toBe("first");
  });

  it("does not collapse events on different characters", () => {
    const result = normalizeRelationshipEvents(
      {
        events: [
          validRaw({ characterId: "char_a", description: "a" }),
          validRaw({ characterId: "char_b", description: "b" }),
        ],
      },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toHaveLength(2);
  });
});

describe("normalizeRelationshipEvents — first-person flag (Rule 4 heuristic)", () => {
  it("flags descriptions starting with 'I '", () => {
    const result = normalizeRelationshipEvents(
      { events: [validRaw({ description: "I opened up to you about my past" })] },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toHaveLength(1);
    expect(result.flaggedFirstPerson).toHaveLength(1);
    expect(result.flaggedFirstPerson[0].description).toBe("I opened up to you about my past");
  });

  it("does not flag normal second-person descriptions", () => {
    const result = normalizeRelationshipEvents(
      { events: [validRaw({ description: "you confessed your fear of being alone" })] },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toHaveLength(1);
    expect(result.flaggedFirstPerson).toEqual([]);
  });

  it("does not flag descriptions starting with capital-I words that aren't the pronoun", () => {
    const result = normalizeRelationshipEvents(
      { events: [validRaw({ description: "It felt sudden — you walked out" })] },
      PRESENT,
      PERSONA,
    );
    expect(result.flaggedFirstPerson).toEqual([]);
  });
});

describe("normalizeRelationshipEvents — Phase 5 review fixes (regression)", () => {
  it("guards against prototype pollution: 'constructor' is not coerced", () => {
    // Pre-fix: synonyms['constructor'] returned Object.prototype.constructor
    // (a function), which `?? null` didn't catch.
    const result = normalizeRelationshipEvents(
      { events: [validRaw({ magnitude: "constructor" })] },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toEqual([]);
    expect(result.dropped[0].reason).toBe("bad_magnitude");
  });

  it("guards against prototype pollution: '__proto__' is not coerced", () => {
    const result = normalizeRelationshipEvents(
      { events: [validRaw({ valence: "__proto__" })] },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toEqual([]);
    expect(result.dropped[0].reason).toBe("bad_valence");
  });

  it("trims surrounding whitespace from characterId", () => {
    const result = normalizeRelationshipEvents(
      { events: [validRaw({ characterId: "  char_a  " })] },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].characterId).toBe("char_a");
  });

  it("trims surrounding whitespace from personaId", () => {
    const result = normalizeRelationshipEvents(
      { events: [validRaw({ personaId: "  " + PERSONA + "  " })] },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toHaveLength(1);
  });

  it("missing characterId reports 'missing_characterId' (not generic 'missing_field')", () => {
    const raw = validRaw();
    delete raw.characterId;
    const result = normalizeRelationshipEvents({ events: [raw] }, PRESENT, PERSONA);
    expect(result.dropped[0].reason).toBe("missing_characterId");
  });

  it("missing personaId reports 'missing_personaId' (not generic 'missing_field')", () => {
    const raw = validRaw();
    delete raw.personaId;
    const result = normalizeRelationshipEvents({ events: [raw] }, PRESENT, PERSONA);
    expect(result.dropped[0].reason).toBe("missing_personaId");
  });

  it("structural rejection records a 'bad_root_type' drop entry — not a silent empty result", () => {
    const result = normalizeRelationshipEvents(42, PRESENT, PERSONA);
    expect(result.events).toEqual([]);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].reason).toBe("bad_root_type");
  });

  it("{events: null} records 'bad_root_type' (not silently empty)", () => {
    const result = normalizeRelationshipEvents({ events: null }, PRESENT, PERSONA);
    expect(result.dropped[0].reason).toBe("bad_root_type");
  });

  it("equal-confidence dedup uses 'duplicate_character_tie_broken', not 'lower_confidence'", () => {
    const first = validRaw({ confidence: "high", description: "first" });
    const second = validRaw({ confidence: "high", description: "second" });
    const result = normalizeRelationshipEvents(
      { events: [first, second] },
      PRESENT,
      PERSONA,
    );
    const dedup = result.dropped.find((d) =>
      d.reason === "duplicate_character_tie_broken" ||
      d.reason === "duplicate_character_lower_confidence",
    );
    expect(dedup?.reason).toBe("duplicate_character_tie_broken");
  });

  it("'mixed' valence is dropped, not silently coerced to neutral", () => {
    const result = normalizeRelationshipEvents(
      { events: [validRaw({ valence: "mixed" })] },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toEqual([]);
    expect(result.dropped[0].reason).toBe("bad_valence");
  });

  it("'self' initiator is dropped, not silently coerced to character", () => {
    const result = normalizeRelationshipEvents(
      { events: [validRaw({ initiator: "self" })] },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toEqual([]);
    expect(result.dropped[0].reason).toBe("bad_initiator");
  });

  it("flaggedFirstPerson is rebuilt after dedup — losers are not flagged", () => {
    // A first-person event with low confidence loses dedup to a high-confidence
    // sibling. flaggedFirstPerson must not list the dropped event.
    const flagged = validRaw({
      confidence: "low",
      description: "I told you everything",
    });
    const winner = validRaw({
      confidence: "high",
      description: "you walked out before I could explain",
    });
    const result = normalizeRelationshipEvents(
      { events: [flagged, winner] },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].description).toBe("you walked out before I could explain");
    expect(result.flaggedFirstPerson).toEqual([]);
  });

  it("flaggedFirstPerson entries are decoupled by reference from events", () => {
    const result = normalizeRelationshipEvents(
      { events: [validRaw({ description: "I confessed" })] },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toHaveLength(1);
    expect(result.flaggedFirstPerson).toHaveLength(1);
    // Mutating the flag entry must not affect events
    result.flaggedFirstPerson[0].description = "MUTATED";
    expect(result.events[0].description).toBe("I confessed");
  });
});

describe("normalizeRelationshipEvents — partial output", () => {
  it("preserves valid entries when other entries are dropped", () => {
    const good = validRaw({ characterId: "char_a", description: "valid event" });
    const bad = validRaw({ characterId: "char_not_present" });
    const result = normalizeRelationshipEvents(
      { events: [bad, good] },
      PRESENT,
      PERSONA,
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].description).toBe("valid event");
    expect(result.dropped[0].reason).toBe("characterId_not_present");
  });
});
