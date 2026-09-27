import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { isTypingTarget } from '../hotkeys'

/**
 * A panel holding several views, one visible at a time.
 *
 * This is how the dashboard stays light at first glance: Par score and Weekly
 * share one block, Timer / Log / Override share another. Everything is one
 * click away, but only one thing per block competes for attention.
 *
 * The chosen tab is remembered per browser under `storageKey`.
 */

export interface Tab {
  id: string
  label: string
  /** Small marker after the label, e.g. a live-recording dot. */
  badge?: ReactNode
  /** Single key that jumps to this tab from anywhere on the page. */
  hotkey?: string
  content: ReactNode
}

interface Props {
  tabs: Tab[]
  storageKey: string
  /** Force a tab to show, e.g. the timer while it is recording. */
  forceTab?: string
  /** Right-aligned text in the tab row, e.g. a date range. */
  aside?: ReactNode
}

function readTab(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export default function TabBlock({ tabs, storageKey, forceTab, aside }: Props) {
  const [chosen, setChosen] = useState<string | null>(() => readTab(storageKey))
  const baseId = useId()
  const block = useRef<HTMLElement | null>(null)

  const active =
    tabs.find((t) => t.id === forceTab)?.id ??
    tabs.find((t) => t.id === chosen)?.id ??
    tabs[0]?.id

  function choose(id: string) {
    setChosen(id)
    try {
      window.localStorage.setItem(storageKey, id)
    } catch {
      /* Not remembered; the tab still switches. */
    }
  }

  // One listener for all of this block's tab keys. Kept in a ref so the
  // effect registers once rather than on every render.
  const keyMap = useRef<Record<string, string>>({})
  keyMap.current = Object.fromEntries(
    tabs.filter((t) => t.hotkey).map((t) => [t.hotkey!, t.id]),
  )
  const chooseRef = useRef(choose)
  chooseRef.current = choose

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if (isTypingTarget(e.target)) return
      const id = keyMap.current[e.key]
      if (!id) return
      e.preventDefault()
      chooseRef.current(id)
      // Bring the block into view: on a phone it may be below the fold.
      block.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <section ref={block} className="panel px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          className="flex flex-wrap gap-1"
          onKeyDown={(e) => {
            const i = tabs.findIndex((t) => t.id === active)
            if (e.key === 'ArrowRight') choose(tabs[(i + 1) % tabs.length].id)
            if (e.key === 'ArrowLeft')
              choose(tabs[(i - 1 + tabs.length) % tabs.length].id)
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={`${baseId}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={tab.id === active}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={tab.id === active ? 0 : -1}
              onClick={() => choose(tab.id)}
              title={tab.hotkey ? `${tab.label} (${tab.hotkey})` : undefined}
              className="tab flex items-center gap-1.5"
            >
              {tab.label}
              {tab.badge}
            </button>
          ))}
        </div>
        {aside}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${baseId}-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={tab.id !== active}
        >
          {tab.id === active && tab.content}
        </div>
      ))}
    </section>
  )
}
