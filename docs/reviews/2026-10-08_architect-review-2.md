# 2026-10-08 — Principal architect review, second pass (external agent, read-only)

Requested by the owner after the honesty pass. Reviewed branch `main` at
95d656f (PRs #2 and #3 merged) in an isolated worktree: 230/230 tests,
validation passing, Claude Code 2.1.292 on Windows. Reproduced verbatim; the
owner's responses go in `docs/decisions/`, `docs/debt.md` and `DOGFOOD.md`.

---

## 1. Verdict

Yes: the honesty pass is what the previous review asked for in items 1–4 and 6–9, and it is real work, not a doc-only answer. Each claim has code and a falsifier test; the exit-code fallback is gone from both readers; the lock is taken in one update; 230 tests pass and `claude plugin validate` is clean. The second live run (DOGFOOD row 26) produced `caught 1` on real Vitest output with the fallback gone, which is the evidence that matters. The single biggest risk now is structural rather than any one word: the band's words are per module, but `sawRed`, `testChangedAfterRed`, `phase` and `cycleStartMs` are cycle-global (stats.ts:19-21, :133, :268), so the two words this pass added, TEST CHANGED and REFACTOR-not-re-checked, can be minted for a module that never saw red, and a source change the git backstop saw but the text capture did not gets no catch word at all (register.tsx:235-237, pinned as silence by catch.test.tsx:92-105). Close behind: the CRLF round trip on the owner's own platform is still unverified and would silently disable the headline feature.

## 2. Claims checked

**PowerShell hooked — CONFIRMED.** register.tsx:660-662 routes `PowerShell` through `guardShell`; bashWrites.ts:7 counts `Set-Content|Add-Content|Out-File`; shell.ts:1 keeps a here-string whole. Pinned by wiring.test.tsx:160-192 and shell.test.ts:27-32. Caveat: the SDK typings are not on disk, so `e.command` is confirmed by the validator and the live run, not by reading the `.d.ts`. `Copy-Item`, `Move-Item`, `New-Item`, `[IO.File]::WriteAllText` and the `sc` alias are not predicted writes; they fall to the backstop (see §3 item 2).

**Atomic expiring lock, wrapped revert/restore, left alone if moved — CONFIRMED, with two ordering holes.** stats.ts:7 TTL, :281-292 acquire/release; register.tsx:260-264 acquires in one `change` and checks ownership by module+time; :269-298 try/finally releases whatever happens; :286-295 compares on disk with `before` and leaves a moved file; :357-360 re-reads the lock right before Edit/Write. Pinned by stats.test.ts:194-214 and catch.test.tsx:225-304. Holes: the journal is written *before* the lock (:255 then :260) and is a single per-root slot, so a contested second check overwrites the first check's journal and then `forget`s it at :262 — the running check is now unjournaled; and the shell gate at :476 uses `current` read at :459, not a re-read, and only gates when the command is a predicted write. No test pins contention end to end (ledger admits it).

**Red by FAIL lines / red elsewhere — CONFIRMED.** runOutcome.ts:8, :39-44; register.tsx:446-451, :538-543; stats.ts:150-161; advice.ts:41-46; draw.tsx:78; summary.ts:23. Pinned by wiring.test.tsx:218-246, stats.test.ts:88-104, runOutcome.test.ts:68-84, advice.test.ts:47-64. Trade-offs as documented (PASS lines unread, runners that do not name files).

**Test changed after red — CONFIRMED as coded, but computed from cycle-global flags.** stats.ts:133 sets the flag on any touch after any red; register.tsx:549 fires it when `verifyCatch` returned `'unchecked'`, i.e. no captured change for the module. Pinned by wiring.test.tsx:287-319, stats.test.ts:106-122, advice.test.ts:66-76. See §3 items 1 and 2 for the two false-positive paths.

**No summary = unknown; never-ran — CONFIRMED / PARTIAL.** runOutcome.ts:22-36 has no exit-code path; catchCheck.ts:17-36 neither; register.tsx:527-533 counts `unread`. Pinned by runOutcome.test.ts:56-60, catch.test.tsx:53-64, catchCheck.test.ts:36-42, wiring.test.tsx:248-284. Never-ran is PARTIAL: register.tsx:528 requires `result.isError === true` *and* a wording match (runOutcome.ts:11); the dogfood run that motivated it is not in the fixture corpus, and if the host returns the hold as a non-error result the fix does not fire. Pinned only with `bashFails = true` (wiring.test.tsx:262-274).

**Per-module catch check; new/unreadable = unverified — CONFIRMED / PARTIAL.** register.tsx:233-247 reverts only the current module; stats.ts:295-310 clears only that module; catch.test.tsx:193-223 and stats.test.ts:362-368 pin it. New file: catch.test.tsx:78-90. Unreadable is PARTIAL: the reason at register.tsx:242 is reached only when the file was unreadable *before* and readable *after*. The common case (file over the read limit both times) hits :379-384, records no change, returns `'unchecked'` and says "GREEN, saw red. Now refactor" with no "could not verify" — catch.test.tsx:92-105 pins that silence as correct. No test drives `readFile` → `'unreadable'` through to the advice line.

**Journal compare-before-repair — CONFIRMED.** register.tsx:185-217; catch.test.tsx:268-303. Caveat: :209 forgets the journal even for files left alone, so the only copy of the agent's `after` text is dropped and the log names only the path. Repair runs only at `session.start`; a hot reload mid-check leaves a reverted file until the next session.

**Config edits recorded — CONFIRMED for Edit/Write, NOT for the shell.** register.tsx:338, :368-376; config.ts:107-115; wiring.test.tsx:321-346. `echo '{"mode":"observe"}' > dope-tdd.json` or `Set-Content dope-tdd.json ...` is invisible: `WATCHED_DIRS` (:53) is `src`/`tests` and `guardShell` never diffs the config. Sanitising echoed config strings (previous item 9, second half) was not done.

**Smaller corrections — CONFIRMED, one partial.** Quote-aware split shell.ts:7-50 (shell.test.ts); `..` refused bashWrites.ts:13-17 (bashWrites.test.ts:72-75); `git apply`/`stash list|show` gitChanges.ts:6 (gitChanges.test.ts:51-56); runner walk-up register.tsx:149-158 (catch.test.tsx:307-317); hollow check reads whole file register.tsx:400-401, unlocks.ts:6 (wiring.test.tsx:438-445); cached config register.tsx:65, :103-105, :672. Refactor-as-fact is PARTIAL: advice.ts:60 says "not re-checked" but draw.tsx:61 and :118 still paint REFACTOR in `ACCENT.pass`; the colour credits what the words refuse to.

## 3. New risks introduced by the pass

1. **False TEST CHANGED across modules.** A is red (`sawRed` true). Agent touches B's test to pin behaviour (stats.ts:133 sets `testChangedAfterRed`), runs B's test, green. `passedModule` is B, `changes[B]` is empty so `verifyCatch` is `'unchecked'`, and register.tsx:549 fires: "GREEN on B, saw red, but the test changed after red and src/B did not." B never saw red; A did. B's green also closes A's cycle (stats.ts:183-200) with `lastCycle = {B, sawRed: true}`, so the band shows B SAW RED and TEST CHANGED.

2. **Backstop-seen, uncaptured source change gets no catch word, and can trigger false TEST CHANGED.** `git apply fix.patch`, PowerShell `Copy-Item`, `npx prettier --write`: the numstat diff records a source edit (register.tsx:507-510) but `textsBefore` only covers predicted writes (:463-467, :484), so no `recordChange`. At green the check is `'unchecked'` and the agent reads "GREEN, saw red. Now refactor" with no verdict; if the test was also edited after red, item 1's line fires with "src/X did not [change]" when it did.

3. **False REFACTOR on an inherited unlock.** stats.ts:268: `kindNow = phase === 'green' && !unproven.includes(module) ? 'refactor' : 'fix'`. Day two, B is unlocked from yesterday (register.tsx:599-612). Agent takes A to green, then edits src/B under the inherited unlock and runs B's test, green first try. `changes[B].kind` is `'refactor'` because the *global* phase was green and B was never in `unproven`; verifyCatch returns `'refactor'` (:238-240); no revert, no NEVER SAW RED (no cycle was open), and the agent reads "a refactor, not re-checked." An untested behaviour change on the brownfield path the product exists for.

4. **Contested lock clobbers the running check's journal** (register.tsx:255 before :260, then :262). Two parallel test runs for different modules: the loser deletes the winner's journal. If the winner then dies between revert and restore there is nothing to repair.

5. **Never-ran depends on `isError` plus wording** (register.tsx:528, runOutcome.ts:11). When the host's hold text changes or arrives as a plain result, the held command is counted `unread` and the agent is told to pipe through tail, the exact confusion DOGFOOD row 26 recorded.

6. **"Unread" is wrong, and repeats, for every runner that is not Vitest/Jest.** `npm test` on mocha, node:test or playwright prints a summary the reader cannot parse; every run becomes `unread` with "its summary line was not in the output" (advice.ts:34), which is false, and the suggested `tail -40` cannot help. Skipped-only runs (`Tests 2 skipped (2)`) also read as unknown.

7. **"Timeout" mislabels every runner failure.** register.tsx:279-281 maps any `$.process.run` rejection (ENOENT `node`, spawn refused) to `unverified: timeout`.

8. **Shell test run during a check reads a reverted file.** The gate at :476 only fires for predicted writes, so a parallel `npx vitest run tests/b.test.ts` while A is reverted can mint a spurious red (or red elsewhere) for B.

## 4. Remaining risks, ranked

1. **Conventions hard-coded** (mirror.ts:1-2, register.tsx:53): co-located `*.test.ts`, `__tests__/`, `spec`, per-package roots are all "other". Every edit denied, nothing can unlock; the first minute in most repos. Ledger `arch 5`.
2. **CRLF/BOM round trip unverified** (register.tsx:245, :287). If `$.fs.read`/`write` normalise, `readWhole !== after` is always true and every check is `changed outside`; or the restore writes LF into a CRLF file and the whole file shows as changed in git. The playground that produced `caught 1` may be LF-only. Ledger `arch 11`.
3. **Gating hooks can throw out.** The validator flags all five; `rememberUnlock` (:91-95, called at :399 and :520) calls `$.store.set` outside any try, and `change()` can reject. Whether the host then denies the call or lets it through unobserved is undefined either way.
4. **Hot reload mid-check** leaves a file reverted with no repair until the next `session.start` (:629); the lock expires in two minutes (:7) and the agent edits the reverted text; next session the journal is `left alone` and forgotten (:209).
5. **Pending changes for non-current modules never surface.** Two modules changed, `npm test` run: only `current` is checked (:546-547); the other sits in `changes` with no line, no `/tdd` row, until its test is touched again.
6. **Full texts in state and journal** (types/index.d.ts:28, :69); every `change()` including the minute tick (:621-627) serialises them. Ledger `arch 6`.
7. **Shell cwd drift**: relative paths resolve against the session root (:111-113) while the shell cwd persists; `cd packages/app && sed -i ... src/x.ts` guards the wrong file and the backstop classifies `packages/app/src/x.ts` as other.
8. **No catch-check opt-out.** config.ts:4-9 has mode/scope/exempt only; the previous review's `"catchCheck": false` is not implemented, so a vite dev server or `tsc --watch` sees every revert and there is no answer when someone asks.
9. **Refactor credit on the band** (draw.tsx:61, :118) and the sticky-`'fix'` rule (stats.ts:269) are fine; the global-phase input to it (item 3 above) is not.
10. **Session-start log noise** for each remembered test that is gone (:576 via :605); **config strings echoed unsanitised** (config.ts:88-95); **Pause** still eight branches and the dogfood says it is the wrong hatch. Ledger.

## 5. Test strategy

What is pinned well: every verdict word in `/tdd why` (band.test.tsx:256-282); the revert-safety matrix (catch.test.tsx:225-304) including a hand edit *during* the check via `onCatchRun`; the reader's no-fallback rule in three places; the lock's TTL and contention at unit level; per-module check; red elsewhere at reducer, advice, wiring and band levels. `tests/engine.tsx` is a good fake: it tracks writes, toasts, logs and git calls, and `writeFails`/`onCatchRun` make failure injection cheap.

Over-pinned: sixteen advice sentences asserted verbatim in advice.test.ts (lines 11-148) and again by regex in wiring.test.tsx (:230, :259, :298), catch.test.tsx (:24-136) and band.test.tsx; eight colour assertions couple band tests to `theme.ts` (band.test.tsx:63-64, :72, :77, :89, :102, :113, :123, :136); guard.test.tsx:21 still carries `answerAsEngine(on, _bashFails)`. Keep one verbatim test per sentence in advice.test.ts and assert on event kinds or `/tdd` counts elsewhere.

Missing, in priority order:
1. A red, B touched then green: expect no TEST CHANGED on B and A's cycle still open.
2. Inherited unlock, global green, first edit to B goes green: expect a catch check (or NEVER SAW RED), not `refactor`.
3. `git apply` / `Copy-Item` source change then green: expect `unverified: change not captured`, not silence; with a test edit after red, expect no TEST CHANGED.
4. Two concurrent checks (make `onCatchRun` async and start a second `runBash` inside it): expect the first journal to survive and the loser to be `unverified: another check was running`.
5. `readFile` → `'unreadable'` (fs.read denies, fs.exists true) end to end; and unreadable-after → an unverified line, not the plain refactor line.
6. Hold text with `isError` undefined: decide and pin.
7. Skipped-only summary → not `unread`; mocha/node:test `npm test` → one honest "cannot read this runner" line, not repeated.
8. Journal present with no `session.start` (simulate reload): repair on the next tool call.
9. Shell write to `dope-tdd.json` → config event.
10. Corpus tests: real commands and real Vitest/Jest outputs harvested from DOGFOOD runs (the `❯ file [ file ]` bracket form, Jest `●` blocks, Windows paths, coloured output) as a table.
11. A CRLF+BOM file through the real `$.fs` in the scripted live harness; a real-git numstat run. Both ledger items.

## 6. Product and adoption

Day one, a skeptical senior engineer on a Vitest repo with `tests/` mirroring `src/` sees something no linter does: the band flips to CAUGHT in a few seconds after a green, the tool result tells Claude the same thing, and `/tdd why` explains every word. DOGFOOD rows 21 and 26 are two live runs where that happened honestly, including the lines reaching Claude and Claude acting on them. That is the demo, and it is real.

On any other repo the same engineer sees, in order: a deny on the first edit because their tests are co-located (§4 item 1); `unread` on every `npm test` because the runner is mocha (§3 item 6); their vite window flashing when the check reverts a file with no opt-out (§4 item 8); and if they look closely, a REFACTOR or TEST CHANGED on the wrong module (§3 items 1 and 3). Any one of these ends the trial, and three of them are visible in the first ten minutes.

"Lead with the catch check" is still the right pitch, now with evidence behind it, but only once the catch check cannot say a wrong word for the wrong module and the install does not die on conventions. Lead with it in the README and the playground; gate the public pitch on recommendations 1–5 below. The honesty entries in DOGFOOD.md are a stronger trust signal than any feature; keep that log public.

## 7. Top 10 recommendations

1. **Per-module red/test-changed/proven state** — M. Replace cycle-global `sawRed`/`testChangedAfterRed`/phase-for-kind with a per-module record `{sawRed, testTouchedAfterRed, proven}`; fixes §3 items 1 and 3 at the source. Add to the ledger; pay first.
2. **"Unverified: change not captured"** — S. When `recordSourceEdit` ran for the module this cycle but `changes[module]` is empty, return that reason instead of `'unchecked'`; closes §3 item 2 and makes the silent path honest.
3. **Lock before journal, journal per module, keep the text you leave behind** — S. Reorder register.tsx:255/:260, key the journal by module, and when a file is left alone copy its `after` to a side file named in the toast. Pays ledger `arch 2` in spirit.
4. **Repair on the next tool call and catch every gating hook** — S. Run `repairInterruptedCheck` when a journal exists and the lock is expired; wrap `guardShell`/`guardFileWrite` so an internal error logs, toasts once, and lets the call through.
5. **CRLF/BOM live check** — S. Put a CRLF file with a BOM in the playground and run the catch check on it; pay ledger `arch 11` now because it can zero the headline feature on Windows.
6. **Honest unread** — S. Name the runners the reader understands, say "could not read this runner's summary" instead of "not in the output", treat skipped-only as "no tests ran", and repeat the line once per session. Pays ledger `live` and §3 item 7 (map spawn errors to their message, not `timeout`).
7. **Catch-check opt-out and visibility** — S. `"catchCheck": false` in dope-tdd.json; at every green, name any other module with an unchecked pending change; list them in `/tdd`.
8. **Watch dope-tdd.json through the shell too** — S. Add it to the post-command diff; a shell write is the move an agent in a hurry makes.
9. **Conventions and `/tdd setup`** — M. Ledger `arch 5`; the adoption gate. Default to `warn` and say so when no `tests/` directory exists at install.
10. **CI on windows and ubuntu, LICENSE, uninstall path** — M. Ledger; do after 1–8.

Leave for now: texts → hashes (`arch 6`; the compare-before-repair holds), the event refactor (`arch 10`; do it when `guardShell` gains its next branch, not before), a real new-file check (`arch 6b`; "unverified: new file" is honest), cutting Pause (do it with recommendation 9), markdown lint.

## 8. Tips

- Every verdict word now has a falsifier for *its own* module; write the cross-module falsifier next ("A red, B green") for each word before adding another word.
- Harvest fixtures from the dogfood runs the day they happen: the hold text, the Vitest bracket form, a Windows path with a drive letter; `runOutcome.test.ts` should read like a corpus, not a spec.
- When a check cannot be run, prefer a specific reason over a generic one; "timeout" for ENOENT will cost trust the first time someone reads the log.
- The band's colour is a verdict too: UNVERIFIED is dim and REFACTOR is green today; make the palette match the sentences.
- Keep the journal's `after` text somewhere until a human has seen it; the one case the repair exists for is the case it currently forgets.
- The validator's "gating hook without .catch" is a finding, not noise; treat it as a failing check.
- Hold the public pitch until recommendations 1–5 land; the honesty log is the asset, and one wrong REFACTOR on a stranger's repo spends it.
