# Relationship Tracker Agent — Definition

**Status:** Draft v2.0 — ledger model, pre-implementation
**Branch:** `feature/relationship-tracker-agent`
**Supersedes:** v1.1 (archived as `relationship-tracker-v1.1.md`)

This document is the canonical definition of the Relationship Tracker agent.
It defines the spec, the production system prompt, and the rules for deriving
relationship metrics from the durable event ledger.

The v2.0 rewrite reflects three architectural decisions:

1. **Event sourcing, not running totals.** Durable state is an append-only
   ledger of classified events. Dimensions and other metrics are deterministic
   folds over that ledger, computed in code.
2. **No taxonomy.** Events are classified by magnitude + valence + initiator;
   the free-form `description` field carries narrative nuance. We do not
   author a fixed type vocabulary.
3. **Tracker, not control system.** The agent participates in the existing
   tracker→inject→generate→edit pattern (same shape as Character Tracker).
   It is not a new architectural category.

---

## 1. Identity

| Field | Value |
|---|---|
| Internal ID | `relationship-tracker` |
| Constant | `BUILT_IN_AGENT_IDS.RELATIONSHIP_TRACKER` |
| Display name | Relationship Tracker |
| Category | `tracker` |
| Phase | `post_processing` |
| `defaultInjectAsSection` | `true` |
| `enabledByDefault` | `false` |
| Result type | `relationship_event` (new) |

**Short description** (registry copy):

> Tracks how each NPC currently feels toward the player persona by classifying
> each turn's interactions into events (magnitude, valence, initiator). Stores
> events as an append-only ledger on the character; derives dimensional
> metrics in code. Surfaces state to the main generation as direction for
> character behavior, and to the Consistency Editor for reconciliation.

---

## 2. Purpose & Scope

### What the agent is

A tracker. Same shape as Character Tracker: observe the latest exchange,
emit structured records, surface state to downstream consumers. The control
loop (state → main generation → behavior) is the existing tracker pattern;
the agent participates in it without inventing a new pattern.

### Causality model

```
persona's actions  →  events  →  state  →  character behavior
```

