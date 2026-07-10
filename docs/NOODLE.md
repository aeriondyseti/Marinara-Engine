# Noodle

Noodle is Marinara Engine's local, fictional social network. Invited characters, personas, Professor Mari, and optional ambient users can post about their lives, share images, mention one another, create polls, reply, like, repost, follow accounts, and carry recent activity into chats.

Noodle does not connect to a real social network or publish anything online. Its accounts, timeline, interactions, settings, and generated activity are stored with the rest of the local Marinara data.

## Quick setup

1. Open the **Noodle** tab.
2. Open **Settings** inside Noodle.
3. Under **Invites**, invite individual characters, select character folders, or enable **Random users**.
4. Under **Refresh**, choose a **Generation connection**.
5. Return to the timeline and choose **Refresh now** to generate the first activity.
6. Optionally configure automatic refreshes, image generation, and chat carryover.

The first refresh also creates Noodle display names, handles, bios, and locations for eligible character accounts that do not have generated profiles yet.

## Accounts and timelines

Noodle can contain these account types:

- **Personas** are the accounts you control. Use the account switcher to post and interact as a different persona.
- **Invited characters** can appear in generated posts and interactions. Characters may be invited directly or included through selected character folders.
- **Professor Mari** is a built-in Noodle account and does not need a character card.
- **Random users** are optional ambient fictional profiles that make the network feel populated.

The main timeline includes generated and manually created activity. The following timeline limits the feed to accounts followed by the active persona. Search opens account search together with **Who to follow**, while Notifications collects replies and other relevant activity. Selecting a reply notification opens the related post so it can be liked or answered in context.

## Posting and interacting

The active persona can:

- Create text and image posts.
- Attach an uploaded image, GIF, emoji, or sticker.
- Mention invited characters by typing `@` and choosing an account from the mention suggestions.
- Create a poll with two to four unique options.
- Vote in a poll and change the selected option.
- Like, repost, follow, reply to a post, and reply directly to another comment.
- Like replies and attach media to a reply.

Generated characters can also create posts and polls, mention one another, vote in polls, reply, like, repost, and follow accounts. Mentions are rendered as clickable Noodle account links and are included when Marinara decides which characters an activity digest concerns.

Click or tap a timeline image to open the full-size media viewer. The viewer also provides a download action.

## Mobile navigation

Noodle uses a mobile-only navigation layout on narrow screens:

- The Noodle logo is centered in the timeline header.
- The active persona avatar in the upper-left opens a full-screen Noodle drawer below Marinara Engine's top bar.
- The drawer provides **Home**, **Profile**, **Settings**, and **Post**, with persona switching at the bottom.
- A compact bottom bar remains pinned while viewing the timeline, profile, settings, search, and notifications.
- **Home** returns to the timeline and scrolls it to the top. **Search** opens account search and **Who to follow**. **Notifications** opens Noodle notifications.
- Profile, Settings, Search, and Notifications provide a back arrow to return to the timeline.

These navigation changes apply only to the mobile layout. The desktop Noodle layout retains its multi-column navigation.

## Timeline generation

Choose **Refresh now** for an immediate generation. Noodle sends the selected model a structured request containing:

- The active persona.
- The eligible character and random-user profiles selected for this refresh.
- Recent opted-in chat context.
- Existing activity from the current day, so the model can continue conversations instead of blindly duplicating them.
- Per-refresh limits for posts, replies, reposts, likes, images, and other activity.

The model returns structured JSON containing posts, interactions, follows, activity digests, and optional polls or poll votes. Marinara validates that response before saving it. Invalid accounts, missing targets, duplicate or malformed poll options, and other unusable records are rejected or skipped rather than being written directly to the timeline.

### Older timeline memories

Noodle retains long-term continuity beyond the recent timeline. When older posts exist, each refresh has a 50% chance to recall between one and three randomly selected posts that are more than 48 hours old. The model may naturally remember, revisit, like, repost, reply to, or build on those posts, but it is explicitly told not to force a reference.

