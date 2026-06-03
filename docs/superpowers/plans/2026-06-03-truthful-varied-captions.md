# Truthful, Varied Caption & Hook Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop captions/hooks from falsely claiming "my family", rotate reveal captions across three truthful framings, and generate the script at item-creation time so hook/caption are reviewable in the dashboard before render.

**Architecture:** A new pure module (`scripts/lib/caption-framing.ts`) holds the three framings and a weighted-random picker. `generate-script.ts` removes false-ownership wording from its system prompt, adds a hard truthfulness rule, and (for reveal items) injects a code-selected framing into the user prompt. The two self-source scripts (`generate-reveal-photos.ts`, `generate-tip-content.ts`) call `generateScript()` at creation with a try/catch fallback to today's unscripted `queued` behavior.

**Tech Stack:** TypeScript run via `tsx`; `@anthropic-ai/sdk` (Claude Sonnet); Supabase JS; `node:test` for pure-function unit tests.

---

## Background for the implementer

- Script generation is **one** Claude call (`generateScript` in `scripts/generate-script.ts`) that returns hook, caption, hashtags, music fields, slogan (and tip_icon for tips) as a single JSON object. Hook and caption are NOT separable — do not add a "hook-only" button or endpoint.
- The root cause of "my family" lies: the system prompt (`scripts/generate-script.ts:51-76`) says photos become "vivid family memories" and tells Claude to reference "family relationships", in a warm first-person voice. The photos are AI-invented demos, so this is false.
- Tests run with `npm test` → `node --import tsx --test scripts/lib/__tests__/*.test.ts`. **Pure functions only** (no network). `new Anthropic()` does NOT throw without an API key (verified), so importing `generate-script.ts` in a test is safe as long as you only call pure functions like `buildUserPrompt`.
- Typecheck the whole project with `npx tsc --noEmit` (≈2s, currently clean).
- Existing test style: `scripts/lib/__tests__/caption-text.test.ts` (node:test + `node:assert/strict`, relative imports).

---

## File Structure

- **Create** `scripts/lib/caption-framing.ts` — framing enum, weighted picker, instruction lookup. Pure, no I/O.
- **Create** `scripts/lib/__tests__/caption-framing.test.ts` — unit tests for the picker, the instruction lookup, and `buildUserPrompt` framing injection.
- **Modify** `scripts/generate-script.ts` — system prompt wording + truthfulness rule; `export` and extend `buildUserPrompt` with a `framing` param; select framing inside `generateScript`.
- **Modify** `scripts/generate-reveal-photos.ts` — generate script at creation (try/catch fallback).
- **Modify** `scripts/generate-tip-content.ts` — generate script at creation (try/catch fallback).

---

## Task 1: caption-framing module (TDD)

