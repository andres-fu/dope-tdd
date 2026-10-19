import { describe, expect, test } from 'claude-code/testing'

import { captureEdit, recordFileEdit, recordShellChanges, unguardedShellPaths } from '../hooks/afterWrite'
import { INITIAL_STATS, recordRun, recordTestTouch } from '../hooks/stats'

const T0 = 1_000_000
const ROOT = 'C:/r'
const TEST = `${ROOT}/tests/runPlan.test.ts`
const SOURCE = `${ROOT}/hooks/runPlan.ts`

// #59, the after-write bookkeeping (2026-10-18): what an edit or a shell command changed, recorded as plain data in
// and out, so the reducers register.tsx used to build inline are reached by a unit test and the gate's catch check.
describe('captureEdit: what an edit changed, for the catch check to undo', () => {
  test('text before and after', () => {
    expect(captureEdit({ kind: 'text', text: 'a' }, 'b')).toEqual({ before: 'a', after: 'b', state: undefined })
  })

  test('a new file: no text before, and the state says why', () => {
    expect(captureEdit({ kind: 'missing' }, 'b')).toEqual({ before: null, after: 'b', state: 'missing' })
  })

  test('a file that could not be read before is still a change, with that reason, even when it cannot be read after', () => {
    expect(captureEdit({ kind: 'unreadable' }, null)).toEqual({ before: null, after: '', state: 'unreadable' })
  })

  test('nothing read before (paused), or a readable file gone unreadable after: nothing to capture', () => {
    expect(captureEdit(undefined, 'b')).toBeNull()
    expect(captureEdit({ kind: 'text', text: 'a' }, null)).toBeNull()
  })
})

describe('recordFileEdit: an Edit or Write to source', () => {
  test('counts the edit, remembers the reminder, and keeps the change', () => {
    const s0 = recordRun(recordTestTouch(INITIAL_STATS, { module: 'runPlan', testPath: TEST }, T0), false, T0 + 1)
    const s = recordFileEdit(s0, 'runPlan', SOURCE, true, captureEdit({ kind: 'text', text: 'a' }, 'b'), T0 + 2)
    expect(s.reminded).toContain('runPlan')
    expect(s.changes.runPlan).toMatchObject({ path: SOURCE, before: 'a', after: 'b' })
    expect(s.testFirst).toBe(s0.testFirst + 1)
  })

  test('nothing captured: counted, with no change kept', () => {
    const s = recordFileEdit(INITIAL_STATS, 'runPlan', SOURCE, false, null, T0)
    expect(s.changes.runPlan).toBeUndefined()
    expect(s.unguarded).toBe(1)
  })
})

describe('recordShellChanges: what a shell command changed', () => {
  test('tests touched first, so a source edited in the same command counts as guarded', () => {
    const s = recordShellChanges(
      INITIAL_STATS,
      {
        root: ROOT,
        touchedTests: [{ path: 'tests/runPlan.test.ts', module: 'runPlan', leads: true }],
        changedSources: [{ module: 'runPlan' }],
        captured: [{ module: 'runPlan', path: SOURCE, before: { kind: 'text', text: 'a' }, after: 'b' }],
      },
      T0,
    )
    expect(s.unlocked.runPlan).toBe(TEST)
    expect(s.current?.module).toBe('runPlan')
    expect(s.testFirst).toBe(1)
    expect(s.unguarded).toBe(0)
    expect(s.changes.runPlan).toMatchObject({ before: 'a', after: 'b' })
  })

  test('a test that does not lead unlocks without taking over the band', () => {
    const s = recordShellChanges(INITIAL_STATS, { root: ROOT, touchedTests: [{ path: 'tests/band.test.tsx', module: 'band', leads: false }], changedSources: [], captured: [] }, T0)
    expect(s.unlocked.band).toBe(`${ROOT}/tests/band.test.tsx`)
    expect(s.current).toBeNull()
  })

  test('a write whose file could not be read after is left out of the changes', () => {
    const s = recordShellChanges(INITIAL_STATS, { root: ROOT, touchedTests: [], changedSources: [{ module: 'runPlan' }], captured: [{ module: 'runPlan', path: SOURCE, before: { kind: 'text', text: 'a' }, after: null }] }, T0)
    expect(s.changes.runPlan).toBeUndefined()
    expect(s.unguarded).toBe(1)
  })
})

describe('unguardedShellPaths: sources a shell command changed with no test on record', () => {
  test('the locked ones, apart from those the policy only observes', () => {
    const sources = [
      { path: 'hooks/a.ts', module: 'a' },
      { path: 'hooks/b.ts', module: 'b' },
      { path: 'scratch/c.ts', module: 'c' },
    ]
    const policy = (path: string) => (path.startsWith('scratch/') ? 'observe' : 'enforce')
    expect(unguardedShellPaths(sources, { b: TEST }, policy)).toEqual(['hooks/a.ts'])
  })
})
