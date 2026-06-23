import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPartyNpcId, isPartyNpcId } from "../game-party-utils.js";

test("buildPartyNpcId slugs the name under an npc: prefix", () => {
  assert.equal(buildPartyNpcId("Kaeya"), "npc:kaeya");
  assert.equal(buildPartyNpcId("Sir Lancelot"), "npc:sir-lancelot");
  assert.equal(buildPartyNpcId("  Captain   Marvel  "), "npc:captain-marvel");
});

test("buildPartyNpcId falls back to 'unknown' when nothing slug-able remains", () => {
  assert.equal(buildPartyNpcId("..."), "npc:unknown");
  assert.equal(buildPartyNpcId(""), "npc:unknown");
});

test("isPartyNpcId recognizes the prefix", () => {
  assert.equal(isPartyNpcId("npc:kaeya"), true);
  assert.equal(isPartyNpcId("char-123"), false);
  assert.equal(isPartyNpcId(""), false);
});

test("buildPartyNpcId output round-trips through isPartyNpcId", () => {
  for (const name of ["Kaeya", "Sir Lancelot", "...", "Zhongli the Geo Archon"]) {
    assert.equal(isPartyNpcId(buildPartyNpcId(name)), true, name);
  }
});
