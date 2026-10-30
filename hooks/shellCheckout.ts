// Which checkout a shell command belongs to, as plain data in and out (#250, 2026-10-29). A session's shell can work in
// <root>/.claude/worktrees/<name> with no agentId to place it: the desktop app moves a session there, and a `cd` can too.
// `checkShell` in register.tsx asks here first, so its runs, writes, git checks and catch check all use that checkout.
import { isInsideRoot, pathKey, sameCheckout, worktreeRootFor } from './mirror.ts'
import { testRunLocation } from './runners.ts'
import { ELSEWHERE, commandSegments, cwdAfter } from './shell.ts'

/**
 * `base` is where a shell in no worktree is judged: the session root, or the worktree an agent's paths placed it in
 * (agentRoots.ts). `mainCheckout` is set when the session root is itself a linked worktree (#233).
 */
export type ShellScene = { readonly base: string; readonly sessionRoot: string; readonly mainCheckout?: string | undefined }

/** The worktree a file sits in, or a folder ending in a slash (mirror.ts, worktreeRootFor); `base` when it is in none. */
function homeOf(place: string, { base, sessionRoot, mainCheckout }: ShellScene): string {
  const home = worktreeRootFor(sessionRoot, place, mainCheckout)
  return pathKey(home) === pathKey(sessionRoot) ? base : home
}

/** Where a command starts: where the last one left the shell, when that is still inside a checkout of the session. */
export function shellStart(carried: string, scene: ShellScene): string {
  const known = carried !== '' && (isInsideRoot(scene.base, carried) || pathKey(homeOf(`${carried}/`, scene)) !== pathKey(scene.base))
  return known ? carried : scene.base
}

/**
 * Where a command really starts, when its first step is a `cd`. Headless Claude Code puts the shell back at the project
 * after each command, and nothing says so: a relative `cd` that goes nowhere from where the shell was left, and somewhere
 * from `base`, shows that it did. A command with no `cd` shows nothing, so it is read from where the shell was left.
 */
export async function settledStart(command: string, start: string, base: string, exists: (path: string) => Promise<boolean>): Promise<string> {
  const first = commandSegments(command)[0] ?? ''
  const here = cwdAfter(first, start)
  const fromBase = cwdAfter(first, base)
  if (here === ELSEWHERE || pathKey(here) === pathKey(start) || pathKey(here) === pathKey(fromBase)) {
    return start
  }
  return (await exists(here)) || !(await exists(fromBase)) ? start : base
}

/**
 * The checkout a command is judged against. A test run decides first: it reads as a run of that one checkout. Then the
 * first write the command names, since a write by absolute path needs no `cd`. Then where the command ends, for a
 * script whose writes only a snapshot shows. `written` comes from findSourceWrites; one under ELSEWHERE says nothing.
 */
export function shellRoot(command: string, start: string, written: readonly string[], scene: ShellScene): string {
  const run = testRunLocation(command, start)
  const write = written.find(path => /^(?:[A-Za-z]:)?\//.test(path))
  const after = cwdAfter(command, start)
  const folder = after === ELSEWHERE ? start.replace(/\/$/, '') : after
  return homeOf(run !== null && run !== ELSEWHERE ? `${run}/` : (write ?? `${folder}/`), scene)
}

/** Where the next command starts. Never the worktree when the shell left it: Claude Code puts it back at the project. */
export function cwdToCarry(moved: string, root: string, base: string): string {
  return moved !== ELSEWHERE && (isInsideRoot(root, moved) || isInsideRoot(base, moved)) ? moved : base
}

/**
 * The modules unlocked in another checkout than `root`, which a run in `root` says nothing about (#198, #250). Unlocks
 * are kept by module name, so a green in the main checkout would otherwise close a cycle whose test and change are in a
 * worktree, and start a catch check there.
 */
export function unlockedElsewhere(unlocked: Readonly<Record<string, string>>, root: string, sessionRoot: string, mainCheckout?: string): string[] {
  return Object.entries(unlocked)
    .filter(([, testPath]) => !sameCheckout(sessionRoot, `${root}/`, testPath, mainCheckout))
    .map(([module]) => module)
}
