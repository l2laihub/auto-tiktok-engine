// Local-timezone scheduling helpers, shared by the dashboard UI (served at
// /static/schedule-time.js) and unit tests. Every conversion uses the runtime's
// LOCAL timezone, which is the source of truth for scheduling. Plain ESM (no
// build step) so the browser and node/tsx can both import the same file.

const pad = (n) => String(n).padStart(2, '0');

const valid = (d) => d instanceof Date && !Number.isNaN(d.getTime());

// ISO string -> "YYYY-MM-DDTHH:mm" for <input type="datetime-local"> (local tz).
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!valid(d)) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "YYYY-MM-DDTHH:mm" (parsed as LOCAL time) -> UTC ISO string. Empty -> null.
export function fromLocalInput(local) {
  if (!local) return null;
  const d = new Date(local);
  if (!valid(d)) return null;
  return d.toISOString();
}

// ISO string (or Date) -> "YYYY-MM-DD" key for the item's LOCAL calendar date.
export function localDateKey(iso) {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (!valid(d)) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ISO string -> "May 31, 9:00 AM" local label.
export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!valid(d)) return '';
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// "YYYY-MM-DD" + optional source instant -> UTC ISO. Preserves the source's
// local time-of-day when given (used when dragging to a new day); otherwise
// defaults to 06:00 local.
export function dayKeyToISO(dateKey, timeFromIso) {
  if (!dateKey) return null;
  let hh = 6, mm = 0;
  if (timeFromIso) {
    const t = new Date(timeFromIso);
    if (valid(t)) { hh = t.getHours(); mm = t.getMinutes(); }
  }
  const d = new Date(`${dateKey}T${pad(hh)}:${pad(mm)}`);
  return valid(d) ? d.toISOString() : null;
}

// ===== Calendar view helpers (day / week / month) =====
// All anchors are local midnight so setDate arithmetic survives DST shifts.

export function atMidnight(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = atMidnight(d);
  x.setDate(x.getDate() + n);
  return x;
}

// Weeks start Sunday, matching the column headers.
export function startOfWeek(d) {
  return addDays(d, -atMidnight(d).getDay());
}

// The days a view renders. Month pads out to whole weeks so the grid is always
// 7 columns wide with no ragged first/last row.
export function periodDays(view, anchor) {
  if (view === 'day') return [atMidnight(anchor)];
  if (view === 'week') return Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i));
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const end = addDays(startOfWeek(last), 6);
  const days = [];
  for (let d = startOfWeek(first); d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

// Step one period forward (+1) or back (-1). Month steps land on the 1st so a
// 31st anchor can't skip a short month.
export function shiftAnchor(view, anchor, dir) {
  if (view === 'day') return addDays(anchor, dir);
  if (view === 'week') return addDays(anchor, dir * 7);
  return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
}
