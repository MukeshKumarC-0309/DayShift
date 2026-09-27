// Domains: the categories grouped by `group_name`, shown one domain at a time.
//
// Six categories on one screen is too much to take in at a glance, so the
// dashboard pages between domains (Projects, Daily) instead. The chosen domain
// is remembered per browser — a convenience, never data — so reopening the app
// lands where you left it.

import { useCallback, useMemo, useState } from 'react'

import type { Category } from './types'

export interface Domain {
  name: string
  categoryIds: number[]
}

const STORAGE_KEY = 'dayshift.domain'

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null // private window or blocked storage: start on the first domain
  }
}

function writeStored(name: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, name)
  } catch {
    /* The domain still switches; it just will not be remembered. */
  }
}

/** Domains in the order their first category appears on the dashboard. */
export function groupDomains(categories: Category[]): Domain[] {
  const byName = new Map<string, number[]>()
  for (const category of categories) {
    const name = category.group_name || 'Projects'
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name)!.push(category.id)
  }
  return [...byName.entries()].map(([name, categoryIds]) => ({ name, categoryIds }))
}

/**
 * A category's colour slot, from its permanent id — never its position in a
 * list. So reordering or archiving categories never repaints the others, and
 * a category is the same colour on every page. Ids start at 1, so the six
 * original categories keep the colours they always had; a seventh and later
 * fall back to the neutral grey (categoryTheme has six slots).
 */
export function colourIndex(categoryId: number): number {
  return categoryId - 1
}

export function useDomains(categories: Category[]) {
  const domains = useMemo(() => groupDomains(categories), [categories])
  const [chosen, setChosen] = useState<string | null>(readStored)

  const index = Math.max(
    0,
    domains.findIndex((d) => d.name === chosen),
  )
  // Memoised, not rebuilt each render: a fresh object here would give every
  // dependent memo a new identity each render, and the log form — which
  // reloads when its category list changes — would refetch in a loop.
  const active = useMemo<Domain>(
    () => domains[index] ?? { name: 'Projects', categoryIds: [] },
    [domains, index],
  )

  const go = useCallback(
    (next: number) => {
      if (domains.length === 0) return
      // Wraps, so a single `>` button cycles through any number of domains.
      const wrapped = (next + domains.length) % domains.length
      const name = domains[wrapped].name
      setChosen(name)
      writeStored(name)
    },
    [domains],
  )

  const includes = useCallback(
    (categoryId: number) => active.categoryIds.includes(categoryId),
    [active],
  )

  return {
    domains,
    index,
    active,
    includes,
    next: () => go(index + 1),
    prev: () => go(index - 1),
    goTo: go,
  }
}
