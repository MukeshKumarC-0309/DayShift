import { describe, expect, it } from 'vitest'

import { formatMinutes, fromIso, shiftDate, toIso } from './dates'

describe('dates', () => {
  it('round-trips an ISO date in local time', () => {
    expect(toIso(fromIso('2026-10-05'))).toBe('2026-10-05')
  })

  it('shifts across month and year boundaries', () => {
    expect(shiftDate('2026-10-31', 1)).toBe('2026-11-01')
    expect(shiftDate('2027-01-01', -1)).toBe('2026-12-31')
    expect(shiftDate('2028-02-28', 1)).toBe('2028-02-29') // leap year
  })

  it('formats minutes', () => {
    expect(formatMinutes(45)).toBe('45m')
    expect(formatMinutes(65)).toBe('1h 05m')
  })
})
