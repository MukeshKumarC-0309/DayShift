import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ParScore, TodayProgress } from '../types'
import GaugeIndicator from './GaugeIndicator'

const progress = (over: Partial<TodayProgress> = {}): TodayProgress => ({
  category_id: 4,
  category_name: 'DSA',
  minutes_logged: 30,
  manual_minutes: 30,
  timed_minutes: 0,
  questions_solved: 1,
  question_target: 2,
  credited_minutes: 60,
  target_minutes: 120,
  default_target_minutes: 120,
  has_override: false,
  is_active_today: true,
  percent: 50,
  ...over,
})

const par = { status: 'healthy', consecutive_days_below: 0 } as ParScore

describe('GaugeIndicator', () => {
  it('shows real minutes in the centre but credited percent', () => {
    render(<GaugeIndicator progress={progress()} par={par} index={3} />)
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText(/50% of today/)).toBeInTheDocument()
    expect(screen.getByText('1/2 Q')).toBeInTheDocument()
  })

  it('quick-adds minutes and questions', () => {
    const onQuickAdd = vi.fn()
    render(
      <GaugeIndicator
        progress={progress()}
        par={par}
        index={3}
        onQuickAdd={onQuickAdd}
      />,
    )
    fireEvent.click(screen.getByLabelText('Add 15 minutes to DSA today'))
    fireEvent.click(screen.getByLabelText('Log one more question solved today'))
    expect(onQuickAdd).toHaveBeenNthCalledWith(1, 15, 0)
    expect(onQuickAdd).toHaveBeenNthCalledWith(2, 0, 1)
  })

  it('offers no question button without a question target', () => {
    render(
      <GaugeIndicator
        progress={progress({ question_target: null, category_name: 'SDE' })}
        par={par}
        index={0}
        onQuickAdd={() => undefined}
      />,
    )
    expect(screen.queryByLabelText('Log one more question solved today')).toBeNull()
  })

  it('renders an undo note', () => {
    const onUndo = vi.fn()
    render(
      <GaugeIndicator
        progress={progress()}
        par={par}
        index={3}
        note={{ text: '+15 min added', tone: 'ok', onUndo }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalled()
  })
})
