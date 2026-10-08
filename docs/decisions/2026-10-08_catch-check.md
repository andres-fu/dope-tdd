# 2026-10-08 — "Catches the change": the test is proven against the change it guards

Supersedes the overnight DRAFT of the same name; the shape is the draft's
recommendation with three simplifications noted below. Amended the same day
by `2026-10-08_honesty-pass.md`: the lock, the journal, new files, shell
edits and the exit-code fallback all changed there.

## What was decided
When a passing run completes a cycle on module M, Red First proves M's test
against the cycle's change:

1. **Capture.** Every Edit or Write to `src/**` while the guard is on keeps,
   per module, the file's text before the first edit of the cycle (`before`,
   or `null` when the file did not exist) and after the latest edit
   (`after`), in session state.
2. **Verify.** At green, if the on-disk text of every changed file still
   equals `after`, the changed files are written back to `before`, only M's
   test file is run (`node node_modules/vitest/vitest.mjs run <test>` or
   `node node_modules/jest/bin/jest.js <test>`, `CI=1`, time budget twice the
   green run plus five seconds, capped at a minute), and the files are
   written back to `after` in a `finally`. Read-back confirms the restore.
3. **Outcomes.** `caught` (the test failed with the change undone), `missed`
   (it still passed), `unverified` with a reason (timeout, no runner found,
   no tests ran, changed outside, restore failed), or `unchecked` (no
   Edit/Write source change in the cycle, for example shell-only edits).
   Counts and the last outcome are in `/tdd`; each outcome is an event.
4. **The agent is told in the same tool result.** Caught: "its test catches
   the change. Now refactor." Missed: "its test does NOT catch the change:
   with your change undone it still passes. Fix the test before moving on."
   A green that never saw red but is caught is called a real test after all.
5. **Safety.** Before the first write a journal (`catch-journal:<root>`, the
   `after` texts) goes to the store; it is deleted after the read-back, and
   `session.start` restores any journal left behind, with a toast. While a
   check runs, Edit, Write and shell writes to source are denied with
   "retry in a moment". New modules (`before` null) count as caught without a
   run. Nothing is ever blocked on the outcome.

## Why
The owner's worry of the day: "it can't tell a good test from a hollow one;
this worries me and we need to address this", and "we don't want it gamed,
we want good code". Saw-red proves the test can fail; the catch check proves
it fails for *this* change. A test edited to pass, a test that asserts
nothing, or a test of the mock all come back `missed`. It is one mutant
(undo the change), the cheapest and most relevant one, run in seconds.

## Simplifications versus the draft
- The runner is found by file (`node_modules/vitest/vitest.mjs`, then
  Jest's bin), run through `node`, so no `npx` wrapper and no shell on
  Windows; no JSON reporter, the summary line parser already in use reads
  the result.
- "No tests ran" covers load errors: Vitest prints `Tests  no tests` when a
  file fails to import.
- Flakiness is not detected; one run.

## Trade-offs accepted
- One extra test-file run per green cycle, synchronous in the Bash hook.
- Full file text per edited module is held in session state for the cycle.
- Shell-made source edits stayed unchecked in this version (captured since
  the shell-edit commit the same day).
- pytest and other runners fall through to "no runner found" until added.
