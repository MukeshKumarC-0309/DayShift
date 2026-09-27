import type { CheckInBucket, CheckInInsights } from '../types'

/**
 * Sleep and energy against how the day went.
 *
 * Top row: hours slept, one bar per day. A day without a check-in is drawn as
 * an empty dashed slot — a gap, never guessed or filled in. Bottom row: that
 * day's completion (share of targets met, each category capped at 100%).
 * Below, the same days grouped by sleep and by energy.
 */

const SLOT = 10
const GAP = 2
const SLEEP_H = 56
const DOT = 8
const MAX_SLEEP = 10 * 60
// Fewer days than this in a band and its average is noise, so it is dimmed.
const MIN_DAYS = 5

function completionColour(value: number | null): string {
  if (value === null) return 'rgba(255,255,255,0.08)'
  if (value >= 0.8) return '#34d399'
  if (value >= 0.5) return '#fbbf24'
  return '#ea580c'
}

function Bucket({ bucket }: { bucket: CheckInBucket }) {
  const thin = bucket.days < MIN_DAYS
  const pct = bucket.completion === null ? null : Math.round(bucket.completion * 100)
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)_88px] items-center gap-3">
      <span className="font-mono text-[11px] text-muted">{bucket.label}</span>
      <span className="h-2 rounded-full bg-edge">
        {pct !== null && (
          <span
            className="block h-full rounded-full"
            style={{
              width: `${Math.max(pct, 2)}%`,
              backgroundColor: completionColour(bucket.completion),
              opacity: thin ? 0.35 : 1,
            }}
          />
        )}
      </span>
      <span className="text-right font-mono text-[11px] tnum">
        {pct === null ? (
          <span className="text-faint">no days</span>
        ) : (
          <>
            <span className={thin ? 'text-faint' : 'text-ink'}>{pct}%</span>{' '}
            <span className="text-faint">· {bucket.days}d</span>
          </>
        )}
      </span>
    </div>
  )
}

export default function CheckInPanel({ data }: { data: CheckInInsights }) {
  const width = data.days.length * (SLOT + GAP)
  const height = SLEEP_H + 6 + DOT

  return (
    <section className="panel mb-6 px-5 py-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="panel-label">Sleep &amp; energy</h2>
        <span className="font-mono text-[10px] text-faint">
          {data.gaps} of {data.days.length} days without a check-in
        </span>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="block h-[80px] min-w-full"
          style={{ width: Math.max(width, 0) }}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Hours slept and day completion from ${data.start} to ${data.end}`}
        >
          {/* 6h reference line. Drawn neutral: category hues mean "which
              category" and status hues mean "how well", so neither fits. */}
          <line
            x1={0}
            x2={width}
            y1={SLEEP_H - (360 / MAX_SLEEP) * SLEEP_H}
            y2={SLEEP_H - (360 / MAX_SLEEP) * SLEEP_H}
            stroke="#9aa3bd"
            strokeOpacity={0.35}
            strokeDasharray="3 3"
          />
          {data.days.map((d, i) => {
            const x = i * (SLOT + GAP)
            const sleep = d.checkin?.sleep_minutes ?? null
            const barH =
              sleep === null
                ? 0
                : Math.max(2, (Math.min(sleep, MAX_SLEEP) / MAX_SLEEP) * SLEEP_H)
            return (
              <g key={d.day}>
                <title>
                  {d.day}
                  {d.checkin === null
                    ? ' — no check-in'
                    : `${sleep !== null ? ` — slept ${Math.floor(sleep / 60)}h ${sleep % 60}m` : ''}${
                        d.checkin.energy !== null ? ` · energy ${d.checkin.energy}` : ''
                      }`}
                  {d.completion !== null &&
                    ` · ${Math.round(d.completion * 100)}% of targets`}
                </title>
                {d.checkin === null ? (
                  <rect
                    x={x + 0.5}
                    y={0.5}
                    width={SLOT - 1}
                    height={SLEEP_H - 1}
                    rx={2}
                    fill="none"
                    stroke="#3a4263"
                    strokeDasharray="2 2"
                  />
                ) : (
                  <rect
                    x={x}
                    y={SLEEP_H - barH}
                    width={SLOT}
                    height={barH}
                    rx={2}
                    fill="#60a5fa"
                    opacity={sleep === null ? 0 : 0.85}
                  />
                )}
                <rect
                  x={x + (SLOT - DOT) / 2}
                  y={SLEEP_H + 6}
                  width={DOT}
                  height={DOT}
                  rx={2}
                  fill={completionColour(d.completion)}
                />
              </g>
            )
          })}
        </svg>
      </div>
      <p className="mt-1.5 font-mono text-[10px] text-faint">
        Bars: hours slept (dotted line = 6h). Squares: share of that day&apos;s targets
        met. Dashed outline: no check-in.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-faint">
            By sleep the night before
          </p>
          <div className="space-y-1.5">
            {data.by_sleep.map((b) => (
              <Bucket key={b.label} bucket={b} />
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-faint">
            By morning energy
          </p>
          <div className="space-y-1.5">
            {data.by_energy.map((b) => (
              <Bucket key={b.label} bucket={b} />
            ))}
          </div>
        </div>
      </div>
      <p className="mt-3 border-t border-divider pt-2 font-sans text-[11px] text-faint">
        Averages over fewer than {MIN_DAYS} days are dimmed — too few to mean much.
        Check-ins are context only and never change a score.
      </p>
    </section>
  )
}
