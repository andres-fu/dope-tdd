import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_CONFIG, describeConfigChange, isLoosening, parseConfig } from '../hooks/config'

describe('isLoosening', () => {
  test('a weaker mode, a new exemption, or a scope that leaves more out loosens the guard', () => {
    expect(isLoosening(DEFAULT_CONFIG, parseConfig('{"mode":"warn"}'))).toBe(true)
    expect(isLoosening(DEFAULT_CONFIG, parseConfig('{"exempt":["src/main.tsx"]}'))).toBe(true)
    expect(isLoosening(DEFAULT_CONFIG, parseConfig('{"scope":["src/billing/**"]}'))).toBe(true)
    expect(isLoosening(parseConfig('{"scope":["src/billing/**","src/cart/**"]}'), parseConfig('{"scope":["src/billing/**"]}'))).toBe(true)
  })

  test('turning the catch check off loosens the guard, and says so; turning it back on does not', () => {
    expect(isLoosening(DEFAULT_CONFIG, parseConfig('{"catchCheck":false}'))).toBe(true)
    expect(isLoosening(parseConfig('{"catchCheck":false}'), DEFAULT_CONFIG)).toBe(false)
    expect(describeConfigChange(DEFAULT_CONFIG, parseConfig('{"catchCheck":false}'))).toBe('catch check on → off')
    expect(parseConfig('{"catchCheck":"no"}').error).toMatch(/catchCheck must be true or false/)
  })

  test('"catchCheck": true lets the experimental runners check in place; it is said, and it is not a loosening', () => {
    const inPlace = parseConfig('{"catchCheck":true}')
    expect(inPlace.catchCheck).toBe(true)
    expect(isLoosening(DEFAULT_CONFIG, inPlace)).toBe(false)
    expect(describeConfigChange(DEFAULT_CONFIG, inPlace)).toBe('in-place check for experimental runners off → on')
    expect(describeConfigChange(inPlace, DEFAULT_CONFIG)).toBe('in-place check for experimental runners on → off')
    expect(describeConfigChange(inPlace, parseConfig('{"catchCheck":false}'))).toBe('catch check on → off; in-place check for experimental runners on → off')
  })

  test('a folder layout added, changed or removed is said, and is not a loosening', () => {
    const plain = parseConfig('{}')
    const colocated = parseConfig('{"layouts":{"web":"colocated"}}')
    expect(describeConfigChange(plain, colocated)).toBe('layout in web/ → colocated')
    expect(describeConfigChange(colocated, parseConfig('{"layouts":{"web":"__tests__"}}'))).toBe('layout in web/ colocated → __tests__')
    expect(describeConfigChange(colocated, plain)).toBe('layout in web/ colocated → the main layout')
    expect(describeConfigChange(colocated, parseConfig('{"layouts":{"web/":"colocated"}}'))).toBe(null)
    expect(isLoosening(plain, colocated)).toBe(false)
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
