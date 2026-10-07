export type SourceSnapshot = Readonly<Record<string, string>>

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
