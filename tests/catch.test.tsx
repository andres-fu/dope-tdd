import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { ROOT, editAt, fakeEngine, runBash, runCommand, runTests, startSession, touchTest } from './engine'
import type { FakeWorld } from './engine'

const SOURCE = `${ROOT}/src/utils/formatDuration.ts`
const TEST = `${ROOT}/tests/utils/formatDuration.test.ts`

async function fixUnderGuard($: Engine, world: FakeWorld) {
  world.fileContents.set(SOURCE, 'export const a = 1')
  await touchTest($, world, 'utils/formatDuration')
  await runTests($, world, 'fail')
  await editAt($, 'src/utils/formatDuration.ts')
}

describe('catches the change', () => {
  test('at green: puts the source back, runs only that test, expects it to fail, restores the source', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    world.catchRun = { text: ' Tests  1 failed (1)\n', exitCode: 1 }

    const result = await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(world.writes).toEqual([
      [SOURCE, 'export const a = 1'],
      [SOURCE, 'export const b = 1'],
    ])
    const run = world.gitCalls.find(argv => argv.some(arg => arg.includes('vitest.mjs')))
    expect(run).toEqual(['node', `${ROOT}/node_modules/vitest/vitest.mjs`, 'run', 'tests/utils/formatDuration.test.ts'])
    expect(world.fileContents.get(SOURCE)).toBe('export const b = 1')
    expect(status.text).toMatch(/caught 1/)
    expect(result.context?.join(' ')).toMatch(/its test catches the change/)
  })

  test('a test that still passes with the change undone is reported as missed, and the agent is told to fix the test', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    world.catchRun = { text: ' Tests  3 passed (3)\n', exitCode: 0 }

    const result = await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(world.fileContents.get(SOURCE)).toBe('export const b = 1')
    expect(status.text).toMatch(/missed 1/)
    expect(result.context?.join(' ')).toMatch(/does NOT catch the change/)
  })

  test('a check that times out is unverified and the source is still restored', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    world.catchRun = 'reject'

    const result = await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(world.fileContents.get(SOURCE)).toBe('export const b = 1')
    expect(status.text).toMatch(/unverified 1/)
    expect(result.context?.join(' ')).toMatch(/Could not verify.*timeout/)
  })

  test('a source changed outside the session is left alone', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    world.fileContents.set(SOURCE, 'export const b = 1 // edited in the IDE')

    const result = await runTests($, world, 'pass')

    expect(world.writes).toEqual([])
    expect(world.fileContents.get(SOURCE)).toBe('export const b = 1 // edited in the IDE')
    expect(result.context?.join(' ')).toMatch(/Could not verify.*changed outside/)
  })

  test('a cycle whose source edits all came through the shell is unchecked', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'fail')
    world.onBash = command => {
      world.numstat = command.includes('sed') ? '1\t1\tsrc/utils/formatDuration.ts\n' : world.numstat
    }
    await runBash($, "sed -i 's/a/b/' src/utils/formatDuration.ts")

    const result = await runTests($, world, 'pass')

    expect(world.writes).toEqual([])
    expect(result.context?.join(' ')).toMatch(/GREEN on utils.formatDuration, saw red\. Now refactor/)
  })

  test('a test written after the code, then a fix, is still checked on the next pass', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(SOURCE, 'export const a = 1')
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'pass')
    await editAt($, 'src/utils/formatDuration.ts')
    world.catchRun = { text: ' Tests  3 passed (3)\n', exitCode: 0 }

    const result = await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/missed 1/)
    expect(result.context?.join(' ')).toMatch(/has proven nothing yet/)
  })

  test('a refactor after a caught cycle is credited, not reverted', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    await runTests($, world, 'pass')
    const runsBefore = world.gitCalls.filter(argv => argv.some(arg => arg.includes('vitest.mjs'))).length
    world.fileContents.set(SOURCE, 'export const b = 1 // still b')
    await $.tool.call({ tool: 'Edit', file_path: SOURCE, old_string: ' // still b', new_string: ' // renamed' } as never)

    const result = await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')
    const runsAfter = world.gitCalls.filter(argv => argv.some(arg => arg.includes('vitest.mjs'))).length

    expect(runsAfter).toBe(runsBefore)
    expect(status.text).toMatch(/refactors 1/)
    expect(result.context?.join(' ')).toMatch(/Refactor credit/)
  })

  test('restoring the original text after breaking it on purpose is not a change to check', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(SOURCE, 'export const a = 1')
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'pass')
    await editAt($, 'src/utils/formatDuration.ts')
    await runTests($, world, 'fail')
    await $.tool.call({ tool: 'Edit', file_path: SOURCE, old_string: 'b', new_string: 'a' } as never)

    await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(world.writes).toEqual([])
    expect(status.text).not.toMatch(/catch check/)
    expect(status.text).toMatch(/never saw red 0/)
  })

  test('a source edit made through the shell is captured and checked too', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(SOURCE, 'export const a = 1')
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'fail')
    world.onBash = command => {
      if (command.includes('sed')) {
        world.fileContents.set(SOURCE, 'export const b = 1')
        world.numstat = '1\t1\tsrc/utils/formatDuration.ts\n'
      }
    }
    await runBash($, "sed -i 's/a/b/' src/utils/formatDuration.ts")
    world.catchRun = { text: ' Tests  1 failed (1)\n', exitCode: 1 }

    const result = await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(world.writes).toEqual([
      [SOURCE, 'export const a = 1'],
      [SOURCE, 'export const b = 1'],
    ])
    expect(status.text).toMatch(/caught 1/)
    expect(result.context?.join(' ')).toMatch(/its test catches the change/)
  })

  test('an interrupted check is repaired at the next session start', async ($, on) => {
    const world = fakeEngine(on, {
      store: { [`catch-journal:${ROOT}`]: { files: [{ path: SOURCE, text: 'export const b = 1' }] } },
    })

    await startSession($)

    expect(world.writes).toEqual([[SOURCE, 'export const b = 1']])
    expect(world.toasts.some(t => /restored/.test(t))).toBe(true)
  })

  test('the test file for the runner is the relative path even when the test was named absolutely', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)

    await runTests($, world, 'pass')

    const run = world.gitCalls.find(argv => argv.some(arg => arg.includes('vitest.mjs')))
    expect(run?.[3]).toBe('tests/utils/formatDuration.test.ts')
    expect(TEST.startsWith(ROOT)).toBe(true)
  })
})
