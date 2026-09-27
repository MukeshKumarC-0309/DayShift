import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import type { Category } from '../types'
import CategoryEditor from './CategoryEditor'

const cat = (id: number, name: string): Category =>
  ({
    id,
    name,
    archived: false,
    daily_target_minutes: 60,
    question_target: null,
    active_days: 'MON,TUE,WED,THU,FRI,SAT,SUN',
    group_name: 'Projects',
  }) as Category

const cats = [cat(1, 'SDE Project'), cat(2, 'AI Automation'), cat(3, 'DSA')]

afterEach(() => vi.restoreAllMocks())

describe('CategoryEditor reorder', () => {
  it('moves a category and sends the whole new order', async () => {
    const reorder = vi.spyOn(api, 'reorderCategories').mockResolvedValue([])
    const onChanged = vi.fn()
    render(
      <CategoryEditor
        categories={cats}
        onChanged={onChanged}
        onSessionExpired={() => undefined}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Move DSA up' }))
    await waitFor(() => expect(reorder).toHaveBeenCalledWith([1, 3, 2]))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('cannot move past either end', () => {
    render(
      <CategoryEditor
        categories={cats}
        onChanged={() => undefined}
        onSessionExpired={() => undefined}
      />,
    )
    const up = screen.getByRole('button', {
      name: 'Move SDE Project up',
    }) as HTMLButtonElement
    const down = screen.getByRole('button', {
      name: 'Move DSA down',
    }) as HTMLButtonElement
    expect(up.disabled).toBe(true)
    expect(down.disabled).toBe(true)
  })
})