**Files:**
- Create: `scripts/lib/caption-framing.ts`
- Test: `scripts/lib/__tests__/caption-framing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/lib/__tests__/caption-framing.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickFraming, framingInstruction, type CaptionFraming } from '../caption-framing';

// Weights are third_person 0.40, capability 0.35, invitation 0.25
// → cumulative boundaries at 0.40 and 0.75.

test('pickFraming returns third_person for rng below 0.40', () => {
  assert.equal(pickFraming(() => 0.0), 'third_person');
  assert.equal(pickFraming(() => 0.39), 'third_person');
});

test('pickFraming returns capability for rng in [0.40, 0.75)', () => {
  assert.equal(pickFraming(() => 0.40), 'capability');
  assert.equal(pickFraming(() => 0.74), 'capability');
});

test('pickFraming returns invitation for rng at/above 0.75', () => {
  assert.equal(pickFraming(() => 0.75), 'invitation');
  assert.equal(pickFraming(() => 0.999), 'invitation');
});

test('pickFraming never returns an out-of-enum value across the range', () => {
  const valid = new Set<CaptionFraming>(['third_person', 'capability', 'invitation']);
  for (let i = 0; i < 100; i++) {
    const r = i / 100;
    assert.ok(valid.has(pickFraming(() => r)), `rng=${r} produced an invalid framing`);
  }
});

test('framingInstruction returns distinct, non-empty text per framing', () => {
  const a = framingInstruction('third_person');
  const b = framingInstruction('capability');
  const c = framingInstruction('invitation');
  assert.ok(a.length > 0 && b.length > 0 && c.length > 0);
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.notEqual(a, c);
});

test('framingInstruction forbids first-person ownership in the third_person voice', () => {
  assert.match(framingInstruction('third_person'), /third person/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../caption-framing'` (the module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `scripts/lib/caption-framing.ts`:

```ts
// ============================================================
// Caption Framing — picks a truthful voice for reveal captions.
//
// Reveal photos are AI-invented demos, not the poster's own family,
// so captions must never claim personal ownership. To keep the feed
// from feeling same-y, each reveal script is generated under one of
// three framings, chosen by weighted-random selection in code (each
// Claude call is stateless and can't vary itself across videos).
// Pure module — no I/O — so it is unit-testable.
// ============================================================

export type CaptionFraming = 'third_person' | 'capability' | 'invitation';

interface FramingDef {
  framing: CaptionFraming;
  weight: number; // selection probability; the weights below sum to 1.0
  instruction: string; // snippet injected into the reveal user prompt
}

// Ordered by descending weight. pickFraming walks this list accumulating
// weight, so order + weights together define the selection boundaries.
const FRAMINGS: FramingDef[] = [
  {
    framing: 'third_person',
    weight: 0.4,
    instruction:
      'Framing: THIRD-PERSON STORY. Tell the photo\'s story honestly in the third person — describe the people and the moment as someone else\'s history, never as your own. No "my"/"I" ownership ("my grandmother", "I found this"). Example hook: "Water-damaged for 60 years. Not anymore."',
  },
  {
    framing: 'capability',
    weight: 0.35,
    instruction:
      'Framing: APP CAPABILITY DEMO. Showcase what EternalFrame\'s AI does with an old, damaged photo — product-forward, factual, no personal ownership. Example hook: "Old photo → restored by AI in seconds".',
  },
  {
    framing: 'invitation',
    weight: 0.25,
    instruction:
      'Framing: VIEWER INVITATION. Speak to the viewer about THEIR own old photos and what AI restoration could do for them. Example hook: "Got photos like this in a drawer?"',
  },
];

/**
 * Weighted-random framing selection. `rng` is injectable so tests can pin
 * the result; defaults to Math.random in production.
 */
export function pickFraming(rng: () => number = Math.random): CaptionFraming {
  const r = rng();
  let cumulative = 0;
  for (const def of FRAMINGS) {
    cumulative += def.weight;
    if (r < cumulative) return def.framing;
  }
  // Fallback for r === 1 or float drift: return the last framing.
  return FRAMINGS[FRAMINGS.length - 1].framing;
}

/** The prompt snippet describing how to write in the chosen framing. */
export function framingInstruction(framing: CaptionFraming): string {
  const def = FRAMINGS.find((d) => d.framing === framing);
  if (!def) throw new Error(`Unknown caption framing: ${framing}`);
  return def.instruction;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `caption-framing` tests green (existing tests still pass too).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/caption-framing.ts scripts/lib/__tests__/caption-framing.test.ts
git commit -m "feat: add weighted caption-framing picker (pure, tested)"
```

---

## Task 2: Wire framing + truthfulness into generate-script.ts (TDD)

**Files:**
- Modify: `scripts/generate-script.ts` (system prompt `:51-76`; `buildUserPrompt` `:78-106`; `generateScript` `:108-119`)
- Test: `scripts/lib/__tests__/caption-framing.test.ts` (add cases that import `buildUserPrompt`)

- [ ] **Step 1: Write the failing test**

Append to `scripts/lib/__tests__/caption-framing.test.ts`:

```ts
import { buildUserPrompt, type ContentItem } from '../../generate-script';

test('buildUserPrompt injects the framing instruction for reveal items', () => {
  const item: ContentItem = {
    id: 'x',
    content_type: 'reveal',
    photo_era: '1960s',
    photo_story: 'A wedding photo found water-damaged.',
  };
  const prompt = buildUserPrompt(item, 'capability');
  assert.match(prompt, /APP CAPABILITY DEMO/);
});

test('buildUserPrompt for a tip item contains no framing instruction', () => {
  const item: ContentItem = {
    id: 'y',
    content_type: 'tip',
    tip_title: 'Scan at 600 DPI',
    tip_body: 'Higher DPI preserves detail for restoration.',
  };
  const prompt = buildUserPrompt(item);
  assert.doesNotMatch(prompt, /APP CAPABILITY DEMO|THIRD-PERSON STORY|VIEWER INVITATION/);
});

test('buildUserPrompt omits framing when none is passed for a reveal', () => {
  const item: ContentItem = { id: 'z', content_type: 'reveal', photo_era: '1940s' };
  const prompt = buildUserPrompt(item);
  assert.doesNotMatch(prompt, /Framing:/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `buildUserPrompt` is not exported from `generate-script.ts` (import error / "not a function").

- [ ] **Step 3a: Add the framing import to `generate-script.ts`**

In `scripts/generate-script.ts`, just below the existing `caption-text` import block (after line 17), add:

```ts
import { pickFraming, framingInstruction, type CaptionFraming } from './lib/caption-framing';
```

- [ ] **Step 3b: Replace the system prompt's family-ownership wording + add the truthfulness rule**

In `scripts/generate-script.ts`, find this line (currently line 53):

```ts
Brand voice: Warm, nostalgic, personal. Never salesy. The emotion is in the transformation — old, faded, damaged photos becoming vivid family memories.
```

Replace it with:

```ts
Brand voice: Warm, nostalgic, emotionally honest. Never salesy. The emotion is in the transformation — old, faded, damaged photos restored to vivid clarity.
```

Then find this rule line (currently line 62):

```ts
- Reference specific decades, family relationships, cultural moments when possible.
```

Replace it with:

```ts
- Reference specific decades and cultural moments when possible.
- TRUTHFULNESS (critical): These are demonstration photos showcasing the app — NOT the poster's own family. NEVER write in first person claiming personal ownership (no "my grandmother", no "I found this in my attic"). Never fabricate that the poster personally found or owns the photo. Tell the story honestly in the framing you are given.
```

- [ ] **Step 3c: Export `buildUserPrompt` and add the `framing` parameter**

In `scripts/generate-script.ts`, change the function signature (currently line 78):

```ts
function buildUserPrompt(item: ContentItem): string {
```

to:

```ts
export function buildUserPrompt(item: ContentItem, framing?: CaptionFraming): string {
```

Then, inside the `if (item.content_type === 'reveal')` branch, change the final returned template literal so it appends the framing instruction. The current return ends with:

```ts
${pairCount > 1
  ? 'The video shows multiple damaged/faded photos being revealed as AI-restored versions in sequence. Build anticipation across the series — each reveal should feel like an emotional payoff.'
  : 'The video shows the damaged/faded original photo, then dramatically reveals the AI-restored version. The transformation should feel emotional and personal.'}`;
```

Replace that closing backtick segment with one that adds the framing line:

```ts
${pairCount > 1
  ? 'The video shows multiple damaged/faded photos being revealed as AI-restored versions in sequence. Build anticipation across the series — each reveal should feel like an emotional payoff.'
  : 'The video shows the damaged/faded original photo, then dramatically reveals the AI-restored version. The transformation should feel emotional.'}${framing ? `\n\n${framingInstruction(framing)}` : ''}`;
```

(Note: also dropped the trailing "and personal" from the single-pair line so it no longer nudges toward first-person ownership.)

- [ ] **Step 3d: Select the framing inside `generateScript`**

In `scripts/generate-script.ts`, change the start of `generateScript` (currently lines 108-119). Current:

```ts
export async function generateScript(item: ContentItem): Promise<GeneratedScript> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: buildUserPrompt(item),
      },
    ],
    system: SYSTEM_PROMPT,
  });
