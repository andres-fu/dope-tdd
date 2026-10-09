import { describe, expect, test } from 'claude-code/testing'

import { changedLines } from '../hooks/changedLines'

describe('changedLines', () => {
  test('the removed lines, then the added ones, trimmed, blanks left out', () => {
    const before = 'export function add(a, b) {\n  return a - b\n}\n'
    const after = 'export function add(a, b) {\n  return a + b\n}\n\n'
    expect(changedLines(before, after)).toEqual(['- return a - b', '+ return a + b'])
  })

  test('a line that only moved is not reported, a duplicated line is', () => {
    expect(changedLines('a\nb\nc', 'c\na\nb')).toEqual([])
    expect(changedLines('a\nb', 'a\nb\nb')).toEqual(['+ b'])
  })

  test('at most six lines, each clipped to a readable width', () => {
    const after = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n')
    expect(changedLines('', after)).toHaveLength(6)
    expect(changedLines('', 'x'.repeat(300))[0]?.length).toBeLessThan(130)
  })
})
