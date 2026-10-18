import { describe, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BAND, MINUTE, ROOT, editAt, fakeEngine, runCommand, test, touchTest, writeAt } from './engine'
import type { FakeWorld } from './engine'

// Override with a reason, v1 (2026-10-18): the agent asks, a person decides, the repo keeps the record.
const REQUEST = 'mcp__dope-tdd__override_request'
const RECORD = `${ROOT}/dope-tdd.overrides.json`
const REASON = 'trying two parsers for the run summary to see which handles Windows output; the loser is deleted'

function ask($: Engine, input: Record<string, unknown>) {
  return $.tool.call({ tool: REQUEST, path: 'src/utils/calculateDuration.ts', scope: 'change', kind: 'spike', reason: REASON, ...input } as never) as Promise<{ result?: string }>
}

function tdd($: Engine, args: string) {
  return $.command.run({ command: 'tdd', args } as never) as Promise<{ text: string }>
}

function record(world: FakeWorld): { overrides: { status: string; decidedBy: string | null; kind: string; scope: string; note: string | null; edits: string[] }[] } {
  return JSON.parse(world.fileContents.get(RECORD) ?? '{"overrides":[]}')
}

describe('a refused edit offers the cheap path first, then the override', () => {
  test('the refusal names the test, then pin, then the override request', async ($, on) => {
    fakeEngine(on)
    const refused = await editAt($, 'src/utils/calculateDuration.ts')
    expect(refused.deny).toMatch(/write the failing test first/)
    expect(refused.deny).toMatch(/\/dope-tdd:pin/)
    expect(refused.deny).toMatch(/mcp__dope-tdd__override_request/)
  })
})

describe('the agent asks, a person decides', () => {
  test('with a person there, the request waits; the edit stays refused until it is approved, then one edit goes through', async ($, on) => {
    const world = fakeEngine(on)
    const asked = await ask($, {})
    expect(asked.result).toMatch(/waiting for a person/)
    expect(asked.result).toMatch(/stop here/i)
    expect(world.toasts.join(' ')).toMatch(/override needs you/)
    expect((await editAt($, 'src/utils/calculateDuration.ts')).deny).toBeDefined()

    const approved = await tdd($, 'approve')
    expect(approved.text).toMatch(/approved/)
    expect((await editAt($, 'src/utils/calculateDuration.ts')).deny).toBeUndefined()
    expect((await editAt($, 'src/utils/calculateDuration.ts')).deny).toBeDefined()
    expect(record(world).overrides[0]).toMatchObject({ status: 'approved', decidedBy: 'human', edits: ['src/utils/calculateDuration.ts'] })
  })

  test('a denial is recorded with why, and the edit stays refused', async ($, on) => {
    const world = fakeEngine(on)
    await ask($, {})
    await tdd($, 'deny write the test first, it is one cycle')
    expect((await editAt($, 'src/utils/calculateDuration.ts')).deny).toBeDefined()
    expect(record(world).overrides[0]).toMatchObject({ status: 'denied', decidedBy: 'human', note: 'write the test first, it is one cycle' })
  })

  test('the band shows the request with APPROVE and DENY', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await ask($, {})
    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: /OVERRIDE REQUESTED/ })).toBeDefined()
    await ui.press({ key: 'approve' })
    expect(record(world).overrides[0]?.status).toBe('approved')
  })

  test('with nobody there, the request is denied at once: the agent stops and reports', async ($, on) => {
    const world = fakeEngine(on)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
    const asked = await ask($, {})
    expect(asked.result).toMatch(/denied: nobody is here to approve/)
    expect(record(world).overrides[0]).toMatchObject({ status: 'denied', decidedBy: 'unattended' })
  })

  test('a hotfix passes at once, is told to the person, and is debt until ended', async ($, on) => {
    const world = fakeEngine(on)
    const asked = await ask($, { kind: 'hotfix', reason: 'null check for the prod crash in #301, the test comes in the follow-up' })
    expect(asked.result).toMatch(/approved/)
    expect(world.toasts.join(' ')).toMatch(/hotfix/)
    expect((await editAt($, 'src/utils/calculateDuration.ts')).deny).toBeUndefined()
    expect((await runCommand($, 'tdd')).text).toMatch(/DEBT: no test yet/)
  })
})

