import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_CONFIG } from '../hooks/config'
import { OVERRIDE_HINT, lockedFor, lockedMessage, unblockSteps, wasRefused } from '../hooks/refusals'
import { INITIAL_STATS, recordBlocked } from '../hooks/stats'

const CONFIG = { ...DEFAULT_CONFIG, layout: { name: 'custom', source: 'hooks/{module}.{ext}', test: 'tests/{module}.test.{ext}' } }
const COMMAND = 'node --import ./tests/node/register.mjs --test tests/runPlan.test.ts'

describe('lockedMessage: the cheap path first, the override last (2026-10-18)', () => {
  test('names the test to write, then pin, then the override request, in that order', () => {
    const message = lockedMessage(CONFIG, 'runPlan', undefined, 'ts')
    expect(message.startsWith('dope-tdd: write the failing test first. Touch tests/runPlan.test.ts')).toBe(true)
    expect(message.indexOf('/dope-tdd:pin')).toBeLessThan(message.indexOf('mcp__dope-tdd__override_request'))
  })

  test('the override hint says a person decides and it is recorded', () => {
    expect(OVERRIDE_HINT).toMatch(/a person decides, and it is recorded/)
  })
})

// The agent contract (2026-10-18): a refusal is a menu of exact next steps, not prose to interpret.
describe('a refusal numbers the ways to unblock', () => {
  test('each way on its own numbered line, the first with the exact command that runs the test', () => {
    const message = lockedMessage(CONFIG, 'runPlan', undefined, 'ts', { command: COMMAND })
    expect(message).toMatch(/\nUnblock by one of:\n/)
    expect(message.split('\n')).toContain(`(1) write or edit tests/runPlan.test.ts so it fails, then run it: ${COMMAND}`)
    expect(message).toMatch(/^\(2\) no test for this code yet: \/dope-tdd:pin pins what it does now$/m)
    expect(message).toMatch(/^\(3\) neither fits: ask for an override with mcp__dope-tdd__override_request; a person decides, and it is recorded$/m)
  })

  test('with no runner found, the first way names the test without a command', () => {
    expect(unblockSteps('tests/runPlan.test.ts', undefined, true)).toMatch(/^\(1\) write or edit tests\/runPlan\.test\.ts so it fails, then run it$/m)
  })
})

describe('the override is offered once per module', () => {
  test('a later refusal for the same module lists only the cheap ways', () => {
    const message = lockedMessage(CONFIG, 'runPlan', undefined, 'ts', { command: COMMAND, overrideOffered: true })
    expect(message).toMatch(/^\(2\) no test for this code yet/m)
    expect(message).not.toMatch(/override_request/)
    expect(message).not.toMatch(/^\(3\)/m)
  })
})

// #212: each agent sees the override on its own first refusal. A subagent refused after the main session was refused on
// the same module was treated as already told, and never learned the override exists.
describe('the override is offered once per module and agent', () => {
  const refusedByMain = recordBlocked(INITIAL_STATS, 'runPlan', 1)

  test('the main session, refused once, is not offered it again', () => {
    expect(wasRefused(refusedByMain, 'runPlan')).toBe(true)
  })

  test('a subagent refused after the main session is still offered it', () => {
    expect(wasRefused(refusedByMain, 'runPlan', 'agent-1')).toBe(false)
    expect(lockedFor(CONFIG, refusedByMain, 'runPlan', 2, undefined, {}, 'agent-1')).toMatch(/override_request/)
  })

  test('a subagent refused once is not offered it again, and the main session still is', () => {
    const refusedBySub = recordBlocked(INITIAL_STATS, 'runPlan', 1, 'agent-1')
    expect(wasRefused(refusedBySub, 'runPlan', 'agent-1')).toBe(true)
    expect(wasRefused(refusedBySub, 'runPlan')).toBe(false)
  })
})

describe('the refusal ends with the last run, in the band\'s own words', () => {
  test('the line it is given closes the message', () => {
    const message = lockedMessage(CONFIG, 'runPlan', undefined, 'ts', { lastRun: 'last run: summary.test.ts passed · 4m ago' })
    expect(message.endsWith('\nlast run: summary.test.ts passed · 4m ago')).toBe(true)
  })

  test('no run yet, no line', () => {
    expect(lockedMessage(CONFIG, 'runPlan', undefined, 'ts')).not.toMatch(/last run/)
  })
})

// Option A from the docs review (2026-10-18): refactoring code whose test already passes had no option that fit.
// "(1) make it fail" read as breaking a good test, and "(2) no test for this code yet" was false. When the test
// exists, the menu says the honest path: one assertion for what is about to change, seen failing; or pin and refactor.
describe('when the module already has a test, the menu fits a refactor', () => {
  test('the first way is one new or tighter assertion, seen failing; the second is to pin and refactor under the pins', () => {
    const message = lockedMessage(CONFIG, 'runPlan', undefined, 'ts', { command: COMMAND, testExists: true })
    const lines = message.split('\n')
    expect(lines).toContain(`(1) tests/runPlan.test.ts exists: add or tighten one assertion for what you are about to change, and see it fail: ${COMMAND}`)
    expect(lines).toContain('(2) a refactor that should change nothing: /dope-tdd:pin pins what the code does now in that test and proves the pins; then refactor under them')
    expect(message).not.toMatch(/no test for this code yet/)
  })

  test('with no test yet, the menu is as before', () => {
    const message = lockedMessage(CONFIG, 'runPlan', undefined, 'ts', { command: COMMAND, testExists: false })
    expect(message).toMatch(/^\(1\) write or edit tests\/runPlan\.test\.ts so it fails, then run it: /m)
    expect(message).toMatch(/^\(2\) no test for this code yet: \/dope-tdd:pin pins what it does now$/m)
  })
})
