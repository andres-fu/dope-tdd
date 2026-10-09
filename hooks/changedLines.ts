const MAX_LINES = 6
const MAX_WIDTH = 120

function counts(lines: readonly string[]): Map<string, number> {
  const seen = new Map<string, number>()
  for (const line of lines) {
    seen.set(line, (seen.get(line) ?? 0) + 1)
  }
  return seen
}

function clip(line: string): string {
  const trimmed = line.trim()
  return trimmed.length > MAX_WIDTH ? `${trimmed.slice(0, MAX_WIDTH - 1)}…` : trimmed
}

/**
 * The lines a change added and removed, as `+ line` and `- line`, in file
 * order, blank lines left out, at most a handful. Not a real diff: a line that
 * moved without changing is not reported, which is what a reader of a missed
 * catch wants, the behaviour that changed, not the layout.
 */
export function changedLines(before: string, after: string): string[] {
  const beforeLines = before.split(/\r?\n/)
  const afterLines = after.split(/\r?\n/)
  const inBefore = counts(beforeLines)
  const inAfter = counts(afterLines)
  const added: string[] = []
  for (const line of afterLines) {
    const left = inBefore.get(line) ?? 0
    if (left > 0) {
      inBefore.set(line, left - 1)
    } else if (line.trim() !== '') {
      added.push(`+ ${clip(line)}`)
    }
  }
  const removed: string[] = []
  for (const line of beforeLines) {
    const left = inAfter.get(line) ?? 0
    if (left > 0) {
      inAfter.set(line, left - 1)
    } else if (line.trim() !== '') {
      removed.push(`- ${clip(line)}`)
    }
  }
  return [...removed, ...added].slice(0, MAX_LINES)
}
