# Mobile Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the EternalFrame TikTok Engine dashboard fully usable on mobile devices and accessible remotely via Cloudflare Tunnel with basic auth.

**Architecture:** Add responsive CSS media queries to the existing single-file HTML dashboard for phone (`<768px`) and tablet (`768-1024px`) breakpoints. Add a fixed bottom navigation bar for mobile. Add `express-basic-auth` middleware to the Express server with localhost bypass. Document Cloudflare Tunnel setup.

**Tech Stack:** CSS media queries, inline SVG icons, `express-basic-auth` npm package, Cloudflare Tunnel (documented setup)

**Spec:** `docs/superpowers/specs/2026-04-15-mobile-dashboard-design.md`

---

### Task 1: Add Basic Auth Middleware to Express Server

**Files:**
- Modify: `dashboard/server.ts:1-29`
- Modify: `package.json` (add dependency)
- Modify: `.env.example` (add auth vars)

- [ ] **Step 1: Install express-basic-auth**

```bash
npm install express-basic-auth
```

- [ ] **Step 2: Add auth middleware to server.ts**

Add the import at the top of `dashboard/server.ts` after the existing imports (after line 9):

```typescript
import basicAuth from 'express-basic-auth';
```

Then add the middleware after `app.use(express.json());` (after line 21) and before the static asset serving:

```typescript
// Basic auth for remote access (skipped for localhost)
if (process.env.DASHBOARD_USER && process.env.DASHBOARD_PASS) {
  app.use((req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
    if (isLocal) return next();
    return basicAuth({
      users: { [process.env.DASHBOARD_USER!]: process.env.DASHBOARD_PASS! },
      challenge: true,
      realm: 'EternalFrame Dashboard',
    })(req, res, next);
  });
}
```

- [ ] **Step 3: Add env vars to .env.example**

Append to the end of `.env.example`:

```
# Dashboard auth (required for remote access via Cloudflare Tunnel)
# Leave blank for local-only usage (no auth required on localhost)
DASHBOARD_USER=
DASHBOARD_PASS=
```

- [ ] **Step 4: Verify server starts without auth vars set**

```bash
npm run dashboard
```

Expected: Server starts normally at `http://localhost:3001` with no auth challenge. Ctrl+C to stop.

- [ ] **Step 5: Commit**

```bash
git add dashboard/server.ts package.json package-lock.json .env.example
git commit -m "feat(dashboard): add basic auth middleware for remote access

Adds express-basic-auth with localhost bypass. Auth is only active
when DASHBOARD_USER and DASHBOARD_PASS env vars are set."
```

---

### Task 2: Add Bottom Navigation Bar and Global Mobile CSS

This task adds the mobile bottom nav HTML/JS component and the global responsive CSS that affects all tabs (breakpoints, padding, body spacing, buttons, modals, toasts).

**Files:**
- Modify: `dashboard/index.html` (CSS `</style>` section and App component)

- [ ] **Step 1: Add bottom nav CSS**

Insert the following CSS just before the closing `</style>` tag (before line 1304 in `dashboard/index.html`):

```css
    /* ===== MOBILE BOTTOM NAV ===== */
    .bottom-nav {
      display: none;
    }

    @media (max-width: 767px) {
      .bottom-nav {
        display: flex;
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 100;
        background: linear-gradient(180deg, rgba(22, 33, 62, 0.95) 0%, rgba(26, 26, 46, 0.98) 100%);
        backdrop-filter: blur(20px);
        border-top: 1px solid var(--glass-border);
        padding: 0.4rem 0;
        padding-bottom: calc(0.4rem + env(safe-area-inset-bottom, 0px));
      }

      .bottom-nav-item {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.2rem;
        background: none;
        border: none;
        color: var(--text-muted);
        font-family: 'DM Sans', sans-serif;
        font-size: 0.6rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        cursor: pointer;
        padding: 0.35rem 0;
        transition: color 0.2s ease;
      }

      .bottom-nav-item.active {
        color: var(--amber);
      }

      .bottom-nav-item svg {
        width: 22px;
        height: 22px;
      }
    }
```

- [ ] **Step 2: Add global responsive CSS**

