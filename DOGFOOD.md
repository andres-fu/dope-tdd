# Dogfood log — Red First on throughline

Gate: ~2 weeks of real use (started 2026-10-07). One line per friction or surprise:
date · what happened · what it suggests. Keep entries short and honest.

| Date | What happened | What it suggests |
| --- | --- | --- |
| 2026-10-06 | Desktop band rendered as a bright bone slab on the dark app; buttons invisible | Use theme colors; brand only in accents (fixed in v2.1) |
| 2026-10-06 | Calavera logo SVG rendered as a broken image; a tiny probe SVG worked | Purpose-drawn small mark beats a detailed logo (fixed: skull.svg) |
| 2026-10-07 | Guard sat paused during real work; owner believed they had resumed it | No confirmation on toggle, no way to check state (fixed: toasts, /tdd, status tool) → MVP needs spike mode so pausing isn't the escape hatch |
| 2026-10-07 | Claude edited CareerTimeline.tsx via a Python script in Bash; guard never saw it | Bash bypass (fixed in v3: pre-call write detection + git diff backstop) |
| 2026-10-07 | "AVG 6S" cycles didn't match ~30s real cycles | RED started at test edit, not failing run (fixed in v3: WRITING phase) |
| 2026-10-08 | Headless playground run: Claude piped `vitest run` through `tail -30`; the failing run was logged as a pass and the cycle as "never saw red" | Exit codes can't be trusted; read the runner's summary line (fixed: runOutcome) |
| 2026-10-08 | Claude itself noticed the status was wrong: "it doesn't seem to have counted my failing run" | The agent reads the evidence too; status text has to be exact or it stops trusting the tool |
| 2026-10-08 | `claude plugin test .` swept up the test Claude wrote under `playground/tests/` | The playground ships with no tests and must be reset after every run |
| 2026-10-08 | Walk 2 live run: Claude pinned behaviour, broke the code on purpose, saw red, restored, refactored, and then had to explain the lingering "never saw red 1" to the user | The agent's evidence must not need explaining (fixed: retracted once a later red proves the pin) |
| 2026-10-08 | Walk 3 live run: told to skip the test, Claude got blocked once, read the deny message and CLAUDE.md, and did it properly | The deny text works as a nudge; keep it short, exact, and name the file to create |
| 2026-10-08 | Advice live run: all three lines (unlocked, RED, GREEN saw red) reached Claude as "hook additional context" and it acted on the first two; it skipped the refactor step as "the fix is already small" | Lines land where the agent reads them; the GREEN wording may want "if there is anything to clean up" |
| 2026-10-08 | Committed while a live run was still writing to the playground; its test and fix landed in the commit | Never run `git add -A` in parallel with a playground run; reset first, commit second |
| 2026-10-08 | Two-session live run: session two edited the source without touching the test, was allowed, got "unlocked because ... was touched JUST NOW in an earlier session", and ran the test right after | Memory across sessions works; the line can only arrive after the edit it rides on, and that was enough |
| 2026-10-08 | Catch check live run (Bug 2, honest): the reverted test failed, status said "caught 1", and Claude read "its test catches the change" in the tool result | The check works end to end on a real Vitest project in a few seconds |
| 2026-10-08 | Catch check live run (Bug 3, weak test): the test went green before the fix, the cycle closed, and the later fix plus pass never triggered the check; Claude also skipped "break it on purpose" as beyond the ask | Trigger the check on any pass with pending changes, not only on a completed cycle (fixed); the check replaces the break-on-purpose advice for that case |
| 2026-10-08 | Design catch while writing tests: undoing a refactor keeps the test green by definition, so the check would report every refactor as "missed" | Changes made while green on a proven module are refactors: credited, never reverted (fixed) |
| 2026-10-08 | Warn-mode live run with an exempt file: a code-only fix was allowed, counted as unguarded, and Claude read "write tests/money/formatCents.test.ts(x) next"; the exempt rename raised nothing; `/tdd` showed `mode: warn` and the exemption | Modes and exemptions replace pause for legitimate non-test work, and the exception is on the record |
| 2026-10-08 | Architect review plus a second code review of PR #3: the catch check minted CAUGHT from an exit code when the runner crashed, a new file was caught by construction, a failed restore could leave every edit denied, and the PowerShell tool was not hooked on the owner's own machine | Honesty pass (decision doc of the same name): no summary means unknown, per-module checks, an expiring lock, red attributed by FAIL lines, test-changed-after-red named, config edits recorded; every verdict word now has a falsifier test |
| 2026-10-08 | Live run after the honesty pass (Bug 2, headless, tool allowlist): touched → fail → edited → pass → caught 1 on real Vitest output with the exit-code fallback gone; all four advice lines reached Claude and it acted on each. Its first test command went through the PowerShell tool, which was not on the allowlist, so it was held for approval and never ran; the plugin counted that result as an `unread` run and told Claude to pipe through tail | The reader is honest about what it saw, but a command that never ran is not a run: read the permission-held text as "did not run", count nothing, say nothing |

