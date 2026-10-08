import { commandSegments } from './shell'

export type SourceSnapshot = Readonly<Record<string, string>>

const REWRITES_TREE = /^\s*git\s+(?:checkout|restore|stash|reset|switch|revert|merge|rebase|pull|cherry-pick|apply|clean)\b/

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
