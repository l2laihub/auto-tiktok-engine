# Auto-suggested theme/hint & damage notes for "Generate with AI"

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

## Goals

- On opening a Generate panel, pre-fill the hint (and damage, for reveals) with
  a fresh suggestion that differs from last time.
- Let the operator re-roll suggestions instantly, and optionally fetch a novel
  AI-generated one.
- Keep fields fully editable/clearable — clearing preserves today's behavior
  (Claude free-choice on the backend).
- No change to the downstream generation logic.

## Non-goals (YAGNI)

- No persistence of suggestion history, favorites, or per-user tuning.
- No editing the curated pool from the UI — pools live in source.
- No change to `generate-reveal-photos` / `generate-tip-content` generation.

## Approach

**Hybrid suggestions.** A curated local pool provides instant, free suggestions
(auto-filled on load + 🎲 reshuffle). A ✨ button fetches a fresh
AI-generated suggestion when something truly novel is wanted. For reveals the
theme and damage are drawn **independently** from two pools, maximizing
combinations from a small list.

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

### 3. Dashboard `AddContent` wiring (`dashboard/index.html`)

- Import the helpers from `/static/ai-suggestions.js` (alongside the existing
  `schedule-time.js` import).
- **Auto-fill on mount / sub-tab switch:** a `useEffect` that fills the
  hint/damage fields from the curated pool **only when still empty/untouched** —
  never clobbers a typed value.
- **🎲 button** next to the inputs → instant curated re-roll, passing current
  values so `pickDistinct` excludes them.
- **✨ button** → `POST /api/suggest-generation-inputs`; on success fill fields;
  on error (incl. missing key) fall back to a curated 🎲 pick and show an `info`
  toast. A `suggesting` state disables the button while in-flight.
- Fields stay editable/clearable; cleared fields → backend free-choice as today.

## Data flow

**Auto-fill on load (curated, instant):**
```
AddContent mounts / sub-tab changes
  → useEffect: if field untouched → suggestRevealInputs() / suggestTipInputs()
  → setGenHint(...) / setGenDamage(...)
```

**🎲 reshuffle (curated, instant):**
```
click 🎲 → suggestRevealInputs({ hint: genHint, damage: genDamage })
         → pickDistinct excludes current → setState
```

**✨ AI refresh (live Claude):**
```
click ✨ → setSuggesting(true)
        → POST /api/suggest-generation-inputs { type }
        → { hint, damageNotes } → setState
   on error / no key → curated 🎲 pick + info toast
        → finally setSuggesting(false)
```

**Generate (unchanged):** the populated `genHint` / `genDamage` flow into the
existing `POST /api/generate-reveal-photos` and `/api/generate-tip-content`
calls exactly as today.

## Error handling

- ✨ endpoint failure (no key, rate limit, bad JSON) → caught client-side, fall
  back to a curated pick + `info` toast ("Used a curated suggestion"). Never
  blocks generation.
- Server endpoint: validate `type` (400), defensive JSON parse.
- `pickDistinct`: single-element pool or empty `current` → return an element,
  no infinite loop.

## Testing

- `node:test` for `public/ai-suggestions.js` (pure functions, mirrors
  `scripts/lib/__tests__/schedule-time.test.ts`):
  - `pickDistinct` never returns `current` when pool has ≥2 items.
  - 1-item pool returns the lone item.
  - `suggestRevealInputs` / `suggestTipInputs` return the right shape and
    respect exclusions.
- Endpoint + UI wiring verified manually in the running dashboard, consistent
  with how the other AI endpoints are covered.

## Files touched

- `public/ai-suggestions.js` — new.
- `public/ai-suggestions.d.ts` — new (optional types).
- `dashboard/server.ts` — new `/api/suggest-generation-inputs` endpoint.
- `dashboard/index.html` — `AddContent` import + auto-fill `useEffect` + 🎲/✨
  buttons.
- `scripts/lib/__tests__/ai-suggestions.test.ts` — new pure-function tests.
