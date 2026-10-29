# dope-tdd 0.2.11: an unlock stays in its own checkout

0.2.11 closes a guard hole with subagents in their own worktree, cleans up `/tdd`'s event list, and
makes the pull-request check follow `dope-tdd.json`.

## What 0.2.11 changes

- **An unlock counts only in the checkout its test is in.** Unlocks were kept by module name, so
  a test touched in a subagent's worktree unlocked the same module in the main checkout, and the
  main session could edit it with no test of its own. The other way round too. Now a test unlocks
  only its own checkout. When the main session and a subagent work on the same module at once,
  the last test touch holds the unlock and the other is refused until it touches its test again:
  never an edit let through, at worst a test asked for twice (#198; the rest is #227).
- **A stale unlock is logged once.** Every reload, `/clear`, `/resume` or fork logged the same
  stale unlocks again, pushing the events that matter out of `/tdd`'s ten (#182).
- **The pull-request check reads `dope-tdd.json` as the plugin does** (#192):
  - A module in `observe` (by `mode`, or outside `scope`) is not checked.
  - `"catchCheck": false` turns the check off.
  - An experimental runner is checked only with `"catchCheck": true`.
  - Under `warn`, a MISSED is reported but doesn't fail the check.

## What to check

**Step 0: update.** Run `claude plugin update dope-tdd`, then `/reload-plugins`, then `/tdd`. The
first line should say `version 0.2.11`.

**Step 1: no leak between checkouts.** In a repo with `dope-tdd.json` and the tests committed,
have a worktree-isolated subagent touch a module's test. Then, in the main session, try an
untested edit to that module's source. Expect it refused, naming the test.

**Step 2: a quiet event list.** If `/tdd` shows a `stale-unlock` event, run `/reload-plugins` and
`/tdd` again. Expect no second copy of it.

**Step 3 (only if you use the pull-request check): config.** With `"mode": "observe"` in
`dope-tdd.json`, run `node tools/pr-check/check.ts --base origin/main` on a branch. Expect each
module's row to read **UNPROVEN** with `not checked: mode is "observe" in dope-tdd.json`, and the
check to pass.

Paste the exact lines for each step. Anything that doesn't match is a finding.
