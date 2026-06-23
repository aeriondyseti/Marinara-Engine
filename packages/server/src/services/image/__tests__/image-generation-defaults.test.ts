import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveImageGenerationService } from "../image-generation-defaults.js";

test("resolveImageGenerationService prefers an explicit service/source, lowercased", () => {
  assert.equal(resolveImageGenerationService({ imageService: "ComfyUI" }), "comfyui");
  assert.equal(resolveImageGenerationService({ imageGenerationSource: "AUTOMATIC1111" }), "automatic1111");
  assert.equal(
    resolveImageGenerationService({ imageService: "Forge", imageGenerationSource: "automatic1111" }),
    "forge",
    "imageService wins over imageGenerationSource",
  );
});

test("resolveImageGenerationService detects NovelAI by base URL", () => {
  assert.equal(resolveImageGenerationService({ baseUrl: "https://api.novelai.net/ai/generate-image" }), "novelai");
});

test("resolveImageGenerationService falls back to inference (always returns a string)", () => {
  const inferred = resolveImageGenerationService({ model: "sdxl", baseUrl: "http://localhost:7860" });
  assert.equal(typeof inferred, "string");
});