Insert the following CSS right after the bottom nav CSS added in Step 1, still before `</style>`:

```css
    /* ===== GLOBAL RESPONSIVE ===== */
    @media (max-width: 767px) {
      body {
        padding-bottom: 80px;
      }

      .top-bar {
        padding: 0.75rem 1rem;
      }

      .logo-subtitle {
        display: none;
      }

      .tab-nav {
        display: none;
      }

      .tab-content {
        padding: 1rem;
        max-width: 100%;
      }

      .modal-content {
        width: 100%;
        height: 100%;
        max-width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .modal-video {
        border-radius: 0;
        max-height: 80vh;
      }

      .modal-close {
        top: 1rem;
        right: 1rem;
        position: fixed;
        z-index: 1001;
      }

      .toast-container {
        left: 1rem;
        right: 1rem;
      }

      .toast {
        width: 100%;
      }

      .btn {
        min-height: 44px;
      }

      .stats-grid {
        grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
      }
    }

    @media (min-width: 768px) and (max-width: 1024px) {
      .tab-content {
        padding: 1.25rem 1.5rem;
      }
    }
```

- [ ] **Step 3: Add bottom nav to App component**

In the `App` function (around line 2296), replace the return statement with the version that includes the bottom nav. Find the `</div>` that closes `.app-shell` (line 2331) and insert the bottom nav just before it:

Replace in the App component return, right before the final closing `</div>` of `.app-shell`:

```javascript
        <div className="bottom-nav">
          <button className=${"bottom-nav-item" + (tab === 'pool' ? ' active' : '')} onClick=${() => setTab('pool')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            Pool
          </button>
          <button className=${"bottom-nav-item" + (tab === 'schedule' ? ' active' : '')} onClick=${() => setTab('schedule')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Schedule
          </button>
          <button className=${"bottom-nav-item" + (tab === 'add' ? ' active' : '')} onClick=${() => setTab('add')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            Add
          </button>
          <button className=${"bottom-nav-item" + (tab === 'pipeline' ? ' active' : '')} onClick=${() => setTab('pipeline')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5,3 19,12 5,21"/></svg>
            Pipeline
          </button>
        </div>
```

- [ ] **Step 4: Test in browser**

```bash
npm run dashboard
```

Open `http://localhost:3001` in Chrome. Use DevTools (F12) > toggle device toolbar (Ctrl+Shift+M) and select iPhone 14 Pro (390px). Verify:
- Top bar: subtitle "TikTok Engine" is hidden
- Horizontal tab bar is hidden
- Bottom nav is visible with 4 icons + labels
- Tapping bottom nav switches tabs
- Body has bottom padding so content doesn't hide behind nav
- Switch to desktop width (>1024px): bottom nav is hidden, horizontal tabs visible

- [ ] **Step 5: Commit**

```bash
git add dashboard/index.html
git commit -m "feat(dashboard): add mobile bottom nav and global responsive CSS

Adds fixed bottom navigation bar for <768px screens with SVG icons.
Hides desktop tab bar on mobile. Adds global responsive adjustments
for padding, modals, toasts, and touch targets."
```

---

### Task 3: Content Pool Mobile Cards

This task makes the Content Pool tab responsive: card layout on mobile, table adjustments on tablet.

**Files:**
- Modify: `dashboard/index.html` (CSS section and ContentPool component)

- [ ] **Step 1: Add content pool responsive CSS**

Insert the following CSS in the responsive section (after the global responsive CSS from Task 2, before `</style>`):

