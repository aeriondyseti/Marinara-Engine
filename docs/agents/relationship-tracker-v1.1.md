# Relationship Tracker Agent — Definition

**Status:** Draft v1.1 — adversarial-review incorporated, pre-implementation
**Branch:** `feature/relationship-tracker-agent`

This document is the canonical definition of the Relationship Tracker agent.
It is both the design specification (for implementation and review) and the
source of truth for the production system prompt.

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
| Result type | `relationship_update` (new) |

**Short description** (registry copy):

> Tracks how each NPC currently feels toward the player persona across five
> dimensions (affinity, trust, attraction, respect, familiarity). Detects
> shifts after each turn and proposes updates that the player can approve
> manually or let the agent apply automatically.

---

## 2. Purpose & Scope

### What it does

For every character on-screen in a turn, the agent reads the latest exchange
and decides whether that character's feelings toward the player persona have
materially shifted. When they have, it proposes a new state — five dimensional
values plus a one-line event note — that either lands in an approval queue or
is applied directly to the character card, depending on user preference.

### What it explicitly does **not** do (v1)

- **Player → NPC edges.** The player decides how they feel; the agent does not.
- **NPC ↔ NPC edges.** Out of scope for v1; reserved for a later iteration.
- **Card field edits** (description, personality, etc.). Card Evolution Auditor's job.
- **Long-arc planning.** Secret Plot Driver's job.
- **Narrative rewrites.** The Consistency Editor consumes this agent's output,
  not the other way around.

### Storage location

Outgoing edges from a character live on that character's card, in
`CharacterExtensions.relationships: CharacterRelationship[]`. Each entry is
keyed by `personaId` to support multiple personas without migration. State
persists across chats because the character entity persists across chats.

---

## 3. The Five Dimensions

Each dimension is a directed value held by the **character** about the
**persona**. Definitions are deliberately distinct so the agent can move one
dimension without moving the others.

### affinity *(range: -100 to 100)*

Emotional warmth. Liking, fondness, hostility. Independent of trust, respect,
or attraction. You can like someone you don't trust (a charming rogue); you
can dislike someone you respect (a brilliant rival).

- `+80` adores them
- `+30` warm, friendly
- `0` neutral
- `-30` annoyed, wary
- `-80` actively hostile

### trust *(range: -100 to 100)*

Belief that the persona will act predictably and in the character's interest.
This is reliability and safety, not affection. You can trust a stern mentor
you don't particularly like; you can adore a chaotic friend you'd never lend
money to.

- `+80` would share any secret, rely on absolutely
- `0` reserves judgment
- `-80` actively expects betrayal

### attraction *(range: -100 to 100, or `null`)*

Romantic and/or sexual interest. **Nullable.**

- `null` — no romantic frame applies (parent/child dynamic, an enemy with no
  chemistry, an incidental NPC the scenario gives no romantic context).
- `0` — frame applies, character has considered it, is uninterested.
- positive — drawn to the persona romantically/sexually.
- negative — actively repulsed in a romantic/sexual sense.

The `null` vs `0` distinction matters: a parent character should be `null`,
not `0`, so downstream consumers (Editor, prompt injection) don't ever
prompt with "your character has considered romance with their mother and
rejected it."

### respect *(range: -100 to 100)*

Valuation of the persona's competence, judgment, character, or accomplishments.
Independent of affinity — a respected enemy is high-respect, low-affinity.

- `+80` reveres their judgment
- `0` neither admires nor disdains
- `-80` contempt

### familiarity *(range: 0 to 100, **monotonically increasing**)*

How well this character knows the persona — shared experiences, disclosures,
time together. **Never decreases.** Even after a fight, knowledge of the other
person persists.

- `0` strangers
- `20` acquainted, surface-level
- `50` know each other well
- `80` deeply intimate knowledge of each other
- `100` essentially nothing left to learn

**Important:** familiarity at first encounter should reflect established
backstory, not always start at 0. If the scenario establishes the character
as the persona's childhood friend, the **first** proposal should `create` an
edge with high familiarity from the outset.

### Derived `status` (computed, never stored)

Consumers that want a categorical label (`stranger | acquaintance | friend |
close | rival | enemy | partner`) derive it from the dimensions at read time.
Not part of the schema.

---

## 4. Inputs (context blocks the agent receives)

In addition to the standard `AgentContext` fields, the agent receives one new
synthetic block constructed by `agent-runner.ts`:

### `<persona>` (existing)

```
<persona>
id: persona_xyz789
name: Aerion
description: ...
personality: ...
</persona>
```

