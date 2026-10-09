import type { BeforeState, CatchOutcome, CurrentTest, CycleChange, EventKind, ModuleState, TddEvent, TddStats } from '../types'
import type { WorkaroundKind } from './workarounds'

const HISTORY_LENGTH = 10
const EVENT_LOG_LENGTH = 50
const CURRENT_EXPIRY_MS = 15 * 60_000
/** Longer than the catch check's hardest budget (a minute) plus the restore; a lock older than this is a crash, not a check. */
export const CHECK_LOCK_TTL_MS = 2 * 60_000

export const FRESH_MODULE: ModuleState = {
  phase: 'idle',
  cycleStartMs: null,
  sawRed: false,
  testTouchedAfterRed: false,
  everSawRed: false,
  editedSinceRun: false,
}

export const INITIAL_STATS: TddStats = {
  phase: 'idle',
  paused: false,
  passes: 0,
  fails: 0,
  unreadRuns: 0,
  history: [],
  cycles: 0,
  cycleMsTotal: 0,
  cycleStartMs: null,
  sawRed: false,
  redElsewhere: [],
  testChangedAfterRed: false,
  neverSawRed: 0,
  testChanged: 0,
  workarounds: 0,
  workaroundsBy: {},
  modules: {},
  unproven: [],
  testFirst: 0,
  unguarded: 0,
  blocked: 0,
  unlocked: {},
  inherited: {},
  reminded: [],
  changes: {},
  checking: null,
  caught: 0,
  proven: 0,
  missed: 0,
  unverified: 0,
  refactors: 0,
  lastCatch: null,
  lastCycle: null,
  current: null,
  events: [],
  lastEventMs: null,
}

const PHASES: readonly TddStats['phase'][] = ['idle', 'writing', 'red', 'green']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value)
}

export function normalizeStats(stored: unknown): TddStats {
  if (!isRecord(stored)) {
    return INITIAL_STATS
  }
  const merged = { ...INITIAL_STATS, ...stored } as TddStats
  const pick = <K extends keyof TddStats>(key: K, isValid: (v: unknown) => boolean): TddStats[K] =>
    isValid(merged[key]) ? merged[key] : INITIAL_STATS[key]
  const isNumber = (v: unknown) => typeof v === 'number'
  const isBoolean = (v: unknown) => typeof v === 'boolean'
  const isNumberOrNull = (v: unknown) => v === null || typeof v === 'number'
  const strings = (list: readonly unknown[]) => list.filter((entry): entry is string => typeof entry === 'string')

  return {
    phase: PHASES.includes(merged.phase) ? merged.phase : 'idle',
    paused: pick('paused', isBoolean),
    passes: pick('passes', isNumber),
    fails: pick('fails', isNumber),
    unreadRuns: pick('unreadRuns', isNumber),
    history: pick('history', Array.isArray).filter(outcome => outcome === 'pass' || outcome === 'fail'),
    cycles: pick('cycles', isNumber),
    cycleMsTotal: pick('cycleMsTotal', isNumber),
    cycleStartMs: pick('cycleStartMs', isNumberOrNull),
    sawRed: pick('sawRed', isBoolean),
    redElsewhere: strings(pick('redElsewhere', isStringList)),
    testChangedAfterRed: pick('testChangedAfterRed', isBoolean),
    neverSawRed: pick('neverSawRed', isNumber),
    testChanged: pick('testChanged', isNumber),
    workarounds: pick('workarounds', isNumber),
    workaroundsBy: pick('workaroundsBy', isRecord),
    modules: pick('modules', isRecord),
    unproven: strings(pick('unproven', isStringList)),
    testFirst: pick('testFirst', isNumber),
    unguarded: pick('unguarded', isNumber),
    blocked: pick('blocked', isNumber),
    unlocked: pick('unlocked', isRecord),
    inherited: pick('inherited', isRecord),
    reminded: strings(pick('reminded', isStringList)),
    changes: pick('changes', isRecord),
    // An older version stored a boolean here; a stuck `true` from a crash is exactly what must not survive.
    checking: pick('checking', v => v === null || (isRecord(v) && typeof v.module === 'string' && typeof v.sinceMs === 'number')),
    caught: pick('caught', isNumber),
    proven: pick('proven', isNumber),
    missed: pick('missed', isNumber),
    unverified: pick('unverified', isNumber),
    refactors: pick('refactors', isNumber),
    lastCatch: pick('lastCatch', v => v === null || isRecord(v)),
    lastCycle: pick('lastCycle', v => v === null || (isRecord(v) && typeof v.module === 'string')),
    current: pick('current', v => v === null || (isRecord(v) && typeof v.module === 'string' && typeof v.testPath === 'string')),
    events: pick('events', Array.isArray).filter(
      (event): event is TddEvent => isRecord(event) && typeof event.atMs === 'number' && typeof event.kind === 'string',
    ),
    lastEventMs: pick('lastEventMs', isNumberOrNull),
  }
}

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const { [key]: _dropped, ...rest } = record
  return rest
}

