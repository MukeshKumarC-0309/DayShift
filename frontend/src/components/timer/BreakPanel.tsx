import type { Category } from '../../types'
import { type Break, formatClock } from './timerState'

/** The break after a focus block: a countdown, then "next block" or "done". */

interface Props {
  pause: Break
  secondsLeft: number
  categories: Category[]
  busy: boolean
  onNext: () => void
  onDone: () => void
}

export default function BreakPanel({
  pause,
  secondsLeft,
  categories,
  busy,
  onNext,
  onDone,
}: Props) {
  return (
    <div role="status">
      <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-faint">
        {secondsLeft > 0 ? 'Break' : 'Break over'}
      </p>
      <p className="mb-3 font-mono text-[32px] text-healthy tnum">
        {secondsLeft > 0 ? formatClock(secondsLeft) : 'Ready?'}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={onNext} className="btn-primary">
          Next {pause.mode}-minute block:{' '}
          {categories.find((c) => c.id === pause.categoryId)?.name ?? 'same category'}
        </button>
        <button type="button" onClick={onDone} className="btn-quiet">
          {secondsLeft > 0 ? 'Skip break' : 'Done for now'}
        </button>
      </div>
    </div>
  )
}
