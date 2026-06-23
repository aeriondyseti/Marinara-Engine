import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveSpotifyToolAvailabilityRequest } from "../spotify-tool-availability.js";

const SPOTIFY = new Set(["spotify_play", "spotify_pause"]);

function resolve(over: Partial<Parameters<typeof resolveSpotifyToolAvailabilityRequest>[0]> = {}) {
  return resolveSpotifyToolAvailabilityRequest({
    enableChatTools: false,
    hasChatToolFilter: false,
    chatResolvedToolNames: [],
    agentResolvedToolNameGroups: [],
    spotifyToolNames: SPOTIFY,
    ...over,
  });
}

test("no spotify tools anywhere → credentials not needed", () => {
  const r = resolve({ enableChatTools: true, hasChatToolFilter: true, chatResolvedToolNames: ["search", "rng"] });
  assert.equal(r.needsSpotifyCredentials, false);
  assert.equal(r.chatExplicitlyAllowsSpotify, false);
  assert.equal(r.anyAgentAllowsSpotify, false);
  assert.equal(r.shouldLogUnavailableToolOmission, false);
});

test("chat allows spotify only when tools are enabled AND a filter is present AND a spotify tool is listed", () => {
  assert.equal(resolve({ enableChatTools: true, hasChatToolFilter: true, chatResolvedToolNames: ["spotify_play"] }).chatExplicitlyAllowsSpotify, true);
  // filter absent → chat does not "explicitly" allow it even if the tool is resolved
  assert.equal(resolve({ enableChatTools: true, hasChatToolFilter: false, chatResolvedToolNames: ["spotify_play"] }).chatExplicitlyAllowsSpotify, false);
  // tools disabled
  assert.equal(resolve({ enableChatTools: false, hasChatToolFilter: true, chatResolvedToolNames: ["spotify_play"] }).chatExplicitlyAllowsSpotify, false);
});

test("any agent group containing a spotify tool flips the agent flag and needs-credentials", () => {
  const r = resolve({ agentResolvedToolNameGroups: [["search"], ["rng", "spotify_pause"]] });
  assert.equal(r.anyAgentAllowsSpotify, true);
  assert.equal(r.needsSpotifyCredentials, true);
  assert.equal(r.shouldLogUnavailableToolOmission, true);
});
