import { describe, expect, test } from 'claude-code/testing'

import { LAYOUTS } from '../hooks/layout'
import { classifyPath, isInsideRoot, isTestRun, moduleLabel, pathKey, relativePath, respelled, sameCheckout, sourcePathFor, testFileFor, testPathFor, watchedDirs, worktreeRootFor } from '../hooks/mirror'
import type { LayoutConfig } from '../hooks/mirror'

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

describe('a folder with a layout of its own: a bot at the root with tests in test/, a dashboard in it with tests beside the source', () => {
  const VIBE: LayoutConfig = {
    layout: { name: 'custom', source: '{module}.{ext}', test: 'test/{module}.test.{ext}' },
    roots: [],
    layouts: [{ folder: 'dashboard', layout: LAYOUTS.colocated }],
  }

  test('a file in the folder pairs under the folder\'s layout, and the refusal names the test beside it', () => {
    expect(classifyPath(ROOT, `${ROOT}/dashboard/src/lib/toasts.ts`, VIBE)).toEqual({ kind: 'source', module: 'dashboard//lib/toasts' })
    expect(classifyPath(ROOT, `${ROOT}/dashboard/src/lib/toasts.test.ts`, VIBE)).toEqual({ kind: 'test', module: 'dashboard//lib/toasts' })
    expect(testPathFor(VIBE, 'dashboard//lib/toasts')).toBe('dashboard/src/lib/toasts.test.ts(x)')
    expect(sourcePathFor(VIBE, 'dashboard//lib/toasts')).toBe('dashboard/src/lib/toasts')
    expect(testFileFor(VIBE, 'dashboard//lib/toasts', 'ts')).toBe('dashboard/src/lib/toasts.test.ts')
  })

  test('a module placed by a folder is labelled with its source path; any other keeps its id (#24)', () => {
    expect(moduleLabel(VIBE, 'dashboard//lib/toasts')).toBe('dashboard/src/lib/toasts')
    expect(moduleLabel(VIBE, 'queueOps')).toBe('queueOps')
    expect(moduleLabel({ layout: LAYOUTS.mirror, roots: [] }, 'utils/a')).toBe('utils/a')
  })

  test('a folder module and a main-layout module never share a name, whatever folders exist (review #5)', () => {
    const mirrored: LayoutConfig = { layout: LAYOUTS.mirror, roots: [], layouts: [{ folder: 'dashboard', layout: LAYOUTS.colocated }] }
    const main = classifyPath(ROOT, `${ROOT}/src/dashboard/x.ts`, mirrored)
    const folder = classifyPath(ROOT, `${ROOT}/dashboard/src/x.ts`, mirrored)
    expect(main).toEqual({ kind: 'source', module: 'dashboard/x' })
    expect(folder).toEqual({ kind: 'source', module: 'dashboard//x' })
    expect(classifyPath(ROOT, `${ROOT}/tests/dashboard/x.test.ts`, mirrored)).toEqual({ kind: 'test', module: 'dashboard/x' })
    expect(classifyPath(ROOT, `${ROOT}/dashboard/src/x.test.ts`, mirrored)).toEqual({ kind: 'test', module: 'dashboard//x' })
    expect(testPathFor(mirrored, 'dashboard/x')).toBe('tests/dashboard/x.test.ts(x)')
    expect(testPathFor(mirrored, 'dashboard//x')).toBe('dashboard/src/x.test.ts(x)')
    expect(moduleLabel(mirrored, 'dashboard/x')).toBe('dashboard/x')
    expect(moduleLabel(mirrored, 'dashboard//x')).toBe('dashboard/src/x')
  })

  test('outside the folder the main layout still applies', () => {
    expect(classifyPath(ROOT, `${ROOT}/queueOps.js`, VIBE)).toEqual({ kind: 'source', module: 'queueOps' })
    expect(classifyPath(ROOT, `${ROOT}/test/queueOps.test.js`, VIBE)).toEqual({ kind: 'test', module: 'queueOps' })
    expect(testPathFor(VIBE, 'queueOps')).toBe('test/queueOps.test.ts(x)')
    expect(classifyPath(ROOT, `${ROOT}/dashboardish.js`, VIBE)).toEqual({ kind: 'source', module: 'dashboardish' })
  })

  test('in the folder, a file its layout does not place is nobody\'s source, whatever the main layout says', () => {
    expect(classifyPath(ROOT, `${ROOT}/dashboard/next.config.mjs`, VIBE)).toEqual({ kind: 'other' })
  })

  test('the deepest folder wins, a folder is matched in the case the file system folds, and git watches it', () => {
    const nested: LayoutConfig = { ...VIBE, layouts: [{ folder: 'dashboard', layout: LAYOUTS.colocated }, { folder: 'dashboard/widgets', layout: LAYOUTS.__tests__ }] }
    expect(classifyPath(ROOT, `${ROOT}/dashboard/widgets/src/clock.ts`, nested)).toEqual({ kind: 'source', module: 'dashboard/widgets//clock' })
    expect(testPathFor(nested, 'dashboard/widgets//clock')).toBe('dashboard/widgets/src/__tests__/clock.test.ts(x)')
    expect(classifyPath(ROOT, `${ROOT}/Dashboard/src/lib/toasts.ts`, VIBE)).toEqual({ kind: 'source', module: 'dashboard//lib/toasts' })
    expect(watchedDirs({ layout: LAYOUTS.mirror, roots: [], layouts: [{ folder: 'web/app', layout: LAYOUTS.colocated }] })).toEqual(['src', 'tests', 'web'])
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

// #198 (2026-10-28): a subagent started with isolation: worktree edits files under <root>/.claude/worktrees/<name>/.
// Read against the session's root, those paths matched no layout, so its edits to untested code went through unguarded.
describe('worktreeRootFor: a file in an agent worktree is judged against that worktree, not the session root', () => {
  test('a file in an agent worktree belongs to that worktree', () => {
    expect(worktreeRootFor(ROOT, `${ROOT}/.claude/worktrees/agent-a6d4/hooks/timeText.ts`)).toBe(`${ROOT}/.claude/worktrees/agent-a6d4`)
    expect(worktreeRootFor('/work/app', '/work/app/.claude/worktrees/fix-198/src/a.ts')).toBe('/work/app/.claude/worktrees/fix-198')
  })

  test('the worktree is spelled as the edited path spells it, so classifyPath sees the path inside it', () => {
    const edited = 'c:\\WORK\\app\\.claude\\worktrees\\agent-x\\src\\a.ts'
    const root = worktreeRootFor('C:/work/app', edited)
    expect(root).toBe('c:/WORK/app/.claude/worktrees/agent-x')
    expect(classifyPath(root, edited)).toEqual({ kind: 'source', module: 'a' })
  })

  test('a file in the main checkout keeps the session root', () => {
    expect(worktreeRootFor(ROOT, `${ROOT}/src/a.ts`)).toBe(ROOT)
    expect(worktreeRootFor(ROOT, `${ROOT}/.claude/settings.json`)).toBe(ROOT)
    expect(worktreeRootFor(ROOT, `${ROOT}/.claude/worktrees/notes.md`)).toBe(ROOT)
  })

  test('a path outside the session root is left to the root it already has', () => {
    expect(worktreeRootFor(ROOT, 'C:/elsewhere/.claude/worktrees/x/src/a.ts')).toBe(ROOT)
  })

  test('Linux keeps case: a differently spelled folder is not the root', () => {
    expect(worktreeRootFor('/work/app', '/work/App/.claude/worktrees/x/src/a.ts')).toBe('/work/app')
  })
})

// #233 (tester round 7): when the session root is itself a linked git worktree, Claude Code puts a subagent's
// worktree under the main checkout's .claude/worktrees/, outside the session root. Read as outside the project, an
// untested edit there went through and was never counted.
describe('worktreeRootFor: agent worktrees under the main checkout, when the session root is a linked worktree', () => {
  const MAIN = 'C:/work/main'
  const SESSION = 'C:/work/trial'

  test("a file in an agent worktree under the main checkout belongs to that worktree", () => {
    expect(worktreeRootFor(SESSION, `${MAIN}/.claude/worktrees/agent-a179/api.py`, MAIN)).toBe(`${MAIN}/.claude/worktrees/agent-a179`)
  })

  test('a session that is itself one of those worktrees keeps its own root for its own files', () => {
    const own = `${MAIN}/.claude/worktrees/session-1`
    expect(worktreeRootFor(own, `${own}/src/a.ts`, MAIN)).toBe(own)
    expect(worktreeRootFor(own, `${MAIN}/.claude/worktrees/agent-x/src/a.ts`, MAIN)).toBe(`${MAIN}/.claude/worktrees/agent-x`)
  })

  test("the main checkout's own files are not an agent worktree: they stay outside", () => {
    expect(worktreeRootFor(SESSION, `${MAIN}/src/a.ts`, MAIN)).toBe(SESSION)
    expect(worktreeRootFor(SESSION, `${MAIN}/.claude/worktrees/notes.md`, MAIN)).toBe(SESSION)
  })

  test('spelling does not matter: slashes and the case of a Windows path', () => {
    expect(worktreeRootFor(SESSION, 'c:\\WORK\\main\\.claude\\worktrees\\agent-x\\src\\a.ts', MAIN)).toBe('c:/WORK/main/.claude/worktrees/agent-x')
  })
})

describe('sameCheckout: agent worktrees under the main checkout (#233)', () => {
  const MAIN = 'C:/work/main'
  const SESSION = 'C:/work/trial'

  test('two files in one such worktree are in the same checkout', () => {
    expect(sameCheckout(SESSION, `${MAIN}/.claude/worktrees/agent-x/src/a.ts`, `${MAIN}/.claude/worktrees/agent-x/tests/a.test.ts`, MAIN)).toBe(true)
  })

  test('the session root and such a worktree, or two of them, are not', () => {
    expect(sameCheckout(SESSION, `${SESSION}/src/a.ts`, `${MAIN}/.claude/worktrees/agent-x/tests/a.test.ts`, MAIN)).toBe(false)
    expect(sameCheckout(SESSION, `${MAIN}/.claude/worktrees/agent-x/src/a.ts`, 'tests/a.test.ts', MAIN)).toBe(false)
    expect(sameCheckout(SESSION, `${MAIN}/.claude/worktrees/agent-x/src/a.ts`, `${MAIN}/.claude/worktrees/agent-y/tests/a.test.ts`, MAIN)).toBe(false)
  })
})

// #198: an unlock counts only in the checkout its test was touched in. A test in an agent worktree must not unlock
// the main checkout's module, nor the other way round.
describe('sameCheckout: whether two files sit in the same checkout of the session', () => {
  test('two files in the main checkout, or in the same agent worktree, are in the same checkout', () => {
    expect(sameCheckout(ROOT, `${ROOT}/src/a.ts`, `${ROOT}/tests/a.test.ts`)).toBe(true)
    expect(sameCheckout(ROOT, `${ROOT}/.claude/worktrees/agent-x/src/a.ts`, `${ROOT}/.claude/worktrees/agent-x/tests/a.test.ts`)).toBe(true)
  })

  test('the main checkout and an agent worktree, or two worktrees, are not', () => {
    expect(sameCheckout(ROOT, `${ROOT}/src/a.ts`, `${ROOT}/.claude/worktrees/agent-x/tests/a.test.ts`)).toBe(false)
    expect(sameCheckout(ROOT, `${ROOT}/.claude/worktrees/agent-x/src/a.ts`, `${ROOT}/tests/a.test.ts`)).toBe(false)
    expect(sameCheckout(ROOT, `${ROOT}/.claude/worktrees/agent-x/src/a.ts`, `${ROOT}/.claude/worktrees/agent-y/tests/a.test.ts`)).toBe(false)
  })

  test('spelling does not matter: slashes and the case of a Windows path', () => {
    expect(sameCheckout('C:/work/app', 'c:\\WORK\\app\\src\\a.ts', 'C:/work/app/tests/a.test.ts')).toBe(true)
    expect(sameCheckout('C:/work/app', 'c:\\work\\app\\.claude\\worktrees\\agent-x\\src\\a.ts', 'C:/work/app/tests/a.test.ts')).toBe(false)
  })

  // A test path from a runner's output may be relative. Read as the main checkout, a session with no worktrees is
  // judged exactly as before; only a path that names a worktree is told apart.
  test('a path in no worktree, relative or elsewhere, counts as the main checkout', () => {
    expect(sameCheckout(ROOT, `${ROOT}/src/a.ts`, 'tests/a.test.ts')).toBe(true)
    expect(sameCheckout(ROOT, `${ROOT}/.claude/worktrees/agent-x/src/a.ts`, 'tests/a.test.ts')).toBe(false)
  })
})