function logged(s: TddStats, kind: EventKind, atMs: number, module?: string, detail?: string): TddStats {
  const event: TddEvent = {
    atMs,
    kind,
    ...(module === undefined ? {} : { module }),
    ...(detail === undefined ? {} : { detail }),
  }
  return {
    ...s,
    events: [...s.events, event].slice(-EVENT_LOG_LENGTH),
    lastEventMs: atMs,
  }
}

export function moduleState(s: TddStats, module: string): ModuleState {
  return s.modules[module] ?? FRESH_MODULE
}

function withModule(s: TddStats, module: string, state: ModuleState): TddStats {
  return { ...s, modules: { ...s.modules, [module]: state } }
}

/** The band shows one module; the global cycle fields mirror the current one. An idle module keeps the phase as it was. */
function mirrored(s: TddStats, state: ModuleState): TddStats {
  return {
    ...s,
    phase: state.phase === 'idle' ? s.phase : state.phase,
    cycleStartMs: state.cycleStartMs,
    sawRed: state.sawRed,
    testChangedAfterRed: state.testTouchedAfterRed,
  }
}

export function recordTestTouch(s: TddStats, touched: CurrentTest, nowMs: number): TddStats {
  const prev = moduleState(s, touched.module)
  const isCycleOpen = prev.cycleStartMs !== null
  const state: ModuleState = {
    ...prev,
    phase: prev.phase === 'red' ? 'red' : 'writing',
    cycleStartMs: isCycleOpen ? prev.cycleStartMs : nowMs,
    sawRed: isCycleOpen ? prev.sawRed : false,
    // A test edited after this module's red: at green, if its code did not change, the green came from the test.
    testTouchedAfterRed: isCycleOpen ? prev.testTouchedAfterRed || prev.sawRed : false,
  }
  const base: TddStats = {
    ...s,
    current: touched,
    unlocked: { ...s.unlocked, [touched.module]: touched.testPath },
    unproven: s.unproven.filter(module => module !== touched.module),
    inherited: without(s.inherited, touched.module),
    reminded: s.reminded.filter(module => module !== touched.module),
  }
  return logged(mirrored(withModule(base, touched.module, state), state), 'touched', nowMs, touched.module)
}

/**
 * `elsewhere` names the test files that failed when none of them was the current
 * module's own test: the suite is red, the module is not. Its phase does not move.
 */
