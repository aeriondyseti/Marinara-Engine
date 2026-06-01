import { describe, expect, it } from "vitest";
import type {
  CharacterRelationship,
  RelationshipEventRecord,
  RelationshipLifetimeAggregate,
  RelationshipSessionSummary,
} from "../../contracts/types/character";
import {
  checkMilestones,
  currentStreak,
  deriveAffinity,
  deriveFamiliarity,
  deriveRelationshipMetrics,
  deriveStatus,
  deriveTrust,
  distinctCombinations,
  dominantMode,
  initiatorTally,
  lifetimeValence,
  longestStreak,
  magnitudeTally,
  posNegRatio,
  pursuitRatio,
  recentValence,
  valenceTally,
} from "./fold";

// ──────────────────────────────────────────────
// Test fixtures
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

function event(
  overrides: Partial<RelationshipEventRecord> & Pick<RelationshipEventRecord, "magnitude" | "valence">,
): RelationshipEventRecord {
  return {
    // Default to "now" so turnsSinceLastEvent (which approximates from
    // elapsed wall-clock time) doesn't decay familiarity into the floor.
    // Tests that need an older event override `at` explicitly.
    at: overrides.at ?? new Date().toISOString(),
    chatId: overrides.chatId ?? "chat-1",
    magnitude: overrides.magnitude,
    valence: overrides.valence,
    initiator: overrides.initiator ?? "persona",
    confidence: overrides.confidence ?? "high",
    description: overrides.description ?? "you did a thing",
  };
}

function relationship(
  events: RelationshipEventRecord[] = [],
  opts: {
    sessionSummaries?: RelationshipSessionSummary[];
    lifetime?: RelationshipLifetimeAggregate;
    preservedEvents?: RelationshipEventRecord[];
  } = {},
): CharacterRelationship {
  return {
    personaId: "persona-1",
    events,
    sessionSummaries: opts.sessionSummaries ?? [],
    lifetime: opts.lifetime ?? emptyLifetime(),
    preservedEvents: opts.preservedEvents ?? [],
    lastChatId: "chat-1",
    updatedAt: "2026-05-31T00:00:00Z",
  };
}

const ctx = { currentTurn: 100, currentSession: 5 };

// ──────────────────────────────────────────────
// Empty relationship
// ──────────────────────────────────────────────

describe("empty relationship", () => {
  it("yields zero dimensions", () => {
    const r = relationship();
    expect(deriveAffinity(r, ctx.currentSession)).toBe(0);
    expect(deriveTrust(r)).toBe(0);
    expect(deriveFamiliarity(r, ctx.currentTurn)).toBe(0);
  });

  it("yields zero tallies and no dominant mode", () => {
    const r = relationship();
    expect(magnitudeTally(r)).toEqual({ minor: 0, moderate: 0, major: 0 });
    expect(valenceTally(r)).toEqual({ positive: 0, negative: 0, neutral: 0 });
    expect(dominantMode(r)).toBeNull();
    expect(distinctCombinations(r)).toBe(0);
  });

  it("yields null current streak and zero longest streak", () => {
    const r = relationship();
    expect(currentStreak(r)).toBeNull();
    expect(longestStreak(r)).toBe(0);
  });

  it("yields stranger status", () => {
    const r = relationship();
    expect(deriveStatus(r, ctx)).toBe("stranger");
  });

  it("yields no latched milestones", () => {
    const r = relationship();
    const milestones = checkMilestones(r);
    expect(milestones.has_been_seriously_helped).toBe(false);
    expect(milestones.has_been_seriously_wronged).toBe(false);
    expect(milestones.has_been_vulnerable_with).toBe(false);
    expect(milestones.has_seen_persona_at_worst).toBe(false);
    expect(milestones.has_shared_silence).toBe(false);
  });
});

// ──────────────────────────────────────────────
// Single-event sanity
// ──────────────────────────────────────────────

