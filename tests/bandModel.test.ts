import { describe, expect, test } from 'claude-code/testing'

import { bandView, catchWord, countsAsUnwatched, lastRunLine, lastRunTarget, leftOutBy } from '../hooks/bandModel'
import { DEFAULT_CONFIG, parseConfig } from '../hooks/config'
import { classifyPath } from '../hooks/mirror'
import type { Override } from '../hooks/overrides'
import { FRESH_MODULE, INITIAL_STATS } from '../hooks/stats'
import type { TddStats } from '../types'

const CONFIG = { ...DEFAULT_CONFIG, layout: { name: 'custom', source: 'hooks/{module}.{ext}', test: 'tests/{module}.test.{ext}' } }
const TEST = 'C:/r/tests/runPlan.test.ts'
const on = (over: Partial<TddStats>): TddStats => ({
  ...INITIAL_STATS,
  unlocked: { runPlan: TEST },
  current: { module: 'runPlan', testPath: TEST },
  ...over,
})
const catchOf = (outcome: NonNullable<TddStats['lastCatch']>['outcome']) => ({ lastCatch: { module: 'runPlan', outcome } })
const pauseFor = (minutes: number): Override => ({
  by: 'human', scope: 'pause', kind: 'other', module: null, path: null, reason: 'pairing on the prod incident and back after', until: null, minutes,
  id: 'p1', atMs: 0, status: 'approved', decidedBy: 'human', decidedAtMs: 0, endedAtMs: null, settledAtMs: null, note: null, edits: [],
})

describe('whether dope-tdd is watching, said first and never as calm zeros (2026-10-18)', () => {
  test('watching names where it looks and the stack', () => {
    expect(bandView(on({}), CONFIG).watch).toEqual({ kind: 'watching', where: 'hooks/ · node' })
  })

  test('edited code that matches no layout, with nothing watched yet, is not watching', () => {
    const s = { ...INITIAL_STATS, unwatched: ['hooks/runPlan.ts', 'hooks/stats.ts', 'hooks/mirror.ts'] }
    expect(bandView(s, CONFIG).watch).toEqual({ kind: 'not-watching', files: 3, example: 'hooks/runPlan.ts' })
    expect(bandView(s, CONFIG).next).toBe('run /tdd setup, or add a layout to dope-tdd.json')
  })

  test('test runs that were never read, with none read at all, are runs it cannot read', () => {
    const s = { ...INITIAL_STATS, unreadRuns: 2 }
    expect(bandView(s, CONFIG).watch).toEqual({ kind: 'cannot-read' })
    expect(bandView(s, CONFIG).next).toBe('run one test file, so its summary line reaches the output')
  })

  test('one unread run among read ones is not blindness', () => {
    expect(bandView(on({ unreadRuns: 1, passes: 3 }), CONFIG).watch.kind).toBe('watching')
  })

  // Band v3: the count of unwatched edits lives in /tdd; beside watched work it is never the band's alarm.
  test('unwatched edits beside watched work raise no alarm on the band', () => {
    const view = bandView(on({ unwatched: ['scripts/build.ts'] }), CONFIG)
    expect(view.watch.kind).toBe('watching')
    expect(view.guard).toBeNull()
  })
})

describe('which edited files count as code it is not watching', () => {
  test('a code file the layout pairs with no test counts', () => {
    expect(countsAsUnwatched('scripts/build.ts', CONFIG)).toBe(true)
  })

  test('only code of its own stack: another stack says nothing about what this guard watches', () => {
    expect(countsAsUnwatched('tools/gen.py', CONFIG)).toBe(false)
  })

  test('test helpers in the test folder, exempt files and files that are not code do not', () => {
    expect(countsAsUnwatched('tests/engine.tsx', CONFIG)).toBe(false)
    expect(countsAsUnwatched('hooks/register.tsx', { ...CONFIG, exempt: ['hooks/register.tsx'] })).toBe(false)
    expect(countsAsUnwatched('README.md', CONFIG)).toBe(false)
    expect(countsAsUnwatched('dope-tdd.json', CONFIG)).toBe(false)
  })
})

