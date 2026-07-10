import assert from "node:assert/strict";
import {
  noodlePastMemoryCutoff,
  noodlePastMemorySampleSize,
  noodleTimelineFeatureInstructions,
  sampleNoodlePastMemories,
} from "../../packages/server/src/services/noodle/noodle-prompt.js";

const activeAccountsInstruction = "- Use only the active accounts listed by entityId. Do not invent accounts.";
const imageGenerationInstruction =
  "- When image generation is enabled, imagePrompt should be a concrete visual idea for the attached image: either a character-focused image of the author/their scene/selfie, or an in-character meme they would plausibly post.";
const galleryAttachmentInstruction =
  "- When gallery attachments are enabled, set attachGalleryImage to true only when the post naturally fits an existing gallery or chat image.";

const instructions = (input: {
  allowRandomUsers?: boolean;
  enableImagePrompts?: boolean;
  allowGalleryImageAttachments?: boolean;
}) =>
  noodleTimelineFeatureInstructions({
    allowRandomUsers: input.allowRandomUsers ?? false,
    enableImagePrompts: input.enableImagePrompts ?? false,
    allowGalleryImageAttachments: input.allowGalleryImageAttachments ?? false,
  });

assert.deepEqual(instructions({}), []);
assert.deepEqual(instructions({ allowRandomUsers: true }), [activeAccountsInstruction]);
assert.deepEqual(instructions({ enableImagePrompts: true }), [imageGenerationInstruction]);
assert.deepEqual(instructions({ allowGalleryImageAttachments: true }), [galleryAttachmentInstruction]);
assert.deepEqual(
  instructions({ allowRandomUsers: true, enableImagePrompts: true, allowGalleryImageAttachments: true }),
  [activeAccountsInstruction, imageGenerationInstruction, galleryAttachmentInstruction],
);

const cutoffAnchor = new Date("2026-07-10T12:00:00.000Z");
assert.equal(noodlePastMemoryCutoff(cutoffAnchor), "2026-07-08T12:00:00.000Z");
assert.equal(
  noodlePastMemorySampleSize(() => 0.5),
  0,
);
const oneItemRolls = [0.49, 0];
assert.equal(
  noodlePastMemorySampleSize(() => oneItemRolls.shift() ?? 0),
  1,
);
const threeItemRolls = [0, 0.999];
assert.equal(
  noodlePastMemorySampleSize(() => threeItemRolls.shift() ?? 0),
  3,
);

assert.deepEqual(
  sampleNoodlePastMemories(["a", "b", "c"], 1, () => 0.99),
  ["c"],
);
const threeMemories = sampleNoodlePastMemories(["a", "b", "c", "d"], 3, () => 0);
assert.equal(threeMemories.length, 3);
assert.equal(new Set(threeMemories).size, 3);
assert.ok(threeMemories.every((item) => ["a", "b", "c", "d"].includes(item)));
assert.deepEqual(
  sampleNoodlePastMemories(["only"], 3, () => 0),
  ["only"],
);
assert.deepEqual(
  sampleNoodlePastMemories(["a", "b", "c", "d"], 99, () => 0),
  ["a", "b", "c"],
);

console.info("Noodle prompt and memory regression passed.");
