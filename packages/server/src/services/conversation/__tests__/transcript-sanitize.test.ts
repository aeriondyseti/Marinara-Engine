import assert from "node:assert/strict";
import { test } from "node:test";

import { stripConversationPromptTimestamps } from "../transcript-sanitize.js";

test("strips a leading bracketed timestamp from a line", () => {
  assert.equal(stripConversationPromptTimestamps("[12:01] Hello there"), "Hello there");
  assert.equal(stripConversationPromptTimestamps("[3.45pm] later"), "later");
});

test("strips a timestamp that follows a speaker label, keeping the label", () => {
  assert.equal(stripConversationPromptTimestamps("Alice: [3.45pm] hi"), "Alice: hi");
});

test("removes <date> tags but keeps their inner text", () => {
  const out = stripConversationPromptTimestamps("<date>Monday</date> we met");
  assert.doesNotMatch(out, /<\/?date/);
  assert.equal(out, "Monday we met");
});

test("only strips leading / speaker-prefixed timestamps, not mid-line ones", () => {
  // The [09:00] here is neither at line start nor right after a "speaker:" label.
  assert.equal(stripConversationPromptTimestamps("met at [09:00] sharp"), "met at [09:00] sharp");
});

test("collapses blank-line runs and trailing spaces before newlines", () => {
  assert.equal(stripConversationPromptTimestamps("a  \n\n\n\nb "), "a\n\nb");
});

test("leaves text without timestamps or tags unchanged", () => {
  assert.equal(stripConversationPromptTimestamps("Just a normal line."), "Just a normal line.");
});
