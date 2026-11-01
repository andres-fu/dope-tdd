import { describe, expect, test } from 'claude-code/testing'

import { parseConfig } from '../hooks/config'
import { formatGlossary, formatStatus } from '../hooks/summary'
import { INITIAL_STATS, recordCommentTouch, recordGitIn, recordOutside, recordLeftOut, recordRun, recordSpike, recordTestTouch, recordUnwatchedEdit, recordWorkaround, seedUnlocks, togglePause } from '../hooks/stats'
import type { TddStats } from '../types'

const T0 = 1_000_000

describe('formatStatus', () => {
  test('says plainly when nothing has happened yet', () => {
    const text = formatStatus(INITIAL_STATS, T0)
    expect(text).toMatch(/guard: ON/)
    expect(text).toMatch(/phase: IDLE/)
    expect(text).toMatch(/^recent events: none yet$/m)
  })

  // Verified review A13 (2026-10-20): /tdd said "guard: ON" while calls went through unguarded after internal errors.
  test('a guard that failed says so on its own line, with how many calls went through', () => {
    expect(formatStatus({ ...INITIAL_STATS, guardFailures: 3 }, T0)).toMatch(/^guard: FAILING \(3 calls went through unguarded after an internal error; see the log\)$/m)
  })

  test('reports pause, phase, counts and recent events with relative times', () => {
    let s = recordTestTouch(INITIAL_STATS, { module: 'utils/a', testPath: 'C:/w/tests/utils/a.test.ts' }, T0)
    s = recordRun(s, false, T0 + 5_000)
    s = togglePause(s, T0 + 10_000)
    const text = formatStatus(s, T0 + 65_000)

    expect(text).toMatch(/guard: PAUSED/)
    expect(text).toMatch(/phase: RED/)
    expect(text).toMatch(/module: utils\/a/)
    expect(text).toMatch(/runs: 1 \(0 pass, 1 fail\)/)
    // #216: rows under an hour say the seconds too.
    expect(text).toMatch(/^1MIN05S AGO: touched utils\/a$/m)
    expect(text).toMatch(/^55S AGO: paused$/m)
  })
})

describe('unlocks from earlier sessions', () => {
  test('are listed with their age so the agent and the person know where the unlock came from', () => {
    const s = seedUnlocks(INITIAL_STATS, { 'utils/a': { testPath: 'C:/w/tests/utils/a.test.ts', atMs: T0 - 3 * 60 * 60_000 } })
    const text = formatStatus(s, T0)

    expect(text).toMatch(/unlocked earlier: utils\/a \(3H AGO\)/)
  })
})

describe('a module in a folder with a layout of its own is named by its source path (#24)', () => {
  test('in the open modules and the unlocks from earlier sessions too', () => {
    const config = parseConfig('{"layout":{"source":"{module}.{ext}","test":"test/{module}.test.{ext}"},"layouts":{"dashboard":"colocated"}}')
    let s = seedUnlocks(INITIAL_STATS, { 'dashboard//lib/pkce': { testPath: 'C:/w/dashboard/src/lib/pkce.test.ts', atMs: T0 - 60 * 60_000 } })
    s = recordTestTouch(s, { module: 'dashboard//lib/toasts', testPath: 'C:/w/dashboard/src/lib/toasts.test.ts' }, T0)
    s = recordTestTouch(s, { module: 'queueOps', testPath: 'C:/w/test/queueOps.test.js' }, T0)
    const text = formatStatus(s, T0, config)

    expect(text).toMatch(/also open: dashboard\/src\/lib\/toasts \(writing\)/)
    expect(text).toMatch(/unlocked earlier: dashboard\/src\/lib\/pkce \(1H AGO\)/)
    expect(text).toMatch(/module: queueOps/)
  })
})

