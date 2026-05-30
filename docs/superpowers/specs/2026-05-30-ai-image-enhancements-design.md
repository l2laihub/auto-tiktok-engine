# AI Image Enhancements — Design

Date: 2026-05-30
Status: Approved (pending spec review)

## Problem

The "Generate with AI" feature works but is shallow in three ways:

1. **"Before" photos are too mild.** `buildBeforePrompt` produces a generic "old photo"
   look (faded, some scratches), not the dramatic tearing/fading users want for a
   compelling before→after reveal.
2. **No way to re-roll imagery while reviewing.** Once a reveal or tip item is generated,
   the only image actions are manual re-upload. There is no "regenerate this photo" button.
   (`POST /api/content/:id/regenerate` exists but regenerates the SCRIPT, not images.)
3. **Tips have no AI flow in the dashboard and are single-tip only.** The reveal flow has a
   "✨ Generate with AI" button; tips have none. Tip imagery is only ever back-filled at
   render time. The DB stores one tip per item even though the `TipsEducational` composition
   already supports a `tips[]` array.

## Current State (verified 2026-05-30)

- **Image libs already exist:** `src/utils/image-gen.ts` (`generateImage({prompt, referenceImage?, aspectRatio?})`)
  and `src/utils/storage.ts` (`uploadImageBuffer({buffer, contentType, pathPrefix})`).
- **Prompt builders:** `scripts/lib/image-prompts.ts` exports `buildBeforePrompt(s)`,
  `buildRestoreEditPrompt()`, `buildTipImagePrompt(title, body, variant)`.
- **Reveal self-source works end-to-end:** `scripts/generate-reveal-photos.ts` exports
  `inventSubjects`, `generatePair`, `generateRevealPhotos`. Server route
  `POST /api/generate-reveal-photos` (server.ts:426) calls `generateRevealPhotos` in-process.
  Dashboard has a working "✨ Generate with AI" button (Reveal subtab).
- **Tip imagery exists at render time only:** `scripts/generate-tip-images.ts` exports
  `generateTipImages(title, body, brollCount)`. Pipeline `ensureTipImages` (render-video.ts:226)
  back-fills `tip_image_url` + `tip_images` when missing. No dashboard button, no self-source.
- **Pipeline** (`scripts/render-video.ts`): fetch → ensureScript → ensureRevealPhotos →
  ensureTipImages → generateAudio → renderVideo → uploadVideo → postToTikTok.
  The Tips `inputProps` mapping (render-video.ts:453-460) passes ONLY single-tip fields
  (`tipTitle`, `tipBody`, `tipImageSrc`, `tipImages`, `tipIcon`) — never the `tips[]` array.
- **DB:** `content_type` enum is `'reveal' | 'tip'` (singular `tip`). Reveal uses
  `image_pairs JSONB` (`[{before_url, after_url, era, label}]`, length 1–6, migration-v2).
  Tips use scalar columns `tip_title`, `tip_body`, `tip_image_url`, `tip_source`,
  plus `tip_images JSONB` and `tip_icon TEXT` (migration-v3). No `tips` array column yet.
- **Composition:** `TipsEducational` accepts `tips?: TipItem[]` where
  `TipItem = {tipTitle, tipBody, tipImageSrc?, tipImages?, tipIcon?, tipSource?}`, and
  normalizes from legacy single-tip props when `tips` is absent. It already renders the
  array; the pipeline just never sends one.

## Chosen Decisions (from brainstorming)

- Damage: **heavy default + optional free-text "damage notes" override**.
- Reveal regen scope: **whole-pair AND per-image** (`before` / `after`); `after` always
  re-edits from the current `before` so the subject stays matched.
- Tip AI scope: **full self-source + regenerate tip images + multi-tip**.
- Tip storage: **add a `tips JSONB` column** (migration-v4); fall back to single columns
  when null.

## Design

### 1. Heavier "before" damage

