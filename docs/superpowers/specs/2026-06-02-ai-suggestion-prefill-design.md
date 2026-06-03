# Auto-suggested theme/hint & damage notes for "Generate with AI" + recipe lineage

**Date:** 2026-06-02
**Status:** Approved — ready for implementation plan

## Problem

The dashboard's "Generate with AI" panels (Add Content → Reveal / Tip) have
manually-typed inputs: **Theme / hint** + **Damage notes** for reveals, and
**Topic / hint** for tips. Left blank, the backend lets Claude choose freely.
In practice the fields sit empty, so the operator gets little variety guidance
and has to invent themes themselves. We want the panel to **auto-suggest a
different theme/hint and damage notes each time**, so generating varied content
takes no typing.

Separately, the **input recipe** that produced each item (the hint/damage
strings and where they came from) is currently thrown away once generation
finishes — only the realized output is stored. So when a video does well on
TikTok, there's no record of the seed that made it, and no way to iterate on it.
We also want to **persist that recipe** and make it reusable.

## Goals

- On opening a Generate panel, pre-fill the hint (and damage, for reveals) with
  a fresh suggestion that differs from last time.
- Let the operator re-roll suggestions instantly, and optionally fetch a novel
  AI-generated one.
- Keep fields fully editable/clearable — clearing preserves today's behavior
  (Claude free-choice on the backend).
- Persist the recipe (`hint`, `damageNotes`, `source`) on the content row.
- Display the recipe read-only on the item, and offer a **Generate similar**
  action that pre-fills the panel from a stored recipe to iterate on a winner.
- No change to the downstream generation logic.

## Non-goals (YAGNI)

- No persistence of suggestion history beyond the per-item recipe, no favorites,
  no per-user tuning.
- No editing the curated pool from the UI — pools live in source.
- **No ingestion of TikTok view counts / analytics.** Lineage is for *manual*
  correlation: spot a winning video → match by `tiktok_post_id` → read its
  recipe → iterate. Automated optimization on views is a separate, larger
  effort.
- No change to `generate-reveal-photos` / `generate-tip-content` *generation*
  behavior (only their insert gains the recipe).

## Approach

**Hybrid suggestions.** A curated local pool provides instant, free suggestions
(auto-filled on load + 🎲 reshuffle). A ✨ button fetches a fresh
AI-generated suggestion when something truly novel is wanted. For reveals the
theme and damage are drawn **independently** from two pools, maximizing
combinations from a small list.

**Recipe lineage.** Every AI-generated item records the seed it came from in a
single `generation_meta` JSONB column. The chain *TikTok video →
`tiktok_post_id` → content row → `generation_meta`* is then complete, and a
**Generate similar** button reuses a stored recipe.

## Components

### 1. `public/ai-suggestions.js` (new — plain ESM)

Mirrors `public/schedule-time.js`: no build step, served at
`/static/ai-suggestions.js`, importable by both the browser dashboard and
`node:test`.

Exports:

- `REVEAL_THEMES: string[]` — ~20 curated reveal themes
  (e.g. "1960s Saigon wedding portrait", "WWII-era soldier's farewell photo").
- `REVEAL_DAMAGES: string[]` — ~15 curated damage descriptions
  (e.g. "deep water stains, faded edges, one torn corner").
- `TIP_TOPICS: string[]` — ~20 curated tip topics
  (e.g. "scanning old prints with your phone", "storing negatives safely").
- `pickDistinct(pool, current)` — pure: returns a random element of `pool` not
  equal to `current`. Single-element pool (or no match) returns that element;
  never loops forever.
- `suggestRevealInputs(prev?) → { hint, damageNotes }` — composes `pickDistinct`
  over the two reveal pools independently, each excluding the corresponding
  `prev` value.
- `suggestTipInputs(prev?) → { hint }` — `pickDistinct` over `TIP_TOPICS`,
  excluding `prev?.hint`.

Optional `public/ai-suggestions.d.ts` for type hints, mirroring
`schedule-time.d.ts`.

### 2. `POST /api/suggest-generation-inputs` (new — `dashboard/server.ts`)

- Body: `{ type: 'reveal' | 'tip' }`. Validates `type` ∈ {reveal, tip} → 400
  otherwise.
- Reuses the existing module-level `anthropic` client. Small, low-`max_tokens`
  call with a tight prompt: invent ONE short novel theme idea (and, for reveal,
  ONE short damage description). Parses Claude's JSON defensively (strip code
  fences), same style as the existing `/api/analyze-photos` handler.
- Returns `{ hint, damageNotes? }` (`damageNotes` only for `reveal`).
- If `ANTHROPIC_API_KEY` is unset → 400, so the UI can fall back to curated.

### 3. Schema — `supabase/migration-v6-generation-meta.sql` (new)

```sql
ALTER TABLE tiktok_content_pool
  ADD COLUMN IF NOT EXISTS generation_meta JSONB;
```

Shape (nullable; absent for hand-added/legacy items):

```json
{ "hint": "1960s Saigon wedding portrait",
  "damageNotes": "deep water stains, one torn corner",
  "source": "curated" }
```

- `hint` / `damageNotes`: the exact strings sent to generation (either may be
  null → Claude free-choice). `damageNotes` is always null for tips.
- `source` ∈ `'curated' | 'ai' | 'manual'` — best-effort, panel-level (see
  §5). Used for later "do AI seeds outperform curated?" correlation.
- Timing is **not** duplicated here — the row's existing `created_at` covers it.

### 4. Backend persist wiring

- `GenerateRevealOptions` / `GenerateTipContentOptions` gain optional
  `source?: 'curated' | 'ai' | 'manual'`.
