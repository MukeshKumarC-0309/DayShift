import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import CheckInForm from './CheckInForm'

describe('CheckInForm', () => {
  it('saves sleep as minutes and the chosen scales', async () => {
    const setCheckIn = vi.spyOn(api, 'setCheckIn').mockResolvedValue({
      check_date: '2026-10-05',
      sleep_minutes: 450,
      energy: 4,
      mood: null,
      note: null,
    })
    const onSaved = vi.fn()
    render(
      <CheckInForm
        date="2026-10-05"
        existing={null}
        onSaved={onSaved}
        onSessionExpired={() => undefined}
      />,
    )
    fireEvent.change(screen.getByLabelText('Hours slept'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Minutes slept'), { target: { value: '30' } })
    fireEvent.click(screen.getByLabelText('Energy 4'))
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(setCheckIn).toHaveBeenCalledWith({
      check_date: '2026-10-05',
      sleep_minutes: 450,
      energy: 4,
      mood: null,
      note: null,
    })
  })

  it('clicking a chosen value again clears it', () => {
    render(
      <CheckInForm
        date="2026-10-05"
        existing={null}
        onSaved={() => undefined}
        onSessionExpired={() => undefined}
      />,
    )
    const four = screen.getByLabelText('Mood 4')
    fireEvent.click(four)
    expect(four).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(four)
    expect(four).toHaveAttribute('aria-checked', 'false')
  })
})