```css
    /* ===== CONTENT POOL MOBILE ===== */
    @media (max-width: 767px) {
      .data-table-desktop {
        display: none;
      }

      .content-cards-mobile {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .content-card {
        background: var(--glass);
        border: 1px solid var(--glass-border);
        border-radius: 12px;
        padding: 1rem;
      }

      .content-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.6rem;
      }

      .content-card-badges {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .content-card-hook {
        font-size: 0.87rem;
        color: var(--text-light);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        margin-bottom: 0.6rem;
        line-height: 1.5;
      }

      .content-card-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.7rem;
        color: var(--text-muted);
      }

      .content-card-actions {
        display: flex;
        gap: 0.35rem;
        margin-top: 0.75rem;
        padding-top: 0.75rem;
        border-top: 1px solid var(--dark-border);
      }

      .content-card-actions .btn {
        flex: 1;
        justify-content: center;
      }

      /* Script editor as full-screen panel on mobile */
      .script-editor-mobile {
        position: fixed;
        inset: 0;
        z-index: 500;
        background: var(--dark);
        overflow-y: auto;
        padding: 1rem;
        animation: slideUp 0.25s ease;
      }

      @keyframes slideUp {
        from { transform: translateY(100%); }
        to { transform: translateY(0); }
      }

      .script-editor-mobile .script-editor {
        display: flex;
        flex-direction: column;
        grid-template-columns: unset;
        border: none;
        background: none;
        padding: 0;
        min-height: calc(100vh - 2rem);
      }

      .script-editor-mobile .script-editor .form-group {
        grid-column: unset;
      }

      .script-editor-mobile .script-editor .script-actions {
        margin-top: auto;
        position: sticky;
        bottom: 0;
        background: var(--dark);
        padding: 1rem 0;
      }

      .script-editor-mobile-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1rem;
        padding-bottom: 0.75rem;
        border-bottom: 1px solid var(--dark-border);
      }

      .script-editor-mobile-title {
        font-family: 'Syne', sans-serif;
        font-weight: 700;
        font-size: 1rem;
        color: var(--white);
      }
    }

    @media (min-width: 768px) {
      .content-cards-mobile {
        display: none;
      }
    }

    @media (min-width: 768px) and (max-width: 1024px) {
      .data-table .id-cell {
        display: none;
      }

      .data-table th:first-child {
        display: none;
      }

      .hook-cell {
        max-width: 180px;
      }

      .data-table td, .data-table th {
        padding: 0.6rem 0.75rem;
      }
    }
```

- [ ] **Step 2: Add mobile card rendering to ContentPool component**

In the `ContentPool` function, find the return statement (around line 1494). We need to add mobile card rendering alongside the existing table. The existing table gets wrapped in a `data-table-desktop` class, and we add a `content-cards-mobile` div.

Find the `<div className="panel">` that wraps the table (line 1497). Replace the panel block (from line 1497 to line 1569) with:

```javascript
        <div className="panel data-table-desktop">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Status</th>
                <th>Hook Text</th>
                <th>Pairs</th>
                <th>Music</th>
                <th>Scheduled</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${items.length === 0 && !loading ? html`
                <tr><td colSpan="8">
                  <div className="empty-state">
                    <div className="empty-state-icon">\ud83c\udfac</div>
                    <div className="empty-state-text">No content in the pool yet</div>
                    <div className="empty-state-hint">Switch to the Add Content tab to get started</div>
                  </div>
                </td></tr>
              ` : null}
              ${items.map(item => html`
                <${React.Fragment} key=${item.id}>
                  <tr className=${expandedId === item.id ? 'expanded' : ''} style=${{cursor: 'pointer'}} onClick=${() => setExpandedId(expandedId === item.id ? null : item.id)}>
                    <td className="id-cell">${item.id.slice(0, 8)}</td>
                    <td><${TypeBadge} type=${item.content_type} /></td>
                    <td><${StatusBadge} status=${item.status} /></td>
                    <td className="hook-cell">${item.hook_text || '\u2014'}</td>
                    <td style=${{fontSize: '0.8rem', textAlign: 'center'}}>${item.content_type === 'reveal' ? (item.image_pairs ? item.image_pairs.length : '1') : '\u2014'}</td>
                    <td style=${{fontSize: '0.75rem'}}>
                      ${item.music_file_path ? html`<span style=${{color: 'var(--green)'}} title=${item.music_style || ''}>\u266b ready</span>`
                        : item.music_style ? html`<span style=${{color: 'var(--amber)'}} title=${item.music_style}>\u266b pending</span>`
                        : html`<span style=${{color: 'var(--text-muted)'}}>\u2014</span>`}
                    </td>
                    <td className="date-cell" onClick=${e => { e.stopPropagation(); setEditingDateId(editingDateId === item.id ? null : item.id); }}>
                      ${editingDateId === item.id ? html`
                        <input
                          type="date"
                          className="form-input"
                          style=${{padding: '0.2rem 0.4rem', fontSize: '0.78rem', width: '140px'}}
                          value=${item.scheduled_for || ''}
                          onChange=${e => handleDateChange(item.id, e.target.value)}
                          onClick=${e => e.stopPropagation()}
                          autoFocus
                          onBlur=${() => setEditingDateId(null)}
                        />
                      ` : html`<span style=${{cursor: 'pointer', borderBottom: '1px dashed var(--dark-border)'}}>${formatDate(item.scheduled_for)}</span>`}
                    </td>
                    <td>
                      <div className="action-group" onClick=${e => e.stopPropagation()}>
                        ${item.video_url ? html`<button className="btn btn-ghost btn-sm" onClick=${() => setVideoUrl(item.video_url)}>\u25b6 Video</button>` : null}
                        <button className="btn btn-ghost btn-sm btn-danger" onClick=${() => handleDelete(item.id)}>\u2715</button>
                      </div>
                    </td>
                  </tr>
                  ${expandedId === item.id ? html`
                    <tr><td colSpan="8" style=${{padding: 0}}>
                      <${ScriptEditor}
                        item=${item}
                        onSave=${(fields) => handleSave(item.id, fields)}
                        onRegenerate=${() => handleRegenerate(item.id)}
                        onClose=${() => setExpandedId(null)}
                      />
                    </td></tr>
                  ` : null}
                </${React.Fragment}>
              `)}
            </tbody>
          </table>
        </div>

        <div className="content-cards-mobile">
          ${items.length === 0 && !loading ? html`
            <div className="empty-state">
              <div className="empty-state-icon">\ud83c\udfac</div>
              <div className="empty-state-text">No content in the pool yet</div>
              <div className="empty-state-hint">Switch to the Add tab to get started</div>
            </div>
          ` : null}
          ${items.map(item => html`
            <div className="content-card" key=${item.id}>
              <div className="content-card-header">
                <div className="content-card-badges">
                  <${TypeBadge} type=${item.content_type} />
                  <${StatusBadge} status=${item.status} />
                </div>
              </div>
              <div className="content-card-hook">${item.hook_text || 'No script yet'}</div>
              <div className="content-card-footer">
                <span>${formatDate(item.scheduled_for)}</span>
                <span>${item.id.slice(0, 8)}</span>
              </div>
              <div className="content-card-actions">
                <button className="btn btn-secondary btn-sm" onClick=${() => setExpandedId(expandedId === item.id ? null : item.id)}>Edit Script</button>
                ${item.video_url ? html`<button className="btn btn-ghost btn-sm" onClick=${() => setVideoUrl(item.video_url)}>\u25b6 Video</button>` : null}
                <button className="btn btn-ghost btn-sm btn-danger" onClick=${() => handleDelete(item.id)}>\u2715</button>
              </div>
            </div>
          `)}
          ${expandedId ? html`
            <div className="script-editor-mobile">
              <div className="script-editor-mobile-header">
                <span className="script-editor-mobile-title">Edit Script</span>
                <button className="btn btn-ghost" onClick=${() => setExpandedId(null)}>\u2715</button>
              </div>
              <${ScriptEditor}
                item=${items.find(i => i.id === expandedId) || {}}
                onSave=${(fields) => handleSave(expandedId, fields)}
                onRegenerate=${() => handleRegenerate(expandedId)}
                onClose=${() => setExpandedId(null)}
              />
            </div>
          ` : null}
        </div>
```

- [ ] **Step 3: Test in browser**

Open `http://localhost:3001` in Chrome DevTools mobile view (390px width). Verify:
- Content pool shows cards, not a table
- Each card has type + status badges, hook text, date, ID
- "Edit Script" button opens full-screen editor panel
- Close button dismisses the editor
- Delete button works on cards
- Switch to desktop width: table is shown, cards are hidden
- Switch to tablet width (800px): table shown but ID column hidden

- [ ] **Step 4: Commit**

```bash
git add dashboard/index.html
git commit -m "feat(dashboard): add mobile card layout for content pool

Content pool renders as stacked cards on <768px screens. Script
editor opens as full-screen slide-up panel. Desktop table unchanged."
```

