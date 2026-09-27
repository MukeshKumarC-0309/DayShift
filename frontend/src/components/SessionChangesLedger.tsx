import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'

import { api } from '../api/client'
import { formatMinutes, shortDate } from '../dates'
import type { SessionChange } from '../types'

/**
 * Honesty ledger, part two: sessions deleted or shortened/lengthened AFTER
 * the day they belonged to. Deleted sessions are kept (the user's choice),
 * so each can be put back from here; nothing is hidden and nothing is
 * forced. Same-day fixes, splits and merges aren't listed — they don't
 * rewrite a finished day's total.
 */

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`)
  const b = new Date(`${to.slice(0, 10)}T00:00:00`)
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export default function SessionChangesLedger({
  onSessionExpired,
}: {
  onSessionExpired: () => void
}) {
  const [changes, setChanges] = useState<SessionChange[] | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setChanges(await api.sessionChanges(true, 100))
    } catch (err: unknown) {
      const e = err as { status?: number }
      if (e?.status === 401) onSessionExpired()
      else setError('Could not load session changes.')
    }
  }, [onSessionExpired])

  useEffect(() => {
    void load()
  }, [load])

  async function undo(change: SessionChange) {
    setBusy(change.id)
    setError(null)
    try {
      await api.undoSessionChange(change.id)
      await load()
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setError(e?.message ?? 'Could not undo that.')
    } finally {
      setBusy(null)
    }
  }

  const live = (changes ?? []).filter((c) => c.undone_at === null)
  const removed = live.reduce(
    (sum, c) => sum + Math.max(0, c.minutes_before - c.minutes_after),
    0,
  )

  return (
    <section className="panel mt-4 px-5 py-4" aria-labelledby="session-ledger-title">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 id="session-ledger-title" className="panel-label">
          Sessions changed after the day
        </h2>
        {live.length > 0 && (
          <span className="font-mono text-[11px] text-warn tnum">
            {formatMinutes(removed)} removed / {live.length}
          </span>
        )}
      </div>
      <p className="mb-3 font-sans text-[11px] text-faint">
        Recorded sessions deleted, or their minutes changed, on a later day. Deleted ones
        are kept and can be put back.
      </p>

      {changes && changes.length === 0 && (
        <p className="font-mono text-[11px] text-healthy">
          None. No finished day's sessions have been changed afterwards.
        </p>
      )}

      {changes && changes.length > 0 && (
        <ul className="divide-y divide-divider">
          {changes.map((c) => {
            const late = daysBetween(c.log_date, c.created_at)
            const lowered = c.minutes_after < c.minutes_before
            return (
              <li
                key={c.id}
                className={`flex flex-wrap items-baseline justify-between gap-2 py-2 ${
                  c.undone_at ? 'opacity-60' : ''
                }`}
              >
                <div className="min-w-0">
                  <Link
                    to={`/day/${c.log_date}`}
                    className="font-mono text-[12px] text-ink tnum hover:text-steel"
                  >
                    {c.log_date}
                  </Link>
                  <span className="ml-2 font-sans text-[12px] text-muted">
                    {c.category_name}
                  </span>
                  {c.notes.length > 0 && (
                    <div className="font-sans text-[11px] text-faint">
                      {c.notes.join(' · ')}
                    </div>
                  )}
                </div>
                <div className="flex items-baseline gap-3 font-mono text-[11px] tnum">
                  {c.action === 'delete' ? (
                    <span className="text-warn">deleted {c.minutes_before} min</span>
                  ) : (
                    <span>
                      <span className="text-faint">{c.minutes_before}</span>
                      <span className={lowered ? 'text-warn' : 'text-muted'}>
                        {' → '}
                        {c.minutes_after} min
                      </span>
                    </span>
                  )}
                  <span className="text-faint">{late}d later</span>
                  {c.undone_at ? (
                    <span className="text-healthy">
                      {c.action === 'delete' ? 'restored' : 'undone'}{' '}
                      {shortDate(c.undone_at.slice(0, 10))}
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void undo(c)}
                      className="btn-quiet font-mono"
                    >
                      {busy === c.id ? '…' : c.action === 'delete' ? 'restore' : 'undo'}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-2 font-mono text-xs text-critical">
          {error}
        </p>
      )}
    </section>
  )
}
