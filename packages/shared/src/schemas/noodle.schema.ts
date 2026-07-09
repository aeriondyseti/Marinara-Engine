// ──────────────────────────────────────────────
// Noodle Zod Schemas
// ──────────────────────────────────────────────
import { z } from "zod";

export const noodleAccountKindSchema = z.enum(["persona", "character", "random_user"]);
export const noodleInteractionTypeSchema = z.enum(["like", "repost", "reply"]);
export const noodleParticipantSelectionModeSchema = z.enum(["all", "random_range", "exact"]);
export const noodleCarryoverModeSchema = z.enum(["off", "conversation", "roleplay", "game", "all"]);
export const noodleCarryoverTargetSchema = z.enum(["conversation", "roleplay", "game"]);
export const noodleThemeSchema = z.enum(["system", "light", "dark"]);

export const DEFAULT_NOODLE_SETTINGS = {
  refreshesPerDay: 2,
  participantSelectionMode: "random_range",
  participantMin: 2,
  participantMax: 5,
  maxGeneratedPostsPerRefresh: 8,
  maxRepliesPerRefresh: 12,
  maxRepostsPerRefresh: 4,
  maxLikesPerRefresh: 18,
  maxImagePromptsPerDay: 3,
  enableImagePrompts: false,
  imageGenerationConnectionId: null,
  imageGenerationPrompt:
    "Create either a social-media-ready character image or an in-character meme for the post. For character images, mention build, clothing, visible appearance, pose, expression, setting, lighting, mood, and composition. For memes, mention meme format, visual gag, composition, and short readable caption/text when relevant.",
  imageGenerationUseAvatarReferences: true,
  imageGenerationIncludeDescriptions: true,
  allowGalleryImageAttachments: false,
  allowRandomUsers: false,
  invitedCharacterGroupIds: [],
  carryoverMode: "off",
  carryoverModes: [],
  carryoverHours: 48,
  carryoverMaxItems: 8,
  theme: "system",
  generationConnectionId: null,
} as const;

export const noodleSettingsSchema = z.object({
  refreshesPerDay: z.number().int().min(0).max(24).default(DEFAULT_NOODLE_SETTINGS.refreshesPerDay),
  participantSelectionMode: noodleParticipantSelectionModeSchema.default(
    DEFAULT_NOODLE_SETTINGS.participantSelectionMode,
  ),
  participantMin: z.number().int().min(1).max(100).default(DEFAULT_NOODLE_SETTINGS.participantMin),
  participantMax: z.number().int().min(1).max(100).default(DEFAULT_NOODLE_SETTINGS.participantMax),
  maxGeneratedPostsPerRefresh: z
    .number()
    .int()
    .min(0)
    .max(100)
    .default(DEFAULT_NOODLE_SETTINGS.maxGeneratedPostsPerRefresh),
  maxRepliesPerRefresh: z.number().int().min(0).max(200).default(DEFAULT_NOODLE_SETTINGS.maxRepliesPerRefresh),
  maxRepostsPerRefresh: z.number().int().min(0).max(100).default(DEFAULT_NOODLE_SETTINGS.maxRepostsPerRefresh),
  maxLikesPerRefresh: z.number().int().min(0).max(500).default(DEFAULT_NOODLE_SETTINGS.maxLikesPerRefresh),
  maxImagePromptsPerDay: z.number().int().min(0).max(50).default(DEFAULT_NOODLE_SETTINGS.maxImagePromptsPerDay),
  enableImagePrompts: z.boolean().default(DEFAULT_NOODLE_SETTINGS.enableImagePrompts),
  imageGenerationConnectionId: z
    .string()
    .min(1)
    .nullable()
    .default(DEFAULT_NOODLE_SETTINGS.imageGenerationConnectionId),
  imageGenerationPrompt: z.string().max(4000).default(DEFAULT_NOODLE_SETTINGS.imageGenerationPrompt),
  imageGenerationUseAvatarReferences: z.boolean().default(DEFAULT_NOODLE_SETTINGS.imageGenerationUseAvatarReferences),
  imageGenerationIncludeDescriptions: z.boolean().default(DEFAULT_NOODLE_SETTINGS.imageGenerationIncludeDescriptions),
  allowGalleryImageAttachments: z.boolean().default(DEFAULT_NOODLE_SETTINGS.allowGalleryImageAttachments),
  allowRandomUsers: z.boolean().default(DEFAULT_NOODLE_SETTINGS.allowRandomUsers),
  invitedCharacterGroupIds: z
    .array(z.string().min(1))
    .default(() => [...DEFAULT_NOODLE_SETTINGS.invitedCharacterGroupIds]),
  carryoverMode: noodleCarryoverModeSchema.default(DEFAULT_NOODLE_SETTINGS.carryoverMode),
  carryoverModes: z.array(noodleCarryoverTargetSchema).default(() => [...DEFAULT_NOODLE_SETTINGS.carryoverModes]),
  carryoverHours: z.number().int().min(1).max(720).default(DEFAULT_NOODLE_SETTINGS.carryoverHours),
  carryoverMaxItems: z.number().int().min(1).max(50).default(DEFAULT_NOODLE_SETTINGS.carryoverMaxItems),
  theme: noodleThemeSchema.default(DEFAULT_NOODLE_SETTINGS.theme),
  generationConnectionId: z.string().min(1).nullable().default(DEFAULT_NOODLE_SETTINGS.generationConnectionId),
});