---

### Task 4: Schedule Tab Mobile Layout

This task converts the schedule grid to a single-column day view on mobile with a horizontal date chip picker and tap-to-reschedule.

**Files:**
- Modify: `dashboard/index.html` (CSS and Schedule component)

- [ ] **Step 1: Add schedule mobile CSS**

Insert after the content pool mobile CSS, before `</style>`:

```css
    /* ===== SCHEDULE MOBILE ===== */
    @media (max-width: 767px) {
      .schedule-grid {
        display: none;
      }

      .schedule-mobile {
        display: block;
      }

      .date-chip-strip {
        display: flex;
        gap: 0.5rem;
        overflow-x: auto;
        padding: 0.5rem 0 1rem;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }

      .date-chip-strip::-webkit-scrollbar {
        display: none;
      }

      .date-chip {
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.15rem;
        padding: 0.5rem 0.75rem;
        border-radius: 10px;
        border: 1px solid var(--dark-border);
        background: var(--glass);
        cursor: pointer;
        transition: all 0.2s ease;
        min-width: 56px;
      }

      .date-chip.active {
        background: rgba(255, 183, 77, 0.15);
        border-color: var(--amber);
      }

      .date-chip.today {
        border-color: var(--amber);
      }

      .date-chip-day {
        font-family: 'DM Sans', sans-serif;
        font-size: 0.65rem;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--text-muted);
      }

      .date-chip.active .date-chip-day {
        color: var(--amber);
      }

      .date-chip-num {
        font-family: 'Syne', sans-serif;
        font-weight: 700;
        font-size: 1.1rem;
        color: var(--text-light);
      }

      .date-chip.active .date-chip-num {
        color: var(--amber);
      }

      .schedule-day-cards {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .schedule-mobile-card {
        background: var(--glass);
        border: 1px solid var(--glass-border);
        border-radius: 10px;
        padding: 0.85rem 1rem;
        border-left: 3px solid;
      }

      .schedule-mobile-card.type-reveal {
        border-left-color: var(--coral);
      }

      .schedule-mobile-card.type-tip {
        border-left-color: var(--teal);
      }

      .schedule-mobile-card-title {
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--text-light);
        margin-bottom: 0.4rem;
      }

      .schedule-mobile-card-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .schedule-mobile-card-reschedule {
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.7rem;
        color: var(--amber);
        background: none;
        border: 1px solid rgba(255, 183, 77, 0.3);
        border-radius: 6px;
        padding: 0.25rem 0.5rem;
        cursor: pointer;
      }

      .schedule-mobile-card-reschedule:hover {
        background: rgba(255, 183, 77, 0.1);
      }

      .scheduler-row {
        flex-direction: column;
        gap: 1rem;
      }

      .scheduler-field {
        width: 100%;
      }

      .day-picker {
        flex-wrap: wrap;
      }

      .time-input {
        width: 100%;
      }

      .scheduler-settings-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 0.75rem;
      }
    }

    @media (min-width: 768px) {
      .schedule-mobile {
        display: none;
      }
    }
```

- [ ] **Step 2: Add mobile schedule view to Schedule component**

In the `Schedule` function (around line 1733), add a `selectedDate` state and a `isMobile` check. Add these state variables at the top of the `Schedule` function, after the existing state declarations:

```javascript
      const [selectedDate, setSelectedDate] = useState(null);
      const [rescheduleId, setRescheduleId] = useState(null);
```

Then, find the return statement. After the `<${SchedulerSettings}.../>` line (line 1794) and before the existing `<div className="schedule-grid"...>` (line 1795), insert the mobile schedule view:

