import { describe, expect, test } from 'claude-code/testing'

import { FIXTURE_DRIVE, MINUTE, ROOT, SOURCE, T0, editAt, fakeEngine, fixUnderGuard, runBash, runCommand, runTests, startSession, touchTest, writeAt } from './engine'

/** A home folder on the fixture drive, so it resolves the same way the root does on any host. */
const HOME_DIR = `${FIXTURE_DRIVE}Users/tester`

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

  test('the check first runs the test as it stands under its own command; a red there is no verdict, and nothing is reverted', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    world.baselineRun = { text: ' Tests  1 failed (1)\n', exitCode: 1 }
    world.catchRun = { text: ' Tests  1 failed (1)\n', exitCode: 1 }

    await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(world.writes).toEqual([])
    expect(status.text).toMatch(/caught 0/)
    expect(status.text).toMatch(/unverified 1/)
  })

  test('the baseline runs once per module in a session, not on every green', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    world.catchRun = { text: ' Tests  1 failed (1)\n', exitCode: 1 }
    await runTests($, world, 'pass')
    await runTests($, world, 'fail')
    await editAt($, 'src/utils/formatDuration.ts')
    await runTests($, world, 'pass')

    expect(world.baselineCalls).toBe(1)
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
    // The agent is shown what slipped past the test, so it can write the assertion.
    expect(result.context?.join(' ')).toMatch(/The change it did not notice:\n  - export const a = 1\n  \+ export const b = 1\nAdd an assertion that fails without it\./)
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
    expect(status.text).toMatch(/caught 0 · proven 0 · missed 0 · unverified 1/)
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
    // Never beside caught and proven: a refactor is not a verdict on the test.
    expect(status.text).toMatch(/^refactors: 1 \(changed while green with the test untouched; not re-checked\)$/m)
    expect(status.text).not.toMatch(/catch check:.*refactors/)
    expect(result.context?.join(' ')).toMatch(/a refactor, not re-checked/)
    expect(result.context?.join(' ')).toMatch(/If it changed what the code does, that has no test yet: write one first/)
  })

  test('restoring the original text after breaking it on purpose leaves nothing to revert: no file is touched, and the red is the proof', async ($, on) => {
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
    expect(status.text).toMatch(/proven 1/)
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
    // Only the baseline ran, on the code as it stands; nothing ran against a revert that never happened.
    expect(world.gitCalls.filter(argv => argv.some(arg => arg.includes('vitest.mjs'))).length).toBe(world.baselineCalls)
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
    world.existingFiles.add(`${FIXTURE_DRIVE}work/node_modules/vitest/vitest.mjs`)
    await fixUnderGuard($, world)

    await runTests($, world, 'pass')

    const run = world.gitCalls.find(argv => argv.some(arg => arg.includes('vitest.mjs')))
    expect(run?.[1]).toBe(`${FIXTURE_DRIVE}work/node_modules/vitest/vitest.mjs`)
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

describe('/tdd receipt', () => {
  test('prints the status and the two commands a reviewer runs, for the current module', async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)
    world.catchRun = { text: ' Tests  1 failed (1)\n', exitCode: 1 }
    await runTests($, world, 'pass')

    const receipt = await $.command.run({ command: 'tdd', args: 'receipt' } as never)

    expect(receipt.text).toMatch(/^dope-tdd receipt for utils\/formatDuration/)
    expect(receipt.text).toMatch(/caught 1/)
    expect(receipt.text).toMatch(/npx vitest run tests\/utils\/formatDuration\.test\.ts/)
    // Never the stash: on a committed change it saves nothing, and the pop applies the reviewer's own stash.
    expect(receipt.text).not.toMatch(/stash/)
    expect(receipt.text).toMatch(/git checkout main -- src\/utils\/formatDuration\.ts\nnpx vitest run tests\/utils\/formatDuration\.test\.ts\ngit checkout HEAD -- src\/utils\/formatDuration\.ts/)
    expect(receipt.text).toMatch(/The first run passes\. The second runs the same test against the code on main, before the change, and fails/)
  })

  test('names the module when asked, keeping its case, and says when nothing is current', async ($, on) => {
    const world = fakeEngine(on)
    const empty = await $.command.run({ command: 'tdd', args: 'receipt' } as never)
    expect(empty.text).toMatch(/No module is current/)

    await touchTest($, world, 'utils/formatDuration')
    const named = await $.command.run({ command: 'tdd', args: 'receipt utils/formatDuration' } as never)
    expect(named.text).toMatch(/^dope-tdd receipt for utils\/formatDuration/)
    expect(named.text).toMatch(/No change to utils\/formatDuration is on record/)
  })
})

