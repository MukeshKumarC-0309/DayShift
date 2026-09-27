import { useState } from 'react'

import type { Problem, ReviewOutcome } from '../types'

/**
 * One due problem at a time: read it, re-solve it, say how it went, next.
 *
 * The Practice page starts the DSA timer (if none is running) before this
 * opens, so the session's minutes count as DSA time; revisions themselves
 * never count as questions. Your note on each problem is hidden until you
 * choose to see it — the point is to recall the idea, not re-read it.
 */

interface Props {
  queue: Problem[]
  startedTimer: boolean
  onReview: (problemId: number, outcome: ReviewOutcome) => Promise<boolean>
  onFinish: (stopTimer: boolean) => void
}

const OUTCOMES: { value: ReviewOutcome; label: string; tone: string }[] = [
  { value: 'solid', label: 'Solid', tone: 'border-healthy/60 text-healthy' },
  { value: 'shaky', label: 'Shaky', tone: 'border-warn/60 text-warn' },
  { value: 'forgot', label: 'Forgot', tone: 'border-critical/60 text-critical' },
]

export default function RevisionSession({
  queue,
  startedTimer,
  onReview,
  onFinish,
}: Props) {
  const [index, setIndex] = useState(0)
  const [showNote, setShowNote] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tally, setTally] = useState<Record<ReviewOutcome, number>>({
    solid: 0,
    shaky: 0,
    forgot: 0,
  })

  const problem = queue[index]

  async function record(outcome: ReviewOutcome) {
    if (!problem) return
    setBusy(true)
    const ok = await onReview(problem.id, outcome)
    setBusy(false)
    if (!ok) return
    setTally({ ...tally, [outcome]: tally[outcome] + 1 })
    setShowNote(false)
    setIndex(index + 1)
  }

  if (!problem) {
    return (
      <div role="status">
        <p className="mb-1 font-sans text-sm text-ink">
          Revised {index} problem{index === 1 ? '' : 's'}.
        </p>
        <p className="mb-3 font-mono text-[11px] text-faint">
          {tally.solid} solid · {tally.shaky} shaky · {tally.forgot} forgot
        </p>
        <div className="flex flex-wrap gap-2">
          {startedTimer && (
            <button type="button" onClick={() => onFinish(true)} className="btn-primary">
              Stop timer and record
            </button>
          )}
          <button type="button" onClick={() => onFinish(false)} className="btn-quiet">
            {startedTimer ? 'Keep the timer running' : 'Close'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] text-faint tnum">
          {index + 1} of {queue.length}
        </span>
        <div className="h-1 flex-1 rounded-full bg-edge" aria-hidden="true">
          <div
            className="h-full rounded-full bg-steel"
            style={{ width: `${(100 * index) / queue.length}%` }}
          />
        </div>
        <button
          type="button"
          onClick={() => setIndex(queue.length)}
          className="btn-quiet font-mono text-[11px]"
        >
          End
        </button>
      </div>

      <p className="font-sans text-lg text-ink">
        {problem.url ? (
          <a
            href={problem.url}
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-edge underline-offset-4 hover:decoration-steel"
          >
            {problem.title}
          </a>
        ) : (
          problem.title
        )}
      </p>
      <p className="mb-3 font-mono text-[11px] text-faint">
        {problem.topic} · {problem.difficulty}
        {problem.needed_hint && ' · needed a hint last time'}
      </p>

      {problem.notes &&
        (showNote ? (
          <p className="mb-3 rounded border border-divider bg-base/40 px-3 py-2 font-sans text-[13px] text-muted">
            {problem.notes}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setShowNote(true)}
            className="btn-quiet mb-3 font-mono text-[11px]"
          >
            Show my note
          </button>
        ))}

      <p className="mb-2 font-sans text-[12px] text-muted">Solve it again, then:</p>
      <div className="flex flex-wrap gap-2">
        {OUTCOMES.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={busy}
            onClick={() => record(o.value)}
            className={`rounded border px-4 py-2 font-mono text-[13px] transition-colors hover:bg-raised disabled:opacity-50 ${o.tone}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