export const noodleSettingsUpdateSchema = noodleSettingsSchema.partial();

export const noodleAccountUpdateSchema = z.object({
  handle: z.string().min(1).max(40).optional(),
  displayName: z.string().min(1).max(120).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().max(2000).nullable().optional(),
  invited: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export const noodleInviteSchema = z.object({
  characterId: z.string().min(1),
});

export const noodleBulkInviteSchema = z.object({
  characterIds: z.array(z.string().min(1)).min(1).max(5000),
});

export const noodleCreatePostSchema = z.object({
  authorKind: noodleAccountKindSchema,
  authorEntityId: z.string().min(1),
  content: z.string().min(1).max(4000),
  imageUrl: z.string().max(2000).nullable().optional(),
  imagePrompt: z.string().max(2000).nullable().optional(),
  parentPostId: z.string().min(1).nullable().optional(),
  quotePostId: z.string().min(1).nullable().optional(),
});

export const noodlePostUpdateSchema = z.object({
  content: z.string().trim().min(1).max(4000).optional(),
  imageUrl: z.string().max(2000).nullable().optional(),
  imagePrompt: z.string().max(2000).nullable().optional(),
});

export const noodleCreateInteractionSchema = z.object({
  actorKind: noodleAccountKindSchema,
  actorEntityId: z.string().min(1),
  type: noodleInteractionTypeSchema,
  content: z.string().max(2000).nullable().optional(),
});

export const noodleRemoveInteractionSchema = z.object({
  actorKind: noodleAccountKindSchema,
  actorEntityId: z.string().min(1),
  type: z.enum(["like", "repost"]),
});

export const noodleRefreshSchema = z.object({
  personaId: z.string().min(1).optional(),
  connectionId: z.string().min(1).optional(),
  debugMode: z.boolean().optional(),
});

export const noodleGeneratedPostSchema = z.object({
  tempId: z.string().min(1).optional(),
  authorEntityId: z.string().min(1),
  content: z.string().min(1).max(4000),
  imagePrompt: z.string().max(2000).nullable().optional(),
  attachGalleryImage: z.boolean().optional().default(false),
});

export const noodleGeneratedInteractionSchema = z.object({
  actorEntityId: z.string().min(1),
  targetTempId: z.string().min(1).optional(),
  targetPostId: z.string().min(1).optional(),
  type: noodleInteractionTypeSchema,
  content: z.string().max(2000).nullable().optional(),
});

export const noodleGeneratedFollowSchema = z.object({
  actorEntityId: z.string().min(1),
  targetEntityId: z.string().min(1),
});

export const noodleGeneratedDigestSchema = z.object({
  accountEntityIds: z.array(z.string().min(1)).default([]),
  content: z.string().min(1).max(1200),
});

export const noodleGeneratedProfileSchema = z.object({
  entityId: z.string().min(1),
  name: z.string().min(1).max(120),
  handle: z.string().min(1).max(40),
  bio: z.string().max(500).default(""),
  location: z.string().max(120).default(""),
});

export const noodleGeneratedRefreshSchema = z.object({
  posts: z.array(noodleGeneratedPostSchema).default([]),
  interactions: z.array(noodleGeneratedInteractionSchema).default([]),
  follows: z.array(noodleGeneratedFollowSchema).default([]),
  digests: z.array(noodleGeneratedDigestSchema).default([]),
});

export const noodleGeneratedProfilesSchema = z.object({
  profiles: z.array(noodleGeneratedProfileSchema).default([]),
});

export type NoodleSettingsInput = z.infer<typeof noodleSettingsSchema>;
export type NoodleSettingsUpdateInput = z.infer<typeof noodleSettingsUpdateSchema>;
export type NoodleAccountUpdateInput = z.infer<typeof noodleAccountUpdateSchema>;
export type NoodleInviteInput = z.infer<typeof noodleInviteSchema>;
export type NoodleBulkInviteInput = z.infer<typeof noodleBulkInviteSchema>;
export type NoodleCreatePostInput = z.infer<typeof noodleCreatePostSchema>;
export type NoodlePostUpdateInput = z.infer<typeof noodlePostUpdateSchema>;
export type NoodleCreateInteractionInput = z.infer<typeof noodleCreateInteractionSchema>;
export type NoodleRemoveInteractionInput = z.infer<typeof noodleRemoveInteractionSchema>;
export type NoodleRefreshInput = z.infer<typeof noodleRefreshSchema>;
export type NoodleGeneratedRefresh = z.infer<typeof noodleGeneratedRefreshSchema>;
export type NoodleGeneratedProfiles = z.infer<typeof noodleGeneratedProfilesSchema>;
