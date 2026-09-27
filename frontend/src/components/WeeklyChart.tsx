import { useEffect, useState } from 'react'

import { api } from '../api/client'
import { dayLabel } from '../dates'
import { bandFor, categoryTheme, STATUS_HEX } from '../theme'
import type { WeeklyCategory, WeeklyDay } from '../types'

/**
 * Hand-built SVG bar chart: the last N days for one category.
 *
 * Bars are coloured by that day's performance band (status), which is the
 * question the chart answers. The category's own hue appears on the label and
 * the baseline, so the three stacked charts stay distinguishable.
 *
 * Days the category is not scheduled on are drawn as a flat tick rather than a
 * zero-height bar — a rest day is not a failure.
 *
 * With `onSaved`, each day is clickable: a small editor opens under the chart
 * to correct that day's typed minutes without going through the log form.
 */

interface Props {
  week: WeeklyCategory
  index: number
  /** Enables click-to-edit; called after a day is saved. */
  onSaved?: () => void
  onSessionExpired?: () => void
  /** DSA-style categories also get a questions field. */
  questionTarget?: number | null
}

const CHART_HEIGHT = 96
const BAR_WIDTH = 16
const SLOT_WIDTH = 42
const BASELINE_Y = CHART_HEIGHT - 18

export default function WeeklyChart({
  week,
  index,
  onSaved,
  onSessionExpired,
  questionTarget,
}: Props) {
  const [editing, setEditing] = useState<WeeklyDay | null>(null)
  const width = week.days.length * SLOT_WIDTH
  const theme = categoryTheme(index)
  const maxPercent = Math.max(100, ...week.days.map((d) => d.percent ?? 0))
  const targetY = BASELINE_Y - (100 / maxPercent) * (BASELINE_Y - 8)
  const gid = `wk-${week.category_id}`

  return (
    <div className="py-1">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="flex items-center gap-2 font-sans text-xs text-ink">
          <span
            className="dot"
            style={{ backgroundColor: theme.bright }}
            aria-hidden="true"
          />
          {week.category_name}
        </span>
        <span className="font-mono text-[10px] text-faint">Last {week.days.length}d</span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
        className="h-[96px] w-full"
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label={`${week.category_name}: last ${week.days.length} days`}
      >
        <defs>
          {(['healthy', 'warning', 'critical'] as const).map((tone) => (
            <linearGradient key={tone} id={`${gid}-${tone}`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={STATUS_HEX[tone]} stopOpacity="0.45" />
              <stop offset="100%" stopColor={STATUS_HEX[tone]} stopOpacity="1" />
            </linearGradient>
          ))}
        </defs>

        {/* Target line */}
        <line
          x1={0}
          y1={targetY}
          x2={width}
          y2={targetY}
          className="stroke-edge"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
        {/* Baseline, tinted with the category hue */}
        <line
          x1={0}
          y1={BASELINE_Y}
          x2={width}
          y2={BASELINE_Y}
          stroke={theme.base}
          strokeOpacity={0.5}
          strokeWidth={1}
        />

        {week.days.map((day, i) => {
          const x = i * SLOT_WIDTH + (SLOT_WIDTH - BAR_WIDTH) / 2
          const pct = day.percent
          const band = bandFor(pct)
          const barHeight =
            pct === null
              ? 0
              : Math.max(2, (Math.min(pct, maxPercent) / maxPercent) * (BASELINE_Y - 8))

          return (
            <g key={day.log_date}>
              {pct === null ? (
                <rect
                  x={x}
                  y={BASELINE_Y - 3}
                  width={BAR_WIDTH}
                  height={3}
                  rx={1.5}
                  className="fill-edge"
                />
              ) : (
                <rect
                  x={x}
                  y={BASELINE_Y - barHeight}
                  width={BAR_WIDTH}
                  height={barHeight}
                  rx={3}
                  fill={`url(#${gid}-${band})`}
                >
                  <title>
                    {day.log_date} — {day.minutes_logged}/{day.target_minutes} min (
                    {Math.round(pct)}%){day.questions > 0 ? ` · ${day.questions} Q` : ''}
                    {day.has_override ? ' · override' : ''}
                  </title>
                </rect>
              )}

              {day.has_override && (
                <text
                  x={x + BAR_WIDTH / 2}
                  y={BASELINE_Y - barHeight - 3}
                  textAnchor="middle"
                  className="fill-current font-mono text-[10px] text-steel"
                >
                  *
                </text>
              )}

              <text
                x={x + BAR_WIDTH / 2}
                y={CHART_HEIGHT - 5}
                textAnchor="middle"
                className={`fill-current font-mono text-[9px] ${day.is_active ? 'text-muted' : 'text-faint'}`}
              >
                {day.weekday.slice(0, 2)}
              </text>

              {onSaved && (
                // Full-height hit area: the bars can be 2px tall.
                <rect
                  x={i * SLOT_WIDTH}
                  y={0}
                  width={SLOT_WIDTH}
                  height={CHART_HEIGHT}
                  fill="transparent"
                  className="cursor-pointer outline-none hover:fill-white/5 focus-visible:fill-white/10"
                  role="button"
                  tabIndex={0}
                  aria-label={`Edit ${week.category_name} on ${day.log_date}`}
                  onClick={() => setEditing(day)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setEditing(day)
                    }
                  }}
                />
              )}
            </g>
          )
        })}
      </svg>

      {editing && onSaved && (
        <DayEditor
          key={editing.log_date}
          categoryId={week.category_id}
          categoryName={week.category_name}
          day={editing}
          questionTarget={questionTarget ?? null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            onSaved()
          }}
          onSessionExpired={onSessionExpired ?? (() => undefined)}
        />
      )}
    </div>
  )
}