`scripts/lib/image-prompts.ts`:
- Change signature to `buildBeforePrompt(s: PhotoSubject, damageNotes?: string): string`.
- Rewrite the damage portion to be dramatic and explicit: deep tears and rips, one or more
  torn/missing corners, large water stains and moisture blooms, deep creases and fold lines
  with cracked/flaking emulsion, heavy fading and strong yellow/sepia discoloration, brittle
  silver-mirroring, foxing and brown mold spots, scattered dust, scratches and white emulsion
  loss, frayed/curling edges — while keeping the subjects and composition recognizable beneath
  the damage. Keep the existing era/subject/clothing guidance and the "no text/watermarks/borders"
  guardrails.
- When `damageNotes` is provided, append: ` Additional damage/style direction: ${damageNotes}.`

Thread `damageNotes` through the call chain (all optional, backward compatible):
- `generatePair(subject, damageNotes?)` → passes it into `buildBeforePrompt`.
- `generateRevealPhotos(opts)` → add `opts.damageNotes`; forward to each `generatePair`.
- `POST /api/generate-reveal-photos` body gains `damageNotes?: string` → forwarded.
- Dashboard generate UI (Reveal subtab — `GenerateRevealForm`, currently posts
  `{pairs, hint, subject, era}`) gains a "Damage notes (optional)" text input → adds
  `damageNotes` to the POST body.

**Persist regeneration inputs on each pair (REQUIRED for faithful regen).**
Today `generatePair` returns only `{ before_url, after_url, era, label }`
(generate-reveal-photos.ts:106) — it discards the `subject` and `story`. Regenerating a
`before` needs the original visual subject description, so this is a correctness gap.
Change `generatePair` to also return `subject`, `story`, and `damage_notes` on the pair
object (pair objects are freeform JSON → additive, no migration). New `GeneratedPair` shape:
`{ before_url, after_url, era, label, subject, story, damage_notes? }`.

### 2. Regenerate imagery while reviewing — NEW endpoint

New granular exports in `scripts/generate-reveal-photos.ts` (factored out of `generatePair`):
- `generateBeforeImage(subject: PhotoSubject, damageNotes?: string): Promise<GeneratedImage>`
- `generateAfterFromBuffer(before: GeneratedImage): Promise<GeneratedImage>` — image-edit
  restore using the before as `referenceImage`.
- `generatePair` is refactored to call these two (no behavior change).
- A helper to fetch an existing image URL into a `GeneratedImage` buffer
  (`fetch(url)` → `arrayBuffer` → `Buffer`), used when regenerating only the `after` from a
  before that already lives in storage.

New route `POST /api/content/:id/regenerate-images` (server.ts), run **in-process**, returns
the updated row:
- Body: `{ scope: 'pair' | 'before' | 'after' | 'tip-images', pairIndex?: number, damageNotes?: string }`.
- Guard: require `GOOGLE_API_KEY`; else `400`.
- Reconstructing the `PhotoSubject` for a pair: use the pair's persisted
  `{ subject, story, era, label }` when present (new pairs have them). For legacy pairs that
  lack `subject`/`story`, fall back to item-level `photo_story`/`photo_era`, and if those are
  also absent, invent a fresh one via `inventSubjects(1)`.
