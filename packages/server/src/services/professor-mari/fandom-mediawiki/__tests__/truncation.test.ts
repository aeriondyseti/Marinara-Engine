import assert from "node:assert/strict";
import { test } from "node:test";

import { byteLength, mergeTruncation, truncateUtf8 } from "../truncation.js";

test("byteLength counts UTF-8 bytes, not JS code units", () => {
  assert.equal(byteLength("abc"), 3);
  assert.equal(byteLength("é"), 2); // U+00E9 → 2 bytes
  assert.equal(byteLength("🎲"), 4); // surrogate pair → 4 bytes
});

test("truncateUtf8 returns the input unchanged when within budget", () => {
  const r = truncateUtf8("hello", 10);
  assert.equal(r.text, "hello");
  assert.equal(r.truncation, undefined);
});

test("truncateUtf8 never splits a multi-byte char and reports byte accounting", () => {
  // "a"(1) + "🎲"(4) = 5 bytes; budget 3 can't fit the die, so it stops after "a".
  const r = truncateUtf8("a🎲", 3, "fetch the next page");
  assert.equal(r.text, "a");
  assert.ok(r.truncation);
  assert.equal(r.truncation!.reason, "content_truncated");
  assert.equal(r.truncation!.returnedBytes, 1);
  assert.equal(r.truncation!.totalBytes, 5);
  assert.equal(r.truncation!.remedyHint, "fetch the next page");
});

test("truncateUtf8 trims trailing whitespace left by the cut", () => {
  // "ab "(3 bytes) then a 4-byte char; budget 3 keeps "ab " then trimEnd → "ab".
  const r = truncateUtf8("ab 🎲", 3);
  assert.equal(r.text, "ab");
});

test("mergeTruncation prefers primary and backfills continueFrom/remedyHint from secondary", () => {
  assert.equal(mergeTruncation(undefined, undefined), undefined);

  const secondary = {
    reason: "content_truncated",
    returnedBytes: 1,
    totalBytes: 2,
    remedyHint: "more",
    continueFrom: "cursor-X",
  };
  assert.deepEqual(mergeTruncation(undefined, secondary), secondary);
  assert.deepEqual(mergeTruncation(secondary, undefined), secondary);

  const primary = { reason: "content_truncated", returnedBytes: 3, totalBytes: 9 };
  const merged = mergeTruncation(primary, secondary)!;
  assert.equal(merged.returnedBytes, 3, "primary's own fields win");
  assert.equal(merged.totalBytes, 9);
  assert.equal(merged.continueFrom, "cursor-X", "backfilled from secondary");
  assert.equal(merged.remedyHint, "more", "backfilled from secondary");
});
