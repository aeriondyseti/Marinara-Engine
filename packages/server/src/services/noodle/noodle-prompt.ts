// ──────────────────────────────────────────────
// Noodle Prompt Instructions
// ──────────────────────────────────────────────
import type { NoodleSettings } from "@marinara-engine/shared";

export const NOODLE_PAST_MEMORY_MIN_AGE_MS = 48 * 60 * 60 * 1000;
export const NOODLE_PAST_MEMORY_MAX_ITEMS = 3;
export const NOODLE_PAST_MEMORY_INCLUSION_CHANCE = 0.5;

type NoodleTimelineFeatureSettings = Pick<
  NoodleSettings,
  "allowRandomUsers" | "enableImagePrompts" | "allowGalleryImageAttachments"
>;

type RandomSource = () => number;

function normalizedRandom(random: RandomSource): number {
  const value = random();
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.999_999, Math.max(0, value));
}

export function noodlePastMemoryCutoff(at = new Date()): string {
  return new Date(at.getTime() - NOODLE_PAST_MEMORY_MIN_AGE_MS).toISOString();
}

export function noodlePastMemorySampleSize(random: RandomSource = Math.random): number {
  if (normalizedRandom(random) >= NOODLE_PAST_MEMORY_INCLUSION_CHANCE) return 0;
  return 1 + Math.floor(normalizedRandom(random) * NOODLE_PAST_MEMORY_MAX_ITEMS);
}

export function sampleNoodlePastMemories<T>(
  items: readonly T[],
  limit: number,
  random: RandomSource = Math.random,
): T[] {
  const count = Math.min(Math.max(0, Math.floor(limit)), NOODLE_PAST_MEMORY_MAX_ITEMS, items.length);
  if (count === 0) return [];
  const pool = [...items];
  for (let index = 0; index < count; index += 1) {
    const selectedIndex = index + Math.floor(normalizedRandom(random) * (pool.length - index));
    [pool[index], pool[selectedIndex]] = [pool[selectedIndex]!, pool[index]!];
  }
  return pool.slice(0, count);
}

export function noodleTimelineFeatureInstructions(settings: NoodleTimelineFeatureSettings): string[] {
  return [
    ...(settings.allowRandomUsers
      ? ["- Use only the active accounts listed by entityId. Do not invent accounts."]
      : []),
    ...(settings.enableImagePrompts
      ? [
          "- When image generation is enabled, imagePrompt should be a concrete visual idea for the attached image: either a character-focused image of the author/their scene/selfie, or an in-character meme they would plausibly post.",
        ]
      : []),
    ...(settings.allowGalleryImageAttachments
      ? [
          "- When gallery attachments are enabled, set attachGalleryImage to true only when the post naturally fits an existing gallery or chat image.",
        ]
      : []),
  ];
}
