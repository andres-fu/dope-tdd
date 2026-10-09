# Debt ledger

Known shortcuts and deferred work, one line each, so nothing is lost and
nothing slows the current pass down. Add when you take a shortcut; strike
when you pay it. Source tags: `arch` = the 2026-10-08 architect review,
`review` = the same night's code review, `owner` = the owner's asks,
`live` = a live playground run, `arch2` = the second architect review (2026-10-08),
`docs` = the official plugin and mods docs at code.claude.com.

## Correctness

- [ ] `arch 6` Full file texts live in session state and in the catch journal; the store caps at 4 MiB. Move to content hashes plus blobs (`git hash-object -w` or a plugin temp file).
- [ ] `arch 6b` A new source file is `unverified: new file`. A real check (rename away, run, restore) is possible but is the riskiest write the plugin could make on Windows under an editor or watcher.
- [ ] `arch 4` PASS lines are not read: a whole-suite run where the module's own test passed and another file failed is "red elsewhere", not green for the module.
- [ ] `arch 2` The window between the Edit/Write gate read and the actual write is narrowed (re-read right before the write), not closed; a truly concurrent Edit during a check can still land on a reverted file and be left alone rather than restored.
- [ ] `arch 11` CRLF/BOM round trip through `$.fs.read`/`$.fs.write` is unverified; the revert flickers files under any watcher.
- [ ] `live` The unread-run line assumes the command ran; a held or refused command is now read as "did not run", but the detection is a text match on Claude Code's wording and will need a corpus.
- [ ] `arch2 6` "Unread" is wrong, and repeats, for every runner that is not Vitest or Jest: mocha, node:test and playwright print a summary the reader cannot parse, and skipped-only runs read as unknown. One honest "cannot read this runner" line, said once.
- [ ] `arch2 7` Shell cwd drift: relative paths resolve against the session root while the shell cwd persists, so `cd packages/app && sed -i ... src/x.ts` guards the wrong file.
- [ ] `arch2 5` Pending changes for non-current modules never surface: two modules changed, `npm test` run, only the current one is checked; the other sits in `changes` with no line and no `/tdd` row.
- [ ] `docs` After `/clear`, `$.state` resets to its defaults and `session.start` does not fire again, so remembered unlocks and the repair of an interrupted check wait for the next session. Hook `classic.SessionStart` with `source: 'clear'` and re-seed from the store (mods reference, Session events).
- [ ] `docs` `$.fs.write` is not atomic (mods reference): the catch check's revert and restore can be read half-written by another process. The store is shared by every session on the machine, so the journal keyed by root and module is the right shape, but two sessions in one repo share one lock.

## Product

- [x] `arch 5` Test-location conventions (co-located `*.test.ts`, `__tests__/`, custom pairs, per-package roots) and `/tdd setup`. Paid 2026-10-09 (`docs/decisions/2026-10-08_conventions.md`). Left over: one layout per repo; `{ext}` follows the stack since the stacks pass; this repo could set a custom layout for `hooks/`.
- [x] `owner` Workaround tally: config loosened, pause, test bent, skip/only markers, assertion removed, code commented out. Paid 2026-10-08 (`docs/decisions/2026-10-08_workarounds.md`). Left over: test edits made through the shell have no before-text, so skip and assertion signals come only from Edit and Write.
- [ ] `owner` Function-level story in the catch line: name the function the change touched, from the diff.
- [ ] `owner` Module map: new import edge in an edited file as a signal with a reason; `boundaries` in `dope-tdd.json` for hard rules.
- [ ] `owner` Candidate mechanism: Dope TDD runs the module's own test after each edit, so RED and GREEN come from its own runs rather than from reading the agent's output.
- [ ] `arch 5` Cut Pause in favour of a session-scoped `/tdd mode warn` that keeps counting.
- [ ] `arch` Uninstall path: `/tdd off`, a clean store, nothing left in the repo but the JSON.
- [ ] `arch2 8` No catch-check opt-out: `"catchCheck": false` in `dope-tdd.json` for a repo with a dev server or `tsc --watch` that sees every revert.
- [ ] `arch2 9` REFACTOR on the band is coloured like green; it is a fact about the change, not a verdict on it.
- [ ] `docs` In the VS Code extension's chat panel hooks run but nothing draws (mods overview, Where mods run): the band is invisible there and the tool results, `/tdd` and the status tool are the whole face. Say so in the README, and keep every verdict in the tool result.
- [x] `docs` Publish checklist (plugins/publish): paid 2026-10-08. `version` omitted on purpose so the commit is the version and every push reaches testers (CI validates non-strict for that reason); `license`, `homepage`, `repository` and `keywords` set; LICENSE (MIT); CI on windows and ubuntu; tester brief in `docs/testers.md`. Left over: an eval suite with `claude plugin eval` using the playground planted bugs as cases against a no-plugin baseline, the scripted live harness `arch 4` asks for; it runs only on Linux or WSL2, since a Bash grant needs a sandbox backend.

## Structure and tests

