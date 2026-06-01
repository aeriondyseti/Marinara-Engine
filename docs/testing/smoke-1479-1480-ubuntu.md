# Manual Smoke Test Guide — Ubuntu re-test

Covers two smoke tests, re-run on **Ubuntu** even though the upstream issues are closed:

- **#1479 — Shell / Navigation / Responsive Panels**
- **#1480 — Professor Mari Deeper Pass**

> Fill in the **Setup** block once, run the checks in order, and record PASS/FAIL with a
> one-line note. If something fails, file one issue per distinct failure and link it back.

---

## Common setup (do this once)

| Field | Value |
|---|---|
| Tester | _your handle_ |
| Branch/commit | `refactor` @ `git rev-parse --short HEAD` |
| OS | Ubuntu (note version + Wayland/X11) |
| Run mode | Tauri desktop (the only supported target) |

### Launch

Test the **Tauri desktop app only**. (A Vite web server exists but is legacy and is
**not** a supported test target — do all checks in the real desktop window.)

```
pnpm install      # only if deps changed
pnpm tauri dev    # builds + launches the desktop app
```

> **Ubuntu/WebKitGTK blocker:** if the window opens as a solid color / frozen / never
> paints, **that is a failure to report**, not something to work around. Capture the
> terminal output and OS details (Ubuntu version, Wayland vs X11, GPU/driver) and file it.
> Do not substitute the web build to "pass" the shell/nav checks — those checks are only
> meaningful in the desktop window.

### Orientation — the title bar is the main nav

The app uses a **custom frameless titlebar** (`decorations: false`). Left-to-right it holds:
sidebar toggle · Home · Professor Mari · (window title / drag region) · **panel nav buttons**
(Browser, Characters, Lorebooks, Presets, Connections, Agents, Personas, Settings) · window
controls (min/max/close). On mobile-width these collapse into a top bar with a **Tools**
menu.

---

## #1479 — Shell / Navigation / Responsive Panels

Run every check in the **Tauri desktop** window (`pnpm tauri dev`). If the window won't
render, stop and report the WebKitGTK blocker above rather than working around it.

### Check 1 — Open and close the left sidebar (chat list)
1. In the title bar, click the **panel/sidebar icon** (leftmost; `aria-label="Open chats"`,
   `data-tour="sidebar-toggle"`). The chat-list sidebar slides in; the button shows an
   active underline.
2. Click the **same icon** again (now `aria-label="Close chats"`). The sidebar slides out.
3. *(Mobile width only)* With the sidebar open, click the dark backdrop, or press **Esc** —
   it should also close.

✅ **PASS** if it opens and closes both ways without visual glitches.
- [ ] PASS / [ ] FAIL — _note:_

### Check 2 — Open and close the right tools panel
1. In the title bar's **panel nav buttons**, click **Settings** (gear icon). The right
   panel opens to Settings.
2. Click **Settings** again → panel closes. (Each nav button *toggles* its own panel.)
3. Click a **different** nav button (e.g. **Connections**) → the right panel switches to
   that tool rather than stacking.
4. *(Mobile width)* Use the **Tools** dropdown in the top bar to open a panel; close via
   backdrop or **Esc**.

✅ **PASS** if the right panel opens, switches tools, and closes.
- [ ] PASS / [ ] FAIL — _note:_

### Check 3 — Open and close the tracker panel
> **Precondition chain (read first — avoids a false FAIL):** the tracker panel only exists
> in **Roleplay mode** and only after it's enabled in Settings.
1. Open **Settings** (right panel) → **Appearance** → toggle **Tracker Panel** ON
   (`aria-label="Enable Tracker Panel"`).
2. Open or create a **Roleplay** chat (the tracker panel does **not** appear in
   Conversation or Game mode).
3. In the Roleplay HUD, click the tracker toggle (`data-tracker-panel-toggle="roleplay-hud"`,
   `aria-label="Show Tracker Panel"`). The panel slides in from the configured edge.
4. Toggle it again (or, on mobile, backdrop / **Esc**) to close.

✅ **PASS** if, with the precondition met, it opens and closes.
⚠️ If you can't find the toggle, confirm you're in Roleplay mode **and** the setting is ON
before recording FAIL.
- [ ] PASS / [ ] FAIL — _note:_

### Check 4 — Resize the window without panels overlapping/clipping/hiding controls
> Must be run in **Tauri desktop** (a real OS window). Min size is 720×520.
1. Open the left sidebar and the right panel together.
2. Drag the window narrower in steps. Watch for: panels overlapping each other, content
   clipping, or any titlebar control (min/max/close, nav buttons) getting hidden/cut off.
3. Near the narrow end, confirm the **right panel auto-closes** to protect the center
   content (it closes when the center would drop below ~400px). This is expected behavior,
   not a failure.
4. *(Optional)* Drag the sidebar/right-panel **resize handles** (`aria-label="Resize left
   sidebar"` / `"Resize right sidebar"`); arrow keys also adjust width when focused.

✅ **PASS** if no overlap/clipping and all controls stay reachable at every width down to
the minimum.
- [ ] PASS / [ ] FAIL — _note:_

