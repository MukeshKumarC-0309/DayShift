// Single-key shortcuts. They never fire while you are typing in a field, and
// never when a modifier is held, so they cannot collide with browser or OS
// shortcuts (Cmd+R still reloads; `r` alone opens Review).

import { useEffect, useRef } from 'react'

/** True when the keystroke is going into a text field, not the page. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * Call `handler` when `key` is pressed on its own. `key` is compared against
 * `KeyboardEvent.key`, so `?` and `[` work regardless of keyboard layout.
 */
export function useHotkey(key: string, handler: () => void, enabled = true): void {
  // Held in a ref so a new handler identity each render does not re-register.
  const latest = useRef(handler)
  latest.current = handler

  useEffect(() => {
    if (!enabled) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.repeat || isTypingTarget(e.target)) return
      if (e.key !== key) return
      e.preventDefault()
      latest.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [key, enabled])
}

/** Window events that open the global panels from a click (e.g. the ⋯ menu). */
export const OPEN_SHORTCUTS_EVENT = 'dayshift:open-shortcuts'
export const OPEN_PALETTE_EVENT = 'dayshift:open-palette'

/** Every shortcut, for the `?` panel. Kept next to the hook so they stay in step. */
export const SHORTCUTS: { group: string; keys: [string, string][] }[] = [
  {
    group: 'Anywhere',
    keys: [
      ['d', 'Dashboard'],
      ['r', 'Weekly review'],
      ['i', 'Insights'],
      ['q', 'Practice (DSA problem log)'],
      ['a', 'Agenda (plan, exams, deadlines)'],
      ['g', 'Goals (habits, milestones)'],
      ['m', 'Monthly letter'],
      ['/', 'Search notes and tags'],
      ['s', 'Settings'],
      ['⌘ / Ctrl + K', 'Command palette — go anywhere, or log “+25 sde”'],
      ['?', 'This list'],
    ],
  },
  {
    group: 'Dashboard',
    keys: [
      ['[  ]', 'Previous / next domain'],
      ['t', 'Timer tab'],
      ['l', 'Log tab'],
      ['o', 'Override tab'],
      ['p', 'Par score tab'],
      ['w', 'Weekly tab'],
    ],
  },
  {
    group: 'Log form',
    keys: [
      ['⌘ / Ctrl + Enter', 'Record'],
      ['‹  ›', 'Buttons beside the date step a day'],
    ],
  },
]