- [ ] `arch 10` Event-normalising refactor of `register.tsx` (`guardShell` does twelve things in sequence); one reducer in `stats.ts`, `verifyCatch` as a separate step.
- [ ] `arch 4` Advice sentences are asserted verbatim in `advice.test.ts` and again by regex in wiring, catch and band tests; one wording change touches three files.
- [ ] `arch 4` No real-git test: the fake scripts `numstat`, so `--relative` and the mtime stamp never run against git.
- [ ] `arch 4` No concurrency test for the lock; covered only by the unit test of its TTL and ownership.
- [ ] `arch 4` A scripted live harness: reset the playground, run `claude -p` with a tool allowlist, assert on the status tool's text. Done by hand so far.
- [ ] `arch 10` CI on windows and ubuntu running `claude plugin test .` and `validate`; a LICENSE.
- [ ] `review` `guard.test.tsx` carries a vestigial helper; `types/index.d.ts` and `hooks/runOutcome.ts` no longer share a `RunOutcome` name but the history type is still a string union.
- [ ] Markdown lint in `docs/decisions/` (blank lines around headings and lists); cosmetic.
- [ ] `arch2 10` Session-start log noise for each remembered test that is gone; config strings echoed unsanitised in `describeConfig`.
- [ ] `docs` A type-check is part of the documented loop (`tsc -p` against the engine-written `.claude-plugin/types`); it is run by hand from a scratch tsconfig and should be in CI next to `claude plugin test` and `validate --strict`.
- [ ] `ci` The suite runs under one Windows-shaped fixture root; the fakes tolerate a POSIX host, but no test runs the plugin against a POSIX root (`/work/...`, no drive letter). Add a second pass or a second root, since the first Linux CI run failed 53 tests on exactly this.
- [x] `owner` Godot support for a vibe-coder tester. Paid 2026-10-08 in part (`docs/decisions/2026-10-08_stacks-and-runners.md`): stacks and runners as tables, gdUnit4 runner row, Godot layouts, stack detection from the root, Python with pytest read from real output. Left over: the gdUnit4 reader is provisional until a real run from the game is on record; a two-bug Godot playground; GUT as a second Godot runner; `/tdd setup` offering observe mode to a newcomer.
- [ ] `owner` Provisional readers (gdUnit4, Maven, Gradle, dotnet) need one real pass and one real fail each on record in `tests/fixtures/runnerOutputs.ts`; CI on ubuntu could install a JDK and the .NET SDK to harvest them.
- [ ] `owner` A truly flat Python `tests/` folder (`tests/test_mod.py` for `pkg/mod.py`) and a flat GUT-style `test/` folder need a lookup built from a survey; today the test folder must mirror the package dirs. Same for C# under Godot and Kotlin under Gradle: rows not yet written.
- [ ] `docs` The catch-check lock (`checking`) lives in `$.state`, which is per session; a second session in the same checkout cannot see it and can edit or run tests on a file while it is reverted. The mods reference says data several sessions change belongs in `$.store`: hold the lock there, keyed by root, with the same expiry. Matters for anyone running several agents in one folder.
- [ ] `owner` Observe mode still runs the catch check and reverts files. Decide: observe = never touch disk (catch check off), warn and enforce = check. Until then the brief says so.
- [x] `live` Store keys carried the raw session root, so two sessions in one folder (`C:\...` and `c:\...`) could not share remembered unlocks or journals. Paid 2026-10-08: `storeRoot()` normalises the root in every key; the raw-root keys of earlier builds are still read for unlocks and journals.
- [x] `live` Tester zero pasted the PowerShell reset commands into Claude and the playground was not reset before the real run, so BLOCKED never fired. Paid 2026-10-08: `npm run reset` in the playground, and the brief and playground README say to run it in a shell, not in Claude.
- [ ] `live` `claude plugin test .` scans every `*.test.ts` under the plugin root, playground included, so a playground run in flight breaks the local gate (it imports vitest, which the kit refuses). CI is unaffected (clean checkout). Either move the playground beside the plugin rather than inside it, or name its tests so the kit does not see them.
- [x] `live` Tester zero, refactor step: the agent misread "touch the test" as "run the test", read the plugin source, and tried a no-op re-save to unlock. Paid 2026-10-08 (`docs/decisions/2026-10-08_red-unlocks.md`): a red on the module's own test unlocks it; the deny names both doors; a test re-saved unchanged is a recorded workaround.
- [ ] `live` A test run in another repository (`cd ../other && npx vitest run`) was read as this project's run and charged to the current module ("GREEN on wiring but it never saw red"). A run whose command changes directory out of the root, or names paths outside it, is not this project's run. Related to shell cwd drift (`arch2 7`).
- [ ] `live` Seen on DungeonLobby: `cd server && npx vitest run src/__tests__/utils/dice.test.ts` resolved the named test against the session root, not `server/`, and read as "red elsewhere" until rerun with the full path. Track the directory a segment runs in (`cd` inside the command) when resolving named test files and shell writes.
- [ ] `owner` Reviewer-side proof: the PR description carries the receipt and two commands a reviewer (or their agent) runs to re-check it. Make that a thing the plugin produces: a `/tdd receipt <module>` that prints the receipt plus the re-check commands for the PR body, and later a CI check that re-runs the catch check on a pull request. Seen on DungeonLobby PR #27, where the maintainer will likely ask his agent whether the PR is good.
- [ ] `live` An interpreter heredoc (`python - <<EOF`) that calls a write function and mentions source-shaped paths of another repository is refused as a write to this repository's modules, because relative paths are resolved against the session root. Correct in spirit, wrong in this case; tied to `arch2 7`.
