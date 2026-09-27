import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import { formatMinutes, shortDate } from '../dates'
import type { YearReview } from '../types'

/**
 * A year in review, built from its monthly letters so the two always agree.
 * Nothing is stored. Useful from the first month; it fills in as the year
 * does.
 */

interface Props {
  onSessionExpired: () => void
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

export default function Year({ onSessionExpired }: Props) {
  const { year: routeYear } = useParams()
  const navigate = useNavigate()
  const thisYear = new Date().getFullYear()
  const year = Number(routeYear ?? thisYear)
  const [data, setData] = useState<YearReview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    api
      .year(year)
      .then((y) => {
        if (!cancelled) {
          setData(y)
          setError(null)
        }
      })
      .catch((err: { status?: number; message?: string }) => {
        if (cancelled) return
        if (err?.status === 401) onSessionExpired()
        else setError(err?.message ?? 'Could not load that year.')
      })
    return () => {
      cancelled = true
    }
  }, [year, onSessionExpired])

  const maxMonth = Math.max(60, ...(data?.months.map((m) => m.minutes) ?? [0]))

  return (
    <main className="min-h-screen px-5 pb-10 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-[860px]">
        <PageHeader page={`year ${year}`}>
          <button
            type="button"
            onClick={() => navigate(`/year/${year - 1}`)}
            className="btn-quiet whitespace-nowrap font-mono"
          >
            ← {year - 1}
          </button>
          {year < thisYear && (
            <button
              type="button"
              onClick={() => navigate(`/year/${year + 1}`)}
              className="btn-quiet whitespace-nowrap font-mono"
            >
              {year + 1} →
            </button>
          )}
          <Link to="/letter" className="btn-quiet whitespace-nowrap font-mono">
            Monthly letter
          </Link>
        </PageHeader>

        {error && (
          <p className="mb-6 rounded border border-critical/40 bg-critical/5 px-3 py-2 font-mono text-xs text-critical">
            {error}
          </p>
        )}

        {data && (
          <article className="panel px-6 py-6 sm:px-9 sm:py-8">
            <h1 className="mb-1 font-sans text-2xl font-semibold text-ink">
              {data.year}
            </h1>
            <p className="mb-6 font-sans text-[15px] text-muted">
              <strong className="font-medium text-ink">
                {formatMinutes(data.total_minutes)}
              </strong>{' '}
              of tracked work
              {data.best_month && (
                <>
                  ; the biggest month was{' '}
                  <strong className="font-medium text-ink">
                    {MONTHS[Number(data.best_month.slice(5)) - 1]}
                  </strong>
                </>
              )}
              .
            </p>

            {/* Month bars — hand-built SVG, like every chart in the app. */}
            <svg
              viewBox="0 0 600 130"
              className="mb-6 w-full"
              role="img"
              aria-label={`Minutes per month in ${data.year}`}
            >
              {MONTHS.map((label, i) => {
                const month = data.months[i]
                const height = month ? (month.minutes / maxMonth) * 96 : 0
                const x = i * 50 + 10
                const best = month && data.best_month === month.month
                return (
                  <g key={label}>
                    <rect
                      x={x}
                      y={104 - height}
                      width={30}
                      height={Math.max(height, month ? 2 : 0)}
                      rx={4}
                      fill={best ? '#8aaeff' : '#60a5fa'}
                      opacity={month ? (best ? 1 : 0.7) : 0}
                    >
                      <title>
                        {label}: {month ? formatMinutes(month.minutes) : 'not yet'}
                      </title>
                    </rect>
                    <text
                      x={x + 15}
                      y={122}
                      textAnchor="middle"
                      className={`fill-current font-mono text-[10px] ${month ? 'text-muted' : 'text-faint'}`}
                    >
                      {label}
                    </text>
                  </g>
                )
              })}
              <line x1={0} x2={600} y1={104} y2={104} stroke="#3a4263" />
            </svg>

            <h2 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-faint">
              Category by category
            </h2>
            <div className="mb-7 overflow-x-auto">
              <table className="w-full min-w-[440px] text-left font-mono text-[12px]">
                <thead>
                  <tr className="text-faint">
                    <th className="py-1 font-normal">Category</th>
                    <th className="py-1 text-right font-normal">Time</th>
                    <th className="py-1 text-right font-normal">Of target</th>
                    <th className="py-1 text-right font-normal">Days met</th>
                  </tr>
                </thead>
                <tbody>
                  {data.categories.map((c) => (
                    <tr key={c.category_id} className="border-t border-divider">
                      <td className="py-1.5 font-sans text-[13px] text-ink">
                        {c.category_name}
                      </td>
                      <td className="py-1.5 text-right text-muted tnum">
                        {formatMinutes(c.minutes)}
                      </td>
                      <td className="py-1.5 text-right text-muted tnum">
                        {c.completion === null
                          ? '—'
                          : `${Math.round(c.completion * 100)}%`}
                      </td>
                      <td className="py-1.5 text-right text-muted tnum">
                        {c.days_owed ? `${c.days_on_target}/${c.days_owed}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 gap-6 font-sans text-[14px] text-muted sm:grid-cols-2">
              <div>
                <h2 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-faint">
                  Practice
                </h2>
                <p>
                  {data.problems_solved} problems solved, {data.revisions} revisions.
                </p>
              </div>
              <div>
                <h2 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-faint">
                  Sleep
                </h2>
                <p>
                  {data.checkins} check-ins
                  {data.average_sleep_minutes !== null &&
                    `, ${formatMinutes(data.average_sleep_minutes)} a night on average`}
                  .
                </p>
              </div>
              {data.habits.length > 0 && (
                <div>
                  <h2 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-faint">
                    Habits
                  </h2>
                  <ul className="space-y-0.5">
                    {data.habits.map((h) => (
                      <li key={h.name} className="flex justify-between gap-3">
                        <span>{h.name}</span>
                        <span className="font-mono text-[12px] text-ink">
                          {h.done}/{h.applicable}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.exam_prep.length > 0 && (
                <div>
                  <h2 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-faint">
                    Exams
                  </h2>
                  <ul className="space-y-0.5">
                    {data.exam_prep.map((x) => (
                      <li
                        key={`${x.title}-${x.due_date}`}
                        className="flex justify-between gap-3"
                      >
                        <span>
                          {x.title}{' '}
                          <span className="font-mono text-[11px] text-faint">
                            {shortDate(x.due_date)}
                          </span>
                        </span>
                        <span className="font-mono text-[12px] text-ink">
                          {x.minutes ? formatMinutes(x.minutes) : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {data.milestones_done.length > 0 && (
              <>
                <h2 className="mb-2 mt-7 font-mono text-[10px] uppercase tracking-widest text-faint">
                  Milestones
                </h2>
                <ul className="list-inside list-disc font-sans text-[14px] text-muted">
                  {data.milestones_done.map((m) => (
                    <li key={m.id}>
                      <span className="text-ink">{m.title}</span>{' '}
                      <span className="font-mono text-[11px] text-faint">
                        {shortDate(m.done_on!)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </article>
        )}
      </div>
    </main>
  )
}
