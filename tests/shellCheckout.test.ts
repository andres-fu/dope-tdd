import { describe, expect, test } from 'claude-code/testing'

import { cwdToCarry, settledStart, shellRoot, shellStart, unlockedElsewhere } from '../hooks/shellCheckout'
import { ELSEWHERE } from '../hooks/shell'

const ROOT = 'C:/r'
const NESTED = `${ROOT}/.claude/worktrees/nested`
const OTHER = `${ROOT}/.claude/worktrees/other`
const scene = { base: ROOT, sessionRoot: ROOT }

// #250 (2026-10-29): a session's shell working in <root>/.claude/worktrees/<name>, the main loop, no agentId. Edits were
// placed by their path, but runs, shell writes and the catch check were judged against the session root.
describe('shellRoot: the checkout a shell command is judged against', () => {
  test('a run from a cd into a nested worktree is that worktree', () => {
    expect(shellRoot('cd .claude/worktrees/nested && node --test tests/calc.test.js', ROOT, [], scene)).toBe(NESTED)
  })

  test('so is a cd by absolute path, in any spelling of the drive', () => {
    expect(shellRoot(`cd ${NESTED} && node --test tests/calc.test.js`, ROOT, [], scene)).toBe(NESTED)
    expect(shellRoot('cd /c/r/.claude/worktrees/nested && node --test tests/calc.test.js', ROOT, [], scene)).toBe(NESTED)
  })

  test('a folder deeper in the worktree is that worktree', () => {
    expect(shellRoot('cd .claude/worktrees/nested/packages/app && npx vitest run', ROOT, [], scene)).toBe(NESTED)
  })

  test('a shell left in a worktree by the last command stays there', () => {
    expect(shellRoot('node --test tests/calc.test.js', NESTED, [], scene)).toBe(NESTED)
  })

  test('a cd back to the main checkout is the main checkout, wherever the shell was', () => {
    expect(shellRoot(`cd ${ROOT} && node --test tests/calc.test.js`, NESTED, [], scene)).toBe(ROOT)
    expect(shellRoot('cd ../../.. && node --test tests/calc.test.js', NESTED, [], scene)).toBe(ROOT)
  })

  test('a run in the main checkout, or another repository, is the root it was', () => {
    expect(shellRoot('node --test tests/calc.test.js', ROOT, [], scene)).toBe(ROOT)
    expect(shellRoot('cd ../other && npx vitest run', ROOT, [], scene)).toBe(ROOT)
  })

  test('a run that went somewhere unseen stays where the shell was', () => {
    expect(shellRoot('cd ~ && npx vitest run', NESTED, [], scene)).toBe(NESTED)
  })

  test('a write names its checkout when no test runs, from anywhere', () => {
    expect(shellRoot(`sed -i s/a/b/ ${NESTED}/src/a.ts`, ROOT, [`${NESTED}/src/a.ts`], scene)).toBe(NESTED)
  })

  test('a write into the main checkout from a worktree is the main checkout', () => {
    expect(shellRoot(`sed -i s/a/b/ ${ROOT}/src/a.ts`, NESTED, [`${ROOT}/src/a.ts`], scene)).toBe(ROOT)
  })

  test('the run decides over a write beside it', () => {
    expect(shellRoot('cd .claude/worktrees/nested && echo x >> notes.ts && npm test', ROOT, [`${ROOT}/src/a.ts`], scene)).toBe(NESTED)
  })

  test('a write to where the shell cannot see says nothing', () => {
    expect(shellRoot('echo x > $OUT/a.ts', NESTED, [`${ELSEWHERE}/a.ts`], scene)).toBe(NESTED)
  })

  test('a command that only moves or runs a script is judged where it ends', () => {
    expect(shellRoot('cd .claude/worktrees/nested && python fix.py', ROOT, [], scene)).toBe(NESTED)
  })

  test('a file directly under .claude/worktrees is no worktree', () => {
    expect(shellRoot(`sed -i s/a/b/ ${ROOT}/.claude/worktrees/notes.ts`, ROOT, [`${ROOT}/.claude/worktrees/notes.ts`], scene)).toBe(ROOT)
  })

  test("an agent placed in a worktree stays there, unless its shell goes into another one", () => {
    const agent = { base: OTHER, sessionRoot: ROOT }
    expect(shellRoot('npm test', OTHER, [], agent)).toBe(OTHER)
    expect(shellRoot(`cd ${ROOT}/src && npm test`, OTHER, [], agent)).toBe(OTHER)
    expect(shellRoot(`cd ${NESTED} && npm test`, OTHER, [], agent)).toBe(NESTED)
  })

  test('a sibling worktree under the main checkout, when the session root is itself a linked worktree (#233)', () => {
    const linked = { base: `${ROOT}/.claude/worktrees/me`, sessionRoot: `${ROOT}/.claude/worktrees/me`, mainCheckout: ROOT }
    expect(shellRoot(`cd ${NESTED} && npm test`, linked.base, [], linked)).toBe(NESTED)
    expect(shellRoot('npm test', linked.base, [], linked)).toBe(linked.base)
    expect(shellRoot(`cd ${ROOT} && npm test`, linked.base, [], linked)).toBe(linked.base)
  })
})

