import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '../api/client'
import CalendarHeatmap from '../components/CalendarHeatmap'
import CheckInPanel from '../components/CheckInPanel'
import GitPanel from '../components/GitPanel'
import { DomainSwitcher } from '../components/DomainSwitcher'
import PageHeader from '../components/PageHeader'
import FocusStatsPanel from '../components/FocusStatsPanel'
import TagRollupPanel from '../components/TagRollupPanel'
import { HourChart, WeekdayChart } from '../components/PatternCharts'
import TrendChart from '../components/TrendChart'
import { colourIndex, useDomains } from '../domains'
import { categoryTheme } from '../theme'
import type {
  CalendarCategory,
  Category,
  CheckInInsights,
  GitCategory,
  Insights as InsightsData,
} from '../types'

/**
 * Batch 4: horizons longer than a week. Heatmap, trend with moving average,
 * weekday and hour patterns, consistency, and a comparison against the
 * preceding period of equal length.
 */

interface Props {
  onSessionExpired: () => void
}

const RANGES = [30, 90, 365] as const
const AVERAGE_WINDOW = 7

function shiftDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d + delta)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export default function Insights({ onSessionExpired }: Props) {
  const [days, setDays] = useState<number>(30)
  const [data, setData] = useState<InsightsData | null>(null)
  const [calendar, setCalendar] = useState<CalendarCategory[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [checkins, setCheckins] = useState<CheckInInsights | null>(null)
  const [git, setGit] = useState<GitCategory[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [insights, cats, checkinData] = await Promise.all([
        api.insights(days, AVERAGE_WINDOW),
        api.categories(),
        api.checkInInsights(days),
      ])
      setCategories(cats)
      setCheckins(checkinData)
      // Git is optional and local-only; a failure here must not hide insights.
      api
        .corroboration(Math.min(days, 90))
        .then(setGit)
        .catch(() => setGit([]))
      // The heatmap starts on a Monday so its grid rows line up with weekdays.
      const [y, m, d] = insights.start.split('-').map(Number)
      const offset = (new Date(y, m - 1, d).getDay() + 6) % 7
      const grid = await api.calendar(shiftDays(insights.start, -offset), insights.end)
      setData(insights)
      setCalendar(grid)
      setError(null)
    } catch (err: unknown) {
      const e = err as { status?: number }
      if (e?.status === 401) onSessionExpired()
      else setError('Could not load insights.')
    } finally {
      setLoading(false)
    }
  }, [days, onSessionExpired])

  useEffect(() => {
    void load()
  }, [load])

  // Same domain pager as the dashboard: six heatmaps and six trend panels on
  // one page is exactly the wall of charts the domains exist to avoid.
  const domain = useDomains(categories)
  const activeIds = domain.active.categoryIds
  const shown = useMemo(() => new Set(activeIds), [activeIds])
  const colourOf = colourIndex

  return (
    <main className="min-h-screen px-5 pb-10 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-[1180px]">
        <PageHeader page="insights">
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => setDays(range)}
              className={`rounded-sm px-2.5 py-1 font-mono text-xs transition-all ${
                days === range
                  ? 'bg-steel/15 text-steel shadow-[0_0_0_1px_rgba(96,165,250,0.35)]'
                  : 'text-muted hover:text-steel'
              }`}
              aria-pressed={days === range}
            >
              {range}d
            </button>
          ))}
        </PageHeader>

        {error && <p className="font-mono text-sm text-critical">{error}</p>}

        {loading && !data && (
          <p className="font-mono text-sm text-faint">
            Loading<span className="animate-caret">…</span>
          </p>
        )}

        {data && (
          <>
            <p className="mb-4 font-mono text-[11px] text-faint">
              {data.start} → {data.end}
            </p>

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

            {/* Heatmap */}
            <section className="panel mb-6 px-5 py-4">
              <h2 className="panel-label mb-3">Daily heatmap</h2>
              <div className="space-y-4 overflow-x-auto">
                {calendar
                  .filter((series) => shown.has(series.category_id))
                  .map((series) => (
                    <CalendarHeatmap
                      key={series.category_id}
                      series={series}
                      index={colourOf(series.category_id)}
                    />
                  ))}
              </div>
            </section>

            {/* Per-category trend + consistency */}
            <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
              {data.categories
                .filter((category) => shown.has(category.category_id))
                .map((category) => {
                  const index = colourOf(category.category_id)
                  return (
                    <section
                      key={category.category_id}
                      className={`panel ${categoryTheme(index).accentClass} px-5 py-4`}
                    >
                      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                        <h2 className="flex items-center gap-2 font-sans text-sm text-ink">
                          <span
                            className="dot"
                            style={{ backgroundColor: categoryTheme(index).bright }}
                            aria-hidden="true"
                          />
                          {category.category_name}
                        </h2>
                        <span className="font-mono text-[11px] text-muted">
                          {category.par_percent !== null
                            ? `${category.par_percent.toFixed(1)}% over ${category.days_counted}d`
                            : 'No tracked days'}
                        </span>
                      </div>

                      <TrendChart
                        points={category.points}
                        averageWindow={AVERAGE_WINDOW}
                        index={index}
                        categoryId={category.category_id}
                      />

                      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-divider pt-3 sm:grid-cols-4">
                        <Stat
                          label="Consistency"
                          value={`${category.consistency.consistency_score.toFixed(0)}`}
                          hint="100 = identical every day"
                        />
                        <Stat
                          label="Best streak"
                          value={`${category.consistency.longest_streak}d`}
                          hint="At or above target"
                        />
                        <Stat
                          label="Best day"
                          value={`${category.consistency.best_day_minutes}m`}
                          hint={category.consistency.best_day ?? '—'}
                        />
                        <Stat
                          label="Spread"
                          value={`±${category.consistency.stdev_percent.toFixed(0)}%`}
                          hint="Lower is steadier"
                        />
                      </div>

                      <div className="mt-3 border-t border-divider pt-3">
                        <span className="panel-label">By weekday</span>
                        <WeekdayChart stats={category.weekday_breakdown} index={index} />
                      </div>
                    </section>
                  )
                })}
            </div>

            {/* Sleep and energy — across all domains, like time of day */}
            {checkins && <CheckInPanel data={checkins} />}

            <GitPanel data={git} />

            <TagRollupPanel
              start={data.start}
              end={data.end}
              categories={categories}
              onSessionExpired={onSessionExpired}
            />

            <FocusStatsPanel days={days} onSessionExpired={onSessionExpired} />

            {/* Time of day */}
            <section className="panel mb-6 px-5 py-4">
              <h2 className="panel-label mb-1">Time of day · all domains</h2>
              <p className="mb-2 font-sans text-[11px] text-faint">
                From timed sessions only.
              </p>
              <HourChart hours={data.hours} />
            </section>

            {/* Period comparison */}
            <section className="panel px-5 py-4">
              <h2 className="panel-label mb-1">
                This period vs the {data.days} days before it
              </h2>
              <div className="mt-2">
                {data.comparison
                  .filter((row) => shown.has(row.category_id))
                  .map((row) => (
                    <div
                      key={row.category_id}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-b border-divider py-2.5 last:border-b-0"
                    >
                      <div>
                        <div className="font-sans text-sm text-ink">
                          {row.category_name}
                        </div>
                        <div className="font-mono text-[11px] text-faint">
                          {row.current.minutes_total} min now ·{' '}
                          {row.previous.minutes_total} min before
                        </div>
                      </div>
                      <div className="flex items-baseline gap-3">
                        <span className="font-mono text-[18px] text-ink tnum">
                          {row.current.par_percent !== null
                            ? `${row.current.par_percent.toFixed(1)}%`
                            : '—'}
                        </span>
                        {row.delta_percent !== null && (
                          <span
                            className={`font-mono text-[11px] ${
                              row.delta_percent > 0
                                ? 'text-healthy'
                                : row.delta_percent < 0
                                  ? 'text-critical'
                                  : 'text-muted'
                            }`}
                          >
                            {row.delta_percent > 0
                              ? '▲'
                              : row.delta_percent < 0
                                ? '▼'
                                : '–'}
                            {Math.abs(row.delta_percent).toFixed(1)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-faint">
        {label}
      </div>
      <div className="font-mono text-[17px] text-ink">{value}</div>
      <div className="font-sans text-[10px] text-faint">{hint}</div>
    </div>
  )
}