Only the older posts sampled for that refresh are valid interaction targets. Unsampled history is not exposed to the model, and no refresh receives more than three older memory items.

### Active account selection

**Settings -> Active Accounts** controls how many eligible accounts participate in one refresh:

- **All** uses the full eligible pool.
- **Random range** chooses a random count between the configured minimum and maximum.
- **Exact** uses the configured fixed count.

Directly invited characters are prioritized for suggestions and generated activity. The **Activity** settings cap the number of generated posts, replies, reposts, and likes created by one refresh.

## Automatic refresh schedule

Set **Refreshes/day** from `0` to `24` under **Settings -> Refresh**. A value of `0` disables automatic refreshes.

For each local day, Marinara divides the day into an equal number of windows and chooses one randomized time inside each window. Each time is kept away from the exact window boundaries to reduce clustering. The resulting schedule is stored for the day and shown with its timezone under **Automatic schedule**.

Use the pencil beside a future slot to choose a different hour. Completed slots, past times, duplicate times, and times outside the current local day cannot be selected. Changing the refresh count creates a schedule for the new count while preserving as much same-day completion state as possible.

Automatic generation runs in the Marinara server process, so the Noodle page does not need to remain open, but Marinara itself must be running. If a refresh cannot run, the schedule shows the error and retries later. Busy requests retry quickly, rate limits and configuration errors wait longer, and repeated generation failures use an increasing delay. If several scheduled slots become overdue, one successful catch-up refresh can consume those overdue slots rather than flooding the timeline with several back-to-back generations.

## Image generation

Enable **Generate post images** under **Settings -> Image Generation**, then select an image-generation connection. The text model may request an image for a generated post; Marinara converts that request into a full image prompt, runs the selected provider, stores the resulting image locally, and attaches it to the post.

The available controls are:

- **Prompt instructions** adds Noodle-specific instructions to the image prompt template.
- **Use avatar references** sends available account references to providers that support them.
- **Include character descriptions** adds the relevant character appearance information.
- **Images/day** caps generated Noodle images for the local day.
- **Allow Gallery attachments** lets the generator attach a relevant existing Gallery image instead of creating a new one.

Professor Mari has no character card. When she authors an image post, Noodle can use her built-in avatar and a built-in chibi reference so the image provider still receives identity guidance.

Noodle images pass through the normal image style-profile compiler. See [Image Generation](IMAGE_GENERATION.md) for provider setup, style profiles, prompt cleanup, and final prompt review.

## Chat context and carryover

Noodle context can move in two independent directions.

### Chat to Noodle

Open a chat's settings and enable **Allow Noodle references**. A later Noodle refresh may then receive recent messages from that chat, together with the chat name, mode, and participants. Chats are excluded by default, and disabling the switch prevents that chat from being used as Noodle generation context.

This setting is useful when characters should post about a recent conversation. It does not publish the transcript verbatim or guarantee that the model will reference it.

### Noodle to chats

Under **Noodle Settings -> Carryover**, enable one or more target modes:

- Conversation
- Roleplay
- Game

The **Carryover hours** and **Maximum items** fields control how much recent, relevant Noodle activity may be added to a chat prompt. Marinara filters activity digests to the personas and characters participating in that chat before building a **Recent Social Media Activity** context block.

The two directions are configured separately. Enabling Noodle carryover for Conversation Mode does not automatically let that conversation feed context back into Noodle; **Allow Noodle references** must also be enabled on the chat if both directions are wanted.

## Prompt source map for maintainers

Noodle currently has two inline text-generation prompts and one registered image prompt override.

