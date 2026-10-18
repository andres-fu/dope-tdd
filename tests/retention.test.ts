import { describe, expect, test } from 'claude-code/testing'

import { isExpired, keptNotice, pruneArgv, PRUNED_FOLDERS, RETENTION_MS } from '../hooks/retention'
import { journalEntry, journalFiles } from '../hooks/checkJournal'

const DAY = 24 * 60 * 60_000

describe('what dope-tdd keeps on this machine, and for how long', () => {
  test('only session logs are pruned: a kept change may be the only copy of someone\'s work', () => {
    expect(PRUNED_FOLDERS).toContain('sessions')
    expect(PRUNED_FOLDERS).not.toContain('kept')
  })

  test('no kept changes: nothing to say', () => {
    expect(keptNotice([])).toBeNull()
  })

  test('kept changes are named at the start, with where they are and that dope-tdd never deletes them', () => {
    expect(keptNotice(['throughline/src/a.ts'])).toBe(
      'dope-tdd: 1 change it could not put back is kept in ~/.dope-tdd/kept: throughline/src/a.ts. Look at it, then delete it yourself; dope-tdd never deletes these.',
    )
  })

  test('many kept changes: the first three are named, and how many more there are', () => {
    expect(keptNotice(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'])).toBe(
      'dope-tdd: 5 changes it could not put back are kept in ~/.dope-tdd/kept: a.ts, b.ts, c.ts and 2 more. Look at them, then delete them yourself; dope-tdd never deletes these.',
    )
  })

  test('session logs are dropped after 30 days, not before', () => {
    expect(RETENTION_MS).toBe(30 * DAY)
    expect(isExpired(1_000, 1_000 + 30 * DAY)).toBe(false)
    expect(isExpired(1_000, 1_001 + 30 * DAY)).toBe(true)
  })

  test('a file dated in the future (clock skew) is never expired', () => {
    expect(isExpired(5_000_000, 1_000)).toBe(false)
  })

  test('pruning is a node one-liner that takes the path as an argument, never spliced into the script', () => {
    const argv = pruneArgv('C:/Users/x/.dope-tdd/sessions/a b".json')
    expect(argv[0]).toBe('node')
    expect(argv.at(-1)).toBe('C:/Users/x/.dope-tdd/sessions/a b".json')
    expect(argv.slice(0, -1).join(' ')).not.toContain('sessions')
  })

  test('a journal carries the time it was written, and the files survive the round trip', () => {
    const entry = journalEntry([{ path: 'a.ts', before: 'a', after: 'b' }], 123)
    expect(entry).toEqual({ files: [{ path: 'a.ts', before: 'a', after: 'b' }], atMs: 123 })
    expect(journalFiles(entry)).toHaveLength(1)
  })
})
