// @vitest-environment jsdom

import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { storageApi } from "../../../../shared/api/storage-api";
import {
  applyRelationshipProposal,
  buildPendingRelationshipDecisions,
} from "./relationship-tracker-updates";
import type { CharacterRelationship } from "../../../../engine/contracts/types/character";
import type { PendingRelationshipProposal } from "../../../../shared/stores/agent.store";

vi.mock("../../../../shared/api/storage-api", () => ({
  storageApi: {
    get: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
}));

const storageGetMock = vi.mocked(storageApi.get);
const storageUpdateMock = vi.mocked(storageApi.update);
const storageListMock = vi.mocked(storageApi.list);

const CHAT_ID = "chat-001";
const PERSONA_ID = "persona-001";
const CHARACTER_ID = "char-001";

function makeChat(characterIds: string[] = [CHARACTER_ID]) {
  return { id: CHAT_ID, personaId: PERSONA_ID, characterIds };
}

/**
 * Build a character row using the canonical V2 shape: extensions live
 * nested under `data.extensions`. Matches what the rest of the codebase
 * writes (scene-service.ts, connected-commands.ts).
 */
function makeCharacterRow(extensions: Record<string, unknown> = {}) {
  return {
    id: CHARACTER_ID,
    name: "Ada",
    data: { name: "Ada", extensions },
  };
}

function makeAgentRow(approvalMode: "auto" | "manual" | "significant" = "auto") {
  // Agent rows in storage use a UUID id with `type` field — never id===type.
  return { id: "agent-uuid-xyz", type: "relationship-tracker", settings: { approvalMode } };
}

function setupStorage(
  agentRow: ReturnType<typeof makeAgentRow> | null,
  charRow: ReturnType<typeof makeCharacterRow> | null,
  chat: ReturnType<typeof makeChat> | null = makeChat(),
) {
  storageListMock.mockImplementation((collection: string) => {
    if (collection === "agents") return Promise.resolve(agentRow ? [agentRow] : ([] as never));
    return Promise.resolve([] as never);
  });
  storageGetMock.mockImplementation((collection: string, id: string) => {
    if (collection === "characters" && id === CHARACTER_ID) {
      return Promise.resolve(charRow as never);
    }
    if (collection === "chats" && id === CHAT_ID) {
      return Promise.resolve(chat as never);
    }
    return Promise.resolve(null as never);
  });
}

function makeProposalPayload(overrides: Record<string, unknown> = {}) {
  return {
    events: [
      {
        characterId: CHARACTER_ID,
        personaId: PERSONA_ID,
        magnitude: "minor",
        valence: "positive",
        initiator: "persona",
        confidence: "high",
        description: "Persona greeted Ada warmly.",
        ...overrides,
      },
    ],
  };
}

describe("relationship-tracker-updates", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  describe("routing (via buildPendingRelationshipDecisions)", () => {
    // Routing decisions are observable through the public function's
    // returned shape: `queued[].queueReason` for queue routes, and the
    // `appliedCount` / persisted writes for auto-apply routes.
    it("returns empty when no events in data", async () => {
      setupStorage(makeAgentRow(), makeCharacterRow());
      const r = await buildPendingRelationshipDecisions(queryClient, CHAT_ID, "agent", { events: [] });
      expect(r.queued).toEqual([]);
      expect(r.appliedCount).toBe(0);
    });

    it("drops proposals for characters not in the chat", async () => {
      setupStorage(makeAgentRow(), makeCharacterRow(), makeChat(["other-char"]));
      const r = await buildPendingRelationshipDecisions(queryClient, CHAT_ID, "agent", makeProposalPayload());
      expect(r.queued).toEqual([]);
      expect(r.appliedCount).toBe(0);
    });

    it("queues the first event ever in a chat regardless of mode", async () => {
      // Auto mode would normally auto-apply minor+high; first-event-in-chat overrides.
      setupStorage(makeAgentRow("auto"), makeCharacterRow());
      const r = await buildPendingRelationshipDecisions(queryClient, CHAT_ID, "agent", makeProposalPayload());
      expect(r.queued).toHaveLength(1);
      expect(r.queued[0].queueReason).toBe("first_event_in_chat");
      expect(r.appliedCount).toBe(0);
    });

    it("auto-applies minor+high events on subsequent turns in auto mode", async () => {
      const existingRel: CharacterRelationship = {
        personaId: PERSONA_ID,
        events: [
          {
            at: "2026-01-01T00:00:00.000Z",
            chatId: CHAT_ID,
            magnitude: "minor",
            valence: "positive",
            initiator: "persona",
            confidence: "high",
            description: "earlier event",
          },
        ],
        sessionSummaries: [],
        lifetime: {
          totalEventCount: 1,
          tally: {
            minor: { positive: 1, negative: 0, neutral: 0 },
            moderate: { positive: 0, negative: 0, neutral: 0 },
            major: { positive: 0, negative: 0, neutral: 0 },
          },
          initiatorTally: { persona: 1, character: 0, mutual: 0, external: 0 },
          firstEventAt: "2026-01-01T00:00:00.000Z",
          latchedMilestones: {},
        },
        preservedEvents: [],
        lastChatId: CHAT_ID,
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      setupStorage(makeAgentRow("auto"), makeCharacterRow({ relationships: [existingRel] }));
      storageUpdateMock.mockResolvedValue(undefined as never);
      const r = await buildPendingRelationshipDecisions(queryClient, CHAT_ID, "agent", makeProposalPayload());
      expect(r.queued).toHaveLength(0);
      expect(r.appliedCount).toBe(1);
    });

    it("queues major events in significant mode even with high confidence", async () => {
      const existingRel: CharacterRelationship = {
        personaId: PERSONA_ID,
        events: [
          {
            at: "2026-01-01T00:00:00.000Z",
            chatId: CHAT_ID,
            magnitude: "minor",
            valence: "positive",
            initiator: "persona",
            confidence: "high",
            description: "prior event",
          },
        ],
        sessionSummaries: [],
        lifetime: {
          totalEventCount: 1,
          tally: {
            minor: { positive: 1, negative: 0, neutral: 0 },
            moderate: { positive: 0, negative: 0, neutral: 0 },
            major: { positive: 0, negative: 0, neutral: 0 },
          },
          initiatorTally: { persona: 1, character: 0, mutual: 0, external: 0 },
          firstEventAt: "2026-01-01T00:00:00.000Z",
          latchedMilestones: {},
        },
        preservedEvents: [],
        lastChatId: CHAT_ID,
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      setupStorage(makeAgentRow("significant"), makeCharacterRow({ relationships: [existingRel] }));
      const r = await buildPendingRelationshipDecisions(
        queryClient,
        CHAT_ID,
        "agent",
        makeProposalPayload({ magnitude: "major" }),
      );
      expect(r.queued[0].queueReason).toBe("significant_magnitude");
      expect(r.appliedCount).toBe(0);
    });

    it("ignores malformed proposals (missing required fields)", async () => {
      setupStorage(makeAgentRow(), makeCharacterRow());
      const r = await buildPendingRelationshipDecisions(queryClient, CHAT_ID, "agent", {
        events: [
          // missing personaId
          { characterId: CHARACTER_ID, magnitude: "minor", valence: "positive", initiator: "persona", confidence: "high", description: "hi" },
          // invalid magnitude
          { characterId: CHARACTER_ID, personaId: PERSONA_ID, magnitude: "huge", valence: "positive", initiator: "persona", confidence: "high", description: "x" },
        ],
      });
      expect(r.queued).toEqual([]);
      expect(r.appliedCount).toBe(0);
    });
  });

  describe("buildPendingRelationshipDecisions", () => {
    it("queues first-event proposals without persisting", async () => {
      setupStorage(makeAgentRow("auto"), makeCharacterRow());
      const { queued, appliedCount } = await buildPendingRelationshipDecisions(
        queryClient,
        CHAT_ID,
        "Relationship Tracker",
        makeProposalPayload(),
      );
      expect(queued).toHaveLength(1);
      expect(appliedCount).toBe(0);
      expect(queued[0].queueReason).toBe("first_event_in_chat");
      expect(queued[0].characterName).toBe("Ada");
      expect(queued[0].chatId).toBe(CHAT_ID);
      expect(storageUpdateMock).not.toHaveBeenCalled();
    });

    it("auto-applies in auto mode after the first event and writes back to extensions", async () => {
      const existingRel: CharacterRelationship = {
        personaId: PERSONA_ID,
        events: [
          {
            at: "2026-01-01T00:00:00.000Z",
            chatId: CHAT_ID,
            magnitude: "minor",
            valence: "positive",
            initiator: "persona",
            confidence: "high",
            description: "prior event",
          },
        ],
        sessionSummaries: [],
        lifetime: {
          totalEventCount: 1,
          tally: {
            minor: { positive: 1, negative: 0, neutral: 0 },
            moderate: { positive: 0, negative: 0, neutral: 0 },
            major: { positive: 0, negative: 0, neutral: 0 },
          },
          initiatorTally: { persona: 1, character: 0, mutual: 0, external: 0 },
          firstEventAt: "2026-01-01T00:00:00.000Z",
          latchedMilestones: {},
        },
        preservedEvents: [],
        lastChatId: CHAT_ID,
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      setupStorage(makeAgentRow("auto"), makeCharacterRow({ relationships: [existingRel] }));
      storageUpdateMock.mockResolvedValue(undefined as never);

      const { queued, appliedCount } = await buildPendingRelationshipDecisions(
        queryClient,
        CHAT_ID,
        "Relationship Tracker",
        makeProposalPayload(),
      );

      expect(queued).toHaveLength(0);
      expect(appliedCount).toBe(1);
      expect(storageUpdateMock).toHaveBeenCalledTimes(1);
      const [collection, id, patch] = storageUpdateMock.mock.calls[0]!;
      expect(collection).toBe("characters");
      expect(id).toBe(CHARACTER_ID);
      const data = (patch as { data: { extensions: { relationships: CharacterRelationship[] } } }).data;
      const ext = data.extensions;
      expect(ext.relationships).toHaveLength(1);
      expect(ext.relationships[0].events).toHaveLength(2);
      expect(ext.relationships[0].events[1].description).toBe("Persona greeted Ada warmly.");
    });
  });

  describe("applyRelationshipProposal", () => {
    function makePending(): PendingRelationshipProposal {
      return {
        id: "pending-1",
        chatId: CHAT_ID,
        characterId: CHARACTER_ID,
        characterName: "Ada",
        personaId: PERSONA_ID,
        agentName: "Relationship Tracker",
        queueReason: "first_event_in_chat",
        timestamp: 1,
        proposal: {
          characterId: CHARACTER_ID,
          personaId: PERSONA_ID,
          magnitude: "moderate",
          valence: "positive",
          initiator: "persona",
          confidence: "high",
          description: "Persona shared a treasured memory with Ada.",
        },
      };
    }

    it("persists the event when the character row exists", async () => {
      setupStorage(makeAgentRow(), makeCharacterRow());
      storageUpdateMock.mockResolvedValue(undefined as never);

      const result = await applyRelationshipProposal(queryClient, makePending());
      expect(result).toBe(true);
      expect(storageUpdateMock).toHaveBeenCalledTimes(1);
      const patch = storageUpdateMock.mock.calls[0]![2] as { data: { extensions: { relationships: CharacterRelationship[] } } };
      const rel = patch.data.extensions.relationships[0]!;
      expect(rel.events).toHaveLength(1);
      expect(rel.events[0].magnitude).toBe("moderate");
      expect(rel.events[0].chatId).toBe(CHAT_ID);
    });

    it("returns false when the character row has been deleted", async () => {
      setupStorage(makeAgentRow(), null);
      const result = await applyRelationshipProposal(queryClient, makePending());
      expect(result).toBe(false);
      expect(storageUpdateMock).not.toHaveBeenCalled();
    });
  });
});
