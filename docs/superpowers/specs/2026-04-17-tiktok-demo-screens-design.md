# TikTok Developer Demo Screens — Design Spec

## Purpose

Standalone HTML demo page simulating the EternalFrame iOS app's TikTok integration flow. Used to screen-record a demo video for TikTok developer account submission. Must show the complete publish flow with all required UI elements per TikTok's review guidelines.

## Approach

Single self-contained HTML file at `demo/tiktok-demo.html` — no external dependencies. Phone-frame wrapper (iPhone-style, 390x844px) with 7 tap-through screens and CSS slide transitions. Screen-record the browser tab for the submission video.

## Brand

All colors from `src/config.ts` BRAND object:
- Coral: `#E85A71` (primary accent, buttons)
- Teal: `#3D9CA8` (secondary, success states)
- Amber: `#FFB74D` (tertiary, highlights)
- Dark: `#1A1A2E` (background)
- Dark Surface: `#16213E` (cards, panels)
- Text Light: `#E8E8E8` / Text Muted: `#A0A0B0`

## Phone Frame

- 390x844px viewport inside a rounded-corner bezel
- Notch cutout at top center
- Status bar: time (left), signal + wifi + battery icons (right)
- Home indicator bar at bottom
- Dark bezel color matching `#0D0D1A`

## Screen Navigation

- CSS `transform: translateX()` slide transitions between screens (300ms ease)
- Interactive elements (buttons, cards) advance to next screen on tap
- Small skip arrows (left/right) in corners for recording practice — semi-transparent, unobtrusive
- Screens auto-animate internal elements on enter (progress bars, loading steps)

## Screen 1 — App Splash

- Dark background `#1A1A2E`
- Centered EternalFrame logo from `public/eternalframe-logo.jpg`
- App name "EternalFrame" in coral below logo
- Fade-in animation on enter
- Auto-advances after 2 seconds

## Screen 2 — Photo Restoration Gallery

- Top navigation bar: back arrow (hidden/placeholder) + "My Restorations" title centered + settings icon (placeholder)
- Grid layout: 2 columns, 3 rows of restoration cards
- Each card: thumbnail image area, "Before / After" label, date text
- One card highlighted with teal border + "Completed" badge with checkmark
- Tapping the completed card advances to Screen 3
- Use placeholder gradient boxes for thumbnails (coral-to-teal gradient to suggest before/after)

## Screen 3 — Video Generation

- Top bar: back arrow + "Create TikTok Video"
- Selected restoration preview at top: before/after pair side by side
- Video preview area: embed `output/reveal-949d7485.mp4` (most recent rendered video) as a `<video>` element with poster frame, playable
- "Generate TikTok Video" button (coral, full width)
- Tapping button triggers animated step sequence:
  1. "Creating AI script..." → spinner → checkmark (1.5s)
  2. "Generating background music..." → spinner → checkmark (1.5s)
  3. "Rendering video..." → progress bar 0→100% (2s)
- After completion, "Share to TikTok" button appears (teal, full width) with slide-up animation
- Tapping "Share to TikTok" advances to Screen 4

## Screen 4 — TikTok OAuth

- Screen shows "Connect to TikTok" section
- TikTok logo (text "TikTok" in bold black on white badge)
- "EternalFrame would like to connect to your TikTok account" explanatory text
- "Connect with TikTok" button (dark/black, TikTok-branded)
- Tapping transitions to a mock Login Kit consent screen:
  - TikTok branding header
  - EternalFrame app icon + name
  - Permission list with checkmarks:
    - "Post videos on your behalf"
    - "Access your public profile information"
  - "Authorize" button (coral) + "Cancel" link (muted)
- Tapping "Authorize" shows brief loading spinner, then advances to Screen 5

## Screen 5 — Publish Screen (Critical)

This screen must be fully interactive. TikTok reviewers will scrutinize every element.

### Layout (top to bottom)

1. **Top bar**: Back arrow + "Post to TikTok" title centered

2. **Account section**: 
   - Circular avatar (40px, teal background with user initial "H")
   - "@huybuilds" nickname in white, bold
   - "EternalFrame" app name in muted text below

3. **Video preview**:
   - Rounded thumbnail (16:9 crop of the 9:16 video, or mini player)
   - Video filename/title text beside it
   - Duration badge

4. **Privacy level dropdown**:
   - Label: "Who can view this video"
   - Dropdown shows placeholder "Select privacy level" — NO pre-selected default
   - Tapping opens options: Public, Friends, Private
   - User must manually select one
   - Visual: select element styled with dark surface background, teal border on focus

5. **Interaction toggles**:
   - "Allow Comments" — toggle switch, ON by default (teal when on)
   - "Allow Duet" — toggle switch, ON by default
   - "Allow Stitch" — toggle switch, ON by default
   - Each toggle is interactive (can be tapped on/off)
   - Muted helper text: "These settings reflect your account preferences"

6. **Commercial content disclosure**:
   - "Branded content" toggle — OFF by default
   - Description: "Promote branded content or paid partnership"
   - Visually distinct section with subtle border

7. **Consent text**:
   - "By posting, you agree to TikTok's Music Usage Confirmation"
   - Small font, muted color, positioned above the post button

8. **Post button**:
   - "Post to TikTok" — coral background, full width, bottom of screen
   - Tapping advances to Screen 6

### Demo Recording Instructions for Screen 5
- Pause on this screen
- Scroll slowly to show all elements
- Tap the privacy dropdown, show the options, select one
- Toggle a switch on/off to demonstrate interactivity
- Point out the commercial content disclosure (off by default)
- Show the consent text
- Then tap Post

## Screen 6 — Upload Progress

- Top bar: "Uploading..."
- Video thumbnail at top (small, rounded)
- Animated progress bar: starts at 0%, fills to 100% over 3 seconds
- Percentage text updates: 0% → 25% → 50% → 75% → 100%
- "Uploading to TikTok..." label
- File size indicator (e.g., "12.4 MB")
- Auto-advances to Screen 7 when progress reaches 100%

## Screen 7 — Success / Inbox Confirmation

- Large teal checkmark with scale-in + bounce CSS animation
- Heading: "Video Sent to Inbox!"
- Account: "@huybuilds" with avatar
- Explanatory text: "Your video has been sent to your TikTok inbox. Open TikTok to review and publish it."
- Status badge: shows "Processing..." initially (amber), animates to "Ready for Review" (teal) after 2 seconds
- "Open TikTok" button (teal outline style)
- "Done" button (coral, full width)

This reflects the sandbox behavior where Direct Post sends to creator inbox rather than publishing live.

## File Structure

```
demo/
  tiktok-demo.html    # Single self-contained file (HTML + CSS + JS)
```

The HTML file embeds all styles and scripts inline. The only external reference is the video file from `output/` for the preview, and the logo from `public/`.

## Implementation Notes

- All CSS animations use `@keyframes` — no animation libraries
- Toggle switches are pure CSS (checkbox + label trick)
- Privacy dropdown is a styled `<select>` or custom dropdown div
- Video element uses relative path `../output/reveal-949d7485.mp4`
- Logo uses relative path `../public/eternalframe-logo.jpg`
- Phone frame uses `overflow: hidden` and `border-radius` for the bezel effect
- Each screen is a `<section>` with `position: absolute; width: 100%; height: 100%`
- Screen transitions managed by toggling a CSS class that shifts `translateX`