describe("single positive event", () => {
  it("nudges affinity positive", () => {
    const r = relationship([event({ magnitude: "moderate", valence: "positive" })]);
    expect(deriveAffinity(r, ctx.currentSession)).toBeGreaterThan(0);
  });

  it("does not move trust (only major positives move trust)", () => {
    const r = relationship([event({ magnitude: "moderate", valence: "positive" })]);
    expect(deriveTrust(r)).toBe(0);
  });

  it("nudges familiarity above zero", () => {
    const r = relationship([event({ magnitude: "minor", valence: "neutral" })]);
    expect(deriveFamiliarity(r, ctx.currentTurn)).toBeGreaterThan(0);
  });
});

describe("single major positive", () => {
  it("moves trust positive", () => {
    const r = relationship([event({ magnitude: "major", valence: "positive" })]);
    expect(deriveTrust(r)).toBeGreaterThan(0);
  });

  it("latches has_been_seriously_helped", () => {
    const r = relationship([event({ magnitude: "major", valence: "positive" })]);
    expect(checkMilestones(r).has_been_seriously_helped).toBe(true);
  });

  it("latches has_been_vulnerable_with when character-initiated", () => {
    const r = relationship([
      event({ magnitude: "major", valence: "positive", initiator: "character" }),
    ]);
    expect(checkMilestones(r).has_been_vulnerable_with).toBe(true);
  });
});

describe("single major negative", () => {
  it("moves trust hard negative", () => {
    const r = relationship([event({ magnitude: "major", valence: "negative" })]);
    // Negative weight is 25; positive is 10. One major negative should be -25.
    expect(deriveTrust(r)).toBe(-25);
  });

  it("latches has_been_seriously_wronged", () => {
    const r = relationship([event({ magnitude: "major", valence: "negative" })]);
    expect(checkMilestones(r).has_been_seriously_wronged).toBe(true);
  });

  it("latches has_seen_persona_at_worst when persona-initiated", () => {
    const r = relationship([
      event({ magnitude: "major", valence: "negative", initiator: "persona" }),
    ]);
    expect(checkMilestones(r).has_seen_persona_at_worst).toBe(true);
  });
});

// ──────────────────────────────────────────────
// Trust asymmetry
// ──────────────────────────────────────────────

describe("trust collapses faster than it builds", () => {
  it("one major negative outweighs two major positives", () => {
    const r = relationship([
      event({ magnitude: "major", valence: "positive", at: "2026-05-31T00:00:01Z" }),
      event({ magnitude: "major", valence: "positive", at: "2026-05-31T00:00:02Z" }),
      event({ magnitude: "major", valence: "negative", at: "2026-05-31T00:00:03Z" }),
    ]);
    // +10 +10 -25 = -5
    expect(deriveTrust(r)).toBe(-5);
  });
});

// ──────────────────────────────────────────────
// Composition
// ──────────────────────────────────────────────

describe("magnitude and valence tallies", () => {
  it("counts events correctly", () => {
    const r = relationship([
      event({ magnitude: "minor", valence: "positive" }),
      event({ magnitude: "minor", valence: "positive" }),
      event({ magnitude: "moderate", valence: "negative" }),
      event({ magnitude: "major", valence: "neutral" }),
    ]);
    expect(magnitudeTally(r)).toEqual({ minor: 2, moderate: 1, major: 1 });
    expect(valenceTally(r)).toEqual({ positive: 2, negative: 1, neutral: 1 });
  });

  it("dominantMode picks the highest-count combination", () => {
    const r = relationship([
      event({ magnitude: "minor", valence: "positive" }),
      event({ magnitude: "minor", valence: "positive" }),
      event({ magnitude: "minor", valence: "positive" }),
      event({ magnitude: "major", valence: "negative" }),
    ]);
    const mode = dominantMode(r);
    expect(mode).toEqual({ magnitude: "minor", valence: "positive", count: 3 });
  });

  it("distinctCombinations counts unique magnitude×valence pairs", () => {
    const r = relationship([
      event({ magnitude: "minor", valence: "positive" }),
      event({ magnitude: "minor", valence: "positive" }),
      event({ magnitude: "major", valence: "negative" }),
    ]);
    expect(distinctCombinations(r)).toBe(2);
  });
});

