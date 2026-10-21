// The message catalogue (2026-10-18): every sentence dope-tdd says to the agent, by id. Logic decides which message and
// with which facts (advice.ts, refusals.ts); this file decides the words. Each entry carries an example, and
// tests/fixtures/messages.golden.ts holds every example rendered, so a wording change is one template and one golden
// diff, not a hunt through the tests. After reviewing a wording change: npm run golden.
import { formatAgo } from './timeText.ts'

// After a proven green the next step is a refactor or the next red; on a tests-only task, the next pin (VibeCast, 2026-10-18).
const REFACTOR = 'Now refactor with the test untouched, or write the next failing test.'
const PROVE = 'Break the code on purpose and run again to prove the test can fail.'
/** #57: said when the restore matches the code from before the break except CRLF against LF, so nobody wonders why. */
const LINE_ENDINGS_NOTE =
  ' Only its line endings differ from before the break (CRLF and LF: a shell edit on Windows, such as `sed -i`, can rewrite them); that does not change what the code does.'

const plural = (count: number, word: string) => `${word}${count === 1 ? '' : 's'}`
/** `runners'`, not `runners's`: a module name ending in s takes a bare apostrophe. */
const possessive = (name: string) => (name.endsWith('s') ? `${name}'` : `${name}'s`)
const indented =(lines: readonly string[]) => lines.map(line => `  ${line}`).join('\n')

type Entry<F> = { readonly example: F; readonly say: (facts: F) => string }
const entry = <F>(example: F, say: (facts: F) => string): Entry<F> => ({ example, say })

type Module = { module: string }
type ModuleSource = { module: string; sourcePath: string }

