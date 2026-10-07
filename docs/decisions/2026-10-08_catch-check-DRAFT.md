# 2026-10-08 — "Catches the change" check (DRAFT, awaiting sign-off)

Status: DRAFT written overnight. Nothing here is implemented. Phase 1 only.

## What was decided (proposed)

After a cycle reaches GREEN on a module whose source was edited through
Edit/Write, Red First temporarily puts the module's source file back to the
text it had before this cycle's edits, runs only that module's mirrored test,
expects it to fail, and restores the file. The result is one of
**caught**, **not caught** or **inconclusive (reason)**, attached to the cycle
and shown on the band, in `/tdd`, and later on the evidence card.

Recommended shape, in one paragraph: the mod already sees every Edit/Write to
`src/**` and already knows the module → test mapping. In the Edit/Write hook
it keeps, per module, the file text from just before the first source edit of
the open cycle (`before`) and the text after the last edit (`after`), in
`$.state` plus a journal in `$.store`. When the next test run passes, the
Bash hook that recorded the pass writes `before` to the file with
`$.fs.write`, runs the mirrored test with `$.process.run` under a time budget,
writes `after` back in a `finally`, verifies the restore by re-reading the
file, and only then clears the journal. No git command touches the working
tree. Shell-made edits (the git-diff backstop) have no `before` text and are
reported as **unchecked** in the MVP.

## Why

The product's core value is verified evidence per change: "saw red" is already
tracked; "catches the change" is the second half and the one that exposes a
test that passes for the wrong reason (asserts nothing, tests the mock, was
edited to pass). It is a one-mutant mutation test whose mutant is "undo the
change", which is the cheapest mutant with the highest relevance.

## Alternatives considered

### A. Revert granularity

| Option | How | Restore guarantee | Verdict |
| --- | --- | --- | --- |
| A1 `git stash` / `git stash push -- <file>` | Stash, run, `stash pop` | Weak: pop can conflict; a crash leaves work in the stash list, invisible to the person; touches every dirty file unless pathspec'd; untracked new files need `-u` | Reject |
| A2 `git apply -R` on the cycle's diff | Capture `git diff -- <file>` at GREEN, apply in reverse, run, apply forward | Medium: fails if the diff does not apply cleanly (file changed outside the session); still needs the forward patch kept somewhere crash-safe; cannot revert a new file without deleting it | Fallback only |
| A3 In-memory copy (whole file, per module) | Hook keeps `before`/`after` text; `$.fs.write(before)`, run, `$.fs.write(after)` | Strong: the restore is a plain write of text the mod holds; journaled in `$.store` so a crash is repaired on next `session.start`; verified by read-back | **Recommend** |
| A4 Hunk-level | Revert each hunk separately and run per hunk | Most informative, N runs per cycle, and hunks are not units of behaviour | Later, if ever |

