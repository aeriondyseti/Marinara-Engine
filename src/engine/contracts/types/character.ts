// ──────────────────────────────────────────────
// Character Card V2 Types (compatible with ST / Chub)
// ──────────────────────────────────────────────
import type { AltDescription } from "./persona";

/** Full Character Card V2 envelope. */
export interface CharacterCardV2 {
  spec: "chara_card_v2";
  spec_version: "2.0";
  data: CharacterData;
}

/** Core character data (V2 spec). */
export interface CharacterData {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  tags: string[];
  creator: string;
  character_version: string;
  alternate_greetings: string[];
  extensions: CharacterExtensions;
  character_book: CharacterBook | null;
}

/** ST-compatible extension fields. */
export interface CharacterExtensions {
  talkativeness: number;
  fav: boolean;
  world: string;
  depth_prompt: DepthPrompt;
  /** Marinara Engine extension: character backstory / lore */
  backstory: string;
  /** Marinara Engine extension: physical appearance description */
  appearance: string;
  /** Marinara Engine: toggleable additions appended to the main character description */
  altDescriptions?: AltDescription[];
  /** Marinara Engine: Name display color/gradient (CSS value, e.g. "linear-gradient(90deg, #ff6b6b, #ffd93d)" or "#ff6b6b") */
  nameColor?: string;
  /** Marinara Engine: Dialogue highlight color — text in quotation marks is bold + colored with this */
  dialogueColor?: string;
  /** Marinara Engine: Chat bubble / dialogue box background color */
  boxColor?: string;
  /** Marinara Engine: RPG stats toggle + custom attributes */
  rpgStats?: RPGStatsConfig;
  /** Marinara Engine: Conversation-mode availability status */
  conversationStatus?: "online" | "idle" | "dnd" | "offline";
  /**
   * Marinara Engine: per-persona outgoing relationship edges populated by
   * the Relationship Tracker agent. Each entry is this character's tiered
   * event ledger toward one persona. See docs/agents/relationship-tracker.md.
   */
  relationships?: CharacterRelationship[];
  [key: string]: unknown;
}

// ──────────────────────────────────────────────
// Relationship Tracker storage — see docs/agents/relationship-tracker.md §13
// ──────────────────────────────────────────────

/**
 * One outgoing edge from this character toward one persona. The event ledger
 * is tiered: hot events at full fidelity, session summaries for older
 * sessions, a rolling lifetime aggregate for very old history, and milestone-
 * triggering events preserved verbatim regardless of age. All derived
 * metrics (affinity, trust, familiarity, etc.) are folds over these four
 * structures combined; nothing is stored as a numeric scalar.
 */
export interface CharacterRelationship {
  /** The persona this edge concerns. */
  personaId: string;
  /** Tier 1 — hot events, individual records, full fidelity. */
  events: RelationshipEventRecord[];
  /** Tier 2 — per-session summaries for sessions past the hot window. */
  sessionSummaries: RelationshipSessionSummary[];
  /** Tier 3 — single rolling lifetime aggregate. */
  lifetime: RelationshipLifetimeAggregate;
  /** Events that triggered a milestone latch; bypass rollup permanently. */
  preservedEvents: RelationshipEventRecord[];
  /** Most recent chat in which an event was appended. */
  lastChatId: string;
  /** Wall-clock timestamp of the most recent event. */
  updatedAt: string;
}

/**
 * A stored relationship event with timestamping populated by the writeback
 * layer. Mirrors `RelationshipEvent` from agent.ts; redeclared here so this
 * type module has no inbound dependency on the agent module.
 */
export interface RelationshipEventRecord {
  at: string;
  chatId: string;
  magnitude: "minor" | "moderate" | "major";
  valence: "positive" | "negative" | "neutral";
  initiator: "persona" | "character" | "mutual" | "external";
  confidence: "low" | "medium" | "high";
  description: string;
}