### `<present_characters>` (existing, from Character Tracker output)

The current-turn `gameState.presentCharacters[]`. Only characters listed here
are eligible for an update proposal.

### `<current_relationships>` (new — synthesized for this agent)

For each currently-present character, the existing edge toward the active
persona, or the literal string `(no prior relationship — first encounter)`.

```
<current_relationships>
Character: Dottore (id: char_abc123)
  affinity: 45
  trust: 30
  attraction: 60
  respect: 70
  familiarity: 80
  recent events:
    - "you confessed your fear of being alone"
    - "she healed you in the field"
    - "you sided with her brother in the argument"

Character: Alice (id: char_def456)
  (no prior relationship — first encounter)
</current_relationships>
```

The engine populates this from `CharacterExtensions.relationships`, filtered to
the active persona's edge. Characters with no entry for this persona render as
`(no prior relationship — first encounter)`.

### `<character_lore>` (new — synthesized for this agent)

Lorebook entries keyed to present characters (by name, alias, or character ID),
**regardless of whether the keyword scanner activated them this turn**. This is
distinct from `AgentContext.activatedLorebookEntries`, which only contains
entries the scanner tripped on in the latest messages. A character present in
the scene but not name-checked this turn would otherwise have invisible lore.

```
<character_lore>
Character: Dottore (id: char_abc123)
  - "Dottore was exiled from the academy for unauthorized experimentation"
  - "She maintains a lab in the city's underbelly; only a handful know its location"

Character: Alice (id: char_def456)
  - "Alice is the captain of the city watch; daughter of Dottore's former mentor"
  - "She publicly disavowed Dottore after the exile, though privately they remain in contact"
</character_lore>
```

Budgeted to a token cap (initially ~500 tokens per character, ~2000 total) to
avoid bloating turns where lore lookup isn't load-bearing. Entries beyond the
cap are dropped silently — the agent doesn't see them at all. If the cap is
hit, log it for tuning.

This block is especially load-bearing for first-encounter proposals (`action:
"create"`), where starting values otherwise dead-reckon from card fields alone.

### `<recent_messages>` (existing)

Standard conversation slice. The agent reasons about shifts based on what was
said and done in this slice.

---

## 5. Output Schema

The agent **must** respond with valid JSON matching exactly this shape and
nothing else. No prose, no commentary, no code fences.

```json
{
  "updates": [
    {
      "characterId":   "string — must match an id in <present_characters>",
      "personaId":     "string — copy verbatim from <persona>.id",
      "action":        "update" | "create" | "reset",
      "currentValues": {
        "affinity": -100..100,
        "trust": -100..100,
        "attraction": -100..100 | null,
        "respect": -100..100,
        "familiarity": 0..100
      } | null,
      "newEvent":      "string — one short past-tense sentence",
      "reason":        "string — specific justification, shown to user",
      "resetReason":   "string — REQUIRED when action='reset'; in-fiction cause",
      "proposed": {
        "affinity": -100..100,
        "trust": -100..100,
        "attraction": -100..100 | null,
        "respect": -100..100,
        "familiarity": 0..100
      }
    }
  ],
  "warnings": ["string — optional, one entry per genuine ambiguity"]
}
```

**Field order matters.** `newEvent` and `reason` precede `proposed` so that
the model writes the narrative trigger and reasoning *before* committing to
numeric values. Because LLMs are autoregressive, this lets the prose function
as a CoT scratchpad — the numbers become the conclusion of the reasoning
rather than a prior the model has to retroactively justify. The order is not
cosmetic; do not reshuffle without re-evaluating output quality.

Field rules:
- `action: "create"` ↔ `currentValues: null`. Mismatch is invalid.
- `action: "update"` ↔ `currentValues: <object>`. Mismatch is invalid.
- `action: "reset"` ↔ `currentValues: <object>`. Mismatch is invalid.
  Reset is used for **in-fiction events that genuinely rewrite the
  relationship**: amnesia, possession, timeline rewrites, character death and
  resurrection, mind control, magical bond-breaking. NOT for routine conflict.
- `action: "reset"` requires `resetReason` — a specific in-fiction
  explanation. The proposal queue surfaces this prominently; resets always
  require approval, even in `approvalMode: "auto"`. The user must consent to
  retcons.
- For `action: "update"`: `proposed.familiarity >= currentValues.familiarity`.
  Familiarity only increases under normal updates.
- For `action: "reset"`: any dimension may move in any direction, including
  familiarity decreases. The normalizer does not clamp.
- `newEvent` is one observable thing that shifted the state, in past tense,
  written from the character's perspective ("she saw you spare the bandit").
