import assert from "node:assert/strict";
import { test } from "node:test";

import { attributeModifier, getGoverningAttribute, mapSheetAttributesToRPG } from "../skill-check.service.js";

// resolveSkillCheck() rolls a real d20 (Math.random) and is intentionally not
// unit-tested here; only its deterministic helpers are covered.

test("attributeModifier is the D&D floor((score - 10) / 2)", () => {
  assert.equal(attributeModifier(10), 0);
  assert.equal(attributeModifier(12), 1);
  assert.equal(attributeModifier(8), -1);
  assert.equal(attributeModifier(15), 2);
  assert.equal(attributeModifier(7), -2);
  assert.equal(attributeModifier(20), 5);
  assert.equal(attributeModifier(1), -5);
});

test("getGoverningAttribute normalizes the skill name and maps it, defaulting to int", () => {
  assert.equal(getGoverningAttribute("Perception"), "wis");
  assert.equal(getGoverningAttribute("stealth"), "dex");
  assert.equal(getGoverningAttribute("Athletics"), "str");
  assert.equal(getGoverningAttribute("Persuasion"), "cha");
  assert.equal(getGoverningAttribute("Sleight of Hand"), "dex");
  assert.equal(getGoverningAttribute("Perception check"), "wis", "trailing 'check' is stripped");
  assert.equal(getGoverningAttribute("Strength saving throw"), "str", "trailing 'saving throw' is stripped");
  assert.equal(getGoverningAttribute("Underwater Basket Weaving"), "int", "unknown skill → int");
});

test("mapSheetAttributesToRPG maps known names (case-insensitive), coerces numbers, drops junk", () => {
  assert.deepEqual(
    mapSheetAttributesToRPG([
      { name: "STR", value: 15 },
      { name: "Dexterity", value: 12 },
      { name: "bogus", value: 5 },
      { name: "CON", value: Number.NaN },
    ]),
    { str: 15, dex: 12 },
  );
  assert.deepEqual(mapSheetAttributesToRPG(null), {});
  assert.deepEqual(mapSheetAttributesToRPG(undefined), {});
});
