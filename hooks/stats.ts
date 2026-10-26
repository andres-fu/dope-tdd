import type { BeforeState, CatchOutcome, CurrentTest, CycleChange, EventKind, LastRun, ModuleState, TddEvent, TddStats } from '../types'
import type { WorkaroundKind } from './workarounds.ts'
import { pathKey } from './mirror.ts'

const EVENT_LOG_LENGTH = 50
const CURRENT_EXPIRY_MS = 15 * 60_000
/**
 * Longer than the longest check: a baseline and a run of up to a minute each, each run twice by the node --test retry,
 * plus the restore. A lock older than this is a crash, not a check (verified review A9: two minutes could expire while
 * a file was still reverted, once the lock covered the baseline too).
 */
export const CHECK_LOCK_TTL_MS = 5 * 60_000

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
  cycles: 0,
  cycleMsTotal: 0,
  cycleStartMs: null,
  sawRed: false,
  redElsewhere: [],
  testChangedAfterRed: false,
  neverSawRed: 0,
  guardFailures: 0,
  pinBroken: false,
  testChanged: 0,
  pinning: false,
  pinsCorrected: 0,
  workarounds: 0,
  workaroundsBy: {},
  modules: {},
  unproven: [],
  testFirst: 0,
  unguarded: 0,
  blocked: 0,
  unlocked: {},
  importers: {},
  inherited: {},
  stale: {},
  reminded: [],
  changes: {},
  checking: null,
  caught: 0,
  proven: 0,
  missed: 0,
  unverified: 0,
  refactors: 0,
  checkMsTotal: 0,
  worktreeChecks: 0,
  runTimes: [],
  sameRed: null,
  stuck: [],
  spikes: [],
  unwatched: [],
  lastCatch: null,
  lastCycle: null,
  current: null,
  events: [],
  lastEventMs: null,
  lastRun: null,
}

