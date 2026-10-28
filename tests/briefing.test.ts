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
    expect(text).toMatch(/PROVEN means the test is real; MISSED means/)
    expect(text).toMatch(/say why in your reply/)
    expect(text).toMatch(/\/dope-tdd:pin skill: pin, prove, then change/)
  })

  // #54: the gate and the agent's model of it must match, carry-over included.
  test('in enforce mode says how an unlock from an earlier session works', () => {
    const text = briefingText(DEFAULT_CONFIG, 'npx vitest run <test file>')
    expect(text).toMatch(/unlocked in an earlier session \(up to 7 days\) needs one run of its test this session, red or green, before its first edit/)
    expect(text).toMatch(/dropped if that test changed since/)
    expect(briefingText({ ...DEFAULT_CONFIG, mode: 'warn' }, null)).not.toMatch(/earlier session/)
  })

  // Option A (docs review, 2026-10-18): refactoring tested code, and the override, said before the first refusal.
  test('in enforce mode says how to refactor tested code, and that an override request means stop and wait', () => {
    const text = briefingText(DEFAULT_CONFIG, 'npx vitest run <test file>')
    expect(text).toMatch(/To refactor code whose test already passes, add or tighten one assertion for what you will change and see it fail, or pin it first\./)
    expect(text).toMatch(/If nothing fits, ask with mcp__dope-tdd__override_request, then stop and wait: a person decides\./)
    expect(briefingText({ ...DEFAULT_CONFIG, mode: 'observe' }, null)).not.toMatch(/override_request/)
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

  // #167: a default layout that matches none of the code is said right after the layout, where the agent reads it.
  test('a layout note follows the layout line; without one the briefing is unchanged', () => {
    const note = 'The default layout matches none of this project\'s code.'
    const lines = briefingText(DEFAULT_CONFIG, 'npx vitest run <test file>', note).split('\n')
    expect(lines[1]).toMatch(/Tests pair with sources by this layout/)
    expect(lines[2]).toBe(`- ${note}`)
    expect(briefingText(DEFAULT_CONFIG, 'npx vitest run <test file>', null)).toBe(briefingText(DEFAULT_CONFIG, 'npx vitest run <test file>'))
  })

  // Idea 15: a module an earlier session left red leads the briefing, right after the first line.
  test('a left-red note comes second, before the rules; without one the briefing is unchanged', () => {
    const note = 'Left red when an earlier session ended: utils/a.'
    const lines = briefingText(DEFAULT_CONFIG, 'npx vitest run <test file>', null, note).split('\n')
    expect(lines[0]).toMatch(/^Dope TDD is on/)
    expect(lines[1]).toBe(`- ${note}`)
    expect(lines[2]).toMatch(/refused until/)
    expect(briefingText({ ...DEFAULT_CONFIG, mode: 'warn' }, null, null, note)).toContain(note)
    expect(briefingText(DEFAULT_CONFIG, 'npx vitest run <test file>', null, null)).toBe(briefingText(DEFAULT_CONFIG, 'npx vitest run <test file>'))
  })
})

describe('an invalid dope-tdd.json', () => {
  // #193: the file fell back to the defaults and only /tdd said so; the agent is told, second, so it can tell the user.
  test('is said second, with the file, the error and the fallback, and that the user should know', () => {
    const error = 'dope-tdd.json: mode must be one of enforce, warn, observe'
    const lines = briefingText({ ...DEFAULT_CONFIG, error }, 'npx vitest run <test file>').split('\n')
    expect(lines[1]).toBe(
      '- dope-tdd.json was not read (mode must be one of enforce, warn, observe), so the defaults apply: enforce and the default layout. Tell the user, so they can fix the file.',
    )
    expect(lines[2]).toMatch(/refused until/)
    expect(briefingText({ ...DEFAULT_CONFIG, error: null }, 'npx vitest run <test file>')).toBe(briefingText(DEFAULT_CONFIG, 'npx vitest run <test file>'))
  })
})

describe('briefingText spike', () => {
  // Idea 19: the spike is offered before the override, in enforce mode where refusals happen.
  test('in enforce mode names the spike skill before the override', () => {
    const text = briefingText(DEFAULT_CONFIG, 'npx vitest run <test file>')
    expect(text).toContain('To explore before you know what to test, use /dope-tdd:spike: work in a throwaway copy outside the project, then rebuild here test-first.')
    expect(text.indexOf('/dope-tdd:spike')).toBeLessThan(text.indexOf('override_request'))
    expect(briefingText({ ...DEFAULT_CONFIG, mode: 'warn' }, null)).not.toMatch(/dope-tdd:spike/)
  })
})
