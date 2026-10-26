import { describe, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { FIXTURE_DRIVE, ROOT, T0, editAt, fakeEngine, fixUnderGuard, runBash, runTests, startSession, test, touchTest } from './engine'
import type { FakeWorld } from './engine'
import { verifyRecord } from '../hooks/sessionLog'

const HOME = `${FIXTURE_DRIVE}Users/tester`
const SESSIONS = `${HOME}/.dope-tdd/sessions/`

function end($: Engine, sessionId = 'sess-1') {
  return $.session.end({ reason: 'other', sessionId, resume: { id: sessionId } } as never)
}

function logged(world: FakeWorld): [string, string][] {
  return world.writes.filter(([path]) => path.startsWith(SESSIONS))
}

describe('what a session leaves behind does not pile up', () => {
  const RUN_DAYS = 40 * 24 * 60 * 60_000

  test('session logs older than 30 days are removed when a session starts; kept changes never are', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    world.fileContents.set(`${SESSIONS}2026-08-01-old.json`, '{}')
    world.fileContents.set(`${HOME}/.dope-tdd/kept/throughline/src/a.ts`, 'export const kept = 1')
    world.testModifiedAt = T0 - RUN_DAYS

    await startSession($)

    const removed = world.gitCalls.filter(argv => argv[0] === 'node').map(argv => argv.at(-1))
    expect(removed).toContain(`${SESSIONS}2026-08-01-old.json`)
    expect(removed).not.toContain(`${HOME}/.dope-tdd/kept/throughline/src/a.ts`)
  })

  test('kept changes are named when a session starts, so their owner finds them', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    world.fileContents.set(`${HOME}/.dope-tdd/kept/throughline/src/a.ts`, 'export const kept = 1')

    await startSession($)

    expect(world.toasts.some(t => t.includes('kept in ~/.dope-tdd/kept: throughline/src/a.ts'))).toBe(true)
  })

  test('no kept changes: nothing is said', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })

    await startSession($)

    expect(world.toasts.some(t => t.includes('~/.dope-tdd/kept'))).toBe(false)
  })

  test('files younger than 30 days stay', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    world.fileContents.set(`${SESSIONS}2026-10-05-new.json`, '{}')
    world.testModifiedAt = T0 - 2 * 24 * 60 * 60_000

    await startSession($)

    expect(world.gitCalls.filter(argv => argv[0] === 'node')).toEqual([])
  })

  test('a failing delete never holds up the start', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    world.fileContents.set(`${SESSIONS}2026-08-01-old.json`, '{}')
    world.testModifiedAt = T0 - RUN_DAYS
    world.catchRun = 'reject'

    await startSession($)

    expect(world.gitCalls.some(argv => argv[0] === 'node')).toBe(true)
  })
})

describe('every session leaves its receipt on this machine', () => {
  test('at the end of a session: one file outside the repo, with the counts, the mode and the receipt', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    await fixUnderGuard($, world)
    world.catchRun = { text: ' Tests  1 failed (1)\n', exitCode: 1 }
    await runTests($, world, 'pass')

    await end($)
    const files = logged(world)

    expect(files.length).toBe(1)
    const [path, text] = files[0] ?? ['', '']
    expect(path).toMatch(/\/\.dope-tdd\/sessions\/2026-10-06-sess-1\.json$/)
    const record = JSON.parse(text) as Record<string, unknown>
    expect(record).toMatchObject({ sessionId: 'sess-1', repo: 'throughline', mode: 'enforce', reason: 'other', testFirst: 1, blocked: 0, caught: 1, missed: 0 })
    expect(String(record.receipt)).toMatch(/^dope-tdd\n/)
  })

  test('the record names the repository folder, never the absolute path (it would carry the user name)', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    await fixUnderGuard($, world)
    world.catchRun = { text: ' Tests  1 failed (1)\n', exitCode: 1 }
    await runTests($, world, 'pass')

    await end($)

    expect(logged(world)[0]?.[1]).not.toContain(ROOT)
  })

  // Debt `log`: a session in a linked worktree was filed under the worktree's folder (`PR-live-log`), not the repository.
  test('in a linked worktree the record names the main checkout\'s folder, still never a path', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    world.fileContents.set(`${ROOT}/.git`, `gitdir: ${FIXTURE_DRIVE}code/dope-tdd/.git/worktrees/throughline\n`)
    await fixUnderGuard($, world)
    world.catchRun = { text: ' Tests  1 failed (1)\n', exitCode: 1 }
    await runTests($, world, 'pass')

    await end($)
    const text = logged(world)[0]?.[1] ?? '{}'

    expect((JSON.parse(text) as Record<string, unknown>).repo).toBe('dope-tdd')
    expect(text).not.toContain(`${FIXTURE_DRIVE}code`)
  })

  test('the record says how long the catch check took in all, so its share of a run can be measured', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    await fixUnderGuard($, world)
    world.catchRun = { text: ' Tests  1 failed (1)\n', exitCode: 1 }
    world.onCatchRun = () => world.clock.advance(3000)
    await runTests($, world, 'pass')

    await end($)
    const record = JSON.parse(logged(world)[0]?.[1] ?? '{}') as Record<string, unknown>

    expect(record.checkMs).toBe(3000)
  })

  test('the record names the build of dope-tdd that guarded the session (2026-10-18)', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    world.pluginGit = 'a6b93d4|2026-10-18|Merge pull request #99 from andres-fu/live-trial-fixes'
    await startSession($)
    await fixUnderGuard($, world)
    await runTests($, world, 'pass')

    await end($)
    const record = JSON.parse(logged(world)[0]?.[1] ?? '{}') as Record<string, unknown>

    expect(record.build).toBe('#99 · a6b93d4 · 2026-10-18')
  })

  test('a session that did nothing leaves nothing', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })

    await end($)

    expect(logged(world)).toEqual([])
  })

  test('DOPE_TDD_LOG=off keeps it all in memory', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME, DOPE_TDD_LOG: 'off' } })
    await editAt($, 'src/utils/a.ts')

    await end($)

    expect(logged(world)).toEqual([])
  })

  test('a log that cannot be written never holds up the exit', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    world.writeFails = path => path.startsWith(SESSIONS)
    await editAt($, 'src/utils/a.ts')

    await expect(end($)).resolves.toMatchObject({ sessionId: 'sess-1' })
  })
})

