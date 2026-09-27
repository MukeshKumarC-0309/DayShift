import { useEffect, useState } from 'react'

import { api } from '../api/client'
import { formatMinutes } from '../dates'
import type { FocusStats } from '../types'

/**
 * Insights → Focus blocks: how many 25/50 blocks you started in the period,
 * how many ran to the end, and how long the early ones lasted. A block that
 * ends early isn't a failure — this is just the pattern, so you can pick the
 * length you actually finish.
 */

export default function FocusStatsPanel({
  days,
  onSessionExpired,
}: {
  days: number
  onSessionExpired: () => void
}) {
  const [data, setData] = useState<FocusStats | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .focusStats(days)
      .then((stats) => !cancelled && setData(stats))
      .catch((err: { status?: number }) => {
        if (!cancelled && err?.status === 401) onSessionExpired()
      })
    return () => {
      cancelled = true
    }
  }, [days, onSessionExpired])

  if (!data) return null
  const rate = data.blocks ? Math.round((100 * data.finished) / data.blocks) : 0

  return (
    <section className="panel mb-6 px-5 py-4" aria-labelledby="focus-stats-title">
      <h2 id="focus-stats-title" className="panel-label mb-1">
        Focus blocks
      </h2>
      {data.blocks === 0 ? (
        <p className="font-sans text-[12px] text-muted">
          No focus blocks in this period. Pick 25 or 50 in the timer to start one.
        </p>
      ) : (
        <>
          <p className="mb-3 font-sans text-[13px] text-muted">
            <strong className="font-medium text-ink">{data.blocks}</strong> blocks,{' '}
            <strong className="font-medium text-ink">{data.finished}</strong> run to the
            end ({rate}%)
            {data.ended_early > 0 && data.average_early_minutes !== null && (
              <>
                ; {data.ended_early} ended early, after{' '}
                {formatMinutes(data.average_early_minutes)} on average
              </>
            )}
            . {formatMinutes(data.focus_minutes)} of focused time.
          </p>
          <ul className="space-y-1.5">
            {data.by_length.map((row) => {
              const share = row.blocks ? row.finished / row.blocks : 0
              return (
                <li
                  key={row.planned_minutes}
                  className="grid grid-cols-[72px_1fr_110px] items-center gap-3"
                >
                  <span className="font-mono text-[12px] text-ink">
                    {row.planned_minutes} min
                  </span>
                  <svg
                    viewBox="0 0 100 10"
                    preserveAspectRatio="none"
                    className="h-2.5 w-full"
                    role="img"
                    aria-label={`${row.planned_minutes}-minute blocks: ${row.finished} of ${row.blocks} finished`}
                  >
                    <rect
                      x={0}
                      y={0}
                      width={100}
                      height={10}
                      rx={2}
                      className="fill-raised"
                    />
                    <rect
                      x={0}
                      y={0}
                      width={share * 100}
                      height={10}
                      rx={2}
                      className="fill-healthy"
                    />
                  </svg>
                  <span className="text-right font-mono text-[11px] text-muted tnum">
                    {row.finished}/{row.blocks} finished
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
