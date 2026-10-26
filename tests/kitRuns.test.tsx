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

// #165, seen dogfooding on agent-os: a full suite with failures in other modules, redirected to a file and grepped
// down to node --test's totals, turned the module just proven RED. Totals alone cannot say which module failed.
describe('a suite run thinned to its totals', () => {
  test("its red is not this module's red", async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    world.bashFails = false
    world.bashText = 'ℹ tests 277\nℹ pass 268\nℹ fail 9\n'
    const red = await runBash($, 'npm test > full.txt 2>&1; grep -E "^ℹ (tests|pass|fail)" full.txt')
    expect(red.context?.join(' ') ?? '').not.toMatch(/RED on utils\/formatDuration/)
    expect((await runCommand($, 'tdd')).text).not.toMatch(/phase: RED/)
  })
})

// Seen live 2026-10-18: `node --test tools/pr-check/check.spec-node.ts`, a spec outside the layout, failed and then
// passed while `reviewer` was the current module, and dope-tdd said "RED on reviewer", then "GREEN on reviewer, saw red".
describe('a run of a file outside the layout is not the current module\'s', () => {
  const OUTSIDE_FAIL = '✖ check (1.2ms)\nℹ tests 1\nℹ suites 0\nℹ pass 0\nℹ fail 1\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 90.1\n'
  const OUTSIDE_PASS = '✔ check (1.2ms)\nℹ tests 1\nℹ suites 0\nℹ pass 1\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 90.1\n'

  test('its red is not this module\'s red, and its green closes no cycle', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')

    world.bashFails = true
    world.bashText = OUTSIDE_FAIL
    const red = await runBash($, 'node --test tools/pr-check/check.spec-node.ts')
    expect(red.context?.join(' ') ?? '').not.toMatch(/RED on utils\/formatDuration/)
    expect((await runCommand($, 'tdd')).text).not.toMatch(/phase: RED/)

    world.bashFails = false
    world.bashText = OUTSIDE_PASS
    const green = await runBash($, 'node --test tools/pr-check/check.spec-node.ts')
    expect(green.context?.join(' ') ?? '').not.toMatch(/GREEN on utils\/formatDuration/)
    const status = (await runCommand($, 'tdd')).text
    expect(status).toMatch(/^cycles: 0$/m)
    expect(status).not.toMatch(/phase: GREEN/)
  })
})
