import { describe, expect, test } from 'claude-code/testing'

import { assertionCalls, commentedOutLines, skipMarkers, testEditSignals } from '../hooks/workarounds'

const HONEST = "import { expect, test } from 'vitest'\n\ntest('formats', () => {\n  expect(formatCents(-1250)).toBe('-$12.50')\n  expect(formatCents(-50)).toBe('-$0.50')\n})\n"

describe('skipMarkers', () => {
  test('counts skip, only and todo on it, test and describe, and the x-prefixed forms', () => {
    expect(skipMarkers("it.skip('a', f); test.only('b', g); describe.todo('c'); xit('d', h); xdescribe('e', k)")).toBe(5)
    expect(skipMarkers(HONEST)).toBe(0)
  })
})

describe('assertionCalls', () => {
  test('counts assertion calls, not mentions', () => {
    expect(assertionCalls(HONEST)).toBe(2)
    expect(assertionCalls("import assert from 'node:assert'\nassert.equal(a, 1)\nassertEquals(b, 2)\n")).toBe(2)
  })
})

describe('testEditSignals', () => {
  test('a test edited to skip a case is a signal with how many markers were added', () => {
    const skipped = HONEST.replace("test('formats'", "test.skip('formats'")
    expect(testEditSignals(HONEST, skipped)).toEqual([{ kind: 'skipped', added: 1 }])
  })

  test('a test that lost an assertion is a signal with before and after counts', () => {
    const weakened = HONEST.replace("  expect(formatCents(-50)).toBe('-$0.50')\n", '')
    expect(testEditSignals(HONEST, weakened)).toEqual([{ kind: 'assertion-removed', before: 2, after: 1 }])
  })

  test('adding assertions or removing a skip is not a signal', () => {
    const stronger = HONEST.replace('})\n', "  expect(formatCents(0)).toBe('$0.00')\n})\n")
    const unskipped = HONEST.replace("test('formats'", "test.skip('formats'")
    expect(testEditSignals(HONEST, stronger)).toEqual([])
    expect(testEditSignals(unskipped, HONEST)).toEqual([])
  })
})

describe('commentedOutLines', () => {
  const before = 'export function f(a: number) {\n  if (a < 0) {\n    throw new Error("negative")\n  }\n  return a * 2\n}\n'

  test('counts code lines that come back commented out; a brace that is still code elsewhere is not one of them', () => {
    const after = 'export function f(a: number) {\n  // if (a < 0) {\n  //   throw new Error("negative")\n  // }\n  return a * 2\n}\n'
    expect(commentedOutLines(before, after)).toBe(2)
  })

  test('a comment that was already there, a new comment, or a line that is still code elsewhere does not count', () => {
    const withComment = '// doubles\n' + before
    const after = '// doubles\n// a new note\n' + before
    expect(commentedOutLines(withComment, after)).toBe(0)
    const moved = before.replace('  return a * 2\n', '  // return a * 2\n  return a * 2\n')
    expect(commentedOutLines(before, moved)).toBe(0)
  })

  test('deleting code outright is not commenting it out', () => {
    expect(commentedOutLines(before, 'export function f(a: number) {\n  return a * 2\n}\n')).toBe(0)
  })
})
