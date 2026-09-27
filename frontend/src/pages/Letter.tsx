import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import { formatMinutes, fromIso, shortDate } from '../dates'
import type { Letter as LetterData } from '../types'

/**
 * The monthly letter: one month, written out.
 *
 * Every sentence is computed from stored data when the page opens — nothing
 * here is typed in or saved — so the letter always agrees with the logs. The
 * current month is marked as still in progress and reads up to yesterday.
 */

interface Props {
  onSessionExpired: () => void
}

function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

function change(now: number, before: number): string | null {
  if (before === 0) return null
  const pct = Math.round(((now - before) / before) * 100)
  if (pct === 0) return 'the same as the month before'
  return pct > 0
    ? `${pct}% more than the month before`
    : `${-pct}% less than the month before`
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-faint">
        {title}
      </h2>
      <div className="space-y-2 font-sans text-[15px] leading-relaxed text-muted">
        {children}
      </div>
    </section>
  )
}

const B = ({ children }: { children: React.ReactNode }) => (
  <strong className="font-medium text-ink">{children}</strong>
)

export default function Letter({ onSessionExpired }: Props) {
  const { month: routeMonth } = useParams()
  const navigate = useNavigate()
  const [months, setMonths] = useState<string[]>([])
  const [letter, setLetter] = useState<LetterData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const month = routeMonth ?? months[0]

  const loadMonths = useCallback(async () => {
    try {
      setMonths(await api.letterMonths())
    } catch (err: unknown) {
      const e = err as { status?: number }
      if (e?.status === 401) onSessionExpired()
      else setError('Could not load the letter.')
    }
  }, [onSessionExpired])

  useEffect(() => {
    void loadMonths()
  }, [loadMonths])

  useEffect(() => {
    if (!month) return
    let cancelled = false
    setLetter(null)
    api
      .letter(month)
      .then((l) => {
        if (!cancelled) {
          setLetter(l)
          setError(null)
        }
      })
      .catch((err: { status?: number; message?: string }) => {
        if (cancelled) return
        if (err?.status === 401) onSessionExpired()
        else setError(err?.message ?? 'Could not load that month.')
      })
    return () => {
      cancelled = true
    }
  }, [month, onSessionExpired])

  const index = month ? months.indexOf(month) : -1
  const newer = index > 0 ? months[index - 1] : undefined
  const older = index >= 0 && index < months.length - 1 ? months[index + 1] : undefined

  return (
    <main className="min-h-screen px-5 pb-10 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-[720px]">
        <PageHeader page="letter">
          {older && (
            <button
              type="button"
              onClick={() => navigate(`/letter/${older}`)}
              className="btn-quiet whitespace-nowrap font-mono"
            >
              ← {monthName(older).split(' ')[0]}
            </button>
          )}
          {newer && (
            <button
              type="button"
              onClick={() => navigate(`/letter/${newer}`)}
              className="btn-quiet whitespace-nowrap font-mono"
            >
              {monthName(newer).split(' ')[0]} →
            </button>
          )}
          <Link
            to={`/year/${month ? month.slice(0, 4) : ''}`}
            className="btn-quiet whitespace-nowrap font-mono"
          >
            Year
          </Link>
          <Link to="/review" className="btn-quiet whitespace-nowrap font-mono">
            Review
          </Link>
        </PageHeader>

        {error && (
          <p className="mb-6 rounded border border-critical/40 bg-critical/5 px-3 py-2 font-mono text-xs text-critical">
            {error}
          </p>
        )}

        {!letter ? (
          !error && (
            <p className="font-mono text-sm text-faint">
              Writing<span className="animate-caret">…</span>
            </p>
          )
        ) : (
          <article className="panel px-6 py-6 sm:px-9 sm:py-8">
            <p className="mb-1 font-mono text-[11px] text-faint">
              {shortDate(letter.start)} – {shortDate(letter.end)}
              {letter.in_progress && ' · still in progress, up to yesterday'}
            </p>
            <h1 className="mb-6 font-sans text-2xl font-semibold text-ink">
              {monthName(letter.month)}
            </h1>

            <Section title="The month">
              <p>
                You worked <B>{formatMinutes(letter.total_minutes)}</B> across every
                category
                {change(letter.total_minutes, letter.previous_total_minutes) && (
                  <> — {change(letter.total_minutes, letter.previous_total_minutes)}</>
                )}
                .
              </p>
              {letter.best_week_start && letter.best_week_minutes > 0 && (
                <p>
                  Your best week began <B>{shortDate(letter.best_week_start)}</B>, with{' '}
                  {formatMinutes(letter.best_week_minutes)}.
                </p>
              )}
            </Section>

            <Section title="Category by category">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-left font-mono text-[12px]">
                  <thead>
                    <tr className="text-faint">
                      <th className="py-1 font-normal">Category</th>
                      <th className="py-1 text-right font-normal">Time</th>
                      <th className="py-1 text-right font-normal">Of target</th>
                      <th className="py-1 text-right font-normal">Days met</th>
                      <th className="py-1 text-right font-normal">Best day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {letter.categories.map((c) => {
                      const pct =
                        c.completion === null ? null : Math.round(c.completion * 100)
                      return (
                        <tr key={c.category_id} className="border-t border-divider">
                          <td className="py-1.5 font-sans text-[13px] text-ink">
                            {c.category_name}
                          </td>
                          <td className="py-1.5 text-right text-muted tnum">
                            {formatMinutes(c.minutes)}
                          </td>
                          <td
                            className={`py-1.5 text-right tnum ${
                              pct === null
                                ? 'text-faint'
                                : pct >= 100
                                  ? 'text-healthy'
                                  : pct >= 80
                                    ? 'text-muted'
                                    : 'text-warn'
                            }`}
                          >
                            {pct === null ? '—' : `${pct}%`}
                          </td>
                          <td className="py-1.5 text-right text-muted tnum">
                            {c.days_owed ? `${c.days_on_target}/${c.days_owed}` : '—'}
                          </td>
                          <td className="py-1.5 text-right text-faint tnum">
                            {c.best_day
                              ? `${fromIso(c.best_day).getDate()} · ${c.best_day_minutes}m`
                              : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Section>

            {(letter.milestones_done.length > 0 || letter.exam_prep.length > 0) && (
              <Section title="What it produced">
                {letter.milestones_done.length > 0 ? (
                  <ul className="list-inside list-disc">
                    {letter.milestones_done.map((m) => (
                      <li key={m.id}>
                        <B>{m.title}</B>{' '}
                        <span className="font-mono text-[11px] text-faint">
                          {shortDate(m.done_on!)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No milestones were finished.</p>
                )}
                {letter.exam_prep.length > 0 && (
                  <ul className="list-inside list-disc">
                    {letter.exam_prep.map((x) => (
                      <li key={`${x.title}-${x.due_date}`}>
                        Exam: <B>{x.title}</B>{' '}
                        <span className="font-mono text-[11px] text-faint">
                          {shortDate(x.due_date)}
                        </span>
                        {' — '}
                        {x.minutes > 0
                          ? `${formatMinutes(x.minutes)} studied for it`
                          : 'no study time linked to it'}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            )}

            {(letter.problems_solved > 0 || letter.revisions > 0) && (
              <Section title="Practice">
                <p>
                  You solved <B>{letter.problems_solved}</B> new problem
                  {letter.problems_solved === 1 ? '' : 's'}
                  {letter.topics.length > 0 && <> across {letter.topics.join(', ')}</>},
                  and revised <B>{letter.revisions}</B>
                  {letter.forgotten > 0 && <> — {letter.forgotten} of them forgotten</>}.
                </p>
              </Section>
            )}

            <Section title="Sleep and energy">
              {letter.checkins === 0 ? (
                <p>No check-ins this month.</p>
              ) : (
                <p>
                  You checked in on <B>{letter.checkins}</B> of{' '}
                  {letter.checkins + letter.checkin_gaps} days
                  {letter.average_sleep_minutes !== null && (
                    <>
                      , sleeping <B>{formatMinutes(letter.average_sleep_minutes)}</B> a
                      night on average
                    </>
                  )}
                  {letter.average_energy !== null && (
                    <>, with morning energy at {letter.average_energy} of 5</>
                  )}
                  .
                </p>
              )}
            </Section>

            {letter.habits.length > 0 && (
              <Section title="Habits">
                <ul className="space-y-1">
                  {letter.habits.map((h) => (
                    <li key={h.name} className="flex justify-between gap-4">
                      <span>{h.name}</span>
                      <span className="font-mono text-[12px] text-ink tnum">
                        {h.done}/{h.applicable} days
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {letter.planned_days > 0 && (
              <Section title="Plans">
                <p>
                  You planned <B>{letter.planned_days}</B> day
                  {letter.planned_days === 1 ? '' : 's'} ahead
                  {letter.plan_kept_percent !== null && (
                    <>
                      , and did <B>{Math.round(letter.plan_kept_percent)}%</B> of the
                      minutes you planned
                    </>
                  )}
                  .
                </p>
              </Section>
            )}

            <p className="border-t border-divider pt-4 font-sans text-[12px] text-faint">
              Written from your logs when you opened it — nothing here is stored, so it
              always matches the data.
            </p>
          </article>
        )}
      </div>
    </main>
  )
}
