import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_CONFIG } from '../hooks/config'
import { OVERRIDE_HINT, lockedMessage } from '../hooks/refusals'

const CONFIG = { ...DEFAULT_CONFIG, layout: { name: 'custom', source: 'hooks/{module}.{ext}', test: 'tests/{module}.test.{ext}' } }

describe('lockedMessage: the cheap path first, the override last (2026-10-18)', () => {
  test('names the test to write, then pin, then the override request, in that order', () => {
    const message = lockedMessage(CONFIG, 'runPlan', undefined, 'ts')
    expect(message.startsWith('dope-tdd: write the failing test first. Touch tests/runPlan.test.ts')).toBe(true)
    expect(message.endsWith(OVERRIDE_HINT)).toBe(true)
    expect(OVERRIDE_HINT.indexOf('/dope-tdd:pin')).toBeLessThan(OVERRIDE_HINT.indexOf('mcp__dope-tdd__override_request'))
  })

  test('the override hint says a person decides and it is recorded', () => {
    expect(OVERRIDE_HINT).toMatch(/a person decides, and it is recorded/)
  })
})
