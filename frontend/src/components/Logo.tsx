import { useId } from 'react'

/**
 * The Dayshift mark: an app-icon tile — a teal-to-violet gradient, the first
 * two category hues — carrying the same 270-degree gauge the dashboard uses,
 * with a needle so it reads as a dial rather than a loading ring.
 *
 * Self-contained colours (it is an identity mark, not a data mark), and
 * legible down to 16px, where it is also the favicon.
 */

interface Props {
  /** Rendered size in px. */
  size?: number
  className?: string
}

const CX = 16
const CY = 17.2
const R = 8.6
const START = 135
const SWEEP = 270
const FILLED = 0.72

function polar(angleDeg: number, radius = R): [number, number] {
  const rad = (angleDeg * Math.PI) / 180
  return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)]
}

function arc(fraction: number): string {
  const [x0, y0] = polar(START)
  const [x1, y1] = polar(START + SWEEP * fraction)
  const largeArc = SWEEP * fraction > 180 ? 1 : 0
  return `M ${x0.toFixed(3)} ${y0.toFixed(3)} A ${R} ${R} 0 ${largeArc} 1 ${x1.toFixed(3)} ${y1.toFixed(3)}`
}

const [NX, NY] = polar(START + SWEEP * FILLED, 5.4)

export default function Logo({ size = 24, className = '' }: Props) {
  // Two marks on one page (header + sign-in card) must not share gradient ids.
  const id = useId().replace(/:/g, '')
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      role="img"
      aria-label="Dayshift"
    >
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#0f8196" />
          <stop offset="100%" stopColor="#7c4ee0" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id}-bg)`} />
      <rect width="32" height="32" rx="8" fill={`url(#${id}-sheen)`} />
      <path
        d={arc(1)}
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.3"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d={arc(FILLED)}
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <line
        x1={CX}
        y1={CY}
        x2={NX.toFixed(3)}
        y2={NY.toFixed(3)}
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx={CX} cy={CY} r="2" fill="#ffffff" />
    </svg>
  )
}
