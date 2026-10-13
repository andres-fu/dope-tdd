import { describe, expect, test } from 'claude-code/testing'

import { classifyPath, isInsideRoot, isTestRun, pathKey, relativePath, respelled } from '../hooks/mirror'

const ROOT = 'C:/work/throughline'

describe('isTestRun', () => {
  test('recognizes a runner invoked at the start of a command', () => {
    const commands = [
      'npx vitest run',
      'npx vitest run tests/utils/formatDuration.test.ts',
      'vitest',
      'npx jest tests/utils/formatDuration.test.ts',
      './node_modules/.bin/vitest run',
      'npm test',
      'npm run test',
      'npm run test:unit -- --reporter=json',
      'pnpm test',
      'pnpm exec vitest run',
      'yarn test',
      'bun test',
      'CI=1 npx vitest run',
      'cd packages/app && npx vitest run',
      'git stash; npm test',
    ]

    expect(commands.filter(isTestRun)).toEqual(commands)
  })

  test('ignores commands that merely mention a runner', () => {
    const commands = [
      'cat vitest.config.ts',
      'grep vitest package.json',
      'npm install -D vitest',
      'git log --oneline -- vitest.config.ts',
      'echo "npm test" >> README.md',
      'ls tests',
      'node scripts/jest-report.js',
    ]

    expect(commands.filter(isTestRun)).toEqual([])
  })
})

describe('classifyPath', () => {
  test('maps a source file and its mirrored test to the same module', () => {
    expect(classifyPath(ROOT, `${ROOT}/src/utils/a.ts`)).toEqual({ kind: 'source', module: 'utils/a' })
    expect(classifyPath(ROOT, `${ROOT}/tests/utils/a.test.ts`)).toEqual({ kind: 'test', module: 'utils/a' })
  })

  test('treats declarations, non-ts files and paths outside the root as other', () => {
    expect(classifyPath(ROOT, `${ROOT}/src/types.d.ts`)).toEqual({ kind: 'other' })
    expect(classifyPath(ROOT, `${ROOT}/src/index.css`)).toEqual({ kind: 'other' })
    expect(classifyPath(ROOT, 'C:/elsewhere/src/a.ts')).toEqual({ kind: 'other' })
  })

  test('a file named like a test is never source, whatever the layout: a colocated test under the default is the test for its neighbour', () => {
    expect(classifyPath(ROOT, `${ROOT}/src/utils/a.test.ts`)).toEqual({ kind: 'test', module: 'utils/a' })
    expect(classifyPath(ROOT, `${ROOT}/src/utils/a.spec.tsx`)).toEqual({ kind: 'test', module: 'utils/a' })
    expect(classifyPath(ROOT, `${ROOT}/tests/utils/a.spec.ts`)).toEqual({ kind: 'test', module: 'utils/a' })
  })
})

describe('path case follows the file system: Windows folds it, Linux does not (A5)', () => {
  test('a Windows path is the same path in any case', () => {
    expect(isInsideRoot('C:/work/app', 'c:/WORK/app/src/a.ts')).toBe(true)
    expect(relativePath('C:/work/app', 'c:/Work/App/src/a.ts')).toBe('src/a.ts')
    expect(pathKey('C:/Work/App/src/A.ts')).toBe(pathKey(String.raw`c:\work\app\src\a.ts`))
  })

  test('a POSIX path keeps its case: /work/App is not /work/app, and Foo.ts is not foo.ts', () => {
    expect(isInsideRoot('/work/app', '/work/App/src/a.ts')).toBe(false)
    expect(isInsideRoot('/work/app', '/work/app/src/a.ts')).toBe(true)
    expect(relativePath('/work/app', '/work/App/src/a.ts')).toBe('/work/App/src/a.ts')
    expect(pathKey('/work/app/src/Foo.ts')).not.toBe(pathKey('/work/app/src/foo.ts'))
  })
})

describe('respelled: a path reached through a symbolic link, spelled from the root', () => {
  test('a path inside the root comes back as it is', () => {
    expect(respelled('/tmp/app', '/private/tmp/app', '/tmp/app/src/a.ts')).toBe('/tmp/app/src/a.ts')
  })

  test('a path that landed in the root\'s real location is spelled from the root', () => {
    expect(respelled('/tmp/app', '/private/tmp/app', '/private/tmp/app/src/a.ts')).toBe('/tmp/app/src/a.ts')
    expect(respelled('/tmp/app/', '/private/tmp/app', '/private/tmp/app/src/a.ts')).toBe('/tmp/app/src/a.ts')
  })

  test('the root\'s real location itself is the root', () => {
    expect(respelled('/tmp/app', '/private/tmp/app', '/private/tmp/app')).toBe('/tmp/app')
  })

  test('a path that landed elsewhere, or a root that could not be resolved, is null', () => {
    expect(respelled('/tmp/app', '/private/tmp/app', '/private/tmp/other/a.ts')).toBeNull()
    expect(respelled('/tmp/app', '/private/tmp/app', '/private/tmp/application/a.ts')).toBeNull()
    expect(respelled('/tmp/app', null, '/private/tmp/app/src/a.ts')).toBeNull()
  })
})
