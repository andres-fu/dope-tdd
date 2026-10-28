import { describe, expect, test } from 'claude-code/testing'

import { learnRoot, rootOfAgent } from '../hooks/agentRoots'

const ROOT = 'C:/work/app'
const WORKTREE = `${ROOT}/.claude/worktrees/agent-a1`

// #198 (2026-10-28): the engine names no folder for a subagent's call, so a subagent's shell, its git check and its
// catch check all ran against the session root. Each agent's root is learned from the first path it names in its
// worktree (Read, Edit, Write, Glob, Grep all take absolute paths), keyed by the agentId its tool.call carries.
describe('learnRoot: an agent in a worktree is placed there by the paths it names', () => {
  test('a path inside an agent worktree records that worktree for the agent', () => {
    expect(learnRoot({}, 'a1', ROOT, `${WORKTREE}/src/a.ts`)).toEqual({ a1: WORKTREE })
  })

  test('the main loop (no agentId) records nothing: it is the session root', () => {
    expect(learnRoot({}, undefined, ROOT, `${WORKTREE}/src/a.ts`)).toEqual({})
  })

  test('a path in the main checkout records nothing, and keeps what is known', () => {
    expect(learnRoot({}, 'a1', ROOT, `${ROOT}/src/a.ts`)).toEqual({})
    expect(learnRoot({ a1: WORKTREE }, 'a1', ROOT, `${ROOT}/README.md`)).toEqual({ a1: WORKTREE })
  })

  test('other agents are left as they were', () => {
    const other = `${ROOT}/.claude/worktrees/agent-b2`
    expect(learnRoot({ b2: other }, 'a1', ROOT, `${WORKTREE}/src/a.ts`)).toEqual({ b2: other, a1: WORKTREE })
  })

  test('an unchanged answer is the same object, so the state is not written for nothing', () => {
    const known = { a1: WORKTREE }
    expect(learnRoot(known, 'a1', ROOT, `${WORKTREE}/tests/a.test.ts`)).toBe(known)
  })
})

describe('rootOfAgent: where an agent works', () => {
  test('an agent placed in a worktree works there', () => {
    expect(rootOfAgent({ a1: WORKTREE }, 'a1', ROOT)).toBe(WORKTREE)
  })

  test('the main loop and an agent not seen in a worktree work at the session root', () => {
    expect(rootOfAgent({ a1: WORKTREE }, undefined, ROOT)).toBe(ROOT)
    expect(rootOfAgent({ a1: WORKTREE }, 'c3', ROOT)).toBe(ROOT)
  })
})
