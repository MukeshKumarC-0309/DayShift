import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api/client'
import Frame from './Frame'
import type { Category, LogEntry } from '../types'

/**
 * Terminal/log-stream styled entry form: pick a date (defaults to today,
 * backdating allowed), type minutes per category, submit.
 *
 * The per-day target override lives behind a collapsed toggle so it never
 * clutters routine daily logging (the one-day override requirement).
 */

interface Props {
  /** Drop the panel frame and heading when shown inside a tab block. */
  embedded?: boolean
  categories: Category[]
  today: string
  /** Timed minutes already captured per category for the selected date. */
  timedByCategory?: Record<number, number>
  /** Changes whenever the dashboard reloads; the form re-reads its day then. */
  version?: number
  onSaved: () => void
  onSessionExpired: () => void
}

const DAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const

/** Move an ISO date by whole days, in local time. */
function shiftDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const next = new Date(y, m - 1, d + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`
}

/** Whether a category's default target applies on an ISO date. */
function isActiveOn(category: Category, isoDate: string): boolean {
  // Parse as local time — `new Date('YYYY-MM-DD')` would be parsed as UTC and
  // can land on the previous day west of Greenwich.
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return true
  const code = DAY_CODES[new Date(y, m - 1, d).getDay()]
  return category.active_days
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .includes(code)
}

interface RowState {
  minutes: string
  /** Questions solved — only used for categories with a question target. */
  questions: string
  override: string
  /** Whether this category's row already has an override stored. */
  hadOverride: boolean
}

/** What the server holds for a day, reduced to the fields this form edits. */
function snapshotOf(entries: LogEntry[]): string {
  return JSON.stringify(
    entries.map((e) => [
      e.category_id,
      e.minutes_logged,
      e.questions_solved,
      e.override_target_minutes,
    ]),
  )
}

function emptyRow(): RowState {
  return { minutes: '', questions: '', override: '', hadOverride: false }
}

export default function LogEntryForm({
  categories,
  today,
  timedByCategory = {},
  version = 0,
  onSaved,
  onSessionExpired,
  embedded = false,
}: Props) {
  const [date, setDate] = useState(today)
  const [rows, setRows] = useState<Record<number, RowState>>({})
  const [showOverrides, setShowOverrides] = useState(false)
  // Starts true: the inputs must stay disabled until the day has loaded, or
  // anything typed in that first instant is overwritten when the load lands.
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  // Typed but not yet recorded. Guards against losing edits to a date change
  // or to a reload triggered elsewhere on the page.
  const [dirty, setDirty] = useState(false)
  // Something else changed this day (a quick add, the timer) while there
  // were unsaved edits here; recording now would overwrite it.
  const [stale, setStale] = useState(false)
  const [pendingDate, setPendingDate] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // After midnight, a form still showing yesterday-as-today moves to the new
  // today; a deliberately backdated date is left alone.
  const previousToday = useRef(today)
  useEffect(() => {
    if (previousToday.current === today) return
    setDate((current) => (current === previousToday.current ? today : current))
    previousToday.current = today
  }, [today])

  // The dashboard reloaded. Re-read the day unless that would discard typing.
  // With unsaved typing, only warn if the stored day really changed — a
  // routine refresh (returning to the tab) must not raise a false alarm.
  const firstVersion = useRef(version)
  const loaded = useRef<string>('')
  // The rows as last loaded — what an undo puts back.
  const loadedRows = useRef<LogEntry[]>([])
  const [undo, setUndo] = useState<{
    date: string
    before: LogEntry[]
    touched: number[]
  } | null>(null)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const dateRef = useRef(date)
  dateRef.current = date
  useEffect(() => {
    if (version === firstVersion.current) return
    if (!dirtyRef.current) {
      setReloadKey((k) => k + 1)
      return
    }
    let cancelled = false
    api
      .logsForDay(dateRef.current)
      .then((entries) => {
        if (!cancelled && snapshotOf(entries) !== loaded.current) setStale(true)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [version])

  // Reload on a change of WHICH categories, not of the array object: the
  // dashboard hands down a fresh (identical) array after every load, and
  // reloading on that wiped numbers typed a moment earlier — e.g. when the
  // dashboard's first load finished just after the Log tab opened.
  const categoryKey = categories.map((c) => c.id).join(',')
  const categoriesRef = useRef(categories)
  categoriesRef.current = categories

  // Load whatever is already stored for the chosen date, so the form edits
  // the existing row rather than blindly overwriting it.
  useEffect(() => {
    const categories = categoriesRef.current
    let cancelled = false
    setLoading(true)
    setError(null)

    api
      .logsForDay(date)
      .then((entries: LogEntry[]) => {
        if (cancelled) return
        const next: Record<number, RowState> = {}
        for (const category of categories) {
          const existing = entries.find((e) => e.category_id === category.id)
          next[category.id] = existing
            ? {
                minutes: String(existing.minutes_logged),
                questions: existing.questions_solved
                  ? String(existing.questions_solved)
                  : '',
                override:
                  existing.override_target_minutes === null
                    ? ''
                    : String(existing.override_target_minutes),
                hadOverride: existing.override_target_minutes !== null,
              }
            : emptyRow()
        }
        setRows(next)
        loaded.current = snapshotOf(entries)
        loadedRows.current = entries
        setDirty(false)
        setStale(false)
        // Reveal the override section automatically when this date already
        // has one, so an existing override is never silently hidden.
        setShowOverrides(entries.some((e) => e.override_target_minutes !== null))
      })
      .catch((err) => {
        if (cancelled) return
        if (err?.status === 401) onSessionExpired()
        else setError('Could not load entries for that date.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [date, categoryKey, onSessionExpired, reloadKey])

  const isBackdated = useMemo(() => date < today, [date, today])
  const isFuture = useMemo(() => date > today, [date, today])

  function updateRow(categoryId: number, patch: Partial<RowState>) {
    setRows((prev) => ({
      ...prev,
      [categoryId]: { ...(prev[categoryId] ?? emptyRow()), ...patch },
    }))
    setSavedAt(null)
    setDirty(true)
  }

  /** Change date, but never silently throw away typed numbers. */
  function goToDate(next: string) {
    if (!next || next === date) return
    if (dirty) {
      setPendingDate(next)
      return
    }
    setPendingDate(null)
    setDate(next)
    setSavedAt(null)
  }

  function discardAndGo() {
    if (!pendingDate) return
    setDirty(false)
    setDate(pendingDate)
    setPendingDate(null)
    setSavedAt(null)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    const before = loadedRows.current
    const touched: number[] = []
    try {
      for (const category of categories) {
        const row = rows[category.id] ?? emptyRow()
        const minutesGiven = row.minutes.trim() !== ''
        const questionsGiven = !!category.question_target && row.questions.trim() !== ''
        const overrideGiven = row.override.trim() !== ''

        // Nothing typed and nothing previously stored — skip, so submitting
        // the form never creates empty rows for untouched categories.
        if (!minutesGiven && !questionsGiven && !overrideGiven && !row.hadOverride)
          continue

        touched.push(category.id)
        await api.upsertLog({
          log_date: date,
          category_id: category.id,
          ...(minutesGiven ? { minutes_logged: Number(row.minutes) } : {}),
          ...(questionsGiven ? { questions_solved: Number(row.questions) } : {}),
          ...(overrideGiven ? { override_target_minutes: Number(row.override) } : {}),
          // An override that was there and has been cleared out is removed.
          clear_override: row.hadOverride && !overrideGiven,
        })
      }
      if (touched.length === 0) {
        setError('Nothing typed to record.')
        return
      }
      setSavedAt(new Date().toLocaleTimeString())
      setUndo({ date, before, touched })
      setDirty(false)
      setStale(false)
      setPendingDate(null)
      onSaved()
    } catch (err: unknown) {
      const e = err as { status?: number }
      if (e?.status === 401) onSessionExpired()
      else setError('Save failed. Remaining categories were not recorded.')
    } finally {
      setSaving(false)
    }
  }

  // An undo is offered briefly; after that the form itself is the way back.
  useEffect(() => {
    if (!undo) return
    const timer = window.setTimeout(() => setUndo(null), 15_000)
    return () => window.clearTimeout(timer)
  }, [undo])

  /** Put every row the last Record touched back exactly as it was loaded. */
  async function undoLastSave() {
    if (!undo) return
    const { date: day, before, touched } = undo
    setUndo(null)
    setSaving(true)
    try {
      for (const categoryId of touched) {
        const was = before.find((e) => e.category_id === categoryId)
        await api.upsertLog({
          log_date: day,
          category_id: categoryId,
          // A row that did not exist goes back to zero, which scores the same.
          minutes_logged: was?.minutes_logged ?? 0,
          questions_solved: was?.questions_solved ?? 0,
          ...(was?.override_target_minutes != null
            ? {
                override_target_minutes: was.override_target_minutes,
                ...(was.override_reason ? { override_reason: was.override_reason } : {}),
              }
            : { clear_override: true }),
        })
      }
      setSavedAt(null)
      setReloadKey((k) => k + 1)
      onSaved()
    } catch (err: unknown) {
      const e = err as { status?: number }
      if (e?.status === 401) onSessionExpired()
      else setError('Undo failed part-way; check the numbers for that date.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Frame embedded={embedded}>
      <div className="mb-3 flex items-baseline justify-between">
        {!embedded && <h2 className="panel-label">Log entry</h2>}
        <span className="ml-auto font-mono text-[11px] text-faint">
          {dirty && <span className="mr-2 text-warn">Unsaved</span>}
          {isBackdated && 'Backdated'}
          {isFuture && 'Future date'}
        </span>
      </div>

      <form
        onSubmit={handleSubmit}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter records from any field, without reaching for the button.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            e.currentTarget.requestSubmit()
          }
        }}
      >
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="w-28 shrink-0 font-mono text-xs text-muted">Date</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => goToDate(shiftDate(date, -1))}
              className="btn-quiet px-2 font-mono"
              aria-label="Previous day"
            >
              ‹
            </button>
            <input
              type="date"
              value={date}
              onChange={(e) => goToDate(e.target.value)}
              className="term-input max-w-[170px]"
              aria-label="Date"
            />
            <button
              type="button"
              onClick={() => goToDate(shiftDate(date, 1))}
              className="btn-quiet px-2 font-mono"
              aria-label="Next day"
            >
              ›
            </button>
            {date !== today && (
              <button
                type="button"
                onClick={() => goToDate(today)}
                className="btn-quiet font-mono text-[11px]"
              >
                Today
              </button>
            )}
          </div>
        </div>

        {pendingDate && (
          <p className="mb-3 flex flex-wrap items-center gap-2 rounded border border-warn/40 bg-warn/5 px-3 py-2 font-mono text-[11px] text-warn">
            Unsaved numbers for {date}. Record them first, or
            <button type="button" onClick={discardAndGo} className="underline">
              discard and open {pendingDate}
            </button>
          </p>
        )}

        {stale && (
          <p className="mb-3 flex flex-wrap items-center gap-2 rounded border border-steel/40 bg-steel/5 px-3 py-2 font-mono text-[11px] text-steel">
            This day changed elsewhere (quick add or timer) — recording now would
            overwrite it.
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="underline"
            >
              Reload the day
            </button>
          </p>
        )}

        <div className="space-y-2.5">
          {categories.map((category) => {
            const row = rows[category.id] ?? emptyRow()
            return (
              <div key={category.id}>
                <label className="flex items-center gap-3">
                  <span
                    className="w-28 shrink-0 truncate font-sans text-xs text-muted"
                    title={category.name}
                  >
                    {category.name}
                  </span>
                  <span className="font-mono text-sm text-faint">&gt;</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    placeholder={loading ? '...' : '0'}
                    value={row.minutes}
                    onChange={(e) => updateRow(category.id, { minutes: e.target.value })}
                    disabled={loading}
                    className="term-input max-w-[110px]"
                    aria-label={`${category.name} minutes`}
                  />
                  <span className="font-mono text-xs text-faint">min</span>
                  {/* A second finish line: DSA is done at 2 questions OR 120
                      minutes, whichever comes first. */}
                  {category.question_target !== null && category.question_target > 0 && (
                    <>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        placeholder="0"
                        value={row.questions}
                        onChange={(e) =>
                          updateRow(category.id, { questions: e.target.value })
                        }
                        disabled={loading}
                        className="term-input max-w-[64px]"
                        aria-label={`${category.name} questions solved`}
                      />
                      <span className="whitespace-nowrap font-mono text-xs text-faint">
                        /{category.question_target} Q
                      </span>
                    </>
                  )}
                  <span className="whitespace-nowrap font-mono text-[11px] text-faint">
                    {row.override.trim() !== ''
                      ? `target ${row.override}`
                      : isActiveOn(category, date)
                        ? `target ${category.daily_target_minutes}`
                        : 'Rest day'}
                  </span>
                  {/* The timer's minutes are added on top of what is typed
                      here, so showing them stops the same work being counted
                      twice. */}
                  {date === today && (timedByCategory[category.id] ?? 0) > 0 && (
                    <span
                      className="whitespace-nowrap font-mono text-[11px] text-healthy"
                      title="Already captured by the timer; added on top of this field"
                    >
                      +{timedByCategory[category.id]} timed
                    </span>
                  )}
                </label>

                {showOverrides && (
                  <div className="mt-1.5 flex items-center gap-3 pl-[7.75rem]">
                    <span className="font-mono text-[11px] text-steel">Override</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      placeholder="Default"
                      value={row.override}
                      onChange={(e) =>
                        updateRow(category.id, { override: e.target.value })
                      }
                      disabled={loading}
                      className="term-input max-w-[110px] text-[13px]"
                      aria-label={`${category.name} target override`}
                    />
                    <span className="font-mono text-[11px] text-faint">
                      This date only
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowOverrides((v) => !v)}
            className="btn-quiet font-mono"
          >
            {showOverrides ? '− Hide target override' : '+ Set target override'}
          </button>

          <div className="flex items-center gap-3">
            {savedAt && (
              <span className="font-mono text-[11px] text-healthy">Saved {savedAt}</span>
            )}
            {undo && (
              <button
                type="button"
                onClick={undoLastSave}
                className="font-mono text-[11px] text-steel underline decoration-dotted underline-offset-2 hover:text-ink"
              >
                Undo
              </button>
            )}
            <button
              type="submit"
              disabled={saving || loading}
              className="btn"
              title="Record (⌘/Ctrl + Enter)"
            >
              {saving ? 'Saving…' : 'Record'}
            </button>
          </div>
        </div>

        {error && <p className="mt-2 font-mono text-xs text-critical">{error}</p>}
      </form>
    </Frame>
  )
}
