import { useEffect, useRef, useState } from 'react'

import { api } from '../api/client'
import { chime } from '../chime'
import Frame from './Frame'
import BreakPanel from './timer/BreakPanel'
import RunningTimer from './timer/RunningTimer'
import StartForm from './timer/StartForm'
import {
  type Break,
  BREAK_KEY,
  type Mode,
  readStorage,
  type StartDetails,
  toMillis,
  writeStorage,
} from './timer/timerState'
import type { Category, Deadline, WorkSession } from '../types'

/**
 * The live timer. One session runs at a time — starting a second stops the
 * first server-side, because two timers would count the same wall-clock
 * minutes twice.
 *
 * Elapsed time is derived from the session's `started_at` rather than an
 * incrementing counter, so a refresh, a sleep, or a backend restart all
 * recover the true elapsed time instead of resetting to zero.
 *
 * Focus mode: a 25- or 50-minute block with a planned end. The SERVER stops
 * it at that end even if this page is closed, so an unattended block records
 * exactly what was planned. Here, a chime marks the end and a short break
 * counts down (kept in this browser only — a break is not data).
 *
 * This file owns the shared clock, the focus-end and break logic, and the
 * API calls; the three screens are in ./timer/.
 */

interface Props {
  /** Only these categories get a start button (the active domain). */
  startable?: number[]
  /** Drop the panel frame and heading when shown inside a tab block. */
  embedded?: boolean
  categories: Category[]
  running: WorkSession | null
  onChanged: () => void
  onSessionExpired: () => void
}

export default function SessionTimer({
  categories,
  running,
  onChanged,
  onSessionExpired,
  embedded = false,
  startable,
}: Props) {
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exams, setExams] = useState<Deadline[]>([])
  const [pause, setPause] = useState<Break | null>(() =>
    readStorage<Break | null>(BREAK_KEY, null),
  )
  const endedFor = useRef<number | null>(null)

  // One clock for everything on this panel.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  // Upcoming exams and assignments, for the "for" picker.
  useEffect(() => {
    api
      .deadlines()
      .then((list) => setExams(list.filter((d) => d.days_left >= 0)))
      .catch(() => setExams([]))
  }, [])

  // A focus block reaching its planned end: chime, start the break, and
  // reload — the server has closed the session at exactly the planned end.
  const plannedEnd = running?.planned_end ? toMillis(running.planned_end) : null
  useEffect(() => {
    if (!running || plannedEnd === null || now < plannedEnd) return
    if (endedFor.current === running.id) return
    endedFor.current = running.id
    chime()
    const planned = Math.round((plannedEnd - toMillis(running.started_at)) / 60000)
    const breakMinutes = planned >= 45 ? 10 : 5
    const next: Break = {
      endsAt: Date.now() + breakMinutes * 60000,
      categoryId: running.category_id,
      mode: planned >= 45 ? '50' : '25',
      deadlineId: running.deadline_id,
    }
    setPause(next)
    writeStorage(BREAK_KEY, next)
    onChanged()
  }, [now, running, plannedEnd, onChanged])

  // The break ending gets a chime too; the break panel stays until dismissed.
  const breakLeft = pause ? Math.ceil((pause.endsAt - now) / 1000) : 0
  const breakChimed = useRef(false)
  useEffect(() => {
    if (!pause) {
      breakChimed.current = false
      return
    }
    if (breakLeft <= 0 && !breakChimed.current) {
      breakChimed.current = true
      chime()
    }
  }, [pause, breakLeft])

  function clearBreak() {
    setPause(null)
    writeStorage(BREAK_KEY, null)
  }

  /** Run an API action and reload; true if it went through. */
  async function act(fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
      return true
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else if (e?.status === 404)
        onChanged() // already ended (e.g. focus block)
      else setError(e?.message ?? 'Something went wrong.')
      return false
    } finally {
      setBusy(false)
    }
  }

  function start(categoryId: number, mode: Mode, details: StartDetails) {
    clearBreak()
    return act(() =>
      api.startSession(categoryId, details.note.trim() || undefined, details.tags, {
        ...(mode === 'open' ? {} : { planned_minutes: Number(mode) }),
        ...(details.deadlineId ? { deadline_id: details.deadlineId } : {}),
        ...(details.gitRef.trim() ? { git_ref: details.gitRef.trim() } : {}),
      }),
    )
  }

  return (
    <Frame embedded={embedded}>
      {!embedded && (
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="panel-label">Timer</h2>
          {running && (
            <span className="font-mono text-[11px] text-healthy">Recording</span>
          )}
        </div>
      )}

      {running ? (
        <RunningTimer
          key={running.id}
          running={running}
          categories={categories}
          exams={exams}
          now={now}
          busy={busy}
          onStop={() => void act(() => api.stopSession())}
          onDiscard={() => void act(() => api.discardSession())}
        />
      ) : pause ? (
        <BreakPanel
          pause={pause}
          secondsLeft={breakLeft}
          categories={categories}
          busy={busy}
          onNext={() =>
            void start(pause.categoryId, pause.mode, {
              note: '',
              tags: [],
              gitRef: '',
              deadlineId: pause.deadlineId,
            })
          }
          onDone={clearBreak}
        />
      ) : (
        <StartForm
          categories={categories}
          startable={startable}
          exams={exams}
          busy={busy}
          onStart={start}
        />
      )}

      {error && <p className="mt-2 font-mono text-xs text-critical">{error}</p>}
    </Frame>
  )
}