const PHASES: readonly TddStats['phase'][] = ['idle', 'writing', 'red', 'green']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLastRun(value: unknown): boolean {
  if (value === null) {
    return true
  }
  const run = value as Partial<LastRun> | undefined
  return (
    typeof run === 'object' &&
    (run.module === null || typeof run.module === 'string') &&
    ['pass', 'fail', 'elsewhere', 'unread'].includes(run.outcome ?? '') &&
    isStringList(run.files) &&
    typeof run.atMs === 'number'
  )
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
    // `history` (the old band's trail of symbols) is no longer kept (2026-10-18): a record that has it parses, without it.
    cycles: pick('cycles', isNumber),
    cycleMsTotal: pick('cycleMsTotal', isNumber),
    cycleStartMs: pick('cycleStartMs', isNumberOrNull),
    sawRed: pick('sawRed', isBoolean),
    redElsewhere: strings(pick('redElsewhere', isStringList)),
    testChangedAfterRed: pick('testChangedAfterRed', isBoolean),
    neverSawRed: pick('neverSawRed', isNumber),
    guardFailures: pick('guardFailures', isNumber),
    pinBroken: pick('pinBroken', isBoolean),
    testChanged: pick('testChanged', isNumber),
    pinning: pick('pinning', isBoolean),
    pinsCorrected: pick('pinsCorrected', isNumber),
    workarounds: pick('workarounds', isNumber),
    workaroundsBy: pick('workaroundsBy', isRecord),
    modules: pick('modules', isRecord),
    unproven: strings(pick('unproven', isStringList)),
    testFirst: pick('testFirst', isNumber),
    unguarded: pick('unguarded', isNumber),
    blocked: pick('blocked', isNumber),
    unlocked: pick('unlocked', isRecord),
    // Each module's importers a list of paths, or none: a bad value must never reach the catch check.
    importers: pick('importers', v => isRecord(v) && Object.values(v).every(list => Array.isArray(list) && list.every(path => typeof path === 'string'))),
    inherited: pick('inherited', isRecord),
    stale: pick('stale', isRecord),
    reminded: strings(pick('reminded', isStringList)),
    changes: pick('changes', isRecord),
    // An older version stored a boolean here; a stuck `true` from a crash is exactly what must not survive.
    checking: pick('checking', v => v === null || (isRecord(v) && typeof v.module === 'string' && typeof v.sinceMs === 'number')),
    caught: pick('caught', isNumber),
    proven: pick('proven', isNumber),
    missed: pick('missed', isNumber),
    unverified: pick('unverified', isNumber),
    refactors: pick('refactors', isNumber),
    checkMsTotal: pick('checkMsTotal', isNumber),
    worktreeChecks: pick('worktreeChecks', isNumber),
    runTimes: pick('runTimes', v => Array.isArray(v) && v.every(row => isRecord(row) && typeof row.tookMs === 'number')),
    sameRed: pick('sameRed', v => v === null || (isRecord(v) && typeof v.module === 'string' && typeof v.failure === 'string' && typeof v.runs === 'number')),
    stuck: pick('stuck', v => Array.isArray(v) && v.every(row => isRecord(row) && typeof row.runs === 'number')),
    spikes: pick('spikes', v => Array.isArray(v) && v.every(row => isRecord(row) && typeof row.atMs === 'number' && typeof row.question === 'string')),
    unwatched: strings(pick('unwatched', isStringList)),
    lastCatch: pick('lastCatch', v => v === null || isRecord(v)),
    lastCycle: pick('lastCycle', v => v === null || (isRecord(v) && typeof v.module === 'string')),
    current: pick('current', v => v === null || (isRecord(v) && typeof v.module === 'string' && typeof v.testPath === 'string')),
    events: pick('events', Array.isArray).filter(
      (event): event is TddEvent => isRecord(event) && typeof event.atMs === 'number' && typeof event.kind === 'string',
    ),
    lastEventMs: pick('lastEventMs', isNumberOrNull),
    lastRun: pick('lastRun', isLastRun),
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

/** `makeCurrent` false: the module unlocks, but no cycle opens and the band stays on the current module (imports.ts). */
export function recordTestTouch(s: TddStats, touched: CurrentTest, nowMs: number, makeCurrent = true): TddStats {
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
    current: makeCurrent ? touched : s.current,
    unlocked: { ...s.unlocked, [touched.module]: touched.testPath },
    unproven: s.unproven.filter(module => module !== touched.module),
    inherited: without(s.inherited, touched.module),
    stale: without(s.stale, touched.module),
    reminded: s.reminded.filter(module => module !== touched.module),
  }
  if (!makeCurrent) {
    // A test that does not lead tests no source of its own (tests/kitRuns.test.tsx): its cycle could never close, and
    // it sat in /tdd as "also open: kitRuns (writing)" (2026-10-18). It unlocks and is logged; nothing opens.
    return logged(base, 'touched', nowMs, touched.module)
  }
  return logged(mirrored(withModule(base, touched.module, state), state), 'touched', nowMs, touched.module)
}

/**
 * `elsewhere` names the test files that failed when none of them was the current
 * module's own test: the suite is red, the module is not. Its phase does not move.
 */
/** `errorsOnly`: the red never reached an assertion (an import, a collection, a compile), so it proves no pin. */
/** Identical reds in a row on one module that count as stuck (idea 16): trying things with no traction. */
export const STUCK_RUNS = 3
const STUCK_KEPT = 50

/**
 * The same failure on one module, run after run (idea 16). `failure` is what the run failed with (a message, or the
 * failing tests' names); null when the output says neither, and then the count is left alone. A green, another failure
 * or another module starts over. From STUCK_RUNS in a row the spell is a row in `stuck`, updated while it lasts.
 */
export function recordSameRed(s: TddStats, module: string, outcome: 'pass' | 'fail', failure: string | null, atMs: number): TddStats {
  if (outcome === 'pass') {
    return s.sameRed === null ? s : { ...s, sameRed: null }
  }
  if (failure === null) {
    return s
  }
  const prev = s.sameRed
  const runs = prev !== null && prev.module === module && prev.failure === failure ? prev.runs + 1 : 1
  const sameRed = { module, failure, runs }
  if (runs < STUCK_RUNS) {
    return { ...s, sameRed }
  }
  const spell = { atMs, module, failure, runs }
  const stuck = runs === STUCK_RUNS ? [...s.stuck, spell].slice(-STUCK_KEPT) : [...s.stuck.slice(0, -1), { ...(s.stuck.at(-1) ?? spell), runs }]
  return { ...s, sameRed, stuck }
}