## 2026-10-08 — DungeonLobby, the first receipt on a repo nobody built for the demo

Repo: Ironwright-Labs/DungeonLobby (Vitest 4, roots client/server/shared, template
src/{module} ↔ src/__tests__/{module}.test). Run: a headless `claude -p` session rooted in the
clone with a tool allowlist, the plugin installed at user scope. Task: dice notation accepts
spaces around the modifier sign. Receipt: touched → fail → edited → pass → caught; 1 cycle,
caught 1, blocked 0. PR: https://github.com/Ironwright-Labs/DungeonLobby/pull/27 (from the
owner's fork), receipt verbatim in the description.

Findings: (1) a test run invoked from inside `server/` with a package-relative path was read as
"red elsewhere" because the path was resolved against the session root; the agent reran with
the full path. Shell cwd drift, `arch2 7`, seen on a real repo. (2) The headless run was not
refused by the auto-mode classifier when given `--allowedTools` instead of skipped
permissions; that is the way to drive a plugin-watched session from another session.
Outcome: merged by the maintainer on 2026-10-09 (04:06 UTC), no review comments. The first change
made under Dope TDD to be accepted on someone else's repository.

## 2026-10-09 — DungeonLobby, a real bug in the reconnection path

Found by reading the untested handlers and following the socket-id trail into the manager: a
player who refreshes gets a new socket id, rejoinRoom migrated the player and their tokens but
not the stored whispers, getChatHistoryForPlayer filters whispers by socket id, and the client
replaces its chat with the synced history, so the DM's private messages vanished from the
player's screen after a refresh. Fixed test-first by a headless session with the plugin watching:
touched → fail → edited → pass → caught; 1 cycle, caught 1, blocked 0. Eleven lines next to the
existing token migration, one test covering both directions and a third player.
PR: https://github.com/Ironwright-Labs/DungeonLobby/pull/28 (from the owner's fork).

Lesson for the search: the bug was not in the untested handlers themselves (they are careful) but
in a record that carries a socket id across a reconnect. "What identifier is stored, and what
happens when it changes" is a better question than "where is the untested code".

## 2026-10-09 — DungeonLobby, Walk 2 on real code: pin, prove, refactor

server/src/handlers/mapHandlers.ts had no tests and eight handlers with the same preamble. A headless
session with the plugin watching: pinned each handler's five paths (77 cases, real RoomManager and
RateLimiter under fake timers) → GREEN but "never saw red" → broke one message on purpose → RED on
exactly that pin → restored → GREEN "saw red" → refactored with the test file untouched → the plugin
named it a refactor and did not re-check. 495 lines became 377. Receipt: runs 5 (4 pass, 1 fail),
cycles 2, refactors 1, never saw red 0. PR: https://github.com/Ironwright-Labs/DungeonLobby/pull/29.
Verification for a refactor PR: the same pins pass against the old handler (stash) and the new one.
Note for the band: during the pin step the honest word was NEVER SAW RED, and the agent followed the
advice to break the code on purpose; that is the walkthrough's Walk 2 happening unprompted.

## 2026-10-09 — DungeonLobby, a security bug: a spoofable rate-limit key

