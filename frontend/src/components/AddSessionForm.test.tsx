import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError } from '../api/client'
import type { Category, WorkSession } from '../types'
import AddSessionForm from './AddSessionForm'

const cats = [
  { id: 1, name: 'SDE Project', archived: false },
  { id: 4, name: 'DSA', archived: false },
] as Category[]

function renderForm(onSaved = vi.fn()) {
  render(
    <AddSessionForm
      date="2026-09-20"
      categories={cats}
      exams={[]}
      tagSuggestions={[]}
      onSaved={onSaved}
      onCancel={() => undefined}
      onSessionExpired={() => undefined}
    />,
  )
  return onSaved
}

function times(start: string, end: string) {
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: start } })
  fireEvent.change(screen.getByLabelText('End time'), { target: { value: end } })
}

afterEach(() => vi.restoreAllMocks())

describe('AddSessionForm', () => {
  it('sends the start and the minutes between the two times', async () => {
    const create = vi.spyOn(api, 'createSession').mockResolvedValue({} as WorkSession)
    const onSaved = renderForm()
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: '4' } })
    times('09:15', '10:45')
    expect(screen.getByText('= 1h 30m')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: ' Graphs ' } })
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: ' #42 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add session' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(create).toHaveBeenCalledWith({
      category_id: 4,
      log_date: '2026-09-20',
      minutes: 90,
      started_at: '2026-09-20T09:15:00',
      note: 'Graphs',
      tags: [],
      git_ref: '#42',
    })
  })

  it('refuses an end before the start without calling the server', () => {
    const create = vi.spyOn(api, 'createSession')
    renderForm()
    times('23:00', '00:30')
    fireEvent.click(screen.getByRole('button', { name: 'Add session' }))
    expect(screen.getByRole('alert').textContent).toMatch(/ends before it starts/)
    expect(create).not.toHaveBeenCalled()
  })

  it('refuses exactly midnight as a start', () => {
    const create = vi.spyOn(api, 'createSession')
    renderForm()
    times('00:00', '01:00')
    fireEvent.click(screen.getByRole('button', { name: 'Add session' }))
    expect(screen.getByRole('alert').textContent).toMatch(/00:01/)
    expect(create).not.toHaveBeenCalled()
  })

  it('shows which session is in the way when the server refuses an overlap', async () => {
    vi.spyOn(api, 'createSession').mockRejectedValue(
      new ApiError(
        409,
        'Overlaps a session already recorded (09:00-10:00, SDE Project).',
      ),
    )
    const onSaved = renderForm()
    times('09:30', '10:30')
    fireEvent.click(screen.getByRole('button', { name: 'Add session' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /09:00-10:00, SDE Project/,
    )
    expect(onSaved).not.toHaveBeenCalled()
  })
})
