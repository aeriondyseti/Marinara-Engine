import assert from "node:assert/strict";
import { test } from "node:test";

import type { GameMap, MapNode } from "@marinara-engine/shared";

import {
  gameMapContainsLocation,
  getGameMapId,
  parseMapUpdateCommands,
  upsertGameMap,
} from "../map-position.service.js";

const gm = (over: Partial<GameMap> = {}): GameMap =>
  ({ type: "node", name: "", description: "", partyPosition: "", ...over }) as GameMap;

const node = (id: string, label: string, over: Partial<MapNode> = {}): MapNode =>
  ({ id, label, emoji: "📍", x: 50, y: 50, discovered: true, ...over });

test("parseMapUpdateCommands reads new_location with connected_to/node_emoji and their aliases", () => {
  assert.deepEqual(parseMapUpdateCommands('[map_update: new_location="Crystal Cave" connected_to="Old Tavern" node_emoji="💎"]'), [
    { newLocation: "Crystal Cave", connectedTo: "Old Tavern", nodeEmoji: "💎" },
  ]);
  assert.deepEqual(parseMapUpdateCommands('[map_update: location="Forest" connected="Town" emoji="🌲"]'), [
    { newLocation: "Forest", connectedTo: "Town", nodeEmoji: "🌲" },
  ]);
  assert.deepEqual(parseMapUpdateCommands("[map_update: new_location=Lake]"), [
    { newLocation: "Lake", connectedTo: null, nodeEmoji: null },
  ]);
});

test("parseMapUpdateCommands skips commands without a location and reads multiple tags", () => {
  assert.deepEqual(parseMapUpdateCommands("[map_update: connected_to=Somewhere]"), []);
  const two = parseMapUpdateCommands('prose [map_update: new_location="A"] more [map_update: new_location="B"]');
  assert.equal(two.length, 2);
  assert.deepEqual(two.map((c) => c.newLocation), ["A", "B"]);
});

test("getGameMapId prefers explicit id, then a slug of the name, then an indexed fallback", () => {
  assert.equal(getGameMapId(gm({ id: "m1", name: "Whatever" })), "m1");
  assert.equal(getGameMapId(gm({ name: "The Dark Forest" })), "the-dark-forest");
  assert.equal(getGameMapId(gm({ name: "" }), 2), "map-3");
  assert.equal(getGameMapId(null), null);
});

test("upsertGameMap appends new maps and replaces matches by id or normalized name", () => {
  const start = [gm({ id: "m1", name: "Town" })];
  assert.equal(upsertGameMap(start, gm({ id: "m2", name: "Cave" })).length, 2, "distinct id → append");

  const replacedById = upsertGameMap(start, gm({ id: "m1", name: "Town Renamed" }));
  assert.equal(replacedById.length, 1);
  assert.equal(replacedById[0]!.name, "Town Renamed");

  const replacedByName = upsertGameMap([gm({ name: "Old Tavern" })], gm({ name: "old   tavern" }));
  assert.equal(replacedByName.length, 1, "normalized-name match → replace, not append");
});

test("gameMapContainsLocation fuzzy-matches a node label, case/space-insensitively", () => {
  const map = gm({ nodes: [node("n1", "Old Tavern")], edges: [], partyPosition: "n1" });
  assert.equal(gameMapContainsLocation(map, "Old Tavern"), true);
  assert.equal(gameMapContainsLocation(map, "  old tavern  "), true);
  assert.equal(gameMapContainsLocation(map, "Dragon Lair"), false);
  assert.equal(gameMapContainsLocation(map, ""), false);
  assert.equal(gameMapContainsLocation(null, "Old Tavern"), false);
});
