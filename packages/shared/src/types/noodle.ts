// ──────────────────────────────────────────────
// Noodle Fake Social Media Types
// ──────────────────────────────────────────────

export type NoodleAccountKind = "persona" | "character" | "random_user";
export type NoodleInteractionType = "like" | "repost" | "reply";
export type NoodlePostSource = "manual" | "generated";
export type NoodleTheme = "system" | "light" | "dark";
export type NoodleCarryoverMode = "off" | "conversation" | "roleplay" | "game" | "all";
export type NoodleCarryoverTarget = "conversation" | "roleplay" | "game";
export type NoodleParticipantSelectionMode = "all" | "random_range" | "exact";

export interface NoodleSettings {
  refreshesPerDay: number;
  participantSelectionMode: NoodleParticipantSelectionMode;
  participantMin: number;
  participantMax: number;
  maxGeneratedPostsPerRefresh: number;
  maxRepliesPerRefresh: number;
  maxRepostsPerRefresh: number;
  maxLikesPerRefresh: number;
  maxImagePromptsPerDay: number;
  enableImagePrompts: boolean;
  imageGenerationConnectionId: string | null;
  imageGenerationPrompt: string;
  imageGenerationUseAvatarReferences: boolean;
  imageGenerationIncludeDescriptions: boolean;
  allowGalleryImageAttachments: boolean;
  allowRandomUsers: boolean;
  invitedCharacterGroupIds: string[];
  carryoverMode: NoodleCarryoverMode;
  carryoverModes: NoodleCarryoverTarget[];
  carryoverHours: number;
  carryoverMaxItems: number;
  theme: NoodleTheme;
  generationConnectionId: string | null;
}

export interface NoodleAccount {
  id: string;
  kind: NoodleAccountKind;
  entityId: string;
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  invited: boolean;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface NoodleAuthorSnapshot {
  id: string;
  kind: NoodleAccountKind;
  entityId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface NoodlePost {
  id: string;
  authorAccountId: string;
  content: string;
  imageUrl: string | null;
  imagePrompt: string | null;
  parentPostId: string | null;
  quotePostId: string | null;
  source: NoodlePostSource;
  metadata: Record<string, unknown>;
  authorSnapshot: NoodleAuthorSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoodleInteraction {
  id: string;
  postId: string;
  actorAccountId: string;
  type: NoodleInteractionType;
  content: string | null;
  actorSnapshot: NoodleAuthorSnapshot | null;
  createdAt: string;
}

export interface NoodleDigestEntry {
  id: string;
  accountIds: string[];
  content: string;
  sourceRunId: string | null;
  sourcePostId: string | null;
  createdAt: string;
}

export interface NoodleRefreshRun {
  id: string;
  status: "running" | "completed" | "failed";
  activeAccountIds: string[];
  prompt: string;
  result: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoodleBootstrap {
  settings: NoodleSettings;
  accounts: NoodleAccount[];
  posts: NoodlePost[];
  interactions: NoodleInteraction[];
  digests: NoodleDigestEntry[];
}
