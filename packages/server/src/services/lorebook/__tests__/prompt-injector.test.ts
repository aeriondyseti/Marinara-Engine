import assert from "node:assert/strict";
import { test } from "node:test";

import { applyTokenBudget, injectAtDepth, type PromptMessage } from "../prompt-injector.js";
import type { ActivatedEntry } from "../keyword-scanner.js";

const m = (content: string): PromptMessage => ({ role: "system", content });

const ae = (content: string, order: number, constant = false): ActivatedEntry =>
  ({ entry: { id: `e${order}`, name: "n", keys: [], content, order, constant }, matchedKeys: [] }) as ActivatedEntry;

test("injectAtDepth returns the input untouched when there are no entries", () => {
  const msgs = [m("a"), m("b")];
  assert.equal(injectAtDepth(msgs, []), msgs);
});

test("injectAtDepth places depth 0 at the end and deeper entries further back", () => {
  const msgs = [m("a"), m("b"), m("c")];

  const d0 = injectAtDepth(msgs, [{ content: "D0", role: "system", depth: 0 }]);
  assert.equal(d0.length, 4);
  assert.equal(d0[3]!.content, "D0");
  assert.equal(d0[3]!.contextKind, "injection");
  assert.deepEqual(d0.slice(0, 3).map((x) => x.content), ["a", "b", "c"]);

  const d1 = injectAtDepth(msgs, [{ content: "D1", role: "system", depth: 1 }]);
  assert.equal(d1.length, 4);
  assert.equal(d1[2]!.content, "D1", "depth 1 inserts just before the last message");
  assert.equal(d1[3]!.content, "c");
});

test("applyTokenBudget returns all entries for a non-positive budget", () => {
  const entries = [ae("x", 1)];
  assert.equal(applyTokenBudget(entries, 0), entries);
  assert.equal(applyTokenBudget(entries, -5), entries);
});

test("applyTokenBudget admits entries in order until ~4-chars-per-token budget is hit", () => {
  // each "aaaa" = 4 chars = 1 token
  const kept = applyTokenBudget([ae("aaaa", 1), ae("bbbb", 2), ae("cccc", 3)], 2);
  assert.equal(kept.length, 2, "third entry would exceed the 2-token budget");
  assert.deepEqual(kept.map((e) => e.entry.content), ["aaaa", "bbbb"]);
});

test("applyTokenBudget prioritizes constant entries regardless of order", () => {
  const normal = ae("abcdefgh", 1); // 8 chars → 2 tokens
  const constant = ae("ab", 9, true); // 2 chars → 1 token, but constant
  const kept = applyTokenBudget([normal, constant], 1);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.entry.constant, true, "the constant entry is kept under a tight budget");
});