export const MESSAGES = {
  'touch.unlocked': entry({ module: 'utils/a', sourcePath: 'src/utils/a', command: 'npx vitest run tests/utils/a.test.ts' as string | undefined }, f =>
    `dope-tdd: ${f.module} unlocked. Run its test and see it fail before editing ${f.sourcePath}.${f.command === undefined ? '' : ` Run it with: ${f.command}`}`),
  // Warn mode only: there the edit under a carried-over unlock goes through, and this reminder follows it.
  'inherited.reminder': entry({ sourcePath: 'src/utils/a', testPath: 'tests/utils/a.test.ts', ageMs: 2 * 3_600_000 }, f =>
    `dope-tdd: ${f.sourcePath} is unlocked because ${f.testPath} was touched ${formatAgo(f.ageMs)} in an earlier session. Run that test first if you have not this session.`),
  // #54: an agent meets these cold, often on day 2 of a refactor; each says what happened, why, and the exact next step.
  'carry.wait': entry({ sourcePath: 'src/utils/a', testPath: 'tests/utils/a.test.ts', ageMs: 2 * 3_600_000, command: 'npx vitest run tests/utils/a.test.ts' as string | undefined }, f =>
    `dope-tdd: ${f.sourcePath} was unlocked ${formatAgo(f.ageMs)} in an earlier session, when ${f.testPath} was touched. ` +
    `Before the first edit this session, run that test once, red or green: ${f.command ?? f.testPath}. ` +
    'Why: the earlier proof counts only while the test still runs, and a run now shows where things stand before your change. No test edit is needed.'),
  'carry.onGreen': entry({ sourcePath: 'src/utils/a', testPath: 'tests/utils/a.test.ts' }, f =>
    `dope-tdd: ${f.testPath} ran green this session, so the unlock of ${f.sourcePath} carried over from an earlier session is active again. Edit away; your next green is checked as usual.`),
  // The guard knows only that the source was not edited: a fixture or helper changed this session can be the cause
  // (seen 2026-10-19: a golden entry added minutes earlier was called "already there").
  'carry.onRed': entry({ sourcePath: 'src/utils/a', testPath: 'tests/utils/a.test.ts' }, f =>
    `dope-tdd: ${f.testPath} ran red this session, before any edit to ${f.sourcePath}, so its unlock carried over from an earlier session is active again. Those failures are not from a change to ${f.sourcePath}: they were already there, or come from a change elsewhere this session (a fixture, a helper, another module).`),
  // Appended to the ordinary refusal when the module had a carried-over unlock dropped because its test changed.
  'note.staleUnlock': entry({ testPath: 'tests/utils/a.test.ts', ageMs: 26 * 3_600_000 }, f =>
    ` ${f.testPath} unlocked it ${formatAgo(f.ageMs)} in an earlier session, but that test has changed since (a checkout, a merge, or an edit this guard did not see), so the earlier unlock no longer counts.`),
  'red.unlocked': entry<ModuleSource>({ module: 'utils/a', sourcePath: 'src/utils/a' }, f =>
    `dope-tdd: ${f.module} unlocked by a red run of its own test. Fix ${f.sourcePath}, run again, and the fix will be checked.`),
  'touch.unchanged': entry({ testPath: 'tests/utils/a.test.ts' }, f =>
    `dope-tdd: ${f.testPath} was re-saved unchanged. A touch that changes nothing proves nothing. Recorded; say why in your reply.`),
  // Decided 2026-10-20 (verified review A12): a comment in a test still unlocks, said and on the record, not a workaround.
  'touch.commentsOnly': entry({ testPath: 'tests/utils/a.test.ts', module: 'utils/a' }, f =>
    `dope-tdd: ${f.testPath} changed only comments or blank lines, so no test changed. It still unlocks ${f.module}; the touch is on the record as comments only, not as a workaround.`),
  'touch.imports': entry({ testPath: 'tests/utils/a.test.ts', modules: ['utils/b', 'utils/c'] as readonly string[] }, f => {
    const one = f.modules.length === 1
    return `dope-tdd: ${f.testPath} imports ${f.modules.join(', ')}, so it is the test for ${one ? 'that module' : 'those modules'} too: ${one ? 'it is' : 'they are'} unlocked, and ${one ? 'its' : 'their'} catch check runs this file.`
  }),
  'test.noAssertion': entry({ testPath: 'tests/utils/a.test.ts' }, f =>
    `dope-tdd: ${f.testPath} has no assertion. A test that asserts nothing passes no matter what the code does.`),
  'edit.unguarded': entry({ sourcePath: 'src/utils/a', testPath: 'tests/utils/a.test.ts' }, f =>
    `dope-tdd: ${f.sourcePath} was edited with no test touched first. Write ${f.testPath} next and see it fail.`),
  'run.crashed': entry({}, () =>
    'dope-tdd: node --test could not read its test process output (a Node bug when a test prints non-ASCII text, such as emoji), so nothing was counted. Run it again; if it keeps happening, quiet the logging in the code under test.'),
  // VibeCast field test (2026-10-18): a 40 KB `npm test` was cut before its summary; said as too long, never "pipe it".
  'run.truncated': entry({}, () =>
    'dope-tdd: a test run happened but the output was too long and was cut before its summary line, so nothing was counted. Run one test file, or the runner with a quieter reporter, so the summary fits.'),
  'run.unread': entry({ nodeTest: false }, f =>
    `dope-tdd: a test run happened but its summary line was not in the output, so nothing was counted. ${
      f.nodeTest
        ? 'node --test prints its summary before the failures, so a tail cuts it: run the one test file without a pipe, or with --test-reporter=tap | tail -40.'
        : 'Run one test file and keep the end of its output, where the summary is.'
    }`),
  'run.unreadable': entry({ runner: 'mocha' }, f =>
    `dope-tdd: this was a ${f.runner} run, and dope-tdd cannot read ${f.runner}'s summary yet, so ${f.runner} runs are not counted: no RED or GREEN from them, and no catch check. Untested edits are still refused. Said once.`),
  'config.changed': entry({ detail: 'mode: enforce → warn' }, f =>
    `dope-tdd: dope-tdd.json changed (${f.detail}). This is recorded in /tdd; say why in your reply.`),
  'workaround.skipped': entry({ testPath: 'tests/utils/a.test.ts', added: 2 }, f =>
    `dope-tdd: ${f.testPath} gained ${f.added} ${plural(f.added, 'skip/only marker')}. A skipped test guards nothing. Recorded; say why in your reply.`),
  // Appended to a RED that never reached an assertion while the module's pin is unproven (2026-10-19).
  'note.errorsOnly': entry<Module>({ module: 'utils/a' }, f =>
    ` So it does not prove the test of ${f.module} can fail: once the error is fixed, break the code on purpose and run again.`),
  // Appended to a RED or GREEN on the current module when the test that ran is another open module's own (2026-10-19).
  // The catch check covers the current module only, so a green says so.
  'note.ownTestToo': entry({ module: 'utils/a', other: 'utils/b', outcome: 'red' as 'red' | 'green' }, f =>
    f.outcome === 'red'
      ? ` That test is ${possessive(f.other)} own test too, so ${f.other} saw red as well.`
      : ` That test is ${possessive(f.other)} own test too, so ${f.other} went green as well; only ${possessive(f.module)} change was checked.`),
  'workaround.assertionsRemoved': entry({ testPath: 'tests/utils/a.test.ts', before: 3, after: 1 }, f =>
    `dope-tdd: ${f.testPath} went from ${f.before} to ${f.after} ${plural(f.after, 'assertion')}. Recorded; say why in your reply.`),
  'workaround.commentedOut': entry({ sourcePath: 'src/utils/a.ts', lines: 4 }, f =>
    `dope-tdd: ${f.sourcePath}: ${f.lines} ${plural(f.lines, 'line')} of code commented out by this edit. Recorded; say why in your reply.`),
  'red.elsewhere': entry({ module: 'utils/a', sourcePath: 'src/utils/a', files: ['tests/utils/b.test.ts'] as readonly string[], sawRed: false }, f => {
    const failed = `${f.files.join(', ')} failed; ${f.module}'s own test did not fail this run.`
    return f.sawRed
      ? `dope-tdd: RED, but not on ${f.module}: ${failed}`
      : `dope-tdd: RED, but not on ${f.module}: ${failed} ${f.module} has not seen red yet. Make its test fail before editing ${f.sourcePath}.`
  }),
  // VibeCast field test (2026-10-18): before any code change this cycle, a red is the bug or a pin that guessed wrong.
  'red.first': entry<Module>({ module: 'utils/a' }, f =>
    `dope-tdd: RED on ${f.module}. If this is the bug or the missing behaviour, make it pass with the smallest change, then run it again. If you are pinning what the code does now, the pin guessed wrong: fix the assertion and say why.`),
  // Karl's round 4 (2026-10-20): a collection error got red.first's "fix the assertion", though no assertion ran. An
  // import error is still a fair first red for code that does not exist yet, so it says both ways out.
  'red.errorsOnly': entry<Module>({ module: 'utils/a' }, f =>
    `dope-tdd: RED on ${f.module}, but no assertion ran: every failure is an error (an import, a collection or a compile that broke). If the test names code that does not exist yet, write it with the smallest change; otherwise fix the error and run again.`),
  'red.again': entry<Module>({ module: 'utils/a' }, f => `dope-tdd: RED on ${f.module}. Make it pass with the smallest change, then run it again.`),
  'green.testChanged': entry<ModuleSource>({ module: 'utils/a', sourcePath: 'src/utils/a' }, f =>
    `dope-tdd: GREEN on ${f.module}, saw red, but the test changed after red and ${f.sourcePath} did not. The green came from the test, not from a fix. If the red was real, put the assertion back and fix the code. If the assertion was wrong (a pin that guessed today's behaviour wrongly), say why in your reply; it stays on the record.`),
  'green.pinCorrected': entry<ModuleSource>({ module: 'utils/a', sourcePath: 'src/utils/a' }, f =>
    `dope-tdd: GREEN on ${f.module}: the pin was corrected after its red, with ${f.sourcePath} unchanged. With the pin skill in use that is the expected fix for a pin that guessed wrong; it is on the record as a pin correction. Now prove the pin: break the code on purpose, see red, put it back exactly.`),
  'green.refactor': entry<Module>({ module: 'utils/a' }, f =>
    `dope-tdd: GREEN on ${f.module} with the test untouched: a refactor, not re-checked. The test still guards only what it asserted before. If it changed what the code does, that has no test yet: write one first.`),
  'green.newFileMissed': entry({ module: 'utils/a', tried: 2, survived: ['line 1: `===` → `!==`', 'line 1: `1` → `2`'] as readonly string[] }, f =>
    `dope-tdd: GREEN on ${f.module}. ${f.module} is a new file: dope-tdd changed it ${f.tried} ${plural(f.tried, 'way')} in a throwaway copy and the test passed every time, so it checks none of these:\n${indented(f.survived)}\nAdd an assertion that fails with each change.`),
  'green.newFileProven': entry({ module: 'utils/a', tried: 2, caught: 1, survived: ['line 1: `1` → `2`'] as readonly string[] }, f => {
    const rest =
      f.survived.length === 0
        ? ''
        : ` These went unnoticed:\n${indented(f.survived)}\nAdd an assertion for each that matters. A change that cannot alter what the code does (an equivalent mutant) is fine to leave; say so.`
    return `dope-tdd: GREEN on ${f.module}. ${f.module} is a new file: dope-tdd changed it ${f.tried} ${plural(f.tried, 'way')} in a throwaway copy and the test failed for ${f.caught}, so it is PROVEN.${rest} ${REFACTOR}`
  }),
  // #55: one deliberate break proves one behaviour; the small changes tried after it say what to pin next.
  'green.pinProven': entry({ module: 'utils/a', tried: 3, caught: 2, survived: ['line 4: `<` → `<=`'] as readonly string[], lineEndings: false }, f => {
    const caught = f.caught === f.tried ? 'all of them' : `${f.caught}`
    const rest =
      f.survived.length === 0
        ? ''
        : ` These went unnoticed:\n${indented(f.survived)}\nOne break proves one behaviour; add a pin for each of these that matters. A change that cannot alter what the code does (an equivalent mutant) is fine to leave; say so.`
    return `dope-tdd: GREEN on ${f.module}: PROVEN. Its test failed on your break and passes with the code put back exactly as it was.${f.lineEndings ? LINE_ENDINGS_NOTE : ''} dope-tdd also changed it ${f.tried} ${plural(f.tried, 'way')} in a throwaway copy: the test failed for ${caught}.${rest} ${REFACTOR}`
  }),
  'green.missed': entry({ module: 'utils/a', sawRed: true, slipped: ['-  return a + b', '+  return a - b'] as readonly string[] }, f => {
    const verdict = f.sawRed
      ? `dope-tdd: GREEN on ${f.module}, but MISSED: with your change undone its test still passes, so the test was changed to pass or the change did not matter. Fix the test before moving on.`
      : `dope-tdd: GREEN on ${f.module}, MISSED: its test has never failed, and it still passes with your change undone, so it has proven nothing yet. If the change was a fix, the test is missing an assertion for it; if it was a refactor, break the code on purpose and run again to prove the test.`
    const slipped = f.slipped.length === 0 ? '' : ` The change it did not notice:\n${indented(f.slipped)}\nAdd an assertion that fails without it.`
    return `${verdict}${slipped}`
  }),
  'green.brokenProven': entry({ module: 'utils/a', lineEndings: false }, f =>
    `dope-tdd: GREEN on ${f.module}: PROVEN. Its test failed on your break and passes with the code put back exactly as it was.${f.lineEndings ? LINE_ENDINGS_NOTE : ''} ${REFACTOR}`),
  'green.provenBy': entry({ module: 'io', sawRed: true, own: 'test/io.test.ts', by: 'test/slugify.test.ts' }, f =>
    `dope-tdd: GREEN on ${f.module}${f.sawRed ? ', saw red' : ''}, but its own test, ${f.own}, does not catch the change, but ${f.by} does: PROVEN by ${f.by}. Its own test is missing an assertion for this change; add one there. ${REFACTOR}`),
  'green.caught': entry({ module: 'utils/a', sawRed: true }, f =>
    f.sawRed
      ? `dope-tdd: GREEN on ${f.module}: PROVEN. It saw red, and with the change undone its test fails. ${REFACTOR}`
      : `dope-tdd: GREEN on ${f.module}: PROVEN. It never saw red, but with the change undone its test fails. ${REFACTOR}`),
  'green.notChecked': entry({ module: 'utils/a', sawRed: true, reason: 'timeout' }, f =>
    `dope-tdd: GREEN on ${f.module}${f.sawRed ? ', saw red' : ''}. UNPROVEN: not checked (${f.reason}). ${REFACTOR}`),
  'green.pinBreakProven': entry<Module>({ module: 'utils/a' }, f => `dope-tdd: GREEN on ${f.module}, saw red: its test went green, failed on a break, and passes again, so it is PROVEN. ${REFACTOR}`),
  'green.sawRed': entry<Module>({ module: 'utils/a' }, f => `dope-tdd: GREEN on ${f.module}, saw red. ${REFACTOR}`),
  'green.neverRed': entry<Module>({ module: 'utils/a' }, f => `dope-tdd: GREEN on ${f.module} but it never saw red: UNPROVEN. ${PROVE}`),
} as const

export type MessageId = keyof typeof MESSAGES
export type Facts<K extends MessageId> = Parameters<(typeof MESSAGES)[K]['say']>[0]

/** One message, in its words. */
export function say<K extends MessageId>(id: K, facts: Facts<K>): string {
  return (MESSAGES[id].say as (f: Facts<K>) => string)(facts)
}

/** Every message rendered from its own example: what tests/fixtures/messages.golden.ts holds. */
export function renderAll(): Record<string, string> {
  return Object.fromEntries(Object.entries(MESSAGES).map(([id, e]) => [id, (e.say as (f: unknown) => string)(e.example)]))
}
