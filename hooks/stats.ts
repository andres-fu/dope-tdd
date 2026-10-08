import type { CurrentTest, EventKind, TddEvent, TddStats } from '../types'

const HISTORY_LENGTH = 10
const EVENT_LOG_LENGTH = 50
const CURRENT_EXPIRY_MS = 15 * 60_000

export const INITIAL_STATS: TddStats = {
  phase: 'idle',
  paused: false,
  passes: 0,
  fails: 0,
  history: [],
  cycles: 0,
  cycleMsTotal: 0,
  cycleStartMs: null,
  sawRed: false,
  neverSawRed: 0,
  unproven: [],
  testFirst: 0,
  unguarded: 0,
  blocked: 0,
  unlocked: {},
  inherited: {},
  reminded: [],
  current: null,
  events: [],
  lastEventMs: null,
}

const PHASES: readonly TddStats['phase'][] = ['idle', 'writing', 'red', 'green']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeStats(stored: unknown): TddStats {
  if (!isRecord(stored)) {
    return INITIAL_STATS
  }
  const merged = { ...INITIAL_STATS, ...stored } as TddStats
  const pick = <K extends keyof TddStats>(key: K, isValid: (v: unknown) => boolean): TddStats[K] =>
    isValid(merged[key]) ? merged[key] : INITIAL_STATS[key]
  const isNumber = (v: unknown) => typeof v === 'number'
  const isNumberOrNull = (v: unknown) => v === null || typeof v === 'number'

  return {
    phase: PHASES.includes(merged.phase) ? merged.phase : 'idle',
    paused: pick('paused', v => typeof v === 'boolean'),
    passes: pick('passes', isNumber),
    fails: pick('fails', isNumber),
    history: pick('history', Array.isArray).filter(outcome => outcome === 'pass' || outcome === 'fail'),
    cycles: pick('cycles', isNumber),
    cycleMsTotal: pick('cycleMsTotal', isNumber),
    cycleStartMs: pick('cycleStartMs', isNumberOrNull),
    sawRed: pick('sawRed', v => typeof v === 'boolean'),
    neverSawRed: pick('neverSawRed', isNumber),
    unproven: pick('unproven', Array.isArray).filter(module => typeof module === 'string'),
    testFirst: pick('testFirst', isNumber),
    unguarded: pick('unguarded', isNumber),
    blocked: pick('blocked', isNumber),
    unlocked: pick('unlocked', isRecord),
    inherited: pick('inherited', isRecord),
    reminded: pick('reminded', Array.isArray).filter(module => typeof module === 'string'),
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

function logged(s: TddStats, kind: EventKind, atMs: number, module?: string): TddStats {
  const event = module === undefined ? { atMs, kind } : { atMs, kind, module }
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

export function recordRun(s: TddStats, passed: boolean, nowMs: number): TddStats {
  const history = [...s.history, passed ? 'pass' : 'fail'].slice(-HISTORY_LENGTH) as TddStats['history']

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
      cycles: completesCycle ? s.cycles + 1 : s.cycles,
      cycleMsTotal: completesCycle ? s.cycleMsTotal + (nowMs - (s.cycleStartMs ?? nowMs)) : s.cycleMsTotal,
      neverSawRed: greenFirst ? s.neverSawRed + 1 : s.neverSawRed,
      unproven: greenFirst && s.current !== null ? [...s.unproven, s.current.module] : s.unproven,
    },
    'pass',
    nowMs,
    s.current?.module,
  )
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

export function togglePause(s: TddStats, nowMs: number): TddStats {
  return logged({ ...s, paused: !s.paused }, s.paused ? 'resumed' : 'paused', nowMs)
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
    current: s.current,
  }
}
