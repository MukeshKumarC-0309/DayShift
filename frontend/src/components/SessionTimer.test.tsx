import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { Category, WorkSession } from '../types'
import SessionTimer from './SessionTimer'

const cats = [
  { id: 1, name: 'SDE Project', archived: false },
  { id: 4, name: 'DSA', archived: false },
] as Category[]

const running: WorkSession = {
  id: 3,
  category_id: 1,
  log_date: '2026-09-25',
  started_at: new Date(Date.now() - 5 * 60000).toISOString().slice(0, 19),
  ended_at: null,
  minutes: 0,
  note: 'Rate limiter',
  source: 'timer',
  tags: ['backend'],
  is_running: true,
  elapsed_minutes: 5,
  planned_end: null,
  deadline_id: null,
  measured_minutes: null,
  git_ref: 'feature/rate-limiter',
}

beforeEach(() => {
  window.localStorage.clear()
  vi.spyOn(api, 'deadlines').mockResolvedValue([])
  vi.spyOn(api, 'tags').mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())

describe('SessionTimer', () => {
  it('starts with note, tags and branch, then clears them', async () => {
    const start = vi.spyOn(api, 'startSession').mockResolvedValue(running)
    const onChanged = vi.fn()
    render(
      <SessionTimer
        categories={cats}
        running={null}
        onChanged={onChanged}
        onSessionExpired={() => undefined}
      />,
    )
    fireEvent.change(screen.getByLabelText('Session note'), {
      target: { value: ' Rate limiter ' },
    })
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'backend,' } })
    fireEvent.change(screen.getByLabelText('Branch or issue'), {
      target: { value: 'feature/rate-limiter' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'SDE Project' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(start).toHaveBeenCalledWith(1, 'Rate limiter', ['backend'], {
      git_ref: 'feature/rate-limiter',
    })
    expect((screen.getByLabelText('Session note') as HTMLInputElement).value).toBe('')
  })

  it('asks twice before discarding', async () => {
    const discard = vi.spyOn(api, 'discardSession').mockResolvedValue(undefined)
    render(
      <SessionTimer
        categories={cats}
        running={running}
        onChanged={() => undefined}
        onSessionExpired={() => undefined}
      />,
    )
    expect(screen.getByText('feature/rate-limiter')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(discard).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Discard for good' }))
    await waitFor(() => expect(discard).toHaveBeenCalled())
  })

  it('a focus mode sends the planned length', async () => {
    const start = vi.spyOn(api, 'startSession').mockResolvedValue(running)
    render(
      <SessionTimer
        categories={cats}
        running={null}
        onChanged={() => undefined}
        onSessionExpired={() => undefined}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Focus 25 · 5' }))
    fireEvent.click(screen.getByRole('button', { name: 'DSA' }))
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith(4, undefined, [], { planned_minutes: 25 }),
    )
  })
})
