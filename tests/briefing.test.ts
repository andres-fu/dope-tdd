import { describe, expect, test } from 'claude-code/testing'

import { briefingText } from '../hooks/briefing'
import { DEFAULT_CONFIG } from '../hooks/config'

describe('briefingText', () => {
  test('in enforce mode says what is refused, how tests pair, the command, and what the words mean', () => {
    const text = briefingText(DEFAULT_CONFIG, 'npx vitest run <test file>')
    expect(text).toMatch(/mode: enforce/)
    expect(text).toMatch(/refused until that module's test was touched in this session, or run and seen failing/)
    expect(text).toMatch(/mirror \(src\/\{module\}\.\{ext\} ↔ tests\/\{module\}\.test\.\{ext\}\)/)
    expect(text).toMatch(/Run one test file at a time: `npx vitest run <test file>`/)
    expect(text).toMatch(/CAUGHT means the test is real; MISSED means/)
    expect(text).toMatch(/say why in your reply/)
    expect(text).toMatch(/\/dope-tdd:pin skill: pin, prove, then change/)
  })

  test('in observe mode says nothing is refused, and without a runner gives no command', () => {
    const text = briefingText({ ...DEFAULT_CONFIG, mode: 'observe' }, null)
    expect(text).toMatch(/watches and records only; nothing is refused/)
    expect(text).not.toMatch(/`[^`]*<test file>`/)
  })
})

describe('the briefing stays cheap', () => {
  // Every session pays for it on every turn: about 4 characters a token, so 2,000 characters is about 500 tokens.
  test('at most 2,000 characters in every mode, even with a long custom layout and a long run command', () => {
    const layout = { name: 'custom' as const, source: 'packages/{pkg}/src/main/typescript/{module}.{ext}', test: 'packages/{pkg}/src/test/typescript/{module}.spec.{ext}' }
    const command = 'node C:/Users/someone/projects/a-very-long-monorepo-name/node_modules/vitest/vitest.mjs run <test file>'
    for (const mode of ['enforce', 'warn', 'observe'] as const) {
      expect(briefingText({ ...DEFAULT_CONFIG, mode, layout }, command).length).toBeLessThanOrEqual(2000)
    }
  })
})