// One verdict vocabulary (2026-10-18): /tdd counts in the band's words, so the band's PROVEN never sits beside "proven 0".
describe('the catch check counts in the band\'s words', () => {
  test('caught and proven add up to proven; unverified is not checked', () => {
    const s = { ...INITIAL_STATS, caught: 2, proven: 1, missed: 1, unverified: 3 }
    expect(formatStatus(s, T0)).toMatch(/^catch check: proven 3 · missed 1 · not checked 3$/m)
    expect(formatStatus(s, T0)).not.toMatch(/caught|unverified/)
  })

  test('a green that never failed is counted as never failed', () => {
    const s = { ...INITIAL_STATS, cycles: 2, cycleMsTotal: 120_000, neverSawRed: 1 }
    // Count first (Karl's round 4, 2026-10-20): "never failed 1" read as a sentence fragment.
    expect(formatStatus(s, T0)).toMatch(/^cycles: 2 \(avg 1MIN, 1 never failed\)$/m)
    expect(formatStatus({ ...s, testChanged: 1 }, T0)).toMatch(/^cycles: 2 \(avg 1MIN, 1 never failed, 1 test changed\)$/m)
  })
})

describe('/tdd why explains the words the band and /tdd use, and only those', () => {
  test('the verdicts in the one vocabulary; the retired words are gone', () => {
    const text = formatGlossary()
    expect(text).toMatch(/^ {2}PROVEN +the test fails without your change \(dope-tdd undid it, or you broke the code on purpose\): it guards this change/m)
    expect(text).toMatch(/^ {2}MISSED +with your change undone the test still passes/m)
    expect(text).toMatch(/^ {2}red ✓ green ✓ +the steps of this cycle: ✓ done, · not yet, ✗ the test went green without failing first/m)
    expect(text).toMatch(/^ {2}RED 4M +the test fails now, and how long since the cycle opened/m)
    expect(text).toMatch(/^ {2}last run +which test ran last, how it went, and when;/m)
    for (const retired of ['CAUGHT', 'UNVERIFIED', 'NEVER SAW RED', 'TEST CHANGED', 'SAW RED', 'RED ELSEWHERE', 'GIT REBASE', 'UNWATCHED', '  WATCHING']) {
      expect(text).not.toContain(retired)
    }
  })

  test('watching, not watching, runs it cannot read, and the next step', () => {
    const text = formatGlossary()
    expect(text).toMatch(/^ {2}NOT WATCHING {5}code was edited that no test layout pairs/m)
    expect(text).toMatch(/^ {2}CAN'T READ RUNS {2}test runs happened and none could be read/m)
    expect(text).toMatch(/^ {2}next {13}the one step to take now/m)
    // Override with a reason, v1 (2026-10-18): no off switch, so PAUSED points at a time and a reason.
    expect(text).toMatch(/^ {2}OVERRIDE ASKED +the agent asked to pass the guard and waits: \/tdd approve, or \/tdd deny <why>/m)
    // Band v3 (2026-10-18): the verdict and guard words the band now uses.
    expect(text).toMatch(/^ {2}UNPROVEN +green, but not proven by a test that failed first: the reason follows the word/m)
    expect(text).toMatch(/^ {2}CHANGED +the code changed since it went green: run the test again/m)
    expect(text).toMatch(/^ {2}STANDING DOWN +a git rebase, merge, cherry-pick, revert, am or bisect is in progress/m)
    expect(text).toMatch(/^ {2}WARN ONLY +the mode lets untested edits through, with a warning/m)
    expect(text).toMatch(/^ {2}OBSERVING +the mode refuses nothing; dope-tdd only records/m)
    // #193: an invalid dope-tdd.json is said on the band, so /tdd why explains the word.
    expect(text).toMatch(/^ {2}CONFIG INVALID +dope-tdd.json did not parse or has an invalid value: the defaults apply \(enforce, the default layout\) until it is fixed/m)
    // Live trial: one row for every override still open, whichever module is current, with END (2026-10-18).
    expect(text).toMatch(/^ {2}OVERRIDE OPEN +an approved override that still lets edits through: what is left and who approved it; END closes it/m)
    expect(text).not.toMatch(/OVERRIDDEN/)
    expect(text).not.toMatch(/OVERRIDES OPEN/)
    expect(text).toMatch(/^ {2}PAUSED +\/tdd pause <minutes> <reason>: edits are not counted until it ends by itself, or \/tdd resume/m)
    expect(text).not.toMatch(/\/tdd off/)
  })
})

describe('formatStatus names an edited override record (2026-10-18)', () => {
  test('as its own workaround word', () => {
    const s = recordWorkaround(INITIAL_STATS, 'record-edited', '', 'dope-tdd.overrides.json', T0)
    expect(formatStatus(s, T0)).toMatch(/workarounds: 1 \(override record edited 1\)/)
  })

  // 2026-10-26 (integrity): an edit to a session record has its own word.
  test('and an edited session log as its own', () => {
    const s = recordWorkaround(INITIAL_STATS, 'log-edited', '', '2026-10-26-sess-1.json', T0)
    expect(formatStatus(s, T0)).toMatch(/workarounds: 1 \(session log edited 1\)/)
  })
})

describe('formatStatus as rows the app can show as a table (2026-10-18)', () => {
  test('the first row is the build, not the plugin name twice', () => {
    expect(formatStatus(INITIAL_STATS, T0, undefined, '#99 · a6b93d4 · 2026-10-18').split('\n')[0]).toBe('#99 · a6b93d4 · 2026-10-18')
  })

  test('each recent event is a "when: what" row under a header row', () => {
    const s = recordTestTouch(INITIAL_STATS, { module: 'utils/a', testPath: 'C:/m/tests/utils/a.test.ts' }, T0)
    const text = formatStatus(s, T0 + 60_000)
    expect(text).toMatch(/^recent events: newest first$/m)
    expect(text).not.toMatch(/^ {2}\S/m)
  })

  test('code brought in by git reads as such, with the command', () => {
    const s = recordGitIn(INITIAL_STATS, ['api'], 'git stash pop', T0)
    expect(formatStatus(s, T0)).toMatch(/: brought in by git, not guarded api \(git stash pop\)$/m)
  })

  // #238
  test('work outside the project reads as not guarded, with the path', () => {
    const s = recordOutside(INITIAL_STATS, 'C:/work/other/src/a.ts', T0)
    expect(formatStatus(s, T0)).toMatch(/: outside this project, not guarded \(C:\/work\/other\/src\/a\.ts\)$/m)
  })

  // #234 (tester round 7): under an unread dope-tdd.json an untested edit landed while /tdd led with a bare "guard: ON".
  // #236: edits under a carried-over unlock are neither test-first nor misses; the line counts them apart.
  test('the test-first line counts edits under an earlier session\'s unlock on their own', () => {
    expect(formatStatus({ ...INITIAL_STATS, testFirst: 2, carriedEdits: 1 }, T0)).toMatch(/^test-first: 2\/2 · under an earlier session's unlock 1 · unguarded 0 · blocked 0$/m)
    expect(formatStatus({ ...INITIAL_STATS, testFirst: 2 }, T0)).toMatch(/^test-first: 2\/2 · unguarded 0 · blocked 0$/m)
  })

  test('the guard line says when dope-tdd.json was not read', () => {
    expect(formatStatus(INITIAL_STATS, T0, parseConfig('{"mode":"strict"}'))).toMatch(/^guard: ON with the defaults: dope-tdd\.json was not read \(see config below\)$/m)
  })

  test('the guard line counts a layout miss once, whichever tool wrote it', () => {
    const both = recordLeftOut(recordLeftOut(INITIAL_STATS, 'a.ts', 'layout', T0), 'a.ts', 'shell', T0)
    expect(formatStatus(both, T0)).toMatch(/^guard: ON, but 1 edited code file matches no test layout and was not guarded \(a\.ts\)/m)
    const shell = recordLeftOut(INITIAL_STATS, 'b.ts', 'shell', T0)
    expect(formatStatus(shell, T0)).toMatch(/^guard: ON, but 1 edited code file matches no test layout and was not guarded \(b\.ts\)/m)
  })

  test('the guard line says when code of another stack was edited, with no setup it cannot deliver', () => {
    const one = recordLeftOut(INITIAL_STATS, 'tools/gen.py', 'stack', T0)
    expect(formatStatus(one, T0)).toMatch(/^guard: ON, but 1 edited code file is another stack and was not guarded \(tools\/gen\.py\)$/m)
    expect(formatStatus(one, T0)).toMatch(/: edited, another stack, not guarded \(tools\/gen\.py\)$/m)
    const both = recordLeftOut(one, 'scripts/a.ts', 'layout', T0)
    expect(formatStatus(both, T0)).toMatch(/not guarded \(scripts\/a\.ts\) · fix: \/tdd setup, and 1 edited code file is another stack and was not guarded \(tools\/gen\.py\)$/m)
  })

  test('the guard line says when edited code matched no test layout, and the edit is an event', () => {
    const s = recordUnwatchedEdit(recordUnwatchedEdit(INITIAL_STATS, 'api.py', T0), 'run.py', T0)
    const text = formatStatus(s, T0)
    expect(text).toMatch(/^guard: ON, but 2 edited code files match no test layout and were not guarded \(api\.py, run\.py\) · fix: \/tdd setup$/m)
    expect(text).toMatch(/: edited, no test layout, not guarded \(api\.py\)$/m)
    expect(formatStatus(recordUnwatchedEdit(INITIAL_STATS, 'api.py', T0), T0)).toMatch(/^guard: ON, but 1 edited code file matches no test layout and was not guarded \(api\.py\)/m)
  })

  test('a comments-only touch reads as such (decided 2026-10-20)', () => {
    const s = recordCommentTouch(INITIAL_STATS, 'utils/a', T0)
    expect(formatStatus(s, T0)).toMatch(/: touched, comments only utils\/a$/m)
  })

  test('no events is one row', () => {
    expect(formatStatus(INITIAL_STATS, T0)).toMatch(/^recent events: none yet$/m)
  })
})

// The five /tdd fixes (2026-10-18), from reading /tdd and /tdd why live.
describe('/tdd says each event in the one vocabulary', () => {
  test('a catch check is proven, not caught; one that could not run is not checked', () => {
    const at = (kind: string, module: string) => ({ atMs: T0, kind, module }) as TddStats['events'][number]
    const s = { ...INITIAL_STATS, events: [at('caught', 'runPlan'), at('proven', 'stats'), at('unverified', 'briefing'), at('elsewhere', 'runPlan')] }
    const text = formatStatus(s, T0)
    expect(text).toMatch(/^JUST NOW: proven runPlan$/m)
    expect(text).toMatch(/^JUST NOW: proven stats$/m)
    expect(text).toMatch(/^JUST NOW: not checked briefing$/m)
    expect(text).toMatch(/^JUST NOW: failed, not this module runPlan$/m)
    expect(text).not.toMatch(/caught|unverified|: elsewhere/)
  })
})

describe('/tdd why is one even column, and explains what /tdd prints', () => {
  test('every meaning starts in the same column, the longest word included', () => {
    const rows = formatGlossary().split('\n').filter(line => line.startsWith('  '))
    for (const row of rows) {
      expect(row.slice(18, 20)).toMatch(/^ \S$/)
    }
  })

  test('the overrides line is explained, and the last run says when it was not this module', () => {
    const text = formatGlossary()
    expect(text).toMatch(/^ {2}overrides {8}this session's overrides: how many were approved and denied, and who decided each; one not yet ended, and edits made under it or a pause with no test yet, are debt on the receipt/m)
    expect(text).toMatch(/^ {2}last run +which test ran last, how it went, and when; "not this module" when it failed in other test files; click it to open that test/m)
  })
})

// The docs review (2026-10-18): /tdd printed rows /tdd why never explained, and "touch" and "catch check" were
// used everywhere without a definition.
describe('/tdd why explains every row /tdd prints, and the two words everything else leans on', () => {
  test('phase, module, also open, runs, cycles, test-first, catch check, unlocked earlier, and touch', () => {
    const text = formatGlossary()
    for (const row of ['phase', 'also open', 'test-first', 'catch check', 'unlocked earlier', 'touch']) {
      expect(text).toMatch(new RegExp('^ {2}' + row + ' +\\S', 'm'))
    }
    expect(text).toMatch(/^ {2}catch check +after a green, dope-tdd undoes your change, runs the test again, and puts the change back: PROVEN if the test then fails/m)
    expect(text).toMatch(/^ {2}touch +creating or editing a test file: it unlocks that test's module for this session/m)
  })
})

// Pin corrected (2026-10-18, from the VibeCast field test): fixing a pin that guessed today's behaviour wrongly looks,
// on the record alone, exactly like a test bent to match a bug. The difference is the pin skill: with it in use this
// session, the correction is said as what it is, on its own line and not as a workaround; without it, it stays
// "test changed". Either way the pin still has to be proven by a deliberate break.
describe('/tdd says pin corrections apart from workarounds', () => {
  test('its own row and event words; the glossary explains it', () => {
    const s = { ...INITIAL_STATS, pinsCorrected: 2, events: [{ atMs: T0, kind: 'pin-corrected', module: 'cover' }] as TddStats['events'] }
    const text = formatStatus(s, T0)
    expect(text).toMatch(/^pins corrected: 2 \(a pin that guessed today's behaviour wrongly, fixed while the pin skill was in use\)$/m)
    expect(text).toMatch(/^JUST NOW: pin corrected cover$/m)
    expect(text).not.toMatch(/workarounds/)
    expect(formatGlossary()).toMatch(/^ {2}pins corrected +a pin fixed after its first red, with the code unchanged, while the pin skill was in use; it still needs a deliberate break to prove it/m)
  })
})

// Idea 19: spikes have their own line, never under workarounds.
describe('formatStatus spikes', () => {
  // #213 (tester round 6): a spike is recorded when the skill starts. Nothing tracks the copy or a rebuild, so the line
  // and the event say only that one started; "then rebuilt test-first" read as done while the copy still existed.
  test('a spike is its own line with the last question, and says only that it started', () => {
    const text = formatStatus(recordSpike(INITIAL_STATS, 'can the parser stream?', T0), T0 + 1000)
    // #237 (tester round 7): the line claimed a throwaway copy for a spike abandoned before any copy was made.
    expect(text.split('\n')).toContain('spikes started: 1 (last: can the parser stream?)')
    expect(text).not.toMatch(/throwaway copy/)
    expect(text).not.toMatch(/rebuilt/)
    expect(text).not.toMatch(/workarounds/)
    expect(text).toContain('spike started (can the parser stream?)')
  })

  test('no spike: no line', () => {
    expect(formatStatus(INITIAL_STATS, T0)).not.toMatch(/spikes:/)
  })
})

// #216 (tester round 6): rows said only the minute, so refusals seconds apart read the same and merged in the next
// read, and nothing said which row was a subagent's. Under an hour a row says the seconds too.
describe('formatStatus event rows', () => {
  const at = (atMs: number, agent?: string) => ({ atMs, kind: 'blocked' as const, module: 'stats', ...(agent === undefined ? {} : { agent }) })

  test('under an hour, a row says the seconds', () => {
    const text = formatStatus({ ...INITIAL_STATS, events: [at(T0 - 492_000), at(T0 - 12_000)] }, T0)
    expect(text).toMatch(/^8MIN12S AGO: blocked stats$/m)
    expect(text).toMatch(/^12S AGO: blocked stats$/m)
  })

  test("a subagent's row says so", () => {
    expect(formatStatus({ ...INITIAL_STATS, events: [at(T0, 'a1')] }, T0)).toMatch(/^JUST NOW: blocked stats · subagent$/m)
  })
})
