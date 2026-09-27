import { categoryTheme, STATUS_HEX, STATUS_PANEL, STATUS_TEXT } from '../theme'
import type { ParScore, Status, TodayProgress } from '../types'

/**
 * Radial gauge for one category.
 *
 * Two colour channels, doing two different jobs:
 *   - the ARC and the readout are coloured by TODAY's achievement, so a day at
 *     134% reads as good even during a rough week;
 *   - the PANEL BORDER carries the rolling warning state (DESIGN.md ties the
 *     warning specifically to the border), plus a soft glow at critical.
 * The category's own hue appears on the dial's track and title dot, so the
 * three gauges are distinguishable at a glance without colour carrying the
 * performance meaning.
 */

interface Props {
  progress: TodayProgress
  par: ParScore
  /** Position in dashboard order — decides which categorical hue is used. */
  index: number
  untracked?: boolean
  /** Quick add to today's typed numbers: `+15`, `+30`, and `+1 Q` for DSA. */
  onQuickAdd?: (minutes: number, questions: number) => void
  /** A quick add for this dial is in flight — buttons wait for it. */
  busy?: boolean
  /** Result of the last quick add on this dial, with its undo. */
  note?: GaugeNote
}

export interface GaugeNote {
  text: string
  tone: 'ok' | 'error'
  onUndo?: () => void
}

const QUICK_MINUTES = [15, 30] as const

const QUICK_BUTTON =
  'rounded-sm border border-edge bg-raised px-1.5 py-0.5 font-mono text-[10px] text-muted transition-colors hover:border-steel hover:text-steel disabled:cursor-wait disabled:opacity-50'

const START_ANGLE = 135
const SWEEP = 270
const SIZE = 180
const CENTER = SIZE / 2
const RADIUS = 68
const TRACK_WIDTH = 9

function todayTone(percent: number, isActive: boolean): Status {
  if (!isActive) return 'none'
  if (percent < 50) return 'critical'
  if (percent < 80) return 'warning'
  return 'healthy'
}

function polar(angleDeg: number, radius: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180
  return [CENTER + radius * Math.cos(rad), CENTER + radius * Math.sin(rad)]
}

function arcPath(fraction: number, radius: number): string {
  const clamped = Math.max(0, Math.min(1, fraction))
  if (clamped <= 0) return ''
  const end = START_ANGLE + SWEEP * clamped
  const [x0, y0] = polar(START_ANGLE, radius)
  const [x1, y1] = polar(end, radius)
  const largeArc = SWEEP * clamped > 180 ? 1 : 0
  return `M ${x0} ${y0} A ${radius} ${radius} 0 ${largeArc} 1 ${x1} ${y1}`
}

