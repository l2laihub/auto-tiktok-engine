# AI Suggestion Prefill + Recipe Lineage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-suggest a fresh theme/hint and damage notes each time the dashboard's "Generate with AI" panels open (curated 🎲 + AI ✨), and persist the recipe behind every generated item so winners can be traced and iterated on.

**Architecture:** A new dependency-free ESM module (`public/ai-suggestions.js`, mirroring `schedule-time.js`) holds curated pools + pure pick functions, shared by the browser and `node:test`. A small Claude-backed endpoint provides optional AI suggestions. A `generation_meta` JSONB column on `tiktok_content_pool` stores `{ hint, damageNotes, source }` at insert time. The dashboard auto-fills fields on load, adds 🎲/✨ buttons, displays the stored recipe on each item, and offers a "Generate similar" action that pre-fills the panel from a stored recipe.

**Tech Stack:** Node.js + TypeScript via `tsx`, Express dashboard server, Preact + htm (no build step) frontend, Supabase Postgres, `@anthropic-ai/sdk`, `node:test`.

---

## File Structure

- **Create** `public/ai-suggestions.js` — curated pools (`REVEAL_THEMES`, `REVEAL_DAMAGES`, `TIP_TOPICS`) + pure functions (`pickDistinct`, `suggestRevealInputs`, `suggestTipInputs`). Plain ESM, served at `/static/ai-suggestions.js`.
- **Create** `public/ai-suggestions.d.ts` — type declarations (mirrors `schedule-time.d.ts`).
- **Create** `scripts/lib/__tests__/ai-suggestions.test.ts` — `node:test` for the pure functions.
- **Create** `supabase/migration-v6-generation-meta.sql` — adds `generation_meta JSONB`.
- **Modify** `dashboard/server.ts` — new `POST /api/suggest-generation-inputs`; pass `source` through the two generate endpoints.
- **Modify** `scripts/generate-reveal-photos.ts` — `source` option + persist `generation_meta`.
- **Modify** `scripts/generate-tip-content.ts` — `source` option + persist `generation_meta`.
- **Modify** `dashboard/index.html` — `AddContent` import/auto-fill/🎲/✨/`genSource`/`seed`; `App` `genSeed` state; `ContentPool` + `ScriptEditor` recipe display + "Generate similar".

---

## Task 1: Curated suggestion module (pure functions, TDD)

**Files:**
- Test: `scripts/lib/__tests__/ai-suggestions.test.ts`
- Create: `public/ai-suggestions.js`
- Create: `public/ai-suggestions.d.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/lib/__tests__/ai-suggestions.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REVEAL_THEMES,
  REVEAL_DAMAGES,
  TIP_TOPICS,
  pickDistinct,
  suggestRevealInputs,
  suggestTipInputs,
} from '../../../public/ai-suggestions.js';

test('curated pools are non-empty arrays of strings', () => {
  for (const pool of [REVEAL_THEMES, REVEAL_DAMAGES, TIP_TOPICS]) {
    assert.ok(Array.isArray(pool) && pool.length > 0);
    assert.ok(pool.every((x) => typeof x === 'string' && x.length > 0));
  }
});

test('pickDistinct never returns the current value when pool has >= 2 items', () => {
  const pool = ['a', 'b', 'c'];
  // rng forced low -> first candidate; forced high -> last candidate. Neither is 'b'.
  assert.equal(pickDistinct(pool, 'b', () => 0), 'a');
  assert.equal(pickDistinct(pool, 'b', () => 0.99), 'c');
});

test('pickDistinct returns the lone item for a single-element pool', () => {
  assert.equal(pickDistinct(['x'], 'x'), 'x');
});

test('pickDistinct returns an element when current is null/undefined', () => {
  assert.equal(pickDistinct(['a', 'b'], null, () => 0), 'a');
  assert.equal(pickDistinct(['a', 'b'], undefined, () => 0.99), 'b');
});

test('pickDistinct returns undefined for an empty pool', () => {
  assert.equal(pickDistinct([], 'a'), undefined);
});

test('suggestRevealInputs returns {hint, damageNotes} drawn from the reveal pools', () => {
  const r = suggestRevealInputs();
  assert.ok(REVEAL_THEMES.includes(r.hint));
  assert.ok(REVEAL_DAMAGES.includes(r.damageNotes));
});

test('suggestRevealInputs excludes the previous values', () => {
  const prev = { hint: REVEAL_THEMES[1], damageNotes: REVEAL_DAMAGES[1] };
  const r = suggestRevealInputs(prev, () => 0);
  assert.notEqual(r.hint, prev.hint);
  assert.notEqual(r.damageNotes, prev.damageNotes);
});

test('suggestTipInputs returns {hint} drawn from TIP_TOPICS, excluding prev', () => {
  const r = suggestTipInputs();
  assert.ok(TIP_TOPICS.includes(r.hint));
  const prev = { hint: TIP_TOPICS[1] };
  assert.notEqual(suggestTipInputs(prev, () => 0).hint, prev.hint);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../../../public/ai-suggestions.js` (file not created yet).

