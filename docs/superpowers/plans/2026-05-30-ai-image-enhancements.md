# AI Image Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI-generated "before" photos dramatically more damaged, let users regenerate reveal/tip imagery while reviewing an item, and add a full "Generate Tip with AI" self-source flow with multi-tip support.

**Architecture:** Extends the existing in-process image-generation stack (`src/utils/image-gen.ts` + `src/utils/storage.ts` + `scripts/lib/image-prompts.ts`). Reveal generation gains a `damageNotes` knob and is factored into per-image generators so a new `POST /api/content/:id/regenerate-images` endpoint can re-roll a whole pair, just the before, just the after, or tip imagery. Tips get a new `tips JSONB` column, a self-source script + endpoint, and the pipeline is taught to feed the full `tips[]` array to the (already array-capable) `TipsEducational` composition. The dashboard is plain React-18-UMD + `htm` template literals rendered inline in `dashboard/index.html` — all new UI follows that idiom (no JSX/build step).

**Tech Stack:** Node + TypeScript via `tsx`, Express, Supabase (`tiktok_content_pool`), Gemini `gemini-2.5-flash-image` via `@google/genai`, Anthropic SDK (`claude-sonnet-4-20250514`), Remotion, React 18 UMD + `htm`. Tests for pure functions use the built-in `node:test` runner run through `tsx` (no new dependency).

**Spec:** `docs/superpowers/specs/2026-05-30-ai-image-enhancements-design.md`

---

## Conventions & Verification Idiom (read first)

- **No mocking framework exists.** Code that calls Gemini/Supabase/Anthropic is verified with `npx tsc --noEmit` (type safety) plus manual/smoke runs that need live keys. Do NOT invent fake unit tests for I/O code.
- **Pure functions get real tests** via `node:test` + `node:assert`, run with `node --import tsx --test <file>`.
- **Type-check command (run after every code task):** `npx tsc --noEmit` — expected: no new errors. (Note: `tsx` runs untyped, so `tsc` is the only compile gate.)
- **Backward compatibility is a hard requirement.** Existing reveal generation, the single-tip flow, and the pipeline must keep working. Every new param is optional; the `tips` column is nullable; legacy render paths stay.
- **DB table is `tiktok_content_pool`.** Reveal images live in `image_pairs JSONB`. Tips currently use scalar columns + `tip_images JSONB` + `tip_icon TEXT`.
- **Commit after each task.** Branch is `main`; create a feature branch first (Task 0).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `scripts/lib/image-prompts.ts` | Pure prompt builders | Modify `buildBeforePrompt` (heavier + `damageNotes`) |
| `scripts/lib/__tests__/image-prompts.test.ts` | Unit tests for prompt builders | Create |
| `scripts/generate-reveal-photos.ts` | Reveal self-source + (new) granular image generators | Modify |
| `scripts/generate-tip-content.ts` | Multi-tip self-source (Claude → tips[] → images → row) | Create |
| `scripts/generate-tip-images.ts` | Per-tip image generation | Reuse unchanged |
| `scripts/render-video.ts` | Pipeline: ensure-steps + Remotion input props | Modify (tips array path) |
| `dashboard/server.ts` | API routes | Modify (`damageNotes`, 2 new routes) |
| `dashboard/index.html` | Dashboard UI (htm) | Modify (damage field, regen buttons, tip-gen, tip-array editor) |
| `supabase/migration-v4-tips-array.sql` | `tips JSONB` column | Create |
| `package.json` | npm scripts (`test`, `generate:tip-content`) | Modify |
| `CLAUDE.md` | Docs | Modify |

---

## Task 0: Branch

- [ ] **Step 1: Create a feature branch**

Run:
```bash
cd /Users/huybuilds/repos/auto-tiktok-engine
git checkout -b feat/ai-image-enhancements
```
Expected: `Switched to a new branch 'feat/ai-image-enhancements'`

- [ ] **Step 2: Baseline type-check (must be green before we start)**

Run: `npx tsc --noEmit`
Expected: no errors (clean exit). If there are pre-existing errors unrelated to this work, note them; do not fix unrelated code.

---

## Task 1: Heavier "before" damage prompt (pure function, TDD)

**Files:**
- Modify: `scripts/lib/image-prompts.ts:21-30` (`buildBeforePrompt`)
- Create: `scripts/lib/__tests__/image-prompts.test.ts`
- Modify: `package.json` (add `test` script)

- [ ] **Step 1: Add the `test` npm script**

In `package.json`, inside `"scripts"`, add this entry (place it after `"verify:image-gen"`):
```json
"test": "node --import tsx --test scripts/lib/__tests__/*.test.ts"
```

- [ ] **Step 2: Write the failing test**

Create `scripts/lib/__tests__/image-prompts.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBeforePrompt, type PhotoSubject } from '../image-prompts';

const subject: PhotoSubject = {
  subject: 'a young couple on their wedding day',
  era: '1960s',
  story: 'A cherished wedding portrait.',
  label: "Grandma's wedding",
};

test('buildBeforePrompt includes the subject and era', () => {
  const p = buildBeforePrompt(subject);
  assert.match(p, /young couple on their wedding day/);
  assert.match(p, /1960s/);
});

test('buildBeforePrompt requests dramatic, heavy damage by default', () => {
  const p = buildBeforePrompt(subject).toLowerCase();
  // The whole point of this feature: damage must be dramatic, not mild.
  assert.match(p, /tear|torn|rip/);
  assert.match(p, /missing corner|torn corner/);
  assert.match(p, /water stain|water damage|moisture/);
  assert.match(p, /crease|fold/);
  assert.match(p, /mold|foxing/);
  assert.match(p, /fad(e|ing)|yellow/);
});

test('buildBeforePrompt keeps the no-text guardrail', () => {
  const p = buildBeforePrompt(subject).toLowerCase();
  assert.match(p, /no text/);
});

test('buildBeforePrompt appends damageNotes when provided', () => {
  const p = buildBeforePrompt(subject, 'water-damaged 1960s Polaroid, mildew');
  assert.match(p, /water-damaged 1960s Polaroid, mildew/);
});

test('buildBeforePrompt omits the damage-notes clause when not provided', () => {
  const p = buildBeforePrompt(subject);
  assert.doesNotMatch(p, /Additional damage\/style direction/);
});
```

- [ ] **Step 3: Run the test, verify it FAILS**