- `reason` is shown verbatim in the proposal review UI. It should be specific
  enough that the user can decide without re-reading the whole exchange.
- An empty `updates: []` array is valid — "nothing material changed this turn."
- `warnings` is optional and may be omitted entirely. Populate only when the
  agent's proposal *might be materially wrong* due to genuine ambiguity in the
  input (sarcasm vs sincerity, mixed signals, deliberate misdirection). Each
  entry is one short sentence. Surfaced in the proposal/history UI as a
  caution — especially valuable in `approvalMode: "auto"` where the user
  doesn't gate every change. Not a place for routine judgment-call disclaimers.

### Robustness against LLM emission quirks

LLMs are unreliable about literal `null`. The normalizer accepts all these
forms as semantically `null` for the `attraction` field:

| Model emits | Normalized to |
|---|---|
| `null` | `null` |
| missing key | `null` |
| `"null"` (string) | `null` |
| `"none"`, `"n/a"`, `""` (string) | `null` |
| out-of-range number | clamped to range |
| `0` | `0` (trusted as-is) |

Same defensive coercion is NOT applied to numeric dimensions — out-of-range
values clamp, but malformed values (`"high"`, `true`, missing key) drop the
proposal. We allow latitude for the one field where the `null` distinction is
genuinely confusing for the model; we don't allow it everywhere.

---

## 6. System Prompt (production)

The full template literal that will live in
`src/engine/contracts/constants/agent-prompts.ts` under the key
`"relationship-tracker"`.

````
You track how each NPC currently feels toward the player persona ({{user}}).
After every assistant message, analyze the latest exchange and propose updates
to each present character's feelings across five dimensions.

You do NOT decide how the player feels about characters — only how the
characters feel about the player. The player decides their own feelings.

You receive these context blocks:
- <persona>: the active player persona — name, description, personality.
- <present_characters>: who is currently in the scene. Only these characters
  are eligible for proposals. Anyone mentioned but not present is ignored.
- <current_relationships>: each present character's existing edge toward the
  persona. A character without an entry here is a FIRST ENCOUNTER and must use
  action: "create".
- <character_lore>: background lorebook entries about present characters
  (their history, reputation, relationships with others). Consult this
  especially when proposing first-encounter starting values.
- <recent_messages>: the latest conversation slice.

Respond ONLY with valid JSON. No prose, no code fences, no commentary.

Schema (FIELD ORDER MATTERS — fill in the order shown):
{
  "updates": [
    {
      "characterId":   "string — must match an id in <present_characters>",
      "personaId":     "string — copy from <persona>.id",
      "action":        "update" | "create" | "reset",
      "currentValues": { ... } | null,
      "newEvent":      "string — one short past-tense sentence from the character's POV",
      "reason":        "string — specific justification shown to the user",
      "resetReason":   "string — REQUIRED only when action='reset'; in-fiction cause. Omit otherwise.",
      "proposed": {
        "affinity":    number,        // -100 to 100
        "trust":       number,        // -100 to 100
        "attraction":  number | null, // -100 to 100, or null if no romantic frame
        "respect":     number,        // -100 to 100
        "familiarity": number         // 0 to 100, only increases under "update"
      }
    }
  ],
  "warnings": ["string — optional, one entry per genuine ambiguity in this turn"]
}

Write newEvent and reason BEFORE proposed. The narrative justification should
inform the numeric values, not the other way around.

Dimensions:
- AFFINITY:    emotional warmth. Like/dislike. Independent of trust and respect.
- TRUST:       belief the persona will act predictably and in your interest.
               Reliability and safety. Independent of affinity.
- ATTRACTION:  romantic/sexual interest. Use null (NOT 0) when no romantic
               frame applies — parent/child, sworn enemies with no chemistry,
               incidental NPCs the scenario gives no romantic framing. Use 0
               when the frame applies but the character has considered it and
               is uninterested.
- RESPECT:     valuation of the persona's competence, judgment, or character.
               A respected enemy is high-respect, low-affinity.
- FAMILIARITY: how well the character knows the persona. ONLY INCREASES, never
               decreases. Even after conflict, knowledge persists.

Rules:
1. Only propose updates for characters listed in <present_characters>. Ignore
   characters mentioned but not present.

2. Changes must be PROPORTIONAL to what happened this turn:
   - Small moment (a glance, a polite exchange) → ±1 to ±5
   - Moderate moment (sincere compliment, mild conflict, useful help) → ±6 to ±15
   - Significant moment (betrayal, vulnerability, intimacy, saved life) → ±16 to ±35
   - Do not swing dimensions dramatically over minor events.

