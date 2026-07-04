import { useMutation, useQuery } from "@tanstack/react-query";
import type { GameSceneVideoAspectRatio, GameTurnStoryboard } from "@marinara-engine/shared";
import { api } from "../lib/api-client";

export const gameStoryboardKeys = {
  all: ["game", "storyboards"] as const,
  chat: (chatId: string) => [...gameStoryboardKeys.all, chatId] as const,
  turn: (chatId: string, messageId: string, swipeIndex: number) =>
    [...gameStoryboardKeys.chat(chatId), "turn", messageId, swipeIndex] as const,
};

export type GenerateGameTurnStoryboardInput = {
  chatId: string;
  messageId: string;
  swipeIndex?: number;
  sections?: Array<{
    index: number;
    kind: "narration" | "dialogue" | "readable" | "system";
    speaker?: string | null;
    content: string;
  }>;
  keyframeCount?: number;
  durationSeconds?: number;
  aspectRatio?: GameSceneVideoAspectRatio;
  generateVideos?: boolean;
  debugMode?: boolean;
};

export function useGameTurnStoryboards(
  chatId: string | undefined,
  messageId: string | undefined,
  swipeIndex: number | undefined,
  enabled = true,
) {
  const normalizedSwipeIndex = swipeIndex ?? 0;
  return useQuery({
    queryKey: gameStoryboardKeys.turn(chatId ?? "", messageId ?? "", normalizedSwipeIndex),
    queryFn: async () => {
      const params = new URLSearchParams({
        messageId: messageId!,
        swipeIndex: String(normalizedSwipeIndex),
      });
      const result = await api.get<{ storyboards: GameTurnStoryboard[] }>(
        `/game/storyboards/${chatId}?${params.toString()}`,
      );
      return result.storyboards;
    },
    enabled: enabled && !!chatId && !!messageId,
    staleTime: 30_000,
  });
}

export function useGenerateGameTurnStoryboard() {
  return useMutation({
    mutationFn: (input: GenerateGameTurnStoryboardInput) =>
      api.post<{ storyboard: GameTurnStoryboard }>("/game/storyboard/generate", input),
  });
}
