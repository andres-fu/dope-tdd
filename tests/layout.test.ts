import { describe, expect, test } from 'claude-code/testing'

import { LAYOUTS, describeSourcePath, describeTestPath, fillTemplate, matchTemplate, templateError } from '../hooks/layout'
import { classifyPath, sourcePathFor, splitRoot, testPathFor, watchedDirs } from '../hooks/mirror'
import type { LayoutConfig } from '../hooks/mirror'

const ROOT = 'C:/work/throughline'
const at = (layout: keyof typeof LAYOUTS, roots: string[] = []): LayoutConfig => ({ layout: LAYOUTS[layout], roots })

describe('templates', () => {
  test('match a path and give back the module and extension', () => {
    expect(matchTemplate('tests/{module}.test.{ext}', 'tests/utils/a.test.tsx')).toEqual({ module: 'utils/a', ext: 'tsx' })
    expect(matchTemplate('src/{dir}__tests__/{name}.test.{ext}', 'src/utils/__tests__/a.test.ts')).toEqual({ module: 'utils/a', ext: 'ts' })
    expect(matchTemplate('src/{dir}__tests__/{name}.test.{ext}', 'src/__tests__/App.test.tsx')).toEqual({ module: 'App', ext: 'tsx' })
    expect(matchTemplate('tests/{module}.test.{ext}', 'src/utils/a.ts')).toBeNull()
  })

  test('fill back the other way, and describe paths the way a person reads them', () => {
    expect(fillTemplate('src/{dir}__tests__/{name}.test.{ext}', 'utils/a', 'ts')).toBe('src/utils/__tests__/a.test.ts')
    expect(fillTemplate('src/{dir}__tests__/{name}.test.{ext}', 'App', 'tsx')).toBe('src/__tests__/App.test.tsx')
    expect(describeTestPath(LAYOUTS.mirror, 'utils/a')).toBe('tests/utils/a.test.ts(x)')
    expect(describeSourcePath(LAYOUTS.mirror, 'utils/a')).toBe('src/utils/a')
  })

  test('a template needs an extension and a way to name the module', () => {
    expect(templateError('src/{module}.{ext}')).toBeNull()
    expect(templateError('src/{dir}__tests__/{name}.test.{ext}')).toBeNull()
    expect(templateError('src/{module}.ts')).toMatch(/must contain \{ext\}/)
    expect(templateError('src/{name}.{ext}')).toMatch(/must contain \{module\}, or both/)
  })
})

describe('classifyPath under each layout', () => {
  test('mirror: src/ and tests/ share the module', () => {
    expect(classifyPath(ROOT, `${ROOT}/src/utils/a.ts`, at('mirror'))).toEqual({ kind: 'source', module: 'utils/a' })
    expect(classifyPath(ROOT, `${ROOT}/tests/utils/a.test.ts`, at('mirror'))).toEqual({ kind: 'test', module: 'utils/a' })
  })

  test('colocated: the test sits next to its source and is never mistaken for a source', () => {
    expect(classifyPath(ROOT, `${ROOT}/src/utils/a.test.ts`, at('colocated'))).toEqual({ kind: 'test', module: 'utils/a' })
    expect(classifyPath(ROOT, `${ROOT}/src/utils/a.ts`, at('colocated'))).toEqual({ kind: 'source', module: 'utils/a' })
    expect(classifyPath(ROOT, `${ROOT}/tests/utils/a.test.ts`, at('colocated'))).toEqual({ kind: 'other' })
  })

  test('__tests__: the test sits in a __tests__ folder beside the source', () => {
    expect(classifyPath(ROOT, `${ROOT}/src/utils/__tests__/a.test.ts`, at('__tests__'))).toEqual({ kind: 'test', module: 'utils/a' })
    expect(classifyPath(ROOT, `${ROOT}/src/__tests__/App.test.tsx`, at('__tests__'))).toEqual({ kind: 'test', module: 'App' })
    expect(classifyPath(ROOT, `${ROOT}/src/utils/a.ts`, at('__tests__'))).toEqual({ kind: 'source', module: 'utils/a' })
  })

  test('roots: a package under a root glob prefixes the module, and files outside every root are other', () => {
    const config = at('mirror', ['packages/*'])
    expect(classifyPath(ROOT, `${ROOT}/packages/app/src/utils/a.ts`, config)).toEqual({ kind: 'source', module: 'packages/app/utils/a' })
    expect(classifyPath(ROOT, `${ROOT}/packages/app/tests/utils/a.test.ts`, config)).toEqual({ kind: 'test', module: 'packages/app/utils/a' })
    expect(classifyPath(ROOT, `${ROOT}/src/utils/a.ts`, config)).toEqual({ kind: 'other' })
    expect(splitRoot('packages/app/src/a.ts', ['packages/*'])).toEqual({ pkg: 'packages/app', rest: 'src/a.ts' })
  })

  test('declarations and files outside the root stay other', () => {
    expect(classifyPath(ROOT, `${ROOT}/src/types.d.ts`, at('colocated'))).toEqual({ kind: 'other' })
    expect(classifyPath(ROOT, 'C:/elsewhere/src/a.ts', at('mirror'))).toEqual({ kind: 'other' })
  })
})

describe('paths in messages', () => {
  test('name the test to touch and the source to edit under the layout, with the package root kept', () => {
    expect(testPathFor(at('colocated'), 'utils/a')).toBe('src/utils/a.test.ts(x)')
    expect(testPathFor(at('__tests__'), 'utils/a')).toBe('src/utils/__tests__/a.test.ts(x)')
    expect(testPathFor(at('mirror', ['packages/*']), 'packages/app/utils/a')).toBe('packages/app/tests/utils/a.test.ts(x)')
    expect(sourcePathFor(at('mirror', ['packages/*']), 'packages/app/utils/a')).toBe('packages/app/src/utils/a')
  })

  // #53: an agent touches the path it is told to; in a plain-JS repo a `.ts(x)` test would never run.
  test('when the source being edited is known, the test is named with its extension', () => {
    expect(testPathFor(at('mirror'), 'utils/a', 'js')).toBe('tests/utils/a.test.js')
    expect(testPathFor(at('colocated'), 'utils/a', 'tsx')).toBe('src/utils/a.test.tsx')
    expect(testPathFor(at('mirror'), 'utils/a', 'mjs')).toBe('tests/utils/a.test.mjs')
  })

  test('an extension the stack does not know, or none, keeps the generic name', () => {
    expect(testPathFor(at('mirror'), 'utils/a', 'md')).toBe('tests/utils/a.test.ts(x)')
    expect(testPathFor(at('mirror'), 'utils/a')).toBe('tests/utils/a.test.ts(x)')
  })

  test('the directories git is asked about follow the layout and the roots', () => {
    expect(watchedDirs(at('mirror'))).toEqual(['src', 'tests'])
    expect(watchedDirs(at('colocated'))).toEqual(['src'])
    expect(watchedDirs(at('mirror', ['packages/*', 'apps/*']))).toEqual(['packages', 'apps'])
  })
})
