import { categoryTheme, STATUS_HEX } from '../theme'
import type { HourStat, WeekdayStat } from '../types'

/**
 * Two small hand-built charts: which weekdays you actually deliver on, and
 * which hours the timed work lands in.
 */

const BAR_HEIGHT = 74
const BASELINE = BAR_HEIGHT - 14

function toneFor(percent: number | null): string {
  if (percent === null) return STATUS_HEX.none
  if (percent >= 80) return STATUS_HEX.healthy
  if (percent >= 50) return STATUS_HEX.warning
  return STATUS_HEX.critical
}

export function WeekdayChart({ stats, index }: { stats: WeekdayStat[]; index: number }) {
  const theme = categoryTheme(index)
  const slot = 40
  const width = stats.length * slot
  const ceiling = Math.max(100, ...stats.map((s) => s.percent ?? 0))

  return (
    <svg
      viewBox={`0 0 ${width} ${BAR_HEIGHT}`}
      className="h-[74px] w-full"
      preserveAspectRatio="xMinYMid meet"
      role="img"
      aria-label="Performance by weekday"
    >
      <line
        x1={0}
        y1={BASELINE}
        x2={width}
        y2={BASELINE}
        stroke={theme.base}
        strokeOpacity={0.5}
        strokeWidth={1}
      />
      {stats.map((stat, i) => {
        const x = i * slot + 10
        const height =
          stat.percent === null
            ? 0
            : Math.max(1, (Math.min(stat.percent, ceiling) / ceiling) * (BASELINE - 6))
        return (
          <g key={stat.weekday}>
            {stat.days_counted === 0 ? (
              <rect
                x={x}
                y={BASELINE - 3}
                width={20}
                height={2}
                className="fill-divider"
              />
            ) : (
              <rect
                x={x}
                y={BASELINE - height}
                width={20}
                height={height}
                rx={3}
                fill={toneFor(stat.percent)}
                fillOpacity={0.9}
              >
                <title>
                  {stat.weekday}: {stat.minutes_total}/{stat.target_total} min over{' '}
                  {stat.days_counted} days
                </title>
              </rect>
            )}
            <text
              x={x + 10}
              y={BAR_HEIGHT - 3}
              textAnchor="middle"
              className={`fill-current font-mono text-[9px] ${
                stat.days_counted === 0 ? 'text-faint' : 'text-muted'
              }`}
            >
              {stat.weekday.slice(0, 2)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export function HourChart({ hours }: { hours: HourStat[] }) {
  const slot = 14
  const width = hours.length * slot
  const peak = Math.max(1, ...hours.map((h) => h.minutes))
  const anyData = hours.some((h) => h.minutes > 0)

  if (!anyData) {
    return (
      <p className="py-3 font-sans text-[11px] text-faint">
        No timed sessions yet — this fills in once you use the timer. Minutes typed in by
        hand have no time of day attached.
      </p>
    )
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${BAR_HEIGHT}`}
      className="h-[74px] w-full"
      preserveAspectRatio="xMinYMid meet"
      role="img"
      aria-label="Timed minutes by hour of day"
    >
      <defs>
        <linearGradient id="hour-grad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#1295ab" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="1" />
        </linearGradient>
      </defs>
      <line
        x1={0}
        y1={BASELINE}
        x2={width}
        y2={BASELINE}
        className="stroke-edge"
        strokeWidth={1}
      />
      {hours.map((hour) => {
        const x = hour.hour * slot + 3
        const height =
          hour.minutes === 0 ? 0 : Math.max(1, (hour.minutes / peak) * (BASELINE - 6))
        return (
          <g key={hour.hour}>
            <rect
              x={x}
              y={BASELINE - height}
              width={8}
              height={height}
              rx={2}
              fill="url(#hour-grad)"
            >
              <title>
                {String(hour.hour).padStart(2, '0')}:00 — {hour.minutes} min
              </title>
            </rect>
            {hour.hour % 6 === 0 && (
              <text
                x={x + 4}
                y={BAR_HEIGHT - 3}
                textAnchor="middle"
                className="fill-current font-mono text-[9px] text-faint"
              >
                {String(hour.hour).padStart(2, '0')}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
