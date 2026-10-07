import { describe, expect, test } from 'claude-code/testing'

import { changedPaths, parseNumstat } from '../hooks/gitChanges'

describe('parseNumstat', () => {
  test('keys each changed path by its add/delete counts', () => {
    expect(parseNumstat('3\t1\tsrc/App.tsx\n10\t0\tsrc/utils/a.ts\n')).toEqual({
      'src/App.tsx': '3/1',
      'src/utils/a.ts': '10/0',
    })
  })

  test('is empty for empty output and tolerates CRLF', () => {
    expect(parseNumstat('')).toEqual({})
    expect(parseNumstat('1\t1\tsrc/App.tsx\r\n')).toEqual({ 'src/App.tsx': '1/1' })
  })
})

describe('changedPaths', () => {
  test('lists paths whose signature differs, appeared, or disappeared', () => {
    const before = { 'src/a.ts': '1/0', 'src/b.ts': '2/2', 'src/gone.ts': '5/0' }
    const after = { 'src/a.ts': '1/0', 'src/b.ts': '3/2', 'src/new.ts': 'untracked:9' }
    expect(changedPaths(before, after).sort()).toEqual(['src/b.ts', 'src/gone.ts', 'src/new.ts'])
  })

  test('is empty when nothing changed', () => {
    expect(changedPaths({ 'src/a.ts': '1/0' }, { 'src/a.ts': '1/0' })).toEqual([])
  })
})
