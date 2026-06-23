import assert from "node:assert/strict";
import { test } from "node:test";

import { applySegmentEdits, stripGmCommandTags } from "../segment-edits.js";

test("stripGmCommandTags removes engine command tags but keeps the surrounding prose", () => {
  const out = stripGmCommandTags("Tension rises. [state: combat] He draws his blade.");
  assert.doesNotMatch(out, /\[state:/);
  assert.match(out, /Tension rises\./);
  assert.match(out, /He draws his blade\./);
});

test("stripGmCommandTags strips a variety of known and unknown tags", () => {
  for (const tag of ["[music: theme.mp3]", "[bg: tavern]", "[inventory: action=add item=Key]", "[unknown_tag: whatever]"]) {
    assert.equal(stripGmCommandTags(tag), "", `${tag} should strip to empty`);
  }
});

test("stripGmCommandTags preserves [Note:] / [Book:] readables", () => {
  assert.match(stripGmCommandTags("You find a scrap. [Note: meet at dawn]"), /\[Note: meet at dawn\]/);
  assert.match(stripGmCommandTags("[Book: The Histories of Sharn]"), /\[Book: The Histories of Sharn\]/);
});

test("stripGmCommandTags strips a balanced [choices:] block with nested brackets", () => {
  const out = stripGmCommandTags('Pick one. [choices: ["A", "B", "C"]]');
  assert.doesNotMatch(out, /choices/);
  assert.match(out, /Pick one\./);
});

test("applySegmentEdits returns the original content untouched when there are no edits or deletes", () => {
  const content = "Hello.\n\nWorld.";
  assert.equal(applySegmentEdits(content, {}, new Set()), content);
});

test("applySegmentEdits replaces a narration segment by index, leaving others intact", () => {
  const result = applySegmentEdits("A.\n\nB.\n\nC.", { 0: { content: "A edited." } });
  assert.equal(result, "A edited.\n\nB.\n\nC.");
});

test("applySegmentEdits omits deleted segments and rejoins with blank lines", () => {
  const result = applySegmentEdits("A.\n\nB.\n\nC.", {}, new Set([1]));
  assert.equal(result, "A.\n\nC.");
});
