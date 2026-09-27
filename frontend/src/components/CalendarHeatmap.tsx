import { categoryTheme } from '../theme'
import type { CalendarCategory } from '../types'

/**
 * Contribution-grid heatmap: one column per week, one cell per day.
 *
 * Hand-built SVG, coloured by the same status thresholds as the gauges so a
 * red cell here means exactly what a red border means there. Days the
 * category is not scheduled on are drawn as empty outlines rather than zeros,
 * because a rest day is not a failure.
 */

interface Props {
  series: CalendarCategory
  /** Position in dashboard order — decides which categorical hue is used. */
  index: number
}

const CELL = 13
const GAP = 3
const PITCH = CELL + GAP
const LABEL_WIDTH = 26
const HEADER = 14
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/**
 * Magnitude is a SEQUENTIAL encoding: one hue, dark (near zero) to bright
 * (target met or beyond), drawn from the category's own ramp. That keeps the
 * heatmap answering "where are the gaps" while carrying category identity —
 * and avoids a rainbow, which would imply categories that are not there.
 */
function rampStep(percent: number | null, ramp: readonly string[]): string | null {
  if (percent === null) return null
  if (percent >= 100) return ramp[4]
  if (percent >= 80) return ramp[3]
  if (percent >= 50) return ramp[2]
  if (percent > 0) return ramp[1]
  return ramp[0]
}

/** Monday-indexed weekday for an ISO date, parsed as local time. */
function weekdayIndex(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return (new Date(y, m - 1, d).getDay() + 6) % 7
}

function monthLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleString(undefined, { month: 'short' })
}

export default function CalendarHeatmap({ series, index }: Props) {
  const days = series.days
  const theme = categoryTheme(index)
  if (days.length === 0) return null

  // Pad the first week so the grid starts on the correct weekday row.
  const leading = weekdayIndex(days[0].log_date)
  const columns = Math.ceil((leading + days.length) / 7)
  const width = LABEL_WIDTH + columns * PITCH
  const height = HEADER + 7 * PITCH

  // One label per month change, but only when there is room — otherwise a
  // short range renders "AugSep" as overlapping text.
  const MIN_LABEL_GAP = 3
  const monthMarks: { column: number; label: string }[] = []
  let lastMonth = ''
  let lastLabelColumn = -MIN_LABEL_GAP
  days.forEach((day, index) => {
    const column = Math.floor((leading + index) / 7)
    const label = monthLabel(day.log_date)
    if (label !== lastMonth) {
      if (column - lastLabelColumn >= MIN_LABEL_GAP) {
        monthMarks.push({ column, label })
        lastLabelColumn = column
      }
      lastMonth = label
    }
  })

  return (
    <div className="py-1">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="flex items-center gap-2 font-sans text-xs text-ink">
          <span
            className="dot"
            style={{ backgroundColor: theme.bright }}
            aria-hidden="true"
          />
          {series.category_name}
        </span>
        <span className="font-mono text-[10px] text-faint">
          {days.filter((d) => d.minutes > 0).length} active days
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ maxWidth: width }}
        role="img"
        aria-label={`${series.category_name} daily heatmap`}
      >
        {monthMarks.map((mark) => (
          <text
            key={`${mark.label}-${mark.column}`}
            x={LABEL_WIDTH + mark.column * PITCH}
            y={9}
            className="fill-current font-mono text-[9px] text-faint"
          >
            {mark.label}
          </text>
        ))}

        {DAY_LABELS.map((label, row) =>
          row % 2 === 0 ? (
            <text
              key={row}
              x={0}
              y={HEADER + row * PITCH + CELL - 3}
              className="fill-current font-mono text-[9px] text-faint"
            >
              {label}
            </text>
          ) : null,
        )}

        {days.map((day, cellIndex) => {
          const position = leading + cellIndex
          const column = Math.floor(position / 7)
          const row = position % 7
          const fill =
            day.is_tracked && day.is_active ? rampStep(day.percent, theme.ramp) : null
          return (
            <rect
              key={day.log_date}
              x={LABEL_WIDTH + column * PITCH}
              y={HEADER + row * PITCH}
              width={CELL}
              height={CELL}
              rx={3}
              strokeWidth={1}
              fill={fill ?? 'transparent'}
              stroke={fill ?? undefined}
              strokeOpacity={fill ? 0.9 : 0}
              className={fill ? '' : 'stroke-edge'}
            >
              <title>
                {day.log_date} —{' '}
                {day.is_tracked
                  ? day.is_active
                    ? `${day.minutes}/${day.target_minutes} min${day.has_override ? ' (override)' : ''}`
                    : 'rest day'
                  : 'before tracking started'}
              </title>
            </rect>
          )
        })}
      </svg>
    </div>
  )
}