describe('PROVEN: break, red, restore, green', () => {
  async function restore($: Parameters<typeof runCommand>[0]) {
    return $.tool.call({ tool: 'Edit', file_path: SOURCE, old_string: 'b', new_string: 'a' } as never)
  }

  test('pins that went red on a deliberate break and green on the restored code are proven, and the agent is told', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(SOURCE, 'export const a = 1')
    await touchTest($, world, 'utils/formatDuration')
    await runTests($, world, 'pass')
    await editAt($, 'src/utils/formatDuration.ts')
    await runTests($, world, 'fail')
    await restore($)

    const green = await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(world.fileContents.get(SOURCE)).toBe('export const a = 1')
    expect(green.context?.join(' ')).toMatch(/the code is back exactly as it was before your break\. The red you saw is the proof .*: PROVEN/)
    expect(status.text).toMatch(/catch check: caught 0 · proven 1 · missed 0/)
    // No runner was started: there was nothing to revert.
    expect(world.gitCalls.some(argv => argv.some(arg => arg.includes('vitest.mjs')))).toBe(false)
  })

  test('a test edited after the red with the code restored is not proof: that stays TEST CHANGED', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(SOURCE, 'export const a = 1')
    await touchTest($, world, 'utils/formatDuration')
    await editAt($, 'src/utils/formatDuration.ts')
    await runTests($, world, 'fail')
    await touchTest($, world, 'utils/formatDuration')
    await restore($)

    await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(status.text).not.toMatch(/proven 1/)
  })
})

describe('the catch check stays out of the way', () => {
  test('"catchCheck": false in dope-tdd.json: a green is never reverted or re-run, and the status says the check is off', async ($, on) => {
    const world = fakeEngine(on)
    world.fileContents.set(`${ROOT}/dope-tdd.json`, '{"catchCheck":false}')
    await fixUnderGuard($, world)

    await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(world.writes.filter(([path]) => path === SOURCE)).toEqual([])
    expect(world.baselineCalls).toBe(0)
    expect(status.text).toMatch(/catch check: off/)
  })

  test('a session that ends mid-check puts the change back on its way out', async ($, on) => {
    const world = fakeEngine(on, {
      store: { [`catch-journal:${ROOT}:utils/formatDuration`]: { files: [{ path: SOURCE, before: 'export const a = 1', after: 'export const b = 1' }] } },
    })
    world.fileContents.set(SOURCE, 'export const a = 1')

    await $.session.end({ reason: 'prompt_input_exit', sessionId: 's', resume: { id: 's' } } as never)

    expect(world.fileContents.get(SOURCE)).toBe('export const b = 1')
  })

  test('a change kept aside goes under the home folder, never into the repository where git add -A would take it', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME: HOME_DIR } })
    await fixUnderGuard($, world)
    world.onCatchRun = () => {
      world.fileContents.set(SOURCE, 'export const a = 1 // hand edit during the check')
    }

    await runTests($, world, 'pass')

    const kept = world.writes.find(([, text]) => text === 'export const b = 1')
    expect(kept?.[0]).toBe(`${HOME_DIR}/.dope-tdd/kept/throughline/src/utils/formatDuration.ts`)
    expect(world.toasts.some(t => t.includes(`your change is in ${HOME_DIR}/.dope-tdd/kept/throughline/src/utils/formatDuration.ts`))).toBe(true)
  })
})

