/**
 * Stumble twice (idea 19, docs/decisions/2026-10-26_stumble-twice.md). Before the path is clear there is no failing
 * test to write, so the agent explores in a throwaway git worktree outside the project, under
 * `~/.dope-tdd/spikes/`, throws it away, and rebuilds here test-first. Nothing there is guarded, and nothing there
 * reaches the project except through the gate, so a spike needs no approval and is not a workaround.
 */

/** The spike skill, typed or called by the agent. */
export const SPIKE_SKILL = /^(?:dope-tdd:)?spike$/

/** A spike copy left behind is removed at a session start after this long; the skill removes it sooner. */
export const SPIKE_TTL_MS = 7 * 24 * 60 * 60_000

const NO_QUESTION = '(no question given)'
const QUESTION_MAX = 120

/**
 * The question the spike explores. The skill hook sees the skill's text with its arguments filled in, not the
 * arguments, so the skill carries them on a `Question:` line for this to read.
 */
export function spikeQuestion(text: string): string {
  const question = text.match(/^Question:[ \t]*(.*)$/m)?.[1]?.trim() ?? ''
  // A host that does not fill in the skill's arguments leaves the placeholder: that is no question either.
  if (question === '' || question === '$ARGUMENTS') {
    return NO_QUESTION
  }
  return question.length > QUESTION_MAX ? `${question.slice(0, QUESTION_MAX - 1)}…` : question
}

type Entry = { name: string; kind: string; isLink?: boolean; mtimeMs: number }

/** Spike folders old enough to remove. Never a link, whose target may be anything; never a folder dated in the future. */
export function staleSpikes(entries: readonly Entry[], nowMs: number): string[] {
  return entries
    .filter(entry => entry.kind === 'dir' && entry.isLink !== true && nowMs - entry.mtimeMs > SPIKE_TTL_MS)
    .map(entry => entry.name)
}

/** As retention.ts pruneArgv, for a folder: the path is an argument, so a name with a quote in it cannot change what runs. */
export function removeFolderArgv(path: string): string[] {
  return ['node', '-e', "require('node:fs').rmSync(process.argv[1], { recursive: true, force: true })", path]
}
