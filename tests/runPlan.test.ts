import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_CONFIG } from '../hooks/config'
import { UNNAMED_FAILURE, applyRun, failedTestPaths, failingTestFiles } from '../hooks/runPlan'
import type { RunFacts } from '../hooks/runPlan'
import { INITIAL_STATS, recordRedFor } from '../hooks/stats'
import type { TddStats } from '../types'

const ROOT = 'C:/r'
const A_TEST = `${ROOT}/tests/utils/a.test.ts`
const B_TEST = `${ROOT}/tests/utils/b.test.ts`
const C_TEST = `${ROOT}/tests/utils/c.test.ts`

const facts = (over: Partial<RunFacts>): RunFacts => ({
  outcome: 'fail',
  named: undefined,
  filtered: false,
  namedImports: [],
  failed: [],
  importsOf: {},
  ownTest: {},
  ...over,
})
const run = (s: TddStats, over: Partial<RunFacts>) => applyRun(s, facts(over), ROOT, DEFAULT_CONFIG, 1000)
const workingOn = (module: string, testPath: string): TddStats => ({
  ...INITIAL_STATS,
  unlocked: { [module]: testPath },
  current: { module, testPath },
})

describe('failedTestPaths', () => {
  test('a relative path is resolved where the runner ran, then named from the root; an absolute one is kept', () => {
    expect(failedTestPaths(ROOT, `${ROOT}/packages/app`, ['tests/x.test.ts', 'C:/r/tests/y.test.ts'])).toEqual([
      'packages/app/tests/x.test.ts',
      'tests/y.test.ts',
    ])
  })
})

describe('failingTestFiles', () => {
  test('the failed files, absolute, and the named test, once each', () => {
    expect(failingTestFiles(ROOT, DEFAULT_CONFIG, ['tests/utils/a.test.ts', 'tests/utils/b.test.ts'], A_TEST)).toEqual([A_TEST, B_TEST])
  })

  test('a named file that is not a test is left out', () => {
    expect(failingTestFiles(ROOT, DEFAULT_CONFIG, [], `${ROOT}/src/utils/a.ts`)).toEqual([])
  })
})