getSocketIp trusted x-forwarded-for unconditionally and the per-IP create/join limits were keyed on
it, so any client could forge a fresh header per connection. Found by asking "what does the rate
limiter key on, and who controls it" after the socket-id lesson. Fixed test-first (TRUST_PROXY opt-in),
caught 1. PR: https://github.com/Ironwright-Labs/DungeonLobby/pull/30. Also added to PR #28: the
whisper label direction on the client was wrong after a refresh for the same socket-id reason.
Hunting lessons so far: stored identifiers across events that change them; keys of limits and
caches and who controls the input; trust boundaries on headers.

## 2026-10-09 — Roadhouse, dry run of the inference on the real tree

Clone at C:\Users\fuent\Roadhouse-Game. Fed its 130 code files and root entries to inferLayout:
stack godot (project.godot at the root), layout godot-csharp, "37 of 56 test files pair with a
source under godot-csharp", suggested config { stack: godot, layout: godot-csharp }. The 19 that do
not pair are feature-level suites (BandCore, EconomyBalance, Harness, MainSceneLoad, ...) with no
single source; they will unlock nothing, which is the honest reading. No .NET SDK on this machine, so
the catch check (dotnet test --filter) and the dotnet reader still wait for a real run.

## 2026-10-09 — Roadhouse, the first receipt on a Godot game, and PROVEN

Two headless Sonnet runs in a local clone of Adam's Roadhouse (Godot 4.6.2 mono, C#, gdUnit4 via
dotnet test, layout godot-csharp in an excluded dope-tdd.json). Run 1: the briefed agent pinned the
untested VanCost.CostFor in five cases with no refusals, broke Math.Ceiling on purpose (2 red),
restored it byte for byte, green. Stack, layout, red and green all read correctly from real dotnet
output, but the receipt had no proof line: break and restore net to no change, so the catch check
said nothing. Fixed in e67d729 (PROVEN). Run 2, same flow: "GREEN on VanCost, and the code is back
exactly as it was before your break ... PROVEN"; receipt "caught 0 · proven 1"; the unlock from run 1
carried across sessions ("touched 2M AGO in an earlier session"). Nothing committed or pushed in
Roadhouse; test/VanCostTest.cs is untracked in the local clone only.
Minor: a pass before any module is current logs as a bare "pass" with no module.

## 2026-10-09 — Roadhouse, the catch check on C#, and what the numbers say