```

Replace with:

```ts
export async function generateScript(item: ContentItem): Promise<GeneratedScript> {
  // Reveal captions rotate across truthful framings; tips keep their
  // educational voice and are not framed.
  const framing = item.content_type === 'reveal' ? pickFraming() : undefined;
  if (framing) console.log(`  Caption framing: ${framing}`);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: buildUserPrompt(item, framing),
      },
    ],
    system: SYSTEM_PROMPT,
  });
```

- [ ] **Step 4: Run the tests + typecheck to verify they pass**

Run: `npm test`
Expected: PASS — the three new `buildUserPrompt` tests pass and all earlier tests stay green.

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-script.ts scripts/lib/__tests__/caption-framing.test.ts
git commit -m "feat: truthful system prompt + rotate reveal caption framing"
```

---

## Task 3: Generate script at creation for reveal items

**Files:**
- Modify: `scripts/generate-reveal-photos.ts` (import at `:18-26`; insert block at `:181-200`)

No unit test — this path makes a live Claude + Supabase call (repo convention: unit tests cover pure functions only). Verified by typecheck + manual run (see Step 4).

- [ ] **Step 1: Add the `generateScript` import**

In `scripts/generate-reveal-photos.ts`, after the existing `image-prompts` import block (after line 26), add:

```ts
import { generateScript } from './generate-script';
```