describe("posNegRatio", () => {
  it("yields infinity when positives but no negatives", () => {
    const r = relationship([event({ magnitude: "moderate", valence: "positive" })]);
    expect(posNegRatio(r)).toBe(Number.POSITIVE_INFINITY);
  });

  it("yields zero when no positives at all", () => {
    const r = relationship([event({ magnitude: "moderate", valence: "negative" })]);
    expect(posNegRatio(r)).toBe(0);
  });

  it("yields ratio when both present", () => {
    const r = relationship([
      event({ magnitude: "minor", valence: "positive" }),
      event({ magnitude: "minor", valence: "positive" }),
      event({ magnitude: "minor", valence: "positive" }),
      event({ magnitude: "minor", valence: "negative" }),
    ]);
    expect(posNegRatio(r)).toBe(3);
  });

  it("ignores neutral events", () => {
    const r = relationship([
      event({ magnitude: "minor", valence: "positive" }),
      event({ magnitude: "minor", valence: "neutral" }),
      event({ magnitude: "minor", valence: "neutral" }),
    ]);
    expect(posNegRatio(r)).toBe(Number.POSITIVE_INFINITY);
  });
});

// ──────────────────────────────────────────────
// Trajectory
// ──────────────────────────────────────────────

describe("streaks", () => {
  it("currentStreak counts trailing same-valence run", () => {
    const r = relationship([
      event({ magnitude: "minor", valence: "negative", at: "2026-05-31T00:00:01Z" }),
      event({ magnitude: "minor", valence: "positive", at: "2026-05-31T00:00:02Z" }),
      event({ magnitude: "minor", valence: "positive", at: "2026-05-31T00:00:03Z" }),
      event({ magnitude: "minor", valence: "positive", at: "2026-05-31T00:00:04Z" }),
    ]);
    expect(currentStreak(r)).toEqual({ valence: "positive", length: 3 });
  });

  it("longestStreak finds max run across history", () => {
    const r = relationship([
      event({ magnitude: "minor", valence: "positive", at: "2026-05-31T00:00:01Z" }),
      event({ magnitude: "minor", valence: "positive", at: "2026-05-31T00:00:02Z" }),
      event({ magnitude: "minor", valence: "positive", at: "2026-05-31T00:00:03Z" }),
      event({ magnitude: "minor", valence: "positive", at: "2026-05-31T00:00:04Z" }),
      event({ magnitude: "minor", valence: "negative", at: "2026-05-31T00:00:05Z" }),
      event({ magnitude: "minor", valence: "positive", at: "2026-05-31T00:00:06Z" }),
    ]);
    expect(longestStreak(r)).toBe(4);
  });
});

describe("recent vs lifetime valence", () => {
  it("recentValence reflects last N events", () => {
    const oldNegatives = Array.from({ length: 10 }, (_, i) =>
      event({
        magnitude: "moderate",
        valence: "negative",
        at: `2026-05-30T00:00:${String(i).padStart(2, "0")}Z`,
      }),
    );
    const recentPositives = Array.from({ length: 3 }, (_, i) =>
      event({
        magnitude: "moderate",
        valence: "positive",
        at: `2026-05-31T00:00:${String(i).padStart(2, "0")}Z`,
      }),
    );
    const r = relationship([...oldNegatives, ...recentPositives]);
    expect(recentValence(r, 3)).toBeGreaterThan(0);
    expect(lifetimeValence(r)).toBeLessThan(0);
  });
});

// ──────────────────────────────────────────────
// Familiarity
// ──────────────────────────────────────────────

