import { describe, expect, it } from "vitest";
import type {
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

function event(
  overrides: Partial<RelationshipEventRecord> & Pick<RelationshipEventRecord, "magnitude" | "valence">,
): RelationshipEventRecord {
  return {
    at: overrides.at ?? "2026-05-31T00:00:00Z",
    chatId: overrides.chatId ?? "chat-1",
    magnitude: overrides.magnitude,
    valence: overrides.valence,
    initiator: overrides.initiator ?? "persona",
    confidence: overrides.confidence ?? "high",
    description: overrides.description ?? "you did a thing",
  };
}

// ──────────────────────────────────────────────
// rollSessionToSummary
// ──────────────────────────────────────────────

describe("rollSessionToSummary", () => {
  it("empty events produce an empty summary", () => {
    const summary = rollSessionToSummary("chat-1", []);
    expect(summary.eventCount).toBe(0);
    expect(summary.tally.minor.positive).toBe(0);
    expect(summary.netValence).toBe(0);
    expect(summary.highlights).toEqual([]);
    expect(summary.startedAt).toBe("");
    expect(summary.endedAt).toBe("");
  });

  it("tallies by magnitude and valence losslessly", () => {
    const events = [
      event({ magnitude: "minor", valence: "positive", at: "2026-05-31T00:00:01Z" }),
      event({ magnitude: "minor", valence: "positive", at: "2026-05-31T00:00:02Z" }),
      event({ magnitude: "moderate", valence: "negative", at: "2026-05-31T00:00:03Z" }),
      event({ magnitude: "major", valence: "neutral", at: "2026-05-31T00:00:04Z" }),
    ];
    const summary = rollSessionToSummary("chat-1", events);
    expect(summary.eventCount).toBe(4);
    expect(summary.tally.minor.positive).toBe(2);
    expect(summary.tally.moderate.negative).toBe(1);
    expect(summary.tally.major.neutral).toBe(1);
  });

  it("tallies initiators", () => {
    const events = [
      event({ magnitude: "minor", valence: "positive", initiator: "persona" }),
      event({ magnitude: "minor", valence: "positive", initiator: "character" }),
      event({ magnitude: "minor", valence: "neutral", initiator: "mutual" }),
      event({ magnitude: "minor", valence: "negative", initiator: "external" }),
    ];
    const summary = rollSessionToSummary("chat-1", events);
    expect(summary.initiatorTally).toEqual({
      persona: 1,
      character: 1,
      mutual: 1,
      external: 1,
    });
  });

  it("computes netValence as weighted sum (matches fold's per-event weight × sign)", () => {
    const events = [
      event({ magnitude: "major", valence: "positive" }), // +16
      event({ magnitude: "moderate", valence: "negative" }), // -4
      event({ magnitude: "minor", valence: "neutral" }), // 0
    ];
    const summary = rollSessionToSummary("chat-1", events);
    expect(summary.netValence).toBe(12);
  });

  it("preserves highest-magnitude descriptions as highlights, default 2", () => {
    const events = [
      event({ magnitude: "minor", valence: "neutral", description: "we passed in the hall", at: "2026-05-31T00:00:01Z" }),
      event({ magnitude: "major", valence: "positive", description: "you saved my life", at: "2026-05-31T00:00:02Z" }),
      event({ magnitude: "moderate", valence: "negative", description: "you snapped at me", at: "2026-05-31T00:00:03Z" }),
      event({ magnitude: "minor", valence: "positive", description: "you nodded", at: "2026-05-31T00:00:04Z" }),
    ];
    const summary = rollSessionToSummary("chat-1", events);
    expect(summary.highlights).toEqual(["you saved my life", "you snapped at me"]);
  });

  it("honors configurable highlightsKept", () => {
    const events = [
      event({ magnitude: "major", valence: "positive", description: "a", at: "2026-05-31T00:00:01Z" }),
      event({ magnitude: "major", valence: "negative", description: "b", at: "2026-05-31T00:00:02Z" }),
      event({ magnitude: "moderate", valence: "positive", description: "c", at: "2026-05-31T00:00:03Z" }),
    ];
    expect(rollSessionToSummary("chat-1", events, 1).highlights).toEqual(["b"]);
    expect(rollSessionToSummary("chat-1", events, 0).highlights).toEqual([]);
    expect(rollSessionToSummary("chat-1", events, 5).highlights).toHaveLength(3);
  });

  it("records startedAt/endedAt from event timestamp range", () => {
    const events = [
      event({ magnitude: "minor", valence: "positive", at: "2026-05-31T00:00:05Z" }),
      event({ magnitude: "minor", valence: "positive", at: "2026-05-31T00:00:01Z" }),
      event({ magnitude: "minor", valence: "positive", at: "2026-05-31T00:00:03Z" }),
    ];
    const summary = rollSessionToSummary("chat-1", events);
    expect(summary.startedAt).toBe("2026-05-31T00:00:01Z");
    expect(summary.endedAt).toBe("2026-05-31T00:00:05Z");
  });

  it("is idempotent — running twice on the same input yields equivalent output", () => {
    const events = [
      event({ magnitude: "minor", valence: "positive" }),
      event({ magnitude: "major", valence: "negative" }),
    ];
    const a = rollSessionToSummary("chat-1", events);
    const b = rollSessionToSummary("chat-1", events);
    expect(a).toEqual(b);
  });
});

// ──────────────────────────────────────────────
// rollSummaryToLifetime
// ──────────────────────────────────────────────

describe("rollSummaryToLifetime", () => {
  it("merges tally and initiatorTally additively", () => {
    const lifetime = emptyLifetime();
    const summary: RelationshipSessionSummary = {
      sessionId: "chat-1",
      startedAt: "2026-05-31T00:00:00Z",
      endedAt: "2026-05-31T12:00:00Z",
      eventCount: 3,
      tally: {
        minor: { positive: 2, negative: 0, neutral: 0 },
        moderate: { positive: 0, negative: 1, neutral: 0 },
        major: { positive: 0, negative: 0, neutral: 0 },
      },
      initiatorTally: { persona: 2, character: 1, mutual: 0, external: 0 },
      highlights: ["x"],
      netValence: -2,
    };
    const merged = rollSummaryToLifetime(summary, lifetime);
    expect(merged.totalEventCount).toBe(3);
    expect(merged.tally.minor.positive).toBe(2);
    expect(merged.tally.moderate.negative).toBe(1);
    expect(merged.initiatorTally.persona).toBe(2);
  });

  it("sets firstEventAt to the summary's startedAt when lifetime is empty", () => {
    const lifetime = emptyLifetime();
    const summary: RelationshipSessionSummary = {
      sessionId: "chat-1",
      startedAt: "2026-05-31T00:00:00Z",
      endedAt: "2026-05-31T12:00:00Z",
      eventCount: 1,
      tally: { minor: { positive: 1, negative: 0, neutral: 0 }, moderate: { positive: 0, negative: 0, neutral: 0 }, major: { positive: 0, negative: 0, neutral: 0 } },
      initiatorTally: { persona: 1, character: 0, mutual: 0, external: 0 },
      highlights: [],
      netValence: 1,
    };
    const merged = rollSummaryToLifetime(summary, lifetime);
    expect(merged.firstEventAt).toBe("2026-05-31T00:00:00Z");
  });

  it("preserves the earliest firstEventAt across merges", () => {
    const lifetime: RelationshipLifetimeAggregate = {
      ...emptyLifetime(),
      firstEventAt: "2026-01-15T00:00:00Z",
    };
    const olderSummary: RelationshipSessionSummary = {
      sessionId: "chat-old",
      startedAt: "2025-12-01T00:00:00Z",
      endedAt: "2025-12-01T01:00:00Z",
      eventCount: 1,
      tally: { minor: { positive: 1, negative: 0, neutral: 0 }, moderate: { positive: 0, negative: 0, neutral: 0 }, major: { positive: 0, negative: 0, neutral: 0 } },
      initiatorTally: { persona: 1, character: 0, mutual: 0, external: 0 },
      highlights: [],
      netValence: 1,
    };
    const merged = rollSummaryToLifetime(olderSummary, lifetime);
    expect(merged.firstEventAt).toBe("2025-12-01T00:00:00Z");
  });

  it("does NOT touch latchedMilestones — those are managed by findMilestoneTriggers", () => {
    const lifetime: RelationshipLifetimeAggregate = {
      ...emptyLifetime(),
      latchedMilestones: {
        has_been_seriously_helped: { triggeredAt: "2026-01-01T00:00:00Z", sessionId: "chat-0", description: "old" },
      },
    };
    const summary: RelationshipSessionSummary = {
      sessionId: "chat-1",
      startedAt: "2026-05-31T00:00:00Z",
      endedAt: "2026-05-31T12:00:00Z",
      eventCount: 1,
      tally: { minor: { positive: 1, negative: 0, neutral: 0 }, moderate: { positive: 0, negative: 0, neutral: 0 }, major: { positive: 0, negative: 0, neutral: 0 } },
      initiatorTally: { persona: 1, character: 0, mutual: 0, external: 0 },
      highlights: [],
      netValence: 1,
    };
    const merged = rollSummaryToLifetime(summary, lifetime);
    expect(merged.latchedMilestones.has_been_seriously_helped).toEqual({
      triggeredAt: "2026-01-01T00:00:00Z",
      sessionId: "chat-0",
      description: "old",
    });
  });

  it("is idempotent in shape (running twice produces the expected double-counting because merge is additive)", () => {
    const lifetime = emptyLifetime();
    const summary: RelationshipSessionSummary = {
      sessionId: "chat-1",
      startedAt: "2026-05-31T00:00:00Z",
      endedAt: "2026-05-31T12:00:00Z",
      eventCount: 2,
      tally: { minor: { positive: 2, negative: 0, neutral: 0 }, moderate: { positive: 0, negative: 0, neutral: 0 }, major: { positive: 0, negative: 0, neutral: 0 } },
      initiatorTally: { persona: 2, character: 0, mutual: 0, external: 0 },
      highlights: [],
      netValence: 2,
    };
    // NOTE: merge is intentionally additive — calling it twice doubles the
    // counts. Idempotency is the caller's responsibility (only call once per
    // summary). This test pins that contract.
    const once = rollSummaryToLifetime(summary, lifetime);
    const twice = rollSummaryToLifetime(summary, once);
    expect(twice.totalEventCount).toBe(4);
    expect(twice.tally.minor.positive).toBe(4);
  });
});

// ──────────────────────────────────────────────
// findMilestoneTriggers
// ──────────────────────────────────────────────

describe("findMilestoneTriggers", () => {
  it("returns empty result when no events qualify", () => {
    const events = [event({ magnitude: "minor", valence: "positive" })];
    const result = findMilestoneTriggers(events, {});
    expect(result.toPreserve).toEqual([]);
    expect(result.toSummarize).toEqual(events);
    expect(result.newLatches).toEqual({});
  });

  it("latches has_been_seriously_helped on the first major+positive", () => {
    const e1 = event({ magnitude: "minor", valence: "positive", at: "2026-05-31T00:00:01Z" });
    const e2 = event({
      magnitude: "major",
      valence: "positive",
      at: "2026-05-31T00:00:02Z",
      description: "you saved me",
    });
    const result = findMilestoneTriggers([e1, e2], {});
    expect(result.toPreserve).toEqual([e2]);
    expect(result.toSummarize).toEqual([e1]);
    expect(result.newLatches.has_been_seriously_helped?.description).toBe("you saved me");
  });

  it("does NOT re-trigger an already-latched milestone", () => {
    const e1 = event({
      magnitude: "major",
      valence: "positive",
      at: "2026-05-31T00:00:01Z",
      description: "you saved me again",
    });
    const alreadyLatched = {
      has_been_seriously_helped: {
        triggeredAt: "2026-01-01T00:00:00Z",
        sessionId: "chat-old",
        description: "original save",
      },
    };
    const result = findMilestoneTriggers([e1], alreadyLatched);
    expect(result.newLatches.has_been_seriously_helped).toBeUndefined();
    expect(result.toPreserve).toEqual([]);
    // Even though no milestone triggered, the event must still be summarized.
    expect(result.toSummarize).toEqual([e1]);
  });

  it("a single event can latch multiple milestones (preserved once)", () => {
    const e = event({
      magnitude: "major",
      valence: "positive",
      initiator: "character",
      at: "2026-05-31T00:00:01Z",
      description: "I opened up about my mother",
    });
    const result = findMilestoneTriggers([e], {});
    expect(result.toPreserve).toEqual([e]); // preserved once, not twice
    expect(result.toSummarize).toEqual([]);
    expect(result.newLatches.has_been_seriously_helped).toBeDefined();
    expect(result.newLatches.has_been_vulnerable_with).toBeDefined();
  });

  it("preserves events in chronological order", () => {
    const e1 = event({
      magnitude: "major",
      valence: "negative",
      at: "2026-05-31T00:00:01Z",
      initiator: "persona",
    });
    const e2 = event({
      magnitude: "major",
      valence: "positive",
      at: "2026-05-31T00:00:02Z",
      initiator: "character",
    });
    const result = findMilestoneTriggers([e1, e2], {});
    expect(result.toPreserve[0].at).toBe("2026-05-31T00:00:01Z");
    expect(result.toPreserve[1].at).toBe("2026-05-31T00:00:02Z");
  });

  it("sorts events chronologically before scanning — input order doesn't matter", () => {
    // Two qualifying events for has_been_seriously_wronged; the chronologically
    // earlier one should latch. Test feeds them newest-first.
    const earlier = event({
      magnitude: "major",
      valence: "negative",
      at: "2026-05-31T00:00:01Z",
      description: "the EARLIER betrayal",
    });
    const later = event({
      magnitude: "major",
      valence: "negative",
      at: "2026-05-31T00:00:02Z",
      description: "the LATER betrayal",
    });
    const result = findMilestoneTriggers([later, earlier], {});
    expect(result.newLatches.has_been_seriously_wronged?.description).toBe("the EARLIER betrayal");
    expect(result.newLatches.has_been_seriously_wronged?.triggeredAt).toBe("2026-05-31T00:00:01Z");
  });

  it("toSummarize complement is computed alongside toPreserve — eliminates reference-equality filter risk", () => {
    // Caller pattern that used to be vulnerable to JSON round-trip:
    //   events.filter(e => !toPreserve.includes(e))
    // is now replaced by reading result.toSummarize directly.
    const milestone = event({
      magnitude: "major",
      valence: "positive",
      initiator: "character",
      at: "2026-05-31T00:00:01Z",
    });
    const filler = event({
      magnitude: "minor",
      valence: "neutral",
      at: "2026-05-31T00:00:02Z",
    });
    const result = findMilestoneTriggers([milestone, filler], {});
    expect(result.toPreserve).toEqual([milestone]);
    expect(result.toSummarize).toEqual([filler]);
    // Crucially: toPreserve.length + toSummarize.length === input.length
    expect(result.toPreserve.length + result.toSummarize.length).toBe(2);
  });

  it("is idempotent — re-running with the same input + already-latched produces empty toPreserve", () => {
    const e = event({
      magnitude: "major",
      valence: "positive",
      initiator: "character",
      description: "first",
    });
    const first = findMilestoneTriggers([e], {});
    const merged = { ...first.newLatches };
    const second = findMilestoneTriggers([e], merged);
    expect(second.toPreserve).toEqual([]);
    expect(second.toSummarize).toEqual([e]);
    expect(second.newLatches).toEqual({});
  });
});

// ──────────────────────────────────────────────
// shouldCollapseOldestSummary
// ──────────────────────────────────────────────

describe("regression — Phase 3 code-review fixes", () => {
  it("empty-string `at` does not poison startedAt/endedAt", () => {
    // Pre-fix: lexicographic '' is smaller than any non-empty string, so
    // an event with at='' would corrupt startedAt for any subsequent real
    // timestamp.
    const events = [
      event({ magnitude: "minor", valence: "positive", at: "" }),
      event({ magnitude: "minor", valence: "positive", at: "2026-05-31T00:00:01Z" }),
      event({ magnitude: "minor", valence: "positive", at: "2026-05-31T00:00:02Z" }),
    ];
    const summary = rollSessionToSummary("chat-1", events);
    expect(summary.startedAt).toBe("2026-05-31T00:00:01Z");
    expect(summary.endedAt).toBe("2026-05-31T00:00:02Z");
  });

  it("rollSummaryToLifetime preserves real firstEventAt against empty-session summary", () => {
    // Pre-fix: '' < 'real_iso' returned true in JS string comparison,
    // overwriting a populated lifetime.firstEventAt with empty string.
    const lifetime: RelationshipLifetimeAggregate = {
      ...emptyLifetime(),
      firstEventAt: "2026-01-01T00:00:00Z",
    };
    const emptySummary = rollSessionToSummary("chat-empty", []);
    expect(emptySummary.startedAt).toBe("");
    const merged = rollSummaryToLifetime(emptySummary, lifetime);
    expect(merged.firstEventAt).toBe("2026-01-01T00:00:00Z");
  });

  it("rollSummaryToLifetime deep-copies latchedMilestones — caller can't mutate the source", () => {
    // Pre-fix: shallow spread shared nested latch records with the input.
    const lifetime: RelationshipLifetimeAggregate = {
      ...emptyLifetime(),
      latchedMilestones: {
        has_been_seriously_helped: {
          triggeredAt: "2026-01-01T00:00:00Z",
          sessionId: "chat-0",
          description: "original",
        },
      },
    };
    const emptySummary = rollSessionToSummary("chat-empty", []);
    const merged = rollSummaryToLifetime(emptySummary, lifetime);
    // Mutating the merged copy must NOT affect the original.
    merged.latchedMilestones.has_been_seriously_helped!.description = "MUTATED";
    expect(lifetime.latchedMilestones.has_been_seriously_helped?.description).toBe("original");
  });

  it("highlight tie-break comparator returns 0 for equal timestamps (sort stability)", () => {
    // Pre-fix: comparator returned -1 for equal `at`, giving the sort
    // engine contradictory information. Now equal timestamps return 0.
    const a = event({
      magnitude: "major",
      valence: "positive",
      at: "2026-05-31T00:00:00Z",
      description: "alpha",
    });
    const b = event({
      magnitude: "major",
      valence: "negative",
      at: "2026-05-31T00:00:00Z",
      description: "beta",
    });
    // Both major, same timestamp. The sort must be stable — but stable
    // means "original order preserved for equal elements." With the fix
    // the comparator returns 0 so V8's stable sort preserves input order.
    const summary = rollSessionToSummary("chat-1", [a, b], 2);
    expect(summary.highlights).toEqual(["alpha", "beta"]);
  });
});

describe("shouldCollapseOldestSummary", () => {
  it("returns false below the window", () => {
    const summaries = [{ sessionId: "s1" }] as RelationshipSessionSummary[];
    expect(shouldCollapseOldestSummary(summaries, 50)).toBe(false);
  });

  it("returns false at the window", () => {
    const summaries = Array.from({ length: 50 }, (_, i) => ({ sessionId: `s${i}` })) as RelationshipSessionSummary[];
    expect(shouldCollapseOldestSummary(summaries, 50)).toBe(false);
  });

  it("returns true above the window", () => {
    const summaries = Array.from({ length: 51 }, (_, i) => ({ sessionId: `s${i}` })) as RelationshipSessionSummary[];
    expect(shouldCollapseOldestSummary(summaries, 50)).toBe(true);
  });
});
