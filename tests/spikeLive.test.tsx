import { describe, expect } from 'claude-code/testing'

import { FIXTURE_DRIVE, T0, fakeEngine, runCommand, startSession, test } from './engine'

const HOME = `${FIXTURE_DRIVE}Users/tester`
const SPIKES = `${HOME}/.dope-tdd/spikes`
const DAY = 24 * 60 * 60_000

// Stumble twice (idea 19, docs/decisions/2026-10-26_stumble-twice.md).
describe('a spike', () => {
  test('the spike skill is recorded with its question, on its own line, not as a workaround', async ($, on) => {
    fakeEngine(on)

    await $.skill.prompt({ skill: 'dope-tdd:spike', text: '# Spike\n\nQuestion: can the parser stream?\n', frontmatter: {} } as never)
    const status = (await runCommand($, 'tdd')).text

    expect(status).toMatch(/^spikes: 1 \(last: can the parser stream\?\)/m)
    expect(status).not.toMatch(/workarounds/)
  })

  test('another skill is not a spike', async ($, on) => {
    fakeEngine(on)

    await $.skill.prompt({ skill: 'simplify', text: 'Question: x', frontmatter: {} } as never)

    expect((await runCommand($, 'tdd')).text).not.toMatch(/spikes:/)
  })

  test('a spike copy older than 7 days is removed at session start', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    world.fileContents.set(`${SPIKES}/throughline-parser/src/a.ts`, 'export const a = 1')
    world.testModifiedAt = T0 - 8 * DAY

    await startSession($)

    const removed = world.gitCalls.filter(argv => argv[0] === 'node' && String(argv[2]).includes('recursive')).map(argv => argv.at(-1))
    expect(removed).toEqual([`${SPIKES}/throughline-parser`])
  })

  test('a recent spike copy is left alone', async ($, on) => {
    const world = fakeEngine(on, { env: { HOME } })
    world.fileContents.set(`${SPIKES}/throughline-parser/src/a.ts`, 'export const a = 1')
    world.testModifiedAt = T0 - DAY

    await startSession($)

    expect(world.gitCalls.some(argv => argv[0] === 'node' && String(argv[2]).includes('recursive'))).toBe(false)
  })
})
