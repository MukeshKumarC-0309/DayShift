import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { api } from '../api/client'
import GitRef from './GitRef'
import { formatMinutes } from '../dates'
import { tagTone } from '../theme'
import type { TagRollup } from '../types'

/**
 * Weekly review → Where the week went: the week's top tags and branches by
 * timed minutes, next to what it produced. Clicking a tag opens Search.
 * Hidden when the week has no tagged or branch-linked time.
 */

const SHOWN = 8

export default function WeekWhere({
  start,
  end,
  onSessionExpired,
}: {
  start: string
  end: string
  onSessionExpired: () => void
}) {
  const [data, setData] = useState<TagRollup | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .tagRollup(start, end)
      .then((rollup) => !cancelled && setData(rollup))
      .catch((err: { status?: number }) => {
        if (!cancelled && err?.status === 401) onSessionExpired()
      })
    return () => {
      cancelled = true
    }
  }, [start, end, onSessionExpired])

  if (!data || (data.tags.length === 0 && data.branches.length === 0)) return null
  const tagged = data.total_minutes - data.untagged_minutes

  return (
    <section className="panel mb-6 px-5 py-4" aria-labelledby="week-where-title">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="week-where-title" className="panel-label">
          Where the week went
        </h2>
        <span className="font-mono text-[11px] text-faint">
          {formatMinutes(tagged)} of {formatMinutes(data.total_minutes)} timed is tagged
        </span>
      </div>
      {data.tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {data.tags.slice(0, SHOWN).map((t) => (
            <Link
              key={t.name}
              to={`/search?tag=${encodeURIComponent(t.name)}`}
              className={`chip ${tagTone(t.name)} hover:brightness-125`}
              title={`${t.session_count} sessions`}
            >
              {t.name}{' '}
              <span className="opacity-70">{formatMinutes(t.total_minutes)}</span>
            </Link>
          ))}
        </div>
      )}
      {data.branches.length > 0 && (
        <ul className="space-y-0.5">
          {data.branches.slice(0, SHOWN).map((b) => (
            <li key={b.name} className="flex items-baseline justify-between gap-3">
              <GitRef value={b.name} />
              <span className="font-mono text-[11px] text-muted tnum">
                {formatMinutes(b.total_minutes)}
                <span className="text-faint"> · {b.session_count}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