/**
 * Compressed record of one chat session's events, produced when events past
 * the hot window roll up at session boundaries. Counts are lossless; verbatim
 * descriptions are kept only for `highlights`.
 */
export interface RelationshipSessionSummary {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  eventCount: number;
  /** Tally by magnitude × valence — every combination counted. */
  tally: {
    minor: { positive: number; negative: number; neutral: number };
    moderate: { positive: number; negative: number; neutral: number };
    major: { positive: number; negative: number; neutral: number };
  };
  initiatorTally: {
    persona: number;
    character: number;
    mutual: number;
    external: number;
  };
  /** 1-3 highest-magnitude descriptions preserved verbatim. */
  highlights: string[];
  /** Weighted valence sum for trajectory comparison. */
  netValence: number;
}

/**
 * Rolling aggregate across all sessions older than `sessionHistoryWindow`.
 * Single fixed-size structure regardless of total history length.
 */
export interface RelationshipLifetimeAggregate {
  totalEventCount: number;
  tally: {
    minor: { positive: number; negative: number; neutral: number };
    moderate: { positive: number; negative: number; neutral: number };
    major: { positive: number; negative: number; neutral: number };
  };
  initiatorTally: {
    persona: number;
    character: number;
    mutual: number;
    external: number;
  };
  firstEventAt: string;
  /** Latched milestones with the triggering event preserved verbatim. */
  latchedMilestones: Record<
    string,
    {
      triggeredAt: string;
      sessionId: string;
      description: string;
    }
  >;
}

/** RPG stats configuration attached to a character card. */
export interface RPGStatsConfig {
  /** Whether RPG stats are enabled for this character */
  enabled: boolean;
  /** Custom attribute list (e.g. STR, DEX, CHA — user can rename/add/remove) */
  attributes: Array<{ name: string; value: number }>;
  /** Hit Points */
  hp: { value: number; max: number };
}

/** Depth-injected prompt attached to a character. */
export interface DepthPrompt {
  prompt: string;
  depth: number;
  role: "system" | "user" | "assistant";
}

/** Embedded lorebook inside a character card. */
export interface CharacterBook {
  name: string;
  description: string;
  scan_depth: number;
  token_budget: number;
  recursive_scanning: boolean;
  extensions: Record<string, unknown>;
  entries: CharacterBookEntry[];
}

/** A single entry in a character book. */
export interface CharacterBookEntry {
  keys: string[];
  content: string;
  extensions: Record<string, unknown>;
  enabled: boolean;
  insertion_order: number;
  case_sensitive: boolean;
  name: string;
  priority: number;
  id: number;
  comment: string;
  selective: boolean;
  secondary_keys: string[];
  constant: boolean;
  position: "before_char" | "after_char";
}

/** Our internal Character representation (extends V2 with engine-specific fields). */
export interface Character {
  id: string;
  /** Original V2 data preserved for export compatibility */
  data: CharacterData;
  /** User-only note shown under the character name in selectors and editors */
  comment: string;
  /** Path to avatar image file */
  avatarPath: string | null;
  /** Path to sprite folder */
  spriteFolderPath: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Saved snapshot of a previous character card state. */
export interface CharacterCardVersion {
  id: string;
  characterId: string;
  data: CharacterData;
  comment: string;
  avatarPath: string | null;
  avatarFilePath?: string | null;
  avatarFilename?: string | null;
  version: string;
  source: "manual" | "agent" | "command" | "restore" | string;
  reason: string;
  createdAt: string;
}

/** A group of characters (e.g. "Fatui Harbingers") — acts as a preset that adds all members to a chat. */
export interface CharacterGroup {
  id: string;
  name: string;
  description: string;
  avatarPath: string | null;
  /** IDs of characters belonging to this group */
  characterIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** A group of personas — for organising user personas. */
export interface PersonaGroup {
  id: string;
  name: string;
  description: string;
  /** IDs of personas belonging to this group */
  personaIds: string[];
  createdAt: string;
  updatedAt: string;
}
