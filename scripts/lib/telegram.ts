// ============================================================
// Telegram notifier — pushes the caption + hashtags to your phone
// when a video lands in the TikTok inbox (Inbox Upload has no caption
// field, so it must be typed by hand when finishing the draft).
// Pure builders are unit-tested; the send wrapper is a thin fetch.
// ============================================================

export interface InboxMessagePayload {
  /** Full "caption #tag1 #tag2 …" string the user pastes into TikTok. */
  caption: string;
  /** Full content item id. */
  contentId: string;
  /** 'reveal' | 'tip'. */
  contentType: string;
  /** ISO timestamp the item was scheduled for; omitted line when absent. */
  scheduledFor?: string | null;
  /** Public image URL to attach as a photo; text-only when absent. */
  thumbnailUrl?: string;
  /** Dashboard deep link; omitted line when absent. */
  dashboardUrl?: string;
}

/** Escape the three HTML-sensitive chars for Telegram HTML parse mode. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Format an ISO timestamp in the server's local timezone, e.g. "Jun 6, 2026, 9:00 AM". */
function formatScheduled(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Build the Telegram message body (HTML parse mode) and pick the photo URL.
 * Pure — no I/O — so it is fully unit-testable.
 */
export function buildInboxMessage(p: InboxMessagePayload): { text: string; photoUrl?: string } {
  const shortId = p.contentId.slice(0, 8);
  const lines: string[] = [
    '📥 New TikTok draft ready to post',
    '',
    `${p.contentType} · ${shortId}`,
  ];
  if (p.scheduledFor) {
    lines.push(`🗓 Scheduled: ${formatScheduled(p.scheduledFor)}`);
  }
  lines.push('', 'Caption (tap to copy):', `<code>${escapeHtml(p.caption)}</code>`);
  if (p.dashboardUrl) {
    lines.push('', `🔗 <a href="${p.dashboardUrl}">Open in dashboard</a>`);
  }
  return { text: lines.join('\n'), photoUrl: p.thumbnailUrl };
}