describe('applyRun', () => {
  test("a red of a module's own test unlocks it, makes it current, and is remembered", () => {
    const plan = run(INITIAL_STATS, { named: A_TEST })
    expect(plan.redUnlocked).toEqual(['utils/a'])
    expect(plan.remember).toEqual([{ module: 'utils/a', testPath: A_TEST }])
    expect(plan.state.unlocked['utils/a']).toBe(A_TEST)
    expect(plan.state.current?.module).toBe('utils/a')
  })

  test('a green of an unlocked module that is not current makes it current, and unlocks nothing', () => {
    const s = { ...workingOn('utils/b', B_TEST), unlocked: { 'utils/a': A_TEST, 'utils/b': B_TEST } }
    const plan = run(s, { outcome: 'pass', named: A_TEST })
    expect(plan.state.current?.module).toBe('utils/a')
    expect(plan.redUnlocked).toEqual([])
    expect(plan.remember).toEqual([])
  })

  test('a test that imports the current module keeps the band where it is', () => {
    const plan = run(workingOn('utils/b', B_TEST), { named: A_TEST, namedImports: ['utils/b'] })
    expect(plan.state.current?.module).toBe('utils/b')
    expect(plan.redUnlocked).toEqual([])
  })

  // Seen live (2026-10-19): tests/runners.test.ts imports hooks/shell, so its red read "RED on shell" and runners went unsaid.
  test("the band stays, but a test that is an open module's own is named, so its module is said too", () => {
    const s = { ...workingOn('utils/b', B_TEST), unlocked: { 'utils/a': A_TEST, 'utils/b': B_TEST } }
    const red = run(s, { named: A_TEST, namedImports: ['utils/b'], importsOf: { [A_TEST]: ['utils/a', 'utils/b'] } })
    expect(red.state.current?.module).toBe('utils/b')
    expect(red.ownTestOf).toBe('utils/a')
    expect(run(s, { outcome: 'pass', named: A_TEST, namedImports: ['utils/b'] }).ownTestOf).toBe('utils/a')
  })

  test('no module to name: its own test, a suite run, or a test of a module not open', () => {
    const s = { ...workingOn('utils/b', B_TEST), unlocked: { 'utils/a': A_TEST, 'utils/b': B_TEST } }
    expect(run(s, { named: B_TEST }).ownTestOf).toBeNull()
    expect(run(s, {}).ownTestOf).toBeNull()
    expect(run(workingOn('utils/b', B_TEST), { outcome: 'pass', named: A_TEST, namedImports: ['utils/b'] }).ownTestOf).toBeNull()
  })

  test('another failed test file unlocks its module without making it current; a red there is elsewhere', () => {
    const plan = run(workingOn('utils/b', B_TEST), { failed: ['tests/utils/c.test.ts'] })
    expect(plan.redUnlocked).toEqual(['utils/c'])
    expect(plan.remember).toEqual([{ module: 'utils/c', testPath: C_TEST }])
    expect(plan.state.current?.module).toBe('utils/b')
    expect(plan.elsewhere).toEqual(['tests/utils/c.test.ts'])
  })

  test("the current module's own test among the failures is not elsewhere", () => {
    const plan = run(workingOn('utils/b', B_TEST), { failed: ['tests/utils/b.test.ts', 'tests/utils/c.test.ts'] })
    expect(plan.elsewhere).toEqual([])
  })

  test('a failing test that imports the current module is not elsewhere either', () => {
    const plan = run(workingOn('utils/b', B_TEST), { failed: ['tests/utils/c.test.ts'], importsOf: { [C_TEST]: ['utils/b'] } })
    expect(plan.elsewhere).toEqual([])
  })

  test('a failing test unlocks a module it imports that has no test of its own, and that module saw red', () => {
    const plan = run(workingOn('utils/b', B_TEST), {
      failed: ['tests/utils/c.test.ts'],
      importsOf: { [C_TEST]: ['utils/d', 'utils/e'] },
      ownTest: { 'utils/d': false, 'utils/e': true },
    })
    expect(plan.redUnlocked).toEqual(['utils/c', 'utils/d'])
    expect(plan.remember).toEqual([
      { module: 'utils/c', testPath: C_TEST },
      { module: 'utils/d', testPath: C_TEST },
    ])
    expect(plan.state.unlocked['utils/e']).toBeUndefined()
    expect(plan.state.importers['utils/d']).toEqual([C_TEST])
    expect(plan.state.importers['utils/e']).toEqual([C_TEST])
    expect(plan.state.modules['utils/d']?.sawRed).toBe(true)
    expect(plan.state.modules['utils/e']).toBeUndefined()
  })

  test('a green records no unlocks, importers or elsewhere', () => {
    const plan = run(workingOn('utils/b', B_TEST), { outcome: 'pass', failed: ['tests/utils/c.test.ts'], importsOf: { [C_TEST]: ['utils/d'] } })
    expect(plan.redUnlocked).toEqual([])
    expect(plan.elsewhere).toEqual([])
    expect(plan.state.importers).toEqual({})
  })

  test('the run is recorded: a red elsewhere goes on the record as one', () => {
    const plan = run(workingOn('utils/b', B_TEST), { failed: ['tests/utils/c.test.ts'] })
    expect(plan.state.fails).toBe(1)
    expect(plan.state.redElsewhere).toEqual(['tests/utils/c.test.ts'])
  })

  test('a whole-file run of the test behind a carried-over unlock makes it active again (#54)', () => {
    const s = { ...INITIAL_STATS, unlocked: { 'utils/a': A_TEST }, inherited: { 'utils/a': 5 } }
    const plan = run(s, { outcome: 'pass', named: A_TEST })
    expect(plan.carriedOn).toEqual(['utils/a'])
    expect(plan.state.inherited).toEqual({})
  })

  test('a filtered run, or a suite run that names no file, does not', () => {
    const s = { ...INITIAL_STATS, unlocked: { 'utils/a': A_TEST }, inherited: { 'utils/a': 5 } }
    expect(run(s, { outcome: 'pass', named: A_TEST, filtered: true }).carriedOn).toEqual([])
    expect(run(s, { outcome: 'pass' }).carriedOn).toEqual([])
  })

  test("a green of a test file closes the open cycle of another module it is the test for", () => {
    const s = recordRedFor({ ...workingOn('utils/b', B_TEST), unlocked: { 'utils/b': B_TEST, 'utils/c': C_TEST } }, 'utils/c', 0)
    const plan = run(s, { outcome: 'pass', named: C_TEST, namedImports: ['utils/b'] })
    expect(plan.state.modules['utils/c']?.phase).toBe('green')
    expect(plan.state.cycles).toBe(1)
  })

  test("ownCycleClosed: the current module's own cycle closed, not another's (#41)", () => {
    const own = recordRedFor(workingOn('utils/b', B_TEST), 'utils/b', 0)
    expect(run(own, { outcome: 'pass', named: B_TEST }).ownCycleClosed).toBe(true)
    const other = recordRedFor({ ...workingOn('utils/b', B_TEST), unlocked: { 'utils/b': B_TEST, 'utils/c': C_TEST } }, 'utils/c', 0)
    const plan = run(other, { outcome: 'pass', named: C_TEST, namedImports: ['utils/b'] })
    expect(plan.state.cycles).toBe(1)
    expect(plan.ownCycleClosed).toBe(false)
  })

  test('a filtered green that names the file still closes its cycles', () => {
    const s = recordRedFor({ ...workingOn('utils/b', B_TEST), unlocked: { 'utils/b': B_TEST, 'utils/c': C_TEST } }, 'utils/c', 0)
    expect(run(s, { outcome: 'pass', named: C_TEST, filtered: true, namedImports: ['utils/b'] }).state.modules['utils/c']?.phase).toBe('green')
  })

  test('a whole-suite green, naming no file, closes every open cycle', () => {
    const s = recordRedFor({ ...workingOn('utils/b', B_TEST), unlocked: { 'utils/b': B_TEST, 'utils/c': C_TEST } }, 'utils/c', 0)
    expect(run(s, { outcome: 'pass' }).state.modules['utils/c']?.phase).toBe('green')
  })

  test("a green of another module's own test, not unlocked and not importing the current one, is not the current module's run", () => {
    const s = recordRedFor(workingOn('utils/b', B_TEST), 'utils/b', 0)
    const plan = run(s, { outcome: 'pass', named: C_TEST })
    expect(plan.countsForCurrent).toBe(false)
    expect(plan.state.passes).toBe(1)
    expect(plan.state.modules['utils/b']?.phase).toBe('red')
    expect(plan.state.cycles).toBe(0)
  })

  test("a green of the current module's own test, or of one that imports it, is the current module's run", () => {
    const s = recordRedFor(workingOn('utils/b', B_TEST), 'utils/b', 0)
    expect(run(s, { outcome: 'pass', named: B_TEST }).countsForCurrent).toBe(true)
    expect(run(s, { outcome: 'pass', named: C_TEST, namedImports: ['utils/b'] }).countsForCurrent).toBe(true)
    expect(run(s, { outcome: 'pass' }).countsForCurrent).toBe(true)
  })

  test('a filtered green that names no file closes nothing', () => {
    const s = recordRedFor({ ...workingOn('utils/b', B_TEST), unlocked: { 'utils/b': B_TEST, 'utils/c': C_TEST } }, 'utils/c', 0)
    expect(run(s, { outcome: 'pass', filtered: true }).state.modules['utils/c']?.phase).toBe('red')
  })
})

