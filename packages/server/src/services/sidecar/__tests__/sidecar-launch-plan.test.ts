import assert from "node:assert/strict";
import { test } from "node:test";

import { buildLlamaArgs, buildLlamaStartupPlans } from "../sidecar-launch-plan.js";

const baseOpts = {
  modelPath: "/models/model.gguf",
  gpuLayers: 20,
  port: 8080,
  contextSize: 4096,
  runtimeVariant: "cpu",
  enableNativeToolCalls: false,
};

test("buildLlamaArgs sets host/port/ngl and doubles ctx-size across the parallel slots", () => {
  const args = buildLlamaArgs(baseOpts);
  const joined = args.join(" ");
  assert.match(joined, /-m \/models\/model\.gguf/);
  assert.match(joined, /--host 127\.0\.0\.1/);
  assert.match(joined, /--ctx-size 8192/, "4096 per-request × 2 slots");
  assert.match(joined, /--port 8080/);
  assert.match(joined, /-ngl 20/);
  assert.match(joined, /--embeddings --pooling none/);
});

test("buildLlamaArgs adds --jinja only when native tool calls are enabled", () => {
  assert.equal(buildLlamaArgs(baseOpts).includes("--jinja"), false);
  assert.equal(buildLlamaArgs({ ...baseOpts, enableNativeToolCalls: true }).includes("--jinja"), true);
});

test("buildLlamaArgs disables split mode only for Gemma on a CUDA runtime with GPU layers", () => {
  const gemmaCuda = buildLlamaArgs({ ...baseOpts, modelPath: "/models/gemma-2.gguf", runtimeVariant: "cuda12", gpuLayers: 30 });
  assert.match(gemmaCuda.join(" "), /-sm none/);
  // Not Gemma → no split flag
  assert.equal(buildLlamaArgs({ ...baseOpts, runtimeVariant: "cuda12", gpuLayers: 30 }).includes("-sm"), false);
  // Gemma but CPU runtime → no split flag
  assert.equal(buildLlamaArgs({ ...baseOpts, modelPath: "/models/gemma-2.gguf", runtimeVariant: "cpu" }).includes("-sm"), false);
});

test("buildLlamaStartupPlans: explicit layers → one plan; auto (-1) → CPU or GPU-then-fallback", () => {
  assert.deepEqual(buildLlamaStartupPlans({ configuredGpuLayers: 20, usesGpuRuntime: true }), [
    { gpuLayers: 20, label: "gpuLayers=20" },
  ]);
  assert.deepEqual(buildLlamaStartupPlans({ configuredGpuLayers: -1, usesGpuRuntime: false }), [
    { gpuLayers: 0, label: "CPU runtime" },
  ]);
  assert.deepEqual(buildLlamaStartupPlans({ configuredGpuLayers: -1, usesGpuRuntime: true }), [
    { gpuLayers: 999, label: "max GPU offload" },
    { gpuLayers: 0, label: "CPU fallback" },
  ]);
});
