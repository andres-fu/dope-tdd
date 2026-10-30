import { describe, expect, test } from 'claude-code/testing'

import { MESSAGES, renderAll, say } from '../hooks/messages'
import { GOLDEN } from './fixtures/messages.golden'

// The message catalogue (2026-10-18): every sentence dope-tdd says to the agent lives in hooks/messages.ts, and its
// exact words live once, here, in tests/fixtures/messages.golden.ts. Logic tests compare against say(id, facts), so a
// wording change edits one template and one golden file, and a reviewer sees every changed sentence in one diff.
// After reviewing a wording change: npm run golden.
describe('the message catalogue', () => {
  test('every message, rendered from its example, matches the golden file word for word', () => {
    expect(renderAll()).toEqual(GOLDEN)
  })

  test('every message the agent reads starts with "dope-tdd:"; a note joins another message, so it starts with a space', () => {
    for (const [id, text] of Object.entries(renderAll())) {
      expect(text.startsWith(id.startsWith('note.') ? ' ' : 'dope-tdd: ')).toBe(true)
    }
  })

  test("a name ending in s takes a bare apostrophe: runners' own test, not runners's", () => {
    expect(say('note.ownTestToo', { module: 'shell', other: 'runners', outcome: 'green' })).toBe(
      " That test is runners' own test too, so runners went green as well; only shell's change was checked.",
    )
  })

  test('say renders one message from its facts', () => {
    expect(say('red.again', { module: 'runPlan' })).toBe(MESSAGES['red.again'].say({ module: 'runPlan' }))
  })
})

// #238: the first code file or test run outside the project in a session is said: not guarded, and what to do instead.
describe('outside.project', () => {
  test('names the path and the project, says it is not guarded or counted, and how to guard it', () => {
    const text = say('outside.project', { path: 'C:/work/other/src/a.ts', root: 'C:/work/app' })
    expect(text).toMatch(/^dope-tdd: C:\/work\/other\/src\/a\.ts is outside this project \(C:\/work\/app\)/)
    expect(text).toMatch(/not guarded or counted/)
    expect(text).toMatch(/open a Claude Code session in it/)
  })
})

// Idea 18 (2026-10-26): a catch that kept the test's failure message quotes it; one without stays as it was.
describe('green.caught', () => {
  test('quotes the failure message when the catch kept one', () => {
    expect(say('green.caught', { module: 'utils/a', sawRed: true, message: 'expected 2 to be 3' })).toBe(
      'dope-tdd: GREEN on utils/a: PROVEN. It saw red, and with the change undone its test fails with `expected 2 to be 3`. Now refactor with the test untouched, or write the next failing test.',
    )
    expect(say('green.caught', { module: 'utils/a', sawRed: true })).toBe(GOLDEN['green.caught'])
  })
})

// Idea 16 (2026-10-26): the same failure run after run is not progress; the note says so and offers the two ways out.
describe('note.stuck', () => {
  test('names the failure and how many runs, and says step back or BLOCKED', () => {
    expect(say('note.stuck', { runs: 3, failure: 'expected 2 to be 3' })).toBe(
      ' The same failure 3 runs in a row (`expected 2 to be 3`): this is not moving. Step back and re-read what the test expects, or say BLOCKED and what you need from the user.',
    )
  })
})
