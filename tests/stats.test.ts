import { describe, expect, test } from 'claude-code/testing'

import {
  INITIAL_STATS,
  expireCurrent,
  normalizeStats,
  recordBlocked,
  recordRun,
  recordSourceEdit,
  recordTestTouch,
  resetStats,
  togglePause,
} from '../hooks/stats'

const T0 = 1_000_000
const MODULE = 'utils/formatDuration'
const TEST_PATH = 'C:/w/tests/utils/formatDuration.test.ts'
const touch = (s = INITIAL_STATS, at = T0) => recordTestTouch(s, { module: MODULE, testPath: TEST_PATH }, at)

describe('phases', () => {
  test('touching a test means WRITING, not RED, and starts the cycle clock', () => {
    const s = touch()
    expect(s.phase).toBe('writing')
    expect(s.cycleStartMs).toBe(T0)
    expect(s.current).toEqual({ module: MODULE, testPath: TEST_PATH })
    expect(s.unlocked).toEqual({ [MODULE]: TEST_PATH })
  })

  test('a failing run is RED and marks the cycle as having seen red', () => {
    const s = recordRun(touch(), false, T0 + 5_000)
    expect(s.phase).toBe('red')
    expect(s.sawRed).toBe(true)
    expect(s.cycleStartMs).toBe(T0)
  })

  test('a failing run with no cycle open starts one at that run', () => {
    expect(recordRun(INITIAL_STATS, false, T0).cycleStartMs).toBe(T0)
  })

  test('touch → fail → pass completes one cycle timed from the touch', () => {
    const s = recordRun(recordRun(touch(), false, T0 + 5_000), true, T0 + 40_000)
    expect(s.phase).toBe('green')
    expect(s.cycles).toBe(1)
    expect(s.cycleMsTotal).toBe(40_000)
    expect(s.neverSawRed).toBe(0)
    expect(s.cycleStartMs).toBeNull()
  })

  test('touch → pass completes a cycle but flags that it never saw red', () => {
    const s = recordRun(touch(), true, T0 + 10_000)
    expect(s.cycles).toBe(1)
    expect(s.neverSawRed).toBe(1)
  })

  test('a pass with no open cycle is not a cycle', () => {
    const s = recordRun(INITIAL_STATS, true, T0)
    expect(s.cycles).toBe(0)
    expect(s.passes).toBe(1)
  })

  test('touching more tests mid-cycle keeps the original cycle start', () => {
    expect(touch(touch(), T0 + 9_000).cycleStartMs).toBe(T0)
  })

  test('history keeps only the last 10 runs, oldest first', () => {
    let s = INITIAL_STATS
    for (let i = 0; i < 12; i++) {
      s = recordRun(s, i % 2 === 0, T0 + i)
    }
    expect(s.history).toHaveLength(10)
    expect(s.history[0]).toBe('pass')
    expect(s.history[9]).toBe('fail')
  })
})

describe('edits', () => {
  test('a guarded source edit counts as test-first and follows the module', () => {
    const s = recordSourceEdit(touch(), MODULE, true, T0 + 1)
    expect(s.testFirst).toBe(1)
    expect(s.current?.module).toBe(MODULE)
  })

  test('an unguarded edit is counted separately', () => {
    const s = recordSourceEdit(INITIAL_STATS, 'App', false, T0)
    expect(s.unguarded).toBe(1)
    expect(s.testFirst).toBe(0)
  })

  test('edits while paused count as neither', () => {
    const s = recordSourceEdit(togglePause(INITIAL_STATS, T0), 'App', false, T0)
    expect(s.unguarded).toBe(0)
    expect(s.testFirst).toBe(0)
  })

  test('blocked attempts are counted', () => {
    expect(recordBlocked(INITIAL_STATS, 'App', T0).blocked).toBe(1)
  })
})

