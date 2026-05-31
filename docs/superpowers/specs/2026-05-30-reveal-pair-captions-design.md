# Two-beat per-pair captions for reveal videos

**Date:** 2026-05-30
**Status:** Approved design — ready for implementation planning

## Problem

`BeforeAfterReveal` videos currently play before/after photo pairs with only generic
on-screen text: a **"Before"** badge, a **"Restored ✦"** badge, an era badge, and a
pair counter. The rich per-pair metadata the generator already invents — a short
`label` ("Grandma's wedding"), an `era` ("1962"), a 1–2 sentence `story`, and
`damage_notes` — is persisted in `image_pairs` but never shown. The result feels
boring: just images cross-fading to music.

## Goal

Give each before/after pair an emotional, scroll-stopping **two-beat** caption plus a
factual year/location line, so each transformation reads as a small story instead of a
silent slideshow.

- **Before frame:** a "setup" line that names the loss/damage (e.g. *"Found in a flooded
  album"*).
- **After frame:** an emotional payoff line (e.g. *"Her smile, alive again"*) with a
  smaller factual line beneath it (`label · location, era`).

## Out of scope

- Tip/educational videos (`TipsEducational`) — unchanged.
- Captions for manually-uploaded pairs are *not* a target; they degrade gracefully
  (see Renderer). Backfilling copy for uploaded pairs can be a later follow-up.

## Decisions (from brainstorming)

1. **Voice:** Emotional AI-written hero line + a small factual year/location sub-line
   (combination of mockup options B and C).
2. **Structure:** Two-beat — the before frame gets its own setup line; the after frame
   lands the payoff + facts.
3. **Generation strategy:** Copy is generated in the copywriting/"script" brain
   (decoupled, re-rollable), not baked into image generation. The factual `location` is
   generated with the subject (it is factual data about the invented photo).

## Data model

`image_pairs` is a JSONB array of pair objects, so new fields are added as object keys —
**no SQL migration required**. Each pair object gains:

| Field | Origin | Example |
|-------|--------|---------|
| `location` | subject inventor (factual) | `"Saigon"` |
| `caption_before` | copywriter (copy) | `"Found in a flooded album"` |
| `caption_after` | copywriter (copy) | `"Her smile, alive again"` |

`era` and `label` already exist and are reused for the factual line. All three new
fields are optional; absence triggers graceful fallback in the renderer.

## Generation — two touchpoints, split by data nature

### `location` → subject inventor (`scripts/generate-reveal-photos.ts`)
- Extend the `inventSubjects` Claude prompt to emit a concrete `location` per subject.
- Add `location` to the `PhotoSubject` and `GeneratedPair` types and persist it into the
  `image_pairs` rows written at creation time.

### Captions → copywriter (`scripts/generate-script.ts`)
- New exported function `generatePairCaptions(pairs)` returning
  `Array<{ before: string; after: string }>` aligned by pair index.
- Uses a brand-voice system prompt with explicit two-beat rules:
  - `before`: names the loss/damage, ≤ ~40 chars, emotional, no date.
  - `after`: emotional payoff, ≤ ~40 chars.
  - Never generic ("you won't believe", "amazing").
- Receives per-pair context: `{ label, era, location, story, damage_notes }`.
- Returns validated JSON; over-length lines are truncated defensively (mirrors the
  existing `hook_text` length guard).

## Pipeline wiring (`scripts/render-video.ts`)

Add a new idempotent step **`ensureRevealCaptions(item)`** that runs **after**
`ensureRevealPhotos` (so `image_pairs` and their `damage_notes`/`location` exist) and
**before** `generateAudio`/`renderVideo`. Current order is `ensureScript` →
`ensureRevealPhotos` → `ensureTipImages` → `generateAudio` → `renderVideo`; the new step
is inserted immediately after `ensureTipImages` (its placement relative to
`ensureTipImages` is immaterial — they act on disjoint content types).

Behavior — matches the existing `ensure*` idempotent pattern:
- No-op unless `content_type === 'reveal'`.
- No-op if every pair already has `caption_before`/`caption_after` (idempotent / re-render safe).
- No-op (with a log) if `ANTHROPIC_API_KEY` is not set.
- Otherwise calls `generatePairCaptions`, merges `caption_before`/`caption_after` into
  each `image_pairs` row, persists to Supabase, and returns the updated item.

This keeps copy re-rollable independent of the (expensive) image generation.

## Renderer

### `ImagePair` interface (`src/compositions/BeforeAfterReveal.tsx`)
Add optional `captionBefore?`, `captionAfter?`, `location?`. `BeforeAfterReveal` passes
them through to `RevealPair`.

### `RevealPair.tsx`
- **Before layer:** render `captionBefore` as a serif (Playfair) hero line, bottom-center,
  above the TikTok safe area. Fade + 20px slide-up entrance starting ~20 frames after
  `beforeStart`; fade out at `transitionStart`. Existing "Before" badge retained.
- **After layer:** render `captionAfter` as the serif hero line, with a smaller factual
  line beneath built by a pure helper `buildFactualLine({ label, location, era })` →
  `"{label} · {location}, {era}"`, dropping any missing part cleanly (e.g. no location →
  `"{label} · {era}"`; nothing → empty, line omitted). Fade + slide-up entrance after
  `afterStart`; fade out before `afterEnd`. Existing "Restored ✦" badge retained.
- **Graceful fallback:** when a caption is absent, that line is simply not rendered; the
  pair looks exactly like today. No errors for legacy/uploaded pairs.

### `inputProps` mapping (`render-video.ts`)
Map `p.caption_before → captionBefore`, `p.caption_after → captionAfter`,
`p.location → location` when building the `imagePairs` prop array.

## Dashboard

In the reveal editor, surface per-pair editable fields for `location`, `caption_before`,
and `caption_after`, plus a **"🔄 Regen captions"** action that hits a small endpoint
re-running `generatePairCaptions` for the item and saving the result — mirroring the
existing regenerate-images UX and per-pair editing already in the dashboard.

## Testing

- **Unit (node:test via tsx):**
  - `buildFactualLine` — all combinations of present/missing `label`/`location`/`era`.
  - Caption validation/truncation shape in `generatePairCaptions` (pure parsing/guard
    logic, with the network call stubbed or factored out).
- **Visual:** caption entrance/exit, positioning, and safe-area clearance verified in
  Remotion Studio (`npm run studio`) and a sample `npm run render:reveal`.

## Files touched

- `scripts/generate-reveal-photos.ts` — `location` in subject invention + persistence.
- `scripts/generate-script.ts` — `generatePairCaptions()` + brand-voice two-beat prompt.
- `scripts/render-video.ts` — `ensureRevealCaptions` step + `inputProps` mapping.
- `src/compositions/BeforeAfterReveal.tsx` — `ImagePair` fields + pass-through.
- `src/components/RevealPair.tsx` — caption rendering + `buildFactualLine` helper.
- `dashboard/` — per-pair caption/location fields + regen-captions endpoint & button.
- Tests for `buildFactualLine` and caption validation.