Run: `node --import tsx --test scripts/lib/__tests__/image-prompts.test.ts`
Expected: failures — the `damageNotes` param doesn't exist yet and the current prompt lacks "missing corner"/"mold"/"foxing" terms.

- [ ] **Step 4: Rewrite `buildBeforePrompt`**

Replace `scripts/lib/image-prompts.ts:21-30` (the whole current `buildBeforePrompt` function) with:
```ts
/**
 * Prompt for the DAMAGED "before" image (text-to-image).
 * Defaults to DRAMATIC, unmistakable deterioration so the before→after
 * reveal lands hard. `damageNotes` lets a caller steer specifics
 * (e.g. "water-damaged 1960s Polaroid, mildew").
 */
export function buildBeforePrompt(s: PhotoSubject, damageNotes?: string): string {
  const base = [
    `A vertical 9:16 portrait-orientation photograph of ${s.subject}, taken in the ${s.era}.`,
    `Render it as a SEVERELY aged and DAMAGED vintage family photograph with dramatic, unmistakable physical deterioration:`,
    `deep tears and rips across the surface, one or more torn or completely missing corners,`,
    `large water stains and moisture blooms, deep creases and fold lines with cracked and flaking emulsion along them,`,
    `heavy fading and strong yellow/sepia discoloration, brittle silver-mirroring, foxing and brown mold spots,`,
    `scattered dust, scratches and white emulsion loss, frayed and curling edges.`,
    `The damage must be heavy and obvious — clearly a precious photo in urgent need of restoration —`,
    `while keeping the underlying subjects, faces and composition still recognizable beneath the damage.`,
    `Use authentic period clothing, hairstyles, furniture and setting for the ${s.era}.`,
    `It must look like a real scanned print from an old family photo album — not a modern or AI-looking photo.`,
    `Natural candid composition. No text, no captions, no watermarks, no borders.`,
  ].join(' ');
  return damageNotes
    ? `${base} Additional damage/style direction: ${damageNotes}.`
    : base;
}
```

- [ ] **Step 5: Run the test, verify it PASSES**

Run: `node --import tsx --test scripts/lib/__tests__/image-prompts.test.ts`
Expected: all tests pass (`# pass 5`, `# fail 0`).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/image-prompts.ts scripts/lib/__tests__/image-prompts.test.ts package.json
git commit -m "feat(image-prompts): dramatic before-damage default + damageNotes override

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Granular reveal image generators + persist subject/story on each pair

Currently `generatePair` (generate-reveal-photos.ts:81-107) returns only `{before_url, after_url, era, label}` and discards `subject`/`story`. Faithful regeneration needs the original visual subject, so we (a) split before/after generation into reusable functions, (b) thread `damageNotes`, (c) persist `subject`/`story`/`damage_notes` on the pair, and (d) add a helper to load an existing image URL into a buffer (for "regen after from current before").

**Files:**
- Modify: `scripts/generate-reveal-photos.ts` (interfaces + functions, lines 73-156)

- [ ] **Step 1: Widen the `GeneratedPair` interface**

Replace `scripts/generate-reveal-photos.ts:73-78`:
```ts
export interface GeneratedPair {
  before_url: string;
  after_url: string;
  era: string;
  label: string;
  /** Visual subject description used to (re)generate the before image. */
  subject?: string;
  /** 1–2 sentence backstory (kept for script generation + re-rolls). */
  story?: string;
  /** Free-text damage steering applied to the before image, if any. */
  damage_notes?: string;
}
```

- [ ] **Step 2: Add granular generators + a URL→buffer helper, and refactor `generatePair`**

Replace the whole `generatePair` function (`scripts/generate-reveal-photos.ts:80-107`) with:
```ts
/** Generate just the DAMAGED "before" image for a subject. */
export async function generateBeforeImage(
  subject: PhotoSubject,
  damageNotes?: string
): Promise<GeneratedImage> {
  return generateImage({ prompt: buildBeforePrompt(subject, damageNotes), aspectRatio: '9:16' });
}

/** Restore a "before" image into its "after" (image-to-image edit, same subject). */
export async function generateAfterFromBuffer(before: GeneratedImage): Promise<GeneratedImage> {
  return generateImage({
    prompt: buildRestoreEditPrompt(),
    referenceImage: { buffer: before.imageBuffer, mimeType: before.mimeType },
    aspectRatio: '9:16',
  });
}

/** Download an already-uploaded image (e.g. a stored before_url) into a buffer. */
export async function fetchImageAsGenerated(url: string): Promise<GeneratedImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image ${url}: HTTP ${res.status}`);
  const mimeType = res.headers.get('content-type') || 'image/png';
  const imageBuffer = Buffer.from(await res.arrayBuffer());
  return { imageBuffer, mimeType };
}

/** Generate a single damaged→restored pair and upload both images. */
export async function generatePair(subject: PhotoSubject, damageNotes?: string): Promise<GeneratedPair> {
  console.log(`  • ${subject.label} (${subject.era}) — ${subject.subject}`);

  // 1. Damaged "before"
  console.log('    generating damaged "before"...');
  const before = await generateBeforeImage(subject, damageNotes);
  const before_url = await uploadImageBuffer({
    buffer: before.imageBuffer,
    contentType: before.mimeType,
    pathPrefix: 'generated/reveal',
  });

  // 2. Restored "after" — edit the before so the subject stays identical
  console.log('    restoring → "after"...');
  const after = await generateAfterFromBuffer(before);
  const after_url = await uploadImageBuffer({
    buffer: after.imageBuffer,
    contentType: after.mimeType,
    pathPrefix: 'generated/reveal',
  });

  return {
    before_url,
    after_url,
    era: subject.era,
    label: subject.label,
    subject: subject.subject,
    story: subject.story,
    damage_notes: damageNotes,
  };
}
```

- [ ] **Step 3: Import `GeneratedImage` and `buildRestoreEditPrompt` (verify imports)**

At the top of `scripts/generate-reveal-photos.ts`, ensure these imports exist (they mostly do — `buildRestoreEditPrompt` is already imported at lines 22-26; add the `GeneratedImage` type from image-gen):
```ts
import { generateImage, type GeneratedImage } from '../src/utils/image-gen';
```
(Replace the existing `import { generateImage } from '../src/utils/image-gen';` line 20.)

- [ ] **Step 4: Thread `damageNotes` through `generateRevealPhotos`**

In `GenerateRevealOptions` (lines 109-113), add a field:
```ts
export interface GenerateRevealOptions {
  pairs?: number;
  hint?: string;
  subjects?: PhotoSubject[];
  damageNotes?: string;
}
```
Then in `generateRevealPhotos` (lines 134-137), change the generation loop to pass it:
```ts
  const imagePairs: GeneratedPair[] = [];
  for (const subject of subjects) {
    imagePairs.push(await generatePair(subject, opts.damageNotes));
  }
