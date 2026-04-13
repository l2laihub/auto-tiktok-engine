# EternalFrame Auto-TikTok Engine — User Guide

This guide is for anyone managing TikTok content through the dashboard. No coding or technical knowledge required.

---

## 1. Getting Started

### What the system does

The Auto-TikTok Engine turns your EternalFrame content into finished TikTok videos automatically. You provide the raw material — photo pairs or restoration tips — and the system:

- Generates a hook, caption, and hashtags using AI
- Renders a branded 15-second vertical video
- Posts it to your TikTok account (@huybuilds) on the scheduled day

There are two content types:

- **Before/After Reveal** — A damaged or faded photo transforms into a crisp AI-restored version. Great for emotional storytelling.
- **Tips/Educational** — A quick insight about photo restoration or AI image processing. Good for building authority.

Videos are published Monday, Wednesday, and Friday — three per week.

### Opening the dashboard

1. Open a terminal and navigate to the project folder.
2. Run `npm run dashboard`.
3. Open your browser and go to **http://localhost:3001**.

The dashboard has four tabs across the top: **Content Pool**, **Schedule**, **Add Content**, and **Pipeline**. You will use all four in a typical week.

---

## 2. Content Pool

The **Content Pool** tab shows every piece of content in the system, from freshly added items to already-posted videos.

### Reading the table

Each row in the table represents one video. The columns are:

- **ID** — A short identifier for the item.
- **Type** — Either "reveal" or "tip".
- **Status** — A colored badge showing where the item is in the pipeline (see below).
- **Hook Text** — The opening line that appears in the video. Keep this punchy.
- **Pairs** — For reveals, how many before/after photo pairs are in the video.
- **Music** — Indicates whether a music track has been assigned.
- **Scheduled** — The date the video is set to be posted. Click this to change it inline.
- **Actions** — Buttons to view the finished video or delete the item.

### Status meanings

| Status | Color | What it means |
|--------|-------|---------------|
| queued | Amber | Added and waiting to be processed |
| scripted | Teal | AI has written the hook, caption, and hashtags |
| rendering | Coral (pulsing) | Video is actively being rendered (takes 1-3 minutes) |
| rendered | Teal | Video is ready and saved to storage |
| posted | Green | Successfully published to TikTok |
| failed | Red | Something went wrong — check the error details |

The table refreshes automatically every 5 seconds when any items are in **rendering** or **scripted** status, so you can watch progress in real time.

### Editing an item

Click any row to expand it into an inline editor.

1. **Hook Text** — Edit the opening line directly. A character counter appears; aim to stay under 60 characters for best results.
2. **Caption** — The text that appears in the TikTok post. Ideal length is 150-300 characters — a short story or context note works well.
3. **Hashtags** — Shown as pills. Click the **X** on any pill to remove it. Type a new hashtag and press **Enter** to add it. Aim for 5-8 hashtags total.
4. Click **Regenerate Script** to have the AI rewrite all three fields from scratch while keeping the original photos or tip content.

Changes save when you click away or move to a different tab.

### Viewing a finished video

Once an item reaches **rendered** or **posted** status, an eye icon appears in the **Actions** column. Click it to open the video in a preview modal without leaving the dashboard.

### Deleting an item

Click the trash icon in the **Actions** column. A confirmation prompt will appear before anything is deleted. Deleted items cannot be recovered.

---

## 3. Adding Content

Click the **Add Content** tab. Two mode buttons appear at the top — **Reveal (✦)** and **Tip (💡)**. Select the type you want to add.

### Adding a Before/After Reveal

1. Click **Reveal (✦)** at the top of the tab.
2. Click **Add Pair** to add your first photo pair. You can add up to 6 pairs per video.
3. For each pair, you will see two upload zones — **Before** and **After**.
   - Drag and drop a photo file onto the zone, or click it to browse your files.
   - File size limit is 10MB per photo.
   - After uploading, a preview appears. Click the **X** on the preview to remove and replace it.
4. Use the **era selector** dropdown below each pair to indicate the decade the photo is from (1940s through 2010s). This improves script quality.
5. Below all pairs, fill in the shared fields:
   - **Preset Used** — Choose the AI restoration style: photo-restoration, vintage-colorize, face-restoration, damage-repair, or full-enhancement.
   - **Photo Story** — Write a sentence or two about the photo. Who is in it? What is the occasion? This context helps the AI write a more personal, emotional script.
   - **Scheduled For** — Pick the date you want the video posted. Leave blank to process it as soon as possible.
6. To save time, click **Auto-fill with AI** after uploading your photos. Claude will analyze the before and after images and automatically suggest the era, photo story, and preset. You can review and edit its suggestions before submitting.
7. Click **Add Reveal** to save the item. It will appear in the Content Pool with a **queued** status.

