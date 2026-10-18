import { describe, expect, test } from 'claude-code/testing'

import { bandView, countsAsUnwatched } from '../hooks/bandModel'
import { DEFAULT_CONFIG } from '../hooks/config'
import type { Override } from '../hooks/overrides'
import { INITIAL_STATS } from '../hooks/stats'
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

  test('unwatched edits beside watched work are a problem count, not an alarm', () => {
    const view = bandView(on({ unwatched: ['scripts/build.ts'] }), CONFIG)
    expect(view.watch.kind).toBe('watching')
    expect(view.problems).toContainEqual({ label: '1 UNWATCHED', tone: 'warn' })
  })
})

describe('which edited files count as code it is not watching', () => {
  test('a code file the layout pairs with no test counts', () => {
    expect(countsAsUnwatched('scripts/build.ts', CONFIG)).toBe(true)
  })

  test('test helpers in the test folder, exempt files and files that are not code do not', () => {
    expect(countsAsUnwatched('tests/engine.tsx', CONFIG)).toBe(false)
    expect(countsAsUnwatched('hooks/register.tsx', { ...CONFIG, exempt: ['hooks/register.tsx'] })).toBe(false)
    expect(countsAsUnwatched('README.md', CONFIG)).toBe(false)
    expect(countsAsUnwatched('dope-tdd.json', CONFIG)).toBe(false)
  })
})

describe("the current module's evidence chain", () => {
  const states = (s: TddStats) => bandView(s, CONFIG).chain?.map(step => `${step.name}:${step.state}${step.word === undefined ? '' : `:${step.word}`}`)

  test('a touched test: the test is there, the rest is still open', () => {
    expect(states(on({ phase: 'writing' }))).toEqual(['test:done', 'red:open', 'green:open', 'proven:open'])
  })

  test('red: test and red done', () => {
    expect(states(on({ phase: 'red', sawRed: true }))).toEqual(['test:done', 'red:done', 'green:open', 'proven:open'])
  })

  test('green and caught: every step done', () => {
    const s = on({ phase: 'green', lastCycle: { module: 'runPlan', sawRed: true, testChanged: false }, ...catchOf({ kind: 'caught' }) })
    expect(states(s)).toEqual(['test:done', 'red:done', 'green:done', 'proven:done:CAUGHT'])
  })

  test('green and missed: the chain breaks at proven', () => {
    const s = on({ phase: 'green', lastCycle: { module: 'runPlan', sawRed: true, testChanged: false }, ...catchOf({ kind: 'missed' }) })
    expect(states(s)?.at(-1)).toBe('proven:failed:MISSED')
  })

  test('green that never saw red: the red step failed', () => {
    expect(states(on({ phase: 'green', unproven: ['runPlan'] }))?.[1]).toBe('red:failed:NEVER SAW RED')
  })

  test('green without red, then caught: the catch check saw the red, so the red step is done', () => {
    const s = on({ phase: 'green', unproven: ['runPlan'], ...catchOf({ kind: 'caught' }) })
    expect(states(s)).toEqual(['test:done', 'red:done:BY CATCH', 'green:done', 'proven:done:CAUGHT'])
  })

  test('green without red, then missed: still never saw red', () => {
    const s = on({ phase: 'green', unproven: ['runPlan'], ...catchOf({ kind: 'missed' }) })
    expect(states(s)?.[1]).toBe('red:failed:NEVER SAW RED')
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
    expect(bandView({ ...INITIAL_STATS, phase: 'green', history: ['pass'] }, CONFIG).showProgress).toBe(false)
  })

  test('a current module, watched: phase and trail show', () => {
    expect(bandView(on({ phase: 'green' }), CONFIG).showProgress).toBe(true)
  })

  test('not watching: no phase or trail, even with a module', () => {
    expect(bandView(on({ unreadRuns: 2 }), CONFIG).showProgress).toBe(false)
  })
})

describe("problems: the current cycle's, above zero; session totals stay in /tdd", () => {
  const event = (kind: TddStats['events'][number]['kind'], module = 'runPlan') => ({ atMs: 0, kind, module })

  test('a clean session has none, so there are no calm zeros', () => {
    expect(bandView(on({}), CONFIG).problems).toEqual([])
  })

  test('session totals alone are not shown: they belong to /tdd', () => {
    expect(bandView(on({ missed: 1, workarounds: 2, blocked: 3 }), CONFIG).problems).toEqual([])
  })

  test("an open cycle counts its own problems since the module's last pass", () => {
    const events = [event('blocked'), event('fail'), event('pass'), event('touched'), event('blocked'), event('unguarded'), event('test-changed'), event('fail')]
    expect(bandView(on({ phase: 'red', events }), CONFIG).problems).toEqual([
      { label: '1 TEST CHANGED', tone: 'warn' },
      { label: '1 UNGUARDED', tone: 'warn' },
      { label: '1 BLOCKED', tone: 'warn' },
    ])
  })

  test('a cycle that just closed keeps its problems until the next one opens', () => {
    const events = [event('blocked'), event('pass'), event('touched'), event('skipped'), event('assertion-removed'), event('fail'), event('pass'), event('caught')]
    expect(bandView(on({ phase: 'green', events }), CONFIG).problems).toEqual([{ label: '2 WORKAROUNDS', tone: 'warn' }])
  })

  test("another module's problems count when they happen during this cycle, and not before it", () => {
    const events = [event('blocked', 'stats'), event('pass'), event('touched'), event('unguarded', 'stats'), event('fail')]
    expect(bandView(on({ phase: 'red', events }), CONFIG).problems).toEqual([{ label: '1 UNGUARDED', tone: 'warn' }])
  })

  test('a mode other than enforce is shown', () => {
    expect(bandView(on({}), { ...CONFIG, mode: 'warn' }).problems).toContainEqual({ label: 'MODE WARN', tone: 'warn' })
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

  test("the current module's open override is named, and open overrides and debt are counted", () => {
    const view = bandView(on({ phase: 'writing' }), CONFIG, [override(), override({ id: 'o2', module: 'stats', kind: 'hotfix', scope: 'change' })])
    expect(view.overridden?.id).toBe('o1')
    expect(view.problems).toContainEqual({ label: '2 OVERRIDES OPEN', tone: 'warn' })
  })

  test('no overrides, nothing said', () => {
    const view = bandView(on({}), CONFIG, [])
    expect(view.pending).toBeNull()
    expect(view.overridden).toBeNull()
    expect(view.problems).toEqual([])
  })
})