Whole-file is enough because a cycle is meant to be a small batch; a cycle
that touched three source files reverts all three together and runs once
("the change" is the cycle's change set). Per-file results can come later.

Restore guarantee, in order of defence: (1) `try/finally` around the run,
(2) the `after` text is in `$.store` under `catch.journal` before the first
write and removed after the read-back matches, (3) `session.start` checks the
journal and restores any entry left behind, with a toast, (4) if a restore
write fails the mod toasts, logs the path and the journal key, and sets the
cycle outcome to inconclusive (restore failed) so the band shows it in ember
until `/tdd` confirms; it never retries silently. The developer's text is
never only on disk while a check runs.

### B. Outcomes and how each is shown

| Outcome | Rule | Band | Event log |
| --- | --- | --- | --- |
| caught | Test ran, at least one case failed | `■ GREEN · CAUGHT` in pass green | `caught utils/x` |
| caught (new module) | `before` is "file absent": the test cannot even import it; no run needed | same, with `(new)` in /tdd | `caught utils/x new` |
| not caught | Test ran, every case passed with the change undone | `■ GREEN · NOT CAUGHT` in the paused amber, advisory, never blocking | `missed utils/x` |
| inconclusive: load error | Runner exited non-zero but ran zero cases (syntax/type/import error from the reverted text) | dim `UNVERIFIED (load error)` | `unverified utils/x load` |
| inconclusive: timeout | Over the budget; process killed by `$.process.run` | dim `UNVERIFIED (timeout)` | `unverified ... timeout` |
| inconclusive: runner crash | Command could not start or exit without a result file | dim `UNVERIFIED (runner)` | |
| inconclusive: file moved | On-disk text at GREEN differs from `after` (edited in the IDE) or the file is gone | dim `UNVERIFIED (changed outside)` | |
| unchecked | Edits came through the shell; no `before` text | dim `UNCHECKED` | |

"Flaky" is not detected in the MVP: the check runs the reverted test once.
A test that fails with the change undone and passed with it is treated as
caught even if it is flaky; the cost of a third run to prove stability is not
worth it yet. `/tdd` prints the stdout tail of an inconclusive run so the
person can judge.

### C. Running only the affected test

- Vitest: `npx vitest run <testPath> --reporter=json --outputFile=<tmp>`;
  `-t "<name>"` narrows to one case but the MVP runs the file. Verified in
  the Vitest CLI guide (github.com/vitest-dev/vitest, docs/guide/cli.md).
- Jest: `npx jest <testPath> --json --outputFile=<tmp> --ci`; same `-t`.
  Verified in docs/CLI.md of github.com/jestjs/jest.
- pytest (later): `pytest tests/test_x.py -p no:cacheprovider --junitxml=<tmp>`;
  needs a different mirror rule (`tests/test_x.py` for `src/x.py`) and
  junit parsing instead of JSON. Not for the MVP.
- The runner command is a plugin option (`userConfig.runner`, default
  detected from `package.json` devDependencies: vitest, else jest), so the
  mod never guesses from Claude's shell command.
- JSON output distinguishes "ran and failed" from "could not load":
  Vitest's `numTotalTests`/`numFailedTestSuites`, Jest's `numRuntimeErrorTestSuites`.
  Zero tests executed = inconclusive (load error).
- Time budget: `min(2 × duration of the green run + 5 s, 60 s)`, measured
  from the Bash hook's clock around the passing run; `timeoutMs` on
  `$.process.run` enforces it (hard cap ten minutes in the API). Over budget
  is inconclusive and never retried automatically.
- Where it runs: synchronously inside the Bash hook that recorded the pass,
  before the tool result returns to the model. This adds one test-file run to
  that tool call (seconds on throughline) and removes the concurrency
  problem for the MVP. Async off the critical path is the obvious v2; it
  needs the lock below either way.
- Concurrency: while a check holds the file, the Edit/Write/Bash hooks see a
  `checking` flag in `$.state` and deny with "red-first is verifying
  <module>; retry in a moment". Parallel tool calls are the reason even the
  synchronous version needs the flag. The flag is cleared in the same
  `finally` as the restore.
- Environment: `$.process.run` gets `cwd: root`, `env: { CI: '1' }` so
  watch mode never starts, and stdout/stderr are capped by the API at 4 MiB.

### D. What the mod must never do

- Write outside `$.session.root()`; only the files in the cycle's change set,
  all under `src/`, all with a `before`/`after` pair held by the mod.
- Run `git stash`, `git checkout`, `git reset` or anything that touches other
  dirty files. The in-memory approach is indifferent to a dirty tree in
  unrelated files, which is why it is chosen; a dirty tree is not a reason to
  skip the check.
- Start a check when the on-disk text differs from `after` (the person is
  editing in another tool), when the guard is paused, or when another check
  is running.
- Delete a journal entry before the read-back matches `after`.
- Block anything on the outcome. "Not caught" is advisory, like the cheat
  detectors.
- Run a test command the person did not configure or that was not detected
  from `package.json`.

### E. Tests written first (red before any code)

Pure modules, `tests/catchPlan.test.ts` and `tests/catchOutcome.test.ts`:

1. `planCatch(stats, snapshots)` returns the change set and test path for the
   module that just went green; returns `{ skip: 'unchecked' }` when the
   cycle only has shell edits; `{ skip: 'paused' }` when paused.
2. `classifyCatch(result)` maps a parsed JSON report to caught / not caught /
   inconclusive(load error) / inconclusive(runner) and a rejected run to
   inconclusive(timeout).
3. `recordCatch(stats, outcome, nowMs)` appends the event and marks the cycle.

Wiring, `tests/catch.test.tsx`, on the fake engine (which needs `fs.write`
and `fs.read` answered from an in-memory map and a `process.run` that records
argv and returns a canned report):

4. Touch test → edit source → run pass: `fs.write` is called with the before
   text, then `process.run` with the test path, then `fs.write` with the
   after text, in that order; the final on-disk text equals `after`.
5. When `process.run` rejects, the after text is still written last and the
   outcome is inconclusive (timeout).
6. When the file on disk is not `after` at GREEN, nothing is written and the
   outcome is inconclusive (changed outside).
7. A `Write` to a new source file: no run; outcome caught (new module).
8. An `Edit` arriving while a check runs is denied with the verifying message.
9. `session.start` with a journal entry left in `$.store` rewrites the file
   and toasts.
10. Band shows `CAUGHT` / `NOT CAUGHT`; `/tdd` lists the receipt line.

Mod API used: `$.fs.read`, `$.fs.write`, `$.fs.stat`, `$.process.run`
(`cwd`, `env`, `timeoutMs`), `$.state` for the per-session change set,
`$.store` for the crash journal, `$.ui.toast`, `$.session.root`. All exist in
the 2.1.292 API types; `fs.write` is not yet called anywhere in the mod, so
`claude plugin validate` will list it as a new call.

### F. Versus changed-line mutation testing

Stryker (JS) has `incremental` mode with a results file and a `mutate` file
list, but no "since commit" option in its configuration docs (checked at
github.com/stryker-mutator/stryker-js, docs/configuration.md); mutating only
the changed files is a glob the caller must build. A Stryker run on even one
file generates many mutants and takes minutes, which is the wrong loop for a
per-cycle check but the right tool for a weekly or CI check of test strength
(Thoughtworks Radar Vol. 34 moved mutation testing to Trial as "the most
honest signal" against "perpetually green" AI tests). Tautest could not be
verified from this sandbox. Recommendation: the catch check in the loop
(seconds, one mutant, every cycle); recommend Stryker incremental in CI for
teams that want breadth, and say so in the README rather than build it.

## Trade-offs accepted

- Whole-file revert over hunks: less precise, one run per cycle.
- Synchronous in the Bash hook: each green run gets slower by one test-file
  run; accepted for the MVP to avoid an async scheduler.
- Shell-made edits are unchecked in the MVP; the pre-call snapshot would need
  full-text copies of every modified `src/` file around each Bash call.
- One run, no flakiness detection.
- JSON reporters only (Vitest, Jest); pytest later.
- Open questions for the owner are in `overnight/2026-10-07-report.md`.
