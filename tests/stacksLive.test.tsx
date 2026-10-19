import { describe, expect } from 'claude-code/testing'

import { OVERRIDE_HINT } from '../hooks/refusals'

import { ROOT, editAt, fakeEngine, runBash, runCommand, test, writeAt } from './engine'
import type { FakeWorld } from './engine'
import { DOTNET_FAIL, DOTNET_PASS, GDUNIT_FAIL, GDUNIT_PASS, NODE_TEST_REAL_FAIL, NODE_TEST_REAL_IPC_CRASH, NODE_TEST_REAL_PASS, PYTEST_FAIL, PYTEST_PASS } from './fixtures/runnerOutputs'

/** The project's own files at the root, which is how the guard learns the stack without a config file. */
function godotProject(world: FakeWorld) {
  world.hasVitest = false
  world.existingFiles.add(`${ROOT}/project.godot`)
  world.existingFiles.add(`${ROOT}/addons/gdUnit4/bin/GdUnitCmdTool.gd`)
  world.fileContents.set(`${ROOT}/player.gd`, 'extends Node\nvar a = 1\n')
}

/** The experimental runners check in place, so a test of that check opts in the way a person would. */
function allowInPlaceCheck(world: FakeWorld, fields = '') {
  world.fileContents.set(`${ROOT}/dope-tdd.json`, `{ "catchCheck": true${fields === '' ? '' : `, ${fields}`} }`)
}

function pythonProject(world: FakeWorld) {
  world.hasVitest = false
  world.existingFiles.add(`${ROOT}/pyproject.toml`)
  world.existingFiles.add(`${ROOT}/.venv/Scripts/python.exe`)
  world.fileContents.set(`${ROOT}/src/pkg/calc.py`, 'def add(a, b):\n    return a + b\n')
}

describe('a Godot project with gdUnit4, no config file', () => {
  test('the stack is detected, the deny names the gdUnit4 test path, and addons are left alone', async ($, on) => {
    const world = fakeEngine(on)
    godotProject(world)

    const blocked = await editAt($, 'player.gd')
    const addon = await editAt($, 'addons/gdUnit4/src/core/GdUnitSettings.gd')
    const status = await runCommand($, 'tdd')

    expect(blocked.deny.split('\n')[0]).toBe('dope-tdd: write the failing test first. Touch test/player_test.gd, or run it and see it fail, before editing player. That test path is a guess from the default layout; if this project keeps its tests elsewhere, ask the user to run /tdd setup.')
    expect(blocked.deny.split('\n')).toContain(OVERRIDE_HINT)
    expect(addon.deny).toBeUndefined()
    expect(status.text).toMatch(/stack: godot \(detected\)/)
    expect(status.text).toMatch(/exempt: addons\/\*\*/)
  })

  test('red, green, and a catch check run headless through the command-line tool on the Godot binary from the environment', async ($, on) => {
    const world = fakeEngine(on, { env: { GODOT_BIN: 'C:/Godot/Godot_v4.exe' } })
    godotProject(world)
    allowInPlaceCheck(world)

    const touched = await writeAt($, 'test/player_test.gd', 'extends GdUnitTestSuite\nfunc test_jump():\n\tassert_int(1).is_equal(1)\n')
    world.bashText = GDUNIT_FAIL
    await runBash($, 'addons\\gdUnit4\\runtest.cmd -a res://test/player_test.gd')
    const red = await runCommand($, 'tdd')
    const allowed = await editAt($, 'player.gd')
    world.bashText = GDUNIT_PASS
    world.catchRun = { text: GDUNIT_FAIL, exitCode: 100 }
    await runBash($, 'addons\\gdUnit4\\runtest.cmd -a res://test/player_test.gd')
    const green = await runCommand($, 'tdd')

    expect(touched.context?.join(' ')).toMatch(/player unlocked/)
    expect(red.text).toMatch(/phase: RED/)
    expect(red.text).toMatch(/module: player/)
    expect(allowed.deny).toBeUndefined()
    const check = world.gitCalls.find(argv => argv.includes('--ignoreHeadlessMode'))
    expect(check?.[0]).toBe('C:/Godot/Godot_v4.exe')
    expect(check).toContain('--headless')
    expect(check).toContain('res://test/player_test.gd')
    expect(green.text).toMatch(/caught 1/)
  })

  test('the Godot binary named in dope-tdd.json wins over the environment', async ($, on) => {
    const world = fakeEngine(on, { env: { GODOT_BIN: 'C:/Godot/Godot_v4.exe' } })
    godotProject(world)
    allowInPlaceCheck(world, '"godot": "D:/tools/godot.exe"')

    await writeAt($, 'test/player_test.gd', 'func test_jump():\n\tassert_int(1).is_equal(1)\n')
    world.bashText = GDUNIT_FAIL
    await runBash($, 'addons/gdUnit4/runtest.sh -a res://test/player_test.gd')
    await editAt($, 'player.gd')
    world.bashText = GDUNIT_PASS
    world.catchRun = { text: GDUNIT_FAIL, exitCode: 100 }
    await runBash($, 'addons/gdUnit4/runtest.sh -a res://test/player_test.gd')

    const check = world.gitCalls.find(argv => argv.includes('--ignoreHeadlessMode'))
    expect(check?.[0]).toBe('D:/tools/godot.exe')
  })
})

