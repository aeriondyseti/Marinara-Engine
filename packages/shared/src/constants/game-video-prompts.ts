import type { AgentPromptTemplateOption } from "../types/agent.js";

export const GAME_VIDEO_PROMPT_TEMPLATE_ID = "cinematic-scene-video";
export const ANIME_GAME_VIDEO_PROMPT_TEMPLATE_ID = "anime-game-video";

export const GAME_VIDEO_PROMPT_TEMPLATE_VARIABLES = [
  "sceneTitle",
  "narrationSummary",
  "illustrationPrompt",
  "charactersLine",
  "settingLine",
  "artStyleLine",
  "durationSeconds",
  "aspectRatio",
  "sourceIllustrationLine",
] as const;

export const GAME_VIDEO_PROMPT_TEMPLATE = [
  "Create a ${durationSeconds}-second ${aspectRatio} animated game scene from the provided first-frame illustration.",
  "${sourceIllustrationLine}",
  "Scene: ${sceneTitle}",
  "Story beat: ${narrationSummary}",
  "Characters: ${charactersLine}",
  "Setting: ${settingLine}",
  "Art style: ${artStyleLine}",
  "Reference prompt excerpt: ${illustrationPrompt}",
  "Use the reference image as the visual anchor. Keep recognizable characters, setting, and mood while adding motion that feels natural for this moment.",
  "You may choose the most cinematic camera drift, focus shift, gestures, atmospheric movement, and ending pose that fit the scene.",
  "Avoid subtitles, captions, UI, logos, watermarks, unrelated new characters, distorted anatomy, and abrupt cuts.",
].join("\n");

export const ANIME_GAME_VIDEO_PROMPT_TEMPLATE = [
  "Create a ${durationSeconds}-second ${aspectRatio} anime shot from the supplied first-frame illustration.",
  "${sourceIllustrationLine}",
  "Shot: ${sceneTitle}",
  "Animation direction: ${narrationSummary}",
  "Visible characters: ${charactersLine}",
  "Setting: ${settingLine}",
  "Art style: ${artStyleLine}",
  "First-frame visual description: ${illustrationPrompt}",
  "Follow the animation direction as the temporal plan for the clip.",
  "- Begin exactly from the supplied illustration. Treat the first-frame illustration as authoritative whenever textual details conflict with it.",
  "- Preserve character identity, face, hair, clothing, anatomy, equipment, environment, lighting, and art style.",
  "- Perform the described primary action clearly.",
  "- Use the specified camera behavior; if none is specified, keep the camera mostly stable.",
  "- Add only subtle secondary environmental motion that supports the primary action.",
  "- Finish in the described ending pose or dramatic hold.",
  "- Keep this as one continuous anime shot without cuts or scene changes.",
  "- Use controlled anime timing: anticipation, decisive movement, impact or emotional reaction, then a brief settling hold.",
  "- Stage severe harm with broadcast-anime restraint using occlusion, silhouette, impact light, reaction framing, and aftermath.",
  "- Avoid unrelated movement, new characters, duplicated subjects, morphing, costume changes, distorted anatomy, subtitles, captions, speech bubbles, UI, logos, and watermarks.",
].join("\n");

export const GAME_VIDEO_BUILT_IN_PROMPT_TEMPLATES: AgentPromptTemplateOption[] = [
  {
    id: GAME_VIDEO_PROMPT_TEMPLATE_ID,
    name: "Cinematic Scene Video",
    description:
      "Default Game Mode video prompt for animating a saved scene or storyboard keyframe from its first-frame image.",
    promptTemplate: GAME_VIDEO_PROMPT_TEMPLATE,
  },
  {
    id: ANIME_GAME_VIDEO_PROMPT_TEMPLATE_ID,
    name: "Anime Game Video",
    description:
      "Animates a generated first frame as a continuous anime shot while preserving characters and composition.",
    promptTemplate: ANIME_GAME_VIDEO_PROMPT_TEMPLATE,
  },
];