describe("familiarity", () => {
  it("grows with event count", () => {
    // Use a "now-anchored" base so both relationships share an equally-
    // recent last event — the test isolates count effect, not decay.
    const base = Date.now();
    const few = relationship([
      event({ magnitude: "minor", valence: "neutral", at: new Date(base).toISOString() }),
    ]);
    const many = relationship(
      Array.from({ length: 20 }, (_, i) =>
        event({
          magnitude: "minor",
          valence: "neutral",
          at: new Date(base - (19 - i) * 1000).toISOString(),
        }),
      ),
    );
    expect(deriveFamiliarity(many, ctx.currentTurn)).toBeGreaterThan(
      deriveFamiliarity(few, ctx.currentTurn),
    );
  });

  it("rewards variety (distinct combinations)", () => {
    const monotone = relationship(
      Array.from({ length: 5 }, () =>
        event({ magnitude: "minor", valence: "positive" }),
      ),
    );
    const varied = relationship([
      event({ magnitude: "minor", valence: "positive" }),
      event({ magnitude: "minor", valence: "negative" }),
      event({ magnitude: "moderate", valence: "positive" }),
      event({ magnitude: "moderate", valence: "neutral" }),
      event({ magnitude: "major", valence: "positive" }),
    ]);
    expect(deriveFamiliarity(varied, ctx.currentTurn)).toBeGreaterThan(
      deriveFamiliarity(monotone, ctx.currentTurn),
    );
  });

  it("never exceeds 100", () => {
    const r = relationship(
      Array.from({ length: 200 }, (_, i) =>
        event({
          magnitude: "major",
          valence: i % 2 === 0 ? "positive" : "negative",
          at: `2026-05-31T00:00:${String(i % 60).padStart(2, "0")}Z`,
        }),
      ),
    );
    expect(deriveFamiliarity(r, ctx.currentTurn)).toBeLessThanOrEqual(100);
  });

  it("never goes below 0", () => {
    const r = relationship();
    expect(deriveFamiliarity(r, ctx.currentTurn)).toBeGreaterThanOrEqual(0);
  });
});

// ──────────────────────────────────────────────
// Affinity clamping
// ──────────────────────────────────────────────

describe("dimension clamping", () => {
  it("affinity clamps to [-100, 100]", () => {
    const r = relationship(
      Array.from({ length: 100 }, () =>
        event({ magnitude: "major", valence: "positive" }),
      ),
    );
    expect(deriveAffinity(r, ctx.currentSession)).toBeLessThanOrEqual(100);
    expect(deriveAffinity(r, ctx.currentSession)).toBeGreaterThanOrEqual(-100);
  });

  it("trust clamps to [-100, 100]", () => {
    const r = relationship(
      Array.from({ length: 50 }, () =>
        event({ magnitude: "major", valence: "negative" }),
      ),
    );
    expect(deriveTrust(r)).toBe(-100);
  });
});

// ──────────────────────────────────────────────
// Initiator metrics
// ──────────────────────────────────────────────

describe("initiator metrics", () => {
  it("counts initiators correctly", () => {
    const r = relationship([
      event({ magnitude: "minor", valence: "positive", initiator: "persona" }),
      event({ magnitude: "minor", valence: "positive", initiator: "persona" }),
      event({ magnitude: "minor", valence: "positive", initiator: "character" }),
      event({ magnitude: "minor", valence: "neutral", initiator: "mutual" }),
      event({ magnitude: "minor", valence: "negative", initiator: "external" }),
    ]);
    expect(initiatorTally(r)).toEqual({
      persona: 2,
      character: 1,
      mutual: 1,
      external: 1,
    });
  });

  it("pursuitRatio reflects character-chasing", () => {
    const persona = relationship([
      event({ magnitude: "minor", valence: "positive", initiator: "persona" }),
      event({ magnitude: "minor", valence: "positive", initiator: "persona" }),
    ]);
    expect(pursuitRatio(persona)).toBe(0);

    const character = relationship([
      event({ magnitude: "minor", valence: "positive", initiator: "character" }),
      event({ magnitude: "minor", valence: "positive", initiator: "character" }),
      event({ magnitude: "minor", valence: "positive", initiator: "character" }),
      event({ magnitude: "minor", valence: "positive", initiator: "persona" }),
    ]);
    expect(pursuitRatio(character)).toBe(3);
  });
});

