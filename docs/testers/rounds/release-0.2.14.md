# dope-tdd 0.2.14: work in a nested worktree counts where it happens

0.2.14 fixes test runs and the catch check in a worktree nested inside the session's folder. The rest
of the release is under the hood: decisions moved out of `register.tsx` with unit tests of their own,
a headless test suite (`npm run live`), and a release that tags itself.

## What 0.2.14 changes

- **Runs and the catch check in a nested worktree** (#250). With the session's folder as the main
  checkout and work happening in `.claude/worktrees/<name>`, a run from inside the worktree read as
  `RED, but not on <module>`, and the catch check said `no tests ran`. Both now use that worktree, as
  edits by full path already did.
- **A run counts only in its own checkout** (#250). A run in the main checkout no longer counts for a
  module whose test and change are in a worktree. It says
  `that run does not count for <module>: its test is in another checkout`.

**Known limit** (#253): dope-tdd knows where a shell is only from the `cd` commands it sees. A session
moved into a worktree with no `cd`, running bare commands, is still read from the session's folder.
Workaround: put the `cd` and the command in one call.

## What to check

**Step 0: update.** From inside your project, run `claude plugin update dope-tdd`, then
`/reload-plugins`, then `/tdd`. The first line should say `version 0.2.14`.

**Step 1: a nested worktree.** In a repo with `dope-tdd.json` and tests committed, run
`git worktree add .claude/worktrees/nested -b nested` and add `.claude/worktrees/` to `.gitignore`.
Ask Claude to break a test in that worktree by its full path, then run
`cd .claude/worktrees/nested && <your test command for that file>`. Expect `RED on <module>`. Have it
fix the code there and run the same command. Expect a green with a verdict, not `no tests ran`.

**Step 2: the other checkout.** In the same session, run that test from the main checkout. Expect
`that run does not count for <module>`.

Paste the exact lines for each step. Anything that doesn't match is a finding.
