# Debt ledger

Known shortcuts and deferred work, one line each, so nothing is lost and
nothing slows the current pass down. Add when you take a shortcut; strike
when you pay it. Source tags: `arch` = the 2026-10-08 architect review,
`review` = the same night's code review, `owner` = the owner's asks,
`live` = a live playground run.

## Correctness

- [ ] `arch 6` Full file texts live in session state and in the catch journal; the store caps at 4 MiB. Move to content hashes plus blobs (`git hash-object -w` or a plugin temp file).
- [ ] `arch 6b` A new source file is `unverified: new file`. A real check (rename away, run, restore) is possible but is the riskiest write the plugin could make on Windows under an editor or watcher.
- [ ] `arch 4` PASS lines are not read: a whole-suite run where the module's own test passed and another file failed is "red elsewhere", not green for the module.
- [ ] `arch 2` The window between the Edit/Write gate read and the actual write is narrowed (re-read right before the write), not closed; a truly concurrent Edit during a check can still land on a reverted file and be left alone rather than restored.
- [ ] `arch 11` CRLF/BOM round trip through `$.fs.read`/`$.fs.write` is unverified; the revert flickers files under any watcher.
- [ ] `live` The unread-run line assumes the command ran; a held or refused command is now read as "did not run", but the detection is a text match on Claude Code's wording and will need a corpus.

## Product

- [ ] `arch 5` Test-location conventions (co-located `*.test.ts`, `__tests__/`, custom pairs, per-package roots) and `/tdd setup`. Adoption blocker; also why this repo's own `hooks/` edits get advice lines that say `src/<module>`.
- [x] `owner` Workaround tally: config loosened, pause, test bent, skip/only markers, assertion removed, code commented out. Paid 2026-10-08 (`docs/decisions/2026-10-08_workarounds.md`). Left over: test edits made through the shell have no before-text, so skip and assertion signals come only from Edit and Write.
- [ ] `owner` Function-level story in the catch line: name the function the change touched, from the diff.
- [ ] `owner` Module map: new import edge in an edited file as a signal with a reason; `boundaries` in `dope-tdd.json` for hard rules.
- [ ] `owner` Candidate mechanism: Dope TDD runs the module's own test after each edit, so RED and GREEN come from its own runs rather than from reading the agent's output.
- [ ] `arch 5` Cut Pause in favour of a session-scoped `/tdd mode warn` that keeps counting.
- [ ] `arch` Uninstall path: `/tdd off`, a clean store, nothing left in the repo but the JSON.

## Structure and tests

- [ ] `arch 10` Event-normalising refactor of `register.tsx` (`guardShell` does twelve things in sequence); one reducer in `stats.ts`, `verifyCatch` as a separate step.
- [ ] `arch 4` Advice sentences are asserted verbatim in `advice.test.ts` and again by regex in wiring, catch and band tests; one wording change touches three files.
- [ ] `arch 4` No real-git test: the fake scripts `numstat`, so `--relative` and the mtime stamp never run against git.
- [ ] `arch 4` No concurrency test for the lock; covered only by the unit test of its TTL and ownership.
- [ ] `arch 4` A scripted live harness: reset the playground, run `claude -p` with a tool allowlist, assert on the status tool's text. Done by hand so far.
- [ ] `arch 10` CI on windows and ubuntu running `claude plugin test .` and `validate`; a LICENSE.
- [ ] `review` `guard.test.tsx` carries a vestigial helper; `types/index.d.ts` and `hooks/runOutcome.ts` no longer share a `RunOutcome` name but the history type is still a string union.
- [ ] Markdown lint in `docs/decisions/` (blank lines around headings and lists); cosmetic.