- At insert, `generateRevealPhotos` / `generateTipContent` build
  `generation_meta = { hint: opts.hint ?? null, damageNotes: opts.damageNotes ??
  null, source: opts.source ?? null }` (tips: `damageNotes: null`) and include
  it in the `tiktok_content_pool` insert. Both functions already receive
  `hint`/`damageNotes`.
- The dashboard endpoints `/api/generate-reveal-photos` and
  `/api/generate-tip-content` pass `source` through from `req.body`.

### 5. Dashboard `AddContent` wiring (`dashboard/index.html`)

- Import the helpers from `/static/ai-suggestions.js` (alongside the existing
  `schedule-time.js` import).
- **Auto-fill on mount / sub-tab switch:** a `useEffect` that fills the
  hint/damage fields from the curated pool **only when still empty/untouched** —
  never clobbers a typed value. Sets `genSource = 'curated'`.
- **🎲 button** next to the inputs → instant curated re-roll, passing current
  values so `pickDistinct` excludes them. Sets `genSource = 'curated'`.
- **✨ button** → `POST /api/suggest-generation-inputs`; on success fill fields
  and set `genSource = 'ai'`; on error (incl. missing key) fall back to a
  curated 🎲 pick and show an `info` toast. A `suggesting` state disables the
  button while in-flight.
- **Manual edit** to hint or damage (`onInput`) → set `genSource = 'manual'`.
- Generate calls include `source: genSource` in the request body.

`genSource` is a single panel-level string reflecting *how the fields got their
final value* (last action wins). It is best-effort, not per-field — accepted as
good-enough provenance.

### 6. Display + "Generate similar" (`dashboard/index.html`)

- **Display:** in `ContentPool`'s item rendering (near the existing 🔄 Regen
  actions), when `item.generation_meta` is present, show a small read-only
  "Generated from" block: hint, damage (if any), and a `source` badge.
- **Generate similar:** lift a `genSeed` state into `App`. `ContentPool` gets an
  `onGenerateSimilar(seed)` callback that sets `genSeed = { type, hint,
  damageNotes }` (derived from the item's `generation_meta` + `content_type`)
  and switches to the `add` tab. `AddContent` gets a `seed` prop: on mount, if
  `seed` is present it selects the matching sub-tab, pre-fills `genHint`/
  `genDamage` from the seed (taking precedence over random auto-fill), then the
  parent clears `genSeed` so later visits resume random auto-fill. The button
  appears only on items that have a `generation_meta`.

## Data flow

**Auto-fill on load (curated, instant):**
```
AddContent mounts / sub-tab changes (no seed)
  → useEffect: if field untouched → suggestRevealInputs() / suggestTipInputs()
  → setGenHint(...) / setGenDamage(...) ; genSource = 'curated'
```

**🎲 reshuffle (curated, instant):**
```
click 🎲 → suggestRevealInputs({ hint: genHint, damage: genDamage })
         → pickDistinct excludes current → setState ; genSource = 'curated'
```

**✨ AI refresh (live Claude):**
```
click ✨ → setSuggesting(true)
        → POST /api/suggest-generation-inputs { type }
        → { hint, damageNotes } → setState ; genSource = 'ai'
   on error / no key → curated 🎲 pick + info toast
        → finally setSuggesting(false)
```

**Generate (persists recipe):**
```
populated genHint / genDamage / genSource
  → POST /api/generate-reveal-photos | /api/generate-tip-content { …, source }
  → generateRevealPhotos / generateTipContent inserts row with
    generation_meta = { hint, damageNotes, source }
```

**Generate similar (iterate):**
```
ContentPool item w/ generation_meta → click "Generate similar"
  → App.setGenSeed({ type, hint, damageNotes }) ; setTab('add')
  → AddContent mounts with seed → select sub-tab + pre-fill fields
  → App clears genSeed
```

## Error handling

- ✨ endpoint failure (no key, rate limit, bad JSON) → caught client-side, fall
  back to a curated pick + `info` toast ("Used a curated suggestion"). Never
  blocks generation.
- Server endpoint: validate `type` (400), defensive JSON parse.
- `pickDistinct`: single-element pool or empty `current` → return an element,
  no infinite loop.
- Items without `generation_meta` (legacy / hand-added) simply hide the
  "Generated from" block and the "Generate similar" button.

## Testing

- `node:test` for `public/ai-suggestions.js` (pure functions, mirrors
  `scripts/lib/__tests__/schedule-time.test.ts`):
  - `pickDistinct` never returns `current` when pool has ≥2 items.
  - 1-item pool returns the lone item.
  - `suggestRevealInputs` / `suggestTipInputs` return the right shape and
    respect exclusions.
- Endpoint, persist wiring, display, and "Generate similar" verified manually in
  the running dashboard, consistent with how the other AI endpoints are covered.

## Files touched

- `public/ai-suggestions.js` — new.
- `public/ai-suggestions.d.ts` — new (optional types).
- `supabase/migration-v6-generation-meta.sql` — new (`generation_meta` column).
- `dashboard/server.ts` — new `/api/suggest-generation-inputs` endpoint; pass
  `source` through the two generate endpoints.
- `scripts/generate-reveal-photos.ts` — `source` option + persist
  `generation_meta`.
- `scripts/generate-tip-content.ts` — `source` option + persist
  `generation_meta`.
- `dashboard/index.html` — `AddContent` import + auto-fill `useEffect` + 🎲/✨
  buttons + `genSource`; `App` `genSeed` state; `ContentPool` "Generated from"
  block + "Generate similar" button.
- `scripts/lib/__tests__/ai-suggestions.test.ts` — new pure-function tests.
