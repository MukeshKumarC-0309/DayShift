import { useEffect } from 'react'

import type { SessionChange } from '../../types'
import { describeChange } from './sessionText'

/**
 * "Deleted a 50-min SDE Project session. Undo" — offered for 15 seconds after
 * a delete, edit, split or merge. Every change is kept in the history, so it
 * can still be undone later (a deletion from the honesty ledger); this is the
 * quick way.
 */

export const UNDO_SECONDS = 15

interface Props {
  change: SessionChange
  busy: boolean
  error: string | null
  onUndo: () => void
  onDismiss: () => void
}

export default function UndoBar({ change, busy, error, onUndo, onDismiss }: Props) {
  useEffect(() => {
    if (error) return // keep a refusal on screen until dismissed
    const timer = window.setTimeout(onDismiss, UNDO_SECONDS * 1000)
    return () => window.clearTimeout(timer)
  }, [change.id, error, onDismiss])

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded border border-steel/30 bg-steel/5 px-3 py-2"
    >
      <span className="font-sans text-[12px] text-muted">
        {error ?? describeChange(change)}
      </span>
      <div className="flex items-center gap-1">
        {!error && (
          <button
            type="button"
            onClick={onUndo}
            disabled={busy}
            className="btn-quiet font-mono text-steel"
          >
            {busy ? 'Undoing…' : 'Undo'}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="btn-quiet font-mono"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  )
}