```javascript
        <div className="schedule-mobile">
          ${(() => {
            const allDates = weeks.flat();
            const selStr = selectedDate ? dateStr(selectedDate) : dateStr(new Date());
            const selDay = allDates.find(d => dateStr(d) === selStr) || allDates[0];
            const dayItems = selDay ? getItemsForDate(selDay) : [];

            return html`<div>
              <div className="date-chip-strip">
                ${allDates.map(d => {
                  const ds = dateStr(d);
                  const isActive = ds === (selectedDate ? dateStr(selectedDate) : dateStr(new Date()));
                  const isTodayDate = isToday(d);
                  return html`
                    <button
                      key=${ds}
                      className=${"date-chip" + (isActive ? " active" : "") + (isTodayDate ? " today" : "")}
                      onClick=${() => setSelectedDate(d)}
                    >
                      <span className="date-chip-day">${DAY_NAMES[d.getDay()]}</span>
                      <span className="date-chip-num">${d.getDate()}</span>
                    </button>
                  `;
                })}
              </div>

              <div className="schedule-day-cards">
                ${dayItems.length === 0 ? html`
                  <div className="empty-state" style=${{padding: '2rem'}}>
                    <div className="empty-state-text">No content scheduled</div>
                    <div className="empty-state-hint">Tap a different day or add content from the Add tab</div>
                  </div>
                ` : null}
                ${dayItems.map(item => html`
                  <div key=${item.id} className=${"schedule-mobile-card type-" + item.content_type}>
                    <div className="schedule-mobile-card-title">${item.hook_text || item.content_type}</div>
                    <div className="schedule-mobile-card-meta">
                      <${StatusBadge} status=${item.status} />
                      ${rescheduleId === item.id ? html`
                        <input
                          type="date"
                          className="form-input"
                          style=${{padding: '0.2rem 0.4rem', fontSize: '0.75rem', width: '140px'}}
                          value=${selDay ? dateStr(selDay) : ''}
                          onChange=${async e => {
                            const newDate = e.target.value;
                            if (!newDate) return;
                            try {
                              await api('/api/content/' + item.id, { method: 'PATCH', body: { scheduled_for: newDate } });
                              onToast('Rescheduled', 'success');
                              const updated = await api('/api/schedule');
                              setItems(updated);
                              setRescheduleId(null);
                            } catch (err) { onToast(err.message, 'error'); }
                          }}
                          onBlur=${() => setRescheduleId(null)}
                          autoFocus
                        />
                      ` : html`
                        <button className="schedule-mobile-card-reschedule" onClick=${() => setRescheduleId(item.id)}>
                          Reschedule
                        </button>
                      `}
                    </div>
                  </div>
                `)}
              </div>
            </div>`;
          })()}
        </div>
```

- [ ] **Step 3: Test in browser**

Open mobile view (390px). Navigate to Schedule tab via bottom nav. Verify:
- Date chip strip is visible and horizontally scrollable
- Today's chip is highlighted
- Tapping a chip shows that day's scheduled items
- "Reschedule" button shows a date picker
- Empty state shown for days with no content
- Desktop view: original grid still works, mobile view is hidden

- [ ] **Step 4: Commit**

```bash
git add dashboard/index.html
git commit -m "feat(dashboard): add mobile schedule day view with date chips

Schedule tab shows horizontal date chip picker and single-column
card list on mobile. Tap-to-reschedule replaces drag-and-drop.
Scheduler settings stack vertically on small screens."
```

---

### Task 5: Add Content Tab Mobile Layout

This task makes the Add Content form responsive with single-column layouts on mobile.

**Files:**
- Modify: `dashboard/index.html` (CSS section)

- [ ] **Step 1: Add content form responsive CSS**

Insert after the schedule mobile CSS, before `</style>`:

```css
    /* ===== ADD CONTENT MOBILE ===== */
    @media (max-width: 767px) {
      .form-grid {
        grid-template-columns: 1fr;
      }

      .form-group.full-width {
        grid-column: unset;
      }

      .photo-uploaders,
      .pair-photos,
      .pair-era-row {
        grid-template-columns: 1fr;
      }

      .ai-autofill-row {
        flex-direction: column;
        text-align: center;
      }

      .ai-autofill-row .btn {
        width: 100%;
        justify-content: center;
      }

      .sub-tabs {
        gap: 0.35rem;
      }

      .sub-tab {
        flex: 1;
        text-align: center;
        padding: 0.6rem 0.75rem;
        font-size: 0.7rem;
      }
    }

    @media (min-width: 768px) and (max-width: 1024px) {
      .form-grid {
        grid-template-columns: 1fr;
      }

      .form-group.full-width {
        grid-column: unset;
      }
    }
```

- [ ] **Step 2: Test in browser**