// ──────────────────────────────────────────────
// Tier reading (sessionSummaries + lifetime)
// ──────────────────────────────────────────────

describe("multi-tier reading", () => {
  it("tallies sum across tier 1 + tier 2 + tier 3", () => {
    const r = relationship(
      [event({ magnitude: "minor", valence: "positive" })],
      {
        sessionSummaries: [
          {
            sessionId: "s1",
            startedAt: "",
            endedAt: "",
            eventCount: 5,
            tally: {
              minor: { positive: 2, negative: 1, neutral: 0 },
              moderate: { positive: 1, negative: 0, neutral: 0 },
              major: { positive: 0, negative: 1, neutral: 0 },
            },
            initiatorTally: { persona: 3, character: 2, mutual: 0, external: 0 },
            highlights: [],
            netValence: 0,
          },
        ],
        lifetime: {
          totalEventCount: 10,
          tally: {
            minor: { positive: 5, negative: 2, neutral: 1 },
            moderate: { positive: 1, negative: 0, neutral: 0 },
            major: { positive: 1, negative: 0, neutral: 0 },
          },
          initiatorTally: { persona: 7, character: 3, mutual: 0, external: 0 },
          firstEventAt: "",
          latchedMilestones: {},
        },
      },
    );

    // Tier 1: 1 minor positive
    // Tier 2: 2 minor positive, 1 minor negative, 1 moderate positive, 1 major negative
    // Tier 3: 5 minor positive, 2 minor negative, 1 minor neutral, 1 moderate positive, 1 major positive
    // Positives: tier1=1 + tier2 (minor 2 + moderate 1) + tier3 (minor 5 + moderate 1 + major 1) = 11
    // Negatives: tier2 (minor 1 + major 1) + tier3 (minor 2) = 4
    // Neutral: tier3 (minor 1) = 1
    expect(valenceTally(r)).toEqual({ positive: 11, negative: 4, neutral: 1 });
  });

  it("recognizes milestones already latched in lifetime", () => {
    const r = relationship([], {
      lifetime: {
        totalEventCount: 0,
        tally: {
          minor: { positive: 0, negative: 0, neutral: 0 },
          moderate: { positive: 0, negative: 0, neutral: 0 },
          major: { positive: 0, negative: 0, neutral: 0 },
        },
        initiatorTally: { persona: 0, character: 0, mutual: 0, external: 0 },
        firstEventAt: "",
        latchedMilestones: {
          has_been_seriously_helped: {
            triggeredAt: "2026-01-01T00:00:00Z",
            sessionId: "s0",
            description: "you saved my life",
          },
        },
      },
    });
    expect(checkMilestones(r).has_been_seriously_helped).toBe(true);
  });

  it("recognizes milestones from preservedEvents even when not yet in lifetime", () => {
    const r = relationship(
      [],
      {
        preservedEvents: [
          event({ magnitude: "major", valence: "negative", initiator: "persona" }),
        ],
      },
    );
    expect(checkMilestones(r).has_been_seriously_wronged).toBe(true);
    expect(checkMilestones(r).has_seen_persona_at_worst).toBe(true);
  });
});

// ──────────────────────────────────────────────
// Master fold
// ──────────────────────────────────────────────

describe("deriveRelationshipMetrics master fold", () => {
  it("produces a complete metrics object", () => {
    const r = relationship([
      event({ magnitude: "major", valence: "positive", initiator: "persona" }),
      event({ magnitude: "minor", valence: "neutral", initiator: "mutual" }),
    ]);
    const m = deriveRelationshipMetrics(r, ctx);
    expect(m).toHaveProperty("affinity");
    expect(m).toHaveProperty("trust");
    expect(m).toHaveProperty("familiarity");
    expect(m).toHaveProperty("status");
    expect(m).toHaveProperty("milestones");
    expect(m.milestones.has_been_seriously_helped).toBe(true);
  });
});

// ──────────────────────────────────────────────
// Status labels
// ──────────────────────────────────────────────

