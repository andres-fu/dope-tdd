import { describe, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { FIXTURE_DRIVE, ROOT, T0, editAt, fakeEngine, fixUnderGuard, runTests, startSession, test } from './engine'
import type { FakeWorld } from './engine'

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