// #259: an edit is the signal that a project holds more than its config covers. Two different facts: a layout that
// misses code can be fixed with /tdd setup, and the band says so; a second stack can't, and the guard still works.
describe('leftOutBy: why an edited file is not guarded', () => {
  const left = (path: string, config = CONFIG) => leftOutBy(path, classifyPath('R:', `R:/${path}`, config), config)

  test('code of its own stack the layout misses is the layout', () => {
    expect(left('scripts/build.ts')).toBe('layout')
  })

  test('code of another stack is the stack', () => {
    expect(left('tools/gen.py')).toBe('stack')
    expect(left('src/App.cs', { ...CONFIG, stack: 'python' })).toBe('stack')
  })

  test('another stack in a source folder that also holds the tests still counts', () => {
    expect(left('src/gen.py', parseConfig('{"layout":"colocated"}'))).toBe('stack')
    expect(left('src/gen.py', parseConfig('{"layout":"__tests__"}'))).toBe('stack')
  })

  test('a file the layout placed, a test of any stack, a helper in the test folder, exempt, and what is not code are not left out', () => {
    expect(left('hooks/a.ts')).toBeNull()
    expect(left('tests/a.test.ts')).toBeNull()
    expect(left('scripts/test_gen.py')).toBeNull()
    expect(left('tests/helper.py')).toBeNull()
    expect(left('tools/gen.py', { ...CONFIG, exempt: ['tools/**'] })).toBeNull()
    expect(left('README.md')).toBeNull()
  })

  test('a helper in a Java test tree is not left out, under roots or a folder layout', () => {
    expect(left('services/api/src/test/java/TestData.java', parseConfig('{"stack":"java","layout":"maven","roots":["services/*"]}'))).toBeNull()
    expect(left('api/src/test/java/TestData.java', parseConfig('{"stack":"java","layout":"maven","layouts":{"api":"maven"}}'))).toBeNull()
  })

  test('a helper in a package or __tests__ test folder is not left out, in either stack', () => {
    const packages = parseConfig('{"layout":"mirror","roots":["packages/*"]}')
    expect(left('packages/app/tests/helper.ts', packages)).toBeNull()
    expect(left('packages/app/tests/helper.py', packages)).toBeNull()
    expect(left('src/__tests__/helper.py', parseConfig('{"layout":"__tests__"}'))).toBeNull()
  })
})

describe("the current module's evidence chain", () => {
  const states = (s: TddStats) => bandView(s, CONFIG).chain?.map(step => `${step.name}:${step.state}${step.word === undefined ? '' : `:${step.word}`}`)

  test('a touched test: the test is there, the rest is still open', () => {
    expect(states(on({ phase: 'writing' }))).toEqual(['red:open', 'green:open', 'proven:open'])
  })

  test('red: test and red done', () => {
    expect(states(on({ phase: 'red', sawRed: true }))).toEqual(['red:done', 'green:open', 'proven:open'])
  })

  test('green and caught: every step done', () => {
    const s = on({ phase: 'green', lastCycle: { module: 'runPlan', sawRed: true, testChanged: false }, ...catchOf({ kind: 'caught' }) })
    expect(states(s)).toEqual(['red:done', 'green:done', 'proven:done:CAUGHT'])
  })

  test('green and missed: the chain breaks at proven', () => {
    const s = on({ phase: 'green', lastCycle: { module: 'runPlan', sawRed: true, testChanged: false }, ...catchOf({ kind: 'missed' }) })
    expect(states(s)?.at(-1)).toBe('proven:failed:MISSED')
  })

  test('green that never saw red: the red step failed', () => {
    expect(states(on({ phase: 'green', unproven: ['runPlan'] }))?.[0]).toBe('red:failed:NEVER SAW RED')
  })

  test('green without red, then caught: the catch check saw the red, so the red step is done', () => {
    const s = on({ phase: 'green', unproven: ['runPlan'], ...catchOf({ kind: 'caught' }) })
    expect(states(s)).toEqual(['red:done:BY CATCH', 'green:done', 'proven:done:CAUGHT'])
  })

  test('green without red, then missed: still never saw red', () => {
    const s = on({ phase: 'green', unproven: ['runPlan'], ...catchOf({ kind: 'missed' }) })
    expect(states(s)?.[0]).toBe('red:failed:NEVER SAW RED')
  })

  test('no current module: no chain', () => {
    expect(bandView(INITIAL_STATS, CONFIG).chain).toBeNull()
  })
})

