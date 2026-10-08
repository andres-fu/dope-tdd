import { describe, expect, test } from 'claude-code/testing'

import { classifyPath, isTestRun } from '../hooks/mirror'

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
})
