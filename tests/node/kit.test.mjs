// The node --test stand-in for the kit's expect (tests/node/kit.mjs). Each matcher must pass where the kit's
// passes and throw where it throws, or a test could go green on Node and red in the kit, or the reverse.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { expect } from './kit.mjs'

const fails = fn => assert.throws(fn, { name: 'AssertionError' })

test('toBe compares by identity, and NaN is NaN', () => {
  expect(1).toBe(1)
  expect(Number.NaN).toBe(Number.NaN)
  fails(() => expect({}).toBe({}))
  fails(() => expect(0).toBe(-0))
})

test('toEqual compares deeply and ignores properties that are undefined', () => {
  expect({ a: [1, { b: 2 }] }).toEqual({ a: [1, { b: 2 }] })
  expect({ a: 1, b: undefined }).toEqual({ a: 1 })
  fails(() => expect({ a: 1 }).toEqual({ a: 2 }))
  fails(() => expect([1, 2]).toEqual([1, 2, 3]))
  fails(() => expect([undefined]).toEqual([]))
})

test('toMatch takes a regular expression or a substring', () => {
  expect('dope-tdd: RED').toMatch(/RED$/)
  expect('dope-tdd: RED').toMatch('tdd')
  fails(() => expect('green').toMatch(/RED/))
})

test('toContain finds a substring, or an item by identity', () => {
  expect('abc').toContain('b')
  expect(['a', 'b']).toContain('b')
  fails(() => expect([{ a: 1 }]).toContain({ a: 1 }))
  fails(() => expect('abc').toContain('z'))
})

test('toMatchObject checks a subset of properties, deeply', () => {
  expect({ a: 1, b: { c: 2, d: 3 } }).toMatchObject({ b: { c: 2 } })
  fails(() => expect({ a: 1 }).toMatchObject({ a: 1, b: 2 }))
})

test('null, undefined, length and number comparisons', () => {
  expect(null).toBeNull()
  expect(undefined).toBeUndefined()
  expect([1, 2]).toHaveLength(2)
  expect(2).toBeGreaterThanOrEqual(2)
  expect(2).toBeLessThanOrEqual(2)
  expect(1).toBeLessThan(2)
  fails(() => expect(undefined).toBeNull())
  fails(() => expect(null).toBeUndefined())
  fails(() => expect('abc').toHaveLength(2))
  fails(() => expect(1).toBeGreaterThanOrEqual(2))
  fails(() => expect(3).toBeLessThanOrEqual(2))
  fails(() => expect(2).toBeLessThan(2))
})

test('not inverts every matcher', () => {
  expect(1).not.toBe(2)
  expect('abc').not.toContain('z')
  expect('abc').not.toMatch(/z/)
  expect(0).not.toBeNull()
  fails(() => expect(1).not.toBe(1))
  fails(() => expect(null).not.toBeNull())
})
