// The part of 'claude-code/testing' the unit tests use (describe, test, expect), on node --test, so a pure module's
// test file runs alone in well under a second and dope-tdd can read it (#59, the 2026-10-18 dogfooding). The same
// files still run in `claude plugin test`; tests/node/kit.test.mjs holds each matcher to the kit's behaviour.
import { AssertionError } from 'node:assert'
import { describe, test } from 'node:test'

export { describe, test }

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Deep equality as the kit's toEqual has it: properties whose value is undefined are ignored, array lengths are not.
function equals(a, b) {
  if (Object.is(a, b)) {
    return true
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => equals(item, b[i]))
  }
  if (a instanceof Map && b instanceof Map) {
    return a.size === b.size && [...a].every(([key, value]) => b.has(key) && equals(value, b.get(key)))
  }
  if (a instanceof Set && b instanceof Set) {
    return a.size === b.size && [...a].every(item => b.has(item))
  }
  if (a instanceof RegExp && b instanceof RegExp) {
    return String(a) === String(b)
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = object => Object.keys(object).filter(key => object[key] !== undefined)
    const [ka, kb] = [keys(a), keys(b)]
    return ka.length === kb.length && ka.every(key => Object.hasOwn(b, key) && equals(a[key], b[key]))
  }
  return false
}

// Every property the expected object names matches, deeply; arrays are compared whole.
function matchesObject(actual, expected) {
  if (!isPlainObject(expected) || !isPlainObject(actual)) {
    return equals(actual, expected)
  }
  return Object.keys(expected).every(key => Object.hasOwn(actual, key) && matchesObject(actual[key], expected[key]))
}

const show = value => {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

const MATCHERS = {
  toBe: (actual, expected) => Object.is(actual, expected),
  toEqual: (actual, expected) => equals(actual, expected),
  toMatch: (actual, expected) => (expected instanceof RegExp ? expected.test(actual) : String(actual).includes(expected)),
  toContain: (actual, expected) => (typeof actual === 'string' ? actual.includes(expected) : [...actual].includes(expected)),
  toMatchObject: (actual, expected) => matchesObject(actual, expected),
  toBeNull: actual => actual === null,
  toBeUndefined: actual => actual === undefined,
  toHaveLength: (actual, expected) => actual?.length === expected,
  toBeGreaterThanOrEqual: (actual, expected) => actual >= expected,
  toBeLessThanOrEqual: (actual, expected) => actual <= expected,
  toBeLessThan: (actual, expected) => actual < expected,
}

function matchers(actual, negated) {
  return Object.fromEntries(
    Object.entries(MATCHERS).map(([name, holds]) => [
      name,
      (...expected) => {
        if (holds(actual, ...expected) === negated) {
          throw new AssertionError({
            message: `expected ${show(actual)} ${negated ? 'not ' : ''}${name} ${expected.map(show).join(', ')}`,
            actual,
            expected: expected[0],
            operator: name,
          })
        }
      },
    ]),
  )
}

export function expect(actual) {
  return { ...matchers(actual, false), not: matchers(actual, true) }
}