### Check 5 — Switch between shell areas without getting stuck
Navigate through several areas and confirm each enters cleanly and you can get **back home**:
1. Click **Browser** (Bot Browser) → then the **Home** button (`aria-label="Home"`).
2. Open **Characters** → click **Library** / open a character editor → close it (back/X).
3. Open **Professor Mari** (avatar button) → click **Home** to leave.
4. Open/activate a chat (Mode Surface) → **Home** again.

✅ **PASS** if every area opens, the **Home** button always returns you to the main view,
and you never get trapped in an overlay or a blank/wrong view.
- [ ] PASS / [ ] FAIL — _note:_

---

## #1480 — Professor Mari Deeper Pass

> One person owns this pass (overlapping Mari tests create duplicate findings).
> Extra setup row:
> - **Provider/model:** _e.g. OpenAI gpt-4o_ — **must support native tool calls** (see below)

### ⚠️ Critical precondition — pick a tool-capable provider
Professor Mari runs as a tool-using agent and **requires a connection whose provider
speaks the OpenAI-compatible tool-call wire format** (`mari.rs:873`). Supported providers:
**OpenAI, OpenAI/ChatGPT, OpenRouter, xAI, Mistral, Cohere, nanoGPT, custom**. The gate is
about *wire format*, not whether the underlying model has tool-call capability — Gemini and
Anthropic both support tool use but use different request/response shapes that Marinara's
Rust transport doesn't translate yet. Such connections return a clear in-chat error —
**not a crash and not a Check-1/2 failure** (it's actually what Check 4 exercises).

**Tool-capable runtime needs both layers:** (a) provider on the allow-list above
*and* (b) a model that actually emits `tool_calls` in responses. The `custom` provider
covers local servers (LM Studio, llama.cpp, vLLM, Ollama's OpenAI-compat endpoint) — but
only if the loaded model is tool-trained (Qwen 2.5 Instruct, Llama 3.1/3.2 Instruct,
Hermes-3, Mistral-Small with tools, etc. — *not* roleplay merges like Mythomax).

To configure: title bar → **Connections** panel → add a provider + chat model + API key
(or base URL for `custom`). Then in Mari, click the **chain/link icon** in the input box
to select that connection.

### Check 1 — Open Professor Mari without breaking the shell
1. In the title bar, click the **Professor Mari** button (Mari avatar image,
   `aria-label="Professor Mari"`).
2. The Mari surface opens (pixel scene + chat input). The rest of the shell stays intact;
   the button shows an active state.

✅ **PASS** if Mari opens and the shell is not broken/blanked.
- [ ] PASS / [ ] FAIL — _note:_

### Check 2 — Ask a current-repo question, grounded in current files
1. Ensure a tool-capable connection is selected (chain icon).
2. Ask something answerable from this repo, e.g.:
   > "What does `AppShell.tsx` do, and where is the sidebar toggle defined?"
3. Mari should auto-invoke its code tools (`search_marinara_code` → `read_marinara_code_file`)
   and answer with **real file paths / line references** that match the current tree.

✅ **PASS** if the answer is grounded in actual current files (paths resolve, not invented).
- [ ] PASS / [ ] FAIL — _note:_

### Check 3 — Ask a follow-up without runaway tokens or stale paths
1. Ask a dependent follow-up, e.g.:
   > "Now show me how that toggle updates the store."
2. Confirm the reply stays on-topic, cites **paths that still exist**, and doesn't balloon
   (history auto-compacts; agent is capped at a few reasoning turns).
3. *(Optional)* Type `/reset` to clear the conversation locally (no API call) and confirm it
   clears.

✅ **PASS** if the follow-up is coherent, paths are current, no obvious runaway usage.
- [ ] PASS / [ ] FAIL — _note:_

### Check 4 — Observe a safe unavailable/denied tool path without a crash
Pick **one** to trigger a graceful, in-chat error (the app must **not** crash):
- **a) Unsupported provider:** select a Gemini/tool-less connection, ask a question →
  expect an in-chat message like *"Professor Mari requires a connection with native
  tool-call support…"*.
- **b) Denied file path:** ask Mari to read a path outside its allow-list, e.g.
  *"Read `src-tauri/target/debug/whatever`"* → expect *"That path is not available to
  Professor Mari."*
- **c) Too-large file:** ask Mari to directly read a very large generated file → expect a
  *"too large to read directly; search it first"* style error.

✅ **PASS** if the error surfaces **in the chat** and the app keeps running (no white screen,
no hard crash).
- [ ] PASS / [ ] FAIL — _note (which path you used):_

### Check 5 — Leave Mari and return to normal app areas
1. Click **Home** (`aria-label="Home"`) — Mari closes, main view returns.
2. Re-open Mari; confirm your conversation persists (it stays mounted).
3. Click a **chat** in the sidebar or open a **detail view** (e.g. Characters) — Mari should
   auto-close and the normal area should show.

✅ **PASS** if you can leave Mari and use normal areas, and return, without breakage.
- [ ] PASS / [ ] FAIL — _note:_

---

## Recording results
- Tick each box, add a one-line note (even on PASS: "clean", "minor flicker", etc.).
- For any FAIL: file **one issue per distinct failure**, include OS + run mode + repro steps
  + screenshot, and link it back to the project card / this re-test.
