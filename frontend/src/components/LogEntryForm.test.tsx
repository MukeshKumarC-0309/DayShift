import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { Category } from '../types'
import LogEntryForm from './LogEntryForm'

const SDE = {
  id: 1,
  name: 'SDE Project',
  daily_target_minutes: 180,
  active_days: 'MON,TUE,WED,THU,FRI,SAT,SUN',
  question_target: null,
} as Category

function renderForm() {
  return render(
    <LogEntryForm
      categories={[SDE]}
      today="2026-10-05"
      onSaved={() => undefined}
      onSessionExpired={() => undefined}
    />,
  )
}

describe('LogEntryForm', () => {
  it('keeps inputs disabled until the day has loaded', async () => {
    // Regression: typing in the instant before the first load landed was
    // silently overwritten by it, and Record then saved nothing.
    let finish: (rows: never[]) => void = () => undefined
    vi.spyOn(api, 'logsForDay').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    renderForm()
    expect(screen.getByLabelText('SDE Project minutes')).toBeDisabled()
    finish([])
    await waitFor(() =>
      expect(screen.getByLabelText('SDE Project minutes')).toBeEnabled(),
    )
  })

  it('says so when there is nothing to record', async () => {
    vi.spyOn(api, 'logsForDay').mockResolvedValue([])
    const upsert = vi.spyOn(api, 'upsertLog')
    renderForm()
    await waitFor(() =>
      expect(screen.getByLabelText('SDE Project minutes')).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(await screen.findByText('Nothing typed to record.')).toBeInTheDocument()
    expect(upsert).not.toHaveBeenCalled()
    expect(screen.queryByText(/Saved/)).toBeNull()
  })

  it('will not drop typed numbers when the date changes', async () => {
    vi.spyOn(api, 'logsForDay').mockResolvedValue([])
    renderForm()
    const minutes = await screen.findByLabelText('SDE Project minutes')
    await waitFor(() => expect(minutes).not.toBeDisabled())
    fireEvent.change(minutes, { target: { value: '90' } })
    expect(screen.getByText('Unsaved')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Previous day'))
    expect(screen.getByText(/Unsaved numbers for 2026-10-05/)).toBeInTheDocument()
    expect(screen.getByLabelText('SDE Project minutes')).toHaveValue(90)
  })

  it('steps the date when nothing is unsaved', async () => {
    vi.spyOn(api, 'logsForDay').mockResolvedValue([])
    renderForm()
    await screen.findByLabelText('SDE Project minutes')
    fireEvent.click(screen.getByLabelText('Next day'))
    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-06')
    expect(screen.getByText('Future date')).toBeInTheDocument()
  })

  it('offers an undo that restores the previous minutes', async () => {
    vi.spyOn(api, 'logsForDay').mockResolvedValue([
      {
        id: 1,
        log_date: '2026-10-05',
        category_id: 1,
        minutes_logged: 40,
        questions_solved: 0,
        override_target_minutes: null,
        override_reason: null,
        created_at: 'x',
        updated_at: 'x',
      },
    ])
    const upsert = vi.spyOn(api, 'upsertLog').mockResolvedValue({} as never)
    renderForm()
    const minutes = await screen.findByLabelText('SDE Project minutes')
    await waitFor(() => expect(minutes).toHaveValue(40))
    fireEvent.change(minutes, { target: { value: '90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(2))
    expect(upsert.mock.calls[1][0]).toMatchObject({
      minutes_logged: 40,
      clear_override: true,
    })
  })
})
