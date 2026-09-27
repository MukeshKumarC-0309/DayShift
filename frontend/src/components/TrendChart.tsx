import { categoryTheme } from '../theme'
import type { RangePoint } from '../types'

/**
 * Daily percentage against target, with a trailing moving average drawn over
 * it. Hand-built SVG line chart — no charting library.
 *
 * Days the category is not scheduled on break the line rather than being
 * drawn as zero, so a rest day never looks like a collapse.
 */

interface Props {
  points: RangePoint[]
  averageWindow: number
  /** Position in dashboard order — decides which categorical hue is used. */
  index: number
  categoryId: number
}

const HEIGHT = 120
const PAD_TOP = 8
const PAD_BOTTOM = 16
const PLOT = HEIGHT - PAD_TOP - PAD_BOTTOM

export default function TrendChart({ points, averageWindow, index, categoryId }: Props) {
  const theme = categoryTheme(index)
  const gid = `trend-${categoryId}`
  if (points.length === 0) return null

  const width = Math.max(points.length * 6, 120)
  // Cap the scale at 200% so one enormous day does not flatten everything else.
  const ceiling = Math.min(
    200,
    Math.max(
      120,
      ...points.map((p) => p.percent ?? 0),
      ...points.map((p) => p.moving_average ?? 0),
    ),
  )

  const x = (index: number) => (index / Math.max(1, points.length - 1)) * width
  const y = (value: number) =>
    PAD_TOP + PLOT - (Math.min(value, ceiling) / ceiling) * PLOT

  // Break the path wherever a day does not count.
  const segments: string[] = []
  let current: string[] = []
  points.forEach((point, index) => {
    if (point.percent === null) {
      if (current.length > 1) segments.push(current.join(' '))
      current = []
      return
    }
    current.push(`${current.length === 0 ? 'M' : 'L'} ${x(index)} ${y(point.percent)}`)
  })
  if (current.length > 1) segments.push(current.join(' '))

  const averagePath = points
    .map((point, index) =>
      point.moving_average === null ? null : `${x(index)} ${y(point.moving_average)}`,
    )
    .filter((v): v is string => v !== null)

  const targetY = y(100)

  return (
    <div>
      {/* Legend lives in HTML, not in the SVG: the chart stretches to fill its
          column with preserveAspectRatio="none", which would distort glyphs. */}
      <div className="mb-1 flex items-center gap-3 font-mono text-[10px] text-faint">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-[2px] w-4 rounded-full"
            style={{ backgroundColor: theme.bright }}
            aria-hidden="true"
          />
          {averageWindow}-day average
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-px w-4"
            style={{ backgroundColor: theme.base, opacity: 0.55 }}
            aria-hidden="true"
          />
          daily
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className="h-[120px] w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Daily percentage of target over time"
      >
        <defs>
          <linearGradient id={`${gid}-area`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={theme.bright} stopOpacity="0.28" />
            <stop offset="100%" stopColor={theme.bright} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 100% reference */}
        <line
          x1={0}
          y1={targetY}
          x2={width}
          y2={targetY}
          className="stroke-edge"
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
        {/* 80% warning threshold */}
        <line
          x1={0}
          y1={y(80)}
          x2={width}
          y2={y(80)}
          className="stroke-warn/30"
          strokeWidth={1}
          strokeDasharray="2 4"
          vectorEffect="non-scaling-stroke"
        />

        {/* Raw daily line: the category's own hue, kept recessive. */}
        {segments.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={theme.base}
            strokeOpacity={0.55}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Moving average: the emphasised mark, brighter step of the same hue. */}
        {averagePath.length > 1 && (
          <>
            <path
              d={`M ${averagePath.join(' L ')} L ${width} ${HEIGHT - PAD_BOTTOM} L 0 ${HEIGHT - PAD_BOTTOM} Z`}
              fill={`url(#${gid}-area)`}
              stroke="none"
            />
            <path
              d={`M ${averagePath.join(' L ')}`}
              fill="none"
              stroke={theme.bright}
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>
    </div>
  )
}
