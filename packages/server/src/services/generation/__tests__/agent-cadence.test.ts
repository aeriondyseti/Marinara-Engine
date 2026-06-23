import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveAgentRunInterval, shouldSkipAgentByAssistantInterval } from "../agent-cadence.js";

test("resolveAgentRunInterval reads runInterval (number or string) and clamps to [1, 100]", () => {
  assert.equal(resolveAgentRunInterval({ runInterval: 3 }, 1), 3);
  assert.equal(resolveAgentRunInterval({ runInterval: "5" }, 1), 5);
  assert.equal(resolveAgentRunInterval({ runInterval: 3.9 }, 1), 3, "floored");
  assert.equal(resolveAgentRunInterval({ runInterval: 9999 }, 1), 100, "clamped high");
});

test("resolveAgentRunInterval falls back when runInterval is missing or invalid", () => {
  assert.equal(resolveAgentRunInterval({}, 7), 7);
  assert.equal(resolveAgentRunInterval(null, 4), 4);
  assert.equal(resolveAgentRunInterval({ runInterval: 0 }, 2), 2, "0 is below the minimum → fallback");
  assert.equal(resolveAgentRunInterval({ runInterval: "nope" }, 6), 6);
});

test("resolveAgentRunInterval normalizes the fallback itself", () => {
  assert.equal(resolveAgentRunInterval({}, 0), 1, "fallback clamps up to 1");
  assert.equal(resolveAgentRunInterval({}, 9999), 100, "fallback clamps down to 100");
  assert.equal(resolveAgentRunInterval({}, Number.NaN), 1, "non-finite fallback → 1");
});

const storeReturning = (messageId: string | null) => ({
  getLastSuccessfulRunByType: async () => (messageId === null ? null : { messageId }),
});

test("shouldSkipAgentByAssistantInterval never skips when the interval is <= 1", async () => {
  const skip = await shouldSkipAgentByAssistantInterval({
    agentsStore: storeReturning("m1"),
    chatId: "c1",
    agentType: "world-state",
    settings: { runInterval: 1 },
    fallbackInterval: 1,
    messages: [],
  });
  assert.equal(skip, false);
});

test("shouldSkipAgentByAssistantInterval skips until enough assistant turns have passed", async () => {
  const messages = [
    { id: "m1", role: "assistant" },
    { id: "m2", role: "user" },
    { id: "m3", role: "assistant" },
  ];
  // Last run was at m1; one assistant turn since (m3) → 1 + 1 = 2 < 3 → skip.
  assert.equal(
    await shouldSkipAgentByAssistantInterval({
      agentsStore: storeReturning("m1"),
      chatId: "c1",
      agentType: "world-state",
      settings: { runInterval: 3 },
      fallbackInterval: 1,
      messages,
    }),
    true,
  );
  // Two assistant turns since the run → 2 + 1 = 3, not < 3 → run (don't skip).
  const messagesTwoSince = [
    { id: "m1", role: "assistant" },
    { id: "m2", role: "assistant" },
    { id: "m3", role: "assistant" },
  ];
  assert.equal(
    await shouldSkipAgentByAssistantInterval({
      agentsStore: storeReturning("m1"),
      chatId: "c1",
      agentType: "world-state",
      settings: { runInterval: 3 },
      fallbackInterval: 1,
      messages: messagesTwoSince,
    }),
    false,
  );
});

test("shouldSkipAgentByAssistantInterval does not skip when there is no prior run", async () => {
  assert.equal(
    await shouldSkipAgentByAssistantInterval({
      agentsStore: storeReturning(null),
      chatId: "c1",
      agentType: "world-state",
      settings: { runInterval: 5 },
      fallbackInterval: 1,
      messages: [{ id: "m1", role: "assistant" }],
    }),
    false,
  );
});