Open mobile view (390px). Navigate to Add Content tab. Verify:
- Sub-tabs (Reveal/Tip) are both visible, evenly distributed
- Photo upload zones stack vertically (before on top, after below)
- Form fields are all single-column
- Multi-pair: adding a second pair shows stacked photos per pair
- Era select and AI auto-fill button stack properly
- Submit button area works

- [ ] **Step 3: Commit**

```bash
git add dashboard/index.html
git commit -m "feat(dashboard): add responsive layout for add content form

Photo uploaders, form grids, and pair layouts go single-column
on mobile. Sub-tabs distribute evenly."
```

---

### Task 6: Pipeline Tab Mobile Layout

This task makes the Pipeline tab responsive with stacked controls and card-based history on mobile.

**Files:**
- Modify: `dashboard/index.html` (CSS section and Pipeline component)

- [ ] **Step 1: Add pipeline responsive CSS**

Insert after the add content mobile CSS, before `</style>`:

```css
    /* ===== PIPELINE MOBILE ===== */
    @media (max-width: 767px) {
      .pipeline-controls {
        flex-direction: column;
        align-items: stretch;
      }

      .pipeline-id-input {
        width: 100% !important;
      }

      .pipeline-controls .toggle-row {
        justify-content: space-between;
      }

      .pipeline-controls .btn-primary {
        width: 100%;
        justify-content: center;
      }

      .terminal-body {
        font-size: 0.8rem;
        word-break: normal;
        overflow-x: auto;
      }

      .history-table-desktop {
        display: none;
      }

      .history-cards-mobile {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 0.75rem;
      }

      .history-card {
        background: var(--dark-elevated);
        border: 1px solid var(--dark-border);
        border-radius: 8px;
        padding: 0.85rem;
      }

      .history-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.5rem;
      }

      .history-card-meta {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.7rem;
        color: var(--text-muted);
      }
    }

    @media (min-width: 768px) {
      .history-cards-mobile {
        display: none;
      }
    }
```

- [ ] **Step 2: Update Pipeline component for mobile history cards**

In the `Pipeline` function, find the history panel (around line 2233). Wrap the existing table with `history-table-desktop` class and add mobile cards.

Find `<table className="data-table">` inside the history panel (line 2235). Add `history-table-desktop` class to it by changing it to:

```javascript
          <table className="data-table history-table-desktop">
```

Then, after the closing `</table>` tag for the history table, add the mobile history cards:

```javascript
          <div className="history-cards-mobile">
            ${history.length === 0 ? html`
              <div style=${{textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)'}}>No runs yet</div>
            ` : null}
            ${history.map(run => html`
              <div className="history-card" key=${run.id}>
                <div className="history-card-header">
                  ${run.success === null ? html`<${StatusBadge} status="rendering" />`
                    : run.success ? html`<span className="status-badge status-posted"><span className="led"></span>success</span>`
                    : html`<span className="status-badge status-failed"><span className="led"></span>failed</span>`
                  }
                  <span className="duration">${formatDuration(run.started_at, run.finished_at)}</span>
                </div>
                <div className="history-card-meta">
                  <span>${formatTime(run.started_at)}</span>
                  <span>${run.dry_run ? 'dry' : 'live'}</span>
                  ${run.content_id ? html`<span>${run.content_id.slice(0, 8)}</span>` : null}
                </div>
                ${run.output ? html`
                  <button className="expand-btn" style=${{marginTop: '0.5rem'}} onClick=${() => setExpandedRun(expandedRun === run.id ? null : run.id)}>
                    ${expandedRun === run.id ? 'hide log' : 'show log'}
                  </button>
                  ${expandedRun === run.id ? html`<div className="history-output">${run.output}</div>` : null}
                ` : null}
              </div>
            `)}
          </div>
```

- [ ] **Step 3: Test in browser**

Open mobile view (390px). Navigate to Pipeline tab. Verify:
- Stats grid fits (smaller min-width from global CSS)
- Pipeline controls stacked vertically, full width
- Content ID dropdown is full width
- Terminal output is readable, scrolls horizontally for long lines
- Run history shows cards (not table) on mobile
- Each card has status badge, duration, time, expand button
- Desktop view: history table still renders normally

- [ ] **Step 4: Commit**

```bash
git add dashboard/index.html
git commit -m "feat(dashboard): add responsive pipeline tab layout

Pipeline controls stack vertically on mobile. History shows as
cards instead of table. Terminal uses horizontal scroll."
```

---

### Task 7: Create Remote Access Documentation

**Files:**
- Create: `docs/remote-access.md`

- [ ] **Step 1: Write the Cloudflare Tunnel setup guide**

Create `docs/remote-access.md`:

```markdown
# Remote Access Setup (Cloudflare Tunnel)

Access the EternalFrame dashboard from anywhere via HTTPS using Cloudflare Tunnel.

## Prerequisites

- A domain managed by Cloudflare (free plan works)
- `cloudflared` CLI installed

## 1. Install cloudflared

```bash
brew install cloudflared
```

## 2. Authenticate

```bash
cloudflared tunnel login
```

This opens a browser to authorize your Cloudflare account. Select the domain you want to use.

## 3. Create the tunnel

```bash
cloudflared tunnel create eternalframe-dash
```

Note the tunnel ID from the output (e.g., `a1b2c3d4-...`).

## 4. Route DNS

```bash
cloudflared tunnel route dns eternalframe-dash dashboard.yourdomain.com
```

Replace `dashboard.yourdomain.com` with your actual subdomain.

## 5. Configure

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <your-tunnel-id>
credentials-file: /Users/<you>/.cloudflared/<your-tunnel-id>.json

ingress:
  - hostname: dashboard.yourdomain.com
    service: http://localhost:3001
  - service: http_status:404
```

## 6. Set dashboard credentials

In your `.env` file:

```
DASHBOARD_USER=your-username
DASHBOARD_PASS=your-secure-password
```

Auth is only active when these are set. Localhost access always bypasses auth.

## 7. Start the tunnel

```bash
# Terminal 1: Start the dashboard
npm run dashboard

# Terminal 2: Start the tunnel
cloudflared tunnel run eternalframe-dash
```

Visit `https://dashboard.yourdomain.com` -- you'll be prompted for basic auth credentials.

## Optional: Run tunnel as a system service

```bash
sudo cloudflared service install
```

This starts the tunnel on boot. See [Cloudflare docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/local-management/as-a-service/) for details.

## Troubleshooting

- **502 Bad Gateway**: Dashboard server isn't running. Start it with `npm run dashboard`.
- **Auth not working**: Check `DASHBOARD_USER` and `DASHBOARD_PASS` are set in `.env` and restart the dashboard.
- **Tunnel not connecting**: Run `cloudflared tunnel info eternalframe-dash` to check status.
```

- [ ] **Step 2: Commit**

```bash
git add docs/remote-access.md
git commit -m "docs: add Cloudflare Tunnel remote access setup guide"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Start the dashboard**

```bash
npm run dashboard
```

- [ ] **Step 2: Test all mobile views**

Open Chrome DevTools, toggle device toolbar, select iPhone 14 Pro (390px). Walk through all tabs:

1. **Content Pool**: Cards visible, script editor opens as full-screen panel, delete works
2. **Schedule**: Date chips scroll, tap shows day content, reschedule button opens date picker
3. **Add Content**: Single-column forms, photo uploaders stacked, sub-tabs fit
4. **Pipeline**: Controls stacked, terminal readable, history cards work

- [ ] **Step 3: Test tablet view**

Switch to iPad (810px):
1. Content pool table visible (ID column hidden)
2. Schedule grid visible
3. Form fields single-column
4. Pipeline layout normal with tighter padding

- [ ] **Step 4: Test desktop unchanged**

Switch to desktop width (1200px+):
1. All layouts match original design
2. Bottom nav hidden
3. Horizontal tab bar visible
4. No visual regressions

- [ ] **Step 5: Test basic auth**

Set `DASHBOARD_USER=admin` and `DASHBOARD_PASS=test123` in `.env`. Restart dashboard. Access from a non-localhost address (or use curl):

```bash
# Should return 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001 --interface lo0 -H "Host: external"

# Localhost should work without auth
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001
```

Expected: localhost access works without auth. Remote access requires credentials.
