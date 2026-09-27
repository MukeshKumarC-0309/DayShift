import LogEntryForm from '../LogEntryForm'
import OverridePanel from '../OverridePanel'
import ParScoreRow from '../ParScore'
import SessionTimer from '../SessionTimer'
import TabBlock from '../TabBlock'
import WeeklyChart from '../WeeklyChart'
import type { Category, Dashboard } from '../../types'

/**
 * The bottom half of the dashboard: two tabbed blocks. Scores (Par score,
 * Weekly) in one; entry (Timer, Log, Override) in the other. Both follow the
 * domain being shown.
 */

interface Props {
  data: Dashboard
  categories: Category[]
  domainCategories: Category[]
  activeIds: number[]
  colourOf: (categoryId: number) => number
  timedByCategory: Record<number, number>
  version: number
  load: () => Promise<void> | void
  onSessionExpired: () => void
}

export default function DashboardBlocks({
  data,
  categories,
  domainCategories,
  activeIds,
  colourOf,
  timedByCategory,
  version,
  load,
  onSessionExpired,
}: Props) {
  const inDomain = (categoryId: number) => activeIds.includes(categoryId)
  const parRows = data.par.filter((p) => inDomain(p.category_id))
  const windowLabel = parRows[0]?.window_start
    ? `${parRows[0].window_start} → ${parRows[0].window_end}`
    : 'Rolling 7d'

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <TabBlock
        storageKey="dayshift.tab.scores"
        aside={<span className="font-mono text-[10px] text-faint">{windowLabel}</span>}
        tabs={[
          {
            id: 'par',
            label: 'Par score',
            hotkey: 'p',
            content: (
              <div>
                <p className="mb-1 font-sans text-[11px] text-faint">
                  Trailing 7 days, excluding today
                </p>
                {parRows.map((par) => (
                  <ParScoreRow
                    key={par.category_id}
                    par={par}
                    index={colourOf(par.category_id)}
                  />
                ))}
              </div>
            ),
          },
          {
            id: 'weekly',
            label: 'Weekly',
            hotkey: 'w',
            content: (
              <div>
                <div className="space-y-3">
                  {data.weekly
                    .filter((w) => inDomain(w.category_id))
                    .map((week) => (
                      <WeeklyChart
                        key={week.category_id}
                        week={week}
                        index={colourOf(week.category_id)}
                        onSaved={load}
                        onSessionExpired={onSessionExpired}
                        questionTarget={
                          categories.find((c) => c.id === week.category_id)
                            ?.question_target
                        }
                      />
                    ))}
                </div>
                <p className="mt-2 border-t border-divider pt-2 font-mono text-[10px] text-faint">
                  <span className="text-steel">*</span> Target overridden that day · click
                  a day to correct it
                </p>
              </div>
            ),
          },
        ]}
      />

      <TabBlock
        storageKey="dayshift.tab.entry"
        tabs={[
          {
            id: 'timer',
            label: 'Timer',
            hotkey: 't',
            // A running timer stays visible from any tab.
            badge: data.running ? (
              <span
                className="dot animate-pulse-edge bg-healthy"
                aria-label="recording"
              />
            ) : undefined,
            content: (
              <SessionTimer
                embedded
                categories={categories}
                startable={activeIds}
                running={data.running}
                onChanged={load}
                onSessionExpired={onSessionExpired}
              />
            ),
          },
          {
            id: 'log',
            label: 'Log',
            hotkey: 'l',
            content: (
              <LogEntryForm
                embedded
                categories={domainCategories}
                today={data.today}
                timedByCategory={timedByCategory}
                version={version}
                onSaved={load}
                onSessionExpired={onSessionExpired}
              />
            ),
          },
          {
            id: 'override',
            label: 'Override',
            hotkey: 'o',
            content: (
              <OverridePanel
                embedded
                categories={categories}
                today={data.today}
                onSaved={load}
                onSessionExpired={onSessionExpired}
              />
            ),
          },
        ]}
      />
    </div>
  )
}
