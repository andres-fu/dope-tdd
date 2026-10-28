import { CONFIG_FILE, describeLayout } from './config.ts'
import type { GuardConfig } from './config.ts'

/**
 * What Claude is told about Dope TDD before its first edit, as a section of
 * its system prompt. Agents that met the gate cold learned it by being
 * refused, and one read the plugin's source to work out what "touch the test"
 * meant. Short on purpose: every line is a rule it will meet, in its words.
 *
 * `runCommand` is how one test file runs in this project, with `<test file>`
 * where the path goes, or null when no runner was found. `layoutNote` says the
 * default layout matches none of the code (#167, setup.ts layoutMismatch). `leftRed` names what an earlier
 * session left red (idea 15, leftRed.ts): it comes second, so the agent starts there.
 */
export function briefingText(config: GuardConfig, runCommand: string | null, layoutNote: string | null = null, leftRed: string | null = null): string {
  const gate =
    config.mode === 'enforce'
      ? // The carry-over clause (#54) is here so the agent's model of the gate matches it before it is ever refused.
        'An edit to a source file is refused until that module\'s test was touched in this session, or run and seen failing. ' +
        'A module unlocked in an earlier session (up to 7 days) needs one run of its test this session, red or green, before its first edit, and is dropped if that test changed since. ' +
        // Option A (docs review, 2026-10-18): the refactor path and the override, known before the first refusal.
        'To refactor code whose test already passes, add or tighten one assertion for what you will change and see it fail, or pin it first. ' +
        // Idea 19 (stumble twice): exploring has a path of its own, so it is not pushed toward an override.
        'To explore before you know what to test, use /dope-tdd:spike: work in a throwaway copy outside the project, then rebuild here test-first. ' +
        'If nothing fits, ask with mcp__dope-tdd__override_request, then stop and wait: a person decides.'
      : config.mode === 'warn'
        ? 'An edit to a source file whose test was not touched first goes through with a warning, and is counted.'
        : 'It watches and records only; nothing is refused.'
  return [
    `Dope TDD is on in this project (mode: ${config.mode}). It stands in the path of Edit, Write and shell commands.`,
    // #193: an invalid file falls back to the defaults (config.ts) and only /tdd said so. Said second, before the rules
    // it changes, so the agent can tell the user why it is refused where the file meant it not to be.
    ...(config.error === null ? [] : [`- ${configErrorNote(config.error)}`]),
    ...(leftRed === null ? [] : [`- ${leftRed}`]),
    `- ${gate} Tests pair with sources by this layout: ${describeLayout(config.layout)}.`,
    ...(layoutNote === null ? [] : [`- ${layoutNote}`]),
    runCommand === null
      ? '- Run one test file at a time, and keep the runner\'s summary line in the output: it reads that line, never the exit code.'
      : `- Run one test file at a time: \`${runCommand}\`. Keep the runner's summary line in the output: it reads that line, never the exit code.`,
    '- A green that never saw red proves nothing yet: break the code on purpose, see red, put it back; that is PROVEN. To change code that has no tests, use the /dope-tdd:pin skill: pin, prove, then change.',
    '- After a green that followed a red, it reverts your change, runs that test again, and restores it. PROVEN means the test is real; MISSED means the test passes without your change, so strengthen the test.',
    '- Skips, removed assertions, commented-out code, a test re-saved unchanged, and a loosened dope-tdd.json are recorded as workarounds. If you take one, say why in your reply.',
    '- Its verdicts arrive in the tool results as lines starting `dope-tdd:`. The mcp__dope-tdd__status tool shows the whole state.',
  ].join('\n')
}

/** What the briefing says about a dope-tdd.json that was not read (#193). `error` starts with the file name (config.ts). */
function configErrorNote(error: string): string {
  const prefix = `${CONFIG_FILE}: `
  const reason = error.startsWith(prefix) ? error.slice(prefix.length) : error
  return `${CONFIG_FILE} was not read (${reason}), so the defaults apply: enforce and the default layout. Tell the user, so they can fix the file.`
}
