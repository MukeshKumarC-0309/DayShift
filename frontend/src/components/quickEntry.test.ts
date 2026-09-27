import { describe, expect, it } from 'vitest'

import type { Category } from '../types'
import { matchCategory, parseQuickEntry } from './CommandPalette'

const make = (id: number, name: string, q: number | null = null) =>
  ({ id, name, question_target: q }) as Category

const CATS = [
  make(1, 'SDE Project'),
  make(2, 'AI Automation'),
  make(3, 'Project Maintenance'),
  make(4, 'DSA', 2),
  make(5, 'Exercise'),
  make(6, 'Coursework'),
]

describe('matchCategory', () => {
  it.each([
    ['sde', 1],
    ['ai', 2],
    ['pm', 3], // initials
    ['maint', 3], // prefix of a later word
    ['dsa', 4],
    ['ex', 5],
    ['course', 6],
  ])('%s → %i', (text, id) => {
    expect(matchCategory(CATS, text)?.id).toBe(id)
  })

  it('returns nothing for no match', () => {
    expect(matchCategory(CATS, 'zzz')).toBeUndefined()
  })
})

describe('parseQuickEntry', () => {
  it('reads minutes, amount first or name first', () => {
    expect(parseQuickEntry(CATS, '+25 sde')).toMatchObject({
      amount: 25,
      questions: false,
    })
    expect(parseQuickEntry(CATS, 'ai 45')?.category.id).toBe(2)
    expect(parseQuickEntry(CATS, '30m exercise')?.amount).toBe(30)
  })

  it('reads questions only for a question category', () => {
    expect(parseQuickEntry(CATS, '+1q dsa')).toMatchObject({ amount: 1, questions: true })
    expect(parseQuickEntry(CATS, '+1q sde')).toBeNull()
  })

  it('rejects nonsense', () => {
    expect(parseQuickEntry(CATS, 'dashboard')).toBeNull()
    expect(parseQuickEntry(CATS, '+0 sde')).toBeNull()
    expect(parseQuickEntry(CATS, '+2000 sde')).toBeNull()
  })
})
