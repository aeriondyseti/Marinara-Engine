import assert from "node:assert/strict";
import { test } from "node:test";

import type { GameNpc } from "@marinara-engine/shared";

import { applyReputationChange, getReputationTier } from "../reputation.service.js";

function npc(overrides: Partial<GameNpc> = {}): GameNpc {
  return {
    id: "npc-1",
    name: "Kaeya",
    emoji: "🧊",
    description: "",
    location: "Mondstadt",
    reputation: 0,
    notes: [],
    ...overrides,
  };
}

test("getReputationTier is inclusive at each lower bound", () => {
  assert.equal(getReputationTier(100), "devoted");
  assert.equal(getReputationTier(80), "devoted");
  assert.equal(getReputationTier(79), "allied");
  assert.equal(getReputationTier(50), "allied");
  assert.equal(getReputationTier(49), "friendly");
  assert.equal(getReputationTier(20), "friendly");
  assert.equal(getReputationTier(19), "neutral");
  assert.equal(getReputationTier(0), "neutral");
  assert.equal(getReputationTier(-20), "neutral");
  assert.equal(getReputationTier(-21), "unfriendly");
  assert.equal(getReputationTier(-50), "unfriendly");
  assert.equal(getReputationTier(-51), "hostile");
  assert.equal(getReputationTier(-80), "hostile");
  assert.equal(getReputationTier(-81), "enemy");
  assert.equal(getReputationTier(-100), "enemy");
});

test("applyReputationChange uses the action modifier and clamps to [-100, 100]", () => {
  const res = applyReputationChange(npc({ reputation: 10 }), "helped"); // +15
  assert.equal(res.change, 15);
  assert.equal(res.npc.reputation, 25);
  assert.equal(res.newTier, "friendly");

  assert.equal(applyReputationChange(npc({ reputation: 95 }), "allied").npc.reputation, 100); // +30 clamps high
  assert.equal(applyReputationChange(npc({ reputation: -90 }), "betrayed").npc.reputation, -100); // -40 clamps low
});

test("applyReputationChange treats unknown actions as 0 and honors a custom modifier", () => {
  const unknown = applyReputationChange(npc({ reputation: 5 }), "high-fived");
  assert.equal(unknown.change, 0);
  assert.equal(unknown.npc.reputation, 5);

  const custom = applyReputationChange(npc({ reputation: 0 }), "anything", -7);
  assert.equal(custom.change, -7);
  assert.equal(custom.npc.reputation, -7);
});

test("applyReputationChange appends a note and emits a milestone on a tier crossing", () => {
  const res = applyReputationChange(npc({ reputation: 18, notes: ["existing"] }), "helped"); // 18→33: neutral→friendly
  assert.equal(res.npc.notes[0], "existing", "prior notes are preserved");
  assert.ok(
    res.npc.notes.some((n) => n.includes("[helped]") && n.includes("→ 33")),
    "an audit note records the action and new value",
  );
  assert.ok(res.milestone);
  assert.equal(res.milestone!.previousTier, "neutral");
  assert.equal(res.milestone!.newTier, "friendly");
  assert.equal(res.milestone!.direction, "improved");
  assert.ok(res.npc.notes.some((n) => n.includes("Milestone")));
});

test("applyReputationChange reports no milestone when the tier is unchanged", () => {
  const res = applyReputationChange(npc({ reputation: 0 }), "met"); // +3, still neutral
  assert.equal(res.milestone, null);
  assert.equal(res.npc.reputation, 3);
});
