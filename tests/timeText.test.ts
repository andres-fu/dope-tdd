import { describe, expect, test } from 'claude-code/testing'

import { formatAgo, formatSpan } from '../hooks/timeText'

describe('time text', () => {
  test('formatAgo reads as a short relative time', () => {
    expect(formatAgo(20_000)).toBe('JUST NOW')
    expect(formatAgo(2 * 60_000)).toBe('2MIN AGO')
    expect(formatAgo(3 * 3_600_000)).toBe('3H AGO')
    expect(formatAgo(2 * 86_400_000)).toBe('2D AGO')
  })

  test('formatAgo treats a future time (clock skew) as just now', () => {
    expect(formatAgo(-5_000)).toBe('JUST NOW')
  })

  test('formatSpan reads as a compact duration', () => {
    expect(formatSpan(45_000)).toBe('45S')
    expect(formatSpan(3 * 60_000)).toBe('3M')
    expect(formatSpan(130_000)).toBe('2M10S')
    expect(formatSpan(65 * 60_000)).toBe('1H05M')
  })
})
