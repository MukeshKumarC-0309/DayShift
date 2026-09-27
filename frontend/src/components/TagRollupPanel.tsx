import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { api } from '../api/client'
import { formatMinutes } from '../dates'
import { colourIndex } from '../domains'
import { categoryTheme } from '../theme'
import type { Category, TagRollup } from '../types'

/**
 * Insights → Time by tag: minutes per tag over the page's period, each bar
 * split by the categories the time came from. Hand-built SVG like every
 * chart here. A session with two tags counts toward both, so bars can add up
 * to more than the period's total — the caption says so rather than hiding
 * it. Clicking a tag opens Search filtered to it.
 */

interface Props {
  start: string
  end: string
  categories: Category[]
  onSessionExpired: () => void
}

/** Beyond this many tags the rest are summarised in one line. */
const SHOWN = 12

export default function TagRollupPanel({
  start,
  end,
  categories,
  onSessionExpired,
}: Props) {
  const [data, setData] = useState<TagRollup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    api
      .tagRollup(start, end)
      .then((rollup) => {
        if (!cancelled) {
          setData(rollup)
          setError(null)
        }
      })
      .catch((err: { status?: number }) => {
        if (cancelled) return
        if (err?.status === 401) onSessionExpired()
        else setError('Could not load tag totals.')
      })
    return () => {
      cancelled = true
    }
  }, [start, end, onSessionExpired])

  const rows = data?.tags.slice(0, SHOWN) ?? []
  const rest = data ? data.tags.slice(SHOWN) : []
  const longest = Math.max(1, ...rows.map((r) => r.total_minutes))
  const nameOf = (id: number) => categories.find((c) => c.id === id)?.name ?? 'Category'

  return (
    <section className="panel mb-6 px-5 py-4" aria-labelledby="tag-rollup-title">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="tag-rollup-title" className="panel-label">
          Time by tag
        </h2>
        {data && data.total_minutes > 0 && (
          <span className="font-mono text-[11px] text-faint">
            {formatMinutes(data.total_minutes - data.untagged_minutes)} of{' '}
            {formatMinutes(data.total_minutes)} timed is tagged
          </span>
        )}
      </div>
      <p className="mb-3 font-sans text-[11px] text-faint">
        From timed sessions, all domains. A session with two tags counts toward both.
      </p>

      {error && <p className="font-mono text-xs text-critical">{error}</p>}

      {data && rows.length === 0 && (
        <p className="font-sans text-[12px] text-muted">
          No tagged sessions in this period. Add tags in the timer before you start, or to
          a past session from its day view.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="space-y-1.5">
          {rows.map((row) => {
            const segments = Object.entries(row.by_category)
              .map(([id, minutes]) => ({ id: Number(id), minutes }))
              // Largest first. Sorted here: a parsed JSON object lists numeric
              // keys in ascending order, whatever order the server sent.
              .sort((a, b) => b.minutes - a.minutes)
            let x = 0
            return (
              <li
                key={row.name}
                className="grid grid-cols-[minmax(84px,140px)_1fr_104px] items-center gap-3"
              >
                <button
                  type="button"
                  onClick={() => navigate(`/search?tag=${encodeURIComponent(row.name)}`)}
                  className="truncate text-left font-mono text-[12px] text-ink hover:text-steel"
                  title={`Every session tagged ${row.name}`}
                >
                  {row.name}
                </button>
                <svg
                  viewBox="0 0 100 10"
                  preserveAspectRatio="none"
                  className="h-2.5 w-full"
                  role="img"
                  aria-label={`${row.name}: ${formatMinutes(row.total_minutes)}, ${segments
                    .map((s) => `${nameOf(s.id)} ${formatMinutes(s.minutes)}`)
                    .join(', ')}`}
                >
                  <rect
                    x={0}
                    y={0}
                    width={100}
                    height={10}
                    rx={2}
                    className="fill-raised"
                  />
                  {segments.map((s) => {
                    const width = (s.minutes / longest) * 100
                    const rect = (
                      <rect
                        key={s.id}
                        x={x}
                        y={0}
                        width={width}
                        height={10}
                        fill={categoryTheme(colourIndex(s.id)).bright}
                      >
                        <title>
                          {nameOf(s.id)}: {formatMinutes(s.minutes)}
                        </title>
                      </rect>
                    )
                    x += width
                    return rect
                  })}
                </svg>
                <span className="whitespace-nowrap text-right font-mono text-[11px] text-muted tnum">
                  {formatMinutes(row.total_minutes)}
                  <span className="text-faint"> · {row.session_count}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {rest.length > 0 && (
        <p className="mt-2 font-mono text-[11px] text-faint">
          + {rest.length} more tag{rest.length === 1 ? '' : 's'} ·{' '}
          {formatMinutes(rest.reduce((sum, r) => sum + r.total_minutes, 0))}
        </p>
      )}
    </section>
  )
}
