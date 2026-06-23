import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultImageStyleProfileSettings,
  normalizeImageStyleProfileSettings,
} from "../../../../../shared/src/constants/image-style-profiles.js";
import { mergeNegativePrompt } from "../../../../../shared/src/constants/image-generation-defaults.js";
import { compileImagePrompt } from "../../../../../shared/src/utils/image-prompt-compiler.js";
import {
  buildBackgroundProviderPrompt,
  buildSceneIllustrationProviderPrompt,
  buildNpcPortraitProviderPrompt,
} from "../../game/game-asset-generation.js";

function estimatePromptTokens(value: string): number {
  const tokens = value.trim().match(/<[^>]+>|[\p{L}\p{N}_'-]+|[^\s\p{L}\p{N}]/gu) ?? [];
  return tokens.reduce((count, token) => count + Math.max(1, Math.ceil(token.length / 8)), 0);
}

test("compileImagePrompt dedupes tags and moves simple negative fragments", () => {
  const settings = createDefaultImageStyleProfileSettings();
  const compiled = compileImagePrompt({
    kind: "portrait",
    prompt:
      "Create a portrait of Mira, anime style, best quality, high quality, detailed eyes. Avoid blurry, text, watermark. no extra fingers",
    styleProfiles: settings,
    styleProfileId: "danbooru",
  });

  assert.match(compiled.prompt, /detailed eyes/);
  assert.doesNotMatch(compiled.prompt, /\bMira\b/);
  assert.doesNotMatch(compiled.prompt, /\btext\b/);
  assert.doesNotMatch(compiled.prompt, /\bwatermark\b/);
  assert.doesNotMatch(compiled.prompt, /\bAvoid\b/i);
  assert.match(compiled.negativePrompt, /extra fingers/);
  assert.match(compiled.negativePrompt, /text/);
  assert.ok(compiled.diagnostics.removedPositiveDuplicates.length > 0);
  assert.ok(compiled.diagnostics.movedNegativeFragments.length > 0);
});

test("compileImagePrompt never leaves avoid artifact instructions in positive tags", () => {
  const settings = createDefaultImageStyleProfileSettings();
  const compiled = compileImagePrompt({
    kind: "avatar",
    prompt: "detailed armor and ruined landscapes, one face, avoid captions, avoid UI, avoid watermarks, avoid logos",
    styleProfiles: settings,
    styleProfileId: "photorealistic",
    imageDefaults: {
      version: 1,
      service: "automatic1111",
      seed: -1,
      automatic1111: {
        promptPrefix: "<lora:dmd2_sdxl_4step_lora_fp16:1>",
        negativePromptPrefix: "",
        sampler: "Euler a",
        scheduler: "",
        steps: 20,
        cfgScale: 7,
        clipSkip: null,
        restoreFaces: false,
        denoisingStrength: 0.6,
      },
    },
  });

  assert.doesNotMatch(compiled.prompt, /\bavoid\b/i, compiled.prompt);
  assert.doesNotMatch(compiled.prompt, /\b(?:captions?|ui|watermarks?|logos?)\b/i, compiled.prompt);
  assert.match(compiled.negativePrompt, /captions/);
  assert.match(compiled.negativePrompt, /UI/i);
  assert.match(compiled.negativePrompt, /watermarks/);
  assert.match(compiled.negativePrompt, /logos/);
});

test("compileImagePrompt preserves a source fallback when a custom tagged profile produces no tags", () => {
  const settings = normalizeImageStyleProfileSettings({
    defaultProfileId: "custom-empty",
    profiles: [
      {
        id: "custom-empty",
        name: "Custom Empty",
        baseStyle: "custom",
        promptMode: "tagged",
        styleText: "",
        positiveTags: "",
        negativeTags: "",
        subjectTags: {},
        rules: {
          dedupeStrength: "normal",
          preferTagsOverNarrative: true,
          preserveUserPhrases: true,
        },
      },
    ],
  });
  const compiled = compileImagePrompt({
    kind: "avatar",
    prompt: "A mysterious person smiling beside an unusual red vehicle. Avoid watermark.",
    styleProfiles: settings,
    styleProfileId: "custom-empty",
  });

  assert.match(compiled.prompt, /mysterious person/i);
  assert.doesNotMatch(compiled.prompt, /\bavoid\b|\bwatermark\b/i);
  assert.match(compiled.negativePrompt, /watermark/i);
});

test("normalizeImageStyleProfileSettings derives built-in status instead of trusting synced data", () => {
  const settings = normalizeImageStyleProfileSettings({
    defaultProfileId: "custom",
    profiles: [
      {
        id: "custom",
        name: "Custom",
        builtIn: true,
      },
      {
        id: "anime",
        name: "Edited Anime",
        builtIn: false,
      },
    ],
  });

  assert.equal(settings.profiles.find((profile) => profile.id === "custom")?.builtIn, false);
  assert.equal(settings.profiles.find((profile) => profile.id === "anime")?.builtIn, true);
});

test("compileImagePrompt preserves Z-Image Turbo narrative phrasing", () => {
  const settings = createDefaultImageStyleProfileSettings();
  const compiled = compileImagePrompt({
    kind: "illustration",
    prompt: "A moonlit courtyard where Mira reaches for a glowing door, no watermark",
    styleProfiles: settings,
    styleProfileId: "z-image-turbo",
  });

  assert.equal(compiled.profile.id, "z-image-turbo");
  assert.match(compiled.prompt, /moonlit courtyard/);
  assert.match(compiled.prompt, /glowing door/);
  assert.match(compiled.negativePrompt, /watermark/);
});

test("compileImagePrompt strips illustrator narrative moment labels from gallery prompts", () => {
  const settings = createDefaultImageStyleProfileSettings();
  const compiled = compileImagePrompt({
    kind: "illustration",
    prompt: [
      "Fantasy anime illustration, warm cinematic lighting, rich saturated colors, soft painterly shading.",
      "Major character moment - protagonist seeing transformed self in academy uniform for the first time, emotional self-recognition scene.",
      "Maeve O'Riordan's POV looking at herself in a full-length ornate academy mirror inside dorm room 213.",
      "She wears a fitted structured blazer buttoned neatly from collar to waist, a snug pleated skirt ending above the knees, and knee-high socks.",
    ].join(" "),
    styleProfiles: settings,
    styleProfileId: "photorealistic",
  });

  assert.doesNotMatch(compiled.prompt, /major character moment/i, compiled.prompt);
  assert.match(compiled.prompt, /protagonist seeing transformed self/i, compiled.prompt);
  assert.match(compiled.prompt, /academy uniform|structured blazer|pleated skirt/i, compiled.prompt);
});

test("scene illustration prompts include visual title context when the scene prompt is vague", async () => {
  const settings = createDefaultImageStyleProfileSettings();
  const compiled = await buildSceneIllustrationProviderPrompt({
    chatId: "chat-1",
    title: "Protagonist seeing transformed self in academy mirror",
    prompt: "Emotional self-recognition scene with warm light and cinematic composition.",
    reason: "major character moment",
    slug: "mirror-self-recognition",
    genre: "fantasy",
    setting: "academy dorm room",
    artStyle: "anime illustration",
    imgModel: "sdxl",
    imgBaseUrl: "http://127.0.0.1:7860",
    imgApiKey: "",
    styleProfiles: settings,
    styleProfileId: "photorealistic",
  });

  assert.doesNotMatch(compiled.prompt, /visual subject context|major character moment/i, compiled.prompt);
  assert.match(compiled.prompt, /Protagonist seeing transformed self/i, compiled.prompt);
  assert.match(compiled.prompt, /academy mirror/i, compiled.prompt);
  assert.match(compiled.prompt, /Emotional self-recognition scene/i, compiled.prompt);
});

test("compileImagePrompt distills verbose avatar source prompts when tag grammar is selected", () => {
  const settings = createDefaultImageStyleProfileSettings();
  const compiled = compileImagePrompt({
    kind: "avatar",
    prompt: [
      "Create a polished character avatar portrait for Cricket.",
      "Canonical appearance: Cricket.",
      "Type: Main character.",
      "Species: Human.",
      "Appearance: Short brown hair, grey eyes.",
      "Personality: Optimistic, scatterbrained, dramatic.",
      "Traits: Exceptionally unlucky, clumsy, total idiot.",
      "Occupation: Owner (and sole employee) of the Triple A Adventuring Agency.",
      "Skills: Cooking, peeling potatoes, lifting heavy boxes. No actual talents.",
      "Equipment: Leather armor, shortsword.",
      "Goal: To create the most successful adventuring agency in all of Sharn!",
      "No matter how hard she tries she can't seem to catch a break.",
      "Background: Cricket was born in Eston, Cyre and moved to Sharn as a refugee after the Mourning.",
      "She joined the army and hoped she would be better with a sword than spells.",
      "The debt collectors let her know in no uncertain terms that they want their money.",
      "She is still determined to build her agency.",
      "Composition: centered face-and-shoulders portrait, readable expression, clear silhouette, suitable as a chat avatar.",
    ].join(" "),
    styleProfiles: settings,
    styleProfileId: "photorealistic",
    imageDefaults: {
      version: 1,
      service: "automatic1111",
      seed: -1,
      automatic1111: {
        promptPrefix: "<lora:dmd:1>",
        negativePromptPrefix: "",
        sampler: "Euler a",
        scheduler: "",
        steps: 20,
        cfgScale: 7,
        clipSkip: null,
        restoreFaces: false,
        denoisingStrength: 0.6,
      },
    },
  });

  assert.match(compiled.prompt, /<lora:dmd:1>/);
  assert.match(compiled.prompt, /Short brown hair/);
  assert.match(compiled.prompt, /Human/);
  assert.match(compiled.prompt, /grey eyes/);
  assert.match(compiled.prompt, /Leather armor/);
  assert.match(compiled.prompt, /young adult/);
  assert.ok(estimatePromptTokens(compiled.prompt) <= 75, compiled.prompt);
  assert.ok(compiled.prompt.split(", ").length >= 14, compiled.prompt);
  assert.equal(compiled.prompt.split(", ")[0], "<lora:dmd:1>", compiled.prompt);
  // The subject/species tag leads the appearance details; gender is no longer
  // guessed from pronouns (see doesNotMatch /female/ below).
  assert.ok(compiled.prompt.indexOf("Human") < compiled.prompt.indexOf("Short brown hair"), compiled.prompt);
  assert.doesNotMatch(compiled.prompt, /female/);
  assert.doesNotMatch(compiled.prompt, /Cricket,/);
  assert.doesNotMatch(compiled.prompt, /Photorealistic SDXL image/);
  assert.doesNotMatch(compiled.prompt, /Background:/);
  assert.doesNotMatch(compiled.prompt, /Personality:/);
  assert.doesNotMatch(compiled.prompt, /Goal:/);
  assert.doesNotMatch(compiled.prompt, /refugee/);
  assert.doesNotMatch(compiled.prompt, /hoped/);
  assert.doesNotMatch(compiled.prompt, /spells/);
  assert.doesNotMatch(compiled.prompt, /uncertain/);
  assert.doesNotMatch(compiled.prompt, /agency/);
  assert.doesNotMatch(compiled.prompt, /\.\s+[A-Z]/);
  assert.doesNotMatch(compiled.negativePrompt, /actual talents/);
  assert.doesNotMatch(compiled.negativePrompt, /matter how hard/);
});

test("compileImagePrompt converts character-card appearance prose into compact avatar tags", () => {
  const settings = createDefaultImageStyleProfileSettings();
  const compiled = compileImagePrompt({
    kind: "avatar",
    prompt:
      "Veronica is in her early forties, tall and statuesque at 5'10\", with an upright, commanding posture. " +
      "Her dark auburn hair is swept into an elegant updo with a few deliberate loose strands framing sharp cheekbones. " +
      "Her eyes are a piercing hazel-green, framed by subtle smoky makeup that lends her gaze a hypnotic intensity. " +
      "She favors tailored, sophisticated attire - a fitted black blazer over a deep burgundy blouse, slim trousers, and polished heeled boots - accented with a single statement ring and reading glasses she often perches at the tip of her nose. " +
      "Her nails are immaculate and lacquered dark red, and she moves with the unhurried grace of someone perfectly aware she holds the room.",
    styleProfiles: settings,
    styleProfileId: "photorealistic",
    imageDefaults: {
      version: 1,
      service: "automatic1111",
      seed: -1,
      automatic1111: {
        promptPrefix: "<lora:dmd2_sdxl_4step_lora_fp16:1>",
        negativePromptPrefix: "",
        sampler: "Euler a",
        scheduler: "",
        steps: 20,
        cfgScale: 7,
        clipSkip: null,
        restoreFaces: false,
        denoisingStrength: 0.6,
      },
    },
  });

  assert.ok(estimatePromptTokens(compiled.prompt) <= 75, compiled.prompt);
  assert.ok(compiled.prompt.split(", ").length >= 16, compiled.prompt);
  assert.equal(compiled.prompt.split(", ")[0], "<lora:dmd2_sdxl_4step_lora_fp16:1>", compiled.prompt);
  assert.match(compiled.prompt, /centered face-and-shoulders portrait/);
  assert.match(compiled.prompt, /dark auburn hair/);
  assert.match(compiled.prompt, /hazel-green eyes/);
  assert.match(compiled.prompt, /early forties|black blazer|elegant updo|smoky makeup|tall/);
  assert.doesNotMatch(compiled.prompt, /Veronica is/);
  assert.doesNotMatch(compiled.prompt, /Her eyes are/);
  assert.doesNotMatch(compiled.prompt, /holds the room/);
  assert.doesNotMatch(compiled.prompt, /\.\s+[A-Z]/);
});

test("compileImagePrompt collapses equivalent portrait composition tags from saved profiles", () => {
  const settings = createDefaultImageStyleProfileSettings();
  const photorealistic = settings.profiles.find((profile) => profile.id === "photorealistic");
  assert.ok(photorealistic);
  photorealistic.subjectTags.avatar = "single subject, centered realistic avatar portrait";

  const compiled = compileImagePrompt({
    kind: "avatar",
    prompt: "female, centered face-and-shoulders portrait, grey eyes, dark auburn hair, black blazer",
    styleProfiles: settings,
    styleProfileId: "photorealistic",
    imageDefaults: {
      version: 1,
      service: "automatic1111",
      seed: -1,
      automatic1111: {
        promptPrefix: "<lora:dmd2_sdxl_4step_lora_fp16:1>",
        negativePromptPrefix: "",
        sampler: "Euler a",
        scheduler: "",
        steps: 20,
        cfgScale: 7,
        clipSkip: null,
        restoreFaces: false,
        denoisingStrength: 0.6,
      },
    },
  });

  assert.match(compiled.prompt, /centered face-and-shoulders portrait|centered realistic avatar portrait/);
  assert.match(compiled.prompt, /grey eyes/);
  assert.match(compiled.prompt, /dark auburn hair/);
  assert.match(compiled.prompt, /black blazer/);
  assert.ok(
    !(
      compiled.prompt.includes("centered face-and-shoulders portrait") &&
      compiled.prompt.includes("centered realistic avatar portrait")
    ),
    compiled.prompt,
  );
  assert.ok(compiled.diagnostics.removedPositiveDuplicates.includes("centered realistic avatar portrait"));
});

test("compileImagePrompt resolves style precedence from global, connection, then explicit chat/game profile", () => {
  const settings = createDefaultImageStyleProfileSettings();
  settings.defaultProfileId = "anime";
  const imageDefaults = {
    version: 1 as const,
    service: "automatic1111" as const,
    seed: -1,
    styleProfileId: "photorealistic",
    automatic1111: {
      promptPrefix: "",
      negativePromptPrefix: "",
      sampler: "Euler a",
      scheduler: "",
      steps: 20,
      cfgScale: 7,
      clipSkip: null,
      restoreFaces: false,
      denoisingStrength: 0.6,
    },
  };

  const globalCompiled = compileImagePrompt({
    kind: "portrait",
    prompt: "short brown hair, grey eyes",
    styleProfiles: settings,
  });
  const connectionCompiled = compileImagePrompt({
    kind: "portrait",
    prompt: "short brown hair, grey eyes",
    styleProfiles: settings,
    imageDefaults,
  });
  const explicitCompiled = compileImagePrompt({
    kind: "portrait",
    prompt: "short brown hair, grey eyes",
    styleProfiles: settings,
    styleProfileId: "z-image-turbo",
    imageDefaults,
  });

  assert.equal(globalCompiled.profile.id, "anime");
  assert.equal(connectionCompiled.profile.id, "photorealistic");
  assert.equal(explicitCompiled.profile.id, "z-image-turbo");
});

test("compileImagePrompt includes local backend negative prefixes exactly once", () => {
  const settings = createDefaultImageStyleProfileSettings();
  const compiled = compileImagePrompt({
    kind: "portrait",
    prompt: "female, grey eyes, leather armor",
    styleProfiles: settings,
    styleProfileId: "photorealistic",
    imageDefaults: {
      version: 1,
      service: "automatic1111",
      seed: -1,
      automatic1111: {
        promptPrefix: "",
        negativePromptPrefix: "bad anatomy, extra fingers",
        sampler: "Euler a",
        scheduler: "",
        steps: 20,
        cfgScale: 7,
        clipSkip: null,
        restoreFaces: false,
        denoisingStrength: 0.6,
      },
    },
  });

  assert.match(compiled.negativePrompt, /^bad anatomy, extra fingers\b/);
  assert.equal(
    mergeNegativePrompt("bad anatomy, extra fingers", compiled.negativePrompt),
    compiled.negativePrompt,
  );
});

test("game asset reviewed prompts are final provider prompts after confirmation", async () => {
  const settings = createDefaultImageStyleProfileSettings();
  const baseReq = {
    chatId: "chat-1",
    locationSlug: "sunlit-market",
    sceneDescription: "A sunlit market square with colorful awnings and cobblestones.",
    genre: "fantasy",
    setting: "city",
    artStyle: "cinematic",
    imgModel: "sdxl",
    imgBaseUrl: "http://127.0.0.1:7860",
    imgApiKey: "",
    styleProfiles: settings,
    styleProfileId: "photorealistic",
  };

  const preview = await buildBackgroundProviderPrompt(baseReq);
  const generated = await buildBackgroundProviderPrompt({
    ...baseReq,
    promptOverride: preview.prompt,
    negativePromptOverride: preview.negativePrompt,
  });

  assert.equal(generated.prompt, preview.prompt);
  assert.equal(generated.negativePrompt, preview.negativePrompt);
});

test("background prompts keep world and location context for generic scene requests", async () => {
  const settings = createDefaultImageStyleProfileSettings();
  const compiled = await buildBackgroundProviderPrompt({
    chatId: "chat-1",
    locationSlug: "field",
    sceneDescription: "A quiet field beside a dirt path.",
    genre: "medieval fantasy",
    setting: "low-magic frontier kingdom",
    currentLocation: "Old Barley Road outside Willowmere",
    currentWeather: "overcast",
    currentTimeOfDay: "evening",
    worldOverview: "A feudal borderland of old keeps, village shrines, and dangerous woods.",
    artStyle: "cinematic",
    imgModel: "sdxl",
    imgBaseUrl: "http://127.0.0.1:7860",
    imgApiKey: "",
    styleProfiles: settings,
    styleProfileId: "photorealistic",
  });

  assert.match(compiled.prompt, /medieval fantasy/i, compiled.prompt);
  assert.match(compiled.prompt, /frontier kingdom/i, compiled.prompt);
  assert.match(compiled.prompt, /Old Barley Road|Willowmere/i, compiled.prompt);
  assert.match(compiled.prompt, /field/i, compiled.prompt);
  assert.doesNotMatch(compiled.prompt, /\bmodern\b/i, compiled.prompt);
});

test("game asset reviewed prompts are not silently truncated after confirmation", async () => {
  const settings = createDefaultImageStyleProfileSettings();
  const longPrompt = `foreground subject, ${"ornate detail, ".repeat(120)}final detail`;
  const generated = await buildBackgroundProviderPrompt({
    chatId: "chat-1",
    locationSlug: "long-reviewed-prompt",
    sceneDescription: "unused once override is present",
    imgModel: "sdxl",
    imgBaseUrl: "http://127.0.0.1:7860",
    imgApiKey: "",
    styleProfiles: settings,
    styleProfileId: "photorealistic",
    promptOverride: longPrompt,
    negativePromptOverride: "text, watermark",
  });

  assert.equal(generated.prompt, longPrompt);
  assert.equal(generated.negativePrompt, "text, watermark");
});

test("legacy NPC portrait path compiles defaults without a review override", async () => {
  const settings = createDefaultImageStyleProfileSettings();
  const compiled = await buildNpcPortraitProviderPrompt({
    chatId: "chat-1",
    npcName: "Cricket",
    appearance: "Human woman with short brown hair, grey eyes, leather armor, shortsword.",
    imgModel: "sdxl",
    imgBaseUrl: "http://127.0.0.1:7860",
    imgApiKey: "",
    styleProfiles: settings,
    styleProfileId: "photorealistic",
  });

  assert.match(compiled.prompt, /female/i);
  assert.match(compiled.prompt, /grey eyes/i);
  assert.match(compiled.negativePrompt, /text/);
  assert.doesNotMatch(compiled.prompt, /Cricket,/);
});

test("sparse NPC portrait prompts do not leak name-only instruction scaffolding", async () => {
  const settings = createDefaultImageStyleProfileSettings();
  const compiled = await buildNpcPortraitProviderPrompt({
    chatId: "chat-1",
    npcName: "M",
    appearance: "",
    artStyle: "realistic",
    imgModel: "sdxl",
    imgBaseUrl: "http://127.0.0.1:7860",
    imgApiKey: "",
    styleProfiles: settings,
    styleProfileId: "photorealistic",
    imgDefaults: {
      version: 1,
      service: "automatic1111",
      seed: -1,
      automatic1111: {
        promptPrefix: "<lora:dmd2_sdxl_4step_lora_fp16:1>",
        negativePromptPrefix: "",
        sampler: "Euler a",
        scheduler: "",
        steps: 20,
        cfgScale: 7,
        clipSkip: null,
        restoreFaces: false,
        denoisingStrength: 0.6,
      },
    },
  });

  assert.doesNotMatch(compiled.prompt, /\bportrait\s+(?:of|for)\s+M\b/i, compiled.prompt);
  assert.doesNotMatch(compiled.prompt, /\bNPC portrait\b/i, compiled.prompt);
  assert.match(compiled.prompt, /\badult\b/i, compiled.prompt);
  assert.match(compiled.prompt, /\bandrogynous\b/i, compiled.prompt);
  assert.match(compiled.prompt, /\bhuman\b/i, compiled.prompt);
  assert.match(compiled.prompt, /single subject|one face/i, compiled.prompt);
});

test("sparse NPC portrait prompts preserve explicit gender and pronoun cues", async () => {
  const settings = createDefaultImageStyleProfileSettings();
  const compiled = await buildNpcPortraitProviderPrompt({
    chatId: "chat-1",
    npcName: "M",
    appearance: "M appears in the current scene.",
    gender: "female",
    pronouns: "she/her",
    artStyle: "realistic",
    imgModel: "sdxl",
    imgBaseUrl: "http://127.0.0.1:7860",
    imgApiKey: "",
    styleProfiles: settings,
    styleProfileId: "photorealistic",
  });

  assert.match(compiled.prompt, /\badult\b/i, compiled.prompt);
  assert.match(compiled.prompt, /\bfemale\b/i, compiled.prompt);
  assert.match(compiled.prompt, /\bhuman\b/i, compiled.prompt);
  assert.doesNotMatch(compiled.prompt, /\bportrait\s+(?:of|for)\s+M\b/i, compiled.prompt);
});

test("NPC portrait prompts can infer age and visual attributes from biography text", async () => {
  const settings = createDefaultImageStyleProfileSettings();
  const compiled = await buildNpcPortraitProviderPrompt({
    chatId: "chat-1",
    npcName: "Cricket",
    appearance:
      "Short brown hair, grey eyes. Cricket joined the army after being expelled from the academy, survived as a refugee, opened an adventuring agency, and now needs to pay off debt.",
    pronouns: "she/her",
    artStyle: "realistic",
    imgModel: "sdxl",
    imgBaseUrl: "http://127.0.0.1:7860",
    imgApiKey: "",
    styleProfiles: settings,
    styleProfileId: "photorealistic",
  });

  assert.match(compiled.prompt, /\byoung adult\b/i, compiled.prompt);
  assert.match(compiled.prompt, /\bfemale\b/i, compiled.prompt);
  assert.match(compiled.prompt, /short brown hair/i, compiled.prompt);
  assert.match(compiled.prompt, /grey eyes/i, compiled.prompt);
  assert.doesNotMatch(compiled.prompt, /\bCricket,/i, compiled.prompt);
});