describe('normalizeStats', () => {
  test('fills fields missing from state saved by an older version', () => {
    const v2 = { phase: 'red', paused: true, passes: 3, fails: 1, history: ['pass'], touchedTests: ['utils/a'] }
    const s = normalizeStats(v2)
    expect(s.paused).toBe(true)
    expect(s.passes).toBe(3)
    expect(s.events).toEqual([])
    expect(s.unlocked).toEqual({})
    expect(s.unguarded).toBe(0)
    expect(s.cycleStartMs).toBeNull()
  })

  test('maps a phase it does not know to idle', () => {
    expect(normalizeStats({ phase: 'mystery' }).phase).toBe('idle')
  })

  test('returns the initial stats for anything that is not an object', () => {
    expect(normalizeStats(undefined)).toEqual(INITIAL_STATS)
    expect(normalizeStats('garbage')).toEqual(INITIAL_STATS)
  })
})

describe('event log and housekeeping', () => {
  test('records each event with its time and keeps only the last 50', () => {
    let s = INITIAL_STATS
    for (let i = 0; i < 55; i++) {
      s = recordBlocked(s, `m${i}`, T0 + i)
    }
    expect(s.events).toHaveLength(50)
    expect(s.events[0]).toEqual({ atMs: T0 + 5, kind: 'blocked', module: 'm5' })
    expect(s.events[49]).toEqual({ atMs: T0 + 54, kind: 'blocked', module: 'm54' })
  })

  test('pause and resume are logged events', () => {
    const s = togglePause(togglePause(INITIAL_STATS, T0), T0 + 1)
    expect(s.events.map(e => e.kind)).toEqual(['paused', 'resumed'])
    expect(s.paused).toBe(false)
  })

  test('the current module clears after GREEN plus 15 idle minutes', () => {
    const green = recordRun(touch(), true, T0 + 1_000)
    expect(expireCurrent(green, T0 + 1_000 + 14 * 60_000).current).not.toBeNull()
    expect(expireCurrent(green, T0 + 1_000 + 15 * 60_000).current).toBeNull()
  })

  test('the current module never expires while RED or WRITING', () => {
    expect(expireCurrent(touch(), T0 + 60 * 60_000).current).not.toBeNull()
  })

  test('reset zeroes counts but keeps pause, unlocked modules and the current test', () => {
    const s = resetStats(recordBlocked(togglePause(recordRun(touch(), true, T0 + 1), T0 + 2), 'App', T0 + 3))
    expect(s.cycles).toBe(0)
    expect(s.blocked).toBe(0)
    expect(s.events).toEqual([])
    expect(s.phase).toBe('idle')
    expect(s.paused).toBe(true)
    expect(s.unlocked).toEqual({ [MODULE]: TEST_PATH })
    expect(s.current?.module).toBe(MODULE)
  })
})

describe('proving a pin later', () => {
  test('a module that went green first, then sees red with its test untouched, is no longer counted as never saw red', () => {
    const at = (seconds: number) => 1_700_000_000_000 + seconds * 1_000
    const touched = recordTestTouch(INITIAL_STATS, { module: 'text/wrapLines', testPath: 'tests/text/wrapLines.test.ts' }, at(0))
    const pinned = recordRun(touched, true, at(1))
    const broken = recordSourceEdit(pinned, 'text/wrapLines', true, at(2))
    const red = recordRun(broken, false, at(3))
    const restored = recordRun(recordSourceEdit(red, 'text/wrapLines', true, at(4)), true, at(5))

    expect(pinned.neverSawRed).toBe(1)
    expect(red.neverSawRed).toBe(0)
    expect(restored.neverSawRed).toBe(0)
    expect(restored.cycles).toBe(2)
  })
})

describe('corrupted stored state', () => {
  test('drops events and run outcomes that are not well formed instead of crashing later', () => {
    const s = normalizeStats({ events: [{ atMs: 1, kind: 'pass' }, { bogus: true }, null], history: ['pass', 'maybe'] })

    expect(s.events).toEqual([{ atMs: 1, kind: 'pass' }])
    expect(s.history).toEqual(['pass'])
  })
})
