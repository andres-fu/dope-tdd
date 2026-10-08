import type { BeforeState, CatchOutcome, CurrentTest, EventKind, TddEvent, TddStats } from '../types'
import type { WorkaroundKind } from './workarounds'

const HISTORY_LENGTH = 10
const EVENT_LOG_LENGTH = 50
const CURRENT_EXPIRY_MS = 15 * 60_000
/** Longer than the catch check's hardest budget (a minute) plus the restore; a lock older than this is a crash, not a check. */
export const CHECK_LOCK_TTL_MS = 2 * 60_000

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
  const strings = (list: unknown[]) => list.filter((entry): entry is string => typeof entry === 'string')

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

export function recordTestTouch(s: TddStats, touched: CurrentTest, nowMs: number): TddStats {
  const isCycleOpen = s.cycleStartMs !== null
  return logged(
    {
      ...s,
      phase: s.phase === 'red' ? 'red' : 'writing',
      cycleStartMs: isCycleOpen ? s.cycleStartMs : nowMs,
      sawRed: isCycleOpen ? s.sawRed : false,
      // A test edited after this cycle's red: at green, if the code did not change, the green came from the test.
      testChangedAfterRed: isCycleOpen ? s.testChangedAfterRed || s.sawRed : false,
      current: touched,
      unlocked: { ...s.unlocked, [touched.module]: touched.testPath },
      unproven: s.unproven.filter(module => module !== touched.module),
      inherited: without(s.inherited, touched.module),
      reminded: s.reminded.filter(module => module !== touched.module),
    },
    'touched',
    nowMs,
    touched.module,
  )
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

  if (!passed) {
    const provesPin = s.current !== null && s.unproven.includes(s.current.module)
    return logged(
      {
        ...s,
        phase: 'red',
        fails: s.fails + 1,
        history,
        cycleStartMs: s.cycleStartMs ?? nowMs,
        sawRed: true,
        redElsewhere: [],
        neverSawRed: provesPin ? s.neverSawRed - 1 : s.neverSawRed,
        unproven: provesPin ? s.unproven.filter(module => module !== s.current?.module) : s.unproven,
      },
      'fail',
      nowMs,
      s.current?.module,
    )
  }

  const completesCycle = s.cycleStartMs !== null
  const greenFirst = completesCycle && !s.sawRed
  return logged(
    {
      ...s,
      phase: 'green',
      passes: s.passes + 1,
      history,
      cycleStartMs: null,
      sawRed: false,
      redElsewhere: [],
      testChangedAfterRed: false,
      cycles: completesCycle ? s.cycles + 1 : s.cycles,
      cycleMsTotal: completesCycle ? s.cycleMsTotal + (nowMs - (s.cycleStartMs ?? nowMs)) : s.cycleMsTotal,
      neverSawRed: greenFirst ? s.neverSawRed + 1 : s.neverSawRed,
      unproven: greenFirst && s.current !== null ? [...s.unproven, s.current.module] : s.unproven,
      lastCycle:
        completesCycle && s.current !== null ? { module: s.current.module, sawRed: s.sawRed, testChanged: false } : s.lastCycle,
    },
    'pass',
    nowMs,
    s.current?.module,
  )
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
  kind: 'skipped' | 'assertion-removed' | 'commented-out',
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
  const current = testPath === undefined ? s.current : { module, testPath }
  return isGuarded
    ? logged({ ...s, testFirst: s.testFirst + 1, current }, 'edited', nowMs, module)
    : logged({ ...s, unguarded: s.unguarded + 1 }, 'unguarded', nowMs, module)
}

export function recordBlocked(s: TddStats, module: string, nowMs: number): TddStats {
  return logged({ ...s, blocked: s.blocked + 1 }, 'blocked', nowMs, module)
}

export function recordRunTarget(s: TddStats, module: string): TddStats {
  const testPath = s.unlocked[module]
  return testPath === undefined ? s : { ...s, current: { module, testPath } }
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
  const kindNow = s.phase === 'green' && !s.unproven.includes(module) ? 'refactor' : 'fix'
  const kind = existing?.kind === 'fix' ? 'fix' : kindNow
  const first = existing === undefined ? { before, beforeState } : { before: existing.before, beforeState: existing.beforeState }
  const change = {
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
  const cleared = { ...s, changes: without(s.changes, module) }
  if (outcome === 'unchecked') {
    return cleared
  }
  if (outcome === 'refactor') {
    return logged({ ...cleared, refactors: s.refactors + 1, lastCatch: { module, outcome: { kind: 'refactor' } } }, 'refactor', nowMs, module)
  }
  const counted =
    outcome.kind === 'caught'
      ? { ...cleared, caught: s.caught + 1 }
      : outcome.kind === 'missed'
        ? { ...cleared, missed: s.missed + 1 }
        : { ...cleared, unverified: s.unverified + 1 }
  return logged({ ...counted, lastCatch: { module, outcome } }, outcome.kind, nowMs, module)
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
