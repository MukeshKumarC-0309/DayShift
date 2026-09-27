import { useMemo } from 'react'
import { Link } from 'react-router'

import Brand from '../components/Brand'
import DashboardBlocks from '../components/dashboard/DashboardBlocks'
import DomainWindow from '../components/dashboard/DomainWindow'
import MoreMenu from '../components/dashboard/MoreMenu'
import TodayLine from '../components/TodayLine'
import { colourIndex, useDomains } from '../domains'
import { useDashboardData } from '../hooks/useDashboardData'
import { useHotkey } from '../hotkeys'
import { useRunningTitle } from '../runningTitle'

/**
 * The dashboard, one domain at a time.
 *
 * Six categories on one screen is too much to take in, so the page shows a
 * single domain (Projects, or Daily) and a `‹ ›` switcher slides between them.
 * Below the slider, two tabbed blocks hold everything else — scores in one,
 * entry in the other — so at first glance there are only four things on the
 * page: what to do this week, today's dials, and two blocks.
 *
 * This file is layout only: data lives in `useDashboardData`, and the pieces
 * in `components/dashboard/`.
 */

interface Props {
  onSessionExpired: () => void
  onLogout: () => void
  rain: boolean
  onToggleRain: () => void
}

export default function Dashboard({
  onSessionExpired,
  onLogout,
  rain,
  onToggleRain,
}: Props) {
  const { data, pace, today, error, version, load, quickAdd, quickNote, quickBusy } =
    useDashboardData(onSessionExpired)

  const categories = useMemo(() => data?.categories ?? [], [data])
  const domain = useDomains(categories)
  useHotkey('[', domain.prev, domain.domains.length > 1)
  useHotkey(']', domain.next, domain.domains.length > 1)

  const runningName = data?.running
    ? categories.find((c) => c.id === data.running!.category_id)?.name
    : undefined
  useRunningTitle(data?.running ?? null, runningName)

  // Today, per domain: how many scheduled categories are already done. Lets
  // the switcher say whether the domain you are NOT looking at needs you.
  const domainStatus = useMemo(
    () =>
      domain.domains.map((d) => {
        const rows = (data?.progress ?? []).filter(
          (p) => d.categoryIds.includes(p.category_id) && p.is_active_today,
        )
        return {
          done: rows.filter((p) => p.target_minutes === 0 || p.percent >= 100).length,
          total: rows.length,
        }
      }),
    [domain.domains, data],
  )

  // Colour follows the category's id, never its position in a list.
  const colourOf = colourIndex

  // Memoised so the log form's loader does not refire on every render.
  // Depends on the stable id list, not the whole `domain` object (which is a
  // fresh object each render and would retrigger this every time).
  const activeIds = domain.active.categoryIds
  const domainCategories = useMemo(
    () => categories.filter((c) => activeIds.includes(c.id)),
    [categories, activeIds],
  )

  // Today's timed minutes per category, so the log form can show what the
  // timer already captured and the two are never added twice by mistake.
  const timedByCategory = useMemo(() => {
    const map: Record<number, number> = {}
    for (const row of data?.progress ?? []) map[row.category_id] = row.timed_minutes
    return map
  }, [data])

  if (error && !data) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <p className="font-mono text-sm text-critical">{error}</p>
      </main>
    )
  }

  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="font-mono text-sm text-faint">
          Loading<span className="animate-caret">…</span>
        </span>
      </main>
    )
  }

  const beforeTracking = data.today < data.tracking_start_date

  return (
    <main className="min-h-screen px-5 pb-10 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-[1180px]">
        <header className="app-header">
          <Brand subtitle={data.today} />
          <nav className="flex flex-wrap items-center gap-1" aria-label="Pages">
            <Link to="/review" className="btn-quiet whitespace-nowrap font-mono">
              Review
            </Link>
            <Link to="/insights" className="btn-quiet whitespace-nowrap font-mono">
              Insights
            </Link>
            <Link to="/practice" className="btn-quiet whitespace-nowrap font-mono">
              Practice
            </Link>
            <Link to="/agenda" className="btn-quiet whitespace-nowrap font-mono">
              Agenda
            </Link>
            <Link to="/goals" className="btn-quiet whitespace-nowrap font-mono">
              Goals
            </Link>
            <MoreMenu
              today={data.today}
              rain={rain}
              onToggleRain={onToggleRain}
              onLogout={onLogout}
            />
          </nav>
        </header>

        {error && (
          <p
            role="alert"
            className="mb-6 flex items-center justify-between gap-3 rounded border border-critical/40 bg-critical/5 px-3 py-2 font-mono text-xs text-critical"
          >
            <span>Backend unreachable — showing what was last loaded.</span>
            <button type="button" onClick={() => void load()} className="btn-quiet">
              Retry
            </button>
          </p>
        )}

        <TodayLine
          summary={today}
          onChanged={() => void load()}
          onSessionExpired={onSessionExpired}
        />

        {beforeTracking && (
          <p className="mb-6 rounded border border-steel/30 bg-steel/5 px-3 py-2 font-mono text-xs text-steel">
            Tracking begins {data.tracking_start_date} — par scores stay empty until then
          </p>
        )}

        {/* ---- The domain window: this week + today, one domain at a time ---- */}
        <DomainWindow
          data={data}
          pace={pace}
          domains={domain.domains}
          index={domain.index}
          onPrev={domain.prev}
          onNext={domain.next}
          onGoTo={domain.goTo}
          status={domainStatus}
          domainCategories={domainCategories}
          colourOf={colourOf}
          beforeTracking={beforeTracking}
          quickAdd={quickAdd}
          quickBusy={quickBusy}
          quickNote={quickNote}
        />

        {/* ---- Two blocks, several windows each ---- */}
        <DashboardBlocks
          data={data}
          categories={categories}
          domainCategories={domainCategories}
          activeIds={activeIds}
          colourOf={colourOf}
          timedByCategory={timedByCategory}
          version={version}
          load={load}
          onSessionExpired={onSessionExpired}
        />
      </div>
    </main>
  )
}
