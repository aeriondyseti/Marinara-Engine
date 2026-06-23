import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addMinutes,
  advanceTime,
  createInitialTime,
  formatGameTime,
  getTimeOfDay,
  setTimeOfDay,
} from "../time.service.js";

test("getTimeOfDay buckets each hour into the right label", () => {
  const expected: Array<[number, string]> = [
    [0, "midnight"],
    [4, "midnight"],
    [5, "dawn"],
    [6, "dawn"],
    [7, "morning"],
    [11, "morning"],
    [12, "afternoon"],
    [16, "afternoon"],
    [17, "evening"],
    [19, "evening"],
    [20, "night"],
    [23, "night"],
  ];
  for (const [hour, label] of expected) assert.equal(getTimeOfDay(hour), label, `hour ${hour}`);
});

test("addMinutes carries minutes into hours and days, clamping day to >= 1", () => {
  assert.deepEqual(addMinutes({ day: 1, hour: 8, minute: 0 }, 45), { day: 1, hour: 8, minute: 45 });
  assert.deepEqual(addMinutes({ day: 1, hour: 23, minute: 30 }, 60), { day: 2, hour: 0, minute: 30 });
  assert.deepEqual(addMinutes({ day: 1, hour: 8, minute: 0 }, 0), { day: 1, hour: 8, minute: 0 });
});

test("advanceTime uses the per-action duration table and falls back to default", () => {
  assert.deepEqual(advanceTime({ day: 1, hour: 8, minute: 0 }, "explore"), { day: 1, hour: 8, minute: 30 });
  assert.deepEqual(advanceTime({ day: 1, hour: 8, minute: 0 }, "rest_long"), { day: 1, hour: 16, minute: 0 });
  assert.deepEqual(advanceTime({ day: 1, hour: 8, minute: 0 }, "unmapped-action"), { day: 1, hour: 8, minute: 15 });
});

test("setTimeOfDay is a no-op for the same label and rolls the day when jumping backward", () => {
  const morning = { day: 1, hour: 8, minute: 0 };
  assert.deepEqual(setTimeOfDay(morning, "morning"), morning, "same label keeps the clock");
  assert.deepEqual(setTimeOfDay(morning, "evening"), { day: 1, hour: 18, minute: 0 }, "forward jump stays same day");
  assert.deepEqual(
    setTimeOfDay({ day: 1, hour: 18, minute: 0 }, "morning"),
    { day: 2, hour: 8, minute: 0 },
    "backward jump advances the day",
  );
});

test("formatGameTime and createInitialTime render the expected shapes", () => {
  assert.equal(formatGameTime({ day: 2, hour: 9, minute: 5 }), "Day 2, 09:05 (morning)");
  assert.equal(formatGameTime({ day: 1, hour: 0, minute: 0 }), "Day 1, 00:00 (midnight)");
  assert.deepEqual(createInitialTime(), { day: 1, hour: 8, minute: 0 });
});