- [ ] **Step 3: Create the module**

Create `public/ai-suggestions.js`:

```js
// Curated suggestion pools + pure pickers for the dashboard's "Generate with
// AI" panels. Plain ESM (no build step) so the browser (served at
// /static/ai-suggestions.js) and node/tsx tests import the same file. rng is
// injectable so tests are deterministic; it defaults to Math.random.

export const REVEAL_THEMES = [
  '1960s Saigon wedding portrait',
  'WWII-era soldier’s farewell photo',
  '1950s family on a front porch',
  'immigrants arriving by ship, 1920s',
  'grandparents’ 50th anniversary, 1970s',
  'a child’s first day of school, 1980s',
  'a Vietnamese-American family’s first Tet in the US',
  'fishermen on a rural coast, 1940s',
  'a couple dancing at a 1960s wedding',
  'three generations on a farm, 1930s',
  'a young woman in graduation robes, 1970s',
  'a corner-shop owner outside his store, 1950s',
  'siblings at a county fair, 1960s',
  'a newborn’s first portrait, 1980s',
  'a market street in Hanoi, 1950s',
  'a military reunion, late 1960s',
  'a beachside summer holiday, 1970s',
  'a church choir group photo, 1940s',
  'a father and son fishing, 1960s',
  'a debutante ball portrait, 1950s',
];

export const REVEAL_DAMAGES = [
  'deep water stains and faded edges, one torn corner',
  'heavy mildew spotting and yellowing',
  'cracked emulsion with white fold lines',
  'severe sun-fading, washed-out colors',
  'missing corner, scratches across the face',
  'sepia toning with mold blooms',
  'creased and dog-eared, dust scratches',
  'silvering and oxidation on a glossy print',
  'ink stains and a torn top edge',
  'brittle, curled, with surface cracks',
  'light leaks and chemical blotches',
  'fingerprint smudges and deep scuffs',
  'tape residue and discoloration',
  'warped from humidity, blurred soft focus',
  'fire-singed edges and soot marks',
];

export const TIP_TOPICS = [
  'scanning old prints with your phone',
  'storing negatives safely',
  'why AI faces can look wrong in restorations',
  'organizing decades of family photos',
  'rescuing water-damaged prints',
  'colorizing black-and-white photos',
  'backing up scanned memories',
  'lighting tips for re-photographing prints',
  'labeling photos so stories survive',
  'removing scratches without losing detail',
  'choosing what to restore first',
  'sharing restored photos with family',
  'preserving Polaroids over time',
  'digitizing slides and film reels',
  'fixing faded colors realistically',
  'protecting prints from humidity',
  'restoring torn or missing corners',
  'making prints from restored scans',
  'capturing the story behind each photo',
  'caring for heirloom albums',
];

// Random element of `pool` not equal to `current`. Single-element pool (or no
// non-current candidate) returns an element; empty pool returns undefined.
export function pickDistinct(pool, current, rng = Math.random) {
  if (!Array.isArray(pool) || pool.length === 0) return undefined;
  if (pool.length === 1) return pool[0];
  const candidates = current == null ? pool : pool.filter((x) => x !== current);
  const list = candidates.length ? candidates : pool;
  return list[Math.floor(rng() * list.length)];
}

// { hint, damageNotes } drawn independently from the two reveal pools,
// each excluding the matching previous value.
export function suggestRevealInputs(prev = {}, rng = Math.random) {
  return {
    hint: pickDistinct(REVEAL_THEMES, prev.hint, rng),
    damageNotes: pickDistinct(REVEAL_DAMAGES, prev.damageNotes, rng),
  };
}

// { hint } drawn from TIP_TOPICS, excluding the previous value.
export function suggestTipInputs(prev = {}, rng = Math.random) {
  return { hint: pickDistinct(TIP_TOPICS, prev.hint, rng) };
}
```

