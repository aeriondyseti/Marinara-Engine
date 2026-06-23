import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatMLMessage } from "@marinara-engine/shared";

import { mergeAdjacentMessages, squashLeadingSystemMessages } from "../merger.js";

const msg = (role: string, content: string, extra: Partial<ChatMLMessage> = {}): ChatMLMessage =>
  ({ role, content, ...extra }) as ChatMLMessage;

test("mergeAdjacentMessages joins consecutive same-role messages with a blank line", () => {
  const out = mergeAdjacentMessages([msg("system", "A"), msg("system", "B"), msg("user", "C")]);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.role, "system");
  assert.equal(out[0]!.content, "A\n\nB");
  assert.equal(out[1]!.content, "C");
});

test("mergeAdjacentMessages skips empty messages and does not merge across roles", () => {
  const skipped = mergeAdjacentMessages([msg("user", "   "), msg("user", "hi")]);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0]!.content, "hi");

  assert.equal(mergeAdjacentMessages([msg("system", "A"), msg("user", "B")]).length, 2);
});

test("mergeAdjacentMessages does not merge same-role messages with different characterId", () => {
  const out = mergeAdjacentMessages([
    msg("assistant", "A", { characterId: "c1" }),
    msg("assistant", "B", { characterId: "c2" }),
  ]);
  assert.equal(out.length, 2);
});

test("squashLeadingSystemMessages combines only the leading system block", () => {
  const out = squashLeadingSystemMessages([msg("system", "A"), msg("system", "B"), msg("user", "C")]);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.role, "system");
  assert.equal(out[0]!.content, "A\n\nB");
  assert.equal(out[1]!.content, "C");
});

test("squashLeadingSystemMessages is a no-op when there is 0 or 1 leading system message", () => {
  const single = [msg("system", "A"), msg("user", "B")];
  assert.equal(squashLeadingSystemMessages(single), single, "returns the same array reference");
  assert.deepEqual(squashLeadingSystemMessages([]), []);
});
