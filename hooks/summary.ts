import type { TddStats } from '../types'
import { describeConfig } from './config.ts'
import type { GuardConfig } from './config.ts'
import { moduleLabel } from './mirror.ts'
import { otherOpenModules } from './stats.ts'
import { formatAgo, formatSpan } from './timeText.ts'
import { WORKAROUND_KINDS } from './workarounds.ts'

const WORKAROUND_WORDS: Readonly<Record<string, string>> = {
  config: 'config loosened',
  pause: 'paused',
  'test-changed': 'test changed',
  skipped: 'skipped',
  'assertion-removed': 'assertions removed',
  'commented-out': 'commented out',
  'hollow-touch': 'touched unchanged',
  'record-edited': 'override record edited',
}

const RECENT_EVENTS = 10

// The stored event kinds are internal names; /tdd says them in the one vocabulary (2026-10-18), so "caught runPlan"
// never sits under "proven 11". Kinds not listed read as they are.
const EVENT_WORDS: Readonly<Record<string, string>> = {
  caught: 'proven',
  unverified: 'not checked',
  elsewhere: 'failed, not this module',
  fail: 'failed',
  pass: 'passed',
  unread: 'run not read',
  'test-changed': 'unproven, the test changed',
  'hollow-touch': 'touched unchanged',
  'needs-run': 'needs a run',
  'pin-corrected': 'pin corrected',
  pinning: 'pin skill in use',
  'git-in': 'brought in by git, not guarded',
  'comment-touch': 'touched, comments only',
}

// Pin corrected (2026-10-18): a fixed pin is not a workaround, so it is said on its own line, never under workarounds.
function pinsLine(s: TddStats): string[] {
  return s.pinsCorrected === 0 ? [] : [`pins corrected: ${s.pinsCorrected} (a pin that guessed today's behaviour wrongly, fixed while the pin skill was in use)`]
}

function cycleLine(s: TddStats): string {
  if (s.cycles === 0) {
    return 'cycles: 0'
  }
  const testChanged = s.testChanged === 0 ? '' : `, test changed ${s.testChanged}`
  return `cycles: ${s.cycles} (avg ${formatSpan(s.cycleMsTotal / s.cycles)}, never failed ${s.neverSawRed}${testChanged})`
}

function runsLine(s: TddStats): string {
  const unread = s.unreadRuns === 0 ? '' : `, ${s.unreadRuns} unread`
  return `runs: ${s.passes + s.fails} (${s.passes} pass, ${s.fails} fail${unread})`
}

function phaseLine(s: TddStats, nowMs: number): string {
  const open = s.cycleStartMs === null ? '' : ` for ${formatSpan(nowMs - s.cycleStartMs)}`
  const elsewhere = s.redElsewhere.length === 0 ? '' : ` (red elsewhere: ${s.redElsewhere.join(', ')})`
  return `phase: ${s.phase.toUpperCase()}${open}${elsewhere}`
}

/** Other modules with a cycle still open: a red or a test waiting somewhere the band is not looking. */
function openLine(s: TddStats, label: Label): string[] {
  const others = otherOpenModules(s)
  return others.length === 0 ? [] : [`also open: ${others.map(({ module, phase }) => `${label(module)} (${phase})`).join(', ')}`]
}

// "when: what" rows under a header row: the app shows /tdd as a table of "key: value" rows (2026-10-18).
function eventLines(s: TddStats, nowMs: number, label: Label): string[] {
  if (s.events.length === 0) {
    return ['recent events: none yet']
  }
  const rows = s.events
    .slice(-RECENT_EVENTS)
    .reverse()
    .map(e => {
      const what = [e.module === undefined ? '' : label(e.module), e.detail === undefined ? '' : `(${e.detail})`].filter(part => part !== '').join(' ')
      return `${formatAgo(nowMs - e.atMs)}: ${EVENT_WORDS[e.kind] ?? e.kind} ${what}`.trimEnd()
    })
  return ['recent events: newest first', ...rows]
}

function catchLine(s: TddStats): string[] {
  const verdicts =
    s.caught + s.proven + s.missed + s.unverified === 0
      ? []
      : // The band's words (bandModel.ts catchWord): caught and proven are one fact to a reader, PROVEN.
        [`catch check: proven ${s.caught + s.proven} · missed ${s.missed} · not checked ${s.unverified}`]
  // A refactor is a fact about the change, not a verdict on the test, so it never sits beside caught and proven.
  const refactors = s.refactors === 0 ? [] : [`refactors: ${s.refactors} (changed while green with the test untouched; not re-checked)`]
  return [...verdicts, ...refactors]
}

function workaroundLine(s: TddStats): string[] {
  if (s.workarounds === 0) {
    return []
  }
  const parts = WORKAROUND_KINDS.filter(kind => (s.workaroundsBy[kind] ?? 0) > 0).map(kind => `${WORKAROUND_WORDS[kind]} ${s.workaroundsBy[kind]}`)
  return [`workarounds: ${s.workarounds} (${parts.join(', ')})`]
}

function inheritedLine(s: TddStats, nowMs: number, label: Label): string[] {
  const entries = Object.entries(s.inherited)
  if (entries.length === 0) {
    return []
  }
  return [`unlocked earlier: ${entries.map(([module, atMs]) => `${label(module)} (${formatAgo(nowMs - atMs)})`).join(', ')}`]
}

type Label = (module: string) => string

