import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bumpCharacterVersion,
  formatConversationPromptTurn,
  getHiddenCompletionTokens,
  getVisibleCompletionTokens,
  stripSpacesBeforeLineBreaks,
  trimIncompleteModelEnding,
} from "../generation-text-utils.js";

test("bumpCharacterVersion increments the trailing number and pads, with sensible fallbacks", () => {
  assert.equal(bumpCharacterVersion(""), "1.1");
  assert.equal(bumpCharacterVersion(undefined), "1.1");
  assert.equal(bumpCharacterVersion("1.0"), "1.1");
  assert.equal(bumpCharacterVersion("1.9"), "1.10");
  assert.equal(bumpCharacterVersion("2"), "3");
  assert.equal(bumpCharacterVersion("v3"), "v4");
  assert.equal(bumpCharacterVersion("abc"), "abc.1", "no digit → append .1");
});

test("trimIncompleteModelEnding leaves complete output untouched", () => {
  assert.equal(trimIncompleteModelEnding("The cat sat."), "The cat sat.");
  assert.equal(trimIncompleteModelEnding('She said "go!"'), 'She said "go!"');
  assert.equal(trimIncompleteModelEnding("Unfinished thought"), "Unfinished thought", "nothing complete to fall back to");
});

test("trimIncompleteModelEnding drops a dangling partial sentence but keeps trailing whitespace", () => {
  assert.equal(trimIncompleteModelEnding("The cat sat. Then it"), "The cat sat.");
  assert.equal(trimIncompleteModelEnding("A. B and\n"), "A.\n", "trailing whitespace is preserved");
});

test("trimIncompleteModelEnding keeps content when the only trailing bit is a command tag", () => {
  assert.equal(trimIncompleteModelEnding("Done. [state: combat]"), "Done. [state: combat]");
});

test("completion-token accounting splits hidden from visible and never goes negative", () => {
  assert.equal(getHiddenCompletionTokens(undefined), undefined);
  assert.equal(getVisibleCompletionTokens(undefined), undefined);

  const usage = { completionTokens: 100, completionReasoningTokens: 30, completionAudioTokens: 10 } as never;
  assert.equal(getHiddenCompletionTokens(usage), 40);
  assert.equal(getVisibleCompletionTokens(usage), 60);

  const noHidden = { completionTokens: 42 } as never;
  assert.equal(getHiddenCompletionTokens(noHidden), undefined);
  assert.equal(getVisibleCompletionTokens(noHidden), 42);

  const clamped = { completionTokens: 5, completionReasoningTokens: 20 } as never;
  assert.equal(getVisibleCompletionTokens(clamped), 0, "visible clamps at 0 when hidden exceeds total");
});

test("stripSpacesBeforeLineBreaks removes trailing spaces/tabs before newlines only", () => {
  assert.equal(stripSpacesBeforeLineBreaks("a  \nb \r\nc"), "a\nb\r\nc");
  assert.equal(stripSpacesBeforeLineBreaks("no trailing"), "no trailing");
  assert.equal(stripSpacesBeforeLineBreaks("keep  internal spaces"), "keep  internal spaces");
});

test("formatConversationPromptTurn prefixes user turns and leaves assistant turns alone", () => {
  assert.equal(formatConversationPromptTurn("hello", "user", "Alice"), "Alice: hello");
  assert.equal(formatConversationPromptTurn("Alice: hi", "user", "Alice"), "Alice: hi", "already prefixed → unchanged");
  assert.equal(formatConversationPromptTurn("hi", "user", ""), "User: hi", "blank persona → User");
  assert.equal(formatConversationPromptTurn("user: hi", "user", ""), "user: hi");
  assert.equal(formatConversationPromptTurn("", "user", "Alice"), "Alice:");
  assert.equal(formatConversationPromptTurn("  Bob waves.  ", "assistant", "Alice"), "Bob waves.");
});

test("formatConversationPromptTurn escapes regex metacharacters in the persona name", () => {
  assert.equal(formatConversationPromptTurn("hi", "user", "A.B"), "A.B: hi");
  assert.equal(formatConversationPromptTurn("A.B: already", "user", "A.B"), "A.B: already");
});
