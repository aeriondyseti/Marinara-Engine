import { noodlePollInputSchema, noodlePollSchema } from "../schemas/noodle.schema.js";
import type { NoodlePoll } from "../types/noodle.js";

export function createNoodlePoll(value: unknown): NoodlePoll | null {
  const parsed = noodlePollInputSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    question: parsed.data.question,
    options: parsed.data.options.map((label, index) => ({ id: `option-${index + 1}`, label })),
  };
}

export function readNoodlePoll(value: unknown): NoodlePoll | null {
  const parsed = noodlePollSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function readNoodlePollFromMetadata(metadata: Record<string, unknown> | null | undefined): NoodlePoll | null {
  return readNoodlePoll(metadata?.poll);
}
