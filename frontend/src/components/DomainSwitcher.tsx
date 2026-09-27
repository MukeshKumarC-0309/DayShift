import { useRef } from 'react'
import type { ReactNode } from 'react'

import type { Domain } from '../domains'

/**
 * `‹ [Projects 1/3] [Daily done] ›` — the control that pages the dashboard between domains,
 * plus the sliding track that the domain's panels live on.
 *
 * All domains are rendered side by side and the track slides, so switching
 * reads as moving to the next window rather than the page redrawing. Slides
 * that are off-screen are made inert, so keyboard focus and screen readers only
 * ever reach the domain actually shown.
 */

interface SwitcherProps {
  domains: Domain[]
  index: number
  onPrev: () => void
  onNext: () => void
  onGoTo: (index: number) => void
  /** Short line under the domain name, e.g. what it contains. */
  caption?: string
  /** Per domain, today: scheduled categories done out of those scheduled. */
  status?: { done: number; total: number }[]
}

function statusText(s: { done: number; total: number } | undefined): string {
  if (!s) return ''
  if (s.total === 0) return 'rest'
  return s.done === s.total ? 'done' : `${s.done}/${s.total}`
}

export function DomainSwitcher({
  domains,
  index,
  onPrev,
  onNext,
  onGoTo,
  caption,
  status,
}: SwitcherProps) {
  if (domains.length <= 1) return null
  const current = domains[index]

  return (
    <div
      className="mb-4 flex items-center justify-between gap-3"
      role="group"
      aria-label="Domain"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          onNext()
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          onPrev()
        }
      }}
    >
      <div className="min-w-0">
        <div className="flex items-baseline gap-3">
          <h2 className="font-sans text-base font-semibold text-ink" aria-live="polite">
            {current.name}
          </h2>
          <span className="font-mono text-[10px] text-faint tnum">
            {index + 1} / {domains.length}
          </span>
        </div>
        {caption && (
          <p className="truncate font-sans text-[11px] text-faint">{caption}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Domains">
          {domains.map((domain, i) => {
            const selected = i === index
            const today = statusText(status?.[i])
            const allDone = today === 'done'
            return (
              <button
                key={domain.name}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-label={today ? `${domain.name}, today ${today}` : domain.name}
                title={today ? `${domain.name} · today ${today}` : domain.name}
                onClick={() => onGoTo(i)}
                className={`flex h-7 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[10px] transition-colors ${
                  selected
                    ? 'border-steel/60 bg-steel/10 text-ink'
                    : 'border-edge text-muted hover:border-muted hover:text-ink'
                }`}
              >
                {/* With a status, a phone shows only the status (the name only
                    fits from sm up). Without one, the name is all there is. */}
                <span className={today ? 'hidden sm:inline' : undefined}>
                  {domain.name}
                </span>
                {today && (
                  <span className={allDone ? 'text-healthy' : 'text-faint'}>{today}</span>
                )}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={onPrev}
          aria-label="Previous domain"
          className="grid h-8 w-8 place-items-center rounded-sm border border-edge bg-raised font-mono text-sm text-muted transition-colors hover:border-steel hover:text-steel"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={onNext}
          aria-label={`Next domain: ${domains[(index + 1) % domains.length].name}`}
          className="grid h-8 w-8 place-items-center rounded-sm border border-edge bg-raised font-mono text-sm text-muted transition-colors hover:border-steel hover:text-steel"
        >
          ›
        </button>
      </div>
    </div>
  )
}

interface SliderProps {
  index: number
  count: number
  onSwipeNext: () => void
  onSwipePrev: () => void
  children: (slide: number) => ReactNode
}

/** Horizontal track of one slide per domain; swipeable on touch screens. */
export function DomainSlider({
  index,
  count,
  onSwipeNext,
  onSwipePrev,
  children,
}: SliderProps) {
  const startX = useRef<number | null>(null)

  return (
    <div
      className="overflow-hidden"
      onPointerDown={(e) => {
        if (e.pointerType === 'touch') startX.current = e.clientX
      }}
      onPointerUp={(e) => {
        if (startX.current === null) return
        const dx = e.clientX - startX.current
        startX.current = null
        // A deliberate swipe, not a scroll wobble.
        if (dx < -60) onSwipeNext()
        else if (dx > 60) onSwipePrev()
      }}
    >
      <div
        className="flex transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{ transform: `translateX(-${index * 100}%)` }}
      >
        {Array.from({ length: count }, (_, slide) => (
          <div
            key={slide}
            className="w-full shrink-0"
            aria-hidden={slide !== index}
            ref={(el) => {
              // Off-screen slides must not take focus or be read out.
              if (el) el.inert = slide !== index
            }}
          >
            {children(slide)}
          </div>
        ))}
      </div>
    </div>
  )
}