// Verified review B4 and E2 (2026-10-20): the store kept every unlock key forever and had no version to migrate by.
describe('the plugin store stays small and says its version', () => {
  test('at session start, unlock keys with nothing fresh are deleted, a fresh one is kept, and the store version is set', async ($, on) => {
    const fresh = { 'utils/a': { testPath: `${ROOT}/tests/utils/a.test.ts`, atMs: T0 - 60_000 } }
    const old = { 'utils/b': { testPath: `${FIXTURE_DRIVE}gone/tests/utils/b.test.ts`, atMs: T0 - 30 * 24 * 60 * 60_000 } }
    const world = fakeEngine(on, { store: { [`unlocks:${ROOT}`]: fresh, [`unlocks:${FIXTURE_DRIVE}gone`]: old } })

    await startSession($)

    expect(world.store.has(`unlocks:${ROOT}`)).toBe(true)
    expect(world.store.has(`unlocks:${FIXTURE_DRIVE}gone`)).toBe(false)
    expect(world.store.get('store-version')).toBe(1)
  })
})

// Idea 17 (2026-10-26): how long each one-file run took is a row in the record, for a dashboard to query later.
describe('the session record keeps one-file run times', () => {
  test('a one-file run is a row with its module, outcome and time; a suite run is not', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    await startSession($)
    await touchTest($, world, 'utils/formatDuration')
    world.onBash = () => world.clock.advance(4_000)
    world.bashFails = true
    await runBash($, 'npx vitest run tests/utils/formatDuration.test.ts')
    await runBash($, 'npx vitest run')
    await end($)

    const record = JSON.parse(logged(world).at(-1)?.[1] ?? '{}') as { runTimes?: { module: string; outcome: string; tookMs: number }[] }
    expect(record.runTimes?.map(({ module, outcome, tookMs }) => ({ module, outcome, tookMs }))).toEqual([{ module: 'utils/formatDuration', outcome: 'fail', tookMs: 4_000 }])
  })
})

// Idea 16 (2026-10-26): the same failure three runs in a row is said to the agent, and the spell is a row in the record.
describe('a module stuck on the same failure', () => {
  test('the third identical red says so, and the record keeps the spell', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    await startSession($)
    await touchTest($, world, 'utils/formatDuration')
    world.bashFails = true
    world.bashText = ' FAIL  tests/utils/formatDuration.test.ts > formats months\nAssertionError: expected \'14m\' to be \'1y 2m\' // Object.is equality\n Tests  1 failed (1)\n'
    const runs = []
    for (let run = 0; run < 3; run++) {
      runs.push(await runBash($, 'npx vitest run tests/utils/formatDuration.test.ts'))
    }
    expect(runs[1]?.context?.join(' ') ?? '').not.toMatch(/runs in a row/)
    expect(runs[2]?.context?.join(' ') ?? '').toMatch(/The same failure 3 runs in a row \(`expected '14m' to be '1y 2m'`\): this is not moving\./)
    await end($)

    const record = JSON.parse(logged(world).at(-1)?.[1] ?? '{}') as { stuck?: { module: string; failure: string; runs: number }[] }
    expect(record.stuck?.map(({ module, failure, runs }) => ({ module, failure, runs }))).toEqual([{ module: 'utils/formatDuration', failure: "expected '14m' to be '1y 2m'", runs: 3 }])
  })
})

// Integrity (2026-10-26): could an agent or a person game this? The record is sealed with a digest of its content, and
// a shell command that edits an existing record is a workaround on the record.
describe('the session record\'s integrity', () => {
  test('a record is written sealed', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    await fixUnderGuard($, world)
    await end($)

    expect(verifyRecord(logged(world).at(-1)?.[1] ?? '')).toBe('sealed')
  })

  test('a command that edits an existing record is a workaround, and Claude is told', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    const old = `${SESSIONS}2026-10-25-sess-0.json`
    world.fileContents.set(old, '{"proven":1}')
    await startSession($)
    world.onBash = () => {
      world.fileContents.set(old, '{"proven":99}')
    }

    const edit = await runBash($, 'node bump.js')

    expect(edit.context?.join(' ') ?? '').toMatch(/that command changed a session record in ~\/\.dope-tdd\/sessions\/ \(2026-10-25-sess-0\.json\)/)
    expect(((await $.command.run({ command: 'tdd', args: '' } as never)) as { text: string }).text).toMatch(/workarounds: 1 \(session log edited 1\)/)
  })

  test('a record another session writes while a command runs is not', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    await startSession($)
    world.onBash = () => {
      world.fileContents.set(`${SESSIONS}2026-10-26-sess-9.json`, '{"proven":1}')
    }

    const edit = await runBash($, 'node other.js')

    expect(edit.context?.join(' ') ?? '').not.toMatch(/session record/)
  })
})