3. If nothing notable shifted this character's feelings toward the persona
   this turn, OMIT that character from the updates array. Don't pad with
   no-op entries.

4. FAMILIARITY (under action: "update") only goes up. Even a tiny shared
   moment increases it by at least 1. A revealing or intimate exchange can
   bump it 5-15. Under action: "reset", familiarity may decrease — see Rule 4a.

4a. RESET (action: "reset") — use ONLY for in-fiction events that genuinely
    rewrite the relationship. Concretely:
   - Amnesia, memory wipes, or magical mind alteration
   - Timeline rewrites or character resurrection-as-someone-else
   - Possession, body-swap, or character replacement
   - In-world bond-breaking rituals or magical severance
   - NOT for ordinary conflict, breakups, betrayals, or character growth —
     those are updates, however dramatic.
   - resetReason is REQUIRED and must cite the in-fiction event.
   - All dimensions may move in any direction, including familiarity
     decreases. Be deliberate: a memory wipe might drop familiarity to 0
     while leaving cultivated trust intact (the character still has the
     muscle memory of trusting the persona, just no episodic recall).
   - Resets always require user approval, even when approvalMode is "auto".

5. ATTRACTION:
   - Default to null when in doubt about whether the romantic frame applies.
   - Use 0 only when the frame plausibly applies and the character is uninterested.
   - Do NOT introduce attraction out of nowhere. There must be a basis in the
     scene, the character's personality, or established context.

6. FIRST ENCOUNTERS (action: "create"):
   - currentValues MUST be null.
   - Consult <character_lore> for established backstory before choosing
     starting values. A character with documented history with the persona
     (childhood friend, sworn rival, former mentor) should NOT start at zero.
   - If <character_lore> establishes a prior dynamic, reflect it: childhood
     friends start with high familiarity and positive affinity; long-standing
     rivals start with negative affinity and possibly high respect.
   - If nothing in context establishes a prior relationship, all dimensions
     start near 0 and shift based on the encounter itself.