describe('one next step, always', () => {
  const next = (s: TddStats) => bandView(s, CONFIG).next

  test('nothing yet: write a failing test first', () => {
    expect(next(INITIAL_STATS)).toBe('write a failing test first')
  })

  test('a touched test: run it and see it fail', () => {
    expect(next(on({ phase: 'writing' }))).toBe('run the test and see it fail')
  })

  test('red: make it pass with the smallest change', () => {
    expect(next(on({ phase: 'red', sawRed: true }))).toBe('make it pass with the smallest change')
  })

  test('proven: refactor while the test guards it, then commit', () => {
    expect(next(on({ phase: 'green', ...catchOf({ kind: 'caught' }) }))).toBe('refactor while the test guards it, then commit')
  })

  // A tester's band still said "then commit" after the PR was pushed (2026-10-19): the next step reads where the work is.
  test('proven and committed: push it; proven and pushed: the next failing test', () => {
    const proven = on({ phase: 'green', ...catchOf({ kind: 'caught' }) })
    expect(bandView(proven, CONFIG, [], 0, undefined, '', { module: 'runPlan', state: 'uncommitted' }).next).toBe('refactor while the test guards it, then commit')
    expect(bandView(proven, CONFIG, [], 0, undefined, '', { module: 'runPlan', state: 'committed' }).next).toBe('committed · push it, or refactor while the test guards it')
    expect(bandView(proven, CONFIG, [], 0, undefined, '', { module: 'runPlan', state: 'pushed' }).next).toBe('committed and pushed · write the next failing test')
  })

  test("another module's saved state says nothing about this one", () => {
    const proven = on({ phase: 'green', ...catchOf({ kind: 'caught' }) })
    expect(bandView(proven, CONFIG, [], 0, undefined, '', { module: 'stats', state: 'pushed' }).next).toBe('refactor while the test guards it, then commit')
  })

  test('missed: add an assertion that fails without the line it missed', () => {
    expect(next(on({ phase: 'green', ...catchOf({ kind: 'missed', slipped: ['+ return a + b'] }) }))).toBe(
      'add an assertion that fails without:  + return a + b',
    )
  })

  test('unverified, or green without red: prove it by hand', () => {
    expect(next(on({ phase: 'green', ...catchOf({ kind: 'unverified', reason: 'no runner' }) }))).toBe('prove it by hand: break the code, see red, put it back')
    expect(next(on({ phase: 'green', unproven: ['runPlan'] }))).toBe('prove it by hand: break the code, see red, put it back')
  })

  test('green without red but caught or proven: nothing left to prove by hand', () => {
    expect(next(on({ phase: 'green', unproven: ['runPlan'], ...catchOf({ kind: 'caught' }) }))).toBe('refactor while the test guards it, then commit')
    expect(next(on({ phase: 'green', unproven: ['runPlan'], ...catchOf({ kind: 'proven' }) }))).toBe('refactor while the test guards it, then commit')
  })

  test('paused: resume the guard when you are done', () => {
    expect(next(on({ phase: 'red', paused: true }))).toBe('resume the guard when you are done')
  })
})

describe('progress shows only with a module to show it for', () => {
  test('no current module: no phase or trail, whatever the last phase was', () => {
    expect(bandView({ ...INITIAL_STATS, phase: 'green' }, CONFIG).showProgress).toBe(false)
  })

  test('a current module, watched: phase and trail show', () => {
    expect(bandView(on({ phase: 'green' }), CONFIG).showProgress).toBe(true)
  })

  test('not watching: no phase or trail, even with a module', () => {
    expect(bandView(on({ unreadRuns: 2 }), CONFIG).showProgress).toBe(false)
  })
})