```

- [ ] **Step 5: Pass `--damage` from the CLI (optional convenience)**

In `main()` (lines 159-184), after `const hint = getFlag('hint');` add:
```ts
  const damageNotes = getFlag('damage');
```
and update the `generateRevealPhotos` call (line 184) to:
```ts
  const result = await generateRevealPhotos({ pairs, hint, subjects, damageNotes });
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add scripts/generate-reveal-photos.ts
git commit -m "feat(reveal): granular before/after generators, damageNotes, persist subject on pair

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `damageNotes` on the reveal-generate endpoint + UI field

**Files:**
- Modify: `dashboard/server.ts:426-451` (`/api/generate-reveal-photos`)
- Modify: `dashboard/index.html` (AddContent generate form ~2935-3018)

- [ ] **Step 1: Accept `damageNotes` in the endpoint**

In `dashboard/server.ts`, change the destructuring at line 430 from:
```ts
  const { pairs = 1, hint, subject, era } = req.body || {};
```
to:
```ts
  const { pairs = 1, hint, subject, era, damageNotes } = req.body || {};
```
and the `generateRevealPhotos` call (lines 441-445) to:
```ts
    const result = await generateRevealPhotos({
      pairs: Math.max(1, Math.min(6, Number(pairs) || 1)),
      hint,
      subjects,
      damageNotes,
    });
```

- [ ] **Step 2: Add a `genDamage` state to AddContent**

In `dashboard/index.html`, find where `genHint`/`genPairs` are declared with `useState` inside the AddContent component (near the other AddContent state, before `handleGenerate` ~line 2935). Add alongside them:
```js
      const [genDamage, setGenDamage] = useState('');
```
(Search for `setGenPairs` to locate the existing declarations and add this line next to them.)

- [ ] **Step 3: Send `damageNotes` from `handleGenerate`**

In `handleGenerate` (lines 2939-2942), change the request body to include damage notes:
```js
          const result = await api('/api/generate-reveal-photos', {
            method: 'POST',
            body: { pairs: genPairs, hint: genHint || undefined, damageNotes: genDamage || undefined },
          });
```

- [ ] **Step 4: Add the damage-notes input to the generate panel**

In the reveal generate panel (the `<div>` with the "Theme / hint" input, ~lines 3004-3018), add a new form-group after the hint input and before the "Pairs" select:
```js
                  <div className="form-group" style=${{flex: '1 1 220px', margin: 0}}>
                    <label className="form-label">Damage notes (optional)</label>
                    <input className="form-input" placeholder="e.g. heavy water damage, mildew, torn corners" value=${genDamage} onInput=${e => setGenDamage(e.target.value)} />
                  </div>
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors. (`index.html` is not type-checked, but `server.ts` is.)

- [ ] **Step 6: Manual smoke (only if `GOOGLE_API_KEY` is set; otherwise skip and note)**

Run: `npm run dashboard`, open `http://localhost:3001`, go to Add Content → Reveal, type a damage note, click "✨ Generate with AI". Expected: a queued reveal item is created; its `before` image is heavily damaged. If no API key, skip and record "skipped — no GOOGLE_API_KEY".

- [ ] **Step 7: Commit**