const RUN_TIMES_KEPT = 200

/**
 * How long the run recorded at `atMs` took (idea 17): set on that record only, so a later run never inherits it, and
 * kept as a row in `runTimes` for the session record, where a dashboard can read it (running tab, observability).
 */
export function recordRunTime(s: TddStats, atMs: number, tookMs: number): TddStats {
  const last = s.lastRun
  if (last === null || last.atMs !== atMs) {
    return s
  }
  const outcome: 'pass' | 'fail' = last.outcome === 'pass' ? 'pass' : 'fail'
  const row = { atMs, module: last.module, outcome, tookMs }
  return { ...s, lastRun: { ...last, tookMs }, runTimes: [...s.runTimes, row].slice(-RUN_TIMES_KEPT) }
}

export function recordRun(s: TddStats, passed: boolean, nowMs: number, elsewhere: readonly string[] = [], options: { errorsOnly?: boolean } = {}): TddStats {
  const red = !passed && elsewhere.length > 0 ? 'elsewhere' : passed ? 'pass' : 'fail'
  const lastRun: LastRun = { module: s.current?.module ?? null, outcome: red, files: red === 'elsewhere' ? [...elsewhere] : [], atMs: nowMs }
  return { ...runOutcome(s, passed, nowMs, elsewhere, options.errorsOnly === true), lastRun }
}

function runOutcome(s: TddStats, passed: boolean, nowMs: number, elsewhere: readonly string[], errorsOnly: boolean): TddStats {
  if (!passed && elsewhere.length > 0) {
    return logged(
      { ...s, fails: s.fails + 1, redElsewhere: elsewhere },
      'elsewhere',
      nowMs,
      s.current?.module,
      elsewhere.join(', '),
    )
  }

  const module = s.current?.module
  const prev = module === undefined ? null : moduleState(s, module)

  if (!passed) {
    // A test that broke before checking anything (a flaky import, a missing package) has not shown it can fail on the code.
    const provesPin = module !== undefined && s.unproven.includes(module) && !errorsOnly
    const base: TddStats = {
      ...s,
      phase: 'red',
      fails: s.fails + 1,
      cycleStartMs: s.cycleStartMs ?? nowMs,
      sawRed: true,
      redElsewhere: [],
      neverSawRed: provesPin ? s.neverSawRed - 1 : s.neverSawRed,
      pinBroken: provesPin || s.pinBroken,
      unproven: provesPin ? s.unproven.filter(entry => entry !== module) : s.unproven,
    }
    if (module === undefined || prev === null) {
      return logged(base, 'fail', nowMs, module)
    }
    const state: ModuleState = { ...prev, phase: 'red', cycleStartMs: prev.cycleStartMs ?? nowMs, sawRed: true, everSawRed: true, editedSinceRun: false, redErrorsOnly: errorsOnly }
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
    cycleStartMs: null,
    sawRed: false,
    redElsewhere: [],
    testChangedAfterRed: false,
    cycles: completesCycle ? s.cycles + 1 : s.cycles,
    cycleMsTotal: completesCycle ? s.cycleMsTotal + (nowMs - (cycleStart ?? nowMs)) : s.cycleMsTotal,
    neverSawRed: greenFirst ? s.neverSawRed + 1 : s.neverSawRed,
    pinBroken: false,
    unproven: greenFirst && module !== undefined ? [...s.unproven, module] : s.unproven,
    lastCycle: completesCycle && module !== undefined ? { module, sawRed, testChanged: false } : s.lastCycle,
  }
  if (module === undefined || prev === null) {
    return logged(base, 'pass', nowMs, module)
  }
  const state: ModuleState = { ...prev, phase: 'green', cycleStartMs: null, sawRed: false, testTouchedAfterRed: false, editedSinceRun: false, redFailures: [] }
  return logged(withModule(base, module, state), 'pass', nowMs, module)
}

/**
 * A green of another module's own test that says nothing about the current one: that module is not unlocked, so the
 * band cannot follow it, and the test does not import the current module. A pass in the totals, logged for the module
 * whose test ran; the current module's cycle stays as it was, so the run neither closes it nor checks it.
 */
