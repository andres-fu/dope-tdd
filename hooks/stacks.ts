import { LAYOUTS } from './layout'
import type { Layout } from './layout'

/**
 * A stack is a language and its conventions: which extensions a template's
 * `{ext}` accepts, how a test file is named, where tests sit by default, and
 * which files at a project root say "this project is of this stack". The
 * runners that run its tests are in `runners.ts`.
 */

export type StackName = 'node' | 'python' | 'godot' | 'java' | 'dotnet'

export type Stack = {
  name: StackName
  /** What `{ext}` in a template accepts. */
  exts: readonly string[]
  /** How a template's extension reads in a message: `tests/a.test.ts(x)`. */
  displayExt: string
  /** A relative path that is a test file in this stack, by its name alone. */
  testFile: RegExp
  /** A relative path that is code in this stack, test or source. */
  codeFile: RegExp
  /** Files at a project root that say the project is of this stack. */
  markers: readonly string[]
  layouts: Readonly<Record<string, Layout>>
  defaultLayout: string
  /** Paths the guard leaves alone in this stack unless told otherwise. */
  exempt: readonly string[]
}

export const STACKS: Readonly<Record<StackName, Stack>> = {
  node: {
    name: 'node',
    exts: ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs'],
    displayExt: 'ts(x)',
    testFile: /\.(?:test|spec)\.[cm]?[jt]sx?$/,
    codeFile: /\.[cm]?[jt]sx?$/,
    markers: ['package.json'],
    layouts: LAYOUTS,
    defaultLayout: 'mirror',
    exempt: [],
  },
  python: {
    name: 'python',
    exts: ['py'],
    displayExt: 'py',
    // pytest collects test_*.py and *_test.py.
    testFile: /(?:^|\/)(?:test_[^/]*|[^/]*_test)\.py$/,
    codeFile: /\.py$/,
    markers: ['pyproject.toml', 'pytest.ini', 'setup.py', 'setup.cfg', 'tox.ini', 'requirements.txt', 'conftest.py'],
    layouts: {
      mirror: { name: 'mirror', source: 'src/{module}.{ext}', test: 'tests/{dir}test_{name}.{ext}' },
      package: { name: 'package', source: '{module}.{ext}', test: 'tests/{dir}test_{name}.{ext}' },
      colocated: { name: 'colocated', source: '{module}.{ext}', test: '{dir}test_{name}.{ext}' },
    },
    defaultLayout: 'mirror',
    exempt: [],
  },
  godot: {
    name: 'godot',
    exts: ['gd'],
    displayExt: 'gd',
    // gdUnit4 generates foo_test.gd for foo.gd and FooTest.gd for Foo.gd; GUT looks for test_*.gd.
    testFile: /(?:^|\/)(?:[^/]*_test|[^/]*Test|test_[^/]*)\.gd$/,
    codeFile: /\.gd$/,
    markers: ['project.godot'],
    layouts: {
      // gdUnit4's own rule: res://x/foo.gd pairs with res://test/x/foo_test.gd, and res://src/x/foo.gd drops the src.
      godot: { name: 'godot', source: '{module}.{ext}', test: 'test/{module}_test.{ext}' },
      'godot-src': { name: 'godot-src', source: 'src/{module}.{ext}', test: 'test/{module}_test.{ext}' },
      'godot-pascal': { name: 'godot-pascal', source: '{module}.{ext}', test: 'test/{module}Test.{ext}' },
    },
    defaultLayout: 'godot',
    exempt: ['addons/**'],
  },
  java: {
    name: 'java',
    exts: ['java'],
    displayExt: 'java',
    testFile: /(?:Test|Tests|IT)\.java$/,
    codeFile: /\.java$/,
    markers: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'],
    layouts: {
      maven: { name: 'maven', source: 'src/main/java/{module}.{ext}', test: 'src/test/java/{module}Test.{ext}' },
    },
    defaultLayout: 'maven',
    exempt: [],
  },
  dotnet: {
    name: 'dotnet',
    exts: ['cs'],
    displayExt: 'cs',
    testFile: /Tests?\.cs$/,
    codeFile: /\.cs$/,
    markers: ['global.json', 'Directory.Build.props', 'Directory.Packages.props', 'NuGet.Config', 'nuget.config'],
    layouts: {
      dotnet: { name: 'dotnet', source: 'src/{module}.{ext}', test: 'tests/{module}Tests.{ext}' },
    },
    defaultLayout: 'dotnet',
    exempt: ['bin/**', 'obj/**'],
  },
}

/** The order markers are checked in: a Godot project may also carry a package.json, a Java one a requirements.txt. */
export const STACK_ORDER: readonly StackName[] = ['godot', 'java', 'dotnet', 'node', 'python']

export const DEFAULT_STACK: Stack = STACKS.node

export function isStackName(value: unknown): value is StackName {
  return typeof value === 'string' && value in STACKS
}

export function stackOf(name: StackName | undefined): Stack {
  return name === undefined ? DEFAULT_STACK : STACKS[name]
}

/** The stack a project root's file names point at, or null when none of the markers is there. */
export function detectStackFrom(rootEntries: readonly string[]): StackName | null {
  const names = new Set(rootEntries)
  return STACK_ORDER.find(name => STACKS[name].markers.some(marker => names.has(marker))) ?? null
}

/** The marker that decided it, for the words. */
export function stackMarker(rootEntries: readonly string[], stack: StackName): string | null {
  const names = new Set(rootEntries)
  return STACKS[stack].markers.find(marker => names.has(marker)) ?? null
}

export function layoutNamed(stack: Stack, name: string): Layout | undefined {
  return stack.layouts[name]
}

export function defaultLayoutOf(stack: Stack): Layout {
  return stack.layouts[stack.defaultLayout] ?? LAYOUTS.mirror
}

export function isTestFileIn(stack: Stack, relative: string): boolean {
  return stack.testFile.test(relative)
}

export function isCodeFileIn(stack: Stack, relative: string): boolean {
  return stack.codeFile.test(relative) && !(stack.name === 'node' && relative.endsWith('.d.ts'))
}

/** Code in any stack, for a survey that does not know the stack yet. */
export function isCodeFileAny(relative: string): boolean {
  return Object.values(STACKS).some(stack => isCodeFileIn(stack, relative))
}
