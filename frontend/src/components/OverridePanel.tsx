import { useState } from 'react'

import { api } from '../api/client'
import Frame from './Frame'
import type { Category } from '../types'

/**
 * Lightweight "set a future override" action: pick a date, a category and a
 * target, without going through the daily log form for a day that has not
 * happened yet (the one-day override requirement).
 *
 * Setting an override in advance creates the log row with minutes_logged = 0;
 * the user fills in the real minutes later from the log form.
 *
 * Presets (Sick day, Travel, Festival, Half day) only FILL the form — nothing
 * is saved until "Set". Several categories or a date range go through the
 * bulk endpoint, which touches only days each category is scheduled on, so a
 * preset never turns a rest day into an obligation.
 */

interface Props {
  /** Drop the panel frame and heading when shown inside a tab block. */
  embedded?: boolean
  categories: Category[]
  today: string
  onSaved: () => void
  onSessionExpired: () => void
}

const PRESETS: { label: string; reason: string; half?: boolean }[] = [
  { label: 'Sick day', reason: 'Sick day' },
  { label: 'Travel', reason: 'Travel' },
  { label: 'Festival', reason: 'Festival' },
  { label: 'Half day', reason: 'Half day', half: true },
]

const DAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const

function scheduledOn(category: Category, isoDate: string): boolean {
  const [y, m, d] = isoDate.split('-').map(Number)
  const code = DAY_CODES[new Date(y, m - 1, d).getDay()]
  return category.active_days.split(',').includes(code)
}

