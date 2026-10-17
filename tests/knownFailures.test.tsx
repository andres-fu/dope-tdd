import { describe, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { SOURCE, editAt, fakeEngine, runBash, runCommand, test, touchTest } from './engine'
import type { FakeWorld } from './engine'

/**
 * Seen on nanocoder (2026-10-10): a test file with 11 failures that were there before any change never goes green,
 * so the module stays RED and its fix is never checked. Old code with some broken tests is the main use case, so the
 * plugin judges by which tests fail: the old failures do not hide a real red, and do not block a real green.
 */
const FILE = 'tests/utils/formatDuration.test.ts'
const RUN = `npx vitest run ${FILE}`
const failing = (...names: string[]) =>
  `${names.map(name => ` FAIL  ${FILE} > ${name}`).join('\n')}\n\n Test Files  1 failed (1)\n      Tests  ${names.length} failed | 4 passed (${names.length + 4})\n`

async function redWithAnOldFailure($: Engine, world: FakeWorld) {
  world.fileContents.set(SOURCE, 'export const a = 1')
  await touchTest($, world, 'utils/formatDuration')
  world.bashFails = true
  world.bashText = failing('old: breaks on windows', 'new: formats months')
  await runBash($, RUN)
  await editAt($, 'src/utils/formatDuration.ts')
}

describe('tests that were already failing', () => {
  test('a fix that leaves only the old failure is green apart from it, and its check catches the new test', async ($, on) => {
    const world = fakeEngine(on)
    await redWithAnOldFailure($, world)
    world.bashText = failing('old: breaks on windows')
    world.baselineRun = { text: failing('old: breaks on windows'), exitCode: 1 }
    world.catchRun = { text: failing('old: breaks on windows', 'new: formats months'), exitCode: 1 }

    const green = await runBash($, RUN)
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/phase: GREEN/)
    expect(status.text).toMatch(/caught 1/)
    expect(green.context?.join(' ')).toMatch(/apart from 1 test that was already failing before your change: \S+ > old: breaks on windows/)
  })

  test('a check where only the old failure fails again has caught nothing: MISSED', async ($, on) => {
    const world = fakeEngine(on)
    await redWithAnOldFailure($, world)
    world.bashText = failing('old: breaks on windows')
    world.baselineRun = { text: failing('old: breaks on windows'), exitCode: 1 }
    world.catchRun = { text: failing('old: breaks on windows'), exitCode: 1 }

    await runBash($, RUN)
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/missed 1/)
  })

  test('after that, a run with only the old failure stays green', async ($, on) => {
    const world = fakeEngine(on)
    await redWithAnOldFailure($, world)
    world.bashText = failing('old: breaks on windows')
    world.baselineRun = { text: failing('old: breaks on windows'), exitCode: 1 }
    world.catchRun = { text: failing('old: breaks on windows', 'new: formats months'), exitCode: 1 }
    await runBash($, RUN)

    await runBash($, RUN)
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/phase: GREEN/)
  })

  test('output cut by tail (only the summary left) is completed by the plugin running the file itself, so the names are read', async ($, on) => {
    const world = fakeEngine(on)
    const summaryOnly = (n: number) => `\n Test Files  1 failed (1)\n      Tests  ${n} failed | 4 passed (${n + 4})\n`
    world.fileContents.set(SOURCE, 'export const a = 1')
    await touchTest($, world, 'utils/formatDuration')
    world.bashFails = true
    world.bashText = summaryOnly(2)
    world.namesRun = failing('old: breaks on windows', 'new: formats months')
    await runBash($, `${RUN} 2>&1 | tail -3`)
    await editAt($, 'src/utils/formatDuration.ts')
    world.bashText = summaryOnly(1)
    world.namesRun = failing('old: breaks on windows')
    world.baselineRun = { text: failing('old: breaks on windows'), exitCode: 1 }
    world.catchRun = { text: failing('old: breaks on windows', 'new: formats months'), exitCode: 1 }

    await runBash($, `${RUN} 2>&1 | tail -3`)
    const status = await runCommand($, 'tdd')

    expect(world.namesCalls).toBe(2)
    expect(status.text).toMatch(/phase: GREEN/)
    expect(status.text).toMatch(/caught 1/)
  })

  test('the run counts for the module whose test file it names, even when another module was touched last (seen on nanocoder)', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(SOURCE, 'export const a = 1')
    await touchTest($, world, 'utils/formatDuration')
    await touchTest($, world, 'utils/other')
    world.bashFails = true
    world.bashText = failing('old: breaks on windows', 'new: formats months')
    await runBash($, RUN)
    await editAt($, 'src/utils/formatDuration.ts')
    await touchTest($, world, 'utils/other')
    world.bashText = failing('old: breaks on windows')
    world.baselineRun = { text: failing('old: breaks on windows'), exitCode: 1 }
    world.catchRun = { text: failing('old: breaks on windows', 'new: formats months'), exitCode: 1 }

    const green = await runBash($, RUN)

    expect(green.context?.join(' ')).toMatch(/utils\/formatDuration is green apart from 1 test/)
  })

  test('a run filtered to some tests by name proves nothing about the rest: never green this way', async ($, on) => {
    const world = fakeEngine(on)
    await redWithAnOldFailure($, world)
    world.bashText = failing('old: breaks on windows')

    await runBash($, `${RUN} --match "old*"`)
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/phase: RED/)
  })

  test('a test that fails now and was not failing before is red, old failures or not', async ($, on) => {
    const world = fakeEngine(on)
    await redWithAnOldFailure($, world)
    world.bashText = failing('old: breaks on windows', 'new: rounds down')

    await runBash($, RUN)
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/phase: RED/)
  })
})
