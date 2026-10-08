import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_CONFIG, describeConfigChange, isLoosening, parseConfig } from '../hooks/config'

describe('isLoosening', () => {
  test('a weaker mode, a new exemption, or a scope that leaves more out loosens the guard', () => {
    expect(isLoosening(DEFAULT_CONFIG, parseConfig('{"mode":"warn"}'))).toBe(true)
    expect(isLoosening(DEFAULT_CONFIG, parseConfig('{"exempt":["src/main.tsx"]}'))).toBe(true)
    expect(isLoosening(DEFAULT_CONFIG, parseConfig('{"scope":["src/billing/**"]}'))).toBe(true)
    expect(isLoosening(parseConfig('{"scope":["src/billing/**","src/cart/**"]}'), parseConfig('{"scope":["src/billing/**"]}'))).toBe(true)
  })

  test('a stronger mode, a dropped exemption, or a wider scope does not', () => {
    expect(isLoosening(parseConfig('{"mode":"observe"}'), DEFAULT_CONFIG)).toBe(false)
    expect(isLoosening(parseConfig('{"exempt":["src/main.tsx"]}'), DEFAULT_CONFIG)).toBe(false)
    expect(isLoosening(parseConfig('{"scope":["src/billing/**"]}'), DEFAULT_CONFIG)).toBe(false)
    expect(isLoosening(parseConfig('{"scope":["src/billing/**"]}'), parseConfig('{"scope":["src/billing/**","src/cart/**"]}'))).toBe(false)
  })
})

describe('describeConfigChange', () => {
  test('names a mode change', () => {
    expect(describeConfigChange(DEFAULT_CONFIG, parseConfig('{"mode":"observe"}'))).toBe('mode enforce → observe')
  })

  test('names exemptions and scope added or removed', () => {
    const before = parseConfig('{"exempt":["src/main.tsx"],"scope":["src/billing/**"]}')
    const after = parseConfig('{"exempt":["src/main.tsx","src/generated/**"]}')
    expect(describeConfigChange(before, after)).toBe('exempt +src/generated/**; scope -src/billing/**')
  })

  test('says when the file became invalid', () => {
    expect(describeConfigChange(DEFAULT_CONFIG, parseConfig('{"mode":"strict"}'))).toMatch(/^now invalid: dope-tdd\.json: mode must be one of/)
  })

  test('is null when nothing the guard reads moved', () => {
    expect(describeConfigChange(parseConfig('{"mode":"warn"}'), parseConfig('{"mode": "warn", "note": "x"}'))).toBeNull()
  })
})
