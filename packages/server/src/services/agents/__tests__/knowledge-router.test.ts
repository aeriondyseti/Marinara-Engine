import assert from "node:assert/strict";
import { test } from "node:test";

import type { LorebookEntry } from "@marinara-engine/shared";

import { buildCatalog, formatCatalogForPrompt, parseRouterResponse } from "../knowledge-router.js";

const entry = (over: Partial<LorebookEntry>): LorebookEntry =>
  ({ id: "e1", name: "Entry", keys: [], content: "", ...over }) as LorebookEntry;

test("buildCatalog uses description when present, else falls back to leading content", () => {
  const withDesc = buildCatalog([entry({ id: "a", name: "A", keys: ["k1", "k2"], description: "A short desc", content: "ignored" })]);
  assert.equal(withDesc[0]!.summary, "A short desc");
  assert.deepEqual(withDesc[0]!.keys, ["k1", "k2"]);

  const withoutDesc = buildCatalog([entry({ id: "b", name: "B", content: "Alpha Beta Gamma" })]);
  assert.match(withoutDesc[0]!.summary, /Alpha/, "summary derives from content when no description");
});

test("formatCatalogForPrompt renders entries as XML and escapes special characters", () => {
  const out = formatCatalogForPrompt([
    { id: "e1", name: "Name & <x>", keys: ["a&b"], summary: "sum <tag>" },
  ]);
  assert.match(out, /name="Name &amp; &lt;x&gt;"/);
  assert.match(out, /keys="a&amp;b"/);
  assert.match(out, /sum &lt;tag&gt;/);
});

test("formatCatalogForPrompt marks empty summaries as (no description)", () => {
  const out = formatCatalogForPrompt([{ id: "e1", name: "E", keys: [], summary: "" }]);
  assert.match(out, /\(no description\)/);
});

test("parseRouterResponse extracts entryIds from plain JSON, fences, and surrounding prose", () => {
  assert.deepEqual(parseRouterResponse('{"entryIds":["a","b"]}'), ["a", "b"]);
  assert.deepEqual(parseRouterResponse('```json\n{"entryIds":["x"]}\n```'), ["x"]);
  assert.deepEqual(parseRouterResponse('Sure, here you go: {"entryIds":["y"]} — done!'), ["y"]);
  assert.deepEqual(parseRouterResponse('{"entryIds":[" a ","b\\n"]}'), ["a", "b"], "ids are trimmed");
});

test("parseRouterResponse returns [] for empty, non-JSON, or wrong-shape input", () => {
  assert.deepEqual(parseRouterResponse(""), []);
  assert.deepEqual(parseRouterResponse("no json here"), []);
  assert.deepEqual(parseRouterResponse('{"entryIds":"not-an-array"}'), []);
  assert.deepEqual(parseRouterResponse('{"other":1}'), []);
});
