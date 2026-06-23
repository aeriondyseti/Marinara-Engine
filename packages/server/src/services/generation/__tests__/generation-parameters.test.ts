import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_AGENT_MAX_TOKENS, MIN_AGENT_MAX_TOKENS } from "@marinara-engine/shared";

import {
  applyProviderMaxTokensOverride,
  minContextLimit,
  normalizeAgentMaxTokens,
  normalizeChatTopP,
  normalizeMaxContext,
  readChatCompletionsReasoningMetadata,
  shouldReplayStoredChatCompletionsReasoning,
} from "../generation-parameters.js";

test("normalizeMaxContext accepts positive finite numbers (floored) and rejects the rest", () => {
  assert.equal(normalizeMaxContext(8192), 8192);
  assert.equal(normalizeMaxContext(8192.9), 8192);
  assert.equal(normalizeMaxContext(0), undefined);
  assert.equal(normalizeMaxContext(-5), undefined);
  assert.equal(normalizeMaxContext("8192"), undefined);
  assert.equal(normalizeMaxContext(Number.POSITIVE_INFINITY), undefined);
});

test("normalizeAgentMaxTokens parses, truncates, and floors at MIN; falls back when unparseable", () => {
  assert.equal(normalizeAgentMaxTokens(5000), 5000);
  assert.equal(normalizeAgentMaxTokens("5000"), 5000);
  assert.equal(normalizeAgentMaxTokens(200.9), 200);
  assert.equal(normalizeAgentMaxTokens(MIN_AGENT_MAX_TOKENS - 10), MIN_AGENT_MAX_TOKENS, "clamped up to MIN");
  assert.equal(normalizeAgentMaxTokens("not a number"), DEFAULT_AGENT_MAX_TOKENS);
  assert.equal(normalizeAgentMaxTokens(undefined), DEFAULT_AGENT_MAX_TOKENS);
  assert.equal(normalizeAgentMaxTokens(undefined, 999), 999, "honors a custom fallback");
});

test("applyProviderMaxTokensOverride caps only when the provider sets an override", () => {
  assert.equal(applyProviderMaxTokensOverride({ maxTokensOverrideValue: null } as never, 500), 500);
  assert.equal(applyProviderMaxTokensOverride({ maxTokensOverrideValue: 100 } as never, 500), 100);
  assert.equal(applyProviderMaxTokensOverride({ maxTokensOverrideValue: 800 } as never, 500), 500);
});

test("minContextLimit ignores undefined and returns the smallest, or undefined when none", () => {
  assert.equal(minContextLimit(8192, 4096, undefined, 16384), 4096);
  assert.equal(minContextLimit(undefined, 2048), 2048);
  assert.equal(minContextLimit(undefined, undefined), undefined);
  assert.equal(minContextLimit(), undefined);
});

test("normalizeChatTopP clamps to [0, 1] and rejects non-numbers / negatives", () => {
  assert.equal(normalizeChatTopP(0.5), 0.5);
  assert.equal(normalizeChatTopP(0), 0);
  assert.equal(normalizeChatTopP(1.5), 1, "clamped to 1");
  assert.equal(normalizeChatTopP(-0.1), undefined);
  assert.equal(normalizeChatTopP("0.5"), undefined);
  assert.equal(normalizeChatTopP(Number.NaN), undefined);
});

test("readChatCompletionsReasoningMetadata picks up only present reasoning fields", () => {
  assert.equal(readChatCompletionsReasoningMetadata(null), undefined);
  assert.equal(readChatCompletionsReasoningMetadata({}), undefined);
  assert.equal(readChatCompletionsReasoningMetadata({ reasoning_content: "" }), undefined, "empty strings are ignored");
  assert.deepEqual(readChatCompletionsReasoningMetadata({ reasoning: "because" }), { reasoning: "because" });
  assert.deepEqual(readChatCompletionsReasoningMetadata({ reasoning_details: [{ a: 1 }], reasoning_details_empty: [] }), {
    reasoning_details: [{ a: 1 }],
  });
});

test("shouldReplayStoredChatCompletionsReasoning skips only OpenRouter Gemini models", () => {
  assert.equal(shouldReplayStoredChatCompletionsReasoning("openai", "gpt-4o"), true);
  assert.equal(shouldReplayStoredChatCompletionsReasoning("openrouter", "anthropic/claude-3.5"), true);
  assert.equal(shouldReplayStoredChatCompletionsReasoning("openrouter", "google/gemini-2.0"), false);
  assert.equal(shouldReplayStoredChatCompletionsReasoning("openrouter", "some/gemini-pro"), false);
});