// Seen live (2026-10-18): a kit run whose failed files could not be read marked the current module RED. A run of the
// whole folder that names no failed file says only that something somewhere failed.
describe('a whole-folder run that does not say which files failed', () => {
  test('is a red elsewhere, not the current module’s red', () => {
    const plan = run(workingOn('utils/a', A_TEST), { outcome: 'fail', wholeFolder: true, failed: [] })
    expect(plan.state.phase).not.toBe('red')
    expect(plan.elsewhere).toEqual([UNNAMED_FAILURE])
  })

  test('a run that is not whole-folder keeps the old reading: its red is the current module’s', () => {
    expect(run(workingOn('utils/a', A_TEST), { outcome: 'fail', failed: [] }).state.phase).toBe('red')
  })

  test('a whole-folder run that does name the module’s test is its red', () => {
    expect(run(workingOn('utils/a', A_TEST), { outcome: 'fail', wholeFolder: true, failed: ['tests/utils/a.test.ts'] }).state.phase).toBe('red')
  })
})

// Seen live 2026-10-18: a run of a file outside the layout moved the current module to RED, then to GREEN with
// "saw red": a cycle it never had. Such a run is not this module's.
describe('a run of files outside the layout is not the current module\'s', () => {
  const OTHER = `${ROOT}/tools/pr-check/check.spec-node.ts`

  test('a red is red elsewhere, named by the file', () => {
    const plan = run(workingOn('utils/a', A_TEST), { outcome: 'fail', namedOther: [OTHER] })
    expect(plan.elsewhere).toEqual(['tools/pr-check/check.spec-node.ts'])
    expect(plan.state.phase).not.toBe('red')
    expect(plan.state.sawRed).toBe(false)
  })

  test('a green neither closes its cycle nor counts for it', () => {
    const red = run(workingOn('utils/a', A_TEST), { outcome: 'fail', namedOther: [OTHER] }).state
    const plan = run(red, { outcome: 'pass', namedOther: [OTHER] })
    expect(plan.countsForCurrent).toBe(false)
    expect(plan.ownCycleClosed).toBe(false)
    expect(plan.state.cycles).toBe(0)
    expect(plan.state.lastRun).toMatchObject({ module: null, outcome: 'pass' })
  })

  test('a file outside the layout that imports the current module still counts for it', () => {
    const plan = run(workingOn('utils/a', A_TEST), { outcome: 'fail', namedOther: [OTHER], namedImports: ['utils/a'] })
    expect(plan.elsewhere).toEqual([])
    expect(plan.state.phase).toBe('red')
  })
})

