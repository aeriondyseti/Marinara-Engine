import assert from "node:assert/strict";
import { test } from "node:test";

import { clampImageDimension, parseImageGenerationUserSettings } from "../image-generation-settings.js";

test("clampImageDimension rounds, applies the fallback, and clamps the extremes", () => {
  assert.equal(clampImageDimension(512.4, 640), 512, "rounds down");
  assert.equal(clampImageDimension(512.6, 640), 513, "rounds up");
  assert.equal(clampImageDimension("700", 640), 700, "numeric string");
  assert.equal(clampImageDimension("nope", 640), 640, "non-numeric → fallback");
  assert.equal(clampImageDimension(undefined, 640), 640);
  // Don't hardcode MIN/MAX: extreme values past the bounds collapse to the same clamp.
  assert.equal(clampImageDimension(10_000_000, 640), clampImageDimension(9_000_000, 640));
  assert.equal(clampImageDimension(-100, 640), clampImageDimension(-1, 640));
});

test("parseImageGenerationUserSettings falls back to defaults for null/garbage input", () => {
  const fromNull = parseImageGenerationUserSettings(null);
  assert.deepEqual(parseImageGenerationUserSettings("not json"), fromNull);
  assert.deepEqual(parseImageGenerationUserSettings("[1,2,3]"), fromNull, "non-record JSON → defaults");
  assert.ok(fromNull.background && typeof fromNull.background.width === "number");
});

test("parseImageGenerationUserSettings reads per-category sizes from valid JSON", () => {
  const parsed = parseImageGenerationUserSettings(
    JSON.stringify({ imageBackgroundWidth: 700, imageBackgroundHeight: 700 }),
  );
  assert.equal(parsed.background.width, 700);
  assert.equal(parsed.background.height, 700);
  // Unspecified categories fall back to the defaults.
  assert.deepEqual(parsed.portrait, parseImageGenerationUserSettings(null).portrait);
});