/** `build`: which dope-tdd is running (build.ts), the first row; the app already names the plugin. */
export function formatStatus(s: TddStats, nowMs: number, config?: GuardConfig, build?: string): string {
  const label: Label = module => (config === undefined ? module : moduleLabel(config, module))
  return [
    build ?? 'dope-tdd',
    // A guard that threw let calls through: "ON" would not be true (verified review A13).
    `guard: ${
      s.guardFailures > 0
        ? `FAILING (${s.guardFailures} call${s.guardFailures === 1 ? '' : 's'} went through unguarded after an internal error; see the log)`
        : s.paused
          ? 'PAUSED'
          : 'ON'
    }`,
    ...(config === undefined ? [] : describeConfig(config)),
    phaseLine(s, nowMs),
    `module: ${s.current === null ? 'none' : label(s.current.module)}`,
    ...openLine(s, label),
    runsLine(s),
    cycleLine(s),
    `test-first: ${s.testFirst}/${s.testFirst + s.blocked + s.unguarded} · unguarded ${s.unguarded} · blocked ${s.blocked}`,
    ...catchLine(s),
    ...workaroundLine(s),
    ...pinsLine(s),
    ...inheritedLine(s, nowMs, label),
    ...eventLines(s, nowMs, label),
  ].join('\n')
}

/** One glossary row: the word, then what it means, in two columns. */
function word(name: string, meaning: string): string {
  // 16 wide: the longest word, "unlocked earlier" (a row /tdd prints), still leaves a space before its meaning.
  return `  ${name.padEnd(16)} ${meaning}`
}

// One verdict vocabulary (2026-10-18): the words the band and /tdd show now, and only those. CAUGHT, UNVERIFIED,
// NEVER SAW RED, TEST CHANGED and the other band v2 words are retired; a glossary of words nobody sees misleads.
export function formatGlossary(): string {
  return [
    'dope-tdd: what the words mean',
    'the band',
    word('red ✓ green ✓', 'the steps of this cycle: ✓ done, · not yet, ✗ the test went green without failing first'),
    word('RED 4M', 'the test fails now, and how long since the cycle opened; it turns alarm red after 10 minutes'),
    word('PROVEN', 'the test fails without your change (dope-tdd undid it, or you broke the code on purpose): it guards this change'),
    word('MISSED', 'with your change undone the test still passes: it does not guard this change; strengthen the test'),
    word('UNPROVEN', 'green, but not proven by a test that failed first: the reason follows the word (never failed, not checked, the test changed)'),
    word('CHANGED', 'the code changed since it went green: run the test again before trusting the green'),
    word('refactor', 'code changed while green with the test untouched; not re-checked'),
    word('proving…', 'dope-tdd is running the test with your change undone'),
    word('last run', 'which test ran last, how it went, and when; "not this module" when it failed in other test files; click it to open that test'),
    word('next', 'the one step to take now'),
    word('NOT WATCHING', 'code was edited that no test layout pairs, and nothing is guarded yet: /tdd setup, or a layout in dope-tdd.json'),
    word("CAN'T READ RUNS", 'test runs happened and none could be read: run one test file so its summary line is in the output'),
    word('PAUSED', '/tdd pause <minutes> <reason>: edits are not counted until it ends by itself, or /tdd resume; they stay debt'),
    word('STANDING DOWN', 'a git rebase, merge, cherry-pick, revert, am or bisect is in progress: the guard waits until it ends'),
    word('WARN ONLY', 'the mode lets untested edits through, with a warning (dope-tdd.json)'),
    word('OBSERVING', 'the mode refuses nothing; dope-tdd only records (dope-tdd.json)'),
    word('OVERRIDE ASKED', 'the agent asked to pass the guard and waits: /tdd approve, or /tdd deny <why>'),
    word('OVERRIDE OPEN', 'an approved override that still lets edits through: what is left and who approved it; END closes it'),
    '/tdd',
    // The docs review (2026-10-18): every row /tdd prints, and the two words the rest leans on.
    word('touch', "creating or editing a test file: it unlocks that test's module for this session, as a run that fails does"),
    word('catch check', 'after a green, dope-tdd undoes your change, runs the test again, and puts the change back: PROVEN if the test then fails, MISSED if it still passes'),
    word('phase', 'where the current module is: IDLE, WRITING (a test touched, not run yet), RED or GREEN'),
    word('also open', 'other modules with a cycle still open, and where each stands'),
    word('test-first', 'source edits made after their test was touched or seen failing, out of all source edits and refusals'),
    word('unlocked earlier', 'modules whose test was touched in an earlier session (up to 7 days); each needs one run of its test before its first edit'),
    word('unguarded', 'a source file changed with no test touched first'),
    word('blocked', 'an edit was refused until the test is written'),
    word('never failed', 'cycles that went green without the test ever failing'),
    word('not checked', 'greens the catch check could not run on; the agent was told why'),
    word('workarounds', 'ways around the guard, each on the record: config loosened, pause, test changed after red, skip/only added, assertion removed, code commented out, a test re-saved unchanged'),
    word('pins corrected', 'a pin fixed after its first red, with the code unchanged, while the pin skill was in use; it still needs a deliberate break to prove it'),
    word('overrides', "this session's overrides: how many were approved and denied, and who decided each; one not yet ended, and edits made under it or a pause with no test yet, are debt on the receipt"),
    word('mode', 'enforce denies, warn tells, observe only records (dope-tdd.json)'),
    word('DOPE', "Deny, Observe, Prove, Evidence. Motto: don't overdub, prove every bar"),
  ].join('\n')
}