// Band v3 (2026-10-18), from the principal UX and engineering reviews: counts like BLOCKED and WORKAROUNDS left the band
// for /tdd (a refusal is the guard working, not a problem); the mode is a guard word, below.
describe('band v3: one guard word, only when the guard is not simply enforcing', () => {
  const guard = (s: TddStats, over: Partial<typeof CONFIG> = {}, options: { standingDown?: string; record?: Override[]; nowMs?: number } = {}) =>
    bandView(s, { ...CONFIG, ...over }, options.record ?? [], options.nowMs ?? 0, undefined, options.standingDown ?? '').guard

  test('enforcing and watching: no word at all; silence is the signal', () => {
    expect(guard(on({}))).toBeNull()
  })

  // Verified review A13 (2026-10-20): a guard that threw let calls through with one toast, and the band went on looking
  // like it was guarding. It comes first: nothing else the band says is true while the guard is not running.
  test('a guard that failed, before anything else', () => {
    expect(guard(on({ guardFailures: 2, paused: true }), {}, { standingDown: 'rebase' })).toEqual({
      word: 'GUARD FAILING',
      detail: '2 calls went through unguarded after an internal error · see the log',
    })
    expect(guard(on({ guardFailures: 1 }))).toEqual({ word: 'GUARD FAILING', detail: '1 call went through unguarded after an internal error · see the log' })
  })

  // #193: an invalid dope-tdd.json falls back to enforce and the default layout, and that was said only in /tdd. The
  // band names the file and the error. After a failing guard (still the most urgent), before standing down and pause,
  // which end by themselves while a broken file does not.
  test('an invalid dope-tdd.json, naming the file and the error', () => {
    const error = 'dope-tdd.json: mode must be one of enforce, warn, observe'
    expect(guard(on({}), { error })).toEqual({
      word: 'CONFIG INVALID',
      detail: 'dope-tdd.json: mode must be one of enforce, warn, observe · using the defaults: enforce, node, default layout · fix the file',
    })
    // #223 (tester round 6): the stack falls back too, and the band never said which one was in force.
    expect(guard(on({}), { error, stack: 'python' })?.detail).toMatch(/using the defaults: enforce, python, default layout/)
    expect(guard(on({ paused: true }), { error }, { standingDown: 'merge' })?.word).toBe('CONFIG INVALID')
    expect(guard(on({ guardFailures: 1 }), { error })?.word).toBe('GUARD FAILING')
    expect(bandView(INITIAL_STATS, { ...CONFIG, error }).idle).toBe(false)
  })

  test('a git operation in progress', () => {
    expect(guard(on({}), {}, { standingDown: 'rebase' })).toEqual({ word: 'STANDING DOWN', detail: 'git rebase in progress · back when it ends' })
  })

  test('paused, with when it resumes by itself', () => {
    const pause = { ...pauseFor(30), atMs: 0 }
    expect(guard(on({ paused: true }), {}, { record: [pause], nowMs: 12 * 60_000 })).toEqual({ word: 'PAUSED', detail: 'resumes by itself in 18m · /tdd resume' })
    expect(guard(on({ paused: true }))).toEqual({ word: 'PAUSED', detail: '/tdd resume' })
  })

  test('not watching names the files and the fix', () => {
    expect(guard({ ...INITIAL_STATS, unwatched: ['cli/a.ts', 'cli/b.ts'] })).toEqual({
      word: 'NOT WATCHING',
      detail: '2 edited code files match no test layout: cli/a.ts +1 · fix: /tdd setup',
    })
    expect(guard({ ...INITIAL_STATS, unwatched: ['cli/a.ts'] })?.detail).toBe('1 edited code file matches no test layout: cli/a.ts · fix: /tdd setup')
  })

  test("runs it can't read", () => {
    expect(guard({ ...INITIAL_STATS, unreadRuns: 2 })).toEqual({ word: "CAN'T READ RUNS", detail: '2 runs, none with a summary line · fix: run one test file, without piping it' })
  })

  test('warn and observe modes say what they let through', () => {
    expect(guard(on({}), { mode: 'warn' })).toEqual({ word: 'WARN ONLY', detail: 'untested edits go through, with a warning' })
    expect(guard(on({}), { mode: 'observe' })).toEqual({ word: 'OBSERVING', detail: 'nothing is refused; dope-tdd only records' })
  })
})