describe('the catch check in a worktree, never in your files', () => {
  const WT = `${ROOT}/.git/dope-tdd/wt`
  const gitRepo = (world: ReturnType<typeof fakeEngine>) => world.existingFiles.add(`${ROOT}/.git/HEAD`)

  test('a vitest project in a git checkout: your file is never written; the old code runs in a worktree that is removed after', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME: HOME_DIR } })
    gitRepo(world)
    await fixUnderGuard($, world)
    world.catchRun = { text: ' Tests  1 failed (1)\n', exitCode: 1 }

    await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(world.writes.filter(([path]) => path === SOURCE)).toEqual([])
    expect(world.writes).toContainEqual([`${WT}/src/utils/formatDuration.ts`, 'export const a = 1'])
    const check = world.gitCalls.findIndex((argv, i) => argv.some(arg => arg.includes('vitest.mjs')) && world.runCwds[i] === WT)
    expect(check).toBeGreaterThan(-1)
    expect(world.gitCalls.some(argv => argv.join(' ').startsWith('git worktree add --detach'))).toBe(true)
    expect(world.gitCalls.some(argv => argv.join(' ') === `git worktree remove --force ${WT}`)).toBe(true)
    expect(world.fileContents.get(SOURCE)).toBe('export const b = 1')
    expect(status.text).toMatch(/caught 1/)
    await $.session.end({ reason: 'other', sessionId: 'wt', resume: { id: 'wt' } } as never)
    const record = world.writes.find(([path]) => path.includes('/.dope-tdd/sessions/'))
    expect(JSON.parse(record?.[1] ?? '{}').worktreeChecks).toBe(1)
  })

  test('a new file is checked with small changes to it in the worktree: one turns the test red, so PROVEN, and the rest are named (#27)', async ($, on) => {
    const world = fakeEngine(on)
    gitRepo(world)
    await touchTest($, world, 'utils/fresh')
    await runTests($, world, 'fail')
    await writeAt($, 'src/utils/fresh.ts', 'export const fresh = (a) => a === 1')
    // The first mutant (=== → !==) turns the test red; the second (1 → 2) slips through.
    let mutantRuns = 0
    world.catchRun = { text: ' Tests  1 failed (1)\n', exitCode: 1 }
    world.onCatchRun = () => {
      mutantRuns++
      if (mutantRuns === 2) {
        world.catchRun = { text: ' Tests  1 passed (1)\n', exitCode: 0 }
      }
    }

    const result = await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(mutantRuns).toBe(2)
    expect(world.writes.filter(([path]) => path === `${ROOT}/src/utils/fresh.ts`)).toEqual([])
    expect(world.writes).toContainEqual([`${WT}/src/utils/fresh.ts`, 'export const fresh = (a) => a !== 1'])
    expect(world.writes).toContainEqual([`${WT}/src/utils/fresh.ts`, 'export const fresh = (a) => a === 2'])
    expect(status.text).toMatch(/proven 1/)
    const said = result.context?.join(' ') ?? ''
    expect(said).toMatch(/utils\/fresh is a new file: dope-tdd changed it 2 ways in a throwaway copy and the test failed for 1, so it is PROVEN\./)
    expect(said).toMatch(/line 1: `1` → `2`/)
  })

  test('a new file whose test passes with every change made to it is MISSED, and each change is named (#27)', async ($, on) => {
    const world = fakeEngine(on)
    gitRepo(world)
    await touchTest($, world, 'utils/fresh')
    await runTests($, world, 'fail')
    await writeAt($, 'src/utils/fresh.ts', 'export const fresh = (a) => a === 1')
    world.catchRun = { text: ' Tests  1 passed (1)\n', exitCode: 0 }

    const result = await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/missed 1/)
    const said = result.context?.join(' ') ?? ''
    expect(said).toMatch(/utils\/fresh is a new file: dope-tdd changed it 2 ways in a throwaway copy and the test passed every time/)
    expect(said).toMatch(/line 1: `===` → `!==`/)
  })

  test('a new file changed outside after it was written is not mutated: unverified, as any change outside is (#27)', async ($, on) => {
    const world = fakeEngine(on)
    gitRepo(world)
    await touchTest($, world, 'utils/fresh')
    await runTests($, world, 'fail')
    await writeAt($, 'src/utils/fresh.ts', 'export const fresh = (a) => a === 1')
    world.fileContents.set(`${ROOT}/src/utils/fresh.ts`, 'export const fresh = (a) => a === 2 // edited in the IDE')

    const result = await runTests($, world, 'pass')

    expect(result.context?.join(' ')).toMatch(/Could not verify.*changed outside/)
    expect(world.writes.some(([path]) => path.startsWith(WT))).toBe(false)
  })

  test('a new file with nothing to change is still unverified, and says why (#27)', async ($, on) => {
    const world = fakeEngine(on)
    gitRepo(world)
    await touchTest($, world, 'utils/fresh')
    await runTests($, world, 'fail')
    await writeAt($, 'src/utils/fresh.ts', "export const name = 'fresh'")

    const result = await runTests($, world, 'pass')

    expect(result.context?.join(' ')).toMatch(/Could not verify.*new file, with nothing in it to change/)
    expect(world.writes.some(([path]) => path.startsWith(WT))).toBe(false)
  })

  test('your uncommitted and untracked files go into the worktree with it, so the test runs on what you have', async ($, on) => {
    const world = fakeEngine(on)
    gitRepo(world)
    world.fileContents.set(`${ROOT}/src/other.ts`, 'export const other = 2')
    world.fileContents.set(`${ROOT}/tests/utils/formatDuration.test.ts`, "it('x', () => {})")
    world.dirty = 'src/other.ts\nsrc/utils/formatDuration.ts\n'
    world.untracked = 'tests/utils/formatDuration.test.ts\n'
    await fixUnderGuard($, world)

    await runTests($, world, 'pass')

    expect(world.writes).toContainEqual([`${WT}/src/other.ts`, 'export const other = 2'])
    expect(world.writes).toContainEqual([`${WT}/tests/utils/formatDuration.test.ts`, "it('x', () => {})"])
  })

  test('a test that is not green in the worktree as it stands falls back to the check in place, never to a verdict from a broken setup', async ($, on) => {
    const world = fakeEngine(on)
    gitRepo(world)
    await fixUnderGuard($, world)
    world.baselineRunIn.set(WT, { text: ' Tests  1 failed (1)\n', exitCode: 1 })
    world.catchRun = { text: ' Tests  1 failed (1)\n', exitCode: 1 }

    await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(world.writes.filter(([path]) => path === SOURCE).map(([, text]) => text)).toEqual(['export const a = 1', 'export const b = 1'])
    expect(world.gitCalls.some(argv => argv.join(' ') === `git worktree remove --force ${WT}`)).toBe(true)
    expect(status.text).toMatch(/caught 1/)
  })

  test('a run that crashes still removes the worktree, and is unverified', async ($, on) => {
    const world = fakeEngine(on)
    gitRepo(world)
    await fixUnderGuard($, world)
    world.catchRun = 'reject'

    await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(world.gitCalls.some(argv => argv.join(' ') === `git worktree remove --force ${WT}`)).toBe(true)
    expect(world.writes.filter(([path]) => path === SOURCE)).toEqual([])
    expect(status.text).toMatch(/unverified 1/)
  })
})

