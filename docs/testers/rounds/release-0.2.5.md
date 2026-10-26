# dope-tdd 0.2.5: what it tells you while you work, and what to check

0.2.5 is exactly the build this note describes. It adds no new refusals. Everything in it is about
what dope-tdd says while you work and what it keeps afterwards: the failure behind a PROVEN, how long
a run took, a loop that isn't moving, where the last session stopped, and a check on its own records.

## What 0.2.5 changes

- **A PROVEN quotes the failure it saw.** When the catch check undoes the change and the test fails,
  the green line and the receipt now quote that test's first assertion, for example
  ``with the change undone its test fails with `expected 1 to be 2` ``. Works for Vitest,
  node --test and pytest; other runners keep the old wording.
- **Run time on the band.** A run of one named test file shows how long it took on the band's last
  run line (`passed in 4S`). From 30 seconds on it adds `slow for one file`. Each one-file run's time
  is kept in the session log.
- **A stuck signal.** When the same failure on the module you're on comes back three runs in a row,
  Claude is told to step back or say BLOCKED, and again at six runs, nine, and so on. Each spell is
  kept in the session log.
- **Left red on purpose.** If a module is still red when a session ends, the next session in that
  project starts with it: the second line of what Claude is told at the start names the module, the
  failing test, and says to start there. A later session that leaves the module green clears it; a
  session that never touches it leaves it alone. Kept for 7 days.
- **Session records are checked.** A shell command that changes an existing record in
  `~/.dope-tdd/sessions/` is recorded as a workaround (`session log edited`), and Claude is told to
  say why. Each record is now written with a digest of its content, so a hand edit shows. This makes
  casual edits visible; it isn't proof against an agent that reads dope-tdd's code. The pull-request
  check in CI stays the proof.

## What to check

**Step 0: update.** Run `claude plugin update dope-tdd`, then `/reload-plugins`, then `/tdd`. The
first line should say `version 0.2.5`. If it doesn't, stop there and tell us what it says.

**Step 1: the quoted failure (Vitest, node --test or pytest).** Fix a bug test-first as usual: test
fails, change the code, test passes. Expect the green line to read
``dope-tdd: GREEN on <module>: PROVEN. It saw red, and with the change undone its test fails with `<assertion>`.``
with the assertion your test failed on. Check the same text in `/tdd receipt`.

**Step 2: run time.** Run one test file by name. Expect the band's last run line to end with
`passed in <time>` or `failed in <time>`. If you have a test file that takes over 30 seconds, expect
`, slow for one file` after the time. A whole-suite run shows no time.

**Step 3: the stuck signal.** Make a test fail, then run it three times without changing anything.
Expect the third red to add:
``The same failure 3 runs in a row (`<failure>`): this is not moving. Step back and re-read what the test expects, or say BLOCKED and what you need from the user.``
The fourth and fifth reds should not repeat it; the sixth should.

**Step 4: left red.** End a session (`/exit`) with a module's test failing. Start a new session in
the same project and ask Claude what dope-tdd told it at the start. Expect a line beginning
`Left red when an earlier session ended: <module>`. Make that test pass, end the session, start
another: the line should be gone.

**Step 5: record check.** Only if you're comfortable editing a file by hand: ask Claude to change a
number in yesterday's file under `~/.dope-tdd/sessions/` with a shell command. Expect Claude to be told
`dope-tdd: that command changed a session record in ~/.dope-tdd/sessions/ (<file>); only dope-tdd writes those. Recorded as a workaround; say why.`
and `/tdd` to list `session log edited` under the workarounds.

Paste the exact lines for each step. Anything that doesn't match is a finding, and we'll file each
one as a GitHub issue.
