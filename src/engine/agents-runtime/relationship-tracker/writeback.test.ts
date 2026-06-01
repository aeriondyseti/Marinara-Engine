import { describe, expect, it } from "vitest";
import type { RelationshipEventProposal } from "../../contracts/types/agent";
import type {
  CharacterRelationship,
  RelationshipEventRecord,
  RelationshipLifetimeAggregate,
} from "../../contracts/types/character";
import {
  applyEventToRelationship,
  DEFAULT_APPROVAL_SETTINGS,
  isFirstEventInChatId,
  resolveApprovalSettings,
  routeProposal,
  runSessionRollup,
  summarizeRouting,
  undoAppliedEvent,
} from "./writeback";

// ──────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────

function proposal(
  overrides: Partial<RelationshipEventProposal> = {},
): RelationshipEventProposal {
  return {
    characterId: "char_a",
    personaId: "persona_x",
    magnitude: "minor",
    valence: "positive",
    initiator: "persona",
    confidence: "high",
    description: "you smiled at me",
    ...overrides,
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

function emptyRel(personaId = "persona_x"): CharacterRelationship {
  return {
    personaId,
    events: [],
    sessionSummaries: [],
    lifetime: emptyLifetime(),
    preservedEvents: [],
    lastChatId: "",
    updatedAt: "",
  };
}

function eventRec(
  overrides: Partial<RelationshipEventRecord> &
    Pick<RelationshipEventRecord, "magnitude" | "valence" | "at" | "chatId">,
): RelationshipEventRecord {
  return {
    at: overrides.at,
    chatId: overrides.chatId,
    magnitude: overrides.magnitude,
    valence: overrides.valence,
    initiator: overrides.initiator ?? "persona",
    confidence: overrides.confidence ?? "high",
    description: overrides.description ?? "default",
  };
}

// ──────────────────────────────────────────────
// routeProposal
// ──────────────────────────────────────────────

describe("routeProposal — mandatory-queue overrides", () => {
  it("low confidence always queues, even in 'auto' mode", () => {
    const decision = routeProposal(proposal({ confidence: "low" }), {
      mode: "auto",
      isFirstEventInChat: false,
    });
    expect(decision.kind).toBe("queue");
    if (decision.kind === "queue") expect(decision.reason).toBe("low_confidence");
  });

  it("first event in chat always queues, even in 'auto' mode with high confidence", () => {
    const decision = routeProposal(
      proposal({ confidence: "high", magnitude: "minor" }),
      { mode: "auto", isFirstEventInChat: true },
    );
    expect(decision.kind).toBe("queue");
    if (decision.kind === "queue") expect(decision.reason).toBe("first_event_in_chat");
  });

  it("low confidence reason takes precedence over first-event reason", () => {
    const decision = routeProposal(
      proposal({ confidence: "low" }),
      { mode: "auto", isFirstEventInChat: true },
    );
    expect(decision.kind).toBe("queue");
    if (decision.kind === "queue") expect(decision.reason).toBe("low_confidence");
  });
});

describe("routeProposal — mode: manual", () => {
  it("queues everything", () => {
    const decision = routeProposal(proposal(), {
      mode: "manual",
      isFirstEventInChat: false,
    });
    expect(decision.kind).toBe("queue");
    if (decision.kind === "queue") expect(decision.reason).toBe("mode_manual");
  });
});

describe("routeProposal — mode: significant", () => {
  it("auto-applies minor + high confidence", () => {
    const decision = routeProposal(
      proposal({ magnitude: "minor", confidence: "high" }),
      { mode: "significant", isFirstEventInChat: false },
    );
    expect(decision.kind).toBe("auto_apply");
  });

  it("queues moderate", () => {
    const decision = routeProposal(
      proposal({ magnitude: "moderate", confidence: "high" }),
      { mode: "significant", isFirstEventInChat: false },
    );
    expect(decision.kind).toBe("queue");
    if (decision.kind === "queue") expect(decision.reason).toBe("significant_magnitude");
  });

  it("queues major", () => {
    const decision = routeProposal(
      proposal({ magnitude: "major", confidence: "high" }),
      { mode: "significant", isFirstEventInChat: false },
    );
    expect(decision.kind).toBe("queue");
  });

  it("queues minor + medium confidence with the medium_confidence reason (not significant_magnitude)", () => {
    const decision = routeProposal(
      proposal({ magnitude: "minor", confidence: "medium" }),
      { mode: "significant", isFirstEventInChat: false },
    );
    expect(decision.kind).toBe("queue");
    if (decision.kind === "queue") {
      expect(decision.reason).toBe("medium_confidence_in_significant_mode");
    }
  });

  it("queues moderate with the significant_magnitude reason", () => {
    const decision = routeProposal(
      proposal({ magnitude: "moderate", confidence: "high" }),
      { mode: "significant", isFirstEventInChat: false },
    );
    expect(decision.kind).toBe("queue");
    if (decision.kind === "queue") {
      expect(decision.reason).toBe("significant_magnitude");
    }
  });
});

describe("routeProposal — mode: auto", () => {
  it("auto-applies minor", () => {
    const decision = routeProposal(
      proposal({ magnitude: "minor" }),
      { mode: "auto", isFirstEventInChat: false },
    );
    expect(decision.kind).toBe("auto_apply");
  });

  it("auto-applies moderate", () => {
    const decision = routeProposal(
      proposal({ magnitude: "moderate" }),
      { mode: "auto", isFirstEventInChat: false },
    );
    expect(decision.kind).toBe("auto_apply");
  });

  it("auto-applies major (high confidence)", () => {
    const decision = routeProposal(
      proposal({ magnitude: "major" }),
      { mode: "auto", isFirstEventInChat: false },
    );
    expect(decision.kind).toBe("auto_apply");
  });

  it("low confidence still queues", () => {
    const decision = routeProposal(
      proposal({ confidence: "low" }),
      { mode: "auto", isFirstEventInChat: false },
    );
    expect(decision.kind).toBe("queue");
  });
});

describe("summarizeRouting", () => {
  it("counts auto-apply vs queued across many proposals", () => {
    const result = summarizeRouting([
      // Auto in "significant": minor + high
      { proposal: proposal(), ctx: { mode: "significant", isFirstEventInChat: false } },
      // Queue: moderate
      {
        proposal: proposal({ magnitude: "moderate" }),
        ctx: { mode: "significant", isFirstEventInChat: false },
      },
      // Queue: low confidence
      {
        proposal: proposal({ confidence: "low" }),
        ctx: { mode: "significant", isFirstEventInChat: false },
      },
      // Queue: first event in chat
      { proposal: proposal(), ctx: { mode: "auto", isFirstEventInChat: true } },
    ]);
    expect(result).toEqual({ autoApply: 1, queued: 3 });
  });
});

// ──────────────────────────────────────────────
// applyEventToRelationship
// ──────────────────────────────────────────────

describe("applyEventToRelationship", () => {
  it("creates a fresh relationship when rel is null", () => {
    const next = applyEventToRelationship(null, proposal(), {
      at: "2026-05-31T00:00:01Z",
      chatId: "chat-1",
    });
    expect(next.events).toHaveLength(1);
    expect(next.events[0].description).toBe("you smiled at me");
    expect(next.events[0].at).toBe("2026-05-31T00:00:01Z");
    expect(next.events[0].chatId).toBe("chat-1");
    expect(next.lastChatId).toBe("chat-1");
    expect(next.personaId).toBe("persona_x");
  });

  it("appends to existing events array", () => {
    const existing = emptyRel();
    existing.events.push(
      eventRec({
        magnitude: "minor",
        valence: "positive",
        at: "2026-05-31T00:00:00Z",
        chatId: "chat-1",
      }),
    );
    const next = applyEventToRelationship(existing, proposal(), {
      at: "2026-05-31T00:00:01Z",
      chatId: "chat-1",
    });
    expect(next.events).toHaveLength(2);
  });

  it("does not mutate the input relationship", () => {
    const existing = emptyRel();
    const before = JSON.stringify(existing);
    applyEventToRelationship(existing, proposal(), {
      at: "2026-05-31T00:00:01Z",
      chatId: "chat-1",
    });
    expect(JSON.stringify(existing)).toBe(before);
  });

  it("stamps lastChatId and updatedAt from options", () => {
    const next = applyEventToRelationship(emptyRel(), proposal(), {
      at: "2026-05-31T00:00:01Z",
      chatId: "chat-2",
    });
    expect(next.lastChatId).toBe("chat-2");
    expect(next.updatedAt).toBe("2026-05-31T00:00:01Z");
  });
});

// ──────────────────────────────────────────────
// runSessionRollup
// ──────────────────────────────────────────────

describe("runSessionRollup", () => {
  it("returns rel unchanged when no events match closingChatId", () => {
    const rel = emptyRel();
    rel.events.push(
      eventRec({
        magnitude: "minor",
        valence: "positive",
        at: "2026-05-31T00:00:01Z",
        chatId: "chat-current",
      }),
    );
    const result = runSessionRollup(rel, {
      closingChatId: "chat-old",
      hotEventWindow: 30,
      sessionHistoryWindow: 50,
      highlightsKept: 2,
    });
    expect(result).toBe(rel); // identity preserved on no-op
  });

  it("moves closing-session events into a session summary", () => {
    const rel = emptyRel();
    rel.events.push(
      eventRec({
        magnitude: "minor",
        valence: "positive",
        at: "2026-05-31T00:00:01Z",
        chatId: "chat-old",
      }),
      eventRec({
        magnitude: "moderate",
        valence: "negative",
        at: "2026-05-31T00:00:02Z",
        chatId: "chat-old",
      }),
      eventRec({
        magnitude: "minor",
        valence: "positive",
        at: "2026-05-31T00:00:03Z",
        chatId: "chat-current",
      }),
    );

    const result = runSessionRollup(rel, {
      closingChatId: "chat-old",
      hotEventWindow: 30,
      sessionHistoryWindow: 50,
      highlightsKept: 2,
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].chatId).toBe("chat-current");
    expect(result.sessionSummaries).toHaveLength(1);
    expect(result.sessionSummaries[0].sessionId).toBe("chat-old");
    expect(result.sessionSummaries[0].eventCount).toBe(2);
  });

  it("preserves milestone-triggering events; they bypass the summary", () => {
    const rel = emptyRel();
    rel.events.push(
      eventRec({
        magnitude: "major",
        valence: "positive",
        initiator: "character",
        at: "2026-05-31T00:00:01Z",
        chatId: "chat-old",
        description: "I told you about my mother",
      }),
      eventRec({
        magnitude: "minor",
        valence: "neutral",
        at: "2026-05-31T00:00:02Z",
        chatId: "chat-old",
      }),
    );

    const result = runSessionRollup(rel, {
      closingChatId: "chat-old",
      hotEventWindow: 30,
      sessionHistoryWindow: 50,
      highlightsKept: 2,
    });

    expect(result.preservedEvents).toHaveLength(1);
    expect(result.preservedEvents[0].description).toBe("I told you about my mother");
    expect(result.sessionSummaries[0].eventCount).toBe(1); // only the minor event
    expect(result.lifetime.latchedMilestones.has_been_seriously_helped).toBeDefined();
    expect(result.lifetime.latchedMilestones.has_been_vulnerable_with).toBeDefined();
  });

  it("collapses oldest summary into lifetime when window exceeded", () => {
    // Seed the relationship with 5 existing summaries.
    const rel = emptyRel();
    for (let i = 0; i < 5; i += 1) {
      rel.sessionSummaries.push({
        sessionId: `chat-${i}`,
        startedAt: `2026-01-0${i + 1}T00:00:00Z`,
        endedAt: `2026-01-0${i + 1}T12:00:00Z`,
        eventCount: 1,
        tally: {
          minor: { positive: 1, negative: 0, neutral: 0 },
          moderate: { positive: 0, negative: 0, neutral: 0 },
          major: { positive: 0, negative: 0, neutral: 0 },
        },
        initiatorTally: { persona: 1, character: 0, mutual: 0, external: 0 },
        highlights: [],
        netValence: 1,
      });
    }
    // Plus a new event in the closing session.
    rel.events.push(
      eventRec({
        magnitude: "minor",
        valence: "positive",
        at: "2026-05-31T00:00:01Z",
        chatId: "chat-closing",
      }),
    );

    // Window of 5 → after adding the new summary (total 6), oldest collapses.
    const result = runSessionRollup(rel, {
      closingChatId: "chat-closing",
      hotEventWindow: 30,
      sessionHistoryWindow: 5,
      highlightsKept: 2,
    });

    expect(result.sessionSummaries).toHaveLength(5);
    expect(result.sessionSummaries[0].sessionId).toBe("chat-1"); // chat-0 collapsed
    expect(result.lifetime.totalEventCount).toBe(1); // chat-0's eventCount merged in
  });

  it("does not mutate the input relationship", () => {
    const rel = emptyRel();
    rel.events.push(
      eventRec({
        magnitude: "minor",
        valence: "positive",
        at: "2026-05-31T00:00:01Z",
        chatId: "chat-old",
      }),
    );
    const before = JSON.stringify(rel);
    runSessionRollup(rel, {
      closingChatId: "chat-old",
      hotEventWindow: 30,
      sessionHistoryWindow: 50,
      highlightsKept: 2,
    });
    expect(JSON.stringify(rel)).toBe(before);
  });
});

// ──────────────────────────────────────────────
// undoAppliedEvent
// ──────────────────────────────────────────────

describe("undoAppliedEvent", () => {
  it("removes the matching event from tier-1", () => {
    const rel = emptyRel();
    rel.events.push(
      eventRec({
        magnitude: "minor",
        valence: "positive",
        at: "2026-05-31T00:00:01Z",
        chatId: "chat-1",
      }),
      eventRec({
        magnitude: "minor",
        valence: "negative",
        at: "2026-05-31T00:00:02Z",
        chatId: "chat-1",
      }),
    );
    const result = undoAppliedEvent(rel, {
      at: "2026-05-31T00:00:01Z",
      chatId: "chat-1",
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].valence).toBe("negative");
  });

  it("returns input unchanged when no match", () => {
    const rel = emptyRel();
    rel.events.push(
      eventRec({
        magnitude: "minor",
        valence: "positive",
        at: "2026-05-31T00:00:01Z",
        chatId: "chat-1",
      }),
    );
    const result = undoAppliedEvent(rel, {
      at: "2026-05-31T99:99:99Z",
      chatId: "chat-1",
    });
    expect(result).toBe(rel); // identity preserved on no-op
  });

  it("does not search preservedEvents (milestone events stay)", () => {
    const rel = emptyRel();
    rel.preservedEvents.push(
      eventRec({
        magnitude: "major",
        valence: "positive",
        at: "2026-05-31T00:00:01Z",
        chatId: "chat-1",
      }),
    );
    const result = undoAppliedEvent(rel, {
      at: "2026-05-31T00:00:01Z",
      chatId: "chat-1",
    });
    expect(result).toBe(rel); // unchanged — preservedEvents not in scope for undo
    expect(result.preservedEvents).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────
// Phase 6 review fixes — regression tests
// ──────────────────────────────────────────────

describe("regression — Phase 6 review fixes", () => {
  it("DEFAULT_APPROVAL_SETTINGS is frozen", () => {
    expect(Object.isFrozen(DEFAULT_APPROVAL_SETTINGS)).toBe(true);
  });

  it("resolveApprovalSettings merges partials over defaults", () => {
    const settings = resolveApprovalSettings({ approvalMode: "auto" });
    expect(settings.approvalMode).toBe("auto");
    expect(settings.hotEventWindow).toBe(DEFAULT_APPROVAL_SETTINGS.hotEventWindow);
    expect(settings.sessionHistoryWindow).toBe(DEFAULT_APPROVAL_SETTINGS.sessionHistoryWindow);
  });

  it("resolveApprovalSettings handles null/undefined input", () => {
    const a = resolveApprovalSettings(null);
    const b = resolveApprovalSettings(undefined);
    expect(a.approvalMode).toBe("significant");
    expect(b.approvalMode).toBe("significant");
  });

  it("applyEventToRelationship does not regress updatedAt backward", () => {
    const rel = emptyRel();
    const future = applyEventToRelationship(rel, proposal(), {
      at: "2026-06-01T00:00:00Z",
      chatId: "chat-1",
    });
    expect(future.updatedAt).toBe("2026-06-01T00:00:00Z");
    // Now apply an older event — updatedAt should NOT regress to the past.
    const olderApplied = applyEventToRelationship(future, proposal(), {
      at: "2026-05-01T00:00:00Z",
      chatId: "chat-1",
    });
    expect(olderApplied.updatedAt).toBe("2026-06-01T00:00:00Z");
  });

  it("isFirstEventInChatId returns true for null rel", () => {
    expect(isFirstEventInChatId(null, "chat-1")).toBe(true);
  });

  it("isFirstEventInChatId returns true when no events match the chatId", () => {
    const rel = emptyRel();
    rel.events.push(
      eventRec({
        magnitude: "minor",
        valence: "positive",
        at: "2026-05-31T00:00:00Z",
        chatId: "chat-old",
      }),
    );
    expect(isFirstEventInChatId(rel, "chat-new")).toBe(true);
  });

  it("isFirstEventInChatId returns false when an event with that chatId already exists", () => {
    const rel = emptyRel();
    rel.events.push(
      eventRec({
        magnitude: "minor",
        valence: "positive",
        at: "2026-05-31T00:00:00Z",
        chatId: "chat-1",
      }),
    );
    expect(isFirstEventInChatId(rel, "chat-1")).toBe(false);
  });

  it("isFirstEventInChatId does NOT use lastChatId as a proxy", () => {
    // The lastChatId is "chat-1" but events is empty — could happen after a
    // manual reset. The correct answer is "yes, this would be a first event."
    const rel: ReturnType<typeof emptyRel> = { ...emptyRel(), lastChatId: "chat-1" };
    expect(isFirstEventInChatId(rel, "chat-1")).toBe(true);
  });

  it("runSessionRollup deep-copies latchedMilestones — caller can't mutate input", () => {
    const rel = emptyRel();
    rel.lifetime.latchedMilestones.has_been_seriously_helped = {
      triggeredAt: "2026-01-01T00:00:00Z",
      sessionId: "chat-original",
      description: "original description",
    };
    rel.events.push(
      eventRec({
        magnitude: "minor",
        valence: "positive",
        at: "2026-05-31T00:00:01Z",
        chatId: "chat-closing",
      }),
    );
    const result = runSessionRollup(rel, {
      closingChatId: "chat-closing",
      hotEventWindow: 30,
      sessionHistoryWindow: 50,
      highlightsKept: 2,
    });
    // Mutating the result must not affect the input.
    const resultLatch = result.lifetime.latchedMilestones.has_been_seriously_helped;
    expect(resultLatch).toBeDefined();
    resultLatch!.description = "MUTATED";
    expect(rel.lifetime.latchedMilestones.has_been_seriously_helped?.description).toBe(
      "original description",
    );
  });

  it("runSessionRollup honors hotEventWindow — trims tier-1 ring", () => {
    // 40 events across two non-closing chats. hotEventWindow=10 → 30 events
    // overflow and get rolled up as their own per-chat summaries.
    const rel = emptyRel();
    for (let i = 0; i < 20; i += 1) {
      rel.events.push(
        eventRec({
          magnitude: "minor",
          valence: "positive",
          at: `2026-05-31T00:00:${String(i).padStart(2, "0")}Z`,
          chatId: "chat-a",
        }),
      );
    }
    for (let i = 0; i < 20; i += 1) {
      rel.events.push(
        eventRec({
          magnitude: "minor",
          valence: "negative",
          at: `2026-05-31T01:00:${String(i).padStart(2, "0")}Z`,
          chatId: "chat-b",
        }),
      );
    }
    // No closing chat events — just trim the hot window.
    const result = runSessionRollup(rel, {
      closingChatId: "chat-nonexistent",
      hotEventWindow: 10,
      sessionHistoryWindow: 50,
      highlightsKept: 2,
    });
    // Tier-1 should now hold exactly hotEventWindow events.
    expect(result.events).toHaveLength(10);
    // Overflow got rolled into summaries — one per chat with overflow.
    expect(result.sessionSummaries.length).toBeGreaterThanOrEqual(1);
    const totalSummarized = result.sessionSummaries.reduce(
      (sum, s) => sum + s.eventCount,
      0,
    );
    expect(totalSummarized).toBe(30);
  });
});
