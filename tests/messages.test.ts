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

  test('say renders one message from its facts', () => {
    expect(say('red.again', { module: 'runPlan' })).toBe(MESSAGES['red.again'].say({ module: 'runPlan' }))
  })
})