describe('a Python project with pytest, no config file', () => {
  test('the deny names the pytest file, the venv python runs the catch check, and the fix is caught', async ($, on) => {
    const world = fakeEngine(on)
    pythonProject(world)
    allowInPlaceCheck(world)
    const ownFailure = PYTEST_FAIL.replace(/tests[\\/]test_other\.py/g, 'tests/pkg/test_calc.py')

    const blocked = await editAt($, 'src/pkg/calc.py')
    const touched = await writeAt($, 'tests/pkg/test_calc.py', 'from pkg.calc import add\n\ndef test_add():\n    assert add(1, 2) == 3\n')
    world.bashText = ownFailure
    await runBash($, 'python -m pytest tests/pkg/test_calc.py')
    const red = await runCommand($, 'tdd')
    const allowed = await editAt($, 'src/pkg/calc.py')
    world.bashText = PYTEST_PASS
    world.catchRun = { text: ownFailure, exitCode: 1 }
    await runBash($, 'python -m pytest tests/pkg/test_calc.py')
    const green = await runCommand($, 'tdd')

    expect(blocked.deny.split('\n')[0]).toBe('dope-tdd: write the failing test first. Touch tests/pkg/test_calc.py, or run it and see it fail, before editing src/pkg/calc. That test path is a guess from the default layout; if this project keeps its tests elsewhere, ask the user to run /tdd setup.')
    expect(blocked.deny.split('\n')).toContain(OVERRIDE_HINT)
    expect(touched.context?.join(' ')).toMatch(/pkg\/calc unlocked/)
    expect(red.text).toMatch(/phase: RED/)
    expect(allowed.deny).toBeUndefined()
    const check = world.gitCalls.find(argv => argv.includes('pytest'))
    expect(check?.[0]).toBe(`${ROOT}/.venv/Scripts/python.exe`)
    expect(check?.slice(-1)).toEqual(['tests/pkg/test_calc.py'])
    expect(green.text).toMatch(/caught 1/)
    expect(green.text).toMatch(/stack: python \(detected\)/)
  })
  test('pytest is experimental: by default its check never writes the source, and says how to allow it', async ($, on) => {
    const world = fakeEngine(on)
    pythonProject(world)
    const ownFailure = PYTEST_FAIL.replace(/tests[\\/]test_other\.py/g, 'tests/pkg/test_calc.py')

    await writeAt($, 'tests/pkg/test_calc.py', 'from pkg.calc import add\n\ndef test_add():\n    assert add(1, 2) == 3\n')
    world.bashText = ownFailure
    await runBash($, 'python -m pytest tests/pkg/test_calc.py')
    await editAt($, 'src/pkg/calc.py')
    world.bashText = PYTEST_PASS
    const green = await runBash($, 'python -m pytest tests/pkg/test_calc.py')
    const status = await runCommand($, 'tdd')

    expect(world.writes.filter(([path]) => path === `${ROOT}/src/pkg/calc.py`)).toEqual([])
    expect(world.gitCalls.some(argv => argv.includes('pytest'))).toBe(false)
    expect(green.context?.join(' ')).toMatch(/pytest is experimental, so its check would undo your change on disk; "catchCheck": true in dope-tdd.json allows it/)
    expect(status.text).toMatch(/unverified 1/)
  })
})

