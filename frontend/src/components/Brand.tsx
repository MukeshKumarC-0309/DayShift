import type { ReactNode } from 'react'

import Logo from './Logo'

/**
 * Logo + wordmark (+ the page's name), used at the top-left of every page so
 * they all match. The wordmark is set in the sans face — "Day" in ink,
 * "shift" in the mark's gradient — and the page name sits apart behind a
 * divider, in the mono face used for data.
 */

interface Props {
  /** The page, or today's date — shown after the wordmark. */
  subtitle?: ReactNode
  /** `lg` for the sign-in and setup cards. */
  size?: 'md' | 'lg'
}

export default function Brand({ subtitle, size = 'md' }: Props) {
  const large = size === 'lg'
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Logo size={large ? 34 : 26} />
      <h1
        className={`font-sans font-semibold leading-none tracking-tight text-ink ${
          large ? 'text-[22px]' : 'text-[17px]'
        }`}
      >
        Day
        <span className="bg-gradient-to-r from-cat1-bright to-cat2-bright bg-clip-text text-transparent">
          shift
        </span>
      </h1>
      {subtitle && (
        <>
          <span className="h-4 w-px shrink-0 bg-edge" aria-hidden="true" />
          <span className="truncate font-mono text-xs leading-none text-faint">
            {subtitle}
          </span>
        </>
      )}
    </div>
  )
}
