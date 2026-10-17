import { describe, expect, test } from 'claude-code/testing'

import { UNLOCK_TTL_MS, contentHash, freshUnlocks, hasAssertion, legacyUnlockKey, storeRoot, unlockEntry, unlockKey } from '../hooks/unlocks'

describe('store keys', () => {
  test('one spelling of the root, whatever Windows handed the session', () => {
    expect(storeRoot('C:\\Users\\x\\proj')).toBe('c:/Users/x/proj')
    expect(storeRoot('c:/Users/x/proj/')).toBe('c:/Users/x/proj')
    expect(storeRoot('/home/x/proj')).toBe('/home/x/proj')
    expect(unlockKey('C:\\Users\\x\\proj')).toBe(unlockKey('c:/Users/x/proj'))
    expect(legacyUnlockKey('C:\\Users\\x\\proj')).toBe('unlocks:C:\\Users\\x\\proj')
  })
})

describe('hasAssertion', () => {
  test('sees the common assertion calls', () => {
    for (const source of [
      "it('x', () => { expect(a).toBe(1) })",
      "assertEquals(a, 1)",
      "assert.strictEqual(a, 1)",
      "assert(a === 1)",
      "a.should.equal(1)",
      "test('x', t => { t.is(a, 1) })",
    ]) {
      expect(hasAssertion(source)).toBe(true)
    }
  })

  test('an import of assert is a mention, not an assertion', () => {
    expect(hasAssertion("import assert from 'node:assert'\nit('x', () => { run() })")).toBe(false)
  })

  test('a test body that only calls the code asserts nothing', () => {
    expect(hasAssertion("it('works', () => {\n  formatDuration(14)\n})\n")).toBe(false)
  })

  test('sees assertions in every stack, so a real C#, GDScript or pytest test is never called hollow', () => {
    for (const source of [
      'AssertThat(TipFormat.FormatTips(1.0)).IsEqual("$1");',
      'AssertFloat(VanCost.CostFor(40.0, 3.0, 0)).IsEqualApprox(40.0, 1e-9);',
      'AssertThrown(() => VanCost.CostFor(1, 1, -1)).IsInstanceOf<ArgumentOutOfRangeException>();',
      'Assert.Equal(3, Add(1, 2));',
      'def test_add():\n    assert add(1, 2) == 3\n',
      'func test_jump():\n\tassert_int(1).is_equal(1)\n',
    ]) {
      expect(hasAssertion(source)).toBe(true)
    }
  })

  test('a mention of assertions in another stack is still not an assertion', () => {
    expect(hasAssertion('using static GdUnit4.Assertions;\n[TestCase]\npublic void Runs() { VanCost.CostFor(1, 1, 0); }')).toBe(false)
    expect(hasAssertion('import pytest\n\ndef test_runs():\n    add(1, 2)\n')).toBe(false)
  })
})

describe('freshUnlocks', () => {
  test('keeps well-formed entries younger than the TTL and drops the rest', () => {
    const now = 10_000_000
    const stored = {
      fresh: { testPath: 'tests/a.test.ts', atMs: now - 1 },
      stale: { testPath: 'tests/b.test.ts', atMs: now - UNLOCK_TTL_MS - 1 },
      broken: { testPath: 3 },
    }
    expect(Object.keys(freshUnlocks(stored, now))).toEqual(['fresh'])
    expect(freshUnlocks('garbage', now)).toEqual({})
  })
})

describe('contentHash (#54)', () => {
  test('the same text hashes the same; any change to it does not', () => {
    expect(contentHash("it('a', () => {})\n")).toBe(contentHash("it('a', () => {})\n"))
    expect(contentHash("it('a', () => {})\n")).not.toBe(contentHash("it('b', () => {})\n"))
    expect(contentHash('')).toMatch(/^[0-9a-f]{8}$/)
  })

  // A checkout on Windows can rewrite LF as CRLF with no change to the test; that must not drop a carried-over unlock.
  test('line endings do not count as a change', () => {
    expect(contentHash('a\r\nb\r\n')).toBe(contentHash('a\nb\n'))
    expect(contentHash('a\r\nb\r\n')).not.toBe(contentHash('ab'))
  })
})

describe('freshUnlocks keeps the test hash (#54)', () => {
  test('an entry with a hash keeps it; one stored by an earlier build, without, is still fresh', () => {
    const fresh = freshUnlocks(
      {
        'utils/a': { testPath: 'tests/utils/a.test.ts', atMs: 10, testHash: '0badf00d' },
        'utils/b': { testPath: 'tests/utils/b.test.ts', atMs: 10 },
      },
      20,
    )
    expect(fresh['utils/a']).toEqual({ testPath: 'tests/utils/a.test.ts', atMs: 10, testHash: '0badf00d' })
    expect(fresh['utils/b']).toEqual({ testPath: 'tests/utils/b.test.ts', atMs: 10 })
  })
})

describe('unlockEntry (#54)', () => {
  test('stores the hash of the test as it was read', () => {
    expect(unlockEntry('tests/a.test.ts', 7, "it('a', () => {})\n")).toEqual({ testPath: 'tests/a.test.ts', atMs: 7, testHash: contentHash("it('a', () => {})\n") })
  })

  // Without a hash a later session keeps the unlock (still pending a run) instead of dropping it on a guess.
  test('an unreadable test is stored without a hash', () => {
    expect(unlockEntry('tests/a.test.ts', 7, null)).toEqual({ testPath: 'tests/a.test.ts', atMs: 7 })
  })
})
