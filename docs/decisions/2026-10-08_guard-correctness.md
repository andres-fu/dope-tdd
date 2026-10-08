# 2026-10-08 — Guard correctness pass (five fixes from the smoke test and live runs)

## What was decided
1. **Shell writes are judged per command segment.** A command is split on
   `&&`, `||`, `;` and `|` (a command with a heredoc stays whole), and the
   write patterns run on each segment. `sed -i` on a test file no longer
   makes a `cat` of a source file in the same line a write. Writing to
   stdout or stderr from a script is a read.
2. **Git commands that rewrite the tree are not edits.** `checkout`,
   `restore`, `stash`, `reset`, `switch`, `revert`, `merge`, `rebase`,
   `pull`, `cherry-pick`, `apply` and `clean` skip the edit accounting. They
   still count as test runs when combined with one (`git stash; npm test`).
3. **The git snapshot carries a file stamp.** Each tracked entry is
   `added/deleted:mtime`, so a shell edit that keeps the same line counts on
   an already-dirty file is still seen.
4. **"Never saw red" is retracted once the pin is proven.** A module whose
   first cycle went green without failing is remembered as unproven. If a
   later run fails on that module with its test untouched (the code was
   broken on purpose, or a real regression), the count goes back down.
   Touching the test again forfeits that: a red after a test change proves
   nothing about the original pin.
5. **Stored state is validated element-wise.** Corrupt events, run outcomes
   and the unproven list are dropped instead of crashing `/tdd` later.

## Why
Items 1 to 3 and 5 are the medium and low findings of the overnight smoke
test that affect real use; false denies are what pushed the guard to "paused"
in dogfooding. Item 4 came from the Walk 2 live run: Claude broke the code on
purpose to prove its pinning test, saw red, restored it, and then had to
explain to the user why the band still said "never saw red". A tool whose
evidence the agent has to explain away loses the agent's trust first.

## Alternatives considered
- Content hashes (`git hash-object`) instead of mtime for the stamp: exact,
  one more process per file; mtime plus the counts is enough for a backstop.
- A declared "pin" intent from the agent: cleaner, but needs a new tool call
  the agent has to remember; proving it by a real red is deterministic.

## Trade-offs accepted
- Segment splitting is naive about quoted operators (`echo "a && b"`); a
  wrong split can only add a false deny, which the git backstop then
  contradicts.
- The revert list is a fixed set of subcommands; an alias or a script that
  wraps git is not recognised.