/** Correct one day's typed minutes (and questions) straight from the chart. */
function DayEditor({
  categoryId,
  categoryName,
  day,
  questionTarget,
  onClose,
  onSaved,
  onSessionExpired,
}: {
  categoryId: number
  categoryName: string
  day: WeeklyDay
  questionTarget: number | null
  onClose: () => void
  onSaved: () => void
  onSessionExpired: () => void
}) {
  const [typed, setTyped] = useState<string | null>(null)
  const [questions, setQuestions] = useState('')
  const [timed, setTimed] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .logsForDay(day.log_date)
      .then((rows) => {
        if (cancelled) return
        const row = rows.find((r) => r.category_id === categoryId)
        const typedMinutes = row?.minutes_logged ?? 0
        setTyped(String(typedMinutes))
        setQuestions(row?.questions_solved ? String(row.questions_solved) : '')
        // The chart's total includes timer sessions; the difference is timed.
        setTimed(Math.max(0, day.minutes_logged - typedMinutes))
      })
      .catch(() => !cancelled && setError('Could not load that day.'))
    return () => {
      cancelled = true
    }
  }, [categoryId, day])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (typed === null) return
    try {
      await api.upsertLog({
        log_date: day.log_date,
        category_id: categoryId,
        minutes_logged: Math.max(0, Number(typed || 0)),
        ...(questionTarget
          ? { questions_solved: Math.max(0, Number(questions || 0)) }
          : {}),
      })
      onSaved()
    } catch (err: unknown) {
      const e2 = err as { status?: number; message?: string }
      if (e2?.status === 401) onSessionExpired()
      else setError(e2?.message ?? 'Could not save.')
    }
  }

  return (
    <form
      onSubmit={save}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      className="mt-1 flex flex-wrap items-center gap-2 rounded border border-divider bg-base/40 px-3 py-2"
    >
      <span className="font-mono text-[11px] text-muted">
        {categoryName} · {dayLabel(day.log_date)}
      </span>
      <input
        type="number"
        min={0}
        max={1440}
        inputMode="numeric"
        autoFocus
        value={typed ?? ''}
        disabled={typed === null}
        onChange={(e) => setTyped(e.target.value)}
        className="term-input max-w-[80px] py-1 text-[12px]"
        aria-label="Typed minutes"
      />
      <span className="font-mono text-[10px] text-faint">
        min typed{timed > 0 ? ` + ${timed} timed` : ''}
      </span>
      {questionTarget ? (
        <>
          <input
            type="number"
            min={0}
            max={100}
            inputMode="numeric"
            value={questions}
            onChange={(e) => setQuestions(e.target.value)}
            className="term-input max-w-[60px] py-1 text-[12px]"
            aria-label="Questions solved"
          />
          <span className="font-mono text-[10px] text-faint">/{questionTarget} Q</span>
        </>
      ) : null}
      <span className="ml-auto flex gap-1">
        <button
          type="button"
          onClick={onClose}
          className="btn-quiet font-mono text-[11px]"
        >
          Cancel
        </button>
        <button type="submit" disabled={typed === null} className="btn py-1 text-[12px]">
          Save
        </button>
      </span>
      {error && <p className="w-full font-mono text-[11px] text-critical">{error}</p>}
    </form>
  )
}
