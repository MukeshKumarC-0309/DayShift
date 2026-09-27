import { useState } from 'react'

import { dayLabel } from '../dates'
import type { GitCategory, GitFlag } from '../types'

/**
 * Your commits beside the minutes you logged, per category with repositories.
 *
 * Read-only and informational: a flag is a prompt to look, not a verdict —
 * reading, debugging and design are real work that commit nothing. Any flag
 * can be dismissed; dismissals are remembered in this browser only.
 */

const DISMISSED_KEY = 'dayshift.git.dismissed'

const FLAG_TEXT: Record<GitFlag, string> = {
  logged_no_commits: 'logged, no commits',
  commits_not_logged: 'commits, nothing logged',
}

function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(DISMISSED_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

function writeDismissed(values: Set<string>) {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...values]))
  } catch {
    /* Not remembered; the flag is still hidden for this visit. */
  }
}

export default function GitPanel({ data }: { data: GitCategory[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed)

  if (data.length === 0) return null

  function dismiss(id: string) {
    const next = new Set(dismissed)
    next.add(id)
    setDismissed(next)
    writeDismissed(next)
  }

  return (
    <section className="panel mb-6 px-5 py-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="panel-label">Git vs logged</h2>
        <span className="font-mono text-[10px] text-faint">
          read-only · a prompt to look, never a verdict
        </span>
      </div>

      <div className="space-y-5">
        {data.map((cat) => {
          const maxMinutes = Math.max(60, ...cat.days.map((d) => d.minutes))
          const maxCommits = Math.max(1, ...cat.days.map((d) => d.commits))
          const flags = cat.days.filter(
            (d) => d.flag && !dismissed.has(`${cat.category_id}|${d.day}`),
          )
          return (
            <div key={cat.category_id}>
              <p className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-sans text-sm text-ink">{cat.category_name}</span>
                <span className="font-mono text-[10px] text-faint">
                  {cat.total_commits} commits · {cat.repos.length} repo
                  {cat.repos.length === 1 ? '' : 's'}
                </span>
              </p>
              {cat.errors.map((e) => (
                <p key={e} className="mb-1 font-mono text-[11px] text-critical">
                  {e}
                </p>
              ))}
              {/* Minutes as bars above the line, commits as bars below it. */}
              <div className="flex h-16 items-stretch gap-[2px]" aria-hidden="true">
                {cat.days.map((d) => (
                  <div
                    key={d.day}
                    className="flex flex-1 flex-col justify-center"
                    title={`${dayLabel(d.day)}: ${d.minutes} min logged, ${d.commits} commits`}
                  >
                    <div className="flex h-1/2 items-end">
                      <div
                        className={`w-full rounded-t-sm ${d.flag === 'logged_no_commits' ? 'bg-warn/70' : 'bg-steel/70'}`}
                        style={{ height: `${(d.minutes / maxMinutes) * 100}%` }}
                      />
                    </div>
                    <div className="flex h-1/2 items-start border-t border-divider">
                      <div
                        className={`w-full rounded-b-sm ${d.flag === 'commits_not_logged' ? 'bg-warn/70' : 'bg-muted/60'}`}
                        style={{ height: `${(d.commits / maxCommits) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {/* Commits are drawn neutral: green is reserved for "on target". */}
              <p className="mt-1 font-mono text-[10px] text-faint">
                Above the line: minutes logged. Below: commits. Amber: a mismatch.
              </p>
              {flags.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {flags.slice(0, 6).map((d) => (
                    <li
                      key={d.day}
                      className="flex items-center justify-between gap-3 font-mono text-[11px] text-warn"
                    >
                      <span>
                        {dayLabel(d.day)} — {FLAG_TEXT[d.flag!]} ({d.minutes} min,{' '}
                        {d.commits} commits)
                      </span>
                      <button
                        type="button"
                        onClick={() => dismiss(`${cat.category_id}|${d.day}`)}
                        className="btn-quiet font-mono text-[10px]"
                      >
                        Dismiss
                      </button>
                    </li>
                  ))}
                  {flags.length > 6 && (
                    <li className="font-mono text-[10px] text-faint">
                      + {flags.length - 6} more
                    </li>
                  )}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