export function recordRun(s: TddStats, passed: boolean, nowMs: number, elsewhere: readonly string[] = []): TddStats {
  const history = [...s.history, passed ? 'pass' : 'fail'].slice(-HISTORY_LENGTH) as TddStats['history']

  if (!passed && elsewhere.length > 0) {
    return logged(
      { ...s, fails: s.fails + 1, history, redElsewhere: elsewhere },
      'elsewhere',
      nowMs,
      s.current?.module,
      elsewhere.join(', '),
    )
  }

  const module = s.current?.module
  const prev = module === undefined ? null : moduleState(s, module)

  if (!passed) {
    const provesPin = module !== undefined && s.unproven.includes(module)
    const base: TddStats = {
      ...s,
      phase: 'red',
      fails: s.fails + 1,
      history,
      cycleStartMs: s.cycleStartMs ?? nowMs,
      sawRed: true,
      redElsewhere: [],
      neverSawRed: provesPin ? s.neverSawRed - 1 : s.neverSawRed,
      unproven: provesPin ? s.unproven.filter(entry => entry !== module) : s.unproven,
    }
    if (module === undefined || prev === null) {
      return logged(base, 'fail', nowMs, module)
    }
    const state: ModuleState = { ...prev, phase: 'red', cycleStartMs: prev.cycleStartMs ?? nowMs, sawRed: true, everSawRed: true, editedSinceRun: false }
    return logged(mirrored(withModule(base, module, state), state), 'fail', nowMs, module)
  }

  const cycleStart = prev === null ? s.cycleStartMs : prev.cycleStartMs
  const sawRed = prev === null ? s.sawRed : prev.sawRed
  const completesCycle = cycleStart !== null
  const greenFirst = completesCycle && !sawRed
  const base: TddStats = {
    ...s,
    phase: 'green',
    passes: s.passes + 1,
    history,
    cycleStartMs: null,
    sawRed: false,
    redElsewhere: [],
    testChangedAfterRed: false,
    cycles: completesCycle ? s.cycles + 1 : s.cycles,
    cycleMsTotal: completesCycle ? s.cycleMsTotal + (nowMs - (cycleStart ?? nowMs)) : s.cycleMsTotal,
    neverSawRed: greenFirst ? s.neverSawRed + 1 : s.neverSawRed,
    unproven: greenFirst && module !== undefined ? [...s.unproven, module] : s.unproven,
    lastCycle: completesCycle && module !== undefined ? { module, sawRed, testChanged: false } : s.lastCycle,
  }
  if (module === undefined || prev === null) {
    return logged(base, 'pass', nowMs, module)
  }
  const state: ModuleState = { ...prev, phase: 'green', cycleStartMs: null, sawRed: false, testTouchedAfterRed: false, editedSinceRun: false }
  return logged(withModule(base, module, state), 'pass', nowMs, module)
}

/** A test run whose result could not be read: no summary line in the output. Counted as nothing but the fact. */
export function recordUnreadRun(s: TddStats, nowMs: number): TddStats {
  return logged({ ...s, unreadRuns: s.unreadRuns + 1 }, 'unread', nowMs, s.current?.module)
}

function countWorkaround(s: TddStats, kind: WorkaroundKind): TddStats {
  return { ...s, workarounds: s.workarounds + 1, workaroundsBy: { ...s.workaroundsBy, [kind]: (s.workaroundsBy[kind] ?? 0) + 1 } }
}

/** Green reached after red with the test edited and the code untouched: the green came from the test. */
export function recordTestChanged(s: TddStats, module: string, nowMs: number): TddStats {
  const lastCycle = s.lastCycle?.module === module ? { ...s.lastCycle, testChanged: true } : s.lastCycle
  return logged(countWorkaround({ ...s, testChanged: s.testChanged + 1, lastCycle }, 'test-changed'), 'test-changed', nowMs, module)
}

/** A config edit is always logged; only one that loosens the guard counts as a workaround. */
export function recordConfigChange(s: TddStats, detail: string, loosened: boolean, nowMs: number): TddStats {
  return logged(loosened ? countWorkaround(s, 'config') : s, 'config', nowMs, undefined, detail)
}

/** A skip/only marker added to a test, an assertion removed, or code commented out: recorded with what was seen. */
export function recordWorkaround(
  s: TddStats,
  kind: 'skipped' | 'assertion-removed' | 'commented-out' | 'hollow-touch',
  module: string,
  detail: string,
  nowMs: number,
): TddStats {
  return logged(countWorkaround(s, kind), kind, nowMs, module, detail)
}

