import { categoryTheme } from '../theme'
import type { Pace } from '../types'

/**
 * What is still required to finish this week at 100%, per category.
 *
 * This is the only thing on the dashboard that answers "what should I do
 * today" rather than "how have I been doing". Everything else is a score;
 * this is an instruction.
 *
 * Deliberately plain: a number of minutes and a number of days. No
 * encouragement, no streak-saving language, nothing that would feel good to
 * game.
 */

interface Props {
  pace: Pace[]
  /** Global colour slot for a category — colour follows the category, not
      its position in a filtered list. Defaults to list position. */
  colourOf?: (categoryId: number) => number
}

function weekdayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
}

export default function PaceStrip({ pace, colourOf }: Props) {
  if (pace.length === 0) return null
  const week = pace[0]

  return (
    <section className="panel px-5 py-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="panel-label">This week</h2>
        <span className="font-mono text-[10px] text-faint">
          {weekdayLabel(week.week_start)} – {weekdayLabel(week.week_end)}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pace.map((row, index) => {
          const theme = categoryTheme(colourOf ? colourOf(row.category_id) : index)
          const filled = Math.min(100, row.percent)

          return (
            <div key={row.category_id} className="min-w-0">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="dot"
                    style={{ backgroundColor: theme.bright }}
                    aria-hidden="true"
                  />
                  <span className="truncate font-sans text-xs text-ink">
                    {row.category_name}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-muted tnum">
                  {row.minutes_logged}
                  <span className="text-faint">/{row.target_total}</span>
                </span>
              </div>

              {/* Progress through the week's requirement. */}
              <div className="h-[3px] w-full overflow-hidden rounded-full bg-raised">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${filled}%`,
                    background: `linear-gradient(90deg, ${theme.base}, ${theme.bright})`,
                  }}
                />
              </div>

              <div className="mt-1.5 font-mono text-[11px]">
                {row.target_total === 0 ? (
                  <span className="text-faint">Nothing scheduled</span>
                ) : row.on_track ? (
                  <span className="text-healthy">
                    Done for the week ·{' '}
                    {row.minutes_logged - row.target_total >= 0
                      ? `+${row.minutes_logged - row.target_total}`
                      : ''}{' '}
                    min
                  </span>
                ) : row.days_remaining === 0 ? (
                  // The week is out of scheduled days; the shortfall is final.
                  <span className="text-critical">
                    {row.minutes_remaining} min short, no days left
                  </span>
                ) : (
                  <span className="text-ink">
                    <span className="text-cat1-bright">
                      {row.minutes_per_remaining_day} min/day
                    </span>
                    <span className="text-faint">
                      {' '}
                      for {row.days_remaining} day{row.days_remaining === 1 ? '' : 's'}
                    </span>
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