describe('a Godot .NET project with gdUnit4 in C#, paired by name', () => {
  test('the deny names the C# test, the catch check runs through dotnet test with a filter, and the fix is caught', async ($, on) => {
    const world = fakeEngine(on)
    world.hasVitest = false
    world.existingFiles.add(`${ROOT}/project.godot`)
    world.existingFiles.add(`${ROOT}/addons/gdUnit4/bin/GdUnitCmdTool.gd`)
    allowInPlaceCheck(world, '"layout": "godot-csharp"')
    world.fileContents.set(`${ROOT}/scripts/show/BeatDeck.cs`, 'public static class BeatDeck { public static int a = 1; }')

    const blocked = await editAt($, 'scripts/show/BeatDeck.cs')
    const touched = await writeAt($, 'test/BeatDeckTest.cs', '[TestSuite] public class BeatDeckTest { [TestCase] public void Draws() { AssertInt(1).IsEqual(1); } }')
    world.bashText = DOTNET_FAIL
    await runBash($, 'dotnet test --filter FullyQualifiedName~BeatDeckTest')
    const red = await runCommand($, 'tdd')
    const allowed = await editAt($, 'scripts/show/BeatDeck.cs')
    world.bashText = DOTNET_PASS
    world.catchRun = { text: DOTNET_FAIL, exitCode: 1 }
    await runBash($, 'dotnet test --filter FullyQualifiedName~BeatDeckTest')
    const green = await runCommand($, 'tdd')

    expect(blocked.deny.split('\n')[0]).toBe('dope-tdd: write the failing test first. Touch test/BeatDeckTest.cs, or run it and see it fail, before editing BeatDeck.')
    expect(blocked.deny.split('\n')).toContain(OVERRIDE_HINT)
    expect(touched.context?.join(' ')).toMatch(/BeatDeck unlocked/)
    expect(red.text).toMatch(/phase: RED/)
    expect(red.text).toMatch(/module: BeatDeck/)
    expect(allowed.deny).toBeUndefined()
    const check = world.gitCalls.find(argv => argv[0] === 'dotnet')
    expect(check).toContain('--filter')
    expect(check).toContain('FullyQualifiedName~BeatDeckTest')
    expect(green.text).toMatch(/caught 1/)
  })
})

describe('Python without a venv in the repo', () => {
  for (const [lock, launcher] of [
    ['uv.lock', ['uv', 'run', 'python']],
    ['poetry.lock', ['poetry', 'run', 'python']],
    ['pdm.lock', ['pdm', 'run', 'python']],
    ['Pipfile.lock', ['pipenv', 'run', 'python']],
  ] as const) {
    test(`${lock}: the catch check runs pytest through ${launcher[0]}, which knows where the environment lives`, async ($, on) => {
      const world = fakeEngine(on)
      world.hasVitest = false
      world.existingFiles.add(`${ROOT}/pyproject.toml`)
      world.existingFiles.add(`${ROOT}/${lock}`)
      allowInPlaceCheck(world)
      world.fileContents.set(`${ROOT}/src/pkg/calc.py`, 'def add(a, b):\n    return a + b\n')
      const ownFailure = PYTEST_FAIL.replace(/tests[\/]test_other\.py/g, 'tests/pkg/test_calc.py')

      await writeAt($, 'tests/pkg/test_calc.py', 'from pkg.calc import add\n\ndef test_add():\n    assert add(1, 2) == 3\n')
      world.bashText = ownFailure
      await runBash($, `${launcher[0]} run pytest tests/pkg/test_calc.py`)
      await editAt($, 'src/pkg/calc.py')
      world.bashText = PYTEST_PASS
      world.catchRun = { text: ownFailure, exitCode: 1 }
      await runBash($, `${launcher[0]} run pytest tests/pkg/test_calc.py`)

      const check = world.gitCalls.find(argv => argv.includes('pytest'))
      expect(check?.slice(0, 5)).toEqual([...launcher, '-m', 'pytest'])
    })
  }
})

describe('the shell gate knows every stack', () => {
  test('an in-place sed on a Python source with no test touched is refused like an Edit', async ($, on) => {
    const world = fakeEngine(on)
    pythonProject(world)

    const result = await runBash($, "sed -i 's/a + b/a - b/' src/pkg/calc.py")

    expect(result.deny).toMatch(/write the failing test first/)
  })
})

