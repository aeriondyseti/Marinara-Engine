import assert from "node:assert/strict";
import { shouldKeepStreamLiveThroughPostProcessing } from "../../packages/client/src/lib/generation-stream-policy.js";
import { resolveMessageRewriteVersions } from "../../packages/client/src/lib/message-rewrite-versions.js";
import { getAgentBatchLane, type ResolvedAgent } from "../../packages/server/src/services/agents/agent-pipeline.js";
import { mergePairedBuiltInRewriteAgents } from "../../packages/server/src/services/generation/prose-guardian-settings.js";
import { aboutMeKeeperAgentManifest } from "../../packages/shared/src/features/agents/about-me-keeper/manifest.js";
import { estimateAgentLoadCost } from "../../packages/shared/src/utils/agent-cost.js";

assert.equal(
  shouldKeepStreamLiveThroughPostProcessing({
    streamingEnabled: true,
    shouldDisplayRawStream: true,
    isGameGeneration: false,
    isRegeneration: false,
    isContinuation: false,
  }),
  true,
);
assert.equal(
  shouldKeepStreamLiveThroughPostProcessing({
    streamingEnabled: true,
    shouldDisplayRawStream: true,
    isGameGeneration: false,
    isRegeneration: true,
    isContinuation: false,
  }),
  false,
);

const makeAgent = (type: string, resultType: string): ResolvedAgent =>
  ({
    id: type,
    type,
    name: type,
    phase: "post_processing",
    promptTemplate: `${type} prompt`,
    connectionId: "connection-1",
    settings: { resultType, holdForRewrite: true },
    provider: {},
    model: "agent-model",
  }) as ResolvedAgent;

const rewriteAgents = [
  makeAgent("prose-guardian", "text_rewrite"),
  makeAgent("continuity", "text_rewrite"),
  makeAgent("html", "text_rewrite"),
];
const trackerAgent = makeAgent("world-state", "game_state_update");
const merged = mergePairedBuiltInRewriteAgents([...rewriteAgents, trackerAgent]);

assert.equal(merged.length, 2, "the three built-in rewrite agents should share one editor call");
assert.match(merged[0]!.name, /prose-guardian.*continuity.*html/u);
assert.equal(getAgentBatchLane(merged[0]!), "rewrite");
assert.equal(getAgentBatchLane(trackerAgent), "standard");
assert.equal(
  estimateAgentLoadCost(
    [
      ...rewriteAgents.map((agent) => ({
        type: agent.type,
        phase: "post_processing" as const,
        connectionId: "connection-1",
        promptTemplate: agent.promptTemplate,
        resultType: "text_rewrite",
      })),
      {
        type: trackerAgent.type,
        phase: "post_processing" as const,
        connectionId: "connection-1",
        promptTemplate: trackerAgent.promptTemplate,
        resultType: "game_state_update",
      },
    ],
    null,
  ).extraCalls,
  2,
  "rewrite editors should count as one call separate from the tracker call",
);
assert.equal(aboutMeKeeperAgentManifest.libraryHidden, true);

const legacyRewrite = resolveMessageRewriteVersions(
  "The polished rewritten reply.",
  { proseGuardianOriginalText: "The original reply." },
  false,
);
assert.equal(legacyRewrite.hasVersions, true, "legacy one-way restore metadata should remain recoverable");
assert.equal(legacyRewrite.alternateText, "The original reply.");

const restoredOriginal = resolveMessageRewriteVersions(
  "The original reply.",
  {
    proseGuardianOriginalText: "The original reply.",
    proseGuardianRewrittenText: "The polished rewritten reply.",
  },
  false,
);
assert.equal(restoredOriginal.hasVersions, true, "the shield should remain after showing the original");
assert.equal(restoredOriginal.showingOriginal, true);
assert.equal(restoredOriginal.alternateText, "The polished rewritten reply.");

const restoredRewrite = resolveMessageRewriteVersions(
  "The polished rewritten reply.",
  {
    proseGuardianOriginalText: "The original reply.",
    proseGuardianRewrittenText: "The polished rewritten reply.",
  },
  false,
);
assert.equal(restoredRewrite.showingOriginal, false);
assert.equal(restoredRewrite.alternateText, "The original reply.");

process.stdout.write("Roleplay streaming regression passed.\n");