- [ ] **Step 4: Create the type declarations**

Create `public/ai-suggestions.d.ts`:

```ts
// Type declarations for ai-suggestions.js (plain ESM shared by browser + tests).
export const REVEAL_THEMES: string[];
export const REVEAL_DAMAGES: string[];
export const TIP_TOPICS: string[];
export function pickDistinct(
  pool: string[],
  current?: string | null,
  rng?: () => number
): string | undefined;
export function suggestRevealInputs(
  prev?: { hint?: string; damageNotes?: string },
  rng?: () => number
): { hint: string; damageNotes: string };
export function suggestTipInputs(
  prev?: { hint?: string },
  rng?: () => number
): { hint: string };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all `ai-suggestions` tests green (and existing tests still pass).

- [ ] **Step 6: Commit**

```bash
git add public/ai-suggestions.js public/ai-suggestions.d.ts scripts/lib/__tests__/ai-suggestions.test.ts
git commit -m "feat: curated AI-suggestion pools + pure pickers"
```

---

## Task 2: AI suggestion endpoint

**Files:**
- Modify: `dashboard/server.ts` (add a new route near the existing `/api/analyze-photos` handler, after line 433)

- [ ] **Step 1: Add the endpoint**

In `dashboard/server.ts`, immediately after the `/api/analyze-photos` handler (the block ending at line 433, before the `// Generate a reveal item with AI` comment at line 435), insert:

