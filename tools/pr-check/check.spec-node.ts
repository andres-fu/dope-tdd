// npx tsx --test tools/pr-check/check.spec-node.ts (not *.test.ts: the plugin test kit would load it)
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { report } from './check'

test('the report counts each verdict and lists every module with its reason', () => {
  const text = report(
    [
      { module: 'memory/liststore', source: 'a.py', test: 'tests/test_a.py', verdict: 'CAUGHT', note: 'the test fails without the change' },
      { module: 'utils/b', source: 'b.ts', test: null, verdict: 'UNTESTED', note: 'no test' },
    ],
    'origin/main (2526e8c)',
  )
  assert.match(text, /1 caught · 0 missed · 1 untested · 0 unverified, against origin\/main \(2526e8c\)\./)
  assert.match(text, /\| memory\/liststore \| tests\/test_a\.py \| \*\*CAUGHT\*\* \|/)
  assert.match(text, /\| utils\/b \| — \| \*\*UNTESTED\*\* \|/)
})

test('a pull request that touches no guarded source says so', () => {
  assert.match(report([], 'main'), /No source file in this pull request is one the project guards\./)
})
