// tests/node/register.mjs lets a kit test file run on node --test: 'claude-code/testing' resolves to the shim, and
// a relative import with no extension finds its .ts file.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))

test('a kit test file runs and passes on node --test through the register hook', () => {
  const run = spawnSync(process.execPath, ['--import', './tests/node/register.mjs', '--test', 'tests/node/fixtures/sample.case.ts'], {
    cwd: root,
    encoding: 'utf8',
    // The outer node --test marks its children; one that sees the mark refuses to run test files of its own.
    env: { ...process.env, NODE_TEST_CONTEXT: undefined },
  })
  assert.match(run.stdout, /^.{0,4}pass 1$/m, run.stdout + run.stderr)
  assert.match(run.stdout, /^.{0,4}fail 0$/m)
})