export function recordSourceEdit(s: TddStats, module: string, isGuarded: boolean, nowMs: number): TddStats {
  if (s.paused) {
    return logged(s, 'edited', nowMs, module)
  }
  const testPath = s.unlocked[module]
  const state: ModuleState = { ...moduleState(s, module), editedSinceRun: true }
  const edited = withModule(s, module, state)
  const followed = testPath === undefined ? edited : mirrored({ ...edited, current: { module, testPath } }, state)
  return isGuarded
    ? logged({ ...followed, testFirst: s.testFirst + 1 }, 'edited', nowMs, module)
    : logged({ ...followed, unguarded: s.unguarded + 1 }, 'unguarded', nowMs, module)
}

export function recordBlocked(s: TddStats, module: string, nowMs: number): TddStats {
  return logged({ ...s, blocked: s.blocked + 1 }, 'blocked', nowMs, module)
}

/**
 * A module whose own test was seen red: that is the evidence test-first asks
 * for, so it unlocks as a touch would, and the band follows it when the run
 * named it. A fake refactor still goes red on the unchanged test next run.
 */
export function recordRedUnlock(s: TddStats, module: string, testPath: string, makeCurrent: boolean): TddStats {
  const unlocked = { ...s, unlocked: { ...s.unlocked, [module]: testPath }, unproven: s.unproven.filter(entry => entry !== module) }
  return makeCurrent ? mirrored({ ...unlocked, current: { module, testPath } }, moduleState(s, module)) : unlocked
}

/** A test that imports this module covers it: touching that test unlocks the module, pointing at that test. */
export function recordImportUnlock(s: TddStats, module: string, testPath: string): TddStats {
  return s.unlocked[module] !== undefined ? s : { ...s, unlocked: { ...s.unlocked, [module]: testPath }, unproven: s.unproven.filter(entry => entry !== module) }
}

/** A failing test that imports this module is a red for it too: its cycle saw red, so its green will say so. */
export function recordRedFor(s: TddStats, module: string, nowMs: number): TddStats {
  const prev = moduleState(s, module)
  return withModule(s, module, { ...prev, phase: 'red', cycleStartMs: prev.cycleStartMs ?? nowMs, sawRed: true, everSawRed: true, editedSinceRun: false })
}

/**
 * A test file that passed closes the open cycle of every other module it is the test for, so none is left red behind it.
 * A null path is a green run of the whole suite: every test passed, so every open cycle closes.
 * A cycle closed this way counts as a cycle of its own, unless its test is the current module's test: that is one piece of work.
 */
export function closeCyclesForTest(s: TddStats, testPath: string | null, except: string | undefined, nowMs: number): TddStats {
  const norm = (path: string) => path.replace(/\\/g, '/').toLowerCase()
  const same = (path: string) => testPath === null || norm(path) === norm(testPath)
  const exceptTest = except === undefined ? undefined : s.unlocked[except]
  return Object.entries(s.modules).reduce((acc, [module, state]) => {
    const path = acc.unlocked[module]
    if (module === except || path === undefined || !same(path) || state.cycleStartMs === null) {
      return acc
    }
    const closed = withModule(acc, module, { ...state, phase: 'green', cycleStartMs: null, sawRed: false, testTouchedAfterRed: false })
    if (exceptTest !== undefined && norm(exceptTest) === norm(path)) {
      return closed
    }
    return {
      ...closed,
      cycles: closed.cycles + 1,
      cycleMsTotal: closed.cycleMsTotal + (nowMs - state.cycleStartMs),
      neverSawRed: state.sawRed ? closed.neverSawRed : closed.neverSawRed + 1,
      unproven: state.sawRed || closed.unproven.includes(module) ? closed.unproven : [...closed.unproven, module],
    }
  }, s)
}

/** A run that named a test file: that module is current, and the band mirrors its cycle. */
export function recordRunTarget(s: TddStats, module: string): TddStats {
  const testPath = s.unlocked[module]
  return testPath === undefined ? s : mirrored({ ...s, current: { module, testPath } }, moduleState(s, module))
}

export function seedUnlocks(
  s: TddStats,
  entries: Readonly<Record<string, { testPath: string; atMs: number }>>,
): TddStats {
  const pairs = Object.entries(entries)
  return {
    ...s,
    unlocked: { ...s.unlocked, ...Object.fromEntries(pairs.map(([module, entry]) => [module, entry.testPath])) },
    inherited: { ...s.inherited, ...Object.fromEntries(pairs.map(([module, entry]) => [module, entry.atMs])) },
  }
}

