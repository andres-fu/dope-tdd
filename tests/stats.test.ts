import { describe, expect, test } from 'claude-code/testing'

import {
  CHECK_LOCK_TTL_MS,
  INITIAL_STATS,
  closeCyclesForTest,
  acquireCheck,
  expireCurrent,
  releaseCurrent,
  isChecking,
  markReminded,
  normalizeStats,
  otherOpenModules,
  recordBlocked,
  recordCatch,
  recordChange,
  recordRedFor,
  recordCommentTouch,
  recordConfigChange,
  recordGuardFailure,
  recordGitIn,
  recordCarriedRun,
  recordCarryWait,
  recordImporter,
  recordStaleUnlocks,
  recordRun,
  recordRunTime,
  recordSourceEdit,
  recordTestChanged,
  recordPinSkill,
  recordTestTouch,
  recordUnreadRun,
  recordOtherPass,
  recordReportedElsewhere,
  recordUnwatchedEdit,
  recordWorkaround,
  releaseCheck,
  resetStats,
  seedUnlocks,
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

  test('a touch that is not to become current unlocks the module but leaves the band on the current one (2026-10-18)', () => {
    const before = touch()
    const s = recordTestTouch(before, { module: 'band', testPath: 'C:/w/tests/band.test.tsx' }, T0 + 5, false)
    expect(s.current).toEqual({ module: MODULE, testPath: TEST_PATH })
    expect(s.cycleStartMs).toBe(T0)
    expect(s.unlocked).toEqual({ [MODULE]: TEST_PATH, band: 'C:/w/tests/band.test.tsx' })
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
    expect(s.lastCycle).toEqual({ module: MODULE, sawRed: true, testChanged: false })
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

  // The run history fed the old band's trail of symbols; nothing has read it since band v3 (2026-10-18).
  test('runs are counted, with no history of outcomes kept', () => {
    let s = INITIAL_STATS
    for (let i = 0; i < 12; i++) {
      s = recordRun(s, i % 2 === 0, T0 + i)
    }
    expect([s.passes, s.fails]).toEqual([6, 6])
    expect('history' in s).toBe(false)
  })
})

describe('per-module cycles', () => {
  test('touching another module while one is red gives it its own cycle and leaves the red where it was', () => {
    const aRed = recordRun(touch(), false, T0 + 1)
    const bTouched = recordTestTouch(aRed, { module: 'utils/b', testPath: 'tb' }, T0 + 2)
    expect(bTouched.modules[MODULE]?.phase).toBe('red')
    expect(bTouched.modules['utils/b']?.sawRed).toBe(false)
    expect(bTouched.phase).toBe('writing')
    expect(bTouched.sawRed).toBe(false)

    const bGreen = recordRun(bTouched, true, T0 + 3)
    expect(bGreen.neverSawRed).toBe(1)
    expect(bGreen.lastCycle).toEqual({ module: 'utils/b', sawRed: false, testChanged: false })
    expect(bGreen.modules[MODULE]?.cycleStartMs).toBe(T0)
    expect(otherOpenModules(bGreen)).toEqual([{ module: MODULE, phase: 'red' }])
  })

  test('a source edit marks the module edited since its last run, and its next run clears it', () => {
    const edited = recordSourceEdit(touch(), MODULE, true, T0 + 1)
    expect(edited.modules[MODULE]?.editedSinceRun).toBe(true)
    expect(recordRun(edited, false, T0 + 2).modules[MODULE]?.editedSinceRun).toBe(false)
  })

  test('a change on a module that never saw red is a fix even when another module is green after red', () => {
    const aProven = recordRun(recordRun(touch(), false, T0 + 1), true, T0 + 2)
    const bInherited = seedUnlocks(aProven, { 'utils/b': { testPath: 'tb', atMs: 0 } })
    expect(recordChange(bInherited, 'utils/b', 'p', 'v0', 'v1').changes['utils/b']?.kind).toBe('fix')
  })
})

describe('red elsewhere', () => {
  test('a failing run whose failures are in other test files does not move the module to RED or count as its red', () => {
    const s = recordRun(touch(), false, T0 + 1, ['tests/cart/applyDiscount.test.ts'])
    expect(s.phase).toBe('writing')
    expect(s.sawRed).toBe(false)
    expect(s.fails).toBe(1)
    expect(s.redElsewhere).toEqual(['tests/cart/applyDiscount.test.ts'])
    expect(s.events.at(-1)).toEqual({ atMs: T0 + 1, kind: 'elsewhere', module: MODULE, detail: 'tests/cart/applyDiscount.test.ts' })
  })

  test('the next run on the module clears it', () => {
    const elsewhere = recordRun(touch(), false, T0 + 1, ['tests/cart/applyDiscount.test.ts'])
    expect(recordRun(elsewhere, false, T0 + 2).redElsewhere).toEqual([])
    expect(recordRun(elsewhere, true, T0 + 2).redElsewhere).toEqual([])
  })
})

describe('a test edited after red', () => {
  test('is remembered for the open cycle and forgotten when the cycle closes', () => {
    const red = recordRun(touch(), false, T0 + 1)
    const retouched = touch(red, T0 + 2)
    expect(touch(touch(), T0 + 1).testChangedAfterRed).toBe(false)
    expect(retouched.testChangedAfterRed).toBe(true)
    expect(recordRun(retouched, true, T0 + 3).testChangedAfterRed).toBe(false)
  })

  test('recordTestChanged counts it, logs it, and marks the closed cycle', () => {
    const green = recordRun(touch(recordRun(touch(), false, T0 + 1), T0 + 2), true, T0 + 3)
    const s = recordTestChanged(green, MODULE, T0 + 3)
    expect(s.testChanged).toBe(1)
    expect(s.lastCycle?.testChanged).toBe(true)
    expect(s.events.at(-1)?.kind).toBe('test-changed')
  })
})

describe('runs that could not be read', () => {
  test('are counted as unread with an event and move nothing else', () => {
    const s = recordUnreadRun(touch(), T0 + 1)
    expect(s.unreadRuns).toBe(1)
    expect(s.phase).toBe('writing')
    expect(s.passes + s.fails).toBe(0)
    expect(s.events.at(-1)?.kind).toBe('unread')
  })
})

describe('config changes', () => {
  test('are logged with what changed, and count as a workaround only when they loosen the guard', () => {
    const loosened = recordConfigChange(INITIAL_STATS, 'mode enforce → observe', true, T0)
    const tightened = recordConfigChange(loosened, 'mode observe → enforce', false, T0 + 1)
    expect(loosened.events.at(-1)).toEqual({ atMs: T0, kind: 'config', detail: 'mode enforce → observe' })
    expect(loosened.workarounds).toBe(1)
    expect(tightened.workarounds).toBe(1)
    expect(tightened.workaroundsBy).toEqual({ config: 1 })
  })
})

describe('workarounds', () => {
  test('each kind is counted in the total and by kind, with its detail on the event', () => {
    const skipped = recordWorkaround(INITIAL_STATS, 'skipped', MODULE, '+1', T0)
    const weakened = recordWorkaround(skipped, 'assertion-removed', MODULE, '2 → 1', T0 + 1)
    const commented = recordWorkaround(weakened, 'commented-out', MODULE, '3 lines', T0 + 2)
    expect(commented.workarounds).toBe(3)
    expect(commented.workaroundsBy).toEqual({ skipped: 1, 'assertion-removed': 1, 'commented-out': 1 })
    expect(commented.events.at(-1)).toEqual({ atMs: T0 + 2, kind: 'commented-out', module: MODULE, detail: '3 lines' })
  })

  test('pausing counts once; resuming does not', () => {
    const paused = togglePause(INITIAL_STATS, T0)
    const resumed = togglePause(paused, T0 + 1)
    expect(paused.workaroundsBy).toEqual({ pause: 1 })
    expect(resumed.workarounds).toBe(1)
  })

  test('a test changed after red counts too', () => {
    expect(recordTestChanged(INITIAL_STATS, MODULE, T0).workaroundsBy).toEqual({ 'test-changed': 1 })
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
    // An old record still carries `history`: it parses, and the field is dropped (2026-10-18).
    expect('history' in s).toBe(false)
    expect(s.paused).toBe(true)
    expect(s.passes).toBe(3)
    expect(s.events).toEqual([])
    expect(s.unlocked).toEqual({})
    expect(s.unguarded).toBe(0)
    expect(s.cycleStartMs).toBeNull()
    expect(s.redElsewhere).toEqual([])
    expect(s.unreadRuns).toBe(0)
  })

  test('maps a phase it does not know to idle', () => {
    expect(normalizeStats({ phase: 'mystery' }).phase).toBe('idle')
  })

  test('returns the initial stats for anything that is not an object', () => {
    expect(normalizeStats(undefined)).toEqual(INITIAL_STATS)
    expect(normalizeStats('garbage')).toEqual(INITIAL_STATS)
  })

  test('drops the boolean lock an older version stored, so a stuck check does not survive an upgrade', () => {
    expect(normalizeStats({ checking: true }).checking).toBeNull()
    expect(normalizeStats({ checking: { module: 'a', sinceMs: 1 } }).checking).toEqual({ module: 'a', sinceMs: 1 })
  })
})

describe('the catch-check lock', () => {
  test('is taken in one step and held until released', () => {
    const held = acquireCheck(INITIAL_STATS, 'utils/a', T0)
    expect(held.checking).toEqual({ module: 'utils/a', sinceMs: T0 })
    expect(isChecking(held, T0 + 1)).toBe(true)
    expect(releaseCheck(held).checking).toBeNull()
  })

  test('a second taker while it is held gets the holder back unchanged, so it knows it does not own the lock', () => {
    const held = acquireCheck(INITIAL_STATS, 'utils/a', T0)
    const contested = acquireCheck(held, 'utils/b', T0 + 1)
    expect(contested.checking).toEqual({ module: 'utils/a', sinceMs: T0 })
  })

  test('expires, so a crash or a hot reload mid-check cannot deny every edit for the rest of the session', () => {
    const held = acquireCheck(INITIAL_STATS, 'utils/a', T0)
    expect(isChecking(held, T0 + CHECK_LOCK_TTL_MS - 1)).toBe(true)
    expect(isChecking(held, T0 + CHECK_LOCK_TTL_MS)).toBe(false)
    expect(acquireCheck(held, 'utils/b', T0 + CHECK_LOCK_TTL_MS).checking).toEqual({ module: 'utils/b', sinceMs: T0 + CHECK_LOCK_TTL_MS })
  })

  // Verified review A9 (2026-10-20): the lock now covers the baseline too. Baseline and check run up to a minute each
  // (catchCheck.ts) and node --test may run each once more (#26): four minutes, plus spawns. A lock that expires sooner
  // lets another check, or a gate, take a file that is still reverted.
  test('outlasts the longest check: a baseline and a run of a minute each, each run twice', () => {
    expect(isChecking(acquireCheck(INITIAL_STATS, 'utils/a', T0), T0 + 4 * 60_000 + 30_000)).toBe(true)
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

  // Band v3 (2026-10-18): a reset is never silent, and never erases the workarounds (the engineering review).
  test('reset zeroes counts but keeps pause, unlocked modules, the current test and the workarounds, and logs itself', () => {
    const before = recordBlocked(togglePause(recordRun(touch(), true, T0 + 1), T0 + 2), 'App', T0 + 3)
    const s = resetStats(before, T0 + 4)
    expect(s.cycles).toBe(0)
    expect(s.blocked).toBe(0)
    expect(s.events).toEqual([{ atMs: T0 + 4, kind: 'reset' }])
    expect(s.workarounds).toBe(before.workarounds)
    expect(s.workaroundsBy).toEqual(before.workaroundsBy)
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
    // The red that proves the pin is remembered until the next green, which says PROVEN (Karl's Python trial, 2026-10-19).
    expect(pinned.pinBroken).toBe(false)
    expect(red.pinBroken).toBe(true)
    expect(restored.pinBroken).toBe(false)
  })

  test('a red of errors only (an import, a collection) does not prove the pin; a later red that fails an assertion does', () => {
    const at = (seconds: number) => 1_700_000_000_000 + seconds * 1_000
    const touched = recordTestTouch(INITIAL_STATS, { module: 'text/wrapLines', testPath: 'tests/text/wrapLines.test.ts' }, at(0))
    const pinned = recordRun(touched, true, at(1))
    const crashed = recordRun(pinned, false, at(2), [], { errorsOnly: true })

    expect(crashed.phase).toBe('red')
    expect(crashed.neverSawRed).toBe(1)
    expect(crashed.unproven).toContain('text/wrapLines')
    expect(crashed.pinBroken).toBe(false)
    const failed = recordRun(crashed, false, at(3))
    expect(failed.unproven).not.toContain('text/wrapLines')
    expect(failed.pinBroken).toBe(true)
    // The module remembers whether its last red was errors only, so a break put back is not proof on such a red (#132).
    expect(crashed.modules['text/wrapLines']?.redErrorsOnly).toBe(true)
    expect(failed.modules['text/wrapLines']?.redErrorsOnly).toBe(false)
    // A red through a test that imports the module carries the same flag.
    expect(recordRedFor(crashed, 'text/other', at(4), true).modules['text/other']?.redErrorsOnly).toBe(true)
    expect(recordRedFor(crashed, 'text/other', at(4)).modules['text/other']?.redErrorsOnly).toBe(false)
  })
})

describe('corrupted stored state', () => {
  test('drops events and run outcomes that are not well formed instead of crashing later', () => {
    const s = normalizeStats({ events: [{ atMs: 1, kind: 'pass' }, { bogus: true }, null], history: ['pass', 'maybe'] })

    expect(s.events).toEqual([{ atMs: 1, kind: 'pass' }])
    expect('history' in s).toBe(false)
  })
})

describe('unlocks remembered from earlier sessions', () => {
  test('seeding unlocks a module and remembers when its test was touched', () => {
    const s = seedUnlocks(INITIAL_STATS, { 'utils/a': { testPath: 'tests/utils/a.test.ts', atMs: 5 } })

    expect(s.unlocked['utils/a']).toBe('tests/utils/a.test.ts')
    expect(s.inherited['utils/a']).toBe(5)
  })

  test('a fresh touch in this session supersedes the inherited one', () => {
    const seeded = seedUnlocks(INITIAL_STATS, { 'utils/a': { testPath: 'tests/utils/a.test.ts', atMs: 5 } })
    const touched = recordTestTouch(seeded, { module: 'utils/a', testPath: 'tests/utils/a.test.ts' }, 10)

    expect(touched.inherited['utils/a']).toBeUndefined()
  })

  test('marking a module as reminded keeps the unlock and its origin, and is idempotent', () => {
    const seeded = seedUnlocks(INITIAL_STATS, { 'utils/a': { testPath: 'tests/utils/a.test.ts', atMs: 5 } })
    const reminded = markReminded(markReminded(seeded, 'utils/a'), 'utils/a')

    expect(reminded.reminded).toEqual(['utils/a'])
    expect(reminded.inherited['utils/a']).toBe(5)
    expect(reminded.unlocked['utils/a']).toBe('tests/utils/a.test.ts')
  })

  // #54: a carried-over unlock is pending until its test runs once this session; the run is what makes it active.
  test('a run of its test this session makes a carried-over unlock active: no longer inherited, still unlocked', () => {
    const seeded = seedUnlocks(INITIAL_STATS, {
      'utils/a': { testPath: 'tests/utils/a.test.ts', atMs: 5 },
      'utils/b': { testPath: 'tests/utils/b.test.ts', atMs: 5 },
    })
    const ran = recordCarriedRun(seeded, ['utils/a'], 50)

    expect(ran.inherited).toEqual({ 'utils/b': 5 })
    expect(ran.unlocked['utils/a']).toBe('tests/utils/a.test.ts')
    expect(ran.events.at(-1)).toMatchObject({ kind: 'carried-on', module: 'utils/a', atMs: 50 })
  })

  // A re-seed while this session's state survives must not re-gate a module the agent unlocked in this session:
  // that unlock is fresher evidence than anything carried over.
  test('seeding never makes a module unlocked in this session pending, or stale', () => {
    const touched = recordTestTouch(INITIAL_STATS, { module: 'utils/a', testPath: 'tests/utils/a.test.ts' }, 10)
    const seeded = seedUnlocks(touched, { 'utils/a': { testPath: 'tests/utils/a.test.ts', atMs: 5 } })
    const staled = recordStaleUnlocks(touched, { 'utils/a': { testPath: 'tests/utils/a.test.ts', atMs: 5 } }, 20)

    expect(seeded.inherited['utils/a']).toBeUndefined()
    expect(staled.stale['utils/a']).toBeUndefined()
    expect(staled.events.at(-1)?.kind).toBe('touched')
  })

  test('a refused first edit is on the record, but not as a test-first miss', () => {
    const seeded = seedUnlocks(INITIAL_STATS, { 'utils/a': { testPath: 'tests/utils/a.test.ts', atMs: 5 } })
    const waited = recordCarryWait(seeded, 'utils/a', 50)

    expect(waited.blocked).toBe(0)
    expect(waited.events.at(-1)).toMatchObject({ kind: 'needs-run', module: 'utils/a', atMs: 50 })
  })

  test('an unlock dropped because its test changed is remembered with its age, until the test is touched', () => {
    const stale = recordStaleUnlocks(INITIAL_STATS, { 'utils/a': { testPath: 'tests/utils/a.test.ts', atMs: 5 } }, 50)

    expect(stale.unlocked['utils/a']).toBeUndefined()
    expect(stale.stale['utils/a']).toBe(5)
    expect(stale.events.at(-1)).toMatchObject({ kind: 'stale-unlock', module: 'utils/a' })
    expect(recordTestTouch(stale, { module: 'utils/a', testPath: 'tests/utils/a.test.ts' }, 60).stale['utils/a']).toBeUndefined()
  })

  test('the stale list survives a reload of the stored stats, and a bad value does not', () => {
    expect(normalizeStats({ stale: { 'utils/a': 5 } }).stale).toEqual({ 'utils/a': 5 })
    expect(normalizeStats({ stale: 'nope' }).stale).toEqual({})
  })
})

describe('catch check bookkeeping', () => {
  test('recordChange keeps the first before and the latest after for a module in the open cycle', () => {
    const once = recordChange(INITIAL_STATS, 'utils/a', 'C:/w/src/utils/a.ts', 'v0', 'v1')
    const twice = recordChange(once, 'utils/a', 'C:/w/src/utils/a.ts', 'v1', 'v2')

    expect(twice.changes['utils/a']).toEqual({ path: 'C:/w/src/utils/a.ts', before: 'v0', after: 'v2', kind: 'fix' })
  })

  test('recordChange remembers why there was no before: a new file or one it could not read', () => {
    const fresh = recordChange(INITIAL_STATS, 'utils/a', 'p', null, 'v1', 'missing')
    const big = recordChange(INITIAL_STATS, 'utils/b', 'q', null, 'v1', 'unreadable')
    const later = recordChange(fresh, 'utils/a', 'p', 'v1', 'v2')

    expect(fresh.changes['utils/a']?.beforeState).toBe('missing')
    expect(big.changes['utils/b']?.beforeState).toBe('unreadable')
    expect(later.changes['utils/a']).toEqual({ path: 'p', before: null, after: 'v2', kind: 'fix', beforeState: 'missing' })
  })

  test('a change made while green on a proven module is a refactor; one on an unproven module, or after red, is a fix', () => {
    const touched = recordTestTouch(INITIAL_STATS, { module: 'utils/a', testPath: 'tests/utils/a.test.ts' }, 1)
    const greenFirst = recordRun(touched, true, 2)
    const afterRed = recordRun(recordRun(touched, false, 2), true, 3)

    expect(recordChange(greenFirst, 'utils/a', 'p', 'v0', 'v1').changes['utils/a']?.kind).toBe('fix')
    expect(recordChange(afterRed, 'utils/a', 'p', 'v0', 'v1').changes['utils/a']?.kind).toBe('refactor')
    expect(recordChange(recordRun(touched, false, 2), 'utils/a', 'p', 'v0', 'v1').changes['utils/a']?.kind).toBe('fix')
  })

  test('once a module has a fix change, later edits keep it a fix', () => {
    const red = recordRun(recordTestTouch(INITIAL_STATS, { module: 'utils/a', testPath: 't' }, 1), false, 2)
    const fixed = recordChange(red, 'utils/a', 'p', 'v0', 'v1')
    const green = recordRun(fixed, true, 3)

    expect(recordChange(green, 'utils/a', 'p', 'v1', 'v2').changes['utils/a']?.kind).toBe('fix')
  })

  test('recordCatch gives refactor credit without a check', () => {
    const credited = recordCatch(INITIAL_STATS, 'utils/a', 'refactor', 4)

    expect(credited.refactors).toBe(1)
    expect(credited.events.at(-1)?.kind).toBe('refactor')
  })

  test('recordCatch counts the outcome, logs it with the module, and clears that module\'s cycle change', () => {
    const changed = recordChange(INITIAL_STATS, 'utils/a', 'C:/w/src/utils/a.ts', 'v0', 'v1')
    const caught = recordCatch(changed, 'utils/a', { kind: 'caught' }, 5)
    const missed = recordCatch(caught, 'utils/a', { kind: 'missed' }, 6)
    const unverified = recordCatch(missed, 'utils/a', { kind: 'unverified', reason: 'timeout' }, 7)

    expect(caught.changes).toEqual({})
    expect(unverified.caught).toBe(1)
    expect(unverified.missed).toBe(1)
    expect(unverified.unverified).toBe(1)
    expect(unverified.events.slice(-3).map(e => e.kind)).toEqual(['caught', 'missed', 'unverified'])
    expect(unverified.lastCatch).toEqual({ module: 'utils/a', outcome: { kind: 'unverified', reason: 'timeout' } })
  })

  test('recordCatch leaves another module\'s pending change alone, so it is checked at its own green', () => {
    const both = recordChange(recordChange(INITIAL_STATS, 'utils/a', 'pa', 'a0', 'a1'), 'utils/b', 'pb', 'b0', 'b1')
    const checkedA = recordCatch(both, 'utils/a', { kind: 'caught' }, 5)

    expect(checkedA.changes['utils/a']).toBeUndefined()
    expect(checkedA.changes['utils/b']).toEqual({ path: 'pb', before: 'b0', after: 'b1', kind: 'fix' })
  })
})

describe('recordImporter (#25)', () => {
  test('keeps the tests seen importing a module, newest first, once each, at most three', () => {
    const one = recordImporter(INITIAL_STATS, 'io', 'test/a.test.ts')
    const two = recordImporter(one, 'io', 'test/b.test.ts')
    expect(two.importers.io).toEqual(['test/b.test.ts', 'test/a.test.ts'])
    expect(recordImporter(two, 'io', 'test/a.test.ts').importers.io).toEqual(['test/a.test.ts', 'test/b.test.ts'])
    expect(recordImporter(two, 'io', 'test/b.test.ts')).toBe(two)
    const four = ['c', 'd'].reduce((acc, name) => recordImporter(acc, 'io', `test/${name}.test.ts`), two)
    expect(four.importers.io).toEqual(['test/d.test.ts', 'test/c.test.ts', 'test/b.test.ts'])
  })

  test('an older state without importers reads as none', () => {
    const { importers: _gone, ...older } = INITIAL_STATS
    expect(normalizeStats(older).importers).toEqual({})
  })

  test('one test spelled two ways is one importer, not two of the three places (review)', () => {
    const one = recordImporter(INITIAL_STATS, 'io', 'C:/w/test/a.test.ts')
    const again = recordImporter(one, 'io', 'C:\\w\\Test\\a.test.ts')
    expect(again.importers.io).toHaveLength(1)
    const other = recordImporter(again, 'io', 'C:/w/test/b.test.ts')
    expect(recordImporter(other, 'io', 'c:/w/test/A.test.ts').importers.io).toHaveLength(2)
  })

  test('a stored importers value that is not a list of paths per module reads as none, never as a crash (review)', () => {
    expect(normalizeStats({ ...INITIAL_STATS, importers: { io: 'test/a.test.ts' } }).importers).toEqual({})
    expect(normalizeStats({ ...INITIAL_STATS, importers: { io: [1, 2] } }).importers).toEqual({})
    expect(normalizeStats({ ...INITIAL_STATS, importers: { io: ['test/a.test.ts'] } }).importers).toEqual({ io: ['test/a.test.ts'] })
  })
})

describe('closeCyclesForTest: what a run closes for other modules (#41)', () => {
  const open = (module: string, sawRed: boolean) => (acc: ReturnType<typeof recordTestTouch>) => {
    const touched = recordTestTouch(acc, { module, testPath: `C:/w/tests/${module}.test.ts` }, T0)
    return sawRed ? recordRun(touched, false, T0 + 1_000) : touched
  }

  test('a cycle that saw red is finished work: it closes and counts, with its time', () => {
    const s = open('utils/red', true)(INITIAL_STATS)
    const closed = closeCyclesForTest({ ...s, current: null }, null, undefined, T0 + 60_000)
    expect(closed.modules['utils/red']?.cycleStartMs).toBe(null)
    expect(closed.cycles).toBe(s.cycles + 1)
    expect(closed.neverSawRed).toBe(s.neverSawRed)
  })

  // Debt `arch2 5`: the catch check runs for the current module only, so a fix in another module that this green
  // closes was never checked. It is counted as not checked and logged for that module, never left silent.
  test('a red cycle closed with a fix the check did not reach counts as not checked, logged for its module', () => {
    const s = recordChange(open('utils/other', true)(INITIAL_STATS), 'utils/other', 'C:/w/src/utils/other.ts', 'a', 'b')
    const closed = closeCyclesForTest({ ...s, current: null }, null, undefined, T0 + 60_000)
    expect(closed.unverified).toBe(s.unverified + 1)
    expect(closed.changes['utils/other']).toBeUndefined()
    expect(closed.events.at(-1)).toEqual({ atMs: T0 + 60_000, kind: 'unverified', module: 'utils/other', detail: 'a suite green closed it; the catch check ran for the current module only' })
    // Without a change there is nothing to check: closing stays quiet.
    const quiet = closeCyclesForTest({ ...open('utils/red', true)(INITIAL_STATS), current: null }, null, undefined, T0 + 60_000)
    expect(quiet.unverified).toBe(0)
  })

  test('a cycle that never saw red closes without counting: the run was not about that module', () => {
    const s = open('utils/stale', false)(INITIAL_STATS)
    const closed = closeCyclesForTest({ ...s, current: null }, null, undefined, T0 + 60 * 60_000)
    expect(closed.modules['utils/stale']?.cycleStartMs).toBe(null)
    expect(closed.cycles).toBe(s.cycles)
    expect(closed.cycleMsTotal).toBe(s.cycleMsTotal)
    expect(closed.neverSawRed).toBe(s.neverSawRed)
    expect(closed.unproven).not.toContain('utils/stale')
  })
})

describe("a green of another module's test, not about the current one (seen on dope-tdd itself, 2026-10-18)", () => {
  test('counts as a pass, logged for the module whose test ran, and leaves the current cycle open', () => {
    const working = {
      ...INITIAL_STATS,
      phase: 'red' as const,
      cycleStartMs: 100,
      sawRed: true,
      unlocked: { 'utils/b': 'C:/r/tests/utils/b.test.ts' },
      current: { module: 'utils/b', testPath: 'C:/r/tests/utils/b.test.ts' },
    }
    const after = recordOtherPass(working, 'utils/x', 500)
    expect(after.passes).toBe(1)
    expect(after.events.at(-1)).toEqual({ atMs: 500, kind: 'pass', module: 'utils/x' })
    expect(after.phase).toBe('red')
    expect(after.cycleStartMs).toBe(100)
    expect(after.cycles).toBe(0)
    expect(after.current?.module).toBe('utils/b')
  })
})

describe('a problem reported in another project is on the record (#89)', () => {
  test('logged with what was reported, so the session log and /tdd show it, and nothing else changes', () => {
    const after = recordReportedElsewhere(INITIAL_STATS, 'C:/elsewhere/proj/m.ts', 700)
    expect(after.events.at(-1)).toEqual({ atMs: 700, kind: 'reported-elsewhere', detail: 'C:/elsewhere/proj/m.ts' })
    expect({ ...after, events: [], lastEventMs: null }).toEqual(INITIAL_STATS)
  })
})

describe('code edited outside the layout is remembered, so the band can say it is not watching (2026-10-18)', () => {
  test('starts empty, and an old stored record without the field reads as empty', () => {
    expect(INITIAL_STATS.unwatched).toEqual([])
    expect(normalizeStats({ ...INITIAL_STATS, unwatched: undefined }).unwatched).toEqual([])
  })

  test('each file once, newest kept, at most twenty', () => {
    const once = recordUnwatchedEdit(recordUnwatchedEdit(INITIAL_STATS, 'scripts/a.ts'), 'scripts/a.ts')
    expect(once.unwatched).toEqual(['scripts/a.ts'])
    const many = Array.from({ length: 25 }, (_, i) => `scripts/f${i}.ts`).reduce(recordUnwatchedEdit, INITIAL_STATS)
    expect(many.unwatched).toHaveLength(20)
    expect(many.unwatched[0]).toBe('scripts/f5.ts')
  })
})

describe('releaseCurrent (2026-10-18)', () => {
  test('the band lets go of the module, and nothing it unlocked or counted is lost', () => {
    const s = releaseCurrent({ ...touch(), passes: 2 })
    expect(s.current).toBeNull()
    expect(s.unlocked).toEqual({ [MODULE]: TEST_PATH })
    expect(s.passes).toBe(2)
  })
})

describe('the override record changed outside dope-tdd (2026-10-18)', () => {
  test('is a workaround, logged with the file', () => {
    const s = recordWorkaround(INITIAL_STATS, 'record-edited', '', 'dope-tdd.overrides.json', T0)
    expect(s.workarounds).toBe(1)
    expect(s.workaroundsBy['record-edited']).toBe(1)
    expect(s.events.at(-1)?.kind).toBe('record-edited')
  })
})

// The last run as a stored record (2026-10-18): the band, /tdd and the advice read one fact, not event text.
describe('lastRun, the record each run leaves', () => {
  test('none before any run, and an older saved state without it reads as none', () => {
    expect(INITIAL_STATS.lastRun).toBeNull()
    const { lastRun: _dropped, ...older } = INITIAL_STATS
    expect(normalizeStats(older).lastRun).toBeNull()
  })

  test("the current module's pass or fail", () => {
    expect(recordRun(touch(), true, T0 + 5).lastRun).toEqual({ module: MODULE, outcome: 'pass', files: [], atMs: T0 + 5 })
    expect(recordRun(touch(), false, T0 + 5).lastRun).toEqual({ module: MODULE, outcome: 'fail', files: [], atMs: T0 + 5 })
  })

  test('a red elsewhere names the files that failed', () => {
    expect(recordRun(touch(), false, T0 + 5, ['tests/other.test.ts']).lastRun).toEqual({ module: MODULE, outcome: 'elsewhere', files: ['tests/other.test.ts'], atMs: T0 + 5 })
  })

  test("another module's green", () => {
    expect(recordOtherPass(touch(), 'utils/b', T0 + 5).lastRun).toEqual({ module: 'utils/b', outcome: 'pass', files: [], atMs: T0 + 5 })
  })

  test('a green of a file outside the layout belongs to no module (2026-10-18)', () => {
    const s = recordOtherPass(touch(), null, T0 + 5)
    expect(s.lastRun).toEqual({ module: null, outcome: 'pass', files: [], atMs: T0 + 5 })
    expect(s.events.at(-1)).toEqual({ atMs: T0 + 5, kind: 'pass' })
  })

  test('a run that could not be read is the last run too', () => {
    expect(recordUnreadRun(touch(), T0 + 5).lastRun).toEqual({ module: MODULE, outcome: 'unread', files: [], atMs: T0 + 5 })
  })
})

// The five /tdd fixes (2026-10-18): `also open: kitRuns (writing)` was a cycle no edit could close.
describe('a test that does not lead opens no cycle', () => {
  test('it unlocks and is on the record, but nothing is left open', () => {
    const s = recordTestTouch(INITIAL_STATS, { module: 'kitRuns', testPath: 'C:/r/tests/kitRuns.test.tsx' }, T0, false)
    expect(s.unlocked.kitRuns).toBe('C:/r/tests/kitRuns.test.tsx')
    expect(s.events.at(-1)).toMatchObject({ kind: 'touched', module: 'kitRuns' })
    expect(otherOpenModules(s)).toEqual([])
  })
})

// Pin corrected (2026-10-18, from the VibeCast field test): fixing a pin that guessed today's behaviour wrongly looks,
// on the record alone, exactly like a test bent to match a bug. The difference is the pin skill: with it in use this
// session, the correction is said as what it is, on its own line and not as a workaround; without it, it stays
// "test changed". Either way the pin still has to be proven by a deliberate break.
describe('a pin corrected after red', () => {
  const MOD = 'utils/a'
  const red = () => recordRun(recordTestTouch(INITIAL_STATS, { module: MOD, testPath: 'C:/r/tests/utils/a.test.ts' }, T0), false, T0 + 1)

  test('with the pin skill in use, it is a pin correction: its own count and event, not a workaround', () => {
    const s = recordTestChanged(recordPinSkill(red(), T0 + 2), MOD, T0 + 3)
    expect(s.pinning).toBe(true)
    expect(s.pinsCorrected).toBe(1)
    expect(s.workarounds).toBe(0)
    expect(s.testChanged).toBe(0)
    expect(s.events.at(-1)).toMatchObject({ kind: 'pin-corrected', module: MOD })
  })

  test('without the pin skill, it is still "test changed", counted as a workaround', () => {
    const s = recordTestChanged(red(), MOD, T0 + 3)
    expect(s.pinsCorrected).toBe(0)
    expect(s.workarounds).toBe(1)
    expect(s.events.at(-1)).toMatchObject({ kind: 'test-changed' })
  })
})

describe('code brought in by git', () => {
  test('is logged per module with the command, and changes nothing else', () => {
    const s = recordGitIn(INITIAL_STATS, ['api', 'utils/a'], 'git checkout main -- api.py src/utils/a.py', 5)
    expect(s.events.map(e => [e.kind, e.module, e.detail])).toEqual([
      ['git-in', 'api', 'git checkout main -- api.py src/utils/a.py'],
      ['git-in', 'utils/a', 'git checkout main -- api.py src/utils/a.py'],
    ])
    // Only the log moves: the events and when the last one was.
    expect({ ...s, events: [], lastEventMs: null }).toEqual({ ...INITIAL_STATS, events: [], lastEventMs: null })
  })
})

// Verified review A13 (2026-10-20): every call a failed guard let through is counted and on the record.
describe('a guard that failed', () => {
  test('is counted, and logged with which guard it was', () => {
    const once = recordGuardFailure(INITIAL_STATS, 'Bash', 5)
    const twice = recordGuardFailure(once, 'Edit', 6)
    expect(INITIAL_STATS.guardFailures).toBe(0)
    expect(twice.guardFailures).toBe(2)
    expect(twice.events.map(e => [e.kind, e.detail])).toEqual([['guard-failed', 'Bash'], ['guard-failed', 'Edit']])
  })
})

// Decided 2026-10-20 (verified review A12): a comments-only touch is on the record, never counted as a workaround.
describe('a test touched with comments only', () => {
  test('is an event for the module, and no workaround', () => {
    const s = recordCommentTouch(INITIAL_STATS, 'utils/a', 5)
    expect(s.events.map(e => [e.kind, e.module])).toEqual([['comment-touch', 'utils/a']])
    expect(s.workarounds).toBe(0)
  })
})

// Idea 17 (2026-10-26): how long a one-file run took, so a loop slow enough to break orientation is seen.
describe('recordRunTime', () => {
  test('the run just recorded keeps how long it took; an older record is left alone', () => {
    const ran = recordRun(INITIAL_STATS, true, 5_000)
    expect(recordRunTime(ran, 5_000, 4_200).lastRun?.tookMs).toBe(4_200)
    expect(recordRunTime(ran, 9_000, 4_200).lastRun?.tookMs).toBeUndefined()
    expect(recordRunTime(INITIAL_STATS, 5_000, 4_200).lastRun).toBeNull()
  })

  // Kept as rows, not only words on the band, so a dashboard can query them later (running tab, observability).
  test('each timed run is a row in runTimes, oldest dropped past the cap', () => {
    const ran = recordRun({ ...INITIAL_STATS, current: { module: 'utils/a', testPath: 'tests/utils/a.test.ts' } }, false, 5_000)
    expect(recordRunTime(ran, 5_000, 4_200).runTimes).toEqual([{ atMs: 5_000, module: 'utils/a', outcome: 'fail', tookMs: 4_200 }])
    expect(recordRunTime(ran, 9_000, 4_200).runTimes).toEqual([])
    const full = { ...ran, runTimes: Array.from({ length: 200 }, (_, k) => ({ atMs: k, module: null, outcome: 'pass' as const, tookMs: 1 })) }
    const capped = recordRunTime(full, 5_000, 4_200).runTimes
    expect(capped.length).toBe(200)
    expect(capped[0]?.atMs).toBe(1)
    expect(capped[199]?.tookMs).toBe(4_200)
  })
})
