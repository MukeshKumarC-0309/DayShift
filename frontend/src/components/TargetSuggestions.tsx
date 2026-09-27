import { useCallback, useEffect, useState } from 'react'

import { api } from '../api/client'
import { shortDate } from '../dates'
import type { TargetSuggestion } from '../types'

/**
 * "Your target looks too easy / too hard" — a suggestion, never applied alone.
 *
 * Apply is an ordinary effective-dated target change from next Monday, so no
 * past day is rescored. Dismissed suggestions stay hidden (in this browser)
 * until another week of data arrives. Thresholds live in Settings.
 */

const DISMISSED_KEY = 'dayshift.targets.dismissed'

function key(s: TargetSuggestion): string {
  return `${s.category_id}:${s.direction}:${s.weeks.at(-1)}`
}

function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(DISMISSED_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

export default function TargetSuggestions({
  onSessionExpired,
}: {
  onSessionExpired: () => void
}) {
  const [items, setItems] = useState<TargetSuggestion[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed)
  const [applied, setApplied] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setItems(await api.targetSuggestions())
    } catch (err: unknown) {
      if ((err as { status?: number })?.status === 401) onSessionExpired()
    }
  }, [onSessionExpired])

  useEffect(() => {
    void load()
  }, [load])

  function dismiss(s: TargetSuggestion) {
    const next = new Set(dismissed)
    next.add(key(s))
    setDismissed(next)
    try {
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]))
    } catch {
      /* Hidden for this visit only. */
    }
  }

  async function apply(s: TargetSuggestion) {
    setError(null)
    try {
      await api.setTarget(s.category_id, {
        daily_target_minutes: s.suggested_target,
        active_days: s.active_days,
        effective_from: s.effective_from,
      })
      setApplied(
        `${s.category_name}: ${s.suggested_target} min/day from ${shortDate(s.effective_from)}`,
      )
      await load()
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 401) onSessionExpired()
      else setError(e?.message ?? 'Could not change the target.')
    }
  }

  const shown = items.filter((s) => !dismissed.has(key(s)))
  if (shown.length === 0 && !applied) return null

  return (
    <section className="panel mb-6 px-5 py-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="panel-label">Target check</h2>
        <span className="font-mono text-[10px] text-faint">
          a suggestion — you decide
        </span>
      </div>
      <ul className="divide-y divide-divider">
        {shown.map((s) => (
          <li key={key(s)} className="py-2.5 first:pt-0 last:pb-0">
            <p className="font-sans text-sm text-ink">
              {s.category_name}:{' '}
              {s.direction === 'raise'
                ? `at least ${Math.round(Math.min(...s.weekly_percents))}% of target every week for ${s.weeks.length} weeks.`
                : `at most ${Math.round(Math.max(...s.weekly_percents))}% of target every week for ${s.weeks.length} weeks.`}
            </p>
            <p className="mb-2 font-mono text-[11px] text-faint">
              Weeks: {s.weekly_percents.map((p) => `${Math.round(p)}%`).join(' · ')} — you
              average about {s.suggested_target} min on a scheduled day.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => apply(s)} className="btn text-[12px]">
                {s.direction === 'raise' ? 'Raise' : 'Lower'} {s.current_target} →{' '}
                {s.suggested_target} min from {shortDate(s.effective_from)}
              </button>
              <button
                type="button"
                onClick={() => dismiss(s)}
                className="btn-quiet font-mono text-[11px]"
              >
                Keep {s.current_target}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {applied && (
        <p className="mt-2 font-mono text-[11px] text-healthy">Changed — {applied}.</p>
      )}
      {error && <p className="mt-2 font-mono text-xs text-critical">{error}</p>}
    </section>
  )
}
