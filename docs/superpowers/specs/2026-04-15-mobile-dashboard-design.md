# Mobile Dashboard Access Design

## Overview

Make the EternalFrame TikTok Engine dashboard fully usable from mobile devices, with remote access via Cloudflare Tunnel. The dashboard is currently a single-file HTML app (`dashboard/index.html`) with no responsive CSS. This design adds a responsive CSS layer and basic auth for public exposure.

## Goals

- Full-control mobile experience (not just monitoring)
- Access from both local network and remotely via custom domain
- No new build steps or framework dependencies
- Desktop layout remains unchanged

## Non-Goals

- Native mobile app or PWA (can be added later)
- Separate mobile HTML file
- CSS framework migration (Tailwind, etc.)

---

## 1. Responsive CSS Layer

### Breakpoints

| Range | Target | Strategy |
|-------|--------|----------|
| `>1024px` | Desktop | No changes |
| `768px-1024px` | Tablet | Minor padding/column adjustments |
| `<768px` | Phone | Major layout restructuring |

### 1.1 Navigation (Mobile `<768px`)

**Top bar changes:**
- Hide logo subtitle text ("TikTok Engine")
- Keep logo icon + live indicator dot
- Reduce padding from `2rem` to `1rem`

**Tab bar replaced with fixed bottom navigation:**
- 4 items: Pool, Schedule, Add, Pipeline
- Each item: inline SVG icon + label (small text below). No icon library needed -- use simple SVG shapes (grid for pool, calendar for schedule, plus-circle for add, play for pipeline).
- Fixed to bottom of viewport, `z-index: 100`
- Active tab uses `var(--amber)` accent
- Glass background matching top bar style
- Height: ~60px with safe-area-inset padding for notched phones

**Current horizontal tab bar:** hidden via `display: none` at `<768px`.

### 1.2 Content Pool Tab (Mobile `<768px`)

**Table replaced with stacked cards:**
- Each card is a `.panel` with glass background
- Layout per card:
  - Row 1: type badge (reveal/tip) + status badge, right-aligned
  - Row 2: hook text, full-width, `display: -webkit-box; -webkit-line-clamp: 2`
  - Row 3: scheduled date + truncated ID, muted text
  - Row 4: action buttons (edit, delete, render) in flex row
- Gap between cards: `0.75rem`

**Inline script editor:**
- On mobile, opens as a **full-screen slide-up panel** (fixed position, `inset: 0`, `z-index: 500`)
- Single-column layout for all script fields
- Close button at top-right
- Save/cancel buttons sticky at bottom

**Tablet (`768-1024px`):**
- Keep table, hide ID column
- Reduce hook cell `max-width` to `180px`
- Tighter padding on cells

### 1.3 Schedule Tab (Mobile `<768px`)

**3-column grid replaced with single-column day view:**
- Horizontal scrollable date chip strip at top
  - Each chip: day abbreviation + date number (e.g., "Tue 15")
  - Today chip highlighted with `var(--amber)` background
  - Scrolls horizontally, shows ~5 days visible at a time
- Below the strip: single column of scheduled content cards for the selected day
- Empty state: centered text "No content scheduled"

**Drag-and-drop replaced with tap-to-reschedule:**
- Tapping a schedule card shows a date picker (native `<input type="date">`)
- Confirmation before moving
- Touch drag-and-drop is removed on mobile (kept on desktop)

**Scheduler settings panel:**
- Day picker buttons: wrap into 2 rows (4+3) using `flex-wrap: wrap`
- Time input: full width
- Toggle + fields stack vertically

**Tablet:** Keep 3-column grid with tighter padding.

### 1.4 Add Content Tab (Mobile `<768px`)

**Sub-tabs (Reveal/Tip):** Stay horizontal, they already fit.

**Photo upload zones:**
- Single column (stacked: before on top, after below)
- Upload zones keep `aspect-ratio: 4/5` but go full width
- Touch-friendly: larger tap targets

**Form grid:**
- Single column, all fields full-width (`grid-template-columns: 1fr`)
- Textarea min-height stays at `80px`

**Multi-pair uploader:**
- Each pair's photo grid: single column (before stacked on after)
- Era input fields: single column
- "Add pair" button: full width

**AI autofill row:** Stack vertically (text above button).

**Submit button:** Full width, consider sticky positioning at bottom.