Measured on the real game (warm, Windows): a source edit plus rebuild plus one pure suite through a
filtered `dotnet test` is 2.5-3 s; an engine-backed suite (OwnedRoomTest, Godot Runtime Test Runner)
is about 16 s, edit or not. The catch-check budget (twice the agent's own green run of the same suite,
capped at 60 s) fits both, so no change; a cold first build (about a minute) can still read as
"unverified: timeout", which is honest. `dotnet test` with no project named resolves the lone .sln.
Then a headless Sonnet run made a real test-first change (VanCost refuses a negative level) on a
throwaway branch: touched -> fail -> edited -> pass -> caught. The first live C# revert-and-rerun:
CAUGHT. Discarded afterwards; nothing pushed.
The agent flagged a false "has no assertion": the hollow-test detector knew only lowercase assert( and
expect(, so every C# test (AssertThat, AssertFloat) and every pytest test (bare `assert x == y`) read
as hollow, and assertion-removal counting was blind there too. Fixed with tests proven red on the old
detector. Lesson: let the agent say what confused it; it found this in one run.

## 2026-10-09 — A/B on Project-RESEARCH: same task, observe vs enforce

One real bug (slugify in src/lib/io.ts drops accents and returns "" for non-Latin topics, so every such
topic writes into the shared work root), one natural prompt with no mention of tests, two fresh Sonnet
agents in two worktrees of a local clone. Observe: the unbriefed agent worked test-first on its own
(added cases to test/slugify.test.ts, red, fix, green), and the plugin called it "unguarded io,
test-first 0/1": a false accusation. Enforce: the agent wrote the failing test, saw red, and was BLOCKED
from io.ts anyway, then wrote duplicate tests in test/io.test.ts to get through, leaving a dangling
"also open: slugify (red)". Same root cause in both: the test is named after the function, the code
after its file, and pairing by name connects nothing. A real engineer reads the import. Fixed: a test
covers what it imports (type-only imports excluded; .js imports name .ts files; Python dotted and
GDScript preload too). The replay test fails on the old plugin with the exact deny the agent got.
Re-run of the gated leg with the import pairing live (3587b3a), same task and model: blocked 0, test-first
1/1, only src/lib/io.ts and test/slugify.test.ts touched, caught 1 on io running test/slugify.test.ts,
no dangling red. Before: blocked 1, a third file of duplicate tests, "also open: slugify (red)".

## 2026-10-09 — The A/B launcher's first run, and what it caught

`dope-tdd-pool/ab.mjs` ran the same slugify task in two worktrees at once (observe and enforce, Sonnet,
under a minute each, $0.15 and $0.17 at list price) and wrote one ledger line per leg to
`~/.dope-tdd/pool/ledger.jsonl`. Both legs: test-first 1/1, blocked 0, the same two files touched;
enforce caught 1 on io. Two findings:
- Observe left "also open: slugify (red)". Its last green was the whole suite (`npx vitest run`, no file
  named), and only a run naming the test file closed the other cycles it covered. Fixed: a green
  whole-suite run (no name filter such as -t, -k, --grep) closes every open cycle; one closed that way
  counts as its own cycle unless its test is the current module's test (one piece of work, not two).
  An older wiring test had encoded the dangling red as correct; it now says the opposite.
- The observe agent wrote "the catch check reported CAUGHT" in its summary. Observe runs no catch check,
  and the receipt it printed above that sentence has no catch line. The prose is a claim; the receipt is
  the evidence. Readers of a PR (and the ledger) should trust the receipt block, never the summary.

## 2026-10-09 — A/B on both of Adam's repos: the same pattern twice

Two real bugs found by scouts and checked by hand, each run observe vs enforce from the latest main
(`dope-tdd-pool/ab.mjs --ref`), Sonnet, nothing committed:
- DungeonLobby, `RoomManager.updateToken` resizes a token past the map edge (addToken and moveToken
  refuse it). Observe: fixed, 86/86 green, never saw red 1. Enforce: red first, fixed, caught 1.
  $0.18 vs $0.20, 9 vs 10 turns.
- Roadhouse, `TipFormat.RoomProgressLine` rounds 99.7% up to "100%" while the Buy button is disabled.
  Observe: fixed, never saw red 1 (it says so itself: "I wrote the fix right after the tests"). Enforce:
  red first, fixed, caught 1. $0.37 vs $0.34, 11 vs 12 turns.
The finding: on two unrelated stacks (TypeScript and Godot C#), the unguarded agent wrote tests and never
watched them fail; the guarded one did, and its tests are proven to catch the change, for about the same
cost and turns. Both fixes look alike; only one comes with evidence.
Engine bug found: Claude Code's refusal "A variable in this command can't be checked before it runs"
was read as an unread run ("1 unread"). Fixed: it is a hold, not a run. Field-guide material for
Roadhouse: the enforce agent bumped EXPECTED_MIN_TOTAL but not the ARCHITECTURE.md count sentence, and
neither agent ran `bash test/run-tests.sh` in full; that repo's rules belong in a briefing.

## 2026-10-09 — The field guide, measured: the same Roadhouse bug, with and without it

Same task (room line rounds 99.7% to "100%"), enforce, Sonnet, from upstream main. Without a guide (the
A/B leg and the first PR run): test-first, caught 1, but the count paragraph in ARCHITECTURE.md was left
with two stale numbers (DocumentClaimsTest would fail) and the full guarded run never happened ("couldn't
find Godot"); both were fixed by hand before PR #71. With `~/.dope-tdd/guides/Atom-Powell__Roadhouse-Game.md`
in the briefing: test-first, caught 1, all four numbers moved together (798, 432 pure), Godot found from
the guide, and `bash test/run-tests.sh` green at 798 of 798. $0.54 and 18 turns vs $0.34 and 12: the extra
cost is the full guarded run the repo asks for. Lesson: the plugin proves the test; the guide carries the
repo's own definition of done.

## 2026-10-09 — The Beth-ready round, re-checked live

After B2 B3 S1-S7 A1 (baseline before CAUGHT, test-named files never source, shell gate for every stack,
cwd carried between calls, monorepo runners and workspace runs, honest REFACTOR, no snapshot around reads):
Project-RESEARCH (vitest) and Roadhouse (Godot C#, dotnet) enforce runs from upstream main, in parallel:
test-first 1/1, blocked 0, caught 1 on both, $0.17 and $0.55, unchanged from before. DungeonLobby earlier the
same evening: the same. Harness note, not plugin: in the Roadhouse run Claude Code refused every form of
`GODOT_BIN=... bash test/run-tests.sh` the agent tried, where the same allowlist passed an hour earlier, so the
full guarded run did not happen; the agent said so and did not work around it. For launcher runs, set
GODOT_BIN in the launcher's environment instead of asking the agent to.

## 2026-10-09 — The catch check in a worktree, proven live

Project-RESEARCH in a full local clone (`ab.mjs --clone`, so .git is a folder as in a person's checkout),
enforce, the slugify task. A watcher polled src/lib/io.ts every 100 ms for the whole run and logged each
distinct version: exactly two, the original and the agent's fix. The fixed file never went back to the old
code. The session record: caught 1, worktreeChecks 1, checkMs 2463 (baseline in the worktree plus the check).
No worktree left in the clone afterwards. Before this change, the same check wrote the old code into the
real file for the length of a test run.

## 2026-10-10 — First open-source A/B: dapr-agents #885 and nanocoder #1689

Bugs found by dope-tdd-pool/find-bugs.mjs, verified against the code by one agent (2 of 6 shortlisted were GO).
- dapr-agents (Python, uv): both legs fixed it and added tests; the enforce agent saw 3 of 4 new tests red
  first. Dope TDD read NONE of the runs: the real ones were `uv run --group test python -m pytest`, and the
  pytest pattern took no flags between `run` and the program; the "unread" runs were failed attempts
  (global python without pytest, uv without pytest). Fixed in 405b499: launcher flags allowed, and a runner
  that never started is no run, said plainly.
- nanocoder (TypeScript, ava, Windows-only bug): enforce test-first 6/7 with a test for each of the three
  functions (its host.ts edit was refused until it wrote that test), caught 1 on plugins/host; observe 3/5
  with 2 unguarded edits and no test for host.ts. Cost 0.49 vs 0.38, turns 34 vs 24: over the 1.25x line
  on this bug. Ava support was added for it (1bd578a), from real output.
- New gap: path-validation.spec.ts already had 11 failures on Windows (POSIX paths, symlink EPERM), so the
  file never goes green, the module stays RED, and its fix can never be checked. Brownfield files with
  known failures need a per-test comparison: which tests failed before vs after, not the file's summary.

## 2026-10-10 — The pull-request check, proven on three repositories and on GitHub

tools/pr-check runs the catch check on a pull request's diff, outside any agent. Locally: dapr-agents #885
CAUGHT; nanocoder #1689 CAUGHT on all three modules, path-validation included, its 11 failures that were
already there set aside by name (the first live proof of the known-failures rule); a probe commit no test
checked read MISSED and exited 1; the working trees were left clean. On GitHub Actions (ubuntu), as a
composite action used from a private repo by another private repo of the same owner, on a fork-only test PR
in andres-fu/DungeonLobby: RoomManager CAUGHT and dice CAUGHT. Test PR closed and its branch deleted.

## 2026-10-17 — VibeCast, day 2 of a refactor: carried-over unlocks gate the first edit (#54)

A new session on VibeCast opened with `runs: 0` and 27 modules "unlocked earlier", every one editable with no run
this session. The 2026-10-08 note ("the line can only arrive after the edit it rides on, and that was enough") held
for one module in a two-session demo. It does not hold on a multi-day refactor, where most modules were unlocked
yesterday. Now a carried-over unlock is pending: the first edit is refused with the command to run and why, and one
whole-file run of its test (red or green) makes it active. A test that changed since the unlock was stored (a checkout,
a merge) drops the carry-over, and the refusal says so. Cost: one run per carried-over module actually edited.
