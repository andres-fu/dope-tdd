import { describe, expect, test } from 'claude-code/testing'

import { ROOT, editAt, fakeEngine, runBash, runCommand, writeAt } from './engine'
import type { FakeWorld } from './engine'
import { GDUNIT_FAIL, GDUNIT_PASS, PYTEST_FAIL, PYTEST_PASS } from './fixtures/runnerOutputs'

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

    expect(blocked.deny).toBe('dope-tdd: write the failing test first. Touch test/player_test.gd before editing player.')
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

    expect(blocked.deny).toBe('dope-tdd: write the failing test first. Touch tests/pkg/test_calc.py before editing src/pkg/calc.')
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
