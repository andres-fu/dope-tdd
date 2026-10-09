import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { FIXTURE_DRIVE, ROOT, editAt, fakeEngine, fixUnderGuard, runTests } from './engine'
import type { FakeWorld } from './engine'

const HOME = `${FIXTURE_DRIVE}Users/tester`
const SESSIONS = `${HOME}/.dope-tdd/sessions/`

function end($: Engine, sessionId = 'sess-1') {
  return $.session.end({ reason: 'other', sessionId, resume: { id: sessionId } } as never)
}

function logged(world: FakeWorld): [string, string][] {
  return world.writes.filter(([path]) => path.startsWith(SESSIONS))
}

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
    expect(record).toMatchObject({ sessionId: 'sess-1', repo: 'throughline', root: ROOT, mode: 'enforce', reason: 'other', testFirst: 1, blocked: 0, caught: 1, missed: 0 })
    expect(String(record.receipt)).toMatch(/^dope-tdd\n/)
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