// A pin's first red proves it only when a test failed on an assertion (2026-10-19): one of errors only leaves it unproven.
describe('a red of errors only', () => {
  test('is red, but leaves a pin that went green first unproven', () => {
    const pinned: TddStats = { ...workingOn('utils/a', A_TEST), unproven: ['utils/a'], neverSawRed: 1 }
    const crashed = run(pinned, { outcome: 'fail', named: A_TEST, failed: ['tests/utils/a.test.ts'], errorsOnly: true })
    expect(crashed.state.phase).toBe('red')
    expect(crashed.state.unproven).toEqual(['utils/a'])
    expect(run(pinned, { outcome: 'fail', named: A_TEST, failed: ['tests/utils/a.test.ts'] }).state.unproven).toEqual([])
  })

  // #132: a module turned red by a test that imports it remembers whether that red was errors only, as its own does.
  test('a red of errors only in a test that imports another unlocked module marks that module too', () => {
    const s = { ...workingOn('utils/b', B_TEST), unlocked: { 'utils/b': B_TEST, 'utils/c': C_TEST } }
    const facts = { outcome: 'fail' as const, failed: ['tests/utils/b.test.ts'], importsOf: { [B_TEST]: ['utils/b', 'utils/c'] } }
    expect(run(s, { ...facts, errorsOnly: true }).state.modules['utils/c']?.redErrorsOnly).toBe(true)
    expect(run(s, facts).state.modules['utils/c']?.redErrorsOnly).toBe(false)
  })
})
