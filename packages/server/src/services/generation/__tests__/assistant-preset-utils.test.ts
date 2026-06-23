import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_MARI_FETCHED_PRESET_CONTEXT_CHARS,
  normalizeAssistantPresetIdentifier,
  normalizeAssistantPresetOptionId,
  normalizeAssistantPresetVariableName,
  parseMariJsonArray,
  parseMariJsonRecord,
  resolveAssistantPresetInjectionPosition,
  resolveAssistantPresetRole,
  resolveAssistantPresetWrapFormat,
  truncateMariFetchedText,
} from "../assistant-preset-utils.js";

test("resolvers accept valid enum values and fall back to their defaults", () => {
  assert.equal(resolveAssistantPresetWrapFormat("markdown"), "markdown");
  assert.equal(resolveAssistantPresetWrapFormat("bogus"), "xml");
  assert.equal(resolveAssistantPresetWrapFormat(123), "xml");
  assert.equal(resolveAssistantPresetRole("user"), "user");
  assert.equal(resolveAssistantPresetRole("bogus"), "system");
  assert.equal(resolveAssistantPresetInjectionPosition("depth"), "depth");
  assert.equal(resolveAssistantPresetInjectionPosition(undefined), "ordered");
});

test("normalizeAssistantPresetIdentifier slugs, falls back, and de-duplicates within a used set", () => {
  const used = new Set<string>();
  assert.equal(normalizeAssistantPresetIdentifier("My Section!", 0, used), "my_section");
  assert.equal(normalizeAssistantPresetIdentifier("My Section!", 1, used), "my_section_2", "collision gets a suffix");
  assert.equal(normalizeAssistantPresetIdentifier("My Section!", 2, used), "my_section_3");
  assert.equal(normalizeAssistantPresetIdentifier("", 4, used), "mari_section_5", "empty → indexed fallback");
});

test("normalizeAssistantPresetVariableName produces a \\w+ identifier with fallback and dedup", () => {
  const used = new Set<string>();
  assert.equal(normalizeAssistantPresetVariableName("my choice", 0, used), "my_choice");
  assert.equal(normalizeAssistantPresetVariableName("my choice", 1, used), "my_choice_2");
  assert.equal(normalizeAssistantPresetVariableName("", 2, used), "choice_3", "empty → indexed fallback");
});

test("normalizeAssistantPresetOptionId slugs with an option_ fallback", () => {
  const used = new Set<string>();
  assert.equal(normalizeAssistantPresetOptionId("Option A", 0, used), "option_a");
  assert.equal(normalizeAssistantPresetOptionId(undefined, 1, used), "option_2");
});

test("truncateMariFetchedText annotates how much was cut and leaves short text alone", () => {
  assert.equal(truncateMariFetchedText("short", 100), "short");
  assert.equal(truncateMariFetchedText("abcdefgh", 5), "abcde\n...[truncated 3 chars]");
  assert.equal(truncateMariFetchedText(null), "");
  assert.equal(MAX_MARI_FETCHED_PRESET_CONTEXT_CHARS, 8000);
});

test("parseMariJsonRecord / parseMariJsonArray accept live values or JSON strings, reject the wrong shape", () => {
  assert.deepEqual(parseMariJsonRecord({ a: 1 }), { a: 1 });
  assert.deepEqual(parseMariJsonRecord('{"a":1}'), { a: 1 });
  assert.deepEqual(parseMariJsonRecord("[1,2]"), {}, "array string is not a record");
  assert.deepEqual(parseMariJsonRecord("not json"), {});
  assert.deepEqual(parseMariJsonRecord(null), {});

  assert.deepEqual(parseMariJsonArray([1, 2]), [1, 2]);
  assert.deepEqual(parseMariJsonArray("[1,2]"), [1, 2]);
  assert.deepEqual(parseMariJsonArray('{"a":1}'), [], "object string is not an array");
  assert.deepEqual(parseMariJsonArray("x"), []);
});