describe("a Node project tested with Node's built-in runner", () => {
  test('the package script names node --test, so the catch check runs the one file through node --test', async ($, on) => {
    const world = fakeEngine(on)
    world.hasVitest = false
    world.fileContents.set(`${ROOT}/package.json`, JSON.stringify({ scripts: { test: 'node --test "test/**/*.test.js"' } }))
    world.fileContents.set(`${ROOT}/src/helpers.js`, 'module.exports = { add: (a, b) => a + b }')

    // The real red, with its file named as this project's.
    const redHere = NODE_TEST_REAL_FAIL.replace('test\\broken.test.js', 'tests\\helpers.test.js')
    await writeAt($, 'tests/helpers.test.js', "test('adds', () => assert.equal(add(1, 1), 3))")
    world.bashFails = true
    world.bashText = redHere
    await runBash($, 'node --test tests/helpers.test.js')
    const red = await runCommand($, 'tdd')
    await editAt($, 'src/helpers.js')
    world.bashFails = false
    world.bashText = NODE_TEST_REAL_PASS
    world.baselineRun = { text: NODE_TEST_REAL_PASS, exitCode: 0 }
    world.catchRun = { text: redHere, exitCode: 1 }
    await runBash($, 'node --test tests/helpers.test.js')
    const status = await runCommand($, 'tdd')

    expect(red.text).toMatch(/phase: RED/)
    const check = world.gitCalls.find(argv => argv.includes('--test'))
    expect(check).toEqual(['node', '--test', 'tests/helpers.test.js'])
    expect(status.text).toMatch(/caught 1/)
  })

  test('a check run that node --test crashed on is run once more, and the second run decides (#26)', async ($, on) => {
    const world = fakeEngine(on)
    world.hasVitest = false
    world.fileContents.set(`${ROOT}/package.json`, JSON.stringify({ scripts: { test: 'node --test "test/**/*.test.js"' } }))
    world.fileContents.set(`${ROOT}/src/helpers.js`, 'module.exports = { add: (a, b) => a + b }')
    const redHere = NODE_TEST_REAL_FAIL.replace('test\\broken.test.js', 'tests\\helpers.test.js')
    const crashHere = NODE_TEST_REAL_IPC_CRASH.replace(/test\\sources\\youtube\.test\.js/g, 'tests\\helpers.test.js')

    await writeAt($, 'tests/helpers.test.js', "test('adds', () => assert.equal(add(1, 1), 3))")
    world.bashFails = true
    world.bashText = redHere
    await runBash($, 'node --test tests/helpers.test.js')
    await editAt($, 'src/helpers.js')
    world.bashFails = false
    world.bashText = NODE_TEST_REAL_PASS
    world.baselineRun = { text: NODE_TEST_REAL_PASS, exitCode: 0 }
    // The first check run crashes; the second one is a real red.
    let checkRuns = 0
    world.catchRun = { text: crashHere, exitCode: 1 }
    world.onCatchRun = () => {
      checkRuns++
      if (checkRuns === 2) {
        world.catchRun = { text: redHere, exitCode: 1 }
      }
    }
    await runBash($, 'node --test tests/helpers.test.js')
    const status = await runCommand($, 'tdd')

    expect(checkRuns).toBe(2)
    expect(status.text).toMatch(/caught 1/)
    expect(world.logs.join('\n')).toMatch(/node --test could not read its test process output; ran it once more/)
  })

  test('a check that crashes twice is unverified with the reason, never caught (#26)', async ($, on) => {
    const world = fakeEngine(on)
    world.hasVitest = false
    world.fileContents.set(`${ROOT}/package.json`, JSON.stringify({ scripts: { test: 'node --test "test/**/*.test.js"' } }))
    world.fileContents.set(`${ROOT}/src/helpers.js`, 'module.exports = { add: (a, b) => a + b }')
    const redHere = NODE_TEST_REAL_FAIL.replace('test\\broken.test.js', 'tests\\helpers.test.js')
    const crashHere = NODE_TEST_REAL_IPC_CRASH.replace(/test\\sources\\youtube\.test\.js/g, 'tests\\helpers.test.js')

    await writeAt($, 'tests/helpers.test.js', "test('adds', () => assert.equal(add(1, 1), 3))")
    world.bashFails = true
    world.bashText = redHere
    await runBash($, 'node --test tests/helpers.test.js')
    await editAt($, 'src/helpers.js')
    world.bashFails = false
    world.bashText = NODE_TEST_REAL_PASS
    world.baselineRun = { text: NODE_TEST_REAL_PASS, exitCode: 0 }
    world.catchRun = { text: crashHere, exitCode: 1 }
    await runBash($, 'node --test tests/helpers.test.js')
    const status = await runCommand($, 'tdd')

    expect(status.text).not.toMatch(/caught 1/)
    expect(status.text).toMatch(/unverified 1/)
  })

  test("the agent's own run that node --test crashed on is not a red, and the advice says what happened (#26)", async ($, on) => {
    const world = fakeEngine(on)
    world.hasVitest = false
    world.fileContents.set(`${ROOT}/package.json`, JSON.stringify({ scripts: { test: 'node --test "test/**/*.test.js"' } }))
    world.fileContents.set(`${ROOT}/src/helpers.js`, 'module.exports = { add: (a, b) => a + b }')

    world.bashFails = true
    world.bashText = NODE_TEST_REAL_IPC_CRASH.replace(/test\\sources\\youtube\.test\.js/g, 'tests\\helpers.test.js')
    const result = await runBash($, 'node --test tests/helpers.test.js')
    const status = await runCommand($, 'tdd')
    const blocked = await editAt($, 'src/helpers.js')

    expect(result.context?.join(' ')).toMatch(/node --test could not read its test process output .*nothing was counted/)
    expect(status.text).not.toMatch(/phase: RED/)
    expect(blocked.deny).toMatch(/write the failing test first/)
  })

  test('a node --test run filtered to its counts is read, and an unread one gets the node --test hint (#18)', async ($, on) => {
    const world = fakeEngine(on)
    world.hasVitest = false
    world.fileContents.set(`${ROOT}/package.json`, JSON.stringify({ scripts: { test: 'node --test "test/**/*.test.js"' } }))
    world.fileContents.set(`${ROOT}/src/helpers.js`, 'module.exports = { add: (a, b) => a + b }')

    await writeAt($, 'tests/helpers.test.js', "test('adds', () => assert.equal(add(1, 1), 3))")
    world.bashFails = true
    world.bashText = '  ✖ adds (0.7ms)\nℹ tests 1\nℹ pass 0\nℹ fail 1\n'
    await runBash($, 'node --test tests/helpers.test.js 2>&1 | grep -E "✖|ℹ (tests|pass|fail)"')
    const red = await runCommand($, 'tdd')
    world.bashText = '  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n      at TestContext.<anonymous> (tests\\helpers.test.js:6:41)\n'
    const cut = await runBash($, 'node --test tests/helpers.test.js 2>&1 | tail -2')

    expect(red.text).toMatch(/phase: RED/)
    expect(cut.context?.join(' ')).toMatch(/node --test prints its summary before the failures/)
  })
})

