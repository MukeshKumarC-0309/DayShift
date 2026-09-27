// Local-time ISO date helpers. `new Date('YYYY-MM-DD')` parses as UTC and can
// land on the previous day west of Greenwich, so dates are always built from
// their parts here.

const pad = (n: number) => String(n).padStart(2, '0')

export function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function localToday(): string {
  return toIso(new Date())
}

export function shiftDate(iso: string, days: number): string {
  const d = fromIso(iso)
  d.setDate(d.getDate() + days)
  return toIso(d)
}

/** "24 Sept" */
export function shortDate(iso: string): string {
  return fromIso(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** "Thu 24 Sept" */
export function dayLabel(iso: string): string {
  return fromIso(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

/** "1h 05m" or "45m" */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}m`
}
