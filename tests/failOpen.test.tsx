import { describe, expect } from 'claude-code/testing'

import { editAt, fakeEngine, runBash, runCommand, startSession, test } from './engine'

/**
 * The mods docs: a hook that fails is skipped, and its `.catch` handler
 * answers in its place. Dope TDD fails open, on the record: the call goes
 * through once, the log says which guard failed and why, and one toast says
 * it happened.
 */
describe('a guard that fails lets the call through, once, and says so', () => {
  test('a shell command whose guard cannot read the project root runs once, unrefused, with the failure logged', async ($, on) => {
    const world = fakeEngine(on)
    await startSession($)
    world.rootFails = true
    let ran = 0
    world.onBash = () => {
      ran += 1
    }

    const result = (await runBash($, 'echo hi')) as { deny?: string }

    expect(result.deny).toBeUndefined()
    expect(ran).toBe(1)
    expect(world.logs.some(line => /the Bash guard failed \(throw: .*the project root could not be read\) and let the call through/.test(line))).toBe(true)
    expect(world.toasts.filter(t => /internal error/.test(t)).length).toBe(1)
  })

  // Verified review A13 (2026-10-20): after the one toast the session looked guarded; /tdd now says it is not.
  test('/tdd says the guard is failing, with how many calls it let through', async ($, on) => {
    const world = fakeEngine(on)
    await startSession($)
    world.rootFails = true
    await runBash($, 'echo hi')
    await runBash($, 'echo again')
    world.rootFails = false

    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/^guard: FAILING \(2 calls went through unguarded after an internal error; see the log\)$/m)
  })

  test('an Edit under the same failure is not refused, and the toast is not repeated', async ($, on) => {
    const world = fakeEngine(on)
    await startSession($)
    world.rootFails = true

    const first = (await editAt($, 'src/utils/formatDuration.ts')) as { deny?: string }
    const second = (await editAt($, 'src/utils/formatDuration.ts')) as { deny?: string }

    expect(first.deny).toBeUndefined()
    expect(second.deny).toBeUndefined()
    expect(world.logs.filter(line => /the Edit guard failed/.test(line)).length).toBe(2)
    expect(world.toasts.filter(t => /internal error/.test(t)).length).toBe(1)
  })

  test('the status tool answers with the failure instead of nothing', async ($, on) => {
    const world = fakeEngine(on)
    await startSession($)
    world.rootFails = true

    const result = (await $.tool.call({ tool: 'mcp__dope-tdd__status' } as never)) as { result?: unknown }

    expect(String(result.result)).toMatch(/the status could not be read \(throw\); try \/tdd/)
  })
})
