import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError } from '../api/client'
import type { Category, DayDetail, WorkSession } from '../types'
import DayView from './DayView'

const DAY = '2026-09-20'

function session(
  id: number,
  start: string,
  over: Partial<WorkSession> = {},
): WorkSession {
  return {
    id,
    category_id: 1,
    log_date: DAY,
    started_at: `${DAY}T${start}:00`,
    ended_at: `${DAY}T${start}:00`,
    minutes: 30,
    note: null,
    source: 'timer',
    tags: [],
    is_running: false,
    elapsed_minutes: 30,
    planned_end: null,
    deadline_id: null,
    measured_minutes: null,
    git_ref: null,
    ...over,
  }
}

const detail: DayDetail = {
  log_date: DAY,
  weekday: 'Sunday',
  is_tracked: true,
  categories: [
    {
      category_id: 1,
      category_name: 'SDE Project',
      manual_minutes: 0,
      timed_minutes: 90,
      questions_solved: 0,
      question_target: null,
      total_minutes: 90,
      target_minutes: 180,
      is_active: true,
      has_override: false,
      override_reason: null,
      percent: 50,
      sessions: [
        session(1, '09:00'),
        session(2, '10:00'),
        // Added without a time of day: stored at midnight, can't be merged.
        session(3, '00:00', { source: 'manual' }),
      ],
    },
  ],
}

function renderDay() {
  render(
    <MemoryRouter initialEntries={[`/day/${DAY}`]}>
      <Routes>
        <Route
          path="/day/:date"
          element={<DayView onSessionExpired={() => undefined} />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.spyOn(api, 'dayDetail').mockResolvedValue(detail)
  vi.spyOn(api, 'categories').mockResolvedValue([
    { id: 1, name: 'SDE Project', archived: false },
  ] as Category[])
  vi.spyOn(api, 'deadlines').mockResolvedValue([])
  vi.spyOn(api, 'tags').mockResolvedValue([])
  vi.spyOn(api, 'refCommits').mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())

describe('DayView merge mode', () => {
  it('merges the ticked sessions', async () => {
    const merge = vi.spyOn(api, 'mergeSessions').mockResolvedValue(session(1, '09:00'))
    renderDay()
    fireEvent.click(await screen.findByRole('button', { name: 'merge…' }))
    const button = screen.getByRole('button', {
      name: 'Merge sessions',
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    // The untimed session can't be ticked.
    expect(
      (screen.getByLabelText('Merge the 00:00 session') as HTMLInputElement).disabled,
    ).toBe(true)
    fireEvent.click(screen.getByLabelText('Merge the 09:00 session'))
    fireEvent.click(screen.getByLabelText('Merge the 10:00 session'))
    fireEvent.click(screen.getByRole('button', { name: 'Merge 2 sessions' }))
    await waitFor(() => expect(merge).toHaveBeenCalledWith([1, 2]))
  })

  it('shows why the server refused', async () => {
    vi.spyOn(api, 'mergeSessions').mockRejectedValue(
      new ApiError(409, 'Another session was recorded in between (09:40-09:50, DSA).'),
    )
    renderDay()
    fireEvent.click(await screen.findByRole('button', { name: 'merge…' }))
    fireEvent.click(screen.getByLabelText('Merge the 09:00 session'))
    fireEvent.click(screen.getByLabelText('Merge the 10:00 session'))
    fireEvent.click(screen.getByRole('button', { name: 'Merge 2 sessions' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/09:40-09:50, DSA/)
  })

  it('hides edit and delete while merging', async () => {
    renderDay()
    fireEvent.click(await screen.findByRole('button', { name: 'merge…' }))
    expect(screen.queryByRole('button', { name: 'edit' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getAllByRole('button', { name: 'edit' }).length).toBe(3)
  })
})

describe('DayView undo', () => {
  const change = {
    id: 9,
    action: 'delete' as const,
    created_at: '2026-09-21T08:00:00',
    log_date: DAY,
    category_id: 1,
    category_name: 'SDE Project',
    minutes_before: 30,
    minutes_after: 0,
    sessions_before: 1,
    notes: [],
    after_the_fact: true,
    undone_at: null,
  }

  it('offers Undo after a delete and undoes it', async () => {
    vi.spyOn(api, 'deleteSession').mockResolvedValue(undefined)
    vi.spyOn(api, 'sessionChanges').mockResolvedValue([change])
    const undo = vi.spyOn(api, 'undoSessionChange').mockResolvedValue([])
    renderDay()
    fireEvent.click((await screen.findAllByRole('button', { name: 'delete' }))[0])
    expect(await screen.findByText('Deleted a 30-min SDE Project session.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(undo).toHaveBeenCalledWith(9))
    await waitFor(() => expect(screen.queryByText(/Deleted a 30-min/)).toBeNull())
  })

  it('shows why an undo was refused and keeps it on screen', async () => {
    vi.spyOn(api, 'deleteSession').mockResolvedValue(undefined)
    vi.spyOn(api, 'sessionChanges').mockResolvedValue([change])
    vi.spyOn(api, 'undoSessionChange').mockRejectedValue(
      new ApiError(409, 'Putting it back would overlap a session recorded since.'),
    )
    renderDay()
    fireEvent.click((await screen.findAllByRole('button', { name: 'delete' }))[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await screen.findByText(/would overlap a session recorded since/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })
})
