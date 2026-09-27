import { useState } from 'react'

import { api } from '../api/client'
import type { CheckIn } from '../types'

/**
 * Three taps and a number: last night's sleep, energy, mood.
 *
 * Context only — nothing here feeds a score. Every field is optional, and a
 * day without a check-in stays a gap rather than being guessed.
 */

interface Props {
  date: string
  existing: CheckIn | null
  onSaved: () => void
  onSessionExpired: () => void
}

const SCALE = [1, 2, 3, 4, 5] as const

function Scale({
  label,
  low,
  high,
  value,
  onChange,
}: {
  label: string
  low: string
  high: string
  value: number | null
  onChange: (v: number | null) => void
}) {
  return (
    <div>
      <p className="mb-1.5 font-mono text-[11px] text-muted">{label}</p>
      <div className="flex items-center gap-1.5" role="radiogroup" aria-label={label}>
        <span className="w-12 text-right font-sans text-[10px] text-faint">{low}</span>
        {SCALE.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${label} ${n}`}
            // Clicking the chosen value again clears it: every field is optional.
            onClick={() => onChange(value === n ? null : n)}
            className={`grid h-8 w-8 place-items-center rounded-sm border font-mono text-xs transition-colors ${
              value === n
                ? 'border-steel bg-steel/15 text-ink'
                : 'border-edge bg-raised text-muted hover:border-muted hover:text-ink'
            }`}
          >
            {n}
          </button>
        ))}
        <span className="w-12 font-sans text-[10px] text-faint">{high}</span>
      </div>
    </div>
  )
}

export default function CheckInForm({
  date,
  existing,
  onSaved,
  onSessionExpired,
}: Props) {
  const initialSleep = existing?.sleep_minutes ?? null
  const [hours, setHours] = useState(
    initialSleep === null ? '' : String(Math.floor(initialSleep / 60)),
  )
  const [minutes, setMinutes] = useState(
    initialSleep === null ? '' : String(initialSleep % 60),
  )
  const [energy, setEnergy] = useState<number | null>(existing?.energy ?? null)
  const [mood, setMood] = useState<number | null>(existing?.mood ?? null)
  const [note, setNote] = useState(existing?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function sleepMinutes(): number | null {
    if (hours.trim() === '' && minutes.trim() === '') return null
    return Number(hours || 0) * 60 + Number(minutes || 0)
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onSaved()
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setError(e?.message ?? 'Could not save the check-in.')
    } finally {
      setBusy(false)
    }
  }

  const sleep = sleepMinutes()
  const sleepInvalid =
    sleep !== null && (Number.isNaN(sleep) || sleep < 0 || sleep > 1440)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (sleepInvalid) return
        void run(() =>
          api.setCheckIn({
            check_date: date,
            sleep_minutes: sleep,
            energy,
            mood,
            note: note.trim() || null,
          }),
        )
      }}
      className="space-y-4"
    >
      <div>
        <p className="mb-1.5 font-mono text-[11px] text-muted">Slept last night</p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={24}
            inputMode="numeric"
            placeholder="7"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className={`term-input max-w-[70px] ${sleepInvalid ? 'term-input-error' : ''}`}
            aria-label="Hours slept"
          />
          <span className="font-mono text-xs text-faint">h</span>
          <input
            type="number"
            min={0}
            max={59}
            step={5}
            inputMode="numeric"
            placeholder="30"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="term-input max-w-[70px]"
            aria-label="Minutes slept"
          />
          <span className="font-mono text-xs text-faint">min</span>
        </div>
      </div>

      <Scale
        label="Energy"
        low="drained"
        high="sharp"
        value={energy}
        onChange={setEnergy}
      />
      <Scale label="Mood" low="low" high="great" value={mood} onChange={setMood} />

      <input
        type="text"
        value={note}
        maxLength={1000}
        placeholder="Anything worth noting? (optional)"
        onChange={(e) => setNote(e.target.value)}
        className="term-input text-[13px]"
        aria-label="Check-in note"
      />

      <div className="flex items-center justify-between gap-3">
        {existing ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => api.deleteCheckIn(date))}
            className="btn-quiet font-mono text-[11px]"
            title="Remove this check-in; the day becomes a gap again"
          >
            Remove
          </button>
        ) : (
          <span className="font-sans text-[11px] text-faint">
            Context only — never part of a score.
          </span>
        )}
        <button
          type="submit"
          disabled={busy || sleepInvalid}
          className="btn shrink-0 whitespace-nowrap"
        >
          {busy ? 'Saving…' : 'Save check-in'}
        </button>
      </div>
      {error && <p className="font-mono text-xs text-critical">{error}</p>}
    </form>
  )
}
