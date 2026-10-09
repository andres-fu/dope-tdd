import { describe, expect, test } from 'claude-code/testing'

import { ROOT, editAt, fakeEngine, runBash, runCommand, writeAt } from './engine'
import type { FakeWorld } from './engine'
import { DOTNET_FAIL, DOTNET_PASS, GDUNIT_FAIL, GDUNIT_PASS, PYTEST_FAIL, PYTEST_PASS } from './fixtures/runnerOutputs'

/** The project's own files at the root, which is how the guard learns the stack without a config file. */
function godotProject(world: FakeWorld) {
  world.hasVitest = false
  world.existingFiles.add(`${ROOT}/project.godot`)
  world.existingFiles.add(`${ROOT}/addons/gdUnit4/bin/GdUnitCmdTool.gd`)
  world.fileContents.set(`${ROOT}/player.gd`, 'extends Node\nvar a = 1\n')
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

    expect(blocked.deny).toBe('dope-tdd: write the failing test first. Touch test/player_test.gd, or run it and see it fail, before editing player. That test path is a guess from the default layout; if this project keeps its tests elsewhere, ask the user to run /tdd setup.')
    expect(addon.deny).toBeUndefined()
    expect(status.text).toMatch(/stack: godot \(detected\)/)
    expect(status.text).toMatch(/exempt: addons\/\*\*/)
  })

  test('red, green, and a catch check run headless through the command-line tool on the Godot binary from the environment', async ($, on) => {
    const world = fakeEngine(on, { env: { GODOT_BIN: 'C:/Godot/Godot_v4.exe' } })
    godotProject(world)

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
    world.fileContents.set(`${ROOT}/dope-tdd.json`, '{ "godot": "D:/tools/godot.exe" }')

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

    expect(blocked.deny).toBe('dope-tdd: write the failing test first. Touch tests/pkg/test_calc.py, or run it and see it fail, before editing src/pkg/calc. That test path is a guess from the default layout; if this project keeps its tests elsewhere, ask the user to run /tdd setup.')
    expect(touched.context?.join(' ')).toMatch(/pkg\/calc unlocked/)
    expect(red.text).toMatch(/phase: RED/)
    expect(allowed.deny).toBeUndefined()
    const check = world.gitCalls.find(argv => argv.includes('pytest'))
    expect(check?.[0]).toBe(`${ROOT}/.venv/Scripts/python.exe`)
    expect(check?.slice(-1)).toEqual(['tests/pkg/test_calc.py'])
    expect(green.text).toMatch(/caught 1/)
    expect(green.text).toMatch(/stack: python \(detected\)/)
  })
})

describe('a Godot .NET project with gdUnit4 in C#, paired by name', () => {
  test('the deny names the C# test, the catch check runs through dotnet test with a filter, and the fix is caught', async ($, on) => {
    const world = fakeEngine(on)
    world.hasVitest = false
    world.existingFiles.add(`${ROOT}/project.godot`)
    world.existingFiles.add(`${ROOT}/addons/gdUnit4/bin/GdUnitCmdTool.gd`)
    world.fileContents.set(`${ROOT}/dope-tdd.json`, '{ "layout": "godot-csharp" }')
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

    expect(blocked.deny).toBe('dope-tdd: write the failing test first. Touch test/BeatDeckTest.cs, or run it and see it fail, before editing BeatDeck.')
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
