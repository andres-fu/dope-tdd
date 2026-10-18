import { describe, expect } from 'claude-code/testing'

import { fakeEngine, runBash, runCommand, test, touchTest } from './engine'
import type { FakeWorld } from './engine'

// Kit runs (2026-10-18): `claude plugin test` output is read, so a plugin's kit tests see red and green like any other.
function kitOutput(failedFile: string | null, totals: { pass: number; fail: number }): string {
  return [
    'tests\\utils\\formatDuration.test.ts:',
    failedFile === 'tests/utils/formatDuration.test.ts' ? '(fail) formatDuration > formats months [3.10ms]' : '(pass) formatDuration > formats months [3.10ms]',
    '',
    'tests\\utils\\other.test.ts:',
    failedFile === 'tests/utils/other.test.ts' ? '(fail) other > works [1.00ms]' : '(pass) other > works [1.00ms]',
    '',
    ` ${totals.pass} pass`,
    ` ${totals.fail} fail`,
    `Ran ${totals.pass + totals.fail} tests across 2 files. [2.01s]`,
  ].join('\n')
}

async function kitRun($: Parameters<typeof runBash>[0], world: FakeWorld, failedFile: string | null) {
  world.bashFails = failedFile !== null
  world.bashText = kitOutput(failedFile, failedFile === null ? { pass: 2, fail: 0 } : { pass: 1, fail: 1 })
  return runBash($, 'claude plugin test .')
}

describe('a kit run is read like any other test run', () => {
  test("it fails in the module's own test: RED, then a passing run: GREEN", async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    await kitRun($, world, 'tests/utils/formatDuration.test.ts')
    expect((await runCommand($, 'tdd')).text).toMatch(/phase: RED/)

    await kitRun($, world, null)
    const status = (await runCommand($, 'tdd')).text
    expect(status).toMatch(/phase: GREEN/)
    expect(status).not.toMatch(/unread/)
  })

  test("it fails only in another file: not this module's red", async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    await kitRun($, world, 'tests/utils/other.test.ts')
    expect((await runCommand($, 'tdd')).text).not.toMatch(/phase: RED/)
  })
})
