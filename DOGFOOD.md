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