/** `module` null: a green of files outside the layout, which belongs to no module (runPlan.ts, 2026-10-18). */
export function recordOtherPass(s: TddStats, module: string | null, nowMs: number): TddStats {
  return logged({ ...s, passes: s.passes + 1, lastRun: { module, outcome: 'pass', files: [], atMs: nowMs } }, 'pass', nowMs, module ?? undefined)
}

/**
 * A problem found in another project and reported to its owner, never fixed from here (#89: an agent changes only what
 * it owns). Only logged, with what was reported, so the session log and /tdd show it was raised.
 */
export function recordReportedElsewhere(s: TddStats, detail: string, nowMs: number): TddStats {
  return logged(s, 'reported-elsewhere', nowMs, undefined, detail)
}

const MAX_UNWATCHED = 20

/**
 * A code file edited that the layout pairs with no test: dope-tdd cannot guard it. Remembered once, newest last, so the
 * band can say it is not watching instead of showing calm zeros (2026-10-18, when it was blind to its own repository).
 */
export function recordUnwatchedEdit(s: TddStats, path: string): TddStats {
  return { ...s, unwatched: [...s.unwatched.filter(entry => entry !== path), path].slice(-MAX_UNWATCHED) }
}

/** A test run whose result could not be read: no summary line in the output. Counted as nothing but the fact. */
export function recordUnreadRun(s: TddStats, nowMs: number): TddStats {
  // An unread run is the last run too: the band never names an older run in its place (2026-10-18).
  const lastRun: LastRun = { module: s.current?.module ?? null, outcome: 'unread', files: [], atMs: nowMs }
  return logged({ ...s, unreadRuns: s.unreadRuns + 1, lastRun }, 'unread', nowMs, s.current?.module)
}

function countWorkaround(s: TddStats, kind: WorkaroundKind): TddStats {
  return { ...s, workarounds: s.workarounds + 1, workaroundsBy: { ...s.workaroundsBy, [kind]: (s.workaroundsBy[kind] ?? 0) + 1 } }
}

/**
 * Green reached after red with the test edited and the code untouched: the green came from the test. With the pin skill
 * in use this session it is a pin correction (VibeCast field test, 2026-10-18): on the record alone it looks exactly
 * like a test bent to match a bug, so only the skill tells them apart. Not a workaround, but still owed a break.
 */
export function recordTestChanged(s: TddStats, module: string, nowMs: number): TddStats {
  if (s.pinning) {
    const lastCycle = s.lastCycle?.module === module ? { ...s.lastCycle, testChanged: true, pinCorrected: true } : s.lastCycle
    return logged({ ...s, pinsCorrected: s.pinsCorrected + 1, lastCycle }, 'pin-corrected', nowMs, module)
  }
  const lastCycle = s.lastCycle?.module === module ? { ...s.lastCycle, testChanged: true } : s.lastCycle
  return logged(countWorkaround({ ...s, testChanged: s.testChanged + 1, lastCycle }, 'test-changed'), 'test-changed', nowMs, module)
}

/** The pin skill ran (`/dope-tdd:pin`, typed or called by the agent): logged once, and kept for the session. */
export function recordPinSkill(s: TddStats, nowMs: number): TddStats {
  return s.pinning ? s : logged({ ...s, pinning: true }, 'pinning', nowMs)
}

const SPIKES_KEPT = 50

/** A spike started (idea 19): its own row and event, never a workaround, since nothing written in the spike is kept. */
export function recordSpike(s: TddStats, question: string, nowMs: number): TddStats {
  return logged({ ...s, spikes: [...s.spikes, { atMs: nowMs, question }].slice(-SPIKES_KEPT) }, 'spike', nowMs, undefined, question)
}

/** A config edit is always logged; only one that loosens the guard counts as a workaround. */
/** Code a git command brought in from elsewhere (gitChanges.ts, bringsInCode): one event per module, with the command. */
export function recordGitIn(s: TddStats, modules: readonly string[], command: string, nowMs: number): TddStats {
  return modules.reduce((acc, module) => logged(acc, 'git-in', nowMs, module, command), s)
}

/** A guard that threw let a call through unguarded: counted, so the band and /tdd stop looking guarded (verified review A13). */
export function recordGuardFailure(s: TddStats, guard: string, nowMs: number): TddStats {
  return logged({ ...s, guardFailures: s.guardFailures + 1 }, 'guard-failed', nowMs, undefined, guard)
}