describe("regression — Phase 2 code-review fixes", () => {
  it("deriveFamiliarity does not collapse to 0 for tier-2-only relationships", () => {
    // Pre-fix: turnsSinceLastEvent returns POSITIVE_INFINITY when tier-1 is
    // empty, Infinity * 0.5 = Infinity, subtracted from finite sqrt → clamps
    // to 0. A character with rich tier-2 history would read as a stranger.
    const r = relationship([], {
      sessionSummaries: [
        {
          sessionId: "s-old",
          startedAt: "2026-01-01T00:00:00Z",
          endedAt: "2026-01-01T12:00:00Z",
          eventCount: 20,
          tally: {
            minor: { positive: 5, negative: 1, neutral: 2 },
            moderate: { positive: 6, negative: 2, neutral: 0 },
            major: { positive: 3, negative: 1, neutral: 0 },
          },
          initiatorTally: { persona: 10, character: 8, mutual: 2, external: 0 },
          highlights: [],
          netValence: 30,
        },
      ],
    });
    expect(deriveFamiliarity(r, ctx.currentTurn)).toBeGreaterThan(0);
  });

  it("combinedTally includes preservedEvents — dimensional metrics survive milestone preservation", () => {
    // Pre-fix: combinedTally skipped preservedEvents, so an event that
    // triggered a milestone latch (and moved to preservedEvents) dropped out
    // of affinity/trust/valenceTally, producing a discontinuous drop.
    const preserved = event({
      magnitude: "major",
      valence: "positive",
      initiator: "character",
    });
    const withInTier1 = relationship([preserved]);
    const withPreserved = relationship([], { preservedEvents: [preserved] });

    expect(valenceTally(withPreserved)).toEqual(valenceTally(withInTier1));
    expect(magnitudeTally(withPreserved)).toEqual(magnitudeTally(withInTier1));
    expect(deriveTrust(withPreserved)).toBe(deriveTrust(withInTier1));
    // The Phase 2 fix was incomplete — these two have separate per-event
    // loops outside combinedTally and ALSO need preservedEvents inclusion.
    expect(deriveAffinity(withPreserved, ctx.currentSession)).toBe(
      deriveAffinity(withInTier1, ctx.currentSession),
    );
    expect(lifetimeValence(withPreserved)).toBe(lifetimeValence(withInTier1));
  });

  it("recentValence, currentStreak, longestStreak all include preservedEvents", () => {
    // Same follow-on omission pattern: per-event loops that didn't read
    // preservedEvents were producing inconsistent results across the rollup
    // boundary.
    const preserved = event({
      magnitude: "moderate",
      valence: "negative",
      at: "2026-05-31T00:00:01Z",
    });
    const inTier1 = relationship([preserved]);
    const inPreserved = relationship([], { preservedEvents: [preserved] });

    expect(recentValence(inPreserved)).toBe(recentValence(inTier1));
    expect(currentStreak(inPreserved)).toEqual(currentStreak(inTier1));
    expect(longestStreak(inPreserved)).toBe(longestStreak(inTier1));
  });

  it("combinedInitiatorTally includes preservedEvents", () => {
    const preserved = event({
      magnitude: "major",
      valence: "negative",
      initiator: "character",
    });
    const r = relationship([], { preservedEvents: [preserved] });
    expect(initiatorTally(r).character).toBe(1);
  });
});

describe("status labels", () => {
  it("stranger when familiarity is very low", () => {
    const r = relationship();
    expect(deriveStatus(r, ctx)).toBe("stranger");
  });

  it("friend when affinity and trust are positive and familiarity moderate", () => {
    const r = relationship(
      Array.from({ length: 12 }, () =>
        event({ magnitude: "major", valence: "positive", initiator: "persona" }),
      ),
    );
    const status = deriveStatus(r, ctx);
    expect(["friend", "close"]).toContain(status);
  });

  it("rival when affinity and trust are both deeply negative", () => {
    const r = relationship(
      Array.from({ length: 8 }, () =>
        event({ magnitude: "major", valence: "negative" }),
      ),
    );
    expect(deriveStatus(r, ctx)).toBe("rival");
  });
});