describe('band v3: the chain as words, and one verdict', () => {
  const view = (s: TddStats, nowMs = 0) => bandView(s, CONFIG, [], nowMs)
  const tokens = (s: TddStats, nowMs = 0) => view(s, nowMs).tokens.map(token => `${token.text}|${token.tone}`)
  const verdict = (s: TddStats) => view(s).verdict
  const closed = { lastCycle: { module: 'runPlan', sawRed: true, testChanged: false } }

  test('writing: both steps open', () => {
    expect(tokens(on({ phase: 'writing' }))).toEqual(['red ·|dim', 'green ·|dim'])
  })

  test('RED, with how long it has been open, an alarm after ten minutes', () => {
    expect(tokens(on({ phase: 'red', sawRed: true, cycleStartMs: 0 }), 2 * 60_000)).toEqual(['RED 2MIN|ember', 'green ·|dim'])
    expect(tokens(on({ phase: 'red', sawRed: true, cycleStartMs: 0 }), 11 * 60_000)[0]).toBe('RED 11MIN|alarm')
  })

  // #244 (2026-10-29): a red left open with nothing happening read as work in progress, its seconds still ticking
  // (`RED 45MIN06S`). After half an hour with no activity it says it is stale, in whole minutes.
  test('a red with nothing happening for half an hour says so, in whole minutes', () => {
    const idle = on({ phase: 'red', sawRed: true, cycleStartMs: 0, lastEventMs: 15 * 60_000 })
    expect(tokens(idle, (45 * 60 + 6) * 1000)[0]).toBe('RED · open 45MIN · nothing for 30MIN|dim')
    expect(tokens(idle, 40 * 60_000)[0]).toBe('RED 40MIN|alarm')
  })

  test('proven, by either kind of catch check', () => {
    expect(tokens(on({ phase: 'green', ...closed, ...catchOf({ kind: 'proven' }) }))).toEqual(['red ✓|pass', 'green ✓|pass'])
    expect(verdict(on({ phase: 'green', ...closed, ...catchOf({ kind: 'proven' }) }))).toEqual({ text: 'PROVEN', tone: 'pass' })
    expect(verdict(on({ phase: 'green', ...closed, ...catchOf({ kind: 'caught' }) }))).toEqual({ text: 'PROVEN', tone: 'pass' })
  })

  test('being proven right now', () => {
    const checking = on({ phase: 'green', ...closed, checking: { module: 'runPlan', sinceMs: 0 } })
    expect(verdict(checking)).toEqual({ text: 'proving…', tone: 'dim' })
    expect(view(checking).next).toBe('wait a moment: dope-tdd is undoing the change to check the test catches it')
  })

  test('MISSED stays its own word, in the strongest colour', () => {
    expect(verdict(on({ phase: 'green', ...closed, ...catchOf({ kind: 'missed' }) }))).toEqual({ text: 'MISSED · passes without your change', tone: 'ember' })
  })

  test('the weaker proofs are UNPROVEN, with the reason', () => {
    expect(verdict(on({ phase: 'green', unproven: ['runPlan'] }))).toEqual({ text: 'UNPROVEN · never failed', tone: 'warn' })
    expect(tokens(on({ phase: 'green', unproven: ['runPlan'] }))[0]).toBe('red ✗|warn')
    expect(verdict(on({ phase: 'green', ...closed, ...catchOf({ kind: 'unverified', reason: 'pytest is experimental' }) }))).toEqual({
      text: 'UNPROVEN · not checked: pytest is experimental',
      tone: 'warn',
    })
    expect(verdict(on({ phase: 'green', lastCycle: { module: 'runPlan', sawRed: true, testChanged: true } }))).toEqual({
      text: "UNPROVEN · the test changed, the code didn't",
      tone: 'warn',
    })
  })

  test('changed since green', () => {
    const changed = on({ phase: 'green', ...closed, modules: { runPlan: { ...FRESH_MODULE, phase: 'green', editedSinceRun: true } }, ...catchOf({ kind: 'proven' }) })
    expect(verdict(changed)).toEqual({ text: 'CHANGED', tone: 'warn' })
  })

  test('a refactor is said plainly', () => {
    expect(verdict(on({ phase: 'green', ...closed, ...catchOf({ kind: 'refactor' }) }))).toEqual({ text: 'refactor · not re-checked', tone: 'plain' })
  })

  test('no verdict before green', () => {
    expect(verdict(on({ phase: 'red', sawRed: true }))).toBeNull()
  })
})

describe('band v3: the module as it is named, and a line before anything happens', () => {
  test('the module in file case, as the developer knows it', () => {
    expect(bandView(on({}), CONFIG).module).toBe('runPlan')
    expect(bandView(INITIAL_STATS, CONFIG).module).toBeNull()
  })

  test('idle only when there is nothing else to say', () => {
    expect(bandView(INITIAL_STATS, CONFIG).idle).toBe(true)
    expect(bandView(on({}), CONFIG).idle).toBe(false)
    expect(bandView({ ...INITIAL_STATS, unreadRuns: 1 }, CONFIG).idle).toBe(false)
  })
})

describe('overrides on the band (2026-10-18)', () => {
  const override = (over: Partial<Override> = {}): Override => ({
    by: 'agent', scope: 'module', kind: 'spike', module: 'runPlan', path: 'hooks/runPlan.ts',
    reason: 'trying two parsers for the run summary; the loser is deleted', until: 'the spike PR closes', minutes: null,
    id: 'o1', atMs: 0, status: 'approved', decidedBy: 'human', decidedAtMs: 0, endedAtMs: null, settledAtMs: null, note: null, edits: [],
    ...over,
  })

  test('a waiting request is shown, and the next step is to decide it', () => {
    const view = bandView(on({ phase: 'writing' }), CONFIG, [override({ status: 'pending', decidedBy: null })])
    expect(view.pending?.id).toBe('o1')
    expect(view.next).toBe('approve or deny the override request: /tdd approve, or /tdd deny <why>')
  })

  test("the current module's open override is named; each open door is its own row, not also a count", () => {
    const view = bandView(on({ phase: 'writing' }), CONFIG, [override(), override({ id: 'o2', module: 'stats', kind: 'hotfix', scope: 'change' })])
    expect(view.overridden?.id).toBe('o1')
    expect(view.open.map(door => door.target)).toEqual(['runPlan', 'stats'])
  })

  test('no overrides, nothing said', () => {
    const view = bandView(on({}), CONFIG, [])
    expect(view.pending).toBeNull()
    expect(view.overridden).toBeNull()
    expect(view.open).toEqual([])
  })
})