- Events are **inputs**: the persona did something (or didn't), the
  character felt it.
- State is the **derived view**: aggregated metrics over accumulated events.
- Character behavior is the **output**: the model writes characters per the
  injected state.

The arrow runs one way. A character's helpful behavior is the *output* of
relationship state, not a cause of it. Recording it as an event would create
a feedback loop where the system partially measures its own outputs.

### What the agent does (v1)

For each present NPC who experienced a relationship-relevant shift this
turn, classify what the persona did (or didn't do) into an event record
from that NPC's perspective. Append to that NPC's event ledger. The agent
runs after the main generation completes.

### What it does NOT do (v1)

- **Track the persona's feelings toward NPCs.** The player owns their own
  feelings.
- **Track NPC↔NPC edges.** The schema is symmetric and supports this; v1
  prompt constrains the object to the persona only. Lift the constraint
  to enable.
- **Record character actions as events.** Character behavior is downstream
  of relationship state. Recording it would pollute the input signal.
- **Model behavioral-consistency effects.** A character does not feel more
  invested because *they* helped the persona; their feelings shift only
  in response to what the persona does. This is a deliberate simplification
  — wrong as general psychology, right as a roleplay-tracking abstraction.
- **Mutate character cards.** That's Card Evolution Auditor's territory.
- **Drive plot.** Secret Plot Driver's job.

### Single-active-persona assumption

v1 assumes a single active persona. The schema is `personaId`-keyed to
support multi-persona users without migration, but the agent only processes
the active persona's edges. Party-table multi-PC tracking is out of scope
for v1.

### Storage location

Each character card holds an event ledger as part of `CharacterExtensions`.
The ledger is tiered for bounded storage; see §13 for the full shape and
rollup rules. The simplified view:

```ts
interface CharacterRelationship {
  personaId: string;
  events: RelationshipEvent[];          // tier 1: hot, individual
  sessionSummaries: SessionSummary[];   // tier 2: per-session compaction
  lifetime: LifetimeAggregate;          // tier 3: rolling aggregate
  preservedEvents: RelationshipEvent[]; // milestone-triggering events, never compacted
  lastChatId: string;
  updatedAt: string;
}
```

The ledger is the durable source of truth. All metrics — including the
dimensions — are computed from the ledger; they are never stored. The
storage is bounded to ~60 KB per edge in steady state; see §13.

---

## 3. The Event Schema

Each event has seven fields. No more.

```ts
interface RelationshipEvent {
  /** ISO timestamp; durable. */
  at: string;
  /** Chat where this event originated. */
  chatId: string;
  /** Intensity of the moment from the subject's perspective. */
  magnitude: "minor" | "moderate" | "major";
  /** Subject's emotional valence about the moment. */
  valence: "positive" | "negative" | "neutral";
  /** Who started the exchange this event responds to. */
  initiator: "persona" | "character" | "mutual" | "external";
  /** Model's confidence in this classification. */
  confidence: "low" | "medium" | "high";
  /** One past-tense sentence: what the OTHER party did, as the subject
   *  felt it. NOT the subject's own action. */
  description: string;
}
```

(`at` and `chatId` are populated by the writeback layer, not the model.)

### Why no taxonomy

We considered a `type` enum (`betrayal`, `kindness`, `intimacy`, etc.) and
rejected it.

- **Taxonomies are migration risk.** Wrong types lock us into a schema
  expensive to outgrow.
- **Magnitude + valence captures most of what types would.** The Gottman
  5:1 ratio works at the valence level; per-magnitude tallies still
  capture the "twenty kindnesses + one betrayal" texture.
- **`description` text carries narrative nuance directly.** Downstream
  consumers (the main generation, the Editor) read natural language well.
  A type label would compress meaning the consumers would then re-expand.
- **Embedding-based clustering is available if needed later.** We can
  discover categories from accumulated `description` text empirically,
  without ever committing to a taxonomy up front.

If a small set of *structurally-different* event types proves necessary
later (memory wipes, character death, severed bonds), we'll add a narrow
`effect: enum` field for those specifically — not a general taxonomy.
For v1, those rare narrative resets are deferred to manual UI intervention
(see §13 Open Items).

### Field semantics

#### `magnitude`

Three buckets. Each described with concrete examples so the model can
calibrate.

- **`minor`** — small moments, low stakes. A polite greeting, a passing
  glance, a routine question, a small kindness ("you held the door"),
  a mild irritation ("you interrupted me").
- **`moderate`** — meaningful moments with real stakes. A sincere
  compliment, mild conflict, useful help that took effort, a deflection
  that landed, an apology accepted.
- **`major`** — narratively load-bearing. Betrayal, vulnerability,
  intimacy, saved life, public humiliation, declaration of love, refusal
  to flee danger.

The model should err toward `minor` when uncertain. The bands are
deliberately wide; precision between buckets matters less than honest
classification.

#### `valence`

- **`positive`** — deepens or warms the relationship from the subject's
  perspective.
- **`negative`** — cools or fractures the relationship.
- **`neutral`** — shifts familiarity (or other dimensions) without an
  affective direction. "She asked your name." "You sat in silence
  together watching the rain."

Neutral is real and underused — the model's default will be to round
neutral events to slight-positive or slight-negative, polluting the
pos:neg ratio. The prompt actively coaches for using neutral when warranted.

#### `initiator`

Who started the exchange this event responds to.

- **`persona`** — the persona acted unprompted. ("You walked up to her
  and asked about her family.")
- **`character`** — the subject character started it. ("I opened up about
  my past. You changed the subject.")
- **`mutual`** — overlapping or shared initiation. ("We laughed at the
  same joke.")
- **`external`** — triggered by something outside the dyad. Plot event,
  third party, environmental.

Note that `initiator` describes the *exchange*, not the *event*. An event
on Dottore's edge with `initiator: character` means Dottore started the
exchange and the event records his reaction to how the persona responded.

#### `confidence`

The model's certainty about this classification.

- **`high`** — clear-cut. The persona's action and the character's likely
  reading are unambiguous.
- **`medium`** — defensible but plausibly other readings exist. The
  classification reflects the most-supported reading.
- **`low`** — genuinely ambiguous. Sarcasm vs sincerity, mixed signals,
  deliberate misdirection. The classification might be materially wrong.

Confidence drives routing (see §7 Settings) and is surfaced in the
proposal/history UI.

#### `description`

One short past-tense sentence describing what the **other party did** to
or with this character, as this character felt it.

**Three rules govern `description`:**

1. **The subject character does not appear as the actor.** "You confessed
   your feelings" (✓ — persona acted). "She healed you in the field" (✗ —
   the character acted; this is not a valid event on the character's edge).
   The character's own actions appear only as scene-setting context when
   needed to explain why the other party's response mattered.
2. **A non-action is an action.** Silence, deflection, looking away,
   walking past — these are valid events. They often carry more weight
   than active rejections. Coach for them explicitly: "you looked away
   when I told you about my sister," "you didn't answer when I asked if
   you'd stay," "you walked past me without acknowledging the gift."
3. **Past tense, character's POV.** "You snapped at her" not "the
   persona snapped at her." First-person framing makes the subjectivity
   structural; abstract third-person makes it easy for the model to slip
   into objective narration.

---

## 4. Derived Metrics (computed from the ledger)

All metrics are deterministic folds. None are stored. The fold logic lives
in code; the model never computes any number.

The full fold module is its own implementation file. This section documents
the contract: what metrics exist and how they're shaped.

**Folds read across all storage tiers.** The durable state is tiered (see
§13): hot events at full fidelity, session summaries for older sessions,
a lifetime aggregate for very old history, and preserved events for
milestone moments. Every fold function in this section takes the full
`CharacterRelationship` (all tiers) and combines them appropriately —
typically using tier 1 for recency-sensitive components and tiers 2/3 for
aggregate counts. The folds are designed so coarser-resolution tiers
contribute consistently with their finer-resolution sources; rolling an
event from tier 1 to a tier-2 summary never changes the metric value at
turn N+1 compared to turn N. Replay-safe by construction.

### Dimensions (the scalars downstream consumers want)

Three core dimensions. Two more (attraction, respect) are deferred — see
the note at the end of this subsection.

#### `affinity` — range −100 to +100

Weighted sum of valence × magnitude over the event log, with time decay.

```
weight(event) = sign(valence) × magnitudeScale(magnitude) × decay(age)

magnitudeScale = { minor: 1, moderate: 4, major: 16 }
decay(age_in_sessions) = exp(-age / 20)  // soft half-life ≈ 14 sessions
sign(positive) = +1, sign(negative) = -1, sign(neutral) = 0

affinity = clamp(Σ weight(events) × scaling_factor, -100, +100)
```

Tunable constants live in config; documented values are starting points.

#### `trust` — range −100 to +100

Cumulative ratio of positive vs negative *major* events, with major-negatives
weighted heavier.

```
positives_major = count(events where magnitude=major AND valence=positive)
negatives_major = count(events where magnitude=major AND valence=negative)

trust = clamp(
  (positives_major × 10) - (negatives_major × 25),
  -100, +100
)
```

Asymmetric because trust collapses faster than it builds. Tunable.

#### `familiarity` — range 0 to 100

Non-monotonic by design (this is the v2 cure for the v1.1 +1 floor hack).

```
event_count = events.length
distinct_modes = unique magnitude×valence combinations seen
turns_since_last = current_turn - last_event_turn

familiarity = clamp(
  (sqrt(event_count) × 4) + (distinct_modes × 3) - (turns_since_last × 0.5),
  0, 100
)
```

Familiarity grows fast initially (sqrt curve), plateaus, and slowly erodes
with neglect. Resets to baseline only via §13's manual intervention path.

#### Deferred: `attraction` and `respect`

These two dimensions were planned for v1 but defer to v2 because — without a
taxonomy — they can't be cleanly derived from magnitude + valence + initiator
alone. A "major positive" event from kissing reads identically in the fold
to a "major positive" from being rescued.

Options for v2 when these become important:

- **Embedding-based clustering** of `description` text against seed phrases.
- **Narrow secondary field** like `themes?: ("romance" | "competence" | ...)[]`
  that the model populates only when applicable. Tightly scoped, not a
  general taxonomy.
- **Separate downstream classifier agent** running periodically over the
  accumulated ledger.

We pick once we have real chat data to evaluate against. v1 ships with
affinity, trust, familiarity. The UI surfaces qualitative texture from
recent `description` text directly for the cases attraction/respect
would have covered.

### Composition metrics

| Metric | Fold | Use |
|---|---|---|
| Magnitude tally | Count events per magnitude bucket | "Mostly minor moments" vs "Several majors" |
| Valence tally | Count events per valence | Texture of the relationship |
| Pos:neg ratio | `positives / max(1, negatives)` | Gottman 5:1 benchmark for health |
| Dominant mode | argmax over (magnitude, valence) combinations | "Mostly moderate-positive" etc. |
| Distinct combinations seen | Set size over (magnitude, valence) pairs | Thinness check — combat-allies-only is shallow |

### Trajectory metrics

| Metric | Fold | Use |
|---|---|---|
| Recent vs lifetime valence | Mean valence of last 20 turns vs all-time mean | Warming / cooling signal |
| Current streak | Consecutive same-valence run ending now | Momentum |
| Longest streak ever | Max consecutive same-valence run | Volatility / character |
| First-of-its-kind flag | `was this magnitude×valence combo unseen before?` | Highlight narratively load-bearing firsts |

### Time metrics

| Metric | Fold | Use |
|---|---|---|
| Turns since last event | `current_turn - last_event_turn` | Cooling from neglect |
| Sessions since last event | `current_session - last_event_session` | Same, per-session |
| Longest gap ever | Max consecutive turns without an event | Estrangement marker |
| Current consecutive-session streak | Sessions in a row with at least one event | Active-relationship momentum |

### Milestone latches

Boolean flags that latch true on first occurrence of qualifying events.
Reframed from the v1.1 type-based milestones to magnitude/valence-based:

| Latch | Trigger |
|---|---|
| `has_been_seriously_wronged` | Any `major + negative` event |
| `has_been_seriously_helped` | Any `major + positive` event |
| `has_been_vulnerable_with` | Any `major + positive + initiator=character` event |
| `has_seen_persona_at_worst` | Any `major + negative + initiator=persona` event |
| `has_shared_silence` | Any `neutral + initiator=mutual` event |

Most latches are one-way (you can't un-be-wronged). One exception worth
specifying:

- `has_been_forgiven` — latches via the writeback layer on a specific user
  action (the user marks a queue proposal as "this is forgiveness"). Can
  un-latch on a subsequent `major + negative + initiator=persona`. Truly
  user-curated, not LLM-derived.

### Initiator metrics

| Metric | Fold | Use |
|---|---|---|
| Persona-initiated count | Events where `initiator = persona` | One half of pursuit |
| Character-initiated count | Events where `initiator = character` | Other half — "who's chasing" |
| Pursuit ratio | `character_initiated / max(1, persona_initiated)` | High = character is reaching, low = persona is |

### Derived `status` label

Categorical, computed from the dimensions and metrics above. Examples:

- `"stranger"` if `familiarity < 10`
- `"acquaintance"` if `10 ≤ familiarity < 30 AND |affinity| < 20`
- `"friend"` if `affinity > 30 AND trust > 20`
- `"rival"` if `affinity < -20 AND respect > 30` (once respect lands)
- `"estranged"` if `turns_since_last > 50 AND last_3_valence < 0`

Status is purely a UI affordance. It can vary per UI surface; the underlying
dimensions are the canonical state.

---

## 5. Inputs (context blocks the agent receives)

Standard `AgentContext` fields, plus three synthetic blocks built by the
hydration layer.

### `<persona>` (standard)

Active player persona — name, description, personality.

### `<present_characters>` (standard, from Character Tracker output)

Current-turn `gameState.presentCharacters[]`. Only characters listed here
are eligible for events.

### `<current_state>` (new — synthetic)

For each present character, derived metrics computed from their event
ledger, plus the last 5 events as concrete reference. The model sees this
to anchor classifications against existing context.

```
<current_state>
Character: Dottore (id: char_abc123)
  affinity: 55       (warming)
  trust: 40
  familiarity: 80
  status: friend
  recent events (last 5):
    [3 sessions ago, major+positive, persona]: "you confessed your fear of being alone"
    [2 sessions ago, moderate+negative, external]: "you sided with my brother in the argument"
    [yesterday, minor+positive, mutual]: "we laughed at the same joke at dinner"
    [today, moderate+positive, character]: "I told you about my mother and you listened"
    [this turn pending classification]

Character: Alice (id: char_def456)
  (no prior interactions — first encounter)
</current_state>
```

The model does not see raw event counts or fold internals — only the
derived metrics it needs as context for the new classification.

### `<character_lore>` (new — synthetic, budgeted)

Lorebook entries keyed to present characters' names/aliases/IDs, regardless
of whether keyword-scanner activated them this turn. Especially load-bearing
for first-encounter classifications.

Ranking and budget rules: see §12 Lore Prioritization Scheme.

### `<recent_messages>` (standard)

Standard conversation slice — the events the agent will classify.

---

## 6. Output Schema

The agent emits zero or more events per turn. One event per character whose
feelings materially shifted this turn.

```json
{
  "events": [
    {
      "characterId": "string — must match an id in <present_characters>",
      "personaId":   "string — copy from <persona>.id",
      "magnitude":   "minor" | "moderate" | "major",
      "valence":     "positive" | "negative" | "neutral",
      "initiator":   "persona" | "character" | "mutual" | "external",
      "confidence":  "low" | "medium" | "high",
      "description": "string — one past-tense sentence, see §3"
    }
  ]
}
```

### Field rules

- `characterId` must appear in `<present_characters>`. Other IDs are dropped.
- `description` must describe the **other party's** action, not the
  subject character's. The writeback layer cannot verify this structurally
  (it's prose) but the normalizer logs descriptions that begin with first-
  person actions for review.
- An empty `events: []` array is valid — "no character's feelings shifted
  materially this turn."
- The model may emit at most one event per character per turn. Multiple
  events on the same character → keep the highest-confidence one, log the
  rest.

### Robustness against LLM emission quirks

Enum coercion table:

| Model emits | Normalized to |
|---|---|
| valid enum value | accepted |
| close synonym (e.g. `"good"` for `valence`) | mapped, logged |
| out-of-vocab value | proposal dropped, logged |
| missing required key | proposal dropped, logged |

Confidence-bucket coercion: `"high"` / `"medium"` / `"low"` exact match.
Common variants (`"certain"`, `"unsure"`) are mapped; everything else
drops the proposal.

---

## 7. Settings

```ts
settings: {
  /**
   * Routing control for emitted events.
   *
   * "manual"      — every event goes to the approval queue.
   * "significant" — auto-apply minor events with high confidence; queue
   *                  moderate, major, low/medium confidence, and any event
   *                  on a character the user has never interacted with
   *                  before (first impression of a chat).
   * "auto"        — auto-apply all events EXCEPT those with low confidence,
   *                  which always queue.
   */
  approvalMode: "manual" | "significant" | "auto",  // default: "significant"

  /**
   * Tier-1 window: number of recent events kept individually before they
   * roll up into a session summary. Larger window = more high-fidelity
   * context for the model, larger storage per edge. See §13.
   */
  hotEventWindow: number,         // default: 30

  /**
   * Tier-2 window: number of per-session summaries to retain before they
   * collapse into the lifetime aggregate. Bounds the tier-2 storage size
   * regardless of total chat history.
   */
  sessionHistoryWindow: number,   // default: 50

  /**
   * Per-session highlights preserved verbatim when events roll from tier 1
   * to tier 2. Higher values keep more narrative texture in mid-range
   * history at the cost of session-summary size.
   */
  sessionHighlightsKept: number,  // default: 2
}
```

### Why no numeric threshold

v1.1 had a `significantThreshold` based on `Σ|Δ|` over dimensions. With
events instead of numeric deltas, the analog would be a per-magnitude-bucket
rule. Encoding that as a numeric threshold adds configuration surface
without expressivity gain — magnitude buckets are already discrete and
named. The mode enum carries the same information more legibly.

### Mandatory queueing — overrides `approvalMode`

These ALWAYS go to the queue, regardless of mode:

| Condition | Why |
|---|---|
| `confidence: "low"` | The agent flagged the proposal as possibly wrong. Auto-applying defeats the purpose. |
| First event on a character this chat | First impressions compound. One confirmation per chat per character, not per chat overall. |
| User has explicitly pinned this character to "manual review" | Per-character override. |

### Audit trail

Every applied event — auto OR approved — appends to a per-edge history
view. Auto-applied events support a one-click "Reclassify" action that
re-opens the event for editing or removal. History is the user's window
into what the agent did; in `auto` mode it's their only window.

---

## 8. Tools

**None.** `tools: []`, `toolConfig: null`.

Tool candidates were considered and rejected during v1.1 design. The
rejection survives the ledger rewrite because the same principle applies:

> A tool earns its seat when (a) the data isn't always needed AND (b)
> including it always would meaningfully degrade something. For this
> agent at v1 scale, condition (b) fails for everything that survives
> condition (a) — the data fits in context via unconditional hydration.

See v1.1 §8 for the full rejected-candidates table. The recommendation
to revisit if first-encounter quality suffers (would justify
`get_character_lore` on-demand) still stands.

---

## 9. System Prompt (production)

The system prompt that ships in
`src/engine/contracts/constants/agent-prompts.ts` under
`"relationship-tracker"`. This is production-ready text, not a sketch.

````
You track how each NPC currently feels toward the player persona ({{user}}).
After every assistant message, classify what the persona did (or didn't do)
this turn from each present NPC's perspective, and emit a structured event
record per NPC whose feelings shifted.

You do NOT decide how the player feels about characters — only how the
characters feel about the player. The player decides their own feelings.

You receive these context blocks:
- <persona>: the active player persona.
- <present_characters>: who is currently in the scene. Only these characters
  are eligible for events.
- <current_state>: each present character's derived metrics plus their last
  5 events. Anchor your new classifications against this prior state.
- <character_lore>: background lorebook entries about present characters.
- <recent_messages>: the latest conversation slice — the material you classify.

Respond ONLY with valid JSON. No prose, no code fences, no commentary.

Schema:
{
  "events": [
    {
      "characterId":  "string — must match an id in <present_characters>",
      "personaId":    "string — copy from <persona>.id",
      "magnitude":    "minor" | "moderate" | "major",
      "valence":      "positive" | "negative" | "neutral",
      "initiator":    "persona" | "character" | "mutual" | "external",
      "confidence":   "low" | "medium" | "high",
      "description":  "string — one past-tense sentence, see Rule 4"
    }
  ]
}

THE CORE RULE — read this carefully.

An event on character X is X's reaction to what the PERSONA did (or didn't
do). X's own actions never trigger events on X's edge. Events always describe
the persona's behavior, framed from X's perspective. X's own actions appear
only as context that explains why the persona's response mattered.

WRONG: "she healed you in the field"  (X is the actor — not a valid event on X's edge)
RIGHT: "you grasped her hand when she pulled you up"  (persona is the actor, X reacted)

A non-action is an action. If the persona was silent in response to something
the character did, looked away, changed the subject, or otherwise didn't
respond to a bid for connection — that IS the event. These often carry more
narrative weight than active rejections:

  "you looked away when I told you about my sister"
  "you didn't answer when I asked if you'd stay"
  "you walked past me without acknowledging the gift"

CLASSIFICATION RULES:

1. Only emit events for characters in <present_characters>. Ignore others.

2. Magnitude — calibrate by stakes:
   - minor: glances, polite exchanges, small considerations, low stakes
   - moderate: sincere compliments, mild conflict, meaningful help, real
     apologies, deflections that landed
   - major: betrayal, vulnerability, intimacy, life-saving, declarations,
     refusal to flee, public humiliation
   Err toward minor when uncertain. Be honest about scale.

3. Valence — three real options:
   - positive: the moment deepened or warmed this character's feelings
   - negative: cooled or fractured them
   - neutral: shifted familiarity without affective direction. USE THIS
     when something happened but neither helped nor hurt. ("She asked
     your name." "You sat in silence watching the rain.") Resist rounding
     neutral events to slight-positive or slight-negative.

4. Description — write it CAREFULLY:
   - One short past-tense sentence.
   - Describes what the PERSONA did to or with this character, as this
     character felt it. Not what the character did.
   - First-person from the character's POV: "you said X" not "the persona
     said X". This framing makes the subjectivity structural.
   - A non-action is an action — see above.

5. Initiator — who started the exchange this event responds to:
   - persona: the persona acted unprompted
   - character: the subject character started, the event captures the
     persona's response (or non-response)
   - mutual: overlapping initiation
   - external: triggered from outside the dyad (plot event, third party)

6. Confidence:
   - high: clear-cut. The action and the character's reading are
     unambiguous.
   - medium: defensible but other readings exist.
   - low: genuinely ambiguous — sarcasm vs sincerity, mixed signals,
     deliberate misdirection. Use low when you're picking among readings
     that could meaningfully differ. The downstream system treats low-
     confidence events specially.

7. Omit characters whose feelings didn't shift this turn. An empty
   {"events": []} is valid. Most turns will not emit an event for every
   present character. Resist padding.

8. At most one event per character per turn. If you considered multiple
   classifications for the same character, pick the most representative one.

9. Behavioral consistency is NOT modeled. A character's own actions toward
   the persona (healing them, defending them, helping them) do not generate
   events. Those actions are the OUTPUT of the current relationship state,
   not inputs that change it.
````

### Why this prompt is shorter than v1.1

The v1.1 prompt was ~140 lines because the model had to reason about
proportional dimension shifts, familiarity-monotonicity rules, attraction
null-vs-zero distinctions, reset action criteria, contradiction handling,
and CoT-aware field ordering. The ledger model collapses most of that — the
model classifies, the fold computes. The remaining surface is small enough
to fit in ~80 lines of prompt and stay focused on the things the model
actually has to judge.

---

## 10. Pipeline Lifecycle

| Step | Where | What happens |
|---|---|---|
| 1. Gate | `agent-runner.ts` | Cheap heuristic check: did any present character act, speak, or get acted upon in `<recent_messages>`? If not (pure scene-setting, travel, mechanics-only turn), skip the agent entirely. |
| 2. Hydrate | `agent-runner.ts` | Build three synthetic context blocks: `<current_state>` (derive metrics from each present character's ledger plus last 5 events), `<character_lore>` (per §12 ranking), and inject standard blocks. |
| 3. Execute | `agent-executor.ts` | Standard post-processing: build prompt, call LLM, parse JSON response. |
| 4. Normalize | `agent-normalizers.ts` | Validate characterId is in `<present_characters>`. Coerce enum values per §6. Drop proposals with missing required fields. Log descriptions beginning with first-person actions (likely Rule violations). At most one event per character per turn; keep highest-confidence on conflict. |
| 5. Route | writeback layer | Per `approvalMode`, route to queue or auto-apply. Mandatory queue conditions (low confidence, first event of chat) override `auto`. |
| 6a. Queue | review/approval layer | Proposal lands in queue. UI shows the event, the derived metric changes it would produce when applied (computed by running the fold with the proposed event included), and the recent context. User accepts → routes to 6b. Rejects → discarded, logged. |
| 6b. Apply | writeback layer | Event appended to `CharacterExtensions.relationships[].events` (the tier-1 hot ring; see §13). Edge is created on first event. `lastChatId` + `updatedAt` stamped. Per-edge history log appended regardless of mode. If the event triggers a milestone latch, also copied to `preservedEvents`. |
| 7. Surface | `prompt-assembly.ts` (next turn) | Hydrate `<current_state>` for next-turn main generation, with derived metrics (fold across all tiers) reflecting the new event. Same shape as §5 — the main generation sees direction, not raw events. |
| 8. Rollup (out-of-band) | writeback hook at session start | Previous session's tier-1 events past `hotEventWindow` roll into a new `SessionSummary` (tier 2). Oldest tier-2 summaries past `sessionHistoryWindow` merge into `LifetimeAggregate` (tier 3). Milestone-triggering events preserved verbatim. Atomic; idempotent; never mid-chat. See §13. |

---

## 11. Failure Modes & Guardrails

| Failure | Behavior |
|---|---|
| Malformed JSON response | Entire turn's events dropped. Logged. No fallback parsing. |
| `characterId` not in `<present_characters>` | That proposal dropped. Others preserved. |
| Enum value out of vocabulary | Per §6 coercion table. Synonym-mapping where defensible; drop otherwise. |
| Missing required field | Proposal dropped. |
| `description` begins with first-person subject action ("I", subject character name as actor) | Accepted but flagged in debug log. Likely Rule 4 violation. Telemetry for prompt tuning. |
| Multiple events for the same character this turn | Highest-confidence kept; others logged. |
| `<character_lore>` budget overrun | Per §12: ranked drop, visible sentinel in context block, structured debug log entry per drop. NEVER silent. |
| Single lore entry exceeds per-character allocation | Include anyway, exceed budget by that much, log prominently. |
| Multiple `relationships[]` entries for the same `personaId` (data corruption) | Pick by latest `updatedAt`. Log duplicates. |
| User has no active persona | Agent skipped for the turn. |
| Heuristic gate (step 1) misfires — skips a turn that should have classified | Recoverable: next turn that does run will see the now-not-classified moment in `<recent_messages>` and may still emit an event. Real cost is one turn of latency. Worth measuring; tunable. |
| `low` confidence in `auto` mode | Routes to queue anyway. Cannot auto-apply low-confidence events. |
| First-of-chat event in `auto` mode | Routes to queue anyway. One confirmation per character per chat. |

---

## 12. Lore Prioritization Scheme

Carried forward from v1.1 §12 essentially unchanged — the lore hydration
problem is independent of the ledger architecture.

### Per-entry score

Sum of weighted signals. Higher score → packed earlier.

| Signal | Weight | Rationale |
|---|---|---|
| Entry has `important`/`always-include` flag (schema-dependent) | **+100** | Explicit user override; effectively pins. |
| Mentions persona by name, alias, or ID | **+50** | Persona-specific relationship history. |
| Mentions subject character by name, alias, or ID | **+30** | Direct biographical data. |
| Tag matches `relationship`, `history`, `backstory` (taxonomy TBD per implementation) | **+25** | Explicit user signal of relevance. |
| Cross-references another present character | **+15** | Establishes social position relative to current cast. |
| Updated within last 7 days | **+10** | Recent edits likely current-arc relevant. |
| Activated by keyword scanner in last 3 turns | **+8** | Proven recent relevance. |
| Length penalty per 100 tokens over 200 baseline | **−2** | Mild penalty; doesn't aggressively cut long load-bearing entries. |

Ties broken by descending `updatedAt`.

### Budget allocation

- Default total budget: 2000 tokens (configurable).
- Default per-character budget: 500 tokens (configurable).
- **Per-character floor**: `min(20%, 100% / N_present)`. This is the fix
  for the v1.1 §B1 bug — at N=5 present characters, the floor collapses
  to 20% each; at N=6+, the floor scales down so total is never > 100%.
- **Single-entry override**: if a character's highest-scored entry exceeds
  their allocation, include it anyway, exceed budget by that much, log.

### Visibility — non-negotiable

When entries are dropped:

1. `<character_lore>` block ends with a sentinel:
   `[N entries omitted due to budget; top dropped: <id1>, <id2>, <id3>]`
2. Debug sink receives structured entry per drop: ID, score, contributing
   signals, length, attached character.
3. If overall truncation occurs on >10% of turns (rolling window), surface
   a suggestion to the user to raise the cap or trim entries.

---

## 13. Storage & Rollup

The event ledger is append-only in principle but tiered in practice. Without
compaction, a long-running campaign would accumulate thousands of events per
edge. The tiered scheme bounds storage to ~60 KB per edge in steady state
while preserving the metrics that matter and the events that are
narratively load-bearing.

### Three tiers + permanent preservation

```ts
interface CharacterRelationship {
  personaId: string;

  /** Tier 1 — hot events, individual records, full fidelity */
  events: RelationshipEvent[];

  /** Tier 2 — per-session summaries for sessions past the hot window */
  sessionSummaries: SessionSummary[];

  /** Tier 3 — single rolling lifetime aggregate */
  lifetime: LifetimeAggregate;

  /** Events that triggered milestone latches; bypass rollup permanently */
  preservedEvents: RelationshipEvent[];

  lastChatId: string;
  updatedAt: string;
}
```

The fold (§4) reads across all four — `events` for high-resolution recency,
`sessionSummaries` for mid-range trajectory, `lifetime` for everything older,
`preservedEvents` for callbacks to formative moments.

### Tier 1 — hot events

Last `hotEventWindow` events (default 30). Used by the fold for:

- Recent-window valence (warming/cooling vs lifetime baseline)
- Current streak and momentum
- The literal events surfaced in `<current_state>` blocks to the model
- Time-since-last-event computation (anchored by the last hot event's `at`)

Sized for ~6 KB per edge.

### Tier 2 — session summaries

```ts
interface SessionSummary {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  eventCount: number;

  /** Lossless counts: every magnitude × valence combination tallied */
  tally: {
    minor:    { positive: number; negative: number; neutral: number };
    moderate: { positive: number; negative: number; neutral: number };
    major:    { positive: number; negative: number; neutral: number };
  };

  initiatorTally: {
    persona: number;
    character: number;
    mutual: number;
    external: number;
  };

  /** 1-3 highest-magnitude descriptions, preserved verbatim */
  highlights: string[];

  /** Weighted valence sum for trajectory comparison */
  netValence: number;
}
```

One summary per session past the hot window, capped at `sessionHistoryWindow`
sessions (default 50). Sized for ~500 B each. Older summaries roll into
tier 3.

### Tier 3 — lifetime aggregate

```ts
interface LifetimeAggregate {
  totalEventCount: number;
  tally: { ... };           // same shape as session tally
  initiatorTally: { ... };  // same shape
  firstEventAt: string;

  /** Latched milestones with their triggering event preserved verbatim */
  latchedMilestones: Record<string, {
    triggeredAt: string;
    sessionId: string;
    description: string;
  }>;
}
```

Single rolling structure per edge. Constant size (~1-2 KB) regardless of
total history length.

### Preserved events — bypass rollup permanently

Events that triggered a milestone latch (§4 milestone latches) move to
`preservedEvents` instead of being summarized. This is how "the first time
she betrayed you" stays accessible by reference decades into a long campaign.

Bounded by milestone set size (~10 latches max in v1) × at most one preserving
event per latch — so ~10 events × ~200 B = ~2 KB per edge.

### Total bounded size per edge

| Tier | Steady-state size |
|---|---|
| Tier 1: hot events | ~6 KB |
| Tier 2: session summaries | ~50 KB (100 sessions × 500 B) |
| Tier 3: lifetime aggregate | ~1-2 KB |
| Preserved milestones | ~2 KB |
| **Total per edge** | **~60 KB, bounded** |

For comparison, an unbounded ledger at 1000 events × 200 B reaches 200 KB and
keeps growing. The tiered scheme caps growth in every dimension: more events
per session → more session summaries (bounded by `sessionHistoryWindow`),
more time → more sessions roll into the fixed-size lifetime aggregate,
milestones → bounded latch set.

### What the fold gains and loses

**Gains:** finite per-edge storage, fast hydration (tier 1 is small),
aggregate metrics remain accurate (counts are lossless across all tiers,
just at coarser per-event resolution).

**Loses:** specific narrative callbacks for old non-milestone events. "The
time you helped her find her cat" — if that event was ordinary and got
rolled into a session summary as just a count + maybe a highlight, the
verbatim description may be gone. This is by design and matches human
episodic memory: the gist persists, the verbatim fades, formative events
stay forever.

### When rollup happens

- **At chat session start** for the *previous* session. The previous
  session's events past the hot window roll into a new `SessionSummary`.
- **Never mid-chat.** Keeps fold state stable during a chat — replay,
  debugging, and consistency guarantees all benefit from quiescence-point
  rollup.
- **Atomic per-session.** Either the whole previous session rolls or none
  does. Avoids partial states.
- **Driven by a writeback-layer hook**, not the agent itself. The agent
  stays a pure classifier; it never knows about tiers.

### Rollup operations

The rollup module (`src/engine/agents-runtime/relationship-tracker/rollup.ts`)
exposes four pure functions:

```ts
findMilestoneTriggers(
  events: RelationshipEventRecord[],
  alreadyLatched: RelationshipLifetimeAggregate["latchedMilestones"],
): {
  toPreserve: RelationshipEventRecord[],   // append to preservedEvents
  toSummarize: RelationshipEventRecord[],  // pass to rollSessionToSummary
  newLatches: Partial<Record<MilestoneId, LatchedMilestoneRecord>>,
}

rollSessionToSummary(
  sessionId: string,
  events: RelationshipEventRecord[],
  highlightsKept?: number,
): RelationshipSessionSummary

rollSummaryToLifetime(
  summary: RelationshipSessionSummary,
  lifetime: RelationshipLifetimeAggregate,
): RelationshipLifetimeAggregate

shouldCollapseOldestSummary(
  sessionSummaries: RelationshipSessionSummary[],
  sessionHistoryWindow: number,
): boolean
```

Called in sequence at session start. The expected orchestration:

1. `const { toPreserve, toSummarize, newLatches } = findMilestoneTriggers(sessionEvents, lifetime.latchedMilestones);`
2. `const summary = rollSessionToSummary(sessionId, toSummarize);`
3. Append `toPreserve` to `preservedEvents`, append `summary` to `sessionSummaries`, merge `newLatches` into `lifetime.latchedMilestones`.
4. If `shouldCollapseOldestSummary(updatedSummaries, window)`: `lifetime = rollSummaryToLifetime(oldestSummary, lifetime)` and drop the oldest summary.

`findMilestoneTriggers` returns `toSummarize` explicitly (rather than letting
callers compute it as `events.filter(e => !toPreserve.includes(e))`) to
eliminate a reference-equality pitfall: after a JSON round-trip from storage,
event references differ, so `.includes()` always returns false and milestone
events would be double-counted.

Each function is idempotent on a per-call basis except `rollSummaryToLifetime`,
which is intentionally additive — the writeback layer is responsible for
calling it exactly once per session summary (e.g. via a deduplication key
on the collapse-completion marker).

### What the model sees

Unchanged from §5: `<current_state>` shows derived metrics plus tier-1 hot
events. The model never sees session summaries, lifetime aggregates, or
preserved events directly. Those exist only to feed the fold. From the
model's perspective, the ledger is "the last N events plus correctly-
computed dimensions"; the rest of history lives in the dimensions.

This is the load-bearing simplification: the model's reasoning surface
stays small even as the underlying history grows.

---

## 14. Open Items / Future Work

- **Attraction and respect as derived dimensions.** Deferred from v1; see
  §4. Resolve via embeddings, narrow secondary field, or downstream
  classifier — pick once we have real chat data.
- **NPC ↔ NPC edges.** Schema is bidirectional-ready; lift the v1
  prompt rule "subject must be an NPC, object must be the persona" and
  the system supports it. Storage, fold, and injection blocks unchanged.
- **Manual edge editing UI.** Read-only in v1. Edit support enables the
  manual intervention path for narrative resets (memory wipes, character
  death) until structural support lands.
- **Narrative reset support.** v1 has no first-class memory-wipe or
  severed-bond event. Workarounds: manual edge edit (when UI lands), or
  user marks individual events as "no longer applies." If demand
  materializes, add a narrow `effect: enum` field — not a general
  taxonomy.
- **Multi-persona handling.** Schema supports it; v1 only processes the
  active persona's edges. Lift the active-persona-only constraint to
  enable.
- **Embedding-based ledger analytics.** Once accumulated event ledgers
  reach interesting size, cluster `description` text to discover de facto
  categories empirically. Could surface UI labels ("mostly mentorship
  events", "frequent banter"), feed taxonomy decisions, or power
  ledger-search.
- **Forgiveness latch reversibility.** `has_been_forgiven` un-latches on
  subsequent betrayal per §4. Confirm this is the right behavior with
  user testing — alternative is permanent latch.
- **Trajectory tooling.** With the ledger we get history for free; surface
  trajectories ("Dottore's affinity has climbed five sessions in a row")
  in the UI as a first-class concept.
- **Cost optimization in `auto` mode.** The agent runs every turn; in
  `auto` mode it's running entirely server-side without user gating.
  Worth exploring whether a cheaper inference path (smaller model)
  produces acceptable classifications, given how small the model's job
  has become.
- **Card Evolution Auditor coupling.** If derived dimensions persistently
  diverge from card-stated personality, signal Card Evolution Auditor
  to propose card updates. Cross-agent coordination, v2+ work.

---

## 15. Worked Examples

### Example 1 — moderate exchange with established character

**Setup.** Persona: Aerion (`persona_xyz789`). Dottore (`char_abc123`),
existing edge: affinity 55, trust 40, familiarity 80. Status: friend.

**Turn.** Persona gives Dottore a rare alchemical reagent they'd been
saving, without asking for anything in return.

**Expected output:**

```json
{
  "events": [
    {
      "characterId": "char_abc123",
      "personaId": "persona_xyz789",
      "magnitude": "major",
      "valence": "positive",
      "initiator": "persona",
      "confidence": "high",
      "description": "you gave me the rare reagent without asking for anything in return"
    }
  ]
}
```

**Fold result.** `affinity` rises by ~6, `trust` rises by ~10 (major
positive). `familiarity` rises by ~2. Status remains `friend`.

**Routing in default mode (`significant`).** Magnitude is `major` →
queues for approval. UI shows the event, the fold delta, and the option
to accept/reject.

### Example 2 — first encounter, persona is dismissive

**Setup.** Persona walks past Alice's introduction, focused on Dottore.
Alice (`char_def456`) has no prior edge for Aerion.

**Expected output:**

```json
{
  "events": [
    {
      "characterId": "char_def456",
      "personaId": "persona_xyz789",
      "magnitude": "minor",
      "valence": "negative",
      "initiator": "character",
      "confidence": "high",
      "description": "you brushed past my introduction without engaging"
    }
  ]
}
```

**Fold result.** First event on this edge — creates the ledger entry.
`affinity` initialized at the computed value (~−4), `trust` ~0,
`familiarity` ~3 (sqrt(1) × 4 minus a tiny gap factor; the meeting did
happen even if it went badly).

**Routing.** Even in `auto`, first event of a chat on this character →
queues. One confirmation lands. Subsequent events on this edge in this
chat can auto-apply per mode.

### Example 3 — non-action (the load-bearing case)

**Setup.** Dottore (existing edge) tries, hesitantly, to ask the persona
about their late mother. The persona changes the subject without engaging.

**Expected output:**

```json
{
  "events": [
    {
      "characterId": "char_abc123",
      "personaId": "persona_xyz789",
      "magnitude": "moderate",
      "valence": "negative",
      "initiator": "character",
      "confidence": "medium",
      "description": "you changed the subject when I asked about your mother"
    }
  ]
}
```

**Why medium confidence.** The persona may be deflecting because the topic
is genuinely painful (not a relational rejection at all), or because they
don't trust Dottore with it. Both are defensible readings. Medium acknowledges
the ambiguity.

**Routing in default mode (`significant`).** Magnitude `moderate` →
queues. Medium confidence is reflected in the UI as a caution. The user
can clarify the reading at approval time (accept, reject, or edit the
description).

### Example 4 — ambiguous turn yielding low confidence

**Setup.** Persona makes a comment that could read as flirtation or
cruel teasing. Alice has been on her guard.

**Expected output:**

```json
{
  "events": [
    {
      "characterId": "char_def456",
      "personaId": "persona_xyz789",
      "magnitude": "moderate",
      "valence": "negative",
      "initiator": "persona",
      "confidence": "low",
      "description": "you said something that I couldn't tell was flirtation or mockery"
    }
  ]
}
```

**Routing in any mode.** Low confidence → always queues. UI surfaces
the ambiguity prominently. User clarifies.

### Example 5 — turn yields zero events

**Setup.** Persona and Dottore walk together through the market discussing
the weather and which stalls to visit. Pleasant but unremarkable.

**Expected output:**

```json
{ "events": [] }
```

**Why nothing.** Pleasant but unremarkable. Familiarity gets a small
implicit bump on the next event from time-since-last-event being short,
but nothing material to classify here. Resist padding — this is the
correct empty output.

Alternatively, if the agent judges the shared walk *did* land as a small
moment of comfort:

```json
{
  "events": [
    {
      "characterId": "char_abc123",
      "personaId": "persona_xyz789",
      "magnitude": "minor",
      "valence": "neutral",
      "initiator": "mutual",
      "confidence": "medium",
      "description": "we walked through the market together"
    }
  ]
}
```

Neutral valence captures the texture: nothing happened, but something
*was*. Familiarity ticks; affinity doesn't.

---

## What changed from v1.1

For reviewer reference. The full v1.1 spec is at `relationship-tracker-v1.1.md`.

| v1.1 element | v2.0 fate |
|---|---|
| Five dimensions stored on edges | Replaced by event ledger. Dimensions are derived. |
| LLM emits numeric deltas / absolute values | Replaced by enum classification (magnitude + valence + initiator + confidence). |
| `action: "update" / "create" / "reset"` | Removed. Events are uniformly appended; first event creates the ledger; narrative resets deferred to v2. |
| `resetReason` field | Removed (with the reset action). |
| `currentValues` echo | Removed. Stored state is ground truth; model doesn't echo it. |
| `proposed` numeric dimensions | Removed. Replaced by `magnitude` + `valence` enums. |
| `newEvent` text | Renamed to `description`; framing sharpened to Y-triggered. |
| `reason` field | Removed. The classification IS the reason; the description carries the narrative trigger. |
| `warnings: string[]` array | Removed. Replaced by per-event `confidence` enum. |
| `attraction: null | number` | Deferred to v2 (see §4). |
| Familiarity hard monotonicity | Removed. Familiarity is a non-monotonic derived metric. |
| Significant-threshold numeric | Removed. Routing uses magnitude buckets + confidence directly. |
| CoT field-order convention | Inapplicable. Fewer fields, mostly enums; field order doesn't carry the same CoT load. |
| Contradiction handling rule | Inapplicable. Events are creates by default for new edges; no edge means first event creates one, and the model's classification naturally reflects observable context. |
| Lore prioritization scheme | Carried over essentially unchanged (§12). |
| Approval modes | Carried over, simplified to enum-based routing (§7). |
| Tools (none) | Carried over (§8). |
