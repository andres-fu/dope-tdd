import { describe, expect } from 'claude-code/testing'

import { MINUTE, ROOT, SOURCE, T0, editAt, fakeEngine, fixUnderGuard, runCommand, runTests, startSession, test } from './engine'
import { storeRoot } from '../hooks/unlocks'

const REF = 'refs/worktree/dope-tdd-check'
const MIRROR = `check-lock:${storeRoot(ROOT)}`
const other = (sinceMs: number) => JSON.stringify({ module: 'utils/other', sinceMs })

describe('one catch-check lock across sessions', () => {
  // The first test in this file also pays for loading the module, which took 8.7 s on a Windows runner (5 s is the default).
  test('a check takes the lock with a compare-and-swap and gives it back, so nothing is left behind', { timeoutMs: 30_000 }, async ($, on) => {
    const world = fakeEngine(on)
    await fixUnderGuard($, world)

    await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/caught 1/)
    expect(world.gitCalls.some(argv => argv[1] === 'update-ref' && argv[2] === REF && argv[4] === '')).toBe(true)
    expect(world.gitCalls.some(argv => argv[1] === 'update-ref' && argv[2] === '-d' && argv[3] === REF)).toBe(true)
    expect(world.refs.size).toBe(0)
  })

  test('while another session holds the lock the check does not revert anything, and says why', async ($, on) => {
    const world = fakeEngine(on)
    world.refs.set(REF, 'held')
    world.objects.set('held', other(T0))
    await fixUnderGuard($, world)
    const before = world.writes.length

    const green = await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(world.writes.length).toBe(before)
    expect(green.context?.join(' ')).toMatch(/another session was checking utils\/other/)
    expect(status.text).toMatch(/unverified 1/)
    expect(world.refs.get(REF)).toBe('held')
  })

  test('a lock left by a check that died is taken over once it has expired', async ($, on) => {
    const world = fakeEngine(on)
    world.refs.set(REF, 'stale')
    world.objects.set('stale', other(T0 - 5 * MINUTE))
    await fixUnderGuard($, world)

    await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/caught 1/)
    expect(world.refs.size).toBe(0)
  })

  test('an edit or a test run during another session\u2019s check is refused, so it cannot touch the reverted file', async ($, on) => {
    const world = fakeEngine(on, { store: { [MIRROR]: { module: 'utils/other', sinceMs: T0, sha: 'held' } } })
    await startSession($)
    world.existingFiles.add(`${ROOT}/tests/utils/formatDuration.test.ts`)

    const edit = await editAt($, 'tests/utils/formatDuration.test.ts')
    const run = await runTests($, world, 'pass')

    expect(edit.deny).toMatch(/verifying that the test for utils\/other catches the change/)
    expect((run as { deny?: string }).deny).toMatch(/verifying that the test for utils\/other/)
  })

  test('a new session does not repair a journal while another session\u2019s check is in flight', async ($, on) => {
    const world = fakeEngine(on, {
      store: {
        [MIRROR]: { module: 'utils/formatDuration', sinceMs: T0, sha: 'held' },
        [`catch-journal:${storeRoot(ROOT)}:utils/formatDuration`]: { files: [{ path: SOURCE, before: 'export const a = 1', after: 'export const b = 1' }] },
      },
    })
    world.fileContents.set(SOURCE, 'export const a = 1')

    await startSession($)

    expect(world.writes).toEqual([])
    expect(world.fileContents.get(SOURCE)).toBe('export const a = 1')
  })

  test('outside a git checkout the check still runs, on this session\u2019s lock alone, and the log says so once', async ($, on) => {
    const world = fakeEngine(on)
    world.gitUnavailable = true
    await fixUnderGuard($, world)

    await runTests($, world, 'pass')
    const status = await runCommand($, 'tdd')

    expect(status.text).toMatch(/caught 1/)
    expect(world.logs.filter(line => /covers this session only/.test(line)).length).toBe(1)
  })
})