describe('open overrides on the band, whichever module is current (live trial, 2026-10-18)', () => {
  const approved = (over: Partial<Override> = {}): Override => ({
    by: 'agent', scope: 'change', kind: 'spike', module: 'timeText', path: 'hooks/timeText.ts',
    reason: 'try seconds under a minute; a test follows', until: null, minutes: null,
    id: 'o1', atMs: 0, status: 'approved', decidedBy: 'model', decidedAtMs: 0, endedAtMs: null, settledAtMs: null, note: null, edits: [],
    review: { model: 'claude-sonnet-5-5', effort: 'high', verdict: 'approve', reason: 'small spike' },
    ...over,
  })

  test('each override that still lets something through is listed, with what ends it', () => {
    expect(bandView(INITIAL_STATS, CONFIG, [approved()], 0).open).toEqual([
      { target: 'timeText', text: 'timeText · spike · 1 edit left · approved by model claude-sonnet-5-5 (high)' },
    ])
  })

  test('a spent one is not', () => {
    expect(bandView(INITIAL_STATS, CONFIG, [approved({ edits: ['hooks/timeText.ts'] })], 0).open).toEqual([])
  })

  test('with no module current, the next step is to use it or end it', () => {
    expect(bandView(INITIAL_STATS, CONFIG, [approved()], 0).next).toBe('use it or end it: /tdd override end timeText')
  })
})

describe("another session's override on the band (2026-10-18)", () => {
  const theirs: Override = {
    by: 'agent', scope: 'change', kind: 'spike', module: 'timeText', path: 'hooks/timeText.ts',
    reason: 'try seconds under a minute; a test follows', until: null, minutes: null,
    id: 'o1', atMs: 0, status: 'approved', decidedBy: 'human', decidedAtMs: 0, endedAtMs: null, settledAtMs: null, note: null, edits: [],
    session: 'A',
  }

  test("is shown, said to be another session's, and still has END", () => {
    expect(bandView(INITIAL_STATS, CONFIG, [theirs], 0, 'B').open).toEqual([
      { target: 'timeText', text: "timeText · spike · 1 edit left · approved by human · another session's" },
    ])
  })

  test('its own is not marked', () => {
    expect(bandView(INITIAL_STATS, CONFIG, [theirs], 0, 'A').open[0]?.text).toBe('timeText · spike · 1 edit left · approved by human')
  })
})

// The last run in words, in place of a trail of symbols (2026-10-18): which test, how it went, whose it was, when. Read
// from the stored record (stats.ts), never rebuilt from event text, so an unread run is the last run too.
describe('lastRun', () => {
  const record = (outcome: NonNullable<TddStats['lastRun']>['outcome'], module: string | null = 'runPlan', files: string[] = []) => ({ module, outcome, files, atMs: 0 })
  const lastRun = (last: TddStats['lastRun'], over: Partial<TddStats> = {}) => bandView(on({ lastRun: last, ...over }), CONFIG, [], 90_000).lastRun

  test('no runs yet: nothing', () => {
    expect(lastRun(null)).toBeNull()
  })

  test("this module's test passed or failed", () => {
    expect(lastRun(record('pass'))).toBe('last run: runPlan.test.ts passed · 1min ago')
    expect(lastRun(record('fail'))).toBe('last run: runPlan.test.ts failed · 1min ago')
  })

  // Idea 17 (2026-10-26): a one-file run says how long it took, and a slow one says so.
  test('a one-file run says how long it took, and a slow one is named slow', () => {
    expect(lastRun({ ...record('pass'), tookMs: 4_200 })).toBe('last run: runPlan.test.ts passed in 4S · 1min ago')
    expect(lastRun({ ...record('fail'), tookMs: 45_000 })).toBe('last run: runPlan.test.ts failed in 45S, slow for one file · 1min ago')
  })

  test('another file failed: not this module', () => {
    expect(lastRun(record('elsewhere', 'runPlan', ['tests/overrideFlow.test.tsx']))).toBe('last run: overrideFlow.test.tsx failed · not this module · 1min ago')
    expect(lastRun(record('elsewhere', 'runPlan', ['tests/a.test.ts', 'tests/b.test.ts']))).toBe('last run: a.test.ts +1 failed · not this module · 1min ago')
  })

  test('a failure the output did not place', () => {
    expect(lastRun(record('elsewhere', 'runPlan', ['a file the output did not name']))).toBe('last run: failed, the output did not say where · not this module · 1min ago')
  })

  test("another module's test passed", () => {
    expect(lastRun(record('pass', 'stats'), { unlocked: { runPlan: TEST, stats: 'C:/r/tests/stats.test.ts' } })).toBe('last run: stats.test.ts passed · another module · 1min ago')
  })

  test('a run that could not be read is the last run, said plainly, never an older run in its place', () => {
    expect(lastRun(record('unread'))).toBe('last run: not read · the output had no summary line · 1min ago')
  })
})

