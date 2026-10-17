import { describe, expect, test } from 'claude-code/testing'

import { flipsAngles, mutantsOf } from '../hooks/mutate'

describe('mutantsOf: small changes a test of new code should notice (#27)', () => {
  test('flips comparisons and logic, nudges an integer, each with its line and the code it made', () => {
    const source = 'export const ok = (a, b) =>\n  a === b && b > 0'
    const mutants = mutantsOf(source, { angles: true, max: 4 })
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
    const mutants = mutantsOf('if (ready) start(true)', { angles: true, max: 4 })
    expect(mutants.map(mutant => mutant.change)).toEqual(['line 1: `if (ready)` → `if (!(ready))`', 'line 1: `true` → `false`'])
    expect(mutants[0]?.text).toBe('if (!(ready)) start(true)')
  })

  test('never touches strings, templates, regexes or comments', () => {
    expect(mutantsOf("log('a === b && c', `x ${'1'} > 2`, /a|b/) // if (x === 1) true", { angles: true })).toEqual([])
  })

  test('in TypeScript, < and > are left alone (they may be generics); <= and >= still flip', () => {
    const source = 'const xs: Array<number> = []\nconst big = n >= 10'
    expect(mutantsOf(source, { angles: false, max: 8 }).map(mutant => mutant.change)).toEqual(['line 2: `>=` → `>`', 'line 2: `10` → `11`'])
    expect(mutantsOf('const big = n > 1', { angles: true, max: 8 }).map(mutant => mutant.change)).toContain('line 1: `>` → `>=`')
  })

  test('only plain integers are nudged, and a few mutants are spread over the file, the same ones every time', () => {
    expect(mutantsOf('const a = 0x10 + 1.5 + 1e3', { angles: true })).toEqual([])
    const source = ['a === 1', 'b === 2', 'c === 3'].join('\n')
    const picked = mutantsOf(source, { angles: true, max: 2 }).map(mutant => mutant.change)
    expect(picked).toEqual(['line 1: `===` → `!==`', 'line 2: `2` → `3`'])
    expect(mutantsOf(source, { angles: true, max: 2 }).map(mutant => mutant.change)).toEqual(picked)
  })

  test('a comparison with 0 that the same condition already guards with a falsy check is not mutated: no test could catch it (#42)', () => {
    const changes = (source: string) => mutantsOf(source, { angles: true, max: 8 }).map(mutant => mutant.change)
    // VibeCast's display.js: `!length` already covers 0, so `<= 0` and `< 0` behave the same.
    expect(changes("if (!length || length <= 0) return '-'")).not.toContain('line 1: `<=` → `<`')
    expect(changes('if (!items.length || items.length < 0) skip()')).not.toContain('line 1: `<` → `<=`')
    expect(changes('if (n === 0 || n >= 0) go()')).not.toContain('line 1: `>=` → `>`')
    // Another name, or another bound, is not covered: still mutated.
    expect(changes('if (!total || length <= 0) stop()')).toContain('line 1: `<=` → `<`')
    expect(changes('if (!length || length <= 1) stop()')).toContain('line 1: `<=` → `<`')
    // After && the guard does not take 0 for it: `!0 && 0 <= 0` is true, `!0 && 0 < 0` is not.
    expect(changes('if (!length && length <= 0) stop()')).toContain('line 1: `<=` → `<`')
  })
})

describe('flipsAngles: when a < or > is safely a comparison (review #2)', () => {
  test('in TypeScript, JSX files, or any file with a tag in it, < and > are left alone', () => {
    expect(flipsAngles('src/a.js', 'export const big = n > 1')).toBe(true)
    expect(flipsAngles('src/a.ts', 'export const big = n > 1')).toBe(false)
    expect(flipsAngles('src/a.tsx', 'export const big = n > 1')).toBe(false)
    expect(flipsAngles('src/Button.jsx', 'export const big = n > 1')).toBe(false)
    expect(flipsAngles('src/view.js', 'export const v = () => <b className="x">{label}</b>')).toBe(false)
    expect(flipsAngles('src/icon.js', 'export const i = <img src={u} />')).toBe(false)
  })
})

describe('TypeScript types are not mutated: a change there does nothing at run time (review #9)', () => {
  const changes = (source: string) => mutantsOf(source, { angles: false, types: true, max: 20 }).map(mutant => mutant.text)

  test('a type alias and an interface give no mutants', () => {
    expect(changes('type Port = 8080 | 8081')).toEqual([])
    expect(changes('interface Options { ok: true; retries: 3 }')).toEqual([])
    expect(changes('export type Flag = true\nexport const flag = true')).toEqual(['export type Flag = true\nexport const flag = false'])
  })

  test('the type after a variable, a parameter or a return is skipped; the values are not', () => {
    expect(changes('const port: 8080 = 8080')).toEqual(['const port: 8080 = 8081'])
    expect(changes('function f(flag: true = true): 0 | 1 { return 1 }')).toEqual([
      'function f(flag: true = false): 0 | 1 { return 1 }',
      'function f(flag: true = true): 0 | 1 { return 2 }',
    ])
    expect(changes('const g = (n: 3): void => n === 3')).toEqual(['const g = (n: 3): void => n !== 3', 'const g = (n: 3): void => n === 4'])
  })

  test('object literals and ternaries still change, being values', () => {
    expect(changes('const o = { a: 1 }')).toEqual(['const o = { a: 2 }'])
    expect(changes('const v = c ? 1 : 2')).toEqual(['const v = c ? 2 : 2', 'const v = c ? 1 : 3'])
    // `(a) : 2` looks like a return type at first, but nothing after it is a body or an arrow.
    expect(changes('const v = c ? (a) : 2')).toEqual(['const v = c ? (a) : 3'])
  })

  test('without types (JavaScript) nothing is skipped', () => {
    expect(mutantsOf('const o = { ok: true }', { angles: true, types: false }).map(mutant => mutant.text)).toEqual(['const o = { ok: false }'])
  })
})