A note on pair count: more pairs means a longer, richer video. The estimated video duration updates on screen as you add pairs.

### Adding a Tip

1. Click **Tip (💡)** at the top of the tab.
2. Fill in the fields:
   - **Tip Title** — A short, specific headline. Example: "Why faded photos turn orange over time."
   - **Tip Body** — The explanation in 2-4 sentences. Plain language works best — the AI will refine the wording.
   - **Source** — Where this insight comes from. Example: "EternalFrame autoresearch" or a blog name.
   - **Scheduled For** — Optional publish date.
3. Click **Add Tip**. The item appears in the Content Pool as **queued**.

---

## 4. Schedule

The **Schedule** tab shows a 3-week calendar that only displays Monday, Wednesday, and Friday — the three posting days.

### Reading the calendar

- **Today** is marked with an amber dot.
- Content items appear as colored cards on their scheduled date:
  - Coral cards are reveals.
  - Teal cards are tips.
- Each card shows a preview of the hook text and a small status badge.
- Date slots with no content show "empty slot" in light text.
- Items without a scheduled date do not appear on this calendar — only in the Content Pool.

### Rescheduling by drag and drop

To move a video to a different date, drag its card from one date slot and drop it onto another. The change saves immediately.

### Scheduling strategy

For a balanced content mix, try alternating reveal and tip videos throughout the week. For example:
- Monday: reveal
- Wednesday: tip
- Friday: reveal

If a date slot is empty and your pipeline runs on that day, it will pick up the next unscheduled queued item automatically.

---

## 5. Running the Pipeline

The **Pipeline** tab is where you trigger video rendering and TikTok posting.

### Stats grid

Six cards at the top show the current count of items in each status: queued, scripted, rendering, rendered, posted, and failed. The colored bars give you a quick visual of where things stand.

### Pipeline controls

Before clicking **Run Pipeline**, check these settings:

- **Dry Run toggle** (default: ON) — When dry run is on, the pipeline renders the video and uploads it to storage but does NOT post it to TikTok. Use this to preview output before publishing live. Turn it off only when you are ready to post.
- **Post Only toggle** — Skips rendering and goes straight to posting. Only use this if the video is already rendered and you just want to push it to TikTok.
- **Content ID dropdown** — Defaults to "Auto (next queued)", which picks the oldest item due for processing. You can also select a specific item by ID if you want to run the pipeline on one particular video.

When ready, click **Run Pipeline**. A loading spinner replaces the button while it runs.

### Monitoring output

The **terminal output window** below the controls shows real-time logs as the pipeline runs. Text is green on a dark background and scrolls automatically. You can watch each step complete: fetching the item, generating the script, rendering the video, uploading to storage, and posting to TikTok.

If something fails, the error message will appear here. The item's status will change to **failed** in the Content Pool.

### Run history

The table below the terminal shows the last 20 pipeline runs. Each row includes:
- The time the run started
- Which content item was processed
- The mode (dry or live)
- How long it took
- Whether it succeeded or failed

Click any row to expand and read the full log output from that run.

---

## 6. TikTok Token Management

The dashboard shows a token status indicator in the Pipeline tab area.

- **Active** — Everything is connected. Live posts will work.
- **Expired warning** — The TikTok access token has expired. Videos will still render and upload, but the final posting step will be skipped. The video will be saved for manual upload instead.

### Refreshing the token

If the refresh token is still valid, you can refresh the access token directly from the dashboard by clicking the **Refresh Token** button when the warning appears.

### Re-authenticating from scratch

If the refresh also fails (tokens expire after a long period of inactivity), you will need to re-authorize the connection:

1. Open a terminal.
2. Run `npm run tiktok:setup` and follow the instructions shown.
3. Once complete, return to the dashboard — the token status should show as active.

Until the token is restored, you can still run the pipeline in dry run mode to render and queue videos for manual posting.

---

## 7. Workflow Recipes

### Post 3 before/after reveals this week

1. Open the **Add Content** tab and select **Reveal (✦)**.
2. Upload your first before/after photo pair. Click **Auto-fill with AI** to generate the era, story, and preset automatically.
3. Review the suggestions, adjust if needed, then set **Scheduled For** to this Monday. Click **Add Reveal**.
4. Repeat steps 2-3 for a second reveal, scheduling it for Wednesday.
5. Repeat again for a third reveal, scheduling it for Friday.
6. Go to the **Schedule** tab to confirm all three appear on the calendar in the correct slots.
7. Open the **Pipeline** tab. Confirm **Dry Run** is OFF.
8. Leave the content ID on "Auto (next queued)" and click **Run Pipeline**.
9. Watch the terminal output. When it finishes, the first item will show as **posted** in the Content Pool.
10. The remaining two items will post automatically when the scheduler runs on their scheduled dates, or you can click **Run Pipeline** again manually on each day.

