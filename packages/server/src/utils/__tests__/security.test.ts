import assert from "node:assert/strict";
import { test } from "node:test";

import { extensionFromImageMime, isAllowedImageBuffer, parseBoolean, safeBasename } from "../security.js";

test("parseBoolean accepts the common truthy strings (case-insensitive, trimmed)", () => {
  for (const v of ["1", "true", "TRUE", "Yes", "on", " on "]) assert.equal(parseBoolean(v), true, JSON.stringify(v));
  for (const v of ["0", "false", "no", "off", "", "2", "truthy"]) assert.equal(parseBoolean(v), false, JSON.stringify(v));
  assert.equal(parseBoolean(true), true);
  assert.equal(parseBoolean(false), false);
  assert.equal(parseBoolean(1), false, "only the string forms or boolean true are truthy");
  assert.equal(parseBoolean(undefined), false);
  assert.equal(parseBoolean(null), false);
});

test("safeBasename strips directories and unsafe characters, falling back when empty", () => {
  assert.equal(safeBasename("/etc/passwd"), "passwd");
  assert.equal(safeBasename("../../secret.txt"), "secret.txt");
  assert.equal(safeBasename('bad:name?<>"|*.png'), "badname.png");
  assert.equal(safeBasename("   "), "file", "whitespace-only collapses to the default");
  assert.equal(safeBasename("", "default.bin"), "default.bin");
});

test("extensionFromImageMime maps known mimes and defaults to png", () => {
  assert.equal(extensionFromImageMime("image/jpeg"), "jpg");
  assert.equal(extensionFromImageMime("image/webp"), "webp");
  assert.equal(extensionFromImageMime("image/gif"), "gif");
  assert.equal(extensionFromImageMime("image/avif"), "avif");
  assert.equal(extensionFromImageMime("image/png"), "png");
  assert.equal(extensionFromImageMime("application/octet-stream"), "png", "unknown mime falls back to png");
});

test("isAllowedImageBuffer sniffs magic bytes and rejects unknown or too-short content", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  assert.deepEqual(isAllowedImageBuffer(png), { ext: "png", mimeType: "image/png" });

  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  assert.deepEqual(isAllowedImageBuffer(jpg), { ext: "jpg", mimeType: "image/jpeg" });

  const gif = Buffer.from("GIF89a and then some", "ascii");
  assert.deepEqual(isAllowedImageBuffer(gif), { ext: "gif", mimeType: "image/gif" });

  const webp = Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from("WEBP", "ascii"),
  ]);
  assert.deepEqual(isAllowedImageBuffer(webp), { ext: "webp", mimeType: "image/webp" });

  assert.equal(isAllowedImageBuffer(Buffer.from("not an image at all", "ascii")), null);
  assert.equal(isAllowedImageBuffer(Buffer.from([0x89, 0x50])), null, "too short to match any signature");
});
