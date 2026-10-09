import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_CONFIG, describeConfig, parseConfig } from '../hooks/config'
import { classifyPath, testPathFor, watchedDirs } from '../hooks/mirror'
import type { LayoutConfig } from '../hooks/mirror'
import { inferLayout, suggestedConfig } from '../hooks/setup'
import { STACKS, detectStackFrom } from '../hooks/stacks'

const ROOT = 'C:/proj'

function layout(stack: keyof typeof STACKS, name: string): LayoutConfig {
  const preset = STACKS[stack].layouts[name]
  if (preset === undefined) {
    throw new Error(`no ${name} layout for ${stack}`)
  }
  return { layout: preset, roots: [], stack }
}

describe('which stack a project is', () => {
  test('a marker at the root decides, Godot before Node, Node before Python', () => {
    expect(detectStackFrom(['project.godot', 'package.json'])).toBe('godot')
    expect(detectStackFrom(['package.json', 'pyproject.toml'])).toBe('node')
    expect(detectStackFrom(['pyproject.toml', 'README.md'])).toBe('python')
    expect(detectStackFrom(['pom.xml'])).toBe('java')
    expect(detectStackFrom(['global.json'])).toBe('dotnet')
    expect(detectStackFrom(['README.md'])).toBe(null)
  })

  test('the config names it, else the detection does, else Node; the stack brings its own exemptions and default layout', () => {
    expect(parseConfig(null)).toEqual(DEFAULT_CONFIG)
    const detected = parseConfig(null, 'godot')
    expect(detected.stack).toBe('godot')
    expect(detected.stackSource).toBe('detected')
    expect(detected.layout.name).toBe('godot')
    expect(detected.exempt).toEqual(['addons/**'])
    const named = parseConfig('{ "stack": "python", "layout": "package", "godot": "C:/Godot/Godot.exe" }', 'godot')
    expect(named.stack).toBe('python')
    expect(named.stackSource).toBe('config')
    expect(named.layout.name).toBe('package')
    expect(named.godot).toBe('C:/Godot/Godot.exe')
    expect(describeConfig(named)).toContain('stack: python (from dope-tdd.json)')
  })

  test('a layout preset belongs to a stack, and the error names the stack', () => {
    const wrong = parseConfig('{ "stack": "python", "layout": "__tests__" }')
    expect(wrong.error).toMatch(/layout must be one of mirror, package, colocated for python/)
    expect(wrong.stack).toBe('node')
    const badStack = parseConfig('{ "stack": "cobol" }')
    expect(badStack.error).toMatch(/stack must be one of/)
  })
})

describe('python layouts', () => {
  test('mirror: src/pkg/calc.py pairs with tests/pkg/test_calc.py', () => {
    const config = layout('python', 'mirror')
    expect(classifyPath(ROOT, `${ROOT}/src/pkg/calc.py`, config)).toEqual({ kind: 'source', module: 'pkg/calc' })
    expect(classifyPath(ROOT, `${ROOT}/tests/pkg/test_calc.py`, config)).toEqual({ kind: 'test', module: 'pkg/calc' })
    expect(testPathFor(config, 'pkg/calc')).toBe('tests/pkg/test_calc.py')
  })

  test('package: a package at the root is source, a conftest in tests/ is nobody\u2019s source', () => {
    const config = layout('python', 'package')
    expect(classifyPath(ROOT, `${ROOT}/pkg/calc.py`, config)).toEqual({ kind: 'source', module: 'pkg/calc' })
    expect(classifyPath(ROOT, `${ROOT}/tests/pkg/test_calc.py`, config)).toEqual({ kind: 'test', module: 'pkg/calc' })
    expect(classifyPath(ROOT, `${ROOT}/tests/conftest.py`, config)).toEqual({ kind: 'other' })
    expect(classifyPath(ROOT, `${ROOT}/README.md`, config)).toEqual({ kind: 'other' })
    expect(watchedDirs(config)).toEqual(['.'])
  })
})

describe('godot layouts', () => {
  test('gdUnit4\u2019s own rule: x/foo.gd pairs with test/x/foo_test.gd, and addons are left alone', () => {
    const config = layout('godot', 'godot')
    expect(classifyPath(ROOT, `${ROOT}/scripts/player.gd`, config)).toEqual({ kind: 'source', module: 'scripts/player' })
    expect(classifyPath(ROOT, `${ROOT}/test/scripts/player_test.gd`, config)).toEqual({ kind: 'test', module: 'scripts/player' })
    expect(classifyPath(ROOT, `${ROOT}/test/helpers.gd`, config)).toEqual({ kind: 'other' })
    expect(classifyPath(ROOT, `${ROOT}/player.tscn`, config)).toEqual({ kind: 'other' })
    expect(testPathFor(config, 'scripts/player')).toBe('test/scripts/player_test.gd')
    expect(watchedDirs(config)).toEqual(['.'])
  })

  test('with a src folder the src is dropped on the test side, as gdUnit4 does', () => {
    const config = layout('godot', 'godot-src')
    expect(classifyPath(ROOT, `${ROOT}/src/player.gd`, config)).toEqual({ kind: 'source', module: 'player' })
    expect(classifyPath(ROOT, `${ROOT}/test/player_test.gd`, config)).toEqual({ kind: 'test', module: 'player' })
    expect(watchedDirs(config)).toEqual(['src', 'test'])
  })
})

