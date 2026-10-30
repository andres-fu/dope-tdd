import { worktreeRootFor } from './mirror.ts'

/** Each subagent's worktree root, by the agentId its tool.call carries; an agent not listed works at the session root. */
export type AgentRoots = Readonly<Record<string, string>>

/**
 * Places an agent in the worktree a path it named sits in (#198, 2026-10-28). The engine names no folder for a
 * subagent's call, but Read, Edit, Write, Glob and Grep all take absolute paths, so the first one in its worktree
 * says where it works. Returns `roots` itself when nothing changes, so the state is not written for nothing.
 */
export function learnRoot(roots: AgentRoots, agentId: string | undefined, sessionRoot: string, path: string, mainCheckout?: string): AgentRoots {
  if (agentId === undefined) {
    return roots
  }
  // #233: under the main checkout too, when the session root is itself a linked worktree (mirror.ts).
  const root = worktreeRootFor(sessionRoot, path, mainCheckout)
  if (root === sessionRoot || roots[agentId] === root) {
    return roots
  }
  return { ...roots, [agentId]: root }
}

/** Where an agent's shell, git check and catch check run: its worktree once seen there, the session root otherwise. */
export function rootOfAgent(roots: AgentRoots, agentId: string | undefined, sessionRoot: string): string {
  return (agentId === undefined ? undefined : roots[agentId]) ?? sessionRoot
}
