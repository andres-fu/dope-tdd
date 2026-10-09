import { describe, expect, test } from 'claude-code/testing'

import { MINUTE, ROOT, SOURCE, T0, editAt, fakeEngine, fixUnderGuard, runBash, runCommand, runTests, startSession, touchTest, writeAt } from './engine'

const TEST = `${ROOT}/tests/utils/formatDuration.test.ts`
const KEPT = `${SOURCE}.dope-tdd.kept`

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

  test('a runner that crashes with the change undone is unverified, never caught: an exit code is not evidence', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    world.catchRun = { text: 'Error: Cannot find module vitest.config.ts\n', exitCode: 1 }

    const result = await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(world.fileContents.get(SOURCE)).toBe('export const b = 1')
    expect(status.text).toMatch(/caught 0 · missed 0 · unverified 1/)
    expect(result.context?.join(' ')).toMatch(/Could not verify.*no runner summary/)
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

  test('a new source file is unverified, not caught: undoing it would mean deleting it', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/fresh')
    await runTests($, world, 'fail')
    await writeAt($, 'src/utils/fresh.ts', 'export const fresh = 1')

    const result = await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(world.writes).toEqual([])
    expect(status.text).toMatch(/unverified 1/)
    expect(result.context?.join(' ')).toMatch(/Could not verify.*new file/)
  })

  test('a shell edit to a file that could not be read before or after is unverified, not silently green', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'fail')
    world.onBash = command => {
      world.numstat = command.includes('sed') ? '1\t1\tsrc/utils/formatDuration.ts\n' : world.numstat
    }
    await runBash($, "sed -i 's/a/b/' src/utils/formatDuration.ts")

    const result = await runTests($, world, 'pass')

    expect(world.writes).toEqual([])
    expect(result.context?.join(' ')).toMatch(/Could not verify.*change not captured/)
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

  test('a refactor after a caught cycle is named, not reverted', async ($, on) => {
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
    expect(result.context?.join(' ')).toMatch(/a refactor, not re-checked/)
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

  test('the test file for the runner is the relative path even when the test was named absolutely', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)

    await runTests($, world, 'pass')

    const run = world.gitCalls.find(argv => argv.some(arg => arg.includes('vitest.mjs')))
    expect(run?.[3]).toBe('tests/utils/formatDuration.test.ts')
    expect(TEST.startsWith(ROOT)).toBe(true)
  })
})

describe('one module at a time', () => {
  const A = `${ROOT}/src/utils/a.ts`
  const B = `${ROOT}/src/utils/b.ts`

  test('only the module whose test ran is reverted and checked; the other waits for its own green', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(A, 'export const a = 1')
    world.fileContents.set(B, 'export const value = 2')
    await touchTest($, world, 'utils/a')
    await touchTest($, world, 'utils/b')
    await runTests($, world, 'fail')
    await editAt($, 'src/utils/a.ts')
    await editAt($, 'src/utils/b.ts')
    world.bashFails = false

    await runBash($, 'npx vitest run tests/utils/b.test.ts')
    const afterB = world.writes.slice()
    await runBash($, 'npx vitest run tests/utils/a.test.ts')
    const status = await runCommand($, 'tdd')

    expect(afterB).toEqual([
      [B, 'export const value = 2'],
      [B, 'export const vblue = 2'],
    ])
    expect(world.writes.slice(2)).toEqual([
      [A, 'export const a = 1'],
      [A, 'export const b = 1'],
    ])
    expect(status.text).toMatch(/caught 2/)
  })
})

