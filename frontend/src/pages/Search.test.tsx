import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import TagRollupPanel from '../components/TagRollupPanel'
import type { Category, SearchHit, WorkSession } from '../types'
import Search from './Search'

const cats = [
  { id: 1, name: 'SDE Project', archived: false },
  { id: 4, name: 'DSA', archived: false },
] as Category[]

function session(over: Partial<WorkSession>): WorkSession {
  return {
    id: 1,
    category_id: 1,
    log_date: '2026-10-08',
    started_at: '2026-10-08T09:00:00',
    ended_at: '2026-10-08T10:00:00',
    minutes: 60,
    note: null,
    source: 'timer',
    tags: [],
    is_running: false,
    elapsed_minutes: 60,
    planned_end: null,
    deadline_id: null,
    measured_minutes: null,
    git_ref: null,
    ...over,
  }
}

const hits: SearchHit[] = [
  {
    session: session({ id: 1, note: 'Token bucket rate limiter', tags: ['backend'] }),
    category_name: 'SDE Project',
  },
  {
    session: session({ id: 2, minutes: 30, note: 'Limiter tests', tags: ['tests'] }),
    category_name: 'SDE Project',
  },
]

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

function renderAt(url: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="*" element={element} />
      </Routes>
      <Where />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.spyOn(api, 'categories').mockResolvedValue(cats)
  vi.spyOn(api, 'tags').mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())

describe('Search page', () => {
  it('searches what is in the URL and totals the results', async () => {
    const search = vi.spyOn(api, 'search').mockResolvedValue(hits)
    renderAt('/search?q=limiter', <Search onSessionExpired={() => undefined} />)
    await screen.findByText('2 sessions · 1h 30m')
    expect(search).toHaveBeenCalledWith('limiter', undefined, 200)
    // The matched text is marked, case-insensitively.
    const marks = document.querySelectorAll('mark')
    expect([...marks].map((m) => m.textContent)).toEqual(['limiter', 'Limiter'])
  })

  it('clicking a tag filters to exactly that tag', async () => {
    const search = vi.spyOn(api, 'search').mockResolvedValue(hits)
    renderAt('/search?q=limiter', <Search onSessionExpired={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: 'backend' }))
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith('limiter', 'backend', 200),
    )
    expect(screen.getByTestId('where').textContent).toBe('/search?q=limiter&tag=backend')
  })

  it('does not search for nothing', () => {
    const search = vi.spyOn(api, 'search').mockResolvedValue([])
    renderAt('/search', <Search onSessionExpired={() => undefined} />)
    expect(search).not.toHaveBeenCalled()
  })
})

describe('TagRollupPanel', () => {
  it('lists tags by time and opens Search for one', async () => {
    vi.spyOn(api, 'tagRollup').mockResolvedValue({
      start: '2026-09-01',
      end: '2026-09-30',
      total_minutes: 200,
      untagged_minutes: 50,
      tags: [
        {
          name: 'dp',
          session_count: 3,
          total_minutes: 120,
          by_category: { '4': 90, '1': 30 },
        },
        { name: 'graphs', session_count: 1, total_minutes: 40, by_category: { '4': 40 } },
      ],
      branches: [],
    })
    renderAt(
      '/insights',
      <TagRollupPanel
        start="2026-09-01"
        end="2026-09-30"
        categories={cats}
        onSessionExpired={() => undefined}
      />,
    )
    expect(await screen.findByText('2h 30m of 3h 20m timed is tagged')).toBeTruthy()
    expect(
      screen.getByRole('img', { name: /dp: 2h 00m, DSA 1h 30m, SDE Project 30m/ }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'graphs' }))
    expect(screen.getByTestId('where').textContent).toBe('/search?tag=graphs')
  })
})
