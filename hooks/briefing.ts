import { describeLayout } from './config.ts'
import type { GuardConfig } from './config.ts'

/**
 * What Claude is told about Dope TDD before its first edit, as a section of
 * its system prompt. Agents that met the gate cold learned it by being
 * refused, and one read the plugin's source to work out what "touch the test"
 * meant. Short on purpose: every line is a rule it will meet, in its words.
 *
 * `runCommand` is how one test file runs in this project, with `<test file>`
 * where the path goes, or null when no runner was found.
 */
export function briefingText(config: GuardConfig, runCommand: string | null): string {
  const gate =
    config.mode === 'enforce'
      ? // The carry-over clause (#54) is here so the agent's model of the gate matches it before it is ever refused.
        'An edit to a source file is refused until that module\'s test was touched in this session, or run and seen failing. ' +
        'A module unlocked in an earlier session (up to 7 days) needs one run of its test this session, red or green, before its first edit, and is dropped if that test changed since.'
      : config.mode === 'warn'
        ? 'An edit to a source file whose test was not touched first goes through with a warning, and is counted.'
        : 'It watches and records only; nothing is refused.'
  return [
    `Dope TDD is on in this project (mode: ${config.mode}). It stands in the path of Edit, Write and shell commands.`,
    `- ${gate} Tests pair with sources by this layout: ${describeLayout(config.layout)}.`,
    runCommand === null
      ? '- Run one test file at a time, and keep the runner\'s summary line in the output: it reads that line, never the exit code.'
      : `- Run one test file at a time: \`${runCommand}\`. Keep the runner's summary line in the output: it reads that line, never the exit code.`,
    '- A green that never saw red proves nothing yet: break the code on purpose, see red, put it back; that is PROVEN. To change code that has no tests, use the /dope-tdd:pin skill: pin, prove, then change.',
    '- After a green that followed a red, it reverts your change, runs that test again, and restores it. PROVEN means the test is real; MISSED means the test passes without your change, so strengthen the test.',
    '- Skips, removed assertions, commented-out code, a test re-saved unchanged, and a loosened dope-tdd.json are recorded as workarounds. If you take one, say why in your reply.',
    '- Its verdicts arrive in the tool results as lines starting `dope-tdd:`. The mcp__dope-tdd__status tool shows the whole state.',
  ].join('\n')
}