### Create a tip video from a blog post

1. Find a useful insight from a blog post or your own research — one clear, specific idea works best.
2. Open the **Add Content** tab and select **Tip (💡)**.
3. Write a short **Tip Title** capturing the key point.
4. In **Tip Body**, summarize the idea in 2-4 plain sentences. Do not worry about making it perfect — the AI will refine the tone.
5. In **Source**, note the blog name or "EternalFrame autoresearch".
6. Set **Scheduled For** to your next available posting day.
7. Click **Add Tip**. The item appears as **queued** in the Content Pool.
8. When you are ready to generate the script, go to the **Pipeline** tab and run the pipeline with **Dry Run** ON to review the output first.
9. Open the **Content Pool**, find your tip, and expand it to review the AI-generated hook and caption. Edit anything that does not sound right.
10. Run the pipeline again with **Dry Run** OFF to render and post.

### Re-render a failed video

1. Go to the **Content Pool** tab and find the item with a **failed** status (shown in red).
2. Click the row to expand it. Read the hook text and caption — check whether anything looks obviously wrong.
3. If the script looks fine, the failure was likely a technical issue. Go to the **Pipeline** tab.
4. In the **Content ID dropdown**, select that specific item's ID.
5. Make sure **Dry Run** is ON for a safe first attempt. Click **Run Pipeline**.
6. Watch the terminal output for any error messages.
7. If it succeeds on dry run, turn **Dry Run** OFF and run it again to post live.
8. If it fails again, read the error in the terminal carefully. Common causes are listed in the Troubleshooting section below.

### Preview before posting (dry run workflow)

Use this whenever you want to see the finished video before it goes live.

1. Add your content using the **Add Content** tab as normal.
2. Open the **Pipeline** tab. Confirm **Dry Run** is ON (it is on by default).
3. Select the content item in the dropdown or leave it on "Auto".
4. Click **Run Pipeline**. The video will render and upload to storage.
5. Once the item reaches **rendered** status in the Content Pool, click the eye icon in the **Actions** column to watch the video in the preview modal.
6. If you want changes, expand the item row and edit the hook text or caption directly. To regenerate the entire script, click **Regenerate Script**.
7. When you are happy with it, return to the **Pipeline** tab, turn **Dry Run** OFF, and click **Run Pipeline** again — this time selecting that specific item by ID.

---

## 8. Troubleshooting

**The dashboard is not loading at http://localhost:3001.**
The dashboard server may not be running. Open a terminal and run `npm run dashboard`. Leave that terminal window open while you work.

**An item has been stuck on "rendering" for more than 10 minutes.**
Video rendering normally takes 1-3 minutes. If it is still showing as rendering after 10 minutes, the process likely crashed. Go to the **Pipeline** tab and check the run history for errors. Then try re-running the pipeline with that specific content ID.

**An item shows "failed" but I cannot tell why.**
Expand the item's row in the Content Pool — some failure details may show there. For more detail, go to the **Pipeline** tab, find the failed run in the run history, and click to expand the full log output.

**The AI-generated hook text is too long or does not sound right.**
Click the item row in the Content Pool to expand the editor. Edit the hook text manually (keep it under 60 characters), or click **Regenerate Script** to have the AI try again. You can regenerate as many times as you like without affecting your photos or tip content.

**The video posted to TikTok but the caption looks wrong.**
TikTok captions cannot be edited after posting through the API. Log into TikTok directly and edit the caption there, or delete and re-post manually.

**"Dry Run" was on and the video never actually posted.**
That is expected behavior. Dry run renders the video but skips posting. To post, return to the Pipeline tab, turn **Dry Run** OFF, select the item by ID in the dropdown, and click **Run Pipeline** again.

**The TikTok token expired warning appeared.**
Videos will still render normally. Posting will be skipped until the token is restored. Try clicking **Refresh Token** in the Pipeline tab. If that does not work, run `npm run tiktok:setup` in a terminal to re-authorize from scratch.

**I added content but it is not showing on the Schedule calendar.**
Only items with a scheduled date appear on the calendar. Open the **Content Pool**, find your item, and click its scheduled date cell to set a date. Items without a date are still in the pool and will be processed automatically by the pipeline in order.

**The "Auto-fill with AI" button did nothing.**
Make sure you have uploaded at least one before photo and one after photo before clicking the button. Both upload zones must have a preview image visible. If uploads are still in progress (spinning indicator), wait for them to finish before clicking.