// Seen by the engineering review (2026-10-18): after an edit, the band still said GREEN … PROVEN about changed code.
describe('green and proven go stale when the code changes after them', () => {
  const edited = (editedSinceRun: boolean) =>
    on({
      phase: 'green',
      modules: { runPlan: { ...FRESH_MODULE, phase: 'green', editedSinceRun } },
      lastCycle: { module: 'runPlan', sawRed: true, testChanged: false },
      ...catchOf({ kind: 'proven' }),
    })
  const states = (s: TddStats) => bandView(s, CONFIG).chain?.map(step => `${step.name}:${step.state}${step.word === undefined ? '' : `:${step.word}`}`)

  test('edited since green: the green is CHANGED and nothing is proven', () => {
    expect(states(edited(true))).toEqual(['red:done', 'green:open:CHANGED', 'proven:open'])
  })

  test('and the next step is to run the test', () => {
    expect(bandView(edited(true), CONFIG).next).toBe('run the test: the code changed since it went green')
  })

  test('not edited: proven as before', () => {
    expect(states(edited(false))?.at(-1)).toBe('proven:done:PROVEN')
  })
})

// The agent contract (2026-10-18): the refusal quotes the band's last-run line, so the person and the agent read one fact.
describe('lastRunLine is the band\'s own last-run line', () => {
  test('the same text the band shows, from the same record', () => {
    const s = on({ lastRun: { module: 'runPlan', outcome: 'fail', files: [], atMs: 0 } })
    expect(lastRunLine(s, 60_000)).toBe(bandView(s, CONFIG, [], 60_000).lastRun)
    expect(lastRunLine(s, 60_000)).toBe('last run: runPlan.test.ts failed · 1min ago')
  })
})

// "last run" opens what that run was (2026-10-18): every element on the band says something or opens something.
describe('lastRunTarget: the test file a click on the last run opens', () => {
  const run = (outcome: NonNullable<TddStats['lastRun']>['outcome'], module: string | null = 'runPlan', files: string[] = []) => on({ lastRun: { module, outcome, files, atMs: 0 } })

  test('no runs yet: nothing to open', () => {
    expect(lastRunTarget(on({ lastRun: null }))).toBeNull()
  })

  test("a pass or a fail opens the test of the module it belonged to", () => {
    expect(lastRunTarget(run('pass'))).toBe(TEST)
    expect(lastRunTarget(run('fail'))).toBe(TEST)
  })

  test("another module's run opens that module's test, not the current one", () => {
    expect(lastRunTarget({ ...run('pass', 'stats'), unlocked: { runPlan: TEST, stats: 'C:/r/tests/stats.test.ts' } })).toBe('C:/r/tests/stats.test.ts')
  })

  test('a module with no known test, or no module, has nothing to open', () => {
    expect(lastRunTarget(run('pass', 'mirror'))).toBeNull()
    expect(lastRunTarget(run('fail', null))).toBeNull()
  })

  test('a failure elsewhere opens the first file that failed', () => {
    expect(lastRunTarget(run('elsewhere', 'runPlan', ['tests/a.test.ts', 'tests/b.test.ts']))).toBe('tests/a.test.ts')
  })

  test('a failure the output did not place, or a run that was not read, has nothing to open', () => {
    expect(lastRunTarget(run('elsewhere', 'runPlan', ['a file the output did not name']))).toBeNull()
    expect(lastRunTarget(run('elsewhere', 'runPlan', []))).toBeNull()
    expect(lastRunTarget(run('unread'))).toBeNull()
  })

  test('the band carries it beside the line it opens from', () => {
    expect(bandView(run('fail'), CONFIG).lastRunOpens).toBe(TEST)
    expect(bandView(run('unread'), CONFIG).lastRunOpens).toBeNull()
  })
})