describe('java and dotnet layouts', () => {
  test('maven: the package path is the module, the test adds Test', () => {
    const config = layout('java', 'maven')
    expect(classifyPath(ROOT, `${ROOT}/src/main/java/com/example/Foo.java`, config)).toEqual({ kind: 'source', module: 'com/example/Foo' })
    expect(classifyPath(ROOT, `${ROOT}/src/test/java/com/example/FooTest.java`, config)).toEqual({ kind: 'test', module: 'com/example/Foo' })
    expect(testPathFor(config, 'com/example/Foo')).toBe('src/test/java/com/example/FooTest.java')
    expect(watchedDirs(config)).toEqual(['src'])
  })

  test('dotnet: src and tests, the test adds Tests', () => {
    const config = layout('dotnet', 'dotnet')
    expect(classifyPath(ROOT, `${ROOT}/src/Foo.cs`, config)).toEqual({ kind: 'source', module: 'Foo' })
    expect(classifyPath(ROOT, `${ROOT}/tests/FooTests.cs`, config)).toEqual({ kind: 'test', module: 'Foo' })
  })
})

describe('setup infers the stack and its layout', () => {
  test('a Godot project with gdUnit4 tests under test/', () => {
    const inferred = inferLayout({
      files: ['player.gd', 'scripts/enemy.gd', 'test/player_test.gd', 'test/scripts/enemy_test.gd', 'addons/gdUnit4/bin/GdUnitCmdTool.gd'],
      packageDirs: [],
      rootEntries: ['project.godot', 'player.gd', 'scripts', 'test', 'addons'],
    })
    expect(inferred.stack).toBe('godot')
    expect(inferred.stackReason).toBe('project.godot at the root')
    expect(inferred.layout.name).toBe('godot')
    expect(inferred.reason).toMatch(/2 of 2 test files pair with a source under godot/)
    expect(suggestedConfig(DEFAULT_CONFIG, inferred)).toEqual({ stack: 'godot' })
  })

  test('a Python project whose tests mirror src/', () => {
    const inferred = inferLayout({
      files: ['src/pkg/calc.py', 'tests/pkg/test_calc.py', 'tests/conftest.py'],
      packageDirs: [],
      rootEntries: ['pyproject.toml', 'src', 'tests'],
    })
    expect(inferred.stack).toBe('python')
    expect(inferred.layout.name).toBe('mirror')
    expect(suggestedConfig(DEFAULT_CONFIG, inferred)).toEqual({ stack: 'python' })
  })

  test('a Python project with no marker is still Python by its files, and a package with mirrored tests is package', () => {
    const inferred = inferLayout({ files: ['pkg/calc.py', 'tests/pkg/test_calc.py'], packageDirs: [], rootEntries: ['pkg', 'tests'] })
    expect(inferred.stack).toBe('python')
    expect(inferred.stackReason).toMatch(/2 python files, no marker/)
    expect(inferred.layout.name).toBe('package')
    expect(inferred.reason).toMatch(/1 of 1 test file pairs? with a source under package/)
    expect(suggestedConfig(DEFAULT_CONFIG, inferred)).toEqual({ stack: 'python', layout: 'package' })
  })

  test('a config that pins the stack is not second-guessed', () => {
    const inferred = inferLayout({ files: ['src/a.ts', 'tests/a.test.ts'], packageDirs: [''], rootEntries: ['package.json', 'project.godot'] }, 'node')
    expect(inferred.stack).toBe('node')
    expect(inferred.stackReason).toBe('named in dope-tdd.json')
  })
})

describe('a real repo: DungeonLobby', () => {
  test('client, server and shared packages with __tests__ mirrored under src pair with three roots and one template', () => {
    const config = parseConfig('{"roots":["client","server","shared"],"layout":{"source":"src/{module}.{ext}","test":"src/__tests__/{module}.test.{ext}"}}')
    expect(config.error).toBe(null)
    expect(classifyPath(ROOT, `${ROOT}/server/src/utils/dice.ts`, config)).toEqual({ kind: 'source', module: 'server/utils/dice' })
    expect(classifyPath(ROOT, `${ROOT}/server/src/__tests__/utils/dice.test.ts`, config)).toEqual({ kind: 'test', module: 'server/utils/dice' })
    expect(classifyPath(ROOT, `${ROOT}/shared/src/__tests__/schemas/room.test.ts`, config)).toEqual({ kind: 'test', module: 'shared/schemas/room' })
    expect(classifyPath(ROOT, `${ROOT}/client/src/utils/.gitkeep`, config)).toEqual({ kind: 'other' })
    expect(testPathFor(config, 'server/utils/dice')).toBe('server/src/__tests__/utils/dice.test.ts(x)')
  })
})
