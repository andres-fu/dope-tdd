import { describe, expect, test } from 'claude-code/testing'

import { findRunner } from '../hooks/findRunner'

/** A disk of these files and their text: `exists` and `read` both answer from it. */
function disk(files: Record<string, string>) {
  return {
    exists: (path: string) => Promise.resolve(path in files),
    read: (path: string) => Promise.resolve(files[path] ?? null),
  }
}

// Python's own unittest (2026-10-19): the catch check's runner for a project with no sign of pytest.
describe('Python: pytest where it is set up, else unittest', () => {
  test('no pytest marker: unittest, through the python on PATH', async () => {
    const { exists, read } = disk({ 'C:/calc/pkg/calc.py': '' })
    expect(await findRunner('C:/calc', 'python', 'C:/calc/tests/test_calc.py', exists, read)).toEqual({ kind: 'unittest', root: 'C:/calc', tool: 'python' })
  })

  test("no pytest marker but a venv at the root: unittest through the venv's python", async () => {
    const { exists, read } = disk({ 'C:/calc/.venv/Scripts/python.exe': '' })
    expect(await findRunner('C:/calc', 'python', 'C:/calc/tests/test_calc.py', exists, read)).toEqual({
      kind: 'unittest',
      root: 'C:/calc',
      tool: 'C:/calc/.venv/Scripts/python.exe',
    })
  })

  test("pytest's own config files mean pytest by their presence alone", async () => {
    for (const marker of ['pytest.ini', 'conftest.py', 'tests/conftest.py']) {
      const { exists, read } = disk({ [`C:/calc/${marker}`]: '' })
      expect((await findRunner('C:/calc', 'python', 'C:/calc/tests/test_calc.py', exists, read))?.kind).toBe('pytest')
    }
  })

  // Verified review D5 (2026-10-20): any pyproject.toml, setup.cfg, tox.ini or setup.py meant pytest, so a unittest-only
  // project got `python -m pytest`, which failed to start. Those files now mean pytest only when they mention it.
  test('a general Python config file means pytest only when it mentions pytest', async () => {
    const unittestFile = 'import unittest\n\nclass CalcTest(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(2, 2)\n'
    const bare = disk({ 'C:/calc/pyproject.toml': '[project]\nname = "calc"\n', 'C:/calc/tests/test_calc.py': unittestFile })
    expect((await findRunner('C:/calc', 'python', 'C:/calc/tests/test_calc.py', bare.exists, bare.read))?.kind).toBe('unittest')
    for (const [file, text] of [
      ['pyproject.toml', '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n'],
      ['pyproject.toml', '[project.optional-dependencies]\ntest = [\n  "pytest>=8",\n]\n'],
      ['setup.cfg', '[tool:pytest]\naddopts = -q\n'],
      ['tox.ini', '[pytest]\naddopts = -q\n'],
    ] as const) {
      const { exists, read } = disk({ [`C:/calc/${file}`]: text, 'C:/calc/tests/test_calc.py': unittestFile })
      expect((await findRunner('C:/calc', 'python', 'C:/calc/tests/test_calc.py', exists, read))?.kind).toBe('pytest')
    }
  })

  // Karl's round 3 (2026-10-19): requirements.txt was the only marker, so the catch check ran `python -m unittest` on a
  // pytest file, found 0 tests, and every green was "not checked (baseline: no tests ran)".
  test('a requirements file that lists pytest means pytest; one that does not, does not', async () => {
    const listed = disk({ 'C:/calc/requirements.txt': 'fastapi==0.115.0\npytest==9.0.3\n' })
    expect(await findRunner('C:/calc', 'python', 'C:/calc/tests/test_calc.py', listed.exists, listed.read)).toEqual({ kind: 'pytest', root: 'C:/calc', tool: 'python' })
    const dev = disk({ 'C:/calc/requirements-dev.txt': 'pytest-cov>=5\n' })
    expect((await findRunner('C:/calc', 'python', 'C:/calc/tests/test_calc.py', dev.exists, dev.read))?.kind).toBe('pytest')
    const without = disk({ 'C:/calc/requirements.txt': 'fastapi==0.115.0\n# pytest later\n' })
    expect((await findRunner('C:/calc', 'python', 'C:/calc/tests/test_calc.py', without.exists, without.read))?.kind).toBe('unittest')
  })

  test('with no marker at all, a test file written for pytest means pytest; one written for unittest keeps unittest', async () => {
    const imports = disk({ 'C:/calc/tests/test_calc.py': 'import pytest\n\ndef test_add():\n    assert 1 + 1 == 2\n' })
    expect((await findRunner('C:/calc', 'python', 'C:/calc/tests/test_calc.py', imports.exists, imports.read))?.kind).toBe('pytest')
    const bare = disk({ 'C:/calc/tests/test_calc.py': 'from calc import add\n\ndef test_add():\n    assert add(1, 1) == 2\n' })
    expect((await findRunner('C:/calc', 'python', 'C:/calc/tests/test_calc.py', bare.exists, bare.read))?.kind).toBe('pytest')
    const classic = disk({ 'C:/calc/tests/test_calc.py': 'import unittest\n\nclass CalcTest(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(2, 2)\n' })
    expect((await findRunner('C:/calc', 'python', 'C:/calc/tests/test_calc.py', classic.exists, classic.read))?.kind).toBe('unittest')
  })
})

const NODE_TEST_SCRIPT =JSON.stringify({ scripts: { test: 'node --test "test/**/*.test.js"' } })

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
