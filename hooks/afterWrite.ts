// The bookkeeping after a write (#59, 2026-10-18): what an Edit, a Write or a shell command changed, and how that goes
// on the record, as plain data in and out. register.tsx reads the files and the stats; the reducers live here, where a
// unit test and the gate's catch check reach them. The engine follows `$` only into register.tsx, so no `$` here.
import type { BeforeState, TddStats } from '../types'
import type { Policy } from './config.ts'
import { markReminded, recordChange, recordSourceEdit, recordTestTouch } from './stats.ts'

/** A file as read before the write: its text, or why there is none. */
export type FileRead = { kind: 'text'; text: string } | { kind: BeforeState }

export type Captured = { before: string | null; after: string; state: BeforeState | undefined }

export function beforeText(file: FileRead): string | null {
  return file.kind === 'text' ? file.text : null
}

export function beforeState(file: FileRead): BeforeState | undefined {
  return file.kind === 'text' ? undefined : file.kind
}

/**
 * What an edit changed, for the catch check to undo. `before` is undefined when nothing was read (the guard is paused,
 * or the file is not code); `after` is null when the file could not be read after the write.
 */
export function captureEdit(before: FileRead | undefined, after: string | null): Captured | null {
  if (before === undefined) {
    return null
  }
  if (after !== null) {
    return { before: beforeText(before), after, state: beforeState(before) }
  }
  // A file that could not be read before the edit is still a change to account for, with that reason.
  return before.kind === 'unreadable' ? { before: null, after: '', state: 'unreadable' } : null
}

/** An Edit or Write to a module's source: counted as test-first or unguarded, reminded once, and the change kept. */
export function recordFileEdit(s: TddStats, module: string, path: string, guarded: boolean, captured: Captured | null, nowMs: number): TddStats {
  const recorded = markReminded(recordSourceEdit(s, module, guarded, nowMs), module)
  return captured === null ? recorded : recordChange(recorded, module, path, captured.before, captured.after, captured.state)
}

export type ShellChanges = {
  root: string
  /** Test files the command changed, relative to the root; `leads`: it tests a module of its own, so it takes the band. */
  touchedTests: readonly { path: string; module: string; leads: boolean }[]
  changedSources: readonly { module: string }[]
  /** The expected writes that changed, with the file before and after; `after` null when it could not be read. */
  captured: readonly { module: string; path: string; before: FileRead; after: string | null }[]
}

/**
 * What a shell command changed. Tests first: a command that writes the test and the source together counts the source
 * edit as guarded, as two Edits in that order would.
 */
export function recordShellChanges(s: TddStats, changes: ShellChanges, nowMs: number): TddStats {
  const withTouches = changes.touchedTests.reduce(
    (acc, { path, module, leads }) => recordTestTouch(acc, { module, testPath: `${changes.root}/${path}` }, nowMs, leads),
    s,
  )
  const withEdits = changes.changedSources.reduce((acc, { module }) => recordSourceEdit(acc, module, acc.unlocked[module] !== undefined, nowMs), withTouches)
  return changes.captured.reduce(
    (acc, write) => (write.after === null ? acc : recordChange(acc, write.module, write.path, beforeText(write.before), write.after, beforeState(write.before))),
    withEdits,
  )
}

/** Sources a shell command changed with no test on record; a path the policy only observes is not said. */
export function unguardedShellPaths(
  sources: readonly { path: string; module: string }[],
  unlocked: Readonly<Record<string, string>>,
  policyOf: (path: string) => Policy,
): string[] {
  return sources.filter(source => unlocked[source.module] === undefined && policyOf(source.path) !== 'observe').map(source => source.path)
}
