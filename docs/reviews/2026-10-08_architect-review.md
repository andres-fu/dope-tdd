# 2026-10-08 — Principal architect review (external agent, read-only)

Requested by the owner. Reviewed branch `test-strategy` (PR #3) at 162/162
tests, validation passing, Claude Code 2.1.292 on Windows. Reproduced here
verbatim; the owner's responses and the resulting work are tracked in
`docs/decisions/` and `DOGFOOD.md`.

---

## 1. Verdict

Yes, this is on the right track: verifying the agent's TDD per change (runner-summary parsing, the git backstop, and above all the catch check) is the open slot the research identified, the agent-facing advice lines are the correct primary surface, and the decision log is better than most funded products keep. The single biggest risk is that the evidence is not yet as honest as the band's words claim: in a brownfield repo "saw red" can be earned by any failing test anywhere, a green reached by bending the test with no code change is reported as a clean cycle, and the catch check reverts files in place behind a non-atomic lock. One confidently wrong verdict costs the trust that is the entire product, and DOGFOOD.md already records the agent noticing when the status was wrong.

## 2. Architecture

**Boundaries.** The pure modules (`mirror`, `bashWrites`, `shell`, `runOutcome`, `gitChanges`, `catchCheck`, `config`, `unlocks`, `advice`, `stats`, `summary`) are the right shape: small, API-free, testable. `hooks/register.tsx` is the adapter and has grown to 518 lines; `guardBash` (register.tsx:300-396) does twelve things in sequence (policy, pre-deny, snapshot, proceed, snapshot, diff, capture, reduce, remember, run outcome, catch check, advice). Restructure now while cheap: normalise every observation into events (`ChangeObserved {path, module, before, after, via}`, `RunObserved {outcome, namedTests, failedFiles}`, `TouchObserved`), produced by thin adapters per tool and consumed by one reducer in `stats.ts`, with `verifyCatch` as a separate step. That is Probity's ADR 0007 idea from your own research, and it makes adding a tool a three-line adapter (see risk 1).

**State model.** One atom holding everything, including full file texts (`changes`, types/index.d.ts:54), read and written on every tool call and every render (register.tsx:61-67, 485-486). `update` is read-modify-write with `ifVersion` retry, so each `change()` is atomic, but the hook-level sequence read-at-:209, decide-at-:216-226, write-at-:237 is not. A 1 MB source file edited in a cycle is 1 MB serialised per dispatch. Move texts out of state: keep a content hash in state and the backup bytes in a plugin temp file (or `git hash-object -w` blobs); keep the store journal as paths plus hashes, not texts (the store caps at 4 MiB and `$.store.set` at :158 sits outside the `try`, so one big file throws out of the hook).

**Catch check placement.** Synchronous inside the Bash hook is the right MVP call: the verdict must land in the same tool result the model reads, and an async design would need a later injection and a worse race with the agent's next edit. Keep it synchronous and bounded; fix the lock (risk 2).

**Config per call.** One file read per tool call is fine. One per render (register.tsx:492) is not, renders are frequent; cache on mtime or reload on writes to that path.

**Fine as is:** the pure modules, `normalizeStats`, the `dope-tdd.json` shape, the advice module, the store keys.

## 3. Correctness and security risks, ranked

1. **The PowerShell tool is not hooked** (register.tsx:480 hooks only `Bash`). PowerShell is a built-in tool with an `e.command` field (claude-code.d.ts:15666-15668) and is the primary shell on Windows, your own platform. Test runs, shell writes, and the git backstop all go unseen there. Hook it with the same `guardBash`.

2. **Work loss: non-atomic `checking` lock around an in-place revert** (register.tsx:159-180 vs :209/:223 and :305/:325). An Edit whose hook read stats before `setChecking(true)` passes the gate, edits the file while it holds `before`, and the `finally` at :176-177 writes `after` over the edit. The API does not promise serial dispatch (claude-code.d.ts:7505 says per-tool hooks "may run concurrently for parallel tool calls"). Acquire the lock inside one `update` (`s.checking ? s : {...s, checking: true}`) and check the returned value; gate Edit/Write the same way. Also add `checkingSinceMs` with an expiry: a hot reload or a thrown error leaves `checking: true` forever, `normalizeStats` preserves it (stats.ts:73), and every edit is denied with "retry in a moment".

3. **Journal repair overwrites hand fixes** (register.tsx:115-126). At the next session start it blindly writes the `after` texts; if the restore failed and the developer fixed the file by hand or pulled, their work is overwritten. Compare the current text with `before` first; otherwise toast and keep the journal.

4. **False "saw red" in brownfield repos** (stats.ts:125-141, register.tsx:372-381). Any failing run flips the current module to RED. `npm test` in a repo with one pre-existing failure is always red, so every cycle "saw red". Parse the FAIL lines (Vitest ` FAIL  tests/x.test.ts`, Jest `FAIL tests/x.test.ts`) and require the module's own test among them; otherwise report "red elsewhere". A `"test": "tsc && vitest run"` script failing on types elsewhere also counts as red via the exit-code fallback (runOutcome.ts:20).

5. **Green by bending the test is reported as a clean cycle.** Red, then the test is edited, then green with no source change: `verifyCatch` returns `unchecked` (register.tsx:137) and the advice says "GREEN, saw red. Now refactor" (advice.ts:49-50). This is the brief's "faked red" case and the cheapest missing signal: flag "test changed after red, code unchanged".

6. **False "caught".** (a) `readWhole` conflates missing with unreadable (register.tsx:91-97); `$.fs.read` rejects files over 4 MiB, so a large existing file gets `before = null` and is counted caught without a run (:152-155). (b) New files are "caught" by construction (:152-155) even when the test never imports them, which is exactly the hollow-test case. Run a real check (rename away, run, restore) or report "unverified: new file". (c) Multi-module cycles: the check reverts every pending change in `s.changes` (:135), runs only the current module's test, and `recordCatch` then clears all changes (stats.ts:214), so module B is never checked and A's "caught" may be B's revert. Key the check per module.

7. **Truncated output becomes a pass.** Claude Code replaces long tool output with a preview ("Output too large... saved to"); the summary line is gone, the fallback is the exit code (runOutcome.ts:20), and `| tail`, `| head` or `|| true` make it 0. Treat "no summary" as unknown, not pass, and detect the truncation banner.

8. **Refactor credit is unverifiable praise** (stats.ts:204, advice.ts:32-34). Once a module is proven, every later edit in the session (and seven days via unlocks) with the test untouched is "REFACTOR": a behaviour change with no new test is praised. Name the fact ("green, test untouched"), do not credit it.

9. **The agent can edit `dope-tdd.json`.** It is outside `src/`, so unguarded; an agent told to hurry will set `mode: observe`. Deny agent writes to it, or at least log an event and toast. Also cap and sanitise config strings echoed into `/tdd` and the status tool (config.ts:88-95), which the model reads.

10. **Shell heuristics.** Splitting on `|` inside quotes drops a deny (shell.ts:8; `sed -i 's/a|b/' src/x.ts`); the guard-correctness note says a wrong split "can only add a false deny", but it can also remove one (the git backstop then counts it unguarded). `PATH_TO_SOURCE` accepts `..` (bashWrites.ts:3), so a crafted path could make the catch check write outside the root; reject `..`.

11. **Real-repo breakage.** Relative shell paths resolve against the session root (register.tsx:83-85) while the Bash cwd persists across calls; `src/` and `tests/` must sit at the root or nothing is seen (monorepo packages are invisible to both the guard and the backstop). `core.autocrlf=true` here: verify `$.fs.read` to `$.fs.write` is byte-faithful, including a BOM, before trusting the read-back at :182. The revert flickers files under any watcher (vite dev server, `tsc --watch`, the IDE), which will surprise people. `$.ui.log` fires at every session start for each deleted remembered test (:431).

## 4. Test strategy

The tests test the right things: behaviours of the pure modules and scenarios on the engine harness, and the live runs found the real bugs. Over-tested: advice sentences asserted verbatim in `advice.test.ts` and again by regex in wiring, catch and band tests, so one wording change breaks three files; band colour assertions couple UI tests to the theme. Missing: anything concurrent; the restore-failed path; `store.set` rejection; unreadable file to "caught"; truncated output; multi-module cycles; CRLF/BOM round trip; PowerShell; and a real-git test (the fake scripts `numstat`, so `--relative` and the mtime stamp are never exercised against git). Add, in order: a command corpus test (real commands harvested from transcripts, a table of expected `isTestRun`/writes/`isRevert`); a small hand-rolled property test for `commandSegments` and `globToRegExp` (no external deps available); a scripted live harness that resets the playground, runs `claude -p ... --plugin-dir`, and asserts on the status tool's text (on demand, not CI); and CI running `claude plugin test .` and `validate` on windows and ubuntu. `guard.test.tsx:21` carries a vestigial helper.

## 5. Product and adoption

A skeptical senior engineer installs for one sentence: "it undoes my change, proves the test fails, restores it in seconds, and tells Claude in the same breath." Lead with the catch check and the honesty entries in DOGFOOD.md, not the guard; blocking is a crowded, mildly resented category. They uninstall on: a false deny on day one (co-located tests, `__tests__`, a monorepo package, `lib/`), the tool writing to their working tree while their editor or watcher is open without an obvious opt-out, a stuck "retry in a moment", the band's volume and brand on a shared screen, and any verdict they can show is wrong. Brownfield: observe, then warn, then enforce by scope is exactly right, but it dies at install if conventions are hard-coded. Team leads: keep the commit receipt idea, hold the team view, as the research says.

Build next: **test-location conventions** (co-located `*.test.ts`, `__tests__/`, custom pairs, per-package roots) with a `/tdd setup` that detects and shows them; without this the brownfield pitch does not survive install. Cut: **Pause**. It is a second code path through eight `paused` branches across register, stats, draw and summary, it hides edits, and your own dogfood says it is the wrong hatch; replace it with a session-scoped `/tdd mode warn` that keeps counting.

## 6. Top 10 recommendations

1. Hook `PowerShell` with `guardBash` — S; the owner's own platform is currently blind.
2. Atomic `checking` lock plus expiry — S; closes the only path to losing a developer's work.
3. Red attributed by FAIL lines, "red elsewhere" otherwise — M; makes "saw red" true in brownfield repos.
4. "Test changed after red / green without code change" signal — S; the brief's faked-red case, cheapest honest win.
5. Conventions config and `/tdd setup` — M; the adoption blocker.
6. Texts out of state, journal as paths plus hashes, repair that compares before writing — M; safety and performance together.
7. No summary means unknown, not pass; detect the truncation banner — S; stops false GREEN on big suites.
8. Per-module catch check and a real new-file check — M; removes two false-"caught" paths.
9. Deny agent edits to `dope-tdd.json`; sanitise echoed config — S; closes the obvious gaming move.
10. Event-normalising refactor of register.tsx, CI on two OSes, a LICENSE, and fix the README install path (README.md:19 points at a folder that does not exist) — M; needed before anyone else clones it.

## 7. Tips

- Every verdict word needs a falsifier: before shipping a word on the band, write the scenario that would make it wrong and the test for it. "Unverified" reasons are your roadmap; count them as bugs.
- Never write to a user's tree without a loud, inspectable trace (event, `/tdd` line, journal) and a per-repo opt-out (`"catchCheck": false`). People will ask, and the answer must already exist.
- Heuristics die by corpus, not by thought. Harvest real agent commands and outputs into fixtures from every live run; your best bugs so far came from one `| tail -30`.
- Pin and record the Claude Code version you tested; toast once at session start when the running version is newer. Early-access APIs move, and silent breakage is worse than a notice.
- Keep the hip-hop in the docs, the name and the playground; the lines the model reads stay dry. You already do this; write the rule down so a contributor keeps it.
- Build the uninstall path first: `/tdd off`, a clean store, nothing left in the repo but the JSON they committed. Easy exit is what lets a skeptic try it.
- Two days, 162 tests, and an honest dogfood log is unusual discipline. Spend the next two days on items 1 to 4 above rather than features, because trust compounds and a false verdict does not.
