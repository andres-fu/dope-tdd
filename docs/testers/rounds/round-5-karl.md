# dope-tdd 0.2.3: reply to round 4, and round 5

Karl, thanks for round 4. It was the most useful run yet, and the verbatim evidence (commands,
hashes, exact messages) made every issue quick to pin down.

**An apology first.** My description of setup in the 0.2.1 reply was wrong: what you ran was main
at that point, not the build I described, so the counts and file names didn't match. The detection
itself was right. To stop that happening again, the version only goes up at release time now, so
**0.2.3 is exactly the build this note describes.**

## What 0.2.3 changes, from your report

- **#134, code brought in by git.** You found the real cause: the `sha256sum` next to your
  `git checkout` made the guard think the command could have written files, so the checkout was
  charged as a guarded edit (`edited api`, and test-first went to 5/5). Reads and hashes next to a git
  command no longer do that.
- **#132, a red where no assertion ran.** Three fixes. A red made only of errors (an import, a
  collection or a compile that broke) now gets its own message instead of "fix the assertion". The
  catch check had the hole you suspected: if undoing a fix made the test fail on an *error*, that
  counted as the test catching it, and the green said PROVEN. Now that's "not checked". And writing
  step 5 below turned up the same hole through a second door: a break that only stopped the test
  from loading, put back afterwards, also read as PROVEN. That's fixed too.
- **N1.** With no config, setup now explains which stack the guard runs as until a config is saved,
  instead of printing `stack node` next to `detected stack: python`.
- **N2.** The start-of-session text now picks its runner from a real test file in your repo, so it
  should say pytest, matching the hints.
- **Setup names the runner:** `/tdd setup` prints a `test command:` line.
- **Wording:** every PROVEN line now starts `GREEN on api: PROVEN.` and then gives the reason, so
  your break-and-restore and the `cp` case read the same way. Durations say `3MIN15S`; cycles say
  `1 never failed, 1 test changed`.

**N3 was a real proof, not a false one.** The `cp` was a write made in the session while `api` was
unlocked, so it was the session's change. Undoing it brings back main's `api.py`, and one of your 8
tests fails on that. So PROVEN was correct. You were right that it was worded differently from the
break-and-restore path, and that's now consistent.

**The workarounds on your record** (three "assertions removed", one "test changed") were the reverts
the test plan required. I'm reading them that way.

## Round 5

**Step 0: update.** Run `claude plugin update dope-tdd`, then `/reload-plugins`, then `/tdd`.
The first line should say `version 0.2.3`. If it doesn't, stop there and tell me what it says.

**Step 1: start-of-session text (N2).** In a fresh session, does the injected instruction say
`python -m pytest <test file>`? Paste the line.

**Step 2: setup with no config (N1 and the runner).** Move `dope-tdd.json` aside, run `/tdd setup`,
and put it back. Expect a `test command: python -m pytest <test file>` line, and
`current dope-tdd.json: none. Until one is saved, the guard runs as node (from the markers at the root), not python`.
Paste the whole output.

**Step 3: #134 again.** With a pin active, run `git checkout main -- api.py` (a `sha256sum` next to it
is fine). Expect the line
`dope-tdd: git checkout brought in code from elsewhere, not guarded: api.py`, and in `/tdd` an event
`brought in by git, not guarded api (git checkout)`. test-first should not go up. Put `api.py` back
afterwards the way you did in round 4.

**Step 4: #134, the restore half (not covered yet by either of us).** Change `api.py` without staging
it, then run `git restore api.py`. Expect no message and no edit charged in `/tdd`. Check the hash
changed back, so we know the restore really ran this time.

**Step 5: #132 on its real path.** This is the one that matters:
1. Unlock `api` the usual way (touch the test).
2. Add `import round5_no_such_module` as the first line of `api.py`, and run the test. Expect a red
   that says `RED on api, but no assertion ran: every failure is an error ...`.
3. Remove that line from `api.py` only (leave the test alone), and run the test again. Expect a green
   that is **not** PROVEN:
   `GREEN on api, saw red. UNPROVEN: not checked (the red was an error, not a failed assertion: no assertion ran).`
   In round 4's build this said PROVEN. It was the door you suspected, just reached from the break side.

Paste the exact lines for each step, as in round 4. Anything that doesn't match is a finding, and
I'll file each one as a GitHub issue so we can track them.
