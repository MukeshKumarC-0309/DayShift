// Shared by the timer's pieces: modes, the break record, storage, and clocks.

export type Mode = 'open' | '25' | '50'

export const MODES: { value: Mode; label: string; breakMinutes: number }[] = [
  { value: 'open', label: 'Open-ended', breakMinutes: 0 },
  { value: '25', label: 'Focus 25 · 5', breakMinutes: 5 },
  { value: '50', label: 'Focus 50 · 10', breakMinutes: 10 },
]

export const MODE_KEY = 'dayshift.focus.mode'
export const BREAK_KEY = 'dayshift.focus.break'

/** Past this, a running timer is more likely forgotten than still in use. */
export const LONG_RUN_SECONDS = 3 * 3600

/** The break after a focus block (kept in this browser only — not data). */
export interface Break {
  endsAt: number
  categoryId: number
  mode: Mode
  deadlineId: number | null
}

/** What the start form sends along with a category. */
export interface StartDetails {
  note: string
  tags: string[]
  gitRef: string
  deadlineId: number | null
}

export function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function writeStorage(key: string, value: unknown): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* Not remembered; the timer still works. */
  }
}

export function toMillis(iso: string): number {
  // Stored timestamps are local-time ISO with no zone suffix, which is how
  // the rest of the app treats dates.
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? Date.now() : t
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds)
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`
}