- [ ] **Step 2: Replace the insert block with creation-time scripting**

In `scripts/generate-reveal-photos.ts`, replace this block (currently lines 181-200):

```ts
  const first = subjects[0];
  const { data, error } = await supabase
    .from('tiktok_content_pool')
    .insert({
      content_type: 'reveal',
      status: 'queued',
      image_pairs: imagePairs,
      photo_era: first.era,
      photo_story: first.story,
      preset_used: 'full-enhancement',
      generation_meta: {
        hint: opts.hint ?? null,
        damageNotes: opts.damageNotes ?? null,
        source: opts.source ?? null,
      },
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to insert content item: ${error.message}`);
```

with:

```ts
  const first = subjects[0];

  // Base row: an unscripted queued item (the original behavior, kept as the
  // fallback if script generation fails below).
  const insertRow: Record<string, unknown> = {
    content_type: 'reveal',
    status: 'queued',
    image_pairs: imagePairs,
    photo_era: first.era,
    photo_story: first.story,
    preset_used: 'full-enhancement',
    generation_meta: {
      hint: opts.hint ?? null,
      damageNotes: opts.damageNotes ?? null,
      source: opts.source ?? null,
    },
  };

  // Generate the script now so the item lands in the dashboard already
  // scripted (hook/caption reviewable before render). Same ContentItem shape
  // that render-video.ts ensureScript() uses, so "Regen Script" reproduces it.
  // On failure we keep the queued row — ensureScript() backfills at render.
  try {
    console.log('  Generating AI script...');
    const script = await generateScript({
      id: 'pending',
      content_type: 'reveal',
      photo_era: first.era,
      photo_story: first.story,
      preset_used: 'full-enhancement',
      pair_count: imagePairs.length,
      photo_stories: imagePairs.map((p, i) => `Pair ${i + 1}: ${p.era || 'unknown era'}`),
    });
    Object.assign(insertRow, {
      hook_text: script.hook_text,
      caption: script.caption,
      hashtags: script.hashtags,
      music_track: script.music_mood,
      music_style: script.music_style,
      slogan: script.slogan,
      status: 'scripted',
    });
  } catch (err) {
    console.warn(
      `  ⚠️  Script generation failed, leaving item queued: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const { data, error } = await supabase
    .from('tiktok_content_pool')
    .insert(insertRow)
    .select('id')
    .single();

  if (error) throw new Error(`Failed to insert content item: ${error.message}`);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean).

Run: `npm test`
Expected: PASS (unchanged — this task adds no tests but must not break existing ones).

- [ ] **Step 4 (manual verification — requires .env with real keys):**

Run: `npm run generate:photos`
Expected: console shows `Generating AI script...` then `Caption framing: <one of third_person|capability|invitation>`, and the final summary prints a content id. In the dashboard editor for that item, HOOK TEXT and CAPTION are populated (non-zero counters) and the caption does NOT say "my family"/"my grandmother". Status is `scripted`.

> If you cannot run live (no keys), state that explicitly and rely on the typecheck. Do not claim the manual step passed without running it.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-reveal-photos.ts
git commit -m "feat: script reveal items at creation (fallback to queued)"
```

---

## Task 4: Generate script at creation for tip items

**Files:**
- Modify: `scripts/generate-tip-content.ts` (import at `:15-17`; insert block at `:97-119`)

No unit test (live Claude + Supabase call). Verified by typecheck + manual run.

- [ ] **Step 1: Add the `generateScript` import**

In `scripts/generate-tip-content.ts`, after the existing import of `generateTipImages` (after line 17), add:

```ts
import { generateScript } from './generate-script';
```

- [ ] **Step 2: Replace the insert block with creation-time scripting**

In `scripts/generate-tip-content.ts`, replace this block (currently lines 97-119):

```ts
  const first = tips[0];
  const { data, error } = await supabase
    .from('tiktok_content_pool')
    .insert({
      content_type: 'tip',
      status: 'queued',
      tips,
      // Mirror the first tip into legacy columns for back-compat.
      tip_title: first.tipTitle,
      tip_body: first.tipBody,
      tip_icon: first.tipIcon ?? null,
      tip_image_url: first.tipImageSrc ?? null,
      tip_images: first.tipImages ?? null,
      generation_meta: {
        hint: opts.hint ?? null,
        damageNotes: null,
        source: opts.source ?? null,
      },
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to insert tip item: ${error.message}`);
  return { contentId: data.id, tips };
```

with:

```ts
  const first = tips[0];

  // Base row: an unscripted queued item (original behavior, kept as fallback).
  const insertRow: Record<string, unknown> = {
    content_type: 'tip',
    status: 'queued',
    tips,
    // Mirror the first tip into legacy columns for back-compat.
    tip_title: first.tipTitle,
    tip_body: first.tipBody,
    tip_icon: first.tipIcon ?? null,
    tip_image_url: first.tipImageSrc ?? null,
    tip_images: first.tipImages ?? null,
    generation_meta: {
      hint: opts.hint ?? null,
      damageNotes: null,
      source: opts.source ?? null,
    },
  };

  // Script the item at creation so hook/caption are reviewable before render.
  // Tips keep their educational voice (no framing). On failure we keep the
  // queued row — ensureScript() backfills at render time.
  try {
    console.log('  Generating AI script...');
    const script = await generateScript({
      id: 'pending',
      content_type: 'tip',
      tip_title: first.tipTitle,
      tip_body: first.tipBody,
    });
    Object.assign(insertRow, {
      hook_text: script.hook_text,
      caption: script.caption,
      hashtags: script.hashtags,
      music_track: script.music_mood,
      music_style: script.music_style,
      slogan: script.slogan,
      tip_icon: script.tip_icon ?? first.tipIcon ?? null,
      status: 'scripted',
    });
  } catch (err) {
    console.warn(
      `  ⚠️  Script generation failed, leaving item queued: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const { data, error } = await supabase
    .from('tiktok_content_pool')
    .insert(insertRow)
    .select('id')
    .single();

  if (error) throw new Error(`Failed to insert tip item: ${error.message}`);
  return { contentId: data.id, tips };
```

- [ ] **Step 3: Typecheck + tests**

Run: `npx tsc --noEmit`
Expected: no output (clean).

Run: `npm test`
Expected: PASS (unchanged).

- [ ] **Step 4 (manual verification — requires .env with real keys):**

Run: `npm run generate:tip-content`
Expected: console shows `Generating AI script...` (no framing line — tips aren't framed), prints a content id, and the dashboard item shows populated HOOK TEXT + CAPTION with status `scripted`.

> If you cannot run live, say so and rely on the typecheck. Do not claim the manual step passed without running it.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-tip-content.ts
git commit -m "feat: script tip items at creation (fallback to queued)"
```

---

## Task 5: Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS — all suites, including the new `caption-framing` cases.

- [ ] **Step 2: Full typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 3: Confirm no stray false-ownership wording remains**

Run: `grep -n "family memories\|family relationships" scripts/generate-script.ts`
Expected: no matches (both phrases were removed in Task 2).

---

## Spec coverage check

- Goal 1 (truthful): Task 2 Step 3b removes "family memories"/"family relationships" and adds the truthfulness rule. ✅
- Goal 2 (varied): Task 1 (picker) + Task 2 Steps 3a/3c/3d (inject per-reveal framing). ✅
- Goal 3 (review-ready at creation): Tasks 3 & 4. ✅
- Goal 4 (focused, no schema/DB/UI changes): only prompts + creation scripts touched; no migration, no dashboard edits. ✅
- Out of scope respected: `caption-text.ts` untouched; tips not framed (Task 4 passes no framing); no hook-only button/endpoint added. ✅
