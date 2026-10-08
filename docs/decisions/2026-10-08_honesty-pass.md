# 2026-10-08 — Honesty pass: every verdict word gets its falsifier

Response to the principal architect review (`docs/reviews/2026-10-08_architect-review.md`,
items 1 to 4 and 6 to 9) and to the same night's code review of PR #3. The
owner's framing for the pass: words will sometimes be wrong; make every word
carry its story and its context rather than chase never-wrong, and say
"unknown" when that is the truth.

## What was decided

1. **The PowerShell tool is hooked** with the same guard as Bash. On Windows
   that is the shell Claude uses; before this, test runs, shell writes and the
   git backstop were all unseen there. `Set-Content`, `Add-Content` and
   `Out-File` count as writes; a here-string keeps a command whole.
2. **The catch-check lock is taken in one update and expires.** `checking` is
   `{ module, sinceMs } | null`; the check owns the lock only if the returned
   lock is its own, and a lock older than two minutes is a crash, not a check.
   Edit and Write read the lock again right before they write. The whole
   revert-run-restore is wrapped: a failed revert, a failed restore and a
   store that rejects each come back as `unverified` with a reason, the lock
   is released whatever happens, and a file edited by hand while reverted is
   left as it is (the journal keeps the text; a toast says so).
3. **Red is attributed by the runner's FAIL lines.** When the output names
   failed test files and none is the current module's own test, the run is
   "red elsewhere": the suite failed, the module did not see red, its phase
   does not move, the files are named to the agent and in `/tdd`, and the
   band says RED ELSEWHERE. Output that names no file is red for the module,
   as before.
4. **A test edited after red with the code unchanged is called out.** The
   green came from the test, not from a fix. The agent reads it in the same
   result ("if the red was real, put the assertion back and fix the code"),
   `/tdd` counts `test changed`, the band says TEST CHANGED.
5. **No summary means unknown, never a verdict.** The exit-code fallback is
   gone from both the run reader and the catch check. A run with no runner
   summary in its output (a crash before any test, a truncated tool result,
   an empty output) is counted as `unread`, moves no phase, and the agent is
   told how to get a readable result. ANSI colour is stripped before reading.
6. **The catch check is per module.** Only the module whose test ran is
   reverted and checked; another module's change waits for its own green.
   A new file is `unverified: new file` (undoing it would mean deleting it);
   a file that existed but could not be read before the edit is unverified
   with that reason. Neither is "caught" by construction any more.
7. **Journal repair compares before writing.** The journal holds `before` and
   `after`; at session start a file still at `before` gets `after` back, a
   file at `after` needs nothing, and a file that moved since is left alone
   and named in the log.
8. **Edits to `dope-tdd.json` are recorded, not denied.** The change is
   described in words (mode, exempt, scope), logged as an event, toasted to
   the user, and the agent is asked to say why in its reply. Settings may be
   touched; silently is the problem.
9. **Smaller corrections from the code review.** Shell segments are split
   outside quotes only, so `sed -i 's/a/b/;s/c/d/'` is one command; `..` in a
   path is refused; `git apply` is an edit and `git stash list|show` only
   reads; the runner is found by walking up from the project root, so a
   monorepo package is checked; the hollow-test check reads the whole file and
   looks for assertion calls, not the word `assert`; refactor credit became a
   fact ("a refactor, not re-checked"); the band reuses the config the tool
   hooks last read instead of reading the file on every redraw.

## Why
The review's first line: one confidently wrong verdict costs the trust that is
the product, and three of the words on the band could be earned wrongly in a
brownfield repo (saw red by any failure anywhere; a clean cycle by bending the
test; caught by a runner crash or a new file). The owner's answer was not to
make the words infallible but to make each one say what it saw, say unknown
when it did not see, and keep the agent's workarounds on the record.

## Alternatives considered
- Hashes instead of texts in state and the journal (architect item 6, second
  half): still open; the texts stay for now because the compare-before-repair
  closes the work-loss path and a 4 MiB file is already reported, not
  snapshotted.
- A real new-file check (rename away, run, restore): deferred; a delete and
  recreate on Windows under an editor or a watcher is the riskiest write the
  plugin could make, and "unverified: new file" is honest.
- Denying edits to the config file: rejected; the owner wants the agent able
  to touch settings, visibly.

## Trade-offs accepted
- Red elsewhere depends on the runner naming the failed files; Vitest and Jest
  do. A runner that does not is red for the module, as before.
- A whole-suite run where the module's own test passed and another file
  failed is "red elsewhere", not green for the module: PASS lines are not read
  yet.
- Test-changed-after-red fires when the module's code did not change in the
  cycle; a legitimate test fix after a mistaken red gets the same line, which
  is why the line says "if the red was real".
- Deferred to its own pass: the workaround tally (config loosened, pause,
  test bent, skip markers, assertion removed, code commented out) and the
  function-level story in the catch line.