**Tablet:** Keep 2-column photo uploaders, single-column form fields.

### 1.5 Pipeline Tab (Mobile `<768px`)

**Pipeline controls:**
- Stack vertically
- Content ID input: full width (remove fixed `280px` width)
- Button row: full width, flex wrap
- Dry run / post-only toggles: stack if needed

**Terminal output:**
- Full width
- Font size bump to `0.8rem` for readability
- Max-height stays at `350px`
- Horizontal scroll for long lines (remove `word-break: break-all`, add `overflow-x: auto`)

**Pipeline history:**
- Card-based layout (same pattern as content pool cards)
- Each card: timestamp, success/fail badge, duration
- Expandable output section (tap to toggle)

**Tablet:** Keep current layout with minor padding adjustments.

### 1.6 Global Mobile Adjustments

| Element | Change |
|---------|--------|
| `.tab-content` padding | `2rem` -> `1rem` |
| `.tab-content` max-width | `1400px` -> `100%` |
| Modals | Full-screen on mobile (`width: 100%; height: 100%; border-radius: 0`) |
| Toast notifications | Full width with horizontal margin |
| `.stats-grid` | `minmax(150px, 1fr)` -> `minmax(100px, 1fr)` for tighter fit |
| Buttons | Minimum touch target `44px` height per Apple HIG |
| Bottom padding on `body` | Add `80px` to account for bottom nav |

---

## 2. Remote Access

### 2.1 Basic Auth Middleware

**Package:** `express-basic-auth`

**Environment variables:**
- `DASHBOARD_USER` -- username (required for remote access)
- `DASHBOARD_PASS` -- password (required for remote access)

**Behavior:**
- If `DASHBOARD_USER` and `DASHBOARD_PASS` are set, all routes require basic auth
- Requests from `localhost` / `127.0.0.1` / `::1` skip auth (local dev stays frictionless)
- Auth challenge shows realm "EternalFrame Dashboard"

**Implementation location:** `dashboard/server.ts`, added before route definitions.

### 2.2 Cloudflare Tunnel

**Setup (documented, not automated):**

1. Install `cloudflared` (`brew install cloudflared`)
2. Authenticate: `cloudflared tunnel login`
3. Create tunnel: `cloudflared tunnel create eternalframe-dash`
4. Configure DNS: `cloudflared tunnel route dns eternalframe-dash dashboard.yourdomain.com`
5. Create config file (`~/.cloudflared/config.yml`):
   ```yaml
   tunnel: <tunnel-id>
   credentials-file: ~/.cloudflared/<tunnel-id>.json
   ingress:
     - hostname: dashboard.yourdomain.com
       service: http://localhost:3001
     - service: http_status:404
   ```
6. Run: `cloudflared tunnel run eternalframe-dash`
7. Optional: install as system service for auto-start

**Documentation:** Add a `docs/remote-access.md` with these steps.

**Environment additions to `.env.example`:**
```
# Dashboard auth (required for remote access)
DASHBOARD_USER=
DASHBOARD_PASS=
```

---

## 3. Files Changed

| File | Change |
|------|--------|
| `dashboard/index.html` | Add ~250-300 lines of `@media` queries, bottom nav HTML, touch-friendly schedule interactions |
| `dashboard/server.ts` | Add basic auth middleware (~15 lines) |
| `package.json` | Add `express-basic-auth` dependency |
| `.env.example` | Add `DASHBOARD_USER`, `DASHBOARD_PASS` |
| `docs/remote-access.md` | New file: Cloudflare Tunnel setup guide |

## 4. Testing Plan

- [ ] Desktop layout unchanged at `>1024px`
- [ ] Tablet layout correct at `768-1024px` (check content table, forms)
- [ ] Mobile layout correct at `<768px` (check all 4 tabs)
- [ ] Bottom nav works, highlights active tab
- [ ] Content pool cards display correctly on mobile
- [ ] Script editor opens as full-screen panel on mobile
- [ ] Schedule day-picker works, tap-to-reschedule functions
- [ ] Add content form is single-column, photo uploads work on mobile
- [ ] Pipeline controls stack properly, terminal is readable
- [ ] Basic auth blocks unauthenticated requests when env vars set
- [ ] Basic auth is skipped for localhost access
- [ ] Test on real iPhone/Android device via local network
- [ ] Test via Cloudflare Tunnel with HTTPS