describe('a module override lasts until it is ended', () => {
  test('approved, it lets every edit to the module through and shows on the band; ended, the guard is back', async ($, on) => {
    const world = fakeEngine(on)
    await ask($, { scope: 'module', until: 'the spike PR closes' })
    await tdd($, 'approve')
    expect((await editAt($, 'src/utils/calculateDuration.ts')).deny).toBeUndefined()
    expect((await editAt($, 'src/utils/calculateDuration.ts')).deny).toBeUndefined()

    await touchTest($, world, 'utils/formatDuration')
    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: '1 OVERRIDE OPEN' })).toBeDefined()

    await tdd($, 'override end utils/calculateDuration')
    expect((await editAt($, 'src/utils/calculateDuration.ts')).deny).toBeDefined()
  })
})

describe('the mechanical checks and the bar', () => {
  test('an incomplete request is refused before anyone is asked, and nothing is recorded', async ($, on) => {
    const world = fakeEngine(on)
    const asked = await ask($, { reason: 'blocked' })
    expect(asked.result).toMatch(/refused: the reason must say what, why and what happens next/)
    expect(world.toasts).toEqual([])
    expect(world.fileContents.has(RECORD)).toBe(false)
  })

  test('a second request while one waits is refused', async ($, on) => {
    fakeEngine(on)
    await ask($, {})
    expect((await ask($, {})).result).toMatch(/already waiting/)
  })

  test('the person is told when a request repeats', async ($, on) => {
    const world = fakeEngine(on)
    await ask($, {})
    await tdd($, 'deny write the test first, it is one cycle')
    await ask($, {})
    expect(world.toasts.at(-1)).toMatch(/2nd override request on utils\/calculateDuration this week/)
  })

  test('the agent cannot write the record itself', async ($, on) => {
    fakeEngine(on)
    const forged = await writeAt($, 'dope-tdd.overrides.json', '{"overrides":[]}')
    expect(forged.deny).toMatch(/dope-tdd keeps this record/)
  })
})

describe('pause: a reason and a time, never a switch', () => {
  test('/tdd off says how to pause instead', async ($, on) => {
    fakeEngine(on)
    expect((await tdd($, 'off')).text).toMatch(/\/tdd pause <minutes> <reason>/)
  })

  test('a pause lets edits through, ends on its own, and says what happened while it was on', async ($, on) => {
    const world = fakeEngine(on)
    const paused = await tdd($, 'pause 30 pairing on the prod incident in #301 and back after')
    expect(paused.text).toMatch(/paused for 30 minutes/)
    expect((await editAt($, 'src/utils/calculateDuration.ts')).deny).toBeUndefined()

    await world.clock.advance(31 * MINUTE)
    expect((await editAt($, 'src/utils/calculateDuration.ts')).deny).toBeDefined()
    expect(world.toasts.join(' ')).toMatch(/back on after 30m \(pairing on the prod incident in #301 and back after\): 1 edit to 1 file while paused/)
    expect((await runCommand($, 'tdd')).text).toMatch(/DEBT: 1 edit untested/)
  })

  test('a pause with no reason is refused', async ($, on) => {
    fakeEngine(on)
    expect((await tdd($, 'pause 30')).text).toMatch(/the reason must say what, why and what happens next/)
  })

  test('resume ends a pause early, and the band offers it while paused', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await tdd($, 'pause 30 pairing on the prod incident in #301 and back after')
    const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Button', text: 'PAUSE GUARD' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', text: 'RESUME' })).toBeDefined()
    await ui.press({ key: 'resume' })
    expect((await editAt($, 'src/utils/calculateDuration.ts')).deny).toBeDefined()
  })
})
