/**
 * Ways around the guard that are not denied but must not pass in silence.
 * Each detector is pure: it reads texts and counts, the adapter records.
 */

export type WorkaroundKind = 'config' | 'pause' | 'test-changed' | 'skipped' | 'assertion-removed' | 'commented-out' | 'hollow-touch' | 'record-edited'

export const WORKAROUND_KINDS: readonly WorkaroundKind[] = ['config', 'pause', 'test-changed', 'skipped', 'assertion-removed', 'commented-out', 'hollow-touch', 'record-edited']

const SKIP_MARKER = /\b(?:it|test|describe)\s*\.\s*(?:skip|only|todo)\b|\bx(?:it|test|describe)\s*\(/g
// A call, not a mention: `import assert from 'node:assert'` asserts nothing, `assertEquals(...)` and `assert.ok(...)` do.
// A call, not a mention, in every stack: expect(...) and assert*(...) in JS, AssertThat(...) and Assert.Equal(...) in C#,
// assertEquals(...) in Java, assert_int(...) in GDScript, and pytest's bare `assert x == y` statement at the start of a line.
const ASSERTION_CALL = /\bexpect\s*\(|\b[Aa]ssert\w*\s*\(|\b[Aa]ssert\.\w+\s*\(|^[ \t]*assert[ \t]+[^\s(]|\.should\b|\bshould\s*\(|\bt\.(?:is|deepEqual|true|false|truthy|falsy|throws|like|snapshot|regex)\s*\(/gm
const LINE_COMMENT = /^\/\/\s?/
const COMMENT_OR_BLANK = /^(?:\/\/|\/\*|\*|\*\/|$)/

export type TestEditSignal =
  | { kind: 'skipped'; added: number }
  | { kind: 'assertion-removed'; before: number; after: number }
  /** Only comments or blank lines changed: it still unlocks, and is said, but is no workaround (decided 2026-10-20). */
  | { kind: 'comments-only' }

// A comment in any stack the guard reads tests in: JS/TS, C#, Java, GDScript and Python.
const ANY_COMMENT_OR_BLANK = /^(?:\/\/|\/\*|\*|\*\/|#|$)/

function testLines(text: string): string {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => !ANY_COMMENT_OR_BLANK.test(line))
    .join('\n')
}

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
  const commentsOnly = before !== after && testLines(before) === testLines(after)
  return [
    ...(skipsAdded > 0 ? [{ kind: 'skipped', added: skipsAdded } as const] : []),
    ...(assertionsAfter < assertionsBefore ? [{ kind: 'assertion-removed', before: assertionsBefore, after: assertionsAfter } as const] : []),
    ...(commentsOnly ? [{ kind: 'comments-only' } as const] : []),
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