export default function OverridePanel({
  categories,
  today,
  onSaved,
  onSessionExpired,
  embedded = false,
}: Props) {
  const [open, setOpen] = useState(embedded)
  const [date, setDate] = useState(today)
  const [categoryId, setCategoryId] = useState<number>(categories[0]?.id ?? 0)
  const [target, setTarget] = useState('')
  const [half, setHalf] = useState(false)
  const [rangeMode, setRangeMode] = useState(false)
  const [endDate, setEndDate] = useState(today)
  const [reason, setReason] = useState('')
  const [extraCategories, setExtraCategories] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)

  const chosenIds = [
    categoryId,
    ...[...extraCategories].filter((id) => id !== categoryId),
  ]
  const nameOf = (id: number) => categories.find((c) => c.id === id)?.name ?? 'category'

  function applyPreset(preset: (typeof PRESETS)[number]) {
    const [first, ...rest] = categories.map((c) => c.id)
    setCategoryId(first)
    setExtraCategories(new Set(rest))
    setReason(preset.reason)
    setHalf(Boolean(preset.half))
    setTarget(preset.half ? '' : '0')
    setConfirmation(null)
    setError(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!half && target.trim() === '') {
      setError('Enter a target in minutes (0 clears the day).')
      return
    }
    const end = rangeMode ? endDate : date
    if (end < date) {
      setError('The range ends before it starts.')
      return
    }
    setSaving(true)
    setError(null)
    setConfirmation(null)
    const why = reason.trim() || undefined

    try {
      if (half) {
        // Half of each category's own target, on each scheduled day.
        let count = 0
        for (let d = date; d <= end; d = nextDay(d)) {
          for (const id of chosenIds) {
            const category = categories.find((c) => c.id === id)
            if (!category || !scheduledOn(category, d)) continue
            await api.upsertLog({
              log_date: d,
              category_id: id,
              override_target_minutes: Math.round(category.daily_target_minutes / 2),
              override_reason: why,
            })
            count += 1
          }
        }
        setConfirmation(
          `Half targets set on ${count} scheduled day${count === 1 ? '' : 's'}`,
        )
      } else if (chosenIds.length > 1 || rangeMode) {
        const written = await api.bulkOverride({
          start: date,
          end,
          category_ids: chosenIds,
          override_target_minutes: Number(target),
          reason: why,
          active_days_only: true,
        })
        setConfirmation(
          `${written.length} day${written.length === 1 ? '' : 's'} → ${target} min` +
            (why ? ` · ${why}` : ''),
        )
      } else {
        await api.upsertLog({
          log_date: date,
          category_id: categoryId,
          override_target_minutes: Number(target),
          override_reason: why,
          // minutes_logged deliberately omitted: a new row starts at 0 and an
          // existing row keeps whatever minutes are already recorded.
        })
        setConfirmation(`${nameOf(categoryId)} on ${date} → ${target} min`)
      }
      setTarget('')
      setHalf(false)
      onSaved()
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setError(e?.message ?? 'Could not save the override.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Frame embedded={embedded}>
      {embedded ? (
        <p className="mb-1 font-sans text-xs text-faint">
          A one-off target for one date or a range — travel, exams, a known clash.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? 'Hide schedule override' : 'Show schedule override'}
          className="flex w-full items-baseline justify-between text-left"
        >
          <span className="panel-label">Schedule override</span>
          <span className="font-mono text-xs text-muted">{open ? '−' : '+'}</span>
        </button>
      )}

      {!open && !embedded && (
        <p className="mt-1.5 font-sans text-xs text-faint">
          Set a one-off target for a future date — travel, exams, a known clash.
        </p>
      )}

      {open && (
        <form onSubmit={submit} className="mt-3 space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Presets">
            <span className="w-20 shrink-0 font-mono text-xs text-muted">Preset</span>
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset)}
                className={`rounded-sm border px-2 py-1 font-mono text-[11px] transition-colors ${
                  reason === preset.reason
                    ? 'border-steel text-steel'
                    : 'border-edge text-muted hover:border-muted hover:text-ink'
                }`}
                title={
                  preset.half
                    ? 'Every category at half its target — fills the form'
                    : 'Every category at 0 — fills the form'
                }
              >
                {preset.label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-3">
            <span className="w-20 shrink-0 font-mono text-xs text-muted">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="term-input max-w-[180px]"
            />
          </label>

          <label className="flex items-center gap-3">
            <span className="w-20 shrink-0 font-mono text-xs text-muted">Category</span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(Number(e.target.value))}
              className="term-input max-w-[220px] text-[13px]"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id} className="bg-panel">
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {categories.length > 1 && (
            <div className="flex items-start gap-3">
              <span className="w-20 shrink-0 pt-1 font-mono text-xs text-muted">
                Also
              </span>
              <div className="flex flex-wrap gap-1">
                {categories
                  .filter((c) => c.id !== categoryId)
                  .map((c) => {
                    const on = extraCategories.has(c.id)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          const next = new Set(extraCategories)
                          if (on) next.delete(c.id)
                          else next.add(c.id)
                          setExtraCategories(next)
                        }}
                        className={`rounded-sm border px-2 py-1 font-mono text-[11px] transition-colors ${
                          on
                            ? 'border-steel text-steel'
                            : 'border-edge text-faint hover:border-muted'
                        }`}
                      >
                        {c.name}
                      </button>
                    )
                  })}
              </div>
            </div>
          )}

          {rangeMode && (
            <label className="flex items-center gap-3">
              <span className="w-20 shrink-0 font-mono text-xs text-muted">Until</span>
              <input
                type="date"
                value={endDate}
                min={date}
                onChange={(e) => setEndDate(e.target.value)}
                className="term-input max-w-[180px]"
              />
            </label>
          )}

          <label className="flex items-center gap-3">
            <span className="w-20 shrink-0 font-mono text-xs text-muted">Target</span>
            {half ? (
              <span className="font-mono text-[12px] text-steel">
                half of each category&apos;s target
                <button
                  type="button"
                  onClick={() => setHalf(false)}
                  className="ml-2 text-faint underline hover:text-ink"
                >
                  set a number instead
                </button>
              </span>
            ) : (
              <>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  placeholder="Minutes"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="term-input max-w-[120px]"
                />
                <span className="font-mono text-[11px] text-faint">0 = day off</span>
              </>
            )}
          </label>

          <label className="flex items-center gap-3">
            <span className="w-20 shrink-0 font-mono text-xs text-muted">Why</span>
            <input
              type="text"
              value={reason}
              maxLength={120}
              placeholder="Exam week, travel… (optional)"
              onChange={(e) => setReason(e.target.value)}
              className="term-input text-[13px]"
              aria-label="Override reason"
            />
          </label>

          <label className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              checked={rangeMode}
              onChange={(e) => {
                setRangeMode(e.target.checked)
                if (e.target.checked && endDate < date) setEndDate(date)
              }}
              className="h-3.5 w-3.5 accent-steel"
            />
            <span className="font-mono text-[11px] text-muted">
              Apply across a date range
            </span>
          </label>

          <div className="flex items-center justify-between pt-1">
            <span className="font-mono text-[11px] text-faint">
              {chosenIds.length > 1 || rangeMode || half
                ? 'Scheduled days only — rest days stay rest days'
                : 'Applies to this date only'}
            </span>
            <button type="submit" disabled={saving} className="btn">
              {saving ? 'Saving…' : rangeMode ? 'Set range' : 'Set override'}
            </button>
          </div>

          {confirmation && (
            <p className="font-mono text-[11px] text-healthy">{confirmation}</p>
          )}
          {error && <p className="font-mono text-xs text-critical">{error}</p>}
        </form>
      )}
    </Frame>
  )
}

function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const next = new Date(y, m - 1, d + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`
}
