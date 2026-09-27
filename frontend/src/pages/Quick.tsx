import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'

import { api } from '../api/client'
import CheckInForm from '../components/CheckInForm'
import Brand from '../components/Brand'
import { colourIndex } from '../domains'
import { categoryTheme } from '../theme'
import type { Dashboard, TodaySummary } from '../types'

/**
 * Quick entry — the phone view. Log on the phone, read on the laptop.
 *
 * One column of large targets: per category, today's progress, `+10 +15 +30
 * +60` (and `+1 Q` for DSA), and the timer. Habits and the check-in sit
 * underneath. Every add is a delta (never an overwrite) and the last one can
 * be undone.
 */

interface Props {
  onSessionExpired: () => void
}

const STEPS = [10, 15, 30, 60] as const

interface LastAdd {
  categoryId: number
  name: string
  minutes: number
  questions: number
}

export default function Quick({ onSessionExpired }: Props) {
  const [data, setData] = useState<Dashboard | null>(null)
  const [today, setToday] = useState<TodaySummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<LastAdd | null>(null)
  const [showRest, setShowRest] = useState(false)
  const [showCheckIn, setShowCheckIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [d, t] = await Promise.all([api.dashboard(), api.today()])
      setData(d)
      setToday(t)
      setError(null)
    } catch (err: unknown) {
      const e = err as { status?: number }
      if (e?.status === 401) onSessionExpired()
      else setError('Could not reach the Dayshift backend.')
    }
  }, [onSessionExpired])

  useEffect(() => {
    void load()
  }, [load])

  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(true)
    try {
      await fn()
      await load()
      return true
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setError(e?.message ?? 'That did not save.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function add(
    categoryId: number,
    name: string,
    minutes: number,
    questions: number,
  ) {
    if (!data) return
    const ok = await run(() =>
      api.adjustLog({
        log_date: data.today,
        category_id: categoryId,
        minutes_delta: minutes,
        questions_delta: questions,
      }),
    )
    setLast(ok ? { categoryId, name, minutes, questions } : null)
  }

  if (!data || !today) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="font-mono text-sm text-faint">
          {error ?? (
            <>
              Loading<span className="animate-caret">…</span>
            </>
          )}
        </span>
      </main>
    )
  }

  const active = data.progress.filter((p) => p.is_active_today)
  const rest = data.progress.filter((p) => !p.is_active_today)
  const running = data.running

  const card = (p: (typeof data.progress)[number]) => {
    const theme = categoryTheme(colourIndex(p.category_id))
    const pct = p.target_minutes > 0 ? Math.min(100, p.percent) : null
    const isRunning = running?.category_id === p.category_id
    return (
      <li key={p.category_id} className="panel px-4 py-3.5">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="flex items-center gap-2 font-sans text-[15px] text-ink">
            <span
              className="dot"
              style={{ backgroundColor: theme.bright }}
              aria-hidden="true"
            />
            {p.category_name}
          </span>
          <span className="font-mono text-[13px] text-muted tnum">
            {p.minutes_logged}
            {p.target_minutes > 0 && (
              <span className="text-faint">/{p.target_minutes}</span>
            )}
            {p.question_target ? (
              <span className="text-faint">
                {' '}
                · {p.questions_solved}/{p.question_target} Q
              </span>
            ) : null}
          </span>
        </div>
        {pct !== null && (
          <div className="mb-3 h-1.5 rounded-full bg-edge">
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, backgroundColor: theme.bright }}
            />
          </div>
        )}
        <div className="grid grid-cols-4 gap-2">
          {STEPS.map((m) => (
            <button
              key={m}
              type="button"
              disabled={busy}
              onClick={() => add(p.category_id, p.category_name, m, 0)}
              className="rounded border border-edge bg-raised py-3 font-mono text-[15px] text-ink active:scale-95 disabled:opacity-50"
              aria-label={`Add ${m} minutes to ${p.category_name}`}
            >
              +{m}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          {p.question_target ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => add(p.category_id, p.category_name, 0, 1)}
              className="flex-1 rounded border border-edge bg-raised py-2.5 font-mono text-[13px] text-ink active:scale-95 disabled:opacity-50"
            >
              +1 question
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy || (running !== null && !isRunning)}
            onClick={() =>
              run(() => (isRunning ? api.stopSession() : api.startSession(p.category_id)))
            }
            className={`flex-1 rounded border py-2.5 font-mono text-[13px] active:scale-95 disabled:opacity-40 ${
              isRunning
                ? 'border-healthy bg-healthy/10 text-healthy'
                : 'border-edge text-muted'
            }`}
          >
            {isRunning ? '■ Stop timer' : '▶ Timer'}
          </button>
        </div>
      </li>
    )
  }

  return (
    <main className="min-h-screen px-4 pb-10 pt-4">
      <div className="mx-auto max-w-[480px]">
        <header className="mb-4 flex items-center justify-between">
          <Brand subtitle={data.today} />
          <Link to="/" className="btn-quiet font-mono text-[12px]">
            Dashboard
          </Link>
        </header>

        {error && <p className="mb-3 font-mono text-xs text-critical">{error}</p>}

        {last && (
          <div className="mb-3 flex items-center justify-between rounded border border-steel/40 bg-steel/5 px-3 py-2 font-mono text-[12px] text-steel">
            <span>
              Added {last.questions ? `${last.questions} Q` : `${last.minutes} min`} to{' '}
              {last.name}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                await run(() =>
                  api.adjustLog({
                    log_date: data.today,
                    category_id: last.categoryId,
                    minutes_delta: -last.minutes,
                    questions_delta: -last.questions,
                  }),
                )
                setLast(null)
              }}
              className="underline"
            >
              Undo
            </button>
          </div>
        )}

        <ul className="space-y-3">{active.map(card)}</ul>

        {rest.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowRest((v) => !v)}
              className="btn-quiet w-full font-mono text-[12px]"
            >
              {showRest ? '− Hide' : '+ Show'} {rest.length} not scheduled today
            </button>
            {showRest && <ul className="mt-3 space-y-3">{rest.map(card)}</ul>}
          </div>
        )}

        {today.habits.length > 0 && (
          <section className="panel mt-5 px-4 py-3.5">
            <h2 className="panel-label mb-2">Habits today</h2>
            <ul className="space-y-1">
              {today.habits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(() => api.setHabitCheck(h.id, today.today, !h.done))
                    }
                    className={`flex w-full items-center gap-3 rounded border px-3 py-3 text-left font-sans text-[14px] ${
                      h.done ? 'border-healthy/50 text-ink' : 'border-edge text-muted'
                    }`}
                    aria-pressed={h.done}
                  >
                    <span className={h.done ? 'text-healthy' : 'text-faint'}>
                      {h.done ? '✓' : '○'}
                    </span>
                    {h.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="panel mt-5 px-4 py-3.5">
          <button
            type="button"
            onClick={() => setShowCheckIn((v) => !v)}
            className="flex w-full items-center justify-between font-sans text-[14px] text-ink"
            aria-expanded={showCheckIn}
          >
            {today.checkin ? 'Check-in done — edit' : 'Check in: sleep, energy, mood'}
            <span className="font-mono text-faint">{showCheckIn ? '−' : '+'}</span>
          </button>
          {showCheckIn && (
            <div className="mt-3">
              <CheckInForm
                date={today.today}
                existing={today.checkin}
                onSaved={() => {
                  setShowCheckIn(false)
                  void load()
                }}
                onSessionExpired={onSessionExpired}
              />
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
