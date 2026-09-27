import { useState } from 'react'

import GitRef from '../GitRef'
import { categoryTheme, tagTone } from '../../theme'
import type { Category, Deadline, WorkSession } from '../../types'
import { formatClock, LONG_RUN_SECONDS, toMillis } from './timerState'
import { colourIndex } from '../../domains'

/**
 * A session being timed: the clock (counting up, or down for a focus block),
 * its category, note, branch and tags, and Stop / Discard. Discard asks
 * twice, because it records nothing.
 */

interface Props {
  running: WorkSession
  categories: Category[]
  exams: Deadline[]
  now: number
  busy: boolean
  onStop: () => void
  onDiscard: () => void
}

export default function RunningTimer({
  running,
  categories,
  exams,
  now,
  busy,
  onStop,
  onDiscard,
}: Props) {
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const category = categories.find((c) => c.id === running.category_id)
  const theme = categoryTheme(colourIndex(running.category_id))
  const started = toMillis(running.started_at)
  const elapsed = Math.floor((now - started) / 1000)
  const plannedEnd = running.planned_end ? toMillis(running.planned_end) : null
  const plannedTotal =
    plannedEnd !== null ? Math.round((plannedEnd - started) / 1000) : null
  const remaining = plannedEnd !== null ? Math.ceil((plannedEnd - now) / 1000) : null
  const linkedExam = running.deadline_id
    ? exams.find((d) => d.id === running.deadline_id)
    : undefined

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className="font-mono text-[32px] tnum"
          style={{ color: theme.bright }}
          aria-live="off"
        >
          {remaining !== null ? formatClock(remaining) : formatClock(elapsed)}
        </span>
        <span className="flex items-center gap-2 font-sans text-sm text-ink">
          <span
            className="dot animate-pulse-edge"
            style={{ backgroundColor: theme.bright }}
            aria-hidden="true"
          />
          {category?.name ?? `Category ${running.category_id}`}
        </span>
        {plannedTotal !== null && (
          <span className="font-mono text-[11px] text-faint">
            focus · {Math.round(plannedTotal / 60)} min block
          </span>
        )}
      </div>

      {plannedTotal !== null && remaining !== null && (
        <div className="mb-3 h-1.5 rounded-full bg-edge" aria-hidden="true">
          <div
            className="h-full rounded-full transition-[width] duration-1000"
            style={{
              width: `${Math.min(100, (100 * (plannedTotal - remaining)) / plannedTotal)}%`,
              backgroundColor: theme.bright,
            }}
          />
        </div>
      )}

      {linkedExam && (
        <p className="mb-2 font-mono text-[11px] text-steel">
          for {linkedExam.title} · {linkedExam.days_left}d left
        </p>
      )}

      {plannedTotal === null && elapsed >= LONG_RUN_SECONDS && (
        <p
          role="status"
          className="mb-3 rounded border border-warn/40 bg-warn/5 px-3 py-2 font-sans text-[12px] text-warn"
        >
          Running for over {Math.floor(elapsed / 3600)} hours. If you stepped away,
          Discard it and type the real minutes in Log instead.
        </p>
      )}

      {running.note && (
        <p className="mb-3 font-mono text-[11px] text-faint">{running.note}</p>
      )}
      {running.git_ref && (
        <p className="-mt-1 mb-3">
          <GitRef value={running.git_ref} />
        </p>
      )}
      {running.tags.length > 0 && (
        <div className="-mt-1 mb-3 flex flex-wrap gap-1">
          {running.tags.map((tag) => (
            <span key={tag} className={`chip ${tagTone(tag)}`}>
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={onStop} className="btn-primary">
          {busy
            ? 'Working…'
            : plannedTotal !== null
              ? 'End early and record'
              : 'Stop and record'}
        </button>

        {confirmDiscard ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onDiscard}
              className="btn border-critical text-critical hover:border-critical hover:text-critical"
            >
              Discard for good
            </button>
            <button
              type="button"
              onClick={() => setConfirmDiscard(false)}
              className="btn-quiet"
            >
              Keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDiscard(true)}
            className="btn-quiet"
            title="Throw the session away without recording it"
          >
            Discard
          </button>
        )}
      </div>
      {confirmDiscard && (
        <p className="mt-2 font-sans text-[11px] text-muted">
          Discarding records nothing — use it when the timer was left running.
        </p>
      )}
      {plannedTotal !== null && (
        <p className="mt-2 font-sans text-[11px] text-faint">
          Stops by itself at the end of the block — even with this page closed.
        </p>
      )}
    </div>
  )
}