export default function GaugeIndicator({
  progress,
  par,
  index,
  untracked = false,
  onQuickAdd,
  busy = false,
  note,
}: Props) {
  const { minutes_logged, target_minutes, is_active_today, has_override } = progress
  const theme = categoryTheme(index)

  // Progress follows CREDITED minutes, so two DSA questions fill the dial even
  // though the minutes worked are fewer. The centre number stays real minutes.
  const credited = progress.credited_minutes ?? minutes_logged
  const questionTarget = progress.question_target
  const fraction =
    target_minutes > 0 ? credited / target_minutes : is_active_today ? 1 : 0
  const percentLabel =
    target_minutes > 0 ? Math.round((credited / target_minutes) * 100) : null
  const tone = todayTone(percentLabel ?? 100, is_active_today)

  // Unique gradient ids — two gauges on one page must not share a <defs> id.
  const gid = `gauge-${progress.category_id}`
  const from = STATUS_HEX[tone]

  return (
    <div
      className={`panel ${theme.accentClass} flex flex-col items-center px-5 py-6 transition-all duration-300 hover:shadow-panel-hover ${STATUS_PANEL[par.status]}`}
    >
      <div className="mb-1 flex items-center gap-2">
        <span
          className="dot"
          style={{ backgroundColor: theme.bright }}
          aria-hidden="true"
        />
        <h2 className="font-sans text-sm font-medium text-ink">
          {progress.category_name}
        </h2>
      </div>

      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-[180px] w-[180px]"
        role="img"
        aria-label={`${progress.category_name}: ${minutes_logged} of ${target_minutes} minutes today`}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor={from} stopOpacity="0.55" />
            <stop offset="100%" stopColor={from} stopOpacity="1" />
          </linearGradient>
          <filter id={`${gid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Track, tinted with the category's own hue so the three dials are
            distinguishable even when all three read the same percentage. */}
        <path
          d={arcPath(1, RADIUS)}
          fill="none"
          stroke={theme.base}
          strokeOpacity={0.18}
          strokeWidth={TRACK_WIDTH}
          strokeLinecap="round"
        />

        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const angle = START_ANGLE + SWEEP * t
          const [ix, iy] = polar(angle, RADIUS - TRACK_WIDTH / 2 - 5)
          const [ox, oy] = polar(angle, RADIUS - TRACK_WIDTH / 2 - 1.5)
          return (
            <line
              key={t}
              x1={ix}
              y1={iy}
              x2={ox}
              y2={oy}
              className="stroke-faint"
              strokeWidth={1}
            />
          )
        })}

        {fraction > 0 && (
          <path
            d={arcPath(fraction, RADIUS)}
            fill="none"
            stroke={`url(#${gid})`}
            strokeWidth={TRACK_WIDTH}
            strokeLinecap="round"
            filter={`url(#${gid}-glow)`}
            className="transition-all duration-500"
          />
        )}

        <text
          x={CENTER}
          y={CENTER - 4}
          textAnchor="middle"
          className={`fill-current font-mono text-[30px] ${is_active_today ? STATUS_TEXT[tone] : 'text-faint'}`}
        >
          {minutes_logged}
        </text>
        <text
          x={CENTER}
          y={CENTER + 18}
          textAnchor="middle"
          className="fill-current font-mono text-[12px] text-muted"
        >
          {is_active_today
            ? `/ ${target_minutes} min`
            : untracked
              ? 'Not tracked yet'
              : 'Rest day'}
        </text>
      </svg>

      <div className="mt-1 flex min-h-[20px] flex-col items-center gap-1">
        {percentLabel !== null && (
          <span className={`font-mono text-xs ${STATUS_TEXT[tone]}`}>
            {percentLabel}% of today
            {has_override && (
              <span className="ml-1 text-steel" title="Target overridden today">
                *
              </span>
            )}
          </span>
        )}
        {progress.timed_minutes > 0 && progress.manual_minutes > 0 && (
          <span className="font-mono text-[10px] text-faint">
            {progress.manual_minutes} entered + {progress.timed_minutes} timed
          </span>
        )}
        {progress.timed_minutes > 0 && progress.manual_minutes === 0 && (
          <span className="font-mono text-[10px] text-faint">all timed</span>
        )}
        {questionTarget !== null && questionTarget > 0 && is_active_today && (
          <div className="mt-1 flex items-center gap-2">
            {/* One pip per question: a count you can read without numbers. */}
            <span
              className="flex items-center gap-1"
              aria-label={`${progress.questions_solved} of ${questionTarget} questions`}
            >
              {Array.from(
                { length: Math.max(questionTarget, progress.questions_solved) },
                (_, i) => (
                  <span
                    key={i}
                    className="h-1.5 w-3 rounded-full"
                    style={{
                      backgroundColor:
                        i < progress.questions_solved
                          ? theme.bright
                          : 'rgba(255,255,255,0.1)',
                    }}
                  />
                ),
              )}
            </span>
            <span className="font-mono text-[10px] text-muted tnum">
              {progress.questions_solved}/{questionTarget} Q
            </span>
          </div>
        )}
        {onQuickAdd && (
          <div
            className="mt-1 flex items-center gap-1.5"
            role="group"
            aria-label={`Quick add to ${progress.category_name}`}
          >
            {QUICK_MINUTES.map((minutes) => (
              <button
                key={minutes}
                type="button"
                disabled={busy}
                onClick={() => onQuickAdd(minutes, 0)}
                className={QUICK_BUTTON}
                aria-label={`Add ${minutes} minutes to ${progress.category_name} today`}
              >
                +{minutes}
              </button>
            ))}
            {questionTarget !== null && questionTarget > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onQuickAdd(0, 1)}
                className={QUICK_BUTTON}
                aria-label="Log one more question solved today"
              >
                +1 Q
              </button>
            )}
          </div>
        )}
        {note && (
          <span
            className={`font-mono text-[10px] ${note.tone === 'error' ? 'text-critical' : 'text-steel'}`}
            role="status"
          >
            {note.text}
            {note.onUndo && (
              <button
                type="button"
                disabled={busy}
                onClick={note.onUndo}
                className="ml-2 underline decoration-dotted underline-offset-2 hover:text-ink disabled:opacity-50"
              >
                Undo
              </button>
            )}
          </span>
        )}
        {par.consecutive_days_below > 0 && (
          <span
            className={`font-sans text-[11px] ${par.status === 'critical' ? 'text-critical' : 'text-warn'}`}
          >
            {par.consecutive_days_below}d below target
          </span>
        )}
      </div>
    </div>
  )
}
