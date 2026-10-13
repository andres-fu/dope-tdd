import { describe, expect, test } from 'claude-code/testing'

import { fakeEngine, runBash, runCommand } from './engine'
import { MOCHA_FAIL, MOCHA_PASS, NODE_TEST_TAP_FAIL } from './fixtures/runnerOutputs'

describe('a runner dope-tdd cannot read yet is named once, not reported as unread on every run', () => {
  test('npm test running mocha: the agent is told once, the run is not counted, and /tdd says which runner', async ($, on) => {
    const world = fakeEngine(on)

    world.bashText = MOCHA_FAIL
    const first = await runBash($, 'npm test')
    world.bashText = MOCHA_PASS
    const second = await runBash($, 'npm test')
    const status = await runCommand($, 'tdd')

    expect(first.context?.join(' ')).toMatch(/cannot read mocha's summary yet/)
    expect(first.context?.join(' ')).not.toMatch(/summary line was not in the output/)
    expect((second.context ?? []).join(' ')).not.toMatch(/mocha/)
    expect(status.text).toMatch(/runs: 0 \(0 pass, 0 fail\)/)
    expect(status.text).toMatch(/not read: mocha/)
  })

  test('each runner is named once: node:test after mocha is said too', async ($, on) => {
    const world = fakeEngine(on)

    world.bashText = MOCHA_PASS
    await runBash($, 'npm test')
    world.bashText = NODE_TEST_TAP_FAIL
    const nodeTest = await runBash($, 'npm run test:unit')

    expect(nodeTest.context?.join(' ')).toMatch(/cannot read node:test's summary yet/)
    expect((await runCommand($, 'tdd')).text).toMatch(/not read: mocha, node:test/)
  })

  test('output nobody recognises is still an unread run, with the advice to keep the summary', async ($, on) => {
    const world = fakeEngine(on)

    world.bashText = 'some tests ran, the summary was cut\n'
    const run = await runBash($, 'npm test')

    expect(run.context?.join(' ')).toMatch(/summary line was not in the output/)
    expect((await runCommand($, 'tdd')).text).toMatch(/1 unread/)
  })
})