export function markReminded(s: TddStats, module: string): TddStats {
  return s.reminded.includes(module) ? s : { ...s, reminded: [...s.reminded, module] }
}

export function recordChange(
  s: TddStats,
  module: string,
  path: string,
  before: string | null,
  after: string,
  beforeState?: BeforeState,
): TddStats {
  const existing = s.changes[module]
  // A refactor is a change while this module is green on a test that has failed before; anything else is a fix to be checked.
  const state = moduleState(s, module)
  const kindNow = state.phase === 'green' && state.everSawRed && !s.unproven.includes(module) ? 'refactor' : 'fix'
  const kind = existing?.kind === 'fix' ? 'fix' : kindNow
  const first = existing === undefined ? { before, beforeState } : { before: existing.before, beforeState: existing.beforeState }
  const change: CycleChange = {
    path,
    before: first.before,
    after,
    kind,
    ...(first.before === null && first.beforeState !== undefined ? { beforeState: first.beforeState } : {}),
  }
  return { ...s, changes: { ...s.changes, [module]: change } }
}

export function isChecking(s: TddStats, nowMs: number): boolean {
  return s.checking !== null && nowMs - s.checking.sinceMs < CHECK_LOCK_TTL_MS
}

/** Takes the lock in one update; the caller owns it only if the returned lock is its own module and time. */
export function acquireCheck(s: TddStats, module: string, nowMs: number): TddStats {
  return isChecking(s, nowMs) ? s : { ...s, checking: { module, sinceMs: nowMs } }
}

export function releaseCheck(s: TddStats): TddStats {
  return { ...s, checking: null }
}

/** Counts the outcome for `module` and clears only that module's pending change; other modules wait for their own green. */
export function recordCatch(s: TddStats, module: string, outcome: CatchOutcome | 'unchecked' | 'refactor', nowMs: number): TddStats {
  const path = s.changes[module]?.path
  const cleared = { ...s, changes: without(s.changes, module) }
  if (outcome === 'unchecked') {
    return cleared
  }
  if (outcome === 'refactor') {
    return logged({ ...cleared, refactors: s.refactors + 1, lastCatch: { module, outcome: { kind: 'refactor' }, path } }, 'refactor', nowMs, module)
  }
  const counted =
    outcome.kind === 'caught'
      ? { ...cleared, caught: s.caught + 1 }
      : outcome.kind === 'proven'
        ? { ...cleared, proven: s.proven + 1 }
      : outcome.kind === 'missed'
        ? { ...cleared, missed: s.missed + 1 }
        : { ...cleared, unverified: s.unverified + 1 }
  return logged({ ...counted, lastCatch: { module, outcome, path } }, outcome.kind, nowMs, module)
}

export function togglePause(s: TddStats, nowMs: number): TddStats {
  const toggled = { ...s, paused: !s.paused }
  return s.paused ? logged(toggled, 'resumed', nowMs) : logged(countWorkaround(toggled, 'pause'), 'paused', nowMs)
}

export function expireCurrent(s: TddStats, nowMs: number): TddStats {
  const isIdleGreen =
    s.phase === 'green' && s.lastEventMs !== null && nowMs - s.lastEventMs >= CURRENT_EXPIRY_MS
  return isIdleGreen && s.current !== null ? { ...s, current: null } : s
}

/** Modules with an open cycle other than the current one: red or writing somewhere else. */
export function otherOpenModules(s: TddStats): { module: string; phase: ModuleState['phase'] }[] {
  return Object.entries(s.modules)
    .filter(([module, state]) => module !== s.current?.module && state.cycleStartMs !== null)
    .map(([module, state]) => ({ module, phase: state.phase }))
}

export function resetStats(s: TddStats): TddStats {
  return {
    ...INITIAL_STATS,
    paused: s.paused,
    unlocked: s.unlocked,
    inherited: s.inherited,
    reminded: s.reminded,
    changes: s.changes,
    current: s.current,
  }
}
