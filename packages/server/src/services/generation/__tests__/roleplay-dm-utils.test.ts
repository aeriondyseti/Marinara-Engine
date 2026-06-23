import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatUnresolvedRoleplayDmFallback,
  parseChatCharacterIdsForDm,
  replaceRoleplayDmCommandText,
  resolveRoleplayDmTarget,
} from "../roleplay-dm-utils.js";

test("parseChatCharacterIdsForDm handles arrays, JSON strings, single strings, and junk", () => {
  assert.deepEqual(parseChatCharacterIdsForDm(["a", " b ", "", 2]), ["a", "b"]);
  assert.deepEqual(parseChatCharacterIdsForDm('["x","y"]'), ["x", "y"]);
  assert.deepEqual(parseChatCharacterIdsForDm("solo-id"), ["solo-id"], "non-JSON string → single id");
  assert.deepEqual(parseChatCharacterIdsForDm('"hi"'), [], "JSON that isn't an array → empty");
  assert.deepEqual(parseChatCharacterIdsForDm(""), []);
  assert.deepEqual(parseChatCharacterIdsForDm(42), []);
});

test("resolveRoleplayDmTarget matches roleplay characters by id or normalized name", () => {
  const rp = [
    { id: "c1", name: "Kaeya" },
    { id: "c2", name: "Diluc" },
  ];
  assert.deepEqual(resolveRoleplayDmTarget("Kaeya", rp, []), { id: "c1", name: "Kaeya" });
  assert.deepEqual(resolveRoleplayDmTarget("c2", rp, []), { id: "c2", name: "Diluc" }, "by id");
  assert.deepEqual(resolveRoleplayDmTarget("  KAEYA  ", rp, []), { id: "c1", name: "Kaeya" }, "case/space-insensitive");
  assert.equal(resolveRoleplayDmTarget("  ", rp, []), null, "blank target → null");
  assert.equal(resolveRoleplayDmTarget("Nobody", rp, []), null);
});

test("resolveRoleplayDmTarget strips a leading 'il ' and falls back to all-characters by data.name", () => {
  assert.deepEqual(resolveRoleplayDmTarget("Il Dottore", [{ id: "c4", name: "Dottore" }], []), {
    id: "c4",
    name: "Dottore",
  });
  const all = [{ id: "c3", data: '{"name":"Venti"}' }];
  assert.deepEqual(resolveRoleplayDmTarget("Venti", [], all), { id: "c3", name: "Venti" });
});

test("formatUnresolvedRoleplayDmFallback quotes the message under the speaker and strips lead timestamps", () => {
  assert.equal(
    formatUnresolvedRoleplayDmFallback({ character: "Mari", message: "[12:00] hello", raw: "[dm]" } as never),
    'Mari: "hello"',
  );
  assert.equal(formatUnresolvedRoleplayDmFallback({ character: "", message: "hi", raw: "" } as never), "hi");
  assert.equal(formatUnresolvedRoleplayDmFallback({ character: "Mari", message: "   ", raw: "" } as never), "");
});

test("replaceRoleplayDmCommandText swaps the raw command text only when present", () => {
  const cmd = { character: "Mari", message: "hi", raw: "[dm: target=Mari]" } as never;
  assert.equal(replaceRoleplayDmCommandText("before [dm: target=Mari] after", cmd, "X"), "before X after");
  assert.equal(replaceRoleplayDmCommandText("no command here", cmd, "X"), "no command here");
  assert.equal(
    replaceRoleplayDmCommandText("text", { character: "Mari", message: "hi", raw: "" } as never, "X"),
    "text",
    "empty raw → unchanged",
  );
});