describe('a green that closes other modules leaves the current module\'s story alone (#41)', () => {
  test('a later full-suite green does not tell a module that saw red and was caught that it never saw red, and a stale open module is not a cycle', async ($, on) => {
    const world = fakeEngine(on)
    // A module whose test was touched long ago and never run: an open cycle that never saw red.
    await touchTest($, world, 'utils/stale')
    await fixUnderGuard($, world)
    world.catchRun = { text: ' Tests  1 failed (1)\n', exitCode: 1 }
    // Its own test file goes green first (as display's did), then the whole suite runs.
    world.bashFails = false
    const own = await runBash($, 'npx vitest run tests/utils/formatDuration.test.ts')
    const again = await runTests($, world, 'pass')

    expect(own.context?.join(' ')).toMatch(/GREEN on utils\/formatDuration, saw red, and its test catches the change/)
    const status = await runCommand($, 'tdd')

    expect(again.context?.join(' ') ?? '').not.toMatch(/never saw red/)
    expect(status.text).toMatch(/cycles: 1 \(avg [^,]+, never saw red 0\)/)
    expect(status.text).not.toMatch(/also open/)
  })

  test('a full-suite green that closes another module\'s red cycle (which counts) still says nothing wrong about the current module', async ($, on) => {
    const world = fakeEngine(on)
    // Another module left red: its test touched and run failing, never fixed.
    await touchTest($, world, 'utils/other')
    world.bashFails = true
    world.bashText = ' FAIL  tests/utils/other.test.ts > x\n Test Files  1 failed (1)\n      Tests  1 failed (1)\n'
    await runBash($, 'npx vitest run tests/utils/other.test.ts')
    world.bashText = ''
    await fixUnderGuard($, world)
    world.catchRun = { text: ' Tests  1 failed (1)\n', exitCode: 1 }
    world.bashFails = false
    await runBash($, 'npx vitest run tests/utils/formatDuration.test.ts')
    const again = await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(again.context?.join(' ') ?? '').not.toMatch(/never saw red/)
    expect(status.text).toMatch(/cycles: 2 \(avg [^,]+, never saw red 0\)/)
  })
})
