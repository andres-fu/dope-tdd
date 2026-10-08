import { commandSegments } from './shell'

export type SourceSnapshot = Readonly<Record<string, string>>

// `git apply` is the agent's own edit arriving as a patch, so it is not here; `git stash list|show` only reads.
const REWRITES_TREE = /^\s*git\s+(?:checkout|restore|stash(?!\s+(?:list|show)\b)|reset|switch|revert|merge|rebase|pull|cherry-pick|clean)\b/

export function parseNumstat(output: string): Record<string, string> {
  const entries = output
    .split(/\r?\n/)
    .map(line => line.split('\t'))
    .filter((parts): parts is [string, string, string] => parts.length === 3 && parts[2] !== '')
    .map(([added, deleted, path]) => [path, `${added}/${deleted}`] as const)
  return Object.fromEntries(entries)
}

export function changedPaths(before: SourceSnapshot, after: SourceSnapshot): string[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...paths].filter(path => before[path] !== after[path])
}

export function isRevertCommand(command: string): boolean {
  return commandSegments(command).some(segment => REWRITES_TREE.test(segment))
}