// One verdict vocabulary (2026-10-18): the band, /tdd, the agent and the model reviewer say a catch check's outcome
// in the same words. CAUGHT (undone by dope-tdd) and PROVEN (broken by you) are one fact to a reader: PROVEN.
describe('catchWord', () => {
  test('caught and proven are both PROVEN', () => {
    expect(catchWord({ kind: 'caught' })).toBe('PROVEN')
    expect(catchWord({ kind: 'proven' })).toBe('PROVEN')
  })

  test('missed, not checked, and a refactor', () => {
    expect(catchWord({ kind: 'missed' })).toBe('MISSED')
    expect(catchWord({ kind: 'unverified', reason: 'timeout' })).toBe('UNPROVEN · not checked: timeout')
    expect(catchWord({ kind: 'refactor' })).toBe('refactor · not re-checked')
  })
})

// Pin corrected (2026-10-18, from the VibeCast field test): fixing a pin that guessed today's behaviour wrongly looks,
// on the record alone, exactly like a test bent to match a bug. The difference is the pin skill: with it in use this
// session, the correction is said as what it is, on its own line and not as a workaround; without it, it stays
// "test changed". Either way the pin still has to be proven by a deliberate break.
describe('the band says a corrected pin is not proven yet', () => {
  test('UNPROVEN, naming the correction and the proof still owed', () => {
    const s = on({ phase: 'green', lastCycle: { module: 'runPlan', sawRed: true, testChanged: true, pinCorrected: true } })
    expect(bandView(s, CONFIG).verdict).toEqual({ text: 'UNPROVEN · pin corrected: prove it with a break', tone: 'warn' })
  })
})

// #214 part 3 (tester round 6): under an invalid file the defaults apply, and when the default layout matches none of
// the project's code nothing is guarded at all; "using the defaults: enforce" read as still guarding.
describe('an invalid dope-tdd.json whose default layout matches nothing', () => {
  test('the band says nothing is guarded', () => {
    const error = 'dope-tdd.json: mode must be one of enforce, warn, observe'
    expect(bandView(INITIAL_STATS, { ...CONFIG, error }, [], 0, undefined, '', null, true).guard).toEqual({
      word: 'CONFIG INVALID',
      detail: "dope-tdd.json: mode must be one of enforce, warn, observe · ignored, and the default layout matches none of this project's code, so nothing is guarded · fix the file",
    })
  })

  test('a valid file is not affected by the layout note', () => {
    expect(bandView(on({}), CONFIG, [], 0, undefined, '', null, true).guard).toBeNull()
  })
})

// #216 (tester round 6): a refusal, above all a subagent's, left no mark on the band; the person watching saw idle.
describe('the band shows the last refusal until its module moves on', () => {
  const MIN = 60_000
  const blocked = (module: string, atMs: number, agent?: string) => ({ atMs, kind: 'blocked' as const, module, ...(agent === undefined ? {} : { agent }) })

  test('a refusal names the module and when, and the band is not idle', () => {
    const view = bandView({ ...INITIAL_STATS, events: [blocked('stats', 0)] }, CONFIG, [], 2 * MIN)
    expect(view.refused).toBe('refused: stats · write its test first · 2min ago')
    expect(view.idle).toBe(false)
  })

  test("a subagent's refusal says so", () => {
    expect(bandView({ ...INITIAL_STATS, events: [blocked('stats', 0, 'a1')] }, CONFIG, [], 0).refused).toBe('refused: stats · write its test first · a subagent · just now')
  })

  test('once its test is touched or run, the refusal is no longer shown', () => {
    for (const kind of ['touched', 'fail', 'pass', 'edited'] as const) {
      const s = { ...INITIAL_STATS, events: [blocked('stats', 0), { atMs: 1, kind, module: 'stats' }] }
      expect(bandView(s, CONFIG, [], 2).refused).toBeNull()
    }
  })

  test('activity on another module does not hide it', () => {
    const s = { ...INITIAL_STATS, events: [blocked('stats', 0), { atMs: 1, kind: 'touched' as const, module: 'mirror' }] }
    expect(bandView(s, CONFIG, [], 2).refused).toMatch(/^refused: stats/)
  })

  test('no refusal, no line', () => {
    expect(bandView(INITIAL_STATS, CONFIG).refused).toBeNull()
  })
})
