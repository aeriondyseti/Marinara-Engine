// ──────────────────────────────────────────────
// Modal: Review queued relationship_event proposals
// ──────────────────────────────────────────────
//
// The Relationship Tracker post-processing agent classifies each turn's
// interactions into events (magnitude × valence × initiator) per character.
// Some proposals always queue for the user — low confidence, first-event-
// in-chat, or when the agent is set to "manual" / "significant" mode (see
// docs §7). This modal pops queued proposals one at a time so the user can
// approve, edit, or reject.
//
// The form state is held in a child component keyed by `entry.id`; React
// resets that child on each new entry, so edits never leak from one
// proposal to the next (even when consecutive entries share characterId).
import { useState } from "react";
import { Loader2, Heart, Check, X, AlertCircle } from "lucide-react";
import { Modal } from "../../../../shared/components/ui/Modal";
import { useAgentStore } from "../../../../shared/stores/agent.store";
import { useQueryClient } from "@tanstack/react-query";
import { applyRelationshipProposal } from "../lib/relationship-tracker-updates";
import type {
  RelationshipEventProposal,
  RelationshipMagnitude,
  RelationshipValence,
  RelationshipInitiator,
} from "../../../../engine/contracts/types/agent";
import type { QueueReason } from "../../../../engine/agents-runtime/relationship-tracker";
import type { PendingRelationshipProposal } from "../../../../shared/stores/agent.store";

const MAGNITUDE_OPTIONS: RelationshipMagnitude[] = ["minor", "moderate", "major"];
const VALENCE_OPTIONS: RelationshipValence[] = ["positive", "neutral", "negative"];
const INITIATOR_OPTIONS: RelationshipInitiator[] = ["persona", "character", "mutual", "external"];

const QUEUE_REASON_LABELS: Record<QueueReason, string> = {
  mode_manual: "Manual approval mode",
  low_confidence: "Agent flagged low confidence",
  medium_confidence_in_significant_mode: "Medium confidence — needs review",
  first_event_in_chat: "First event with this character in this chat",
  significant_magnitude: "Significant magnitude (moderate or major)",
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export function RelationshipProposalModal({ open, onClose }: Props) {
  const pending = useAgentStore((s) => s.pendingRelationshipProposals);
  const entry = pending[0] ?? null;

  if (!entry) return null;

  return (
    <Modal open={open} onClose={onClose} title="Review Relationship Event" width="max-w-2xl">
      <ProposalReviewForm
        key={entry.id}
        entry={entry}
        queuedAfter={Math.max(0, pending.length - 1)}
        onClose={onClose}
      />
    </Modal>
  );
}

interface FormProps {
  entry: PendingRelationshipProposal;
  queuedAfter: number;
  onClose: () => void;
}

function ProposalReviewForm({ entry, queuedAfter, onClose }: FormProps) {
  const dismiss = useAgentStore((s) => s.dismissPendingRelationshipProposal);
  const queryClient = useQueryClient();

  // Form state lives inside this child — the parent re-mounts it (via
  // key={entry.id}) whenever a new entry is popped, so React's reset
  // semantics handle "new proposal = clean draft" without manual sync.
  const [draft, setDraft] = useState<RelationshipEventProposal>({ ...entry.proposal });
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const advanceOrClose = () => {
    dismiss(entry.id);
    // Read the queue directly from the store rather than a render-cycle
    // subscription. Inside an async approve handler, a subscribed
    // `pendingNow` is the snapshot from the render that started the
    // approve — entries enqueued mid-flight wouldn't show up. The
    // imperative `getState()` read reflects the post-dismiss truth.
    if (useAgentStore.getState().pendingRelationshipProposals.length === 0) {
      onClose();
    }
  };

  const handleApprove = async () => {
    setApplying(true);
    setError(null);
    try {
      const written = await applyRelationshipProposal(queryClient, { ...entry, proposal: draft });
      if (!written) {
        setError("Character could not be loaded — it may have been deleted.");
        return;
      }
      advanceOrClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record relationship event");
    } finally {
      setApplying(false);
    }
  };

  const queueNote = queuedAfter > 0 ? ` (${queuedAfter} more queued)` : "";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-rose-400 to-pink-500 shadow-lg shadow-rose-400/20">
          <Heart size="1.375rem" className="text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">{entry.characterName}</p>
          <p className="text-xs text-[var(--muted-foreground)]">
            {entry.agentName} — {QUEUE_REASON_LABELS[entry.queueReason]}
            {queueNote}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg bg-[var(--secondary)] p-3 ring-1 ring-[var(--border)]">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Event (confidence: {draft.confidence})
        </span>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted-foreground)]">Magnitude</span>
            <select
              value={draft.magnitude}
              onChange={(e) => setDraft({ ...draft, magnitude: e.target.value as RelationshipMagnitude })}
              className="rounded-md bg-[var(--background)] px-2 py-1 ring-1 ring-[var(--border)]"
            >
              {MAGNITUDE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted-foreground)]">Valence</span>
            <select
              value={draft.valence}
              onChange={(e) => setDraft({ ...draft, valence: e.target.value as RelationshipValence })}
              className="rounded-md bg-[var(--background)] px-2 py-1 ring-1 ring-[var(--border)]"
            >
              {VALENCE_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-[var(--muted-foreground)]">Initiator</span>
            <select
              value={draft.initiator}
              onChange={(e) => setDraft({ ...draft, initiator: e.target.value as RelationshipInitiator })}
              className="rounded-md bg-[var(--background)] px-2 py-1 ring-1 ring-[var(--border)]"
            >
              {INITIATOR_OPTIONS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[10px] uppercase text-[var(--muted-foreground)]">Description</span>
          <textarea
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            rows={3}
            className="resize-none rounded-md bg-[var(--background)] p-2 text-xs ring-1 ring-[var(--border)]"
          />
        </label>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-[var(--destructive)]/10 p-2.5 text-xs text-[var(--destructive)]">
          <AlertCircle size="0.75rem" className="shrink-0" />
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">
        <button
          type="button"
          onClick={advanceOrClose}
          disabled={applying}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] disabled:opacity-50"
        >
          <X size="0.75rem" />
          Reject
        </button>
        <button
          type="button"
          onClick={handleApprove}
          disabled={applying || !draft.description.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-all hover:opacity-90 disabled:opacity-50"
        >
          {applying ? <Loader2 size="0.75rem" className="animate-spin" /> : <Check size="0.75rem" />}
          Approve
        </button>
      </div>
    </div>
  );
}
