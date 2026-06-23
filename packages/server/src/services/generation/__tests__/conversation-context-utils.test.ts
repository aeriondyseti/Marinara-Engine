import assert from "node:assert/strict";
import { test } from "node:test";

import {
  areConversationSchedulesEnabled,
  getEnabledConversationSchedules,
  hasConversationSchedules,
  parseConversationStatusOverrides,
  parsePromptPresetChoices,
} from "../conversation-context-utils.js";

test("hasConversationSchedules is true only for a non-empty object", () => {
  assert.equal(hasConversationSchedules({ a: 1 }), true);
  assert.equal(hasConversationSchedules({}), false);
  assert.equal(hasConversationSchedules(null), false);
  assert.equal(hasConversationSchedules("nope"), false);
  assert.equal(hasConversationSchedules([]), false);
});

test("parseConversationStatusOverrides keeps only entries with a valid status and createdAt", () => {
  const out = parseConversationStatusOverrides({
    good: { status: "online", createdAt: "2026-01-01" },
    badStatus: { status: "elsewhere", createdAt: "2026-01-01" },
    noDate: { status: "idle" },
    notObject: "x",
  });
  assert.deepEqual(Object.keys(out), ["good"]);
  assert.deepEqual(parseConversationStatusOverrides(null), {});
  assert.deepEqual(parseConversationStatusOverrides([1, 2]), {});
});

test("parsePromptPresetChoices accepts string / string[] values, rejects everything else", () => {
  assert.deepEqual(parsePromptPresetChoices('{"k":"v","arr":["a","b"]}'), { k: "v", arr: ["a", "b"] });
  assert.deepEqual(parsePromptPresetChoices({ k: "v" }), { k: "v" });
  assert.equal(parsePromptPresetChoices('{"k":123}'), null, "non-string value → null");
  assert.equal(parsePromptPresetChoices('{"k":["a",1]}'), null, "mixed array → null");
  assert.equal(parsePromptPresetChoices("not json"), null);
  assert.equal(parsePromptPresetChoices([1, 2]), null);
});

test("areConversationSchedulesEnabled honors the explicit flag, else infers from schedules", () => {
  assert.equal(areConversationSchedulesEnabled({ conversationSchedulesEnabled: false, characterSchedules: { a: 1 } }), false);
  assert.equal(areConversationSchedulesEnabled({ conversationSchedulesEnabled: true }), true);
  assert.equal(areConversationSchedulesEnabled({ characterSchedules: { a: 1 } }), true, "no flag → infer from schedules");
  assert.equal(areConversationSchedulesEnabled({}), false);
});

test("getEnabledConversationSchedules returns schedules only when enabled and present", () => {
  assert.deepEqual(getEnabledConversationSchedules({ conversationSchedulesEnabled: true, characterSchedules: { a: 1 } }), {
    a: 1,
  });
  assert.deepEqual(getEnabledConversationSchedules({ conversationSchedulesEnabled: false, characterSchedules: { a: 1 } }), {});
  assert.deepEqual(getEnabledConversationSchedules({}), {});
});
