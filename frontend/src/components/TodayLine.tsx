import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Link } from 'react-router'

import { api } from '../api/client'
import CheckInForm from './CheckInForm'
import type { Deadline, TodaySummary } from '../types'

/**
 * One line above the domains: today's check-in, revisions due, and the next
 * deadlines. Deliberately a line, not a panel — the dashboard stays light, and
 * each chip leads to the page that holds the detail.
 */

interface Props {
  summary: TodaySummary | null
  onChanged: () => void
  onSessionExpired: () => void
}

function formatSleep(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function countdown(deadline: Deadline): string {
  if (deadline.days_left === 0) return 'today'
  if (deadline.days_left === 1) return 'tomorrow'
  return `in ${deadline.days_left}d`
}

const CHIP =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors'

export default function TodayLine({ summary, onChanged, onSessionExpired }: Props) {
  const [open, setOpen] = useState(false)
  const [habitsOpen, setHabitsOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  const habitBox = useRef<HTMLDivElement | null>(null)
  useDismiss(open, box, () => setOpen(false))
  useDismiss(habitsOpen, habitBox, () => setHabitsOpen(false))

  if (!summary) return null
  const checkin = summary.checkin
  const habitsDone = summary.habits.filter((h) => h.done).length

  const checkinText = checkin
    ? [
        checkin.sleep_minutes !== null
          ? `slept ${formatSleep(checkin.sleep_minutes)}`
          : null,
        checkin.energy !== null ? `energy ${checkin.energy}` : null,
        checkin.mood !== null ? `mood ${checkin.mood}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'checked in'
    : 'Check in'

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2" aria-label="Today">
      {/* On a phone, the big-button view is one tap away. */}
      <Link
        to="/quick"
        className={`${CHIP} border-steel/50 text-steel hover:bg-steel/10 sm:hidden`}
      >
        ＋ Quick entry
      </Link>
      <div className="relative" ref={box}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`${CHIP} ${
            checkin
              ? 'border-edge text-muted hover:border-muted hover:text-ink'
              : 'border-dashed border-steel/50 text-steel hover:bg-steel/10'
          }`}
        >
          <span aria-hidden="true">{checkin ? '●' : '○'}</span>
          {checkinText}
        </button>
        {open && (
          <Popover label="Today's check-in">
            <CheckInForm
              date={summary.today}
              existing={checkin}
              onSaved={() => {
                setOpen(false)
                onChanged()
              }}
              onSessionExpired={onSessionExpired}
            />
          </Popover>
        )}
      </div>

      {summary.habits.length > 0 && (
        <div className="relative" ref={habitBox}>
          <button
            type="button"
            onClick={() => setHabitsOpen((v) => !v)}
            aria-expanded={habitsOpen}
            className={`${CHIP} ${
              habitsDone === summary.habits.length
                ? 'border-healthy/50 text-healthy hover:bg-healthy/10'
                : 'border-edge text-muted hover:border-muted hover:text-ink'
            }`}
          >
            Habits {habitsDone}/{summary.habits.length}
          </button>
          {habitsOpen && (
            <Popover label="Today's habits">
              <ul className="space-y-1.5">
                {summary.habits.map((h) => (
                  <li key={h.id}>
                    <label className="flex items-center gap-2 font-sans text-[13px] text-muted">
                      <input
                        type="checkbox"
                        checked={h.done}
                        onChange={async () => {
                          try {
                            await api.setHabitCheck(h.id, summary.today, !h.done)
                            onChanged()
                          } catch (err: unknown) {
                            if ((err as { status?: number })?.status === 401)
                              onSessionExpired()
                          }
                        }}
                        className="accent-healthy"
                      />
                      <span className={h.done ? 'text-ink' : undefined}>{h.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <Link
                to="/goals"
                className="mt-3 block font-mono text-[10px] text-faint hover:text-steel"
              >
                All habits and streaks →
              </Link>
            </Popover>
          )}
        </div>
      )}

      {(summary.plan_open_tasks > 0 || summary.plan_minutes > 0) && (
        <Link
          to="/agenda"
          className={`${CHIP} border-edge text-muted hover:border-muted hover:text-ink`}
          title="Today's plan"
        >
          Plan
          {summary.plan_minutes > 0 && (
            <span className="text-faint">{summary.plan_minutes} min</span>
          )}
          {summary.plan_open_tasks > 0 && (
            <span className="text-faint">
              · {summary.plan_open_tasks} task{summary.plan_open_tasks === 1 ? '' : 's'}{' '}
              left
            </span>
          )}
        </Link>
      )}

      {summary.revisions_due > 0 && (
        <Link
          to="/practice"
          className={`${CHIP} border-steel/50 text-steel hover:bg-steel/10`}
        >
          {summary.revisions_due} revision{summary.revisions_due === 1 ? '' : 's'} due
        </Link>
      )}

      {summary.deadlines.map((deadline) => {
        const urgent = deadline.days_left <= 3
        const tone =
          deadline.kind === 'exam' && urgent
            ? 'border-critical/50 text-critical hover:bg-critical/10'
            : urgent
              ? 'border-warn/50 text-warn hover:bg-warn/10'
              : 'border-edge text-muted hover:border-muted hover:text-ink'
        return (
          <Link
            key={deadline.id}
            to="/agenda"
            className={`${CHIP} ${tone}`}
            title={`${deadline.kind} on ${deadline.due_date}`}
          >
            {deadline.kind === 'exam' && <span className="uppercase">exam</span>}
            {deadline.title}
            <span className="text-faint">{countdown(deadline)}</span>
          </Link>
        )
      })}
    </div>
  )
}

/** Close a popover on Escape or a click outside `box`. */
function useDismiss(
  open: boolean,
  box: RefObject<HTMLDivElement | null>,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') close()
        return
      }
      if (box.current && !box.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', handle)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', handle)
    }
  }, [open, box, close])
}

function Popover({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="dialog"
      aria-label={label}
      className="panel absolute left-0 top-full z-40 mt-2 w-[min(360px,calc(100vw-2.5rem))] px-4 py-4"
    >
      {children}
    </div>
  )
}
