import { categoryTheme, STATUS_TEXT } from '../theme'
import type { ParScore as ParScoreData } from '../types'

/**
 * The rolling par readout: a number, a trend arrow versus the previous window,
 * and what it is made of. Distinct from the gauge — the gauge is today, this
 * is the trailing picture.
 *
 * The number wears the STATUS colour (what it means); the dot beside the name
 * wears the CATEGORY colour (which series it is). Two channels, two jobs.
 */

interface Props {
  par: ParScoreData
  index: number
}

const TREND_GLYPH: Record<string, string> = {
  up: '▲',
  down: '▼',
  flat: '–',
  none: '',
}

export default function ParScore({ par, index }: Props) {
  const theme = categoryTheme(index)
  const hasScore = par.par_percent !== null
  const delta =
    par.par_percent !== null && par.previous_par_percent !== null
      ? par.par_percent - par.previous_par_percent
      : null

  // The arrow is coloured by DIRECTION, not by status — an improving but still
  // failing category should read as improving.
  const trendColor =
    par.trend === 'up'
      ? 'text-healthy'
      : par.trend === 'down'
        ? 'text-critical'
        : 'text-muted'

  // A thin fill behind the row showing how far toward 100% this score sits.
  const fillWidth = hasScore ? Math.min(100, Math.max(0, par.par_percent!)) : 0

  return (
    <div className="relative border-b border-divider py-2.5 last:border-b-0">
      <div
        className="absolute inset-y-0 left-0 -z-10 rounded-sm transition-all duration-500"
        style={{
          width: `${fillWidth}%`,
          background: `linear-gradient(90deg, ${theme.base}14, ${theme.base}03)`,
        }}
        aria-hidden="true"
      />
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="dot"
              style={{ backgroundColor: theme.bright }}
              aria-hidden="true"
            />
            <span className="truncate font-sans text-sm text-ink">
              {par.category_name}
            </span>
          </div>
          <div className="pl-4 font-mono text-[11px] text-faint tnum">
            {hasScore
              ? `${par.minutes_total} / ${par.target_total} min · ${par.days_counted}d`
              : 'No tracked days yet'}
          </div>
        </div>

        <div className="flex shrink-0 items-baseline gap-2">
          <span className={`font-mono text-[22px] tnum ${STATUS_TEXT[par.status]}`}>
            {hasScore ? par.par_percent!.toFixed(1) : '—'}
            {hasScore && <span className="text-[13px] text-muted">%</span>}
          </span>
          {par.trend !== 'none' && (
            <span
              className={`font-mono text-[11px] tnum ${trendColor}`}
              title="vs. previous window"
            >
              {TREND_GLYPH[par.trend]}
              {delta !== null && Math.abs(delta) >= 0.05 && (
                <span className="ml-0.5">{Math.abs(delta).toFixed(1)}</span>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