/** A test touched with only comments or blank lines changed: on the record, never a workaround (decided 2026-10-20). */
export function recordCommentTouch(s: TddStats, module: string, nowMs: number): TddStats {
  return logged(s, 'comment-touch', nowMs, module)
}

export function recordConfigChange(s: TddStats, detail: string, loosened: boolean, nowMs: number): TddStats {
  return logged(loosened ? countWorkaround(s, 'config') : s, 'config', nowMs, undefined, detail)
}

/** A skip/only marker added to a test, an assertion removed, or code commented out: recorded with what was seen. */
export function recordWorkaround(
  s: TddStats,
  kind: 'skipped' | 'assertion-removed' | 'commented-out' | 'hollow-touch' | 'record-edited' | 'log-edited',
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
  const unlocked = {
    ...s,
    unlocked: { ...s.unlocked, [module]: testPath },
    unproven: s.unproven.filter(entry => entry !== module),
    stale: without(s.stale, module),
  }
  return makeCurrent ? mirrored({ ...unlocked, current: { module, testPath } }, moduleState(s, module)) : unlocked
}

/** A test that imports this module covers it: touching that test unlocks the module, pointing at that test. */
export function recordImportUnlock(s: TddStats, module: string, testPath: string): TddStats {
  return s.unlocked[module] !== undefined ? s : { ...s, unlocked: { ...s.unlocked, [module]: testPath }, unproven: s.unproven.filter(entry => entry !== module) }
}

const MAX_IMPORTERS = 3

/** A test seen importing a module, newest first and at most three: what the catch check tries after its own test. */
export function recordImporter(s: TddStats, module: string, testPath: string): TddStats {
  const known = s.importers[module] ?? []
  // One file spelled two ways (slashes, case where the file system folds it) is one importer.
  const same = (entry: string) => pathKey(entry) === pathKey(testPath)
  if (known[0] !== undefined && same(known[0])) {
    return s
  }
  return { ...s, importers: { ...s.importers, [module]: [testPath, ...known.filter(entry => !same(entry))].slice(0, MAX_IMPORTERS) } }
}

/** A failing test that imports this module is a red for it too: its cycle saw red, so its green will say so. */
export function recordRedFor(s: TddStats, module: string, nowMs: number, errorsOnly = false): TddStats {
  const prev = moduleState(s, module)
  return withModule(s, module, { ...prev, phase: 'red', cycleStartMs: prev.cycleStartMs ?? nowMs, sawRed: true, everSawRed: true, editedSinceRun: false, redErrorsOnly: errorsOnly })
}

/**
 * A test file that passed closes the open cycle of every other module it is the test for, so none is left red behind it.
 * A null path is a green run of the whole suite: every test passed, so every open cycle closes.
 * A cycle closed this way counts as a cycle of its own if it saw red, unless its test is the current module's test: that is
 * one piece of work. One that never saw red just closes (#41): the run was not about that module, so it proves nothing
 * either way, and a cycle left open (a test touched hours ago) would count its idle hours and a never-saw-red.
 */
export function closeCyclesForTest(s: TddStats, testPath: string | null, except: string | undefined, nowMs: number): TddStats {
  const norm = pathKey
  const same = (path: string) => testPath === null || norm(path) === norm(testPath)
  const exceptTest = except === undefined ? undefined : s.unlocked[except]
  return Object.entries(s.modules).reduce((acc, [module, state]) => {
    const path = acc.unlocked[module]
    if (module === except || path === undefined || !same(path) || state.cycleStartMs === null) {
      return acc
    }
    const closed = withModule(acc, module, { ...state, phase: 'green', cycleStartMs: null, sawRed: false, testTouchedAfterRed: false })
    if (!state.sawRed || (exceptTest !== undefined && norm(exceptTest) === norm(path))) {
      return closed
    }
    const counted = { ...closed, cycles: closed.cycles + 1, cycleMsTotal: closed.cycleMsTotal + (nowMs - state.cycleStartMs) }
    // The catch check runs for the current module only: a fix here was never checked, and is said so (debt `arch2 5`).
    if (counted.changes[module]?.kind !== 'fix') {
      return counted
    }
    const unchecked = { ...counted, changes: without(counted.changes, module), unverified: counted.unverified + 1 }
    return logged(unchecked, 'unverified', nowMs, module, 'a suite green closed it; the catch check ran for the current module only')
  }, s)
}

