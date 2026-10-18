import { describe, expect, test } from 'claude-code/testing'

import { findRunner } from '../hooks/findRunner'

/** A disk of these files and their text: `exists` and `read` both answer from it. */
function disk(files: Record<string, string>) {
  return {
    exists: (path: string) => Promise.resolve(path in files),
    read: (path: string) => Promise.resolve(files[path] ?? null),
  }
}

const NODE_TEST_SCRIPT = JSON.stringify({ scripts: { test: 'node --test "test/**/*.test.js"' } })

describe("Node's built-in runner, found through the package's test script", () => {
  test('a package whose test script runs node --test runs its tests through node on PATH', async () => {
    const { exists, read } = disk({ 'C:/vibecast/package.json': NODE_TEST_SCRIPT })
    expect(await findRunner('C:/vibecast', 'node', 'C:/vibecast/test/helpers.test.js', exists, read)).toEqual({
      kind: 'node-test',
      root: 'C:/vibecast',
      tool: 'node',
    })
  })

  test('a flag before --test, and a named test script, count too', async () => {
    const flagged = disk({ 'C:/app/package.json': JSON.stringify({ scripts: { 'test:unit': 'node --test-reporter=spec --test test/' } }) })
    expect((await findRunner('C:/app', 'node', 'C:/app/test/a.test.js', flagged.exists, flagged.read))?.kind).toBe('node-test')
  })

  test('a package.json that never says node --test is no sign of it', async () => {
    const other = disk({ 'C:/app/package.json': JSON.stringify({ scripts: { test: 'mocha', start: 'node --test-reporter=spec index.js' } }) })
    expect(await findRunner('C:/app', 'node', 'C:/app/test/a.test.js', other.exists, other.read)).toBeNull()
  })

  test('an installed Vitest wins over the script', async () => {
    const both = disk({ 'C:/app/package.json': NODE_TEST_SCRIPT, 'C:/app/node_modules/vitest/vitest.mjs': '' })
    expect((await findRunner('C:/app', 'node', 'C:/app/test/a.test.js', both.exists, both.read))?.kind).toBe('vitest')
  })

  test("Node's own flags in the test script come with it, so a check can load the tests the same way", async () => {
    const { exists, read } = disk({
      'C:/dope-tdd/package.json': JSON.stringify({ scripts: { test: 'node --import ./tests/node/register.mjs --test tests/*.test.ts' } }),
    })
    expect(await findRunner('C:/dope-tdd', 'node', 'C:/dope-tdd/tests/runPlan.test.ts', exists, read)).toEqual({
      kind: 'node-test',
      root: 'C:/dope-tdd',
      tool: 'node',
      launcher: ['node', '--import', './tests/node/register.mjs'],
    })
  })

  test('a .tsx or .jsx test needs a loader that understands JSX: without one, node --test is not its runner (2026-10-18)', async () => {
    const ts = disk({ 'C:/dope-tdd/package.json': JSON.stringify({ scripts: { test: 'node --import ./tests/node/register.mjs --test tests/' } }) })
    expect(await findRunner('C:/dope-tdd', 'node', 'C:/dope-tdd/tests/band.test.tsx', ts.exists, ts.read)).toBeNull()
    expect((await findRunner('C:/dope-tdd', 'node', 'C:/dope-tdd/tests/runPlan.test.ts', ts.exists, ts.read))?.kind).toBe('node-test')
    const plain = disk({ 'C:/app/package.json': NODE_TEST_SCRIPT })
    expect(await findRunner('C:/app', 'node', 'C:/app/test/view.test.jsx', plain.exists, plain.read)).toBeNull()
  })

  test('with a JSX-capable loader in the script, node --test runs .tsx too', async () => {
    const tsx = disk({ 'C:/app/package.json': JSON.stringify({ scripts: { test: 'node --import tsx --test test/' } }) })
    expect((await findRunner('C:/app', 'node', 'C:/app/test/view.test.tsx', tsx.exists, tsx.read))?.kind).toBe('node-test')
  })

  test('without a way to read files, the script cannot be checked and nothing is guessed', async () => {
    const { exists } = disk({ 'C:/vibecast/package.json': NODE_TEST_SCRIPT })
    expect(await findRunner('C:/vibecast', 'node', 'C:/vibecast/test/helpers.test.js', exists)).toBeNull()
  })
})