- `scope: 'pair'` (reveal): for `pairIndex` (required), regenerate before (with `damageNotes`
  ?? the pair's saved `damage_notes`), then after from that new before. Upload both, replace
  `image_pairs[pairIndex]` (preserving/refreshing `subject`/`story`/`damage_notes`).
- `scope: 'before'`: regenerate only that pair's before; upload; update `before_url` (and the
  pair's `damage_notes`).
- `scope: 'after'`: fetch the pair's current `before_url` into a buffer, regenerate after from
  it; upload; update `after_url`.
- `scope: 'tip-images'` (tip): regenerate this tip item's imagery via `generateTipImages`,
  update `tip_image_url` + `tip_images`. (For multi-tip items — see §3 — accept optional
  `tipIndex` to regenerate one entry of the `tips` array; when omitted, regenerate all.)
- Wrap in try/catch → `500 { error }`.

Dashboard (reveal editor, the per-pair UI around index.html:2020-2049):
- Per pair: "🔄 Regen pair", and small "before" / "after" buttons. Each calls
  `regenerate-images` with the right scope + `pairIndex`, shows a disabled/spinner state, and
  on success swaps in the returned URLs (cache-bust with `?t=Date.now()` since storage upserts
  reuse… actually new random filenames are used, so the URL changes — no cache-bust needed).
- Optional per-pair "damage notes" input feeding `scope:'before'|'pair'`.

Dashboard (tip editor): "🔄 Regen tip image(s)" button → `scope:'tip-images'`.

### 3. Tip "Generate with AI": self-source + multi-tip + regen

**Storage — `supabase/migration-v4-tips-array.sql`:**
- `ALTER TABLE tiktok_content_pool ADD COLUMN IF NOT EXISTS tips JSONB;`
- Comment documenting the element shape:
  `{tipTitle, tipBody, tipIcon?, tipImageSrc?, tipImages?}` (camelCase to match `TipItem` /
  the composition's input props). 1–6 elements.
- No backfill needed; null `tips` means "use the legacy single-tip columns".

**New script `scripts/generate-tip-content.ts`** (mirrors `generate-reveal-photos.ts`):
- `inventTips(count, hint?)`: Claude (`claude-sonnet-4-20250514`) returns
  `{ title, hook, tips: [{tipTitle, tipBody, tipIcon}] }` (4–6 tips, single-emoji icons).
- `generateTipContent({ count?, hint? })`: invent tips, then for each tip call
  `generateTipImages(tipTitle, tipBody, brollCount)` to fill `tipImageSrc` + `tipImages`,
  and insert a queued `tip` row with the `tips` JSONB array, plus mirror the first tip into
  the legacy scalar columns (`tip_title`, `tip_body`, `tip_icon`, `tip_image_url`,
  `tip_images`) for any code path that still reads them. Returns `{ contentId, tips }`.
- CLI entry: `npm run generate:tip-content -- --count 4 --hint "iPhone scanning tips"`.

**Server `POST /api/generate-tip-content`:**
- Body `{ count?: number, hint?: string }`. Require `GOOGLE_API_KEY` (else 400).
- Run in-process via `generateTipContent` (consistent with `/api/generate-reveal-photos`,
  which is also in-process). Return `201 { contentId, tips }`.
- (No spawn/guard needed since reveal generation is already in-process and the dashboard
  serializes these from the UI.)

**Pipeline `scripts/render-video.ts`:**
- `ensureTipImages`: when `item.tips` is a non-empty array, ensure every element has
  `tipImageSrc` (generate per tip where missing) and persist the updated `tips` array;
  otherwise keep the existing single-tip back-fill (`tip_image_url`/`tip_images`).
- Tips `inputProps` mapping (render-video.ts:453-460): when `item.tips?.length`, pass
  `tips: item.tips` straight through to `TipsEducational`; else keep the current single-tip
  props. Also pass `hookText`/`takeaway`/`slogan` as today.
- Music duration: `createTipsTiming(tipCount)` should use `item.tips?.length || 1` instead of
  the hard-coded `1` (render-video.ts:278 and the equivalent in server.ts regenerate-music).

**Composition:** no change required — `TipsEducational` already renders `tips[]`.

**Dashboard:**
- "✨ Generate Tip with AI" button (Add Content → Tip subtab) with hint + tip-count inputs →
  `POST /api/generate-tip-content`, then reload content.
- Tip editor: render the `tips[]` array when present (title/body/icon + image preview per tip)
  with a per-tip "🔄 Regen image" (scope `'tip-images'`, `tipIndex`). When `tips` is null,
  keep the current single-tip editor.

### Data flow summary

```
Generate reveal:  UI → POST /api/generate-reveal-photos {pairs,hint,subject,era,damageNotes}
                     → generateRevealPhotos → generatePair → generateBeforeImage(+notes)
                     → generateAfterFromBuffer → uploadImageBuffer → insert reveal row

Regen reveal img: UI → POST /api/content/:id/regenerate-images {scope,pairIndex,damageNotes}
                     → generateBeforeImage / generateAfterFromBuffer (from current before_url)
                     → uploadImageBuffer → update image_pairs[pairIndex] → return row

Generate tip:     UI → POST /api/generate-tip-content {count,hint}
                     → inventTips → generateTipImages per tip → insert tip row (tips JSONB)

Regen tip img:    UI → POST /api/content/:id/regenerate-images {scope:'tip-images',tipIndex?}
                     → generateTipImages → update tips[tipIndex] (or scalar cols) → return row

Render tip:       pipeline ensureTipImages (fills tips[].tipImageSrc) → inputProps.tips
                     → TipsEducational renders array
```

## Files Touched

- `scripts/lib/image-prompts.ts` — heavier `buildBeforePrompt(s, damageNotes?)`.
- `scripts/generate-reveal-photos.ts` — split out `generateBeforeImage` /
  `generateAfterFromBuffer`; thread `damageNotes`; persist `damage_notes` per pair.
- `scripts/generate-tip-content.ts` — NEW (self-source multi-tip).
- `scripts/generate-tip-images.ts` — unchanged API; reused per tip.
- `scripts/render-video.ts` — `ensureTipImages` array-aware; tips `inputProps` array
  passthrough; tip music duration uses real tip count.
- `dashboard/server.ts` — `damageNotes` on `/api/generate-reveal-photos`; NEW
  `/api/content/:id/regenerate-images`; NEW `/api/generate-tip-content`; tip music duration.
- `dashboard/index.html` — damage-notes input; per-pair regen buttons; "Generate Tip with AI"
  button + tip-array editor + per-tip regen.
- `supabase/migration-v4-tips-array.sql` — NEW `tips JSONB` column.
- `package.json` — `generate:tip-content` script.
- `CLAUDE.md` — document the new flows/columns.

## Acceptance Criteria

- [ ] AI-generated "before" photos are visibly heavily damaged (tears, missing corners, water
      stains, deep creases, heavy fade) by default; an optional damage-notes field steers specifics.
- [ ] Reviewing a reveal item exposes per-pair regenerate (whole pair, before, after); `after`
      re-renders from the current before; new URLs persist and show in the editor.
- [ ] Reviewing a tip item exposes per-tip "regen image"; new URLs persist.
- [ ] "Generate Tip with AI" creates a queued `tip` item with 4–6 tips (text + emoji icons +
      per-tip background images) stored in the `tips` JSONB column.
- [ ] Tip videos render all tips with their AI backgrounds (pipeline passes the `tips[]` array).
- [ ] Existing single-tip items and the existing reveal flow continue to work unchanged.
- [ ] `npx tsc --noEmit` passes (no new errors introduced).

## Risks & Mitigations

- **Cost/latency of extra Gemini calls** — regen is user-initiated and one image at a time;
  ensure-steps stay idempotent (skip when imagery exists).
- **`after` drifting from `before`** — always pass the current before buffer as the edit
  reference image.
- **Multi-tip duration/music mismatch** — drive `createTipsTiming` and music duration from the
  real tip count, not a hard-coded `1`.
- **Backward compatibility** — `tips` column is additive and nullable; all new params optional;
  legacy single-tip render path retained when `tips` is null.
- **In-process generation blocking the event loop request** — acceptable: matches the existing
  in-process `/api/generate-reveal-photos`; the dashboard is single-user/single-instance.

## Out of Scope

- Music generation, TikTok posting, the reveal composition, and the existing script-regenerate
  endpoint (`/api/content/:id/regenerate`) are unchanged.
- No change to the `content_type` enum (tips remain `'tip'`; multi-tip lives inside one row).
