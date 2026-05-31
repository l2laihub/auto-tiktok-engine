// Type declarations for schedule-time.js (plain ESM shared by browser + tests).
export function toLocalInput(iso: string | null | undefined): string;
export function fromLocalInput(local: string | null | undefined): string | null;
export function localDateKey(iso: string | Date | null | undefined): string;
export function formatDateTime(iso: string | null | undefined): string;
export function dayKeyToISO(dateKey: string | null | undefined, timeFromIso?: string | null): string | null;