describe('a Node project tested with ava', () => {
  test('the catch check finds ava in node_modules and runs the spec file through it', async ($, on) => {
    const world = fakeEngine(on)
    world.hasVitest = false
    world.existingFiles.add(`${ROOT}/node_modules/ava/entrypoints/cli.js`)
    world.fileContents.set(`${ROOT}/src/utils/path.ts`, 'export const a = 1')

    await writeAt($, 'src/utils/path.spec.ts', "test('x', t => { t.is(1, 2) })")
    world.bashFails = true
    world.bashText = '  ✘ [fail]: x\n  ─\n\n  src/utils/path.spec.ts:1\n\n  ─\n\n  1 test failed\n'
    await runBash($, 'npx ava src/utils/path.spec.ts')
    await editAt($, 'src/utils/path.ts')
    world.bashFails = false
    world.bashText = '  ✔ x\n  ─\n\n  1 test passed\n'
    world.baselineRun = { text: '  ✔ x\n  ─\n\n  1 test passed\n', exitCode: 0 }
    world.catchRun = { text: '  ✘ [fail]: x\n  ─\n\n  src/utils/path.spec.ts:1\n\n  ─\n\n  1 test failed\n', exitCode: 1 }
    await runBash($, 'npx ava src/utils/path.spec.ts')
    const status = await runCommand($, 'tdd')

    const check = world.gitCalls.find(argv => argv.some(arg => arg.includes('ava/entrypoints/cli.js')))
    expect(check).toEqual(['node', `${ROOT}/node_modules/ava/entrypoints/cli.js`, 'src/utils/path.spec.ts'])
    expect(status.text).toMatch(/caught 1/)
  })
})