6c. CONTRADICTION HANDLING. If <current_relationships> shows no edge for a
    character but <recent_messages> or <character_lore> clearly establishes
    prior intimacy (the player and character speak as longtime partners, the
    persona's description references "her old friend X", etc.), this is a
    DELIBERATE RESET by the user — they cleared the edge manually. Use
    action: "create" but set starting values that reflect the observable
    context. Do NOT start at zero against visible evidence. Add a warnings
    entry: "Edge appeared reset; starting values reflect observable history,
    not a true first encounter."

7. UPDATES (action: "update"):
   - currentValues MUST equal the values shown in <current_relationships>.
   - proposed MUST contain ALL five dimensions, even unchanged ones.
   - proposed.familiarity MUST be >= currentValues.familiarity.

8. newEvent:
   - One short sentence, past tense, written from the CHARACTER'S point of view.
   - Describes an observable thing that shifted their feelings.
   - Example: "you confessed you'd lied to her about the gem"
   - NOT a summary of the whole exchange. NOT internal narration about what
     the character feels — the dimensions already encode that.

9. reason:
   - Shown verbatim to the user in an approval queue.
   - Be specific: cite what changed and why. "Affinity up because she
     appreciated your honesty about the gem" beats "things went well."

10. EMPTY OUTPUT is valid: {"updates": []} means nothing material shifted
    this turn. Use this freely. Most turns will not need updates for every
    present character.

11. WARNINGS (optional):
    - Populate ONLY when your proposal might be materially wrong because of
      genuine ambiguity in the input — sarcasm vs sincerity, mixed signals,
      deliberate misdirection, an action that could plausibly be read as
      flirting or as teasing, etc.
    - One short sentence per ambiguity. Be specific about what's ambiguous.
    - Do NOT use warnings as a disclaimer on routine judgment calls. If you
      had to pick between two reasonable readings and one was clearly more
      supported, no warning needed.
    - Omit the field entirely if there are no genuine ambiguities. An empty
      array is also acceptable.
    - Example: ["Player's tone with Dottore is ambiguous — could read as
      flirtation or as cruel teasing; proposed attraction +5 assumes the
      former."]

Preserve continuity. The dimensions are durable state that persists across
chats. Do not reset or radically alter values without strong narrative
justification in this turn.
````

---

## 7. Settings

```ts
settings: {
  /**
   * Controls when proposals require explicit user approval vs auto-apply.
   *
   * "manual"      — every proposal goes to the approval queue. Safest, but
   *                  risks alert fatigue when most turns produce ±1-2 micro-
   *                  shifts the user would have approved anyway.
   * "significant" — auto-apply MICRO updates (sum of absolute dimension
   *                  deltas < significantThreshold); queue larger shifts,
   *                  any "reset" action, and any update with non-empty
   *                  warnings[]. Default mode.
   * "auto"        — auto-apply all "update" and "create" actions. "Reset"
   *                  actions and proposals with warnings ALWAYS queue,
   *                  regardless of this setting.
   */
  approvalMode: "manual" | "significant" | "auto",  // default: "significant"

  /**
   * In "significant" mode, sum of |Δ| across all five dimensions below which
   * an update is considered "micro" and auto-applied. Roughly tuned so one
   * moderate moment (Rule 2) lands just over the threshold.
   */
  significantThreshold: number,  // default: 8
}
```

### Why tri-state instead of a boolean

The original spec used a `autoApply: boolean`. Adversarial review surfaced
that an all-manual default produces alert fatigue (users mass-approve micro-
updates without reading), while an all-auto default loses the user's ability
to consent to meaningful changes. The tri-state separates these concerns:

- **`"significant"` (default)** addresses both failure modes. Micro-shifts
  flow through silently; meaningful changes still get a confirmation step.
- **`"manual"`** remains available for users who want to see every change.
- **`"auto"`** is the power-user mode, with the safety floor that resets
  and warned proposals always queue regardless.

### Mandatory queueing — overrides `approvalMode`

These ALWAYS go to the manual queue, even in `"auto"`:

| Condition | Why |
|---|---|
| `action: "reset"` | Resets are in-fiction retcons. The user must consent to retconning their own narrative. |
| `warnings.length > 0` | The agent has flagged the proposal as possibly wrong. Auto-applying flagged updates defeats the purpose of warnings. |
| Initial proposal for a character on a new chat (first turn the agent sees them) | First impressions compound forever. Worth confirming the starting values once. |

### Audit trail (unchanged from earlier draft)

Every applied change — auto OR approved — appends to a history view per
character/persona pair. Auto-applied entries support a one-click Undo that
pops the prior dimensions back. History is the user's window into what
the agent did; in auto mode it's their only window.

---

## 8. Tools

**None.** `tools: []`, `toolConfig: null`.

This decision was considered carefully, not defaulted to. Tool candidates
examined and rejected:

| Candidate | Why rejected |
|---|---|
| `get_character_lore(characterId)` — fetch lorebook entries for a present character | Solved by **unconditional lore hydration into `<character_lore>`** (§4). Data is in the agent's hands either way; tool form added a code-path surface (definition, executor wiring, response normalization, new failure modes) for no information gain at v1 scale. |
| `get_full_event_log(characterId)` — beyond the rolling 5 recentEvents | Duplicates `chatSummary`. Cumulative dimensions are the right level of memory for this agent; discrete-event recall is closer to Knowledge Retrieval's job. |
| `get_quest_state()` / `get_persona_stats()` / `get_combat_history()` | All already in `gameState`. Prompt-tuning issue, not a tool. |
| `get_persona_other_relationships()` — see the persona's broader landscape | Violates in-world POV. The character should only know what the character observed. Letting them retroactively query the graph is omniscience. |
| `peek_secret_plot_state()` — see Secret Plot Driver's planned arc | Architectural violation. Secret Plot Driver hides its state deliberately. |
| Action tools (`apply_update`, `write_lorebook`, etc.) | Categorical reject. Any tool that mutates state from inside the LLM loop bypasses the propose-and-approve boundary, which is the entire safety story. Writebacks live outside the agent. |
| `flag_uncertain(reason)` — defer to user when ambiguous | Converted to the `warnings: string[]` schema field. Metadata doesn't need a tool round-trip. |
| `get_card_evolution_history(characterId)` / trajectory awareness | Real but rare; v2 if we observe specific failure modes. Trajectory awareness is a storage shape problem (sample history), not a tool. |

### Principle

A tool earns its seat when **both** are true: (a) the data isn't always
needed, AND (b) including it always would meaningfully degrade something
(latency, cost, prompt clarity). For this agent at v1 scale, condition (b)
fails for everything that survives condition (a) — the data fits in context.

### When to revisit

Add a tool in v2 only if we see specific evidence of one of:
- First-encounter proposals consistently dead-reckon because budgeted lore
  hydration is dropping load-bearing entries (would justify
  `get_character_lore` with on-demand fetch).
- Callbacks to old events get misread because rolling-5 + summary aren't
  enough (would justify `get_full_event_log`).
- Trajectory across chats becomes a desired axis (would require both a
  storage-shape change and a context block, not a tool).

A v1 agent that's a pure stateless function of its context is dramatically
easier to test, debug, and reason about. We're keeping that property.

---

## 9. Pipeline Lifecycle

| Step | Where | What happens |
|---|---|---|
| 1. Hydrate | `agent-runner.ts` | Two synthetic context blocks built: (a) `<current_relationships>` from `CharacterExtensions.relationships` filtered to active persona's edge. If multiple entries for the same `personaId` exist (data corruption), pick the one with the latest `updatedAt` — NOT the array-first entry. (b) `<character_lore>` from lorebook entries keyed to present characters' names/aliases/IDs, regardless of keyword-scan activation. Entries are ranked by the scoring function in §12 and packed greedily under a configurable budget (~500 tokens per character, ~2000 total). Dropped entries emit a visible sentinel into the context block and a structured debug-log entry — never silent. See §12. |
| 2. Execute | `agent-executor.ts` | Standard post-processing pass: builds prompt with context blocks, calls LLM, parses JSON response. |
| 3. Normalize | `agent-normalizers.ts` | Clamps numeric ranges, enforces familiarity-monotonic, validates characterId/personaId against present cast, drops malformed entries. |
| 4. Result | `agent-runner.ts` | Emits `AgentResult { type: "relationship_update", data: RelationshipUpdateResult }`. |
| 5. Route | writeback layer | For each proposal, compute total |Δ| across dimensions. Route based on `approvalMode`: <br/>• `"manual"` → all proposals queue.<br/>• `"significant"` → micro proposals (`Σ|Δ| < significantThreshold`, no warnings, not a reset, not a first-encounter-for-chat) auto-apply via step 5b; everything else queues.<br/>• `"auto"` → all `update`/`create` auto-apply EXCEPT proposals with warnings, reset actions, or first-encounter-for-chat. Those always queue. |
| 5a. Writeback (queued) | review/approval layer | Proposal lands in user's approval queue. User accepts → routes to 5b. Rejects → discarded. UI shows current vs proposed dimensions diff, the newEvent, the reason, any warnings, and (for resets) the resetReason prominently. |
| 5b. Writeback (apply) | writeback layer | Proposal written to the matching character's `CharacterExtensions.relationships` entry (create/update/reset). `recentEvents` appended and trimmed to last 5. `lastChatId` and `updatedAt` stamped. Every applied change appended to the per-edge history log regardless of how it routed. |
| 6. Inject | `prompt-assembly.ts` | Next turn, render `<relationships>` block for present characters from the durable state, feeding the model the current standing for prose consistency. |

---

## 10. Failure Modes & Guardrails

| Failure | Behavior |
|---|---|
| Malformed JSON response | Entire turn's update dropped. Log + surface to debug sink. No fallback parsing. |
| `characterId` not in `<present_characters>` | That single proposal dropped. Other proposals in same response preserved. |
| `proposed.familiarity < currentValues.familiarity` | Clamped up to `currentValues.familiarity`. Proposal proceeds with corrected value. |
| `action: "update"` with `currentValues: null` (or vice versa) | Proposal dropped. |
| Dimension out of range | Clamped to range. Proposal proceeds. |
| User has no active persona | Agent skipped entirely for the turn. |
| `warnings` field present but malformed (not an array of strings) | Field dropped, `updates` still processed. Logged. |
| `warnings` entry is empty string or absurdly long (>500 chars) | Trimmed or dropped per entry. Surrounding entries preserved. |
| `<character_lore>` hydration exceeds token budget | Entries ranked per §12, packed greedily. Dropped entries surface as a visible sentinel line at the end of the lore block (`[N entries omitted; top dropped: X, Y, Z]`) AND a structured debug-log entry with ID, score, and length per dropped entry. NEVER silent. |
| Single lore entry exceeds its character's per-character allocation | Include it anyway, blow past the budget by that much, log prominently. Load-bearing single entries beat budget cleanliness. |
| Multiple `relationships[]` entries for the same `personaId` (data corruption) | Pick by latest `updatedAt`, NOT array index. Log the duplicates' IDs and `updatedAt` values for diagnosis. |
| `action: "reset"` without `resetReason`, or with empty/whitespace `resetReason` | Proposal dropped, log warning. Reset is high-impact; we don't accept it without justification. |
| `action: "reset"` arrives in `approvalMode: "auto"` | Routes to manual queue anyway. The auto setting doesn't override reset's mandatory approval. |
| Contradiction between `<current_relationships>` (no edge) and `<recent_messages>` (intimate dialogue) | Per Rule 6c: agent uses `action: "create"` with starting values reflecting visible context, emits a warning. Normalizer doesn't intervene — this is a prompt-side judgment, not a data-validation issue. |
| Model emits `attraction: 0` where the scenario obviously implies `null` (e.g., parent/child) | Not auto-corrected. The prompt instructs the model to choose; we don't second-guess at the normalizer. Editor agent may flag downstream. |
| Model emits `attraction: "null"`, `"none"`, `""`, or omits the key | Coerced to `null` per the table in §5. No proposal dropped for this. |
| `proposed` field arrives BEFORE `newEvent`/`reason` in the JSON output (model ignored field order) | Accepted but logged — useful telemetry for tuning. Output quality is expected to degrade; track this signal. |

---

## 11. Worked Example

### Setup

Persona: **Aerion** (id `persona_xyz789`). Active.
Present: **Dottore** (id `char_abc123`), existing relationship.
Present: **Alice** (id `char_def456`), first encounter this turn.

Existing edge on Dottore for Aerion:
- affinity 45, trust 30, attraction 60, respect 70, familiarity 80
- recentEvents: `["you confessed your fear of being alone", "she healed you in the field", "you sided with her brother in the argument"]`

### Latest turn

The player gives Dottore a rare alchemical reagent they'd been saving, and
deflects when Alice tries to introduce herself.

### Expected agent output

```json
{
  "updates": [
    {
      "characterId": "char_abc123",
      "personaId": "persona_xyz789",
      "action": "update",
      "currentValues": {
        "affinity": 45, "trust": 30, "attraction": 60,
        "respect": 70, "familiarity": 80
      },
      "newEvent": "you gave her the rare reagent without asking anything in return",
      "reason": "Unsolicited generosity reads as sincere care. Affinity and trust up moderately. Respect nudges up for the deliberate sacrifice. Familiarity small uptick from the sustained intimate exchange. Total |Δ|=24, likely queues under default 'significant' threshold of 8.",
      "proposed": {
        "affinity": 55, "trust": 40, "attraction": 62,
        "respect": 72, "familiarity": 82
      }
    },
    {
      "characterId": "char_def456",
      "personaId": "persona_xyz789",
      "action": "create",
      "currentValues": null,
      "newEvent": "you brushed past her introduction without engaging",
      "reason": "First impression: dismissive. Slight negative affinity. Attraction null — no romantic context established and Alice is the city watch captain whose only context here is duty-related. Familiarity barely above zero, just enough to register the meeting.",
      "proposed": {
        "affinity": -5, "trust": 0, "attraction": null,
        "respect": 0, "familiarity": 2
      }
    }
  ]
}
```

Notes on this output:
- Field order: `newEvent` and `reason` precede `proposed` so the model
  reasons through narrative severity before committing to numbers.
- No `warnings` field emitted — neither read was ambiguous. If the player
  had deflected Alice with a wink that could read either way, a warning
  would be appropriate:
  `"warnings": ["Player's deflection of Alice was ambiguous — wink could read as deferred interest or flirty dismissal. Proposed attraction null assumes too-little-context-yet."]`
- Both proposals exceed the default `significantThreshold` of 8, so in
  `approvalMode: "significant"` mode both would queue. In `"auto"` mode,
  Dottore's would apply silently (no warning, no reset, not a chat-first);
  Alice's would queue regardless because it's the agent's first encounter
  with her in this chat.

### Reset example

Setup: a few turns later, in-fiction, Alice undergoes a memory wipe via a
plot artifact. The narrative makes this explicit. Existing edge:

Alice → Aerion: affinity 40, trust 35, attraction null, respect 50, familiarity 25.

Expected agent output:

```json
{
  "updates": [
    {
      "characterId": "char_def456",
      "personaId": "persona_xyz789",
      "action": "reset",
      "currentValues": {
        "affinity": 40, "trust": 35, "attraction": null,
        "respect": 50, "familiarity": 25
      },
      "newEvent": "the artifact erased her memory of you entirely",
      "reason": "In-fiction reset. Episodic memory is gone, so familiarity drops to 0. Affective state mostly resets — she has no basis for the old feelings. Some residual: subconscious bodily memory may carry forward as faint baseline.",
      "resetReason": "Memory-wipe artifact activated this turn; the narrative explicitly establishes Alice no longer remembers Aerion or their shared history.",
      "proposed": {
        "affinity": 0, "trust": 0, "attraction": null,
        "respect": 0, "familiarity": 0
      }
    }
  ]
}
```

This proposal always queues, regardless of `approvalMode`, because resets
are retcons and the user must consent.

---

## 12. Lore Prioritization Scheme

When `<character_lore>` hydration would exceed the token budget, entries are
ranked by a scoring function and packed greedily. Dropped entries are visible
to the agent (sentinel line) and logged (debug sink). This section is the
authoritative specification of the ranking.

### Per-entry score

Sum of weighted signals. Higher score → packed earlier.

| Signal | Weight | Rationale |
|---|---|---|
| Entry has an `important` / `always-include` flag (if schema supports) | **+100** | Explicit user override; effectively pins the entry. |
| Mentions persona by name, alias, or ID | **+50** | Most likely to encode persona-specific relationship history. This is the data we'd most regret dropping. |
| Mentions the subject character by name, alias, or ID | **+30** | Direct biographical data about who they are. |
| Entry tag matches `relationship`, `history`, `backstory` (taxonomy TBD during implementation — inspect `lorebook.schema.ts`) | **+25** | Explicit user signal that this is relationship-relevant. |
| Cross-references another present character | **+15** | Establishes the subject's social position relative to the current cast. |
| Updated within the last 7 days (`updatedAt`) | **+10** | Recent edits likely current-arc relevant; Lorebook Keeper's recent output earns priority. |
| Activated by keyword scanner in the last 3 turns | **+8** | Proven relevance to the current scene. |
| Length penalty (per 100 tokens over a 200-token soft baseline) | **−2** | Mild penalty; lets us pack more concepts per budget without aggressively penalizing long load-bearing entries. |

Ties broken by descending `updatedAt`.

### Budget allocation

- Default total budget: 2000 tokens, configurable per chat or per agent.
- Default per-character budget: 500 tokens, also configurable.
- **Per-character floor**: each present character is guaranteed at least 20%
  of the total budget for their entries (so one character with many long
  entries cannot starve another character of all lore). Within a character's
  floor, the scoring function above applies.
- **Single-entry override**: if a character's highest-scored single entry
  exceeds their per-character allocation, include it anyway and exceed the
  budget by that amount. A load-bearing single entry is worth more than a
  clean budget cap. Log the overage prominently.

### Visibility — non-negotiable

Silent truncation is forbidden. When entries are dropped:

1. The `<character_lore>` block ends with a sentinel line:
   `[N entries omitted due to budget; top dropped: <id1>, <id2>, <id3>]`
   The agent reads this and knows context is incomplete.
2. The debug sink receives a structured entry per drop: entry ID, score,
   token length, the signals that contributed to its score, and the
   character it was attached to. Sufficient to reconstruct the ranking
   for any past turn.
3. If overall truncation occurs on >10% of turns (rolling window), surface a
   suggestion to the user: "Your lore is exceeding the budget — consider
   raising the cap or trimming entries."

### Implementation note

The scoring weights are an opinionated starting point, not load-bearing
constants. They should be tunable (config or feature flag) so we can iterate
based on observed quality. Don't hardcode in source paths that aren't easy
to revisit.

---

## 13. Open Items / Future Work

- **NPC ↔ NPC edges** (v2). Same five dimensions, separate storage path
  (`agent-memory` chat-scoped, since cross-chat continuity matters less
  between NPCs and would explode storage if made durable).
- **Manual edge editing in the character editor UI** (v2). Read-only in v1.
- **Trajectory awareness** (v2 if needed). Currently the agent sees state
  at this instant. "Dottore's affinity has climbed five chats in a row" is
  qualitatively different from "Dottore has been at affinity 60 for five
  chats." If added, this is a storage-shape change (sample history per edge)
  plus a context block — explicitly not a tool.
- **`get_character_lore` as a tool** (v2 if needed). Currently we hydrate
  unconditionally with a budget cap; if budget-driven entry drops are
  observed to degrade first-encounter quality in practice, promote to a
  tool with on-demand fetch.
- **`get_full_event_log` tool** (v2 if needed). If rolling-5 recentEvents
  + chatSummary together prove too thin for callback handling.
- **Tone / drift detection.** If autoApply drifts toward extreme values
  unjustifiably, surface that to the user. Could become a separate
  "Relationship Steward" agent or fold into existing analytics.
- **Cross-chat undo.** v1 only undoes the most recent applied change per
  edge. Multi-step history navigation is a v2 concern.
- **Card Evolution coupling.** If relationship dimensions persistently
  diverge from card-stated personality (e.g., card says "warm to everyone"
  but affinity is consistently -50 across personas), that's evidence the
  card itself needs to evolve. Possible cross-agent signal to Card Evolution
  Auditor in a later iteration.