describe('the revert is safe', () => {
  test('a restore that fails is unverified, says so, keeps the journal, and does not leave the lock held', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    world.writeFails = (_path, text) => text === 'export const b = 1'

    const result = await runTests($, world, 'pass')
    const retry = await editAt($, 'src/utils/formatDuration.ts')
    const status = await runCommand($, 'tdd')

    expect(result.context?.join(' ')).toMatch(/Could not verify.*restore failed/)
    expect(world.toasts.some(t => /could not restore/.test(t))).toBe(true)
    expect(retry.deny).toBeUndefined()
    expect(status.text).toMatch(/unverified 1/)
  })

  test('a revert that fails is unverified and the file is untouched', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    world.writeFails = (_path, text) => text === 'export const a = 1'

    const result = await runTests($, world, 'pass')

    expect(world.fileContents.get(SOURCE)).toBe('export const b = 1')
    expect(world.gitCalls.some(argv => argv.some(arg => arg.includes('vitest.mjs')))).toBe(false)
    expect(result.context?.join(' ')).toMatch(/Could not verify.*revert failed/)
  })

  test('a file edited by hand while it was reverted is left as it is, and the change is kept beside it', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    world.onCatchRun = () => {
      world.fileContents.set(SOURCE, 'export const a = 1 // hand edit during the check')
    }

    const result = await runTests($, world, 'pass')

    expect(world.fileContents.get(SOURCE)).toBe('export const a = 1 // hand edit during the check')
    expect(world.writes).toEqual([
      [SOURCE, 'export const a = 1'],
      [KEPT, 'export const b = 1'],
    ])
    expect(result.context?.join(' ')).toMatch(/Could not verify.*changed during check/)
    expect(world.toasts.some(t => /left as is; your change is in src\/utils\/formatDuration\.ts\.dope-tdd\.kept/.test(t))).toBe(true)
  })

  test('a test run while a file is reverted is refused, so it cannot read the reverted file', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    let inner: { deny?: string } | null = null
    world.onCatchRun = async () => {
      inner = await runBash($, 'npx vitest run tests/utils/b.test.ts')
    }

    await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect((inner as { deny?: string } | null)?.deny).toMatch(/verifying that the test for utils\/formatDuration catches the change/)
    expect(status.text).toMatch(/caught 1/)
    expect(world.fileContents.get(SOURCE)).toBe('export const b = 1')
  })

  test('an interrupted check is repaired at the next session start when the file is still reverted', async ($, on) => {
    const world = fakeEngine(on, {
      store: { [`catch-journal:${ROOT}`]: { files: [{ path: SOURCE, before: 'export const a = 1', after: 'export const b = 1' }] } },
    })
    world.fileContents.set(SOURCE, 'export const a = 1')

    await startSession($)

    expect(world.writes).toEqual([[SOURCE, 'export const b = 1']])
    expect(world.toasts.some(t => /restored 1 file/.test(t))).toBe(true)
  })

  test('a journal keyed by the normalised root (a lower-case drive) is repaired the same way', async ($, on) => {
    const world = fakeEngine(on, {
      store: { [`catch-journal:${ROOT.replace(/^C:/, 'c:')}:utils/formatDuration`]: { files: [{ path: SOURCE, before: 'export const a = 1', after: 'export const b = 1' }] } },
    })
    world.fileContents.set(SOURCE, 'export const a = 1')

    await startSession($)

    expect(world.writes).toEqual([[SOURCE, 'export const b = 1']])
  })

  test('a file that moved since the interrupted check is left alone, the change is kept beside it, and the user is told', async ($, on) => {
    const world = fakeEngine(on, {
      store: { [`catch-journal:${ROOT}:utils/formatDuration`]: { files: [{ path: SOURCE, before: 'export const a = 1', after: 'export const b = 1' }] } },
    })
    world.fileContents.set(SOURCE, 'export const a = 1 // fixed by hand')

    await startSession($)

    expect(world.writes).toEqual([[KEPT, 'export const b = 1']])
    expect(world.fileContents.get(SOURCE)).toBe('export const a = 1 // fixed by hand')
    expect(world.toasts.some(t => /left 1 file/.test(t))).toBe(true)
  })

  test('an interrupted check is repaired on the next tool call when no session start ran, as after a hot reload', async ($, on) => {
    const world = fakeEngine(on, {
      store: { [`catch-journal:${ROOT}:utils/formatDuration`]: { files: [{ path: SOURCE, before: 'export const a = 1', after: 'export const b = 1' }] } },
    })
    world.fileContents.set(SOURCE, 'export const a = 1')

    await editAt($, 'docs/notes.md')

    expect(world.writes).toEqual([[SOURCE, 'export const b = 1']])
    expect(world.toasts.some(t => /restored 1 file/.test(t))).toBe(true)
  })

  test('a file already back at its text after an interrupted check needs nothing', async ($, on) => {
    const world = fakeEngine(on, {
      store: { [`catch-journal:${ROOT}`]: { files: [{ path: SOURCE, before: 'export const a = 1', after: 'export const b = 1' }] } },
    })
    world.fileContents.set(SOURCE, 'export const b = 1')

    await startSession($)

    expect(world.writes).toEqual([])
    expect(world.toasts).toEqual([])
  })
})

