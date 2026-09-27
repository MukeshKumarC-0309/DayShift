import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { api } from '../api/client'
import SessionChangesLedger from '../components/SessionChangesLedger'
import WeekWhere from '../components/WeekWhere'
import { DomainSwitcher } from '../components/DomainSwitcher'
import PageHeader from '../components/PageHeader'
import TargetSuggestions from '../components/TargetSuggestions'
import { colourIndex, useDomains } from '../domains'
import { categoryTheme } from '../theme'
import type {
  Category,
  CategoryRecords,
  HonestyLedger,
  Milestone,
  WeeklyReview,
} from '../types'

/**
 * The weekly ritual: what the week actually was, what you had promised it
 * would be, what you want to say about it, and — separately — every target
 * you moved after the fact.
 *
 * Defaults to the week just finished. Reviewing a week that is still running
 * is guessing.
 */

interface Props {
  onSessionExpired: () => void
}

function shiftWeeks(iso: string, weeks: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d + weeks * 7)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatRange(start: string, end: string): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    })
  }
  return `${fmt(start)} – ${fmt(end)}`
}

function hours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export default function Review({ onSessionExpired }: Props) {
  const [week, setWeek] = useState<string | undefined>(undefined)
  const [review, setReview] = useState<WeeklyReview | null>(null)
  const [records, setRecords] = useState<CategoryRecords[]>([])
  const [ledger, setLedger] = useState<HonestyLedger | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [draft, setDraft] = useState('')
  const [commitDraft, setCommitDraft] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [rev, recs, led, cats] = await Promise.all([
        api.review(week),
        api.records(),
        api.ledger(),
        api.categories(),
      ])
      setCategories(cats)
      setReview(rev)
      setMilestones(
        await api.milestones({ done_from: rev.week_start, done_to: rev.week_end }),
      )
      setRecords(recs)
      setLedger(led)
      setDraft(rev.reflection)
      setCommitDraft(
        Object.fromEntries(
          rev.commitments.map((c) => [
            c.category_id,
            c.committed_minutes === null ? '' : String(c.committed_minutes),
          ]),
        ),
      )
      setError(null)
    } catch (err: unknown) {
      const e = err as { status?: number }
      if (e?.status === 401) onSessionExpired()
      else setError('Could not load the review.')
    }
  }, [week, onSessionExpired])

  useEffect(() => {
    void load()
  }, [load])

  async function saveReflection() {
    if (!review) return
    setSaving(true)
    try {
      const updated = await api.saveReflection(review.week_start, draft)
      setReview(updated)
      setSavedAt(new Date().toLocaleTimeString())
    } catch {
      setError('Could not save the reflection.')
    } finally {
      setSaving(false)
    }
  }

  async function saveCommitment(categoryId: number) {
    if (!review) return
    const raw = commitDraft[categoryId]
    try {
      if (raw === undefined || raw.trim() === '') {
        await api.clearCommitment(review.week_start, categoryId).catch(() => undefined)
      } else {
        await api.setCommitment(review.week_start, categoryId, Number(raw))
      }
      await load()
    } catch {
      setError('Could not save that commitment.')
    }
  }

  // The numbers, commitments and records page by domain like the dashboard;
  // the reflection and the ledger are about the whole week, so they don't.
  const domain = useDomains(categories)
  const activeIds = domain.active.categoryIds
  const shown = useMemo(() => new Set(activeIds), [activeIds])
  const colourOf = colourIndex

  if (!review) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="font-mono text-sm text-faint">
          {error ?? (
            <>
              Loading<span className="animate-caret">…</span>
            </>
          )}
        </span>
      </main>
    )
  }

  const nextWeek = shiftWeeks(review.week_start, 1)

  return (
    <main className="min-h-screen px-5 pb-10 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-[1000px]">
        <PageHeader page="review">
          <button
            type="button"
            onClick={() => setWeek(shiftWeeks(review.week_start, -1))}
            className="btn-quiet whitespace-nowrap font-mono"
          >
            ← Earlier
          </button>
          <span className="px-1 font-mono text-[11px] text-muted">
            {formatRange(review.week_start, review.week_end)}
          </span>
          <button
            type="button"
            onClick={() => setWeek(nextWeek)}
            className="btn-quiet whitespace-nowrap font-mono"
          >
            Later →
          </button>
          <Link to="/letter" className="btn-quiet whitespace-nowrap font-mono">
            Monthly letter
          </Link>
        </PageHeader>

        {review.is_current_week && (
          <p className="mb-6 rounded border border-warn/30 bg-warn/5 px-3 py-2 font-mono text-xs text-warn">
            This week is still running — the numbers below are not final.
          </p>
        )}

        <DomainSwitcher
          domains={domain.domains}
          index={domain.index}
          onPrev={domain.prev}
          onNext={domain.next}
          onGoTo={domain.goTo}
          caption={categories
            .filter((c) => shown.has(c.id))
            .map((c) => c.name)
            .join(' · ')}
        />

        {/* --- The week's numbers -------------------------------------- */}
        <section className="panel mb-6 px-5 py-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="panel-label">The week</h2>
            <span className="font-mono text-[11px] text-muted tnum">
              {hours(
                review.categories
                  .filter((c) => shown.has(c.category_id))
                  .reduce((sum, c) => sum + c.minutes_logged, 0),
              )}{' '}
              in {domain.active.name} · {hours(review.total_minutes)} overall
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {review.categories
              .filter((category) => shown.has(category.category_id))
              .map((category) => {
                const theme = categoryTheme(colourOf(category.category_id))
                const tone =
                  category.percent === null
                    ? 'text-faint'
                    : category.percent >= 80
                      ? 'text-healthy'
                      : category.percent >= 50
                        ? 'text-warn'
                        : 'text-critical'
                return (
                  <div key={category.category_id}>
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className="dot"
                        style={{ backgroundColor: theme.bright }}
                        aria-hidden="true"
                      />
                      <span className="truncate font-sans text-xs text-ink">
                        {category.category_name}
                      </span>
                    </div>
                    <div className={`font-mono text-[22px] tnum ${tone}`}>
                      {category.percent === null
                        ? '—'
                        : `${category.percent.toFixed(0)}%`}
                    </div>
                    <div className="font-mono text-[11px] text-faint tnum">
                      {category.minutes_logged}/{category.target_total} min ·{' '}
                      {category.days_counted}d
                    </div>
                  </div>
                )
              })}
          </div>
        </section>

        <TargetSuggestions onSessionExpired={onSessionExpired} />

        {/* --- Milestones finished ---------------------------------------- */}
        <section className="panel mb-6 px-5 py-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="panel-label">What it produced</h2>
            <Link
              to="/goals"
              className="font-mono text-[10px] text-faint hover:text-steel"
            >
              Milestones →
            </Link>
          </div>
          {milestones.length === 0 ? (
            <p className="font-sans text-sm text-muted">
              No milestones finished this week.
            </p>
          ) : (
            <ul className="space-y-1">
              {milestones.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-2 font-sans text-sm text-ink"
                >
                  <span className="text-healthy" aria-hidden="true">
                    ✓
                  </span>
                  {m.title}
                  <span className="font-mono text-[10px] text-faint">
                    {categories.find((c) => c.id === m.category_id)?.name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {review && (
          <WeekWhere
            start={review.week_start}
            end={review.week_end}
            onSessionExpired={onSessionExpired}
          />
        )}

        {/* --- Commitments --------------------------------------------- */}
        <section className="panel mb-6 px-5 py-4">
          <h2 className="panel-label mb-1">Commitments</h2>
          <p className="mb-3 font-sans text-[11px] text-faint">
            What you said you would do, next to what you did. Separate from the target —
            the target is the standing expectation, this is what you actually claimed you
            would manage.
          </p>

          <div className="space-y-2.5">
            {review.commitments
              .filter((row) => shown.has(row.category_id))
              .map((row) => (
                <div
                  key={row.category_id}
                  className="flex flex-wrap items-center gap-3 border-b border-divider pb-2.5 last:border-b-0"
                >
                  <span className="flex w-40 shrink-0 items-center gap-2">
                    <span
                      className="dot"
                      style={{
                        backgroundColor: categoryTheme(colourOf(row.category_id)).bright,
                      }}
                      aria-hidden="true"
                    />
                    <span className="truncate font-sans text-xs text-ink">
                      {row.category_name}
                    </span>
                  </span>

                  <input
                    type="number"
                    min={0}
                    step={5}
                    placeholder="—"
                    value={commitDraft[row.category_id] ?? ''}
                    onChange={(e) =>
                      setCommitDraft({
                        ...commitDraft,
                        [row.category_id]: e.target.value,
                      })
                    }
                    onBlur={() => saveCommitment(row.category_id)}
                    className="term-input max-w-[100px] text-[13px]"
                    aria-label={`${row.category_name} commitment`}
                  />
                  <span className="font-mono text-[11px] text-faint">min promised</span>

                  <span className="ml-auto font-mono text-[11px] tnum">
                    {row.committed_minutes === null ? (
                      <span className="text-faint">nothing promised</span>
                    ) : row.kept ? (
                      <span className="text-healthy">
                        kept · did {row.actual_minutes} (+{row.delta_minutes})
                      </span>
                    ) : (
                      <span className="text-critical">
                        short {Math.abs(row.delta_minutes ?? 0)} · did{' '}
                        {row.actual_minutes}
                      </span>
                    )}
                  </span>
                </div>
              ))}
          </div>
        </section>

        {/* --- Reflection ----------------------------------------------- */}
        <section className="panel mb-6 px-5 py-4">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="panel-label">Reflection</h2>
            {review.reviewed_at && (
              <span className="font-mono text-[10px] text-faint">
                last saved {review.reviewed_at.replace('T', ' ')}
              </span>
            )}
          </div>
          <p className="mb-3 font-sans text-[11px] text-faint">
            The numbers are computed; this is the part only you can supply. What got in
            the way, what worked, what you are changing.
          </p>

          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setSavedAt(null)
            }}
            rows={6}
            maxLength={5000}
            placeholder="Lost Tuesday to a lab that overran. Mornings worked better than evenings this week…"
            className="term-input resize-y text-[13px] leading-relaxed"
          />

          <div className="mt-2 flex items-center justify-between">
            <span className="font-mono text-[10px] text-faint tnum">
              {draft.length}/5000
            </span>
            <div className="flex items-center gap-3">
              {savedAt && (
                <span className="font-mono text-[11px] text-healthy">
                  Saved {savedAt}
                </span>
              )}
              <button
                type="button"
                onClick={saveReflection}
                disabled={saving || draft === review.reflection}
                className="btn"
              >
                {saving ? 'Saving…' : 'Save reflection'}
              </button>
            </div>
          </div>
        </section>

        {/* --- Records -------------------------------------------------- */}
        <section className="panel mb-6 px-5 py-4">
          <h2 className="panel-label mb-1">Records</h2>
          <p className="mb-3 font-sans text-[11px] text-faint">
            Facts about what you have done. Not points.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {records
              .filter((row) => shown.has(row.category_id))
              .map((row) => (
                <div key={row.category_id}>
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className="dot"
                      style={{
                        backgroundColor: categoryTheme(colourOf(row.category_id)).bright,
                      }}
                      aria-hidden="true"
                    />
                    <span className="truncate font-sans text-xs text-ink">
                      {row.category_name}
                    </span>
                  </div>
                  <dl className="space-y-0.5 font-mono text-[11px]">
                    <div className="flex justify-between">
                      <dt className="text-faint">Current streak</dt>
                      <dd className="text-ink tnum">{row.current_streak}d</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-faint">Longest</dt>
                      <dd className="text-ink tnum">{row.longest_streak}d</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-faint">Best day</dt>
                      <dd className="text-ink tnum">{row.best_day_minutes}m</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-faint">Best week</dt>
                      <dd className="text-ink tnum">{hours(row.best_week_minutes)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-faint">All time</dt>
                      <dd className="text-ink tnum">{hours(row.total_minutes)}</dd>
                    </div>
                  </dl>
                </div>
              ))}
          </div>
        </section>

        {/* --- Honesty ledger ------------------------------------------- */}
        <section className="panel px-5 py-4">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="panel-label">Retroactive overrides</h2>
            {ledger && ledger.total_retroactive > 0 && (
              <span className="font-mono text-[11px] text-warn tnum">
                {ledger.total_lowered} lowered / {ledger.total_retroactive}
              </span>
            )}
          </div>
          <p className="mb-3 font-sans text-[11px] text-faint">
            Targets changed <em>after</em> the day they applied to. Nothing stops you
            doing this and nothing here undoes it — but it does not happen invisibly.
            Overrides set in advance are not listed.
          </p>

          {!ledger || ledger.entries.length === 0 ? (
            <p className="font-mono text-[11px] text-healthy">
              None. Every override was set before the day it applied to.
            </p>
          ) : (
            <ul className="divide-y divide-divider">
              {ledger.entries.map((entry) => (
                <li
                  key={`${entry.log_date}-${entry.category_id}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <span className="font-mono text-[12px] text-ink tnum">
                      {entry.log_date}
                    </span>
                    <span className="ml-2 font-sans text-[12px] text-muted">
                      {entry.category_name}
                    </span>
                    {entry.override_reason && (
                      <div className="font-sans text-[11px] text-faint">
                        {entry.override_reason}
                      </div>
                    )}
                  </div>
                  <div className="font-mono text-[11px] tnum">
                    <span className="text-faint">{entry.scheduled_target}</span>
                    <span className={entry.lowered ? 'text-warn' : 'text-muted'}>
                      {' → '}
                      {entry.override_target} min
                    </span>
                    <span className="ml-2 text-faint">{entry.days_late}d later</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <SessionChangesLedger onSessionExpired={onSessionExpired} />

        {error && <p className="mt-3 font-mono text-xs text-critical">{error}</p>}
      </div>
    </main>
  )
}