describe('shellStart: where a command starts', () => {
  test('where the last command left the shell, when that is inside the root', () => {
    expect(shellStart(`${ROOT}/src`, scene)).toBe(`${ROOT}/src`)
    expect(shellStart(`${NESTED}/src`, scene)).toBe(`${NESTED}/src`)
  })

  test('the root when no command moved it, or it left', () => {
    expect(shellStart('', scene)).toBe(ROOT)
    expect(shellStart('C:/elsewhere', scene)).toBe(ROOT)
  })

  test('inside a sibling worktree outside the session root too (#233)', () => {
    const linked = { base: `${ROOT}/.claude/worktrees/me`, sessionRoot: `${ROOT}/.claude/worktrees/me`, mainCheckout: ROOT }
    expect(shellStart(`${NESTED}/src`, linked)).toBe(`${NESTED}/src`)
    expect(shellStart(`${ROOT}/src`, linked)).toBe(linked.base)
  })
})

// Headless Claude Code puts the shell back at the project after each command, and nothing says so. A relative `cd` that
// goes nowhere from where dope-tdd last saw the shell, and somewhere from the root, shows it happened: the same
// `cd .claude/worktrees/nested && …` twice would otherwise read as <nested>/.claude/worktrees/nested.
describe('settledStart: a shell put back at the root between commands', () => {
  const folders = (...paths: string[]) => async (path: string) => paths.includes(path)

  test('a relative cd that only exists from the root starts from the root', async () => {
    expect(await settledStart('cd .claude/worktrees/nested && npm test', NESTED, ROOT, folders(NESTED))).toBe(ROOT)
  })

  test('a relative cd that exists from where the shell is starts there', async () => {
    expect(await settledStart('cd src && npm test', NESTED, ROOT, folders(`${NESTED}/src`, `${ROOT}/src`))).toBe(NESTED)
  })

  test('a cd that exists from neither stays where the shell is: the command fails on its own', async () => {
    expect(await settledStart('cd nowhere && npm test', NESTED, ROOT, folders())).toBe(NESTED)
  })

  test('a command with no cd, or an absolute one, says nothing about where it started', async () => {
    expect(await settledStart('npm test', NESTED, ROOT, folders())).toBe(NESTED)
    expect(await settledStart(`cd ${ROOT} && npm test`, NESTED, ROOT, folders(ROOT))).toBe(NESTED)
  })

  test('a shell at the root, or a cd out of sight, has nothing to check', async () => {
    const never = async () => {
      throw new Error('asked')
    }
    expect(await settledStart('cd src && npm test', ROOT, ROOT, never)).toBe(ROOT)
    expect(await settledStart('cd ~ && npm test', NESTED, ROOT, never)).toBe(NESTED)
  })
})

describe('cwdToCarry: where the next command starts', () => {
  test('where this one ended, inside the root or the checkout it was judged against', () => {
    expect(cwdToCarry(`${ROOT}/src`, ROOT, ROOT)).toBe(`${ROOT}/src`)
    expect(cwdToCarry(NESTED, NESTED, ROOT)).toBe(NESTED)
    expect(cwdToCarry(ROOT, NESTED, ROOT)).toBe(ROOT)
  })

  test('a sibling worktree outside the session root is kept (#233)', () => {
    expect(cwdToCarry(NESTED, NESTED, `${ROOT}/.claude/worktrees/me`)).toBe(NESTED)
  })

  test('the root, not the worktree, when the shell left or went somewhere unseen', () => {
    expect(cwdToCarry(ELSEWHERE, NESTED, ROOT)).toBe(ROOT)
    expect(cwdToCarry('C:/elsewhere', NESTED, ROOT)).toBe(ROOT)
  })
})

describe('unlockedElsewhere: the modules a run in this checkout says nothing about', () => {
  const unlocked = { calc: `${NESTED}/tests/calc.test.js`, main: `${ROOT}/tests/main.test.js`, other: `${OTHER}/tests/other.test.js` }

  test('a run in the main checkout: those unlocked in a worktree', () => {
    expect(unlockedElsewhere(unlocked, ROOT, ROOT)).toEqual(['calc', 'other'])
  })

  test('a run in a worktree: those unlocked in the main checkout or another worktree', () => {
    expect(unlockedElsewhere(unlocked, NESTED, ROOT)).toEqual(['main', 'other'])
  })

  test('nothing, with no worktrees: a session with none is judged as before', () => {
    expect(unlockedElsewhere({ main: `${ROOT}/tests/main.test.js`, relative: 'tests/a.test.js' }, ROOT, ROOT)).toEqual([])
  })

  test('with the session root itself a linked worktree (#233)', () => {
    const me = `${ROOT}/.claude/worktrees/me`
    expect(unlockedElsewhere({ mine: `${me}/tests/a.test.js`, calc: `${NESTED}/tests/calc.test.js` }, me, me, ROOT)).toEqual(['calc'])
  })
})
