import assert from "node:assert/strict";
import { test } from "node:test";

import { isDiceNotation, rollDice } from "../dice.service.js";

test("isDiceNotation accepts NdM forms (optional count/modifier) and rejects junk", () => {
  for (const v of ["2d6", "d20", "4d8-1", "d20+3", "2D6", " 3d4 "]) assert.equal(isDiceNotation(v), true, v);
  for (const v of ["abc", "0d6", "2d0", "d", "5", ""]) assert.equal(isDiceNotation(v), false, v);
});

test("rollDice is exact for d1 dice (the only deterministic die) and applies the modifier", () => {
  assert.deepEqual(rollDice("3d1"), { notation: "3d1", rolls: [1, 1, 1], modifier: 0, total: 3 });
  assert.deepEqual(rollDice("2d1+5"), { notation: "2d1+5", rolls: [1, 1], modifier: 5, total: 7 });
  assert.deepEqual(rollDice("2d1-1"), { notation: "2d1-1", rolls: [1, 1], modifier: -1, total: 1 });
});

test("rollDice clamps the dice count to 100 and stays within bounds for real dice", () => {
  assert.equal(rollDice("200d1").rolls.length, 100, "count clamps to 100");

  const r = rollDice("2d6+3");
  assert.equal(r.rolls.length, 2);
  assert.equal(r.modifier, 3);
  for (const roll of r.rolls) assert.ok(roll >= 1 && roll <= 6, `roll ${roll} in 1..6`);
  assert.equal(r.total, r.rolls[0]! + r.rolls[1]! + 3);
});

test("rollDice throws on invalid notation", () => {
  assert.throws(() => rollDice("not-dice"), /Invalid dice notation/);
});
