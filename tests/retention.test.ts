import { describe, expect, test } from 'claude-code/testing'

import { isExpired, pruneArgv, RETENTION_MS } from '../hooks/retention'
import { JOURNAL_TTL_MS, journalEntry, journalFiles, staleJournal } from '../hooks/checkJournal'

const DAY = 24 * 60 * 60_000

describe('what dope-tdd keeps on this machine, and for how long', () => {
  test('session logs and kept changes are dropped after 30 days, not before', () => {
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

  test('a journal is stale after 7 days; one with no time (an earlier build) is never judged stale', () => {
    expect(JOURNAL_TTL_MS).toBe(7 * DAY)
    expect(staleJournal({ files: [], atMs: 0 }, 7 * DAY)).toBe(false)
    expect(staleJournal({ files: [], atMs: 0 }, 7 * DAY + 1)).toBe(true)
    expect(staleJournal({ files: [] }, 100 * DAY)).toBe(false)
    expect(staleJournal(undefined, 100 * DAY)).toBe(false)
  })
})