/** The tests a red run of the module's own file named as failing, gathered over the cycle. */
export function recordRedNames(s: TddStats, module: string, names: readonly string[]): TddStats {
  const prev = moduleState(s, module)
  return withModule(s, module, { ...prev, redFailures: [...new Set([...(prev.redFailures ?? []), ...names])] })
}

/** The failures left at a green that were all failing in the red: they were there before the change. */
export function recordKnownFailures(s: TddStats, module: string, names: readonly string[]): TddStats {
  return withModule(s, module, { ...moduleState(s, module), knownFailures: [...names], redFailures: [] })
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
  // A module unlocked in this session (touched, or seen red) stays as it is: a re-seed while this session's state
  // survives must not make it wait for a run again (#54). That unlock is fresher evidence than the carried-over one.
  const pairs = Object.entries(entries).filter(([module]) => !unlockedThisSession(s, module))
  return {
    ...s,
    unlocked: { ...s.unlocked, ...Object.fromEntries(pairs.map(([module, entry]) => [module, entry.testPath])) },
    inherited: { ...s.inherited, ...Object.fromEntries(pairs.map(([module, entry]) => [module, entry.atMs])) },
  }
}

/**
 * #54: a whole-file run of the test behind a carried-over unlock, red or green, this session. That run is the evidence
 * the carry-over waited for: the test still runs, and its result is the baseline before any edit. The unlock is active.
 */
export function recordCarriedRun(s: TddStats, modules: readonly string[], nowMs: number): TddStats {
  return modules.reduce(
    (acc, module) => logged({ ...acc, inherited: without(acc.inherited, module) }, 'carried-on', nowMs, module),
    s,
  )
}

/**
 * #54: an edit refused while a carried-over unlock waits for its run. On the record, but not counted as `blocked`:
 * the test was written first, in an earlier session, so this is no test-first miss.
 */
export function recordCarryWait(s: TddStats, module: string, nowMs: number): TddStats {
  return logged(s, 'needs-run', nowMs, module)
}

/**
 * #54: carried-over unlocks whose test changed since they were stored. They do not unlock; they are kept by age so the
 * refusal can say why an edit that was allowed yesterday is refused today. A touch or a red run of the test clears it.
 */
export function recordStaleUnlocks(
  s: TddStats,
  entries: Readonly<Record<string, { testPath: string; atMs: number }>>,
  nowMs: number,
): TddStats {
  return Object.entries(entries)
    .filter(([module]) => !unlockedThisSession(s, module))
    .reduce((acc, [module, entry]) => logged({ ...acc, stale: { ...acc.stale, [module]: entry.atMs } }, 'stale-unlock', nowMs, module), s)
}

function unlockedThisSession(s: TddStats, module: string): boolean {
  return s.unlocked[module] !== undefined && s.inherited[module] === undefined
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

/** The band lets go of the current module; what it unlocked and counted stays. */
export function releaseCurrent(s: TddStats): TddStats {
  return { ...s, current: null }
}

/** Modules with an open cycle other than the current one: red or writing somewhere else. */
export function otherOpenModules(s: TddStats): { module: string; phase: ModuleState['phase'] }[] {
  return Object.entries(s.modules)
    .filter(([module, state]) => module !== s.current?.module && state.cycleStartMs !== null)
    .map(([module, state]) => ({ module, phase: state.phase }))
}

/** /tdd reset: the counts start over, but the workarounds stay and the reset itself is logged: nothing silent. */
export function resetStats(s: TddStats, nowMs: number): TddStats {
  return logged(
    {
      ...INITIAL_STATS,
      workarounds: s.workarounds,
      workaroundsBy: s.workaroundsBy,
      paused: s.paused,
      unlocked: s.unlocked,
      inherited: s.inherited,
      stale: s.stale,
      reminded: s.reminded,
      changes: s.changes,
      current: s.current,
    },
    'reset',
    nowMs,
  )
}