describe('finding the runner', () => {
  test('a runner hoisted to a parent directory is found, so a monorepo package gets checked', async ($, on) => {
    const world = fakeEngine(on)
    world.hasVitest = false
    world.existingFiles.add('C:/work/node_modules/vitest/vitest.mjs')
    await fixUnderGuard($, world)

    await runTests($, world, 'pass')

    const run = world.gitCalls.find(argv => argv.some(arg => arg.includes('vitest.mjs')))
    expect(run?.[1]).toBe('C:/work/node_modules/vitest/vitest.mjs')
  })

  test('with no runner anywhere the check is unverified and says so', async ($, on) => {
    const world = fakeEngine(on)
    world.hasVitest = false
    await fixUnderGuard($, world)

    const result = await runTests($, world, 'pass')

    expect(world.writes).toEqual([])
    expect(result.context?.join(' ')).toMatch(/Could not verify.*no runner found/)
  })
})

describe('what the check cannot see is said, not skipped', () => {
  test('a source change the backstop saw but the capture did not is unverified: change not captured', async ($, on) => {
    const world = fakeEngine(on)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'fail')
    world.onBash = command => {
      world.numstat = command.includes('git apply') ? '1\t1\tsrc/utils/formatDuration.ts\n' : world.numstat
    }
    await runBash($, 'git apply fix.patch')

    const result = await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(world.writes).toEqual([])
    expect(result.context?.join(' ')).toMatch(/Could not verify.*change not captured/)
    expect(status.text).toMatch(/unverified 1/)
  })

  test('a file that exists but cannot be read before the edit is unverified with that reason', async ($, on) => {
    const world = fakeEngine(on)
    world.unreadable.add(SOURCE)
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'fail')
    await editAt($, 'src/utils/formatDuration.ts')

    const result = await runTests($, world, 'pass')

    expect(world.writes).toEqual([])
    expect(result.context?.join(' ')).toMatch(/Could not verify.*could not read the file before the edit/)
  })

  test('an edit under an unlock inherited from an earlier session is checked, never credited as a refactor', async ($, on) => {
    const world = fakeEngine(on, {
      store: { [`unlocks:${ROOT}`]: { 'utils/formatDuration': { testPath: TEST, atMs: T0 - 60 * MINUTE } } },
    })
    await startSession($)
    await touchTest($, world, 'utils/a')
    await runTests($, world, 'fail')
    await runTests($, world, 'pass')
    world.fileContents.set(SOURCE, 'export const a = 1')
    await editAt($, 'src/utils/formatDuration.ts')

    await runBash($, 'npx vitest run tests/utils/formatDuration.test.ts')
    const status = await runCommand($, 'tdd')

    expect(world.writes).toEqual([
      [SOURCE, 'export const a = 1'],
      [SOURCE, 'export const b = 1'],
    ])
    expect(status.text).toMatch(/caught 1/)
    expect(status.text).not.toMatch(/refactors 1/)
  })
})