```bash
git add dashboard/server.ts dashboard/index.html
git commit -m "feat(dashboard): damage-notes field on AI reveal generation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `POST /api/content/:id/regenerate-images` — reveal scopes (pair/before/after)

A NEW endpoint (distinct from the existing script-regenerate route at line 120). Runs in-process, returns the updated row. Tip scope is added later in Task 10.

**Files:**
- Modify: `dashboard/server.ts` (add imports + new route after the existing `/api/generate-reveal-photos` route, ~line 451)

- [ ] **Step 1: Import the granular generators + uploader**

At the top of `dashboard/server.ts`, update the reveal import (line 12) to also pull the new functions:
```ts
import {
  generateRevealPhotos,
  generateBeforeImage,
  generateAfterFromBuffer,
  fetchImageAsGenerated,
  inventSubjects,
} from '../scripts/generate-reveal-photos';
import { uploadImageBuffer } from '../src/utils/storage';
import type { PhotoSubject } from '../scripts/lib/image-prompts';
```

- [ ] **Step 2: Add the route**

Insert after the `/api/generate-reveal-photos` route closes (after line 451 `});`):
```ts
// Regenerate IMAGES (not script) for an item — reveal pairs or tip imagery.
// Runs in-process and returns the updated row.
app.post('/api/content/:id/regenerate-images', async (req, res) => {
  if (!process.env.GOOGLE_API_KEY) {
    return res.status(400).json({ error: 'GOOGLE_API_KEY not set — image generation unavailable.' });
  }

  const { scope, pairIndex, tipIndex, damageNotes } = req.body || {};

  const { data: item, error: fetchErr } = await supabase
    .from('tiktok_content_pool')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (fetchErr || !item) return res.status(404).json({ error: 'Item not found' });

  try {
    if (scope === 'pair' || scope === 'before' || scope === 'after') {
      if (item.content_type !== 'reveal') {
        return res.status(400).json({ error: 'Pair regeneration is only valid for reveal items' });
      }
      const pairs = Array.isArray(item.image_pairs) ? [...item.image_pairs] : [];
      const idx = Number(pairIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx >= pairs.length) {
        return res.status(400).json({ error: `Invalid pairIndex ${pairIndex}` });
      }
      const pair = { ...pairs[idx] };

      // Reconstruct a PhotoSubject for this pair (new pairs persist subject/story).
      let subject: PhotoSubject;
      if (pair.subject) {
        subject = {
          subject: pair.subject,
          era: pair.era || item.photo_era || '1960s',
          story: pair.story || item.photo_story || `An old family photograph: ${pair.subject}.`,
          label: pair.label || 'Restored memory',
        };
      } else if (item.photo_story) {
        subject = {
          subject: item.photo_story,
          era: pair.era || item.photo_era || '1960s',
          story: item.photo_story,
          label: pair.label || 'Restored memory',
        };
      } else {
        [subject] = await inventSubjects(1);
      }

      const notes = damageNotes ?? pair.damage_notes;

      if (scope === 'pair' || scope === 'before') {
        const before = await generateBeforeImage(subject, notes);
        pair.before_url = await uploadImageBuffer({
          buffer: before.imageBuffer, contentType: before.mimeType, pathPrefix: 'generated/reveal',
        });
        pair.subject = subject.subject;
        pair.story = subject.story;
        pair.damage_notes = notes ?? null;
        if (scope === 'pair') {
          const after = await generateAfterFromBuffer(before);
          pair.after_url = await uploadImageBuffer({
            buffer: after.imageBuffer, contentType: after.mimeType, pathPrefix: 'generated/reveal',
          });
        }
      } else {
        // scope === 'after': re-edit from the CURRENT before so the subject stays matched.
        if (!pair.before_url) return res.status(400).json({ error: 'Pair has no before image to restore from' });
        const before = await fetchImageAsGenerated(pair.before_url);
        const after = await generateAfterFromBuffer(before);
        pair.after_url = await uploadImageBuffer({
          buffer: after.imageBuffer, contentType: after.mimeType, pathPrefix: 'generated/reveal',
        });
      }

      pairs[idx] = pair;
      const update: Record<string, unknown> = { image_pairs: pairs };
      if (idx === 0) {
        update.before_image_url = pair.before_url; // keep legacy single-pair fields in sync
        update.after_image_url = pair.after_url;
      }
      const { data: updated, error: updErr } = await supabase
        .from('tiktok_content_pool').update(update).eq('id', item.id).select().single();
      if (updErr) return res.status(500).json({ error: updErr.message });
      return res.json(updated);
    }

    // tip-images scope is implemented in Task 10.
    return res.status(400).json({ error: `Unsupported scope: ${scope}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual smoke (if `GOOGLE_API_KEY` set; else skip + note)**

With the dashboard running and an existing reveal item id `<ID>`:
```bash
curl -s -X POST http://localhost:3001/api/content/<ID>/regenerate-images \
  -H 'Content-Type: application/json' -d '{"scope":"after","pairIndex":0}' | head -c 400
```
Expected: JSON of the updated row with a changed `image_pairs[0].after_url`. If no key, expect `400 GOOGLE_API_KEY not set` (that path is also a valid verification).

- [ ] **Step 5: Commit**

```bash
git add dashboard/server.ts
git commit -m "feat(api): regenerate-images endpoint for reveal pairs (pair/before/after)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Reveal editor regenerate buttons (UI)

Add per-pair regenerate controls to the ScriptEditor's reveal pair list (`dashboard/index.html:2031-2060`).

**Files:**
- Modify: `dashboard/index.html` (ScriptEditor component)

- [ ] **Step 1: Add regen state + handler in ScriptEditor**

Inside the ScriptEditor component (the one starting ~line 1946 that has `hookText`/`pairs` state), add a state for tracking which pair/scope is regenerating, near the other `useState` calls (e.g. after the `pairs` state is set up):
```js
      const [regenBusy, setRegenBusy] = useState(''); // e.g. "0:pair", "1:after"

      async function handleRegenImages(index, scope) {
        const key = index + ':' + scope;
        setRegenBusy(key);
        try {
          onToast('Regenerating ' + scope + ' for pair ' + (index + 1) + '…', 'info');
          const updated = await api('/api/content/' + item.id + '/regenerate-images', {
            method: 'POST',
            body: { scope, pairIndex: index },
          });
          if (updated.image_pairs) {
            setPairs(updated.image_pairs.map(p => ({
              before_url: p.before_url || '', after_url: p.after_url || '', era: p.era || '',
            })));
          }
          onToast('Regenerated ' + scope + ' for pair ' + (index + 1), 'success');
        } catch (e) {
          onToast('Regen failed: ' + e.message, 'error');
        } finally {
          setRegenBusy('');
        }
      }
```
(`item`, `api`, `onToast`, `setPairs` are already in scope in this component — confirm by searching for `setPairs(` and `onToast(` usages nearby.)

- [ ] **Step 2: Render the regen buttons under each pair**

In the ScriptEditor pair map (after the era `<select>` block that ends ~line 2058, still inside the per-pair `<div>`), add:
```js
                  <div style=${{display: 'flex', gap: '0.4rem', marginTop: '0.5rem', flexWrap: 'wrap'}}>
                    <button type="button" className="btn btn-secondary btn-sm" disabled=${!!regenBusy}
                      onClick=${() => handleRegenImages(i, 'pair')}>
                      ${regenBusy === i + ':pair' ? 'Regenerating…' : '🔄 Regen pair'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled=${!!regenBusy}
                      onClick=${() => handleRegenImages(i, 'before')}>
                      ${regenBusy === i + ':before' ? '…' : 'before'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled=${!!regenBusy || !pair.before_url}
                      onClick=${() => handleRegenImages(i, 'after')}>
                      ${regenBusy === i + ':after' ? '…' : 'after'}
                    </button>
                  </div>
```

- [ ] **Step 3: Manual smoke (if key set; else visual-only check)**

`npm run dashboard` → open a reveal item's editor → confirm "🔄 Regen pair / before / after" buttons render under each pair and are disabled while one is running. With a key, click "after" and confirm the after thumbnail changes. Without a key, confirm clicking surfaces the `400 GOOGLE_API_KEY` toast.

- [ ] **Step 4: Commit**

```bash
git add dashboard/index.html
git commit -m "feat(dashboard): per-pair regenerate buttons in reveal editor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `tips JSONB` migration

**Files:**
- Create: `supabase/migration-v4-tips-array.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migration-v4-tips-array.sql`:
```sql
-- ============================================================
-- Migration v4: multi-tip support
-- Adds a `tips` JSONB array so a single `tip` content item can hold
-- several tips (the TipsEducational composition already renders an array).
-- When `tips` is NULL, the renderer/pipeline falls back to the legacy
-- single-tip columns (tip_title, tip_body, tip_icon, tip_image_url, tip_images).
-- ============================================================

ALTER TABLE tiktok_content_pool ADD COLUMN IF NOT EXISTS tips JSONB;

-- Optional length guard (1–6 tips), mirroring the image_pairs constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_tips_length'
  ) THEN
    ALTER TABLE tiktok_content_pool
      ADD CONSTRAINT chk_tips_length
      CHECK (tips IS NULL OR jsonb_array_length(tips) BETWEEN 1 AND 6);
  END IF;
END $$;

COMMENT ON COLUMN tiktok_content_pool.tips IS
  'JSON array of tip objects (camelCase to match the Remotion TipItem): '
  '{tipTitle, tipBody, tipIcon?, tipImageSrc?, tipImages?}. 1–6 elements. '
  'NULL means use the legacy single-tip columns.';
```

- [ ] **Step 2: Apply it to Supabase**

This project applies SQL via the Supabase dashboard SQL editor (no local migration runner in `package.json`). Run the contents of `supabase/migration-v4-tips-array.sql` in the Supabase SQL editor.
Verify:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'tiktok_content_pool' AND column_name = 'tips';
```
Expected: one row (`tips`). If you cannot apply it now (no DB access), record "migration written, application deferred" — later tasks that read/write `tips` will need it applied before their manual smoke steps.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration-v4-tips-array.sql
git commit -m "feat(db): add tips JSONB column for multi-tip support

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `generate-tip-content.ts` — multi-tip self-source script

Mirrors `generate-reveal-photos.ts`: Claude invents tips, then generate a background image per tip, then insert a queued `tip` row with the `tips` array (and mirror the first tip into the legacy columns for back-compat).

**Files:**
- Create: `scripts/generate-tip-content.ts`
- Modify: `package.json` (add `generate:tip-content` script)

- [ ] **Step 1: Add the npm script**

In `package.json` `"scripts"`, after `"generate:tip-images"`, add:
```json
"generate:tip-content": "node --env-file=.env --import tsx scripts/generate-tip-content.ts",
```

- [ ] **Step 2: Write the script**

Create `scripts/generate-tip-content.ts`:
```ts
#!/usr/bin/env tsx
// ============================================================
// Generate Tip Content — self-source a multi-tip educational item.
//
// Claude invents a tips topic + 4–6 tips (text + emoji icon), then we
// generate a background image per tip and insert a queued `tip` content
// item with the `tips` JSONB array. The first tip is mirrored into the
// legacy single-tip columns for backwards compatibility.
// ============================================================
// Usage:
//   npm run generate:tip-content
//   npm run generate:tip-content -- --count 5 --hint "iPhone photo scanning tips"
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { generateTipImages } from './generate-tip-images';

const anthropic = new Anthropic();

export interface GeneratedTip {
  tipTitle: string;
  tipBody: string;
  tipIcon?: string;
  tipImageSrc?: string;
  tipImages?: string[];
}

const TIPS_SYSTEM_PROMPT = `You write punchy, genuinely useful tips/educational content for EternalFrame, an AI photo restoration & memory-keeping app, formatted for short vertical video.

Guidance:
- Each tip is specific, practical and scannable. No fluff.
- "tipTitle" is a short headline (max ~50 chars).
- "tipBody" is one or two tight sentences (max ~140 chars).
- "tipIcon" is a single emoji that fits the tip (e.g. 🖼️ 📸 ✨ 🔍 🎨).

Respond ONLY with valid JSON: an array of objects, each {"tipTitle","tipBody","tipIcon"}.`;

/** Invent N distinct tips via Claude. */
export async function inventTips(count: number, hint?: string): Promise<GeneratedTip[]> {
  const userPrompt = `Generate ${count} distinct photo-restoration / memory-keeping tip${count > 1 ? 's' : ''}${
    hint ? `, themed around: ${hint}` : ''
  }. Return a JSON array of exactly ${count} object(s).`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    system: TIPS_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const clean = text.replace(/```json\s*|```\s*/g, '').trim();
  let parsed: GeneratedTip[];
  try {
    parsed = JSON.parse(clean);
  } catch {
    console.error('Failed to parse tips JSON. Raw output:\n', clean);
    throw new Error('Tip generation returned invalid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Tip generation returned no tips');
  }
  return parsed.slice(0, count);
}

export interface GenerateTipContentOptions {
  count?: number;
  hint?: string;
}

export interface GenerateTipContentResult {
  contentId: string;
  tips: GeneratedTip[];
}

/** Invent tips, generate one background image each, and insert a queued tip item. */
export async function generateTipContent(opts: GenerateTipContentOptions = {}): Promise<GenerateTipContentResult> {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const count = Math.max(1, Math.min(6, opts.count ?? 4));
  const tips = await inventTips(count, opts.hint);

  // One background image per tip (brollCount 0 => only the primary background).
  for (const tip of tips) {
    console.log(`  • ${tip.tipIcon || ''} ${tip.tipTitle}`);
    const { tipImageUrl, tipImages } = await generateTipImages(tip.tipTitle, tip.tipBody, 0);
    tip.tipImageSrc = tipImageUrl;
    tip.tipImages = tipImages;
  }

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
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to insert tip item: ${error.message}`);
  return { contentId: data.id, tips };
}

// CLI entry point
async function main() {
  const argv = process.argv.slice(2);
  const getFlag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const count = parseInt(getFlag('count') || '4', 10);
  const hint = getFlag('hint');

  console.log(`💡 Generating ${count} tip(s)${hint ? ` themed "${hint}"` : ''}...`);
  const result = await generateTipContent({ count, hint });
  console.log(`\n✅ Created tip item ${result.contentId} with ${result.tips.length} tip(s).`);
  console.log(`\nNext: npm run pipeline -- ${result.contentId}   (or pipeline:dry)`);
}

const isDirectRun = process.argv[1]?.includes('generate-tip-content');
if (isDirectRun) {
  main().catch((err) => {
    console.error('Tip content generation failed:', err);
    process.exit(1);
  });
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual smoke (if keys set; else skip + note)**

Run: `npm run generate:tip-content -- --count 4 --hint "scanning old prints"`
Expected: logs each tip, prints a new content id. Verify in Supabase that the row has a `tips` array of 4 with `tipImageSrc` populated. Requires `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`, Supabase keys, AND Task 6's migration applied. If unavailable, record "skipped — keys/migration".

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-tip-content.ts package.json
git commit -m "feat(tips): generate-tip-content self-source script (multi-tip + per-tip images)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `POST /api/generate-tip-content` endpoint + "Generate Tip with AI" UI

**Files:**
- Modify: `dashboard/server.ts` (import + new route)
- Modify: `dashboard/index.html` (AddContent tip subtab)

- [ ] **Step 1: Import + add the route**

In `dashboard/server.ts`, add to the imports near the reveal import:
```ts
import { generateTipContent } from '../scripts/generate-tip-content';
```
Add the route right after the `/api/content/:id/regenerate-images` route:
```ts
// Generate a multi-tip item with AI (Claude invents tips, Gemini makes backgrounds).
app.post('/api/generate-tip-content', async (req, res) => {
  if (!process.env.GOOGLE_API_KEY) {
    return res.status(400).json({ error: 'GOOGLE_API_KEY not set — image generation unavailable.' });
  }
  const { count = 4, hint } = req.body || {};
  try {
    const result = await generateTipContent({
      count: Math.max(1, Math.min(6, Number(count) || 4)),
      hint,
    });
    res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
```

- [ ] **Step 2: Add tip-gen state + handler in AddContent**

In `dashboard/index.html` AddContent component, near `genHint`/`genDamage` state, add:
```js
      const [genTipHint, setGenTipHint] = useState('');
      const [genTipCount, setGenTipCount] = useState(4);
      const [genTip, setGenTip] = useState(false);

      async function handleGenerateTip() {
        setGenTip(true);
        try {
          onToast('Generating tips with AI — this can take a minute…', 'info');
          const result = await api('/api/generate-tip-content', {
            method: 'POST',
            body: { count: genTipCount, hint: genTipHint || undefined },
          });
          onToast('AI tip item created (' + result.tips.length + ' tips)!', 'success');
          onSwitch('pool');
        } catch (e) {
          onToast('AI tip generation failed: ' + e.message, 'error');
        } finally {
          setGenTip(false);
        }
      }
```

- [ ] **Step 3: Add the generate panel to the tip subtab**

In `dashboard/index.html`, the tip subtab form starts where `subTab === 'reveal' ? (...) : (...)` — find the tip branch (the `else` that renders the `tip_title`/`tip_body` inputs, ~line 3084). Immediately inside that tip branch, BEFORE the existing tip title input, add:
```js
              <div className="panel" style=${{padding: '1rem', marginBottom: '1.25rem', background: 'rgba(61,156,168,0.06)', border: '1px solid rgba(61,156,168,0.25)'}}>
                <div style=${{fontWeight: 600, marginBottom: '0.5rem'}}>✨ Generate a tip video with AI</div>
                <div style=${{fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem'}}>
                  Invents several useful tips with matching background imagery. Creates a queued item.
                </div>
                <div style=${{display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap'}}>
                  <div className="form-group" style=${{flex: '1 1 260px', margin: 0}}>
                    <label className="form-label">Topic / hint (optional)</label>
                    <input className="form-input" placeholder="e.g. scanning old prints, organizing photos" value=${genTipHint} onInput=${e => setGenTipHint(e.target.value)} />
                  </div>
                  <div className="form-group" style=${{width: '90px', margin: 0}}>
                    <label className="form-label">Tips</label>
                    <select className="form-select" value=${genTipCount} onChange=${e => setGenTipCount(Number(e.target.value))}>
                      ${[3,4,5,6].map(n => html`<option key=${n} value=${n}>${n}</option>`)}
                    </select>
                  </div>
                  <button type="button" className="btn btn-teal btn-sm" style=${{whiteSpace: 'nowrap'}} onClick=${handleGenerateTip} disabled=${genTip}>
                    ${genTip ? 'Generating…' : '✨ Generate Tip with AI'}
                  </button>
                </div>
              </div>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Manual smoke (if keys + migration; else visual-only)**

`npm run dashboard` → Add Content → Tip → confirm the "✨ Generate Tip with AI" panel renders. With keys+migration, generate and confirm a queued tip item appears in the pool. Otherwise confirm the `400` toast path.

- [ ] **Step 6: Commit**

```bash
git add dashboard/server.ts dashboard/index.html
git commit -m "feat(dashboard): Generate Tip with AI flow (endpoint + UI)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Pipeline — feed the full `tips[]` array to the composition

Teach `render-video.ts` to (a) ensure per-tip images for array tips, (b) pass `tips: item.tips` to `TipsEducational`, and (c) size tip music/timing by the real tip count.

**Files:**
- Modify: `scripts/render-video.ts` — `ContentRow` type (~lines 60-75), `ensureTipImages` (226-251), tips `inputProps` (453-460), music duration (272-279).

- [ ] **Step 1: Add `tips` to the `ContentRow` type**

In `scripts/render-video.ts`, find the `ContentRow` interface (around lines 60-75, where `tip_image_url?` / `tip_images?` are declared) and add:
```ts
  tips?: Array<{
    tipTitle: string;
    tipBody: string;
    tipIcon?: string;
    tipImageSrc?: string;
    tipImages?: string[];
  }>;
```

- [ ] **Step 2: Make `ensureTipImages` array-aware**

Replace the body of `ensureTipImages` (lines 226-251) with:
```ts
async function ensureTipImages(item: ContentRow): Promise<ContentRow> {
  if (item.content_type !== 'tip') return item;
  if (!process.env.GOOGLE_API_KEY) {
    console.log('  No GOOGLE_API_KEY — skipping tip image generation.');
    return item;
  }

  // Multi-tip path: ensure every tip in the array has a background image.
  if (Array.isArray(item.tips) && item.tips.length > 0) {
    const needsImages = item.tips.some((t) => !t.tipImageSrc);
    if (!needsImages) return item;

    console.log('  Generating per-tip background imagery with AI...');
    try {
      const tips = [...item.tips];
      for (let i = 0; i < tips.length; i++) {
        if (tips[i].tipImageSrc) continue;
        const { tipImageUrl, tipImages } = await generateTipImages(
          tips[i].tipTitle || 'Photo restoration tip',
          tips[i].tipBody || '',
          0
        );
        tips[i] = { ...tips[i], tipImageSrc: tipImageUrl, tipImages };
      }
      await supabase.from('tiktok_content_pool').update({ tips }).eq('id', item.id);
      return { ...item, tips };
    } catch (err) {
      console.warn(`  Tip image generation failed: ${err instanceof Error ? err.message : err}`);
      return item;
    }
  }

  // Legacy single-tip path (unchanged behavior).
  if (item.tip_image_url) return item;
  console.log('  Generating tip background imagery with AI...');
  try {
    const { tipImageUrl, tipImages } = await generateTipImages(
      item.tip_title || 'Photo restoration tip',
      item.tip_body || ''
    );
    await supabase
      .from('tiktok_content_pool')
      .update({ tip_image_url: tipImageUrl, tip_images: tipImages })
      .eq('id', item.id);
    return { ...item, tip_image_url: tipImageUrl, tip_images: tipImages };
  } catch (err) {
    console.warn(`  Tip image generation failed: ${err instanceof Error ? err.message : err}`);
    return item;
  }
}
```

- [ ] **Step 3: Pass the `tips[]` array in inputProps**

Find the tips `inputProps` block (lines 453-460, the `else` branch that builds `tipTitle`/`tipBody`/`tipImageSrc`…). Replace that `else` branch with one that passes the array when present:
```ts
  } else {
    const tipCount = item.tips?.length || 1;
    inputProps = {
      hookText: item.hook_text || '',
      takeaway: item.caption || '',
      slogan: item.slogan,
      musicFile: musicFileProp,
      audioVolume: 0.5,
      ...(item.tips && item.tips.length > 0
        ? { tips: item.tips }
        : {
            tipTitle: item.tip_title || '',
            tipBody: item.tip_body || '',
            tipImageSrc: item.tip_image_url,
            tipImages: item.tip_images,
            tipIcon: item.tip_icon,
          }),
    };
  }
```
NOTE: keep whatever existing `hookText`/`takeaway`/`musicFile`/`slogan` keys the current code uses — match the exact prop names already present (verify against lines 453-460 before editing; the names above mirror `TipsProps`).

- [ ] **Step 4: Size tip music/timing by real tip count (TWO spots)**

There are two hardcoded `createTipsTiming(1)` calls — both must use the real tip count, or a multi-tip video's audio and frame count won't match its content.

(a) The music-duration branch (~line 278, inside `generateAudio`), `const timing = createTipsTiming(1);` → change to:
```ts
    const timing = createTipsTiming(item.tips?.length || 1);
```

(b) The `durationInFrames` calc (~line 428-431, inside the render setup), currently:
```ts
  const durationInFrames =
    item.content_type === 'reveal'
      ? createRevealTiming(pairCount).totalDuration
      : createTipsTiming(1).totalDuration;
```
→ change the tip branch to:
```ts
  const durationInFrames =
    item.content_type === 'reveal'
      ? createRevealTiming(pairCount).totalDuration
      : createTipsTiming(item.tips?.length || 1).totalDuration;
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Render smoke (if Remotion + a multi-tip item available; else skip + note)**

Run: `npm run pipeline:dry -- <tip-item-id>`
Expected: renders a video to the output dir showing all tips with their AI backgrounds. If you can't run a full render here, at minimum confirm `tsc` passes and the inputProps branch is correct by inspection. Record what was verified.

- [ ] **Step 7: Commit**

```bash
git add scripts/render-video.ts
git commit -m "feat(pipeline): render full tips[] array with per-tip AI backgrounds

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Tip image regeneration (endpoint scope + tip editor UI)

Extend `regenerate-images` with the `tip-images` scope, and render an editable tips array (with per-tip regen) in the ScriptEditor.

**Files:**
- Modify: `dashboard/server.ts` (`regenerate-images` route — replace the `tip-images` placeholder)
- Modify: `dashboard/index.html` (ScriptEditor tip branch ~lines 2064-2074)

- [ ] **Step 1: Import the tip image generator into the server**

In `dashboard/server.ts`, add near the other script imports:
```ts
import { generateTipImages } from '../scripts/generate-tip-images';
```

- [ ] **Step 2: Implement the `tip-images` scope**

In the `regenerate-images` route, replace the placeholder line `// tip-images scope is implemented in Task 10.` and its following `return res.status(400)...` with:
```ts
    if (scope === 'tip-images') {
      if (item.content_type !== 'tip') {
        return res.status(400).json({ error: 'tip-images scope is only valid for tip items' });
      }

      // Multi-tip array path.
      if (Array.isArray(item.tips) && item.tips.length > 0) {
        const tips = [...item.tips];
        const tIdx = tipIndex === undefined ? null : Number(tipIndex);
        const indices = tIdx === null ? tips.map((_, i) => i) : [tIdx];
        for (const i of indices) {
          if (i < 0 || i >= tips.length) return res.status(400).json({ error: `Invalid tipIndex ${i}` });
          const { tipImageUrl, tipImages } = await generateTipImages(
            tips[i].tipTitle || 'Photo restoration tip', tips[i].tipBody || '', 0
          );
          tips[i] = { ...tips[i], tipImageSrc: tipImageUrl, tipImages };
        }
        const { data: updated, error: updErr } = await supabase
          .from('tiktok_content_pool').update({ tips }).eq('id', item.id).select().single();
        if (updErr) return res.status(500).json({ error: updErr.message });
        return res.json(updated);
      }

      // Legacy single-tip path.
      const { tipImageUrl, tipImages } = await generateTipImages(
        item.tip_title || 'Photo restoration tip', item.tip_body || '', 0
      );
      const { data: updated, error: updErr } = await supabase
        .from('tiktok_content_pool')
        .update({ tip_image_url: tipImageUrl, tip_images: tipImages })
        .eq('id', item.id).select().single();
      if (updErr) return res.status(500).json({ error: updErr.message });
      return res.json(updated);
    }

    return res.status(400).json({ error: `Unsupported scope: ${scope}` });
```

- [ ] **Step 3: Type-check the server change**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Render an editable tips array in the ScriptEditor**

In `dashboard/index.html`, the ScriptEditor tip branch currently renders single `tipTitle`/`tipBody` inputs (lines 2064-2074). Add tips-array state near the other ScriptEditor `useState` calls:
```js
      const [tips, setTips] = useState(Array.isArray(item.tips) ? item.tips : null);

      function updateTip(i, field, value) {
        setTips(prev => prev.map((t, j) => j === i ? { ...t, [field]: value } : t));
      }

      async function handleRegenTipImage(i) {
        const key = 'tip:' + (i === null ? 'all' : i);
        setRegenBusy(key);
        try {
          onToast('Regenerating tip image…', 'info');
          const updated = await api('/api/content/' + item.id + '/regenerate-images', {
            method: 'POST',
            body: { scope: 'tip-images', tipIndex: i === null ? undefined : i },
          });
          if (Array.isArray(updated.tips)) setTips(updated.tips);
          onToast('Tip image regenerated', 'success');
        } catch (e) {
          onToast('Regen failed: ' + e.message, 'error');
        } finally {
          setRegenBusy('');
        }
      }
```
(`regenBusy`/`setRegenBusy` were added in Task 5; reuse them.)

- [ ] **Step 5: Replace the tip editor markup to handle the array**

Replace the ScriptEditor tip branch (the `html\`...\`` after `: html\`` at lines 2064-2074 that renders Tip Title/Tip Body) with:
```js
        ` : tips && tips.length > 0 ? html`
          <div style=${{marginBottom: '1rem'}}>
            <label className="form-label" style=${{marginBottom: '0.6rem', display: 'block'}}>Tips (${tips.length})</label>
            ${tips.map((t, i) => html`
              <div key=${i} className="pair-item" style=${{padding: '0.75rem', marginBottom: '0.5rem'}}>
                <div className="pair-header" style=${{marginBottom: '0.5rem'}}>
                  <span className="pair-number">${t.tipIcon || '💡'} Tip ${i + 1}</span>
                </div>
                <div className="form-group">
                  <input className="form-input" value=${t.tipTitle || ''} onInput=${e => updateTip(i, 'tipTitle', e.target.value)} placeholder="Tip title" />
                </div>
                <div className="form-group" style=${{marginTop: '0.4rem'}}>
                  <textarea className="form-textarea" rows="2" value=${t.tipBody || ''} onInput=${e => updateTip(i, 'tipBody', e.target.value)} placeholder="Tip body" />
                </div>
                ${t.tipImageSrc ? html`<img src=${t.tipImageSrc} style=${{width: '60px', height: '100px', objectFit: 'cover', borderRadius: '6px', marginTop: '0.4rem'}} />` : null}
                <div style=${{marginTop: '0.4rem'}}>
                  <button type="button" className="btn btn-secondary btn-sm" disabled=${!!regenBusy}
                    onClick=${() => handleRegenTipImage(i)}>
                    ${regenBusy === 'tip:' + i ? 'Regenerating…' : '🔄 Regen image'}
                  </button>
                </div>
              </div>
            `)}
          </div>
        ` : html`
          <div style=${{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem'}}>
            <div className="form-group">
              <label className="form-label">Tip Title</label>
              <input className="form-input" value=${tipTitle} onInput=${e => setTipTitle(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Tip Body</label>
              <textarea className="form-textarea" rows="2" value=${tipBody} onInput=${e => setTipBody(e.target.value)} />
            </div>
            <div className="form-group" style=${{gridColumn: '1 / -1'}}>
              <button type="button" className="btn btn-secondary btn-sm" disabled=${!!regenBusy}
                onClick=${() => handleRegenTipImage(null)}>
                ${regenBusy === 'tip:all' ? 'Regenerating…' : '🔄 Regen tip image'}
              </button>
            </div>
          </div>
        `}
```

- [ ] **Step 6: Persist the tips array on save**

In the ScriptEditor `handleSave` (the function around lines 1990-2006 that builds `fields`), update the tip branch (`else` at lines 2001-2004) to save the array when present:
```js
          } else {
            if (tips && tips.length > 0) {
              fields.tips = tips;
              fields.tip_title = tips[0].tipTitle;   // keep legacy columns in sync
              fields.tip_body = tips[0].tipBody;
              fields.tip_icon = tips[0].tipIcon || null;
            } else {
              fields.tip_title = tipTitle;
              fields.tip_body = tipBody;
            }
          }
```

- [ ] **Step 7: Manual smoke (visual + behavior)**

`npm run dashboard` → open a multi-tip item (created in Task 7/8) → confirm the editor lists each tip with title/body/image and a "🔄 Regen image" button; open a legacy single-tip item → confirm the old two-field editor + a single "🔄 Regen tip image" button. With keys, regen and confirm the thumbnail updates.

- [ ] **Step 8: Commit**

```bash
git add dashboard/server.ts dashboard/index.html
git commit -m "feat(dashboard): tip image regeneration + multi-tip editor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Docs + final verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

In `CLAUDE.md`, update the relevant sections:
- Under the commands block, add:
  ```
  npm run generate:tip-content -- --count 4 --hint "scanning tips"   # self-source a multi-tip item
  npm test                                                            # unit tests (node:test, pure functions)
  ```
- In the "Image generation" section, note: "before" photos now default to heavy, dramatic damage; `generate:photos -- --damage "<notes>"` (and the dashboard damage-notes field) steer specifics. Imagery can be regenerated while reviewing an item via `POST /api/content/:id/regenerate-images` (scopes: `pair`, `before`, `after`, `tip-images`).
- In the database section, note the `tips JSONB` column (migration-v4): a single `tip` item can hold 1–6 tips; the renderer falls back to legacy single-tip columns when `tips` is null.

- [ ] **Step 2: Run the unit tests**

Run: `npm test`
Expected: all `image-prompts` tests pass.

- [ ] **Step 3: Final type-check**

Run: `npx tsc --noEmit`
Expected: no new errors introduced by this work.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document damage notes, image regeneration, and multi-tip support

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: (Optional) open a PR**

Only if the user asks. `gh pr create` with a summary referencing this plan and the spec.

---

## Self-Review Notes (author checklist — completed)

- **Spec coverage:** heavier damage (Task 1–3), reveal regen pair/before/after (Task 2,4,5), tip self-source + multi-tip (Task 6,7,8), tips render passthrough (Task 9), tip regen (Task 10), docs (Task 11). All spec sections mapped.
- **Type consistency:** `GeneratedPair` (subject/story/damage_notes), `GeneratedImage` (imageBuffer/mimeType), `GeneratedTip`/tips element shape (`tipTitle,tipBody,tipIcon,tipImageSrc,tipImages`) used identically across the script, pipeline `ContentRow.tips`, composition `TipItem`, and the migration comment. `generateTipImages(title, body, brollCount)` signature matches existing code; `brollCount: 0` used wherever only a background is wanted.
- **Backward compatibility:** all new params optional; `tips` nullable with legacy fallbacks retained in both the pipeline and the editor; legacy single-pair `before_image_url`/`after_image_url` kept in sync on pair-0 regen.
- **No placeholders:** every code step contains full code; manual/smoke steps explicitly state the no-key fallback rather than faking tests.
- **Known caveat:** Tasks 7–10 manual smokes require the Task 6 migration to be applied to Supabase and live API keys; each such step says so and offers an inspection/`tsc` fallback.
