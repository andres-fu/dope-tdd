// A unit test as the kit runs it: the kit's import and an import with no extension. Named .case.ts so neither
// `claude plugin test` nor a plain `node --test` run of tests/ picks it up; tests/node/register.test.mjs runs it.
import { describe, expect, test } from 'claude-code/testing'

import { double } from './helper'

describe('sample', () => {
  test('doubles', () => {
    expect(double(2)).toBe(4)
  })
})