| Purpose                                                     | Source                                                             | Main symbol                                     | How to customize                                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Timeline posts, replies, follows, polls, votes, and digests | `packages/server/src/routes/noodle.routes.ts`                      | `buildRefreshPrompt()`                          | Edit the inline system and context messages in code.                                                                                  |
| First-time character account profiles                       | `packages/server/src/routes/noodle.routes.ts`                      | `generateMissingNoodleProfiles()`               | Edit the inline system and user messages in code.                                                                                     |
| Generated post image prompt                                 | `packages/server/src/services/prompt-overrides/registry/noodle.ts` | `NOODLE_IMAGE_POST` (`noodle.imagePost`)        | Edit **Settings -> Generations -> Image Generation Prompt Overrides -> Noodle Post Image**, or change the registered default in code. |
| Default Noodle-specific image instructions                  | `packages/shared/src/schemas/noodle.schema.ts`                     | `DEFAULT_NOODLE_SETTINGS.imageGenerationPrompt` | Change the Noodle setting in the UI or its schema default in code.                                                                    |
| Opted-in chat context inserted into timeline generation     | `packages/server/src/routes/noodle.routes.ts`                      | `buildOptedInChatContext()`                     | Change the context assembly in code; user opt-in remains in each chat's settings.                                                     |
| Noodle activity inserted into chat prompts                  | `packages/server/src/services/noodle/noodle-context.ts`            | `buildRecentSocialMediaActivityBlock()`         | Change filtering or block assembly in code; users control target modes and limits in Noodle Settings.                                 |
| Generated JSON contract                                     | `packages/shared/src/schemas/noodle.schema.ts`                     | `noodleGeneratedRefreshSchema`                  | Change only alongside the prompt, route processing, shared types, and regression coverage.                                            |

The timeline and profile prompts are not currently listed in the Prompt Overrides UI. The **Noodle Post Image** template is the only Noodle generation prompt exposed there. The Noodle-local **Prompt instructions** field is passed into that image template; it does not modify the timeline-writing prompt.

The image route loads `NOODLE_IMAGE_POST`, then passes the result through `compileImagePrompt()` before sending it to the image provider. This means the final request can also be affected by the selected image style profile and connection defaults.

### Inspecting final prompts

A manual refresh requested with Debug Mode enabled logs the final profile and timeline model messages through the shared server logger. Look for:

```text
[debug/noodle] Profile prompt sent to model
[debug/noodle] Prompt sent to model
```

For images, enable **Expose image prompts before sending** under **Settings -> Generations -> Image Generation** to inspect and edit the final compiled positive and negative prompts before the request is sent.

Prompt assembly is a high-risk compatibility boundary. When editing it, keep the prompt, `noodleGeneratedRefreshSchema`, route processing, and the Noodle mention/poll regressions aligned. Run at least:

```bash
pnpm check
pnpm regression:prompt
```

## Resetting the timeline

**Settings -> Reset Noodle -> Reset Noodle Timeline** clears timeline activity, interactions, digests, and refresh history. It keeps Noodle account profiles, follows, invites, and settings so the network can be regenerated without repeating the entire setup.

## Troubleshooting

### Refresh now does not generate anything

- Select a text **Generation connection** under Noodle Settings.
- Invite at least one character, select a character folder, or enable random users.
- Confirm the connection itself can generate text.
- Review any error shown in the Refresh section.

### Automatic refreshes are not happening

- Set **Refreshes/day** above `0`.
- Keep the Marinara server running.
- Check the listed timezone and planned times.
- If the schedule says it is waiting, fix the displayed connection, rate-limit, or generation error and allow the retry to run.

### Generated posts do not reference a recent chat

- Enable **Allow Noodle references** in that chat's settings.
- Make sure the relevant character is invited and eligible for the refresh.
- Remember that eligible context is guidance, not a guarantee that every refresh will mention it.

### Noodle activity does not appear in chats

- Enable the target chat mode under **Noodle Settings -> Carryover**.
- Increase **Carryover hours** if the relevant activity is too old.
- Confirm the chat contains a persona or invited character associated with the activity digest.

### Generated posts have no images

- Enable Noodle post image generation.
- Select a valid image-generation connection.
- Check whether the daily Noodle image limit has been reached.
- If using Gallery attachments, make sure a relevant image exists and Gallery attachments are allowed.
