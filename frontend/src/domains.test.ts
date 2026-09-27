import { describe, expect, it } from 'vitest'

import { colourIndex, groupDomains } from './domains'
import type { Category } from './types'

function cat(id: number, name: string, group: string): Category {
  return {
    id,
    name,
    group_name: group,
    display_order: id,
    archived: false,
    daily_target_minutes: 60,
    active_days: 'MON',
    question_target: null,
  } as Category
}

const CATS = [
  cat(1, 'SDE Project', 'Projects'),
  cat(4, 'DSA', 'Daily'),
  cat(2, 'AI Automation', 'Projects'),
]

describe('domains', () => {
  it('groups in order of first appearance', () => {
    expect(groupDomains(CATS)).toEqual([
      { name: 'Projects', categoryIds: [1, 2] },
      { name: 'Daily', categoryIds: [4] },
    ])
  })

  it('colours by id, so reordering or archiving never repaints a category', () => {
    expect(colourIndex(1)).toBe(0)
    expect(colourIndex(6)).toBe(5)
  })
})
