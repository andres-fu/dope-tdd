/**
 * Ways around the guard that are not denied but must not pass in silence.
 * Each detector is pure: it reads texts and counts, the adapter records.
 */

export type WorkaroundKind = 'config' | 'pause' | 'test-changed' | 'skipped' | 'assertion-removed' | 'commented-out'

export const WORKAROUND_KINDS: readonly WorkaroundKind[] = ['config', 'pause', 'test-changed', 'skipped', 'assertion-removed', 'commented-out']

const SKIP_MARKER = /\b(?:it|test|describe)\s*\.\s*(?:skip|only|todo)\b|\bx(?:it|test|describe)\s*\(/g
// A call, not a mention: `import assert from 'node:assert'` asserts nothing, `assertEquals(...)` and `assert.ok(...)` do.
const ASSERTION_CALL = /\bexpect\s*\(|\bassert\w*\s*\(|\bassert\.\w+\s*\(|\.should\b|\bshould\s*\(|\bt\.(?:is|deepEqual|true|false|truthy|falsy|throws|like|snapshot|regex)\s*\(/g
const LINE_COMMENT = /^\/\/\s?/
const COMMENT_OR_BLANK = /^(?:\/\/|\/\*|\*|\*\/|$)/

export type TestEditSignal =
  | { kind: 'skipped'; added: number }
  | { kind: 'assertion-removed'; before: number; after: number }

function count(pattern: RegExp, text: string): number {
  return [...text.matchAll(pattern)].length
}

export function skipMarkers(text: string): number {
  return count(SKIP_MARKER, text)
}

export function assertionCalls(text: string): number {
  return count(ASSERTION_CALL, text)
}

/** Skip/only markers added, assertions lost: what an edit to a test file did that a green should not be built on. */
export function testEditSignals(before: string, after: string): TestEditSignal[] {
  const skipsAdded = skipMarkers(after) - skipMarkers(before)
  const assertionsBefore = assertionCalls(before)
  const assertionsAfter = assertionCalls(after)
  return [
    ...(skipsAdded > 0 ? [{ kind: 'skipped', added: skipsAdded } as const] : []),
    ...(assertionsAfter < assertionsBefore ? [{ kind: 'assertion-removed', before: assertionsBefore, after: assertionsAfter } as const] : []),
  ]
}

function codeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => !COMMENT_OR_BLANK.test(line))
}

/** Lines that were code before the edit and come back as `// <that line>` after it, each counted once. */
export function commentedOutLines(before: string, after: string): number {
  const wasCode = new Set(codeLines(before))
  const stillCode = new Set(codeLines(after))
  const nowCommented = new Set(
    after
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.startsWith('//'))
      .map(line => line.replace(LINE_COMMENT, '').trim()),
  )
  return [...nowCommented].filter(line => line !== '' && wasCode.has(line) && !stillCode.has(line)).length
}
