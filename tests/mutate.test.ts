import { describe, expect, test } from 'claude-code/testing'

import { mutantsOf } from '../hooks/mutate'

describe('mutantsOf: small changes a test of new code should notice (#27)', () => {
  test('flips comparisons and logic, nudges an integer, each with its line and the code it made', () => {
    const source = 'export const ok = (a, b) =>\n  a === b && b > 0'
    const mutants = mutantsOf(source, { typescript: false, max: 4 })
    expect(mutants.map(mutant => mutant.change)).toEqual([
      'line 2: `===` → `!==`',
      'line 2: `&&` → `||`',
      'line 2: `>` → `>=`',
      'line 2: `0` → `1`',
    ])
    expect(mutants[0]?.text).toBe('export const ok = (a, b) =>\n  a !== b && b > 0')
    expect(mutants[3]?.text).toBe('export const ok = (a, b) =>\n  a === b && b > 1')
  })

  test('negates an if, and swaps true and false', () => {
    const mutants = mutantsOf('if (ready) start(true)', { typescript: false, max: 4 })
    expect(mutants.map(mutant => mutant.change)).toEqual(['line 1: `if (ready)` → `if (!(ready))`', 'line 1: `true` → `false`'])
    expect(mutants[0]?.text).toBe('if (!(ready)) start(true)')
  })

  test('never touches strings, templates, regexes or comments', () => {
    expect(mutantsOf("log('a === b && c', `x ${'1'} > 2`, /a|b/) // if (x === 1) true", { typescript: false })).toEqual([])
  })

  test('in TypeScript, < and > are left alone (they may be generics); <= and >= still flip', () => {
    const source = 'const xs: Array<number> = []\nconst big = n >= 10'
    expect(mutantsOf(source, { typescript: true, max: 8 }).map(mutant => mutant.change)).toEqual(['line 2: `>=` → `>`', 'line 2: `10` → `11`'])
    expect(mutantsOf('const big = n > 1', { typescript: false, max: 8 }).map(mutant => mutant.change)).toContain('line 1: `>` → `>=`')
  })

  test('only plain integers are nudged, and a few mutants are spread over the file, the same ones every time', () => {
    expect(mutantsOf('const a = 0x10 + 1.5 + 1e3', { typescript: false })).toEqual([])
    const source = ['a === 1', 'b === 2', 'c === 3'].join('\n')
    const picked = mutantsOf(source, { typescript: false, max: 2 }).map(mutant => mutant.change)
    expect(picked).toEqual(['line 1: `===` → `!==`', 'line 2: `2` → `3`'])
    expect(mutantsOf(source, { typescript: false, max: 2 }).map(mutant => mutant.change)).toEqual(picked)
  })
})