```ts
// Suggest a fresh theme/hint (and damage notes for reveals) via Claude — the
// "✨" button in the Generate panels. Cheap, low-token; the UI falls back to
// curated suggestions if this fails or the key is missing.
app.post('/api/suggest-generation-inputs', async (req, res) => {
  const { type } = req.body || {};
  if (type !== 'reveal' && type !== 'tip') {
    return res.status(400).json({ error: "type must be 'reveal' or 'tip'" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY not set — AI suggestions unavailable.' });
  }

  const prompt = type === 'reveal'
    ? `Invent ONE fresh, specific idea for an old family-photo restoration video for EternalFrame. Return ONLY valid JSON:
{
  "hint": "a concrete photo scenario, e.g. '1960s Saigon wedding portrait' (max ~60 chars)",
  "damageNotes": "a short vivid description of the photo's damage, e.g. 'deep water stains, one torn corner' (max ~70 chars)"
}`
    : `Invent ONE fresh, specific topic for a photo-restoration / memory-keeping tips video for EternalFrame. Return ONLY valid JSON:
{
  "hint": "a concrete tip topic, e.g. 'scanning old prints with your phone' (max ~60 chars)"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: 'You invent fresh, specific content ideas for EternalFrame, an AI photo restoration app. Respond ONLY with valid JSON. Avoid repeating common defaults — be varied and concrete.',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');
    const clean = text.replace(/```json\s*|```\s*/g, '').trim();
    const parsed = JSON.parse(clean);
    res.json(type === 'reveal'
      ? { hint: parsed.hint ?? null, damageNotes: parsed.damageNotes ?? null }
      : { hint: parsed.hint ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no new type errors). The `anthropic` client and `Anthropic` import already exist (`dashboard/server.ts:8`, `:384`).

- [ ] **Step 3: Manually smoke-test the endpoint**

Run the dashboard, then in another shell:
```bash
curl -s -X POST localhost:3001/api/suggest-generation-inputs \
  -H 'content-type: application/json' -d '{"type":"reveal"}'
```
Expected (with `ANTHROPIC_API_KEY` set): JSON like `{"hint":"...","damageNotes":"..."}`. With the key unset: HTTP 400 `{"error":"ANTHROPIC_API_KEY not set ..."}`.

- [ ] **Step 4: Commit**

```bash
git add dashboard/server.ts
git commit -m "feat: /api/suggest-generation-inputs endpoint for ✨ suggestions"
```

---

## Task 3: Schema migration for `generation_meta`

**Files:**
- Create: `supabase/migration-v6-generation-meta.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migration-v6-generation-meta.sql`:

```sql
-- migration-v6-generation-meta.sql
-- Persist the input "recipe" behind each AI-generated item so winners can be
-- traced (via tiktok_post_id) and iterated on. Shape:
--   { "hint": "...", "damageNotes": "...", "source": "curated|ai|manual" }
-- Nullable; absent for hand-added / legacy items. damageNotes is null for tips.

ALTER TABLE tiktok_content_pool
  ADD COLUMN IF NOT EXISTS generation_meta JSONB;
```

- [ ] **Step 2: Apply the migration**

Apply via the project's normal path (Supabase SQL editor or `psql`). Verify:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'tiktok_content_pool' AND column_name = 'generation_meta';
```
Expected: one row, `generation_meta | jsonb`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration-v6-generation-meta.sql
git commit -m "feat: migration-v6 add generation_meta column"
```

---

## Task 4: Persist `generation_meta` in the generate scripts

**Files:**
- Modify: `scripts/generate-reveal-photos.ts` (`GenerateRevealOptions` ~149-154; insert ~181-192)
- Modify: `scripts/generate-tip-content.ts` (`GenerateTipContentOptions` ~71-74; insert ~97-111)
- Modify: `dashboard/server.ts` (`/api/generate-reveal-photos` ~440-456; `/api/generate-tip-content` ~652-657)

- [ ] **Step 1: Add `source` to the reveal options and persist meta**

In `scripts/generate-reveal-photos.ts`, change the `GenerateRevealOptions` interface (currently lines 149-154):

```ts
export interface GenerateRevealOptions {
  pairs?: number;
  hint?: string;
  subjects?: PhotoSubject[];
  damageNotes?: string;
  source?: 'curated' | 'ai' | 'manual';
}
```

Then in `generateRevealPhotos`, change the insert object (currently lines 182-192) to include `generation_meta`:

```ts
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
```

- [ ] **Step 2: Add `source` to the tip options and persist meta**

In `scripts/generate-tip-content.ts`, change `GenerateTipContentOptions` (currently lines 71-74):

```ts
export interface GenerateTipContentOptions {
  count?: number;
  hint?: string;
  source?: 'curated' | 'ai' | 'manual';
}
```

Then in `generateTipContent`, change the insert object (currently lines 98-109) to include `generation_meta` (damageNotes always null for tips):

```ts
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
```

- [ ] **Step 3: Pass `source` through the dashboard endpoints**

In `dashboard/server.ts`, update `/api/generate-reveal-photos` (lines 440-456). Change the destructure and the `generateRevealPhotos` call:

```ts
  const { pairs = 1, hint, subject, era, damageNotes, source } = req.body || {};
```
```ts
    const result = await generateRevealPhotos({
      pairs: Math.max(1, Math.min(6, Number(pairs) || 1)),
      hint,
      subjects,
      damageNotes,
      source,
    });
```

Update `/api/generate-tip-content` (lines 652-657):

```ts
  const { count = 4, hint, source } = req.body || {};
  try {
    const result = await generateTipContent({
      count: Math.max(1, Math.min(6, Number(count) || 4)),
      hint,
      source,
    });
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-reveal-photos.ts scripts/generate-tip-content.ts dashboard/server.ts
git commit -m "feat: persist generation_meta recipe on generated items"
```

---

## Task 5: Dashboard — auto-fill, 🎲/✨ buttons, source tracking, seed prop

**Files:**
- Modify: `dashboard/index.html` — import line (~1855 area); `AddContent` (`:2904`–`:3193`)

- [ ] **Step 1: Import the suggestion helpers**

In `dashboard/index.html`, find the existing import (line 1855):

```js
    import { toLocalInput, fromLocalInput, localDateKey, formatDateTime, dayKeyToISO } from '/static/schedule-time.js';
```

Add directly below it:

```js
    import { suggestRevealInputs, suggestTipInputs } from '/static/ai-suggestions.js';
```

- [ ] **Step 2: Extend the `AddContent` signature and state**

Change the `AddContent` declaration (line 2904) from:

```js
    function AddContent({ onToast, onSwitch }) {
```
to:
```js
    function AddContent({ onToast, onSwitch, seed, onSeedConsumed }) {
```

Then in its state block (lines 2908-2914), add two new state vars after `const [genTip, setGenTip] = useState(false);`:

```js
      const [genSource, setGenSource] = useState('curated');
      const [suggesting, setSuggesting] = useState(false);
```

- [ ] **Step 3: Add auto-fill / seed `useEffect` and shuffle / AI handlers**

Immediately after the state block and before `async function handleGenerateTip()` (line 2916), insert:

```js
      // Seed from "Generate similar", else auto-fill the active sub-tab's
      // suggestion fields from the curated pool when they're still empty.
      useEffect(() => {
        if (seed) {
          setSubTab(seed.type === 'tip' ? 'tip' : 'reveal');
          if (seed.type === 'tip') {
            setGenTipHint(seed.hint || '');
          } else {
            setGenHint(seed.hint || '');
            setGenDamage(seed.damageNotes || '');
          }
          setGenSource('manual');
          onSeedConsumed && onSeedConsumed();
          return;
        }
        if (subTab === 'reveal' && !genHint && !genDamage) {
          const s = suggestRevealInputs();
          setGenHint(s.hint); setGenDamage(s.damageNotes); setGenSource('curated');
        } else if (subTab === 'tip' && !genTipHint) {
          const s = suggestTipInputs();
          setGenTipHint(s.hint); setGenSource('curated');
        }
        // eslint-disable-next-line
      }, [subTab, seed]);

      function shuffleReveal() {
        const s = suggestRevealInputs({ hint: genHint, damageNotes: genDamage });
        setGenHint(s.hint); setGenDamage(s.damageNotes); setGenSource('curated');
      }
      function shuffleTip() {
        const s = suggestTipInputs({ hint: genTipHint });
        setGenTipHint(s.hint); setGenSource('curated');
      }
      async function aiSuggest(type) {
        setSuggesting(true);
        try {
          const r = await api('/api/suggest-generation-inputs', { method: 'POST', body: { type } });
          if (type === 'tip') {
            setGenTipHint(r.hint || '');
          } else {
            setGenHint(r.hint || ''); setGenDamage(r.damageNotes || '');
          }
          setGenSource('ai');
        } catch (e) {
          if (type === 'tip') shuffleTip(); else shuffleReveal();
          onToast('AI busy — used a curated suggestion', 'info');
        } finally {
          setSuggesting(false);
        }
      }
```

> Note: `subTab` is declared with `useState('reveal')` at line 2905, above this insertion point, so `setSubTab` is in scope. `useEffect` is already used elsewhere in this file (e.g. `ContentPool`), so it is imported.

- [ ] **Step 4: Send `source` in the generate request bodies**

In `handleGenerateTip` (line ~2920-2923) change the body:

```js
          const result = await api('/api/generate-tip-content', {
            method: 'POST',
            body: { count: genTipCount, hint: genTipHint || undefined, source: genSource },
          });
```

In `handleGenerate` (line ~2994-2997) change the body:

```js
          const result = await api('/api/generate-reveal-photos', {
            method: 'POST',
            body: { pairs: genPairs, hint: genHint || undefined, damageNotes: genDamage || undefined, source: genSource },
          });
```

- [ ] **Step 5: Mark fields manual on edit, and add 🎲/✨ buttons (reveal)**

In the reveal Generate panel, change the theme input (line 3062) to set source on edit:

```js
                    <input className="form-input" placeholder="e.g. Vietnamese wedding photos, 1960s soldiers" value=${genHint} onInput=${e => { setGenHint(e.target.value); setGenSource('manual'); }} />
```

Change the damage input (line 3066):

```js
                    <input className="form-input" placeholder="e.g. heavy water damage, mildew, torn corners" value=${genDamage} onInput=${e => { setGenDamage(e.target.value); setGenSource('manual'); }} />
```

Then, in the reveal panel's button row, immediately before the existing `✨ Generate with AI` button (line 3074), insert the two suggestion buttons:

```js
                  <button type="button" className="btn btn-secondary btn-sm" title="Shuffle a curated suggestion" onClick=${shuffleReveal}>🎲</button>
                  <button type="button" className="btn btn-secondary btn-sm" title="Get a fresh AI suggestion" onClick=${() => aiSuggest('reveal')} disabled=${suggesting}>${suggesting ? '…' : '✨'}</button>
```

- [ ] **Step 6: Mark field manual on edit, and add 🎲/✨ buttons (tip)**

In the tip Generate panel, change the topic input (line 3148):

```js
                    <input className="form-input" placeholder="e.g. scanning old prints, organizing photos" value=${genTipHint} onInput=${e => { setGenTipHint(e.target.value); setGenSource('manual'); }} />
```

Then immediately before the existing `✨ Generate Tip with AI` button (line 3156), insert:

```js
                  <button type="button" className="btn btn-secondary btn-sm" title="Shuffle a curated suggestion" onClick=${shuffleTip}>🎲</button>
                  <button type="button" className="btn btn-secondary btn-sm" title="Get a fresh AI suggestion" onClick=${() => aiSuggest('tip')} disabled=${suggesting}>${suggesting ? '…' : '✨'}</button>
```

- [ ] **Step 7: Manually verify in the dashboard**

Run the dashboard. Open **Add Content → Reveal**: the Theme/hint and Damage fields are pre-filled and differ on each 🎲 click. ✨ fetches an AI suggestion (or toasts "used a curated suggestion" if no key). Switch to **Tip**: the Topic field pre-fills; 🎲/✨ work. Typing in any field leaves the value untouched on sub-tab toggles.

- [ ] **Step 8: Commit**

```bash
git add dashboard/index.html
git commit -m "feat: auto-fill + 🎲/✨ suggestion buttons in Generate panels"
```

---

## Task 6: Dashboard — display recipe + "Generate similar"

**Files:**
- Modify: `dashboard/index.html` — `App` (`:3555`+, render `:3605`/`:3607`); `ContentPool` (`:2256`, ScriptEditor instantiations `:2404` & `:2455`); `ScriptEditor` (`:1936`, return `:2090`)

- [ ] **Step 1: Lift `genSeed` state into `App` and wire props**

In `App` (line 3556), after `const [tab, setTab] = useState('pool');` add:

```js
      const [genSeed, setGenSeed] = useState(null);
```

Change the `ContentPool` render line (3605):

```js
            ${tab === 'pool' ? html`<${ContentPool} onToast=${addToast} onGenerateSimilar=${(s) => { setGenSeed(s); setTab('add'); }} />` : null}
```

Change the `AddContent` render line (3607):

```js
            ${tab === 'add' ? html`<${AddContent} onToast=${addToast} onSwitch=${setTab} seed=${genSeed} onSeedConsumed=${() => setGenSeed(null)} />` : null}
```

- [ ] **Step 2: Thread `onGenerateSimilar` through `ContentPool` to both `ScriptEditor`s**

Change the `ContentPool` signature (line 2256):

```js
    function ContentPool({ onToast, onGenerateSimilar }) {
```

Add the prop to the desktop-table `ScriptEditor` (instantiation at line 2404; add the prop alongside the existing `onClose`):

```js
                        onGenerateSimilar=${onGenerateSimilar}
```

Add the same prop to the mobile-cards `ScriptEditor` (instantiation at line 2455):

```js
                onGenerateSimilar=${onGenerateSimilar}
```

- [ ] **Step 3: Accept the prop in `ScriptEditor` and render the recipe + button**

Change the `ScriptEditor` signature (line 1936):

```js
    function ScriptEditor({ item, onSave, onRegenerate, onRegenerateMusic, onReRender, onClose, onToast, onGenerateSimilar }) {
```

Then, immediately after the editor's opening element (line 2090, the line `return html\`<div className="script-editor" style=${{display: 'block'}}>`), insert the recipe block:

```js
        ${item.generation_meta && (item.generation_meta.hint || item.generation_meta.damageNotes) ? html`
          <div className="panel" style=${{padding: '0.6rem 0.8rem', marginBottom: '1rem', fontSize: '0.8rem', background: 'rgba(255,255,255,0.03)'}}>
            <div style=${{fontWeight: 600, marginBottom: '0.25rem'}}>Generated from</div>
            ${item.generation_meta.hint ? html`<div>Theme: ${item.generation_meta.hint}</div>` : null}
            ${item.generation_meta.damageNotes ? html`<div>Damage: ${item.generation_meta.damageNotes}</div>` : null}
            <div style=${{display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.4rem'}}>
              ${item.generation_meta.source ? html`<span className="status-badge" style=${{fontSize: '0.7rem'}}>${item.generation_meta.source}</span>` : null}
              ${onGenerateSimilar ? html`<button type="button" className="btn btn-secondary btn-sm" onClick=${() => { onGenerateSimilar({ type: item.content_type, hint: item.generation_meta.hint, damageNotes: item.generation_meta.damageNotes }); onClose(); }}>♻️ Generate similar</button>` : null}
            </div>
          </div>
        ` : null}
```

- [ ] **Step 4: Manually verify the full loop**

Run the dashboard. Generate a reveal via AI (Task 5). In the pool, expand that item → the "Generated from" block shows the theme/damage and a `source` badge. Click **♻️ Generate similar** → the editor closes, the app switches to **Add Content** with the matching sub-tab and the theme/damage pre-filled from that item. Tweak and generate → the new item carries its own `generation_meta`. Hand-added / legacy items (no `generation_meta`) show no block and no button.

- [ ] **Step 5: Commit**

```bash
git add dashboard/index.html
git commit -m "feat: show recipe + 'Generate similar' on content items"
```

---

## Final Verification

- [ ] **Run the unit tests**

Run: `npm test`
Expected: PASS — including the new `ai-suggestions` tests.

- [ ] **Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **End-to-end dashboard check**

Generate a reveal and a tip via the ✨/🎲 panels, confirm each new item stores `generation_meta` (visible in the "Generated from" block), and confirm "Generate similar" round-trips a recipe back into the panel.
