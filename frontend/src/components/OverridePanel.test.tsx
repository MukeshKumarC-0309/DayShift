import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { Category } from '../types'
import OverridePanel from './OverridePanel'

const cats = [
  {
    id: 1,
    name: 'SDE Project',
    daily_target_minutes: 180,
    active_days: 'MON,TUE,WED,FRI,SAT,SUN',
  },
  {
    id: 5,
    name: 'Exercise',
    daily_target_minutes: 30,
    active_days: 'MON,TUE,WED,THU,FRI,SAT,SUN',
  },
] as Category[]

function renderPanel() {
  return render(
    <OverridePanel
      embedded
      categories={cats}
      today="2026-10-08"
      onSaved={() => undefined}
      onSessionExpired={() => undefined}
    />,
  )
}

describe('OverridePanel', () => {
  it('sends the reason with a single override (it used to be dropped)', async () => {
    const upsert = vi.spyOn(api, 'upsertLog').mockResolvedValue({} as never)
    renderPanel()
    fireEvent.change(screen.getByPlaceholderText('Minutes'), { target: { value: '60' } })
    fireEvent.change(screen.getByLabelText('Override reason'), {
      target: { value: 'Clash' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set override' }))
    await waitFor(() => expect(upsert).toHaveBeenCalled())
    expect(upsert.mock.calls[0][0]).toMatchObject({
      log_date: '2026-10-08',
      category_id: 1,
      override_target_minutes: 60,
      override_reason: 'Clash',
    })
  })

  it('a preset fills the form, and Set sends every category at 0 over the range', async () => {
    const bulk = vi.spyOn(api, 'bulkOverride').mockResolvedValue([])
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Sick day' }))
    expect(bulk).not.toHaveBeenCalled() // a preset alone saves nothing
    fireEvent.click(screen.getByLabelText(/Apply across a date range/))
    fireEvent.click(screen.getByRole('button', { name: 'Set range' }))
    await waitFor(() => expect(bulk).toHaveBeenCalled())
    expect(bulk.mock.calls[0][0]).toMatchObject({
      start: '2026-10-08',
      end: '2026-10-08',
      category_ids: [1, 5],
      override_target_minutes: 0,
      reason: 'Sick day',
      active_days_only: true,
    })
  })

  it('half day sets half of each target, only on scheduled days', async () => {
    const upsert = vi.spyOn(api, 'upsertLog').mockResolvedValue({} as never)
    renderPanel() // 2026-10-08 is a Thursday: SDE is not scheduled
    fireEvent.click(screen.getByRole('button', { name: 'Half day' }))
    fireEvent.click(screen.getByRole('button', { name: 'Set override' }))
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1))
    expect(upsert.mock.calls[0][0]).toMatchObject({
      category_id: 5,
      override_target_minutes: 15,
      override_reason: 'Half day',
    })
  })
})
