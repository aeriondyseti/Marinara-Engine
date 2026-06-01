/**
 * Relationship Tracker — public API surface.
 *
 * Re-exports the small set of functions and types actually consumed by
 * integration code (agent-runner, agent-executor, the UI writeback path).
 * Everything else stays addressable via the module-file imports (`./fold`,
 * `./hydration`, `./rollup`, `./writeback`, `./adapters`) — tests reach
 * for those directly. The barrel is intentionally narrow so knip can
 * catch genuinely-unused exports as the API surface evolves.
 *
 * The agent prompt template lives in
 * `src/engine/contracts/constants/agent-prompts.ts` under the
 * `"relationship-tracker"` key, and the result-normalizer for the
 * `relationship_event` agent result type lives in
 * `src/engine/generation/agent-normalizers.ts` as `normalizeRelationshipEvents`.
 */

// Consumed by agent-executor.ts (renders <current_state> block).
export { buildCurrentStateBlock } from "./hydration";

// Consumed by the UI writeback adapter (relationship-tracker-updates.ts).
export {
  routeProposal,
  applyEventToRelationship,
  isFirstEventInChatId,
  resolveApprovalSettings,
  type ApprovalSettings,
  type QueueReason,
} from "./writeback";

// Consumed by agent-runner.ts (hydration) and the UI writeback adapter.
export { getRelationshipForPersona, setRelationshipForPersona } from "./adapters";
