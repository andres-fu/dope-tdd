# dope-tdd 0.2.6: subagents in worktrees, a spike skill, and a shorter README

0.2.6 is exactly the build this note describes. Its main change is a gap closed: until now, a
subagent working in its own git worktree could edit untested code with no word from dope-tdd. It also
adds the `/dope-tdd:spike` skill, fixes three bugs, and splits the README into a short page plus
reference docs.

## What 0.2.6 changes

- **Subagents in their own worktree are guarded.** A subagent started with `isolation: "worktree"`
  works in `.claude/worktrees/<name>/`. Its Edit and Write calls, and shell writes that name a path
  there, are now refused and unlocked like the main checkout's. Once it has read, searched or edited a
  file in its worktree, its shell commands, the git check after them and its catch check run in that
  worktree, with that worktree's `dope-tdd.json` (#198). Not yet: all agents in a session share one
  module and one set of unlocks.
- **`/dope-tdd:spike <question>`.** For exploring before you know what to test: the agent works in a
  throwaway worktree outside the project (`~/.dope-tdd/spikes/`), writes down what it learned and the
  first failing test, removes the copy, then rebuilds in the project test-first. No approval needed.
- **A thinned red is read.** A `node --test` run filtered to its pass and fail lines (`| grep`) used to
  count as nothing; a failure count alone is now a red (#183).
- **A nested package's tests can be proven.** When tests run from a subfolder with its own
  `node_modules` (`site/node_modules`), the catch check links it into its throwaway copy, so the check
  runs instead of ending UNPROVEN (#168).
- **The pull-request check action passes its inputs safely.** Its `base`, `fail-on` and `timeout-ms`
  inputs reach the shell as environment variables instead of being pasted into the script (#191).
  Pin the action to `@v0.2.6` from now on (see `docs/pr-check.md`).
- **Docs.** The README is now about 190 lines, with reference docs under `docs/`. Claims were checked
  against the code and corrected, a security policy was added, and the plugin has a listing icon.

## What to check

**Step 0: update.** Run `claude plugin update dope-tdd`, then `/reload-plugins`, then `/tdd`. The
first line should say `version 0.2.6`. If it doesn't, stop there and tell us what it says.

**Step 1: a subagent in a worktree.** In a project with an untested source file, ask Claude:
"Start a subagent with worktree isolation. Have it read src/<file>, then try to edit it without
writing a test, and report exactly what it was told." Expect the edit refused with
`dope-tdd: write the failing test first. Touch <test path>, …` naming the test in that worktree.

**Step 2: a spike.** Ask Claude: "Use /dope-tdd:spike to find out <something you don't know about a
library you use>." Expect it to work in a copy under `~/.dope-tdd/spikes/`, report what it learned and
a first failing test, remove the copy, and `/tdd` to list the spike with its question.

**Step 3: a fix as usual.** Fix one bug test-first and expect PROVEN, as in 0.2.5. Anything that
reads differently from 0.2.5 is a finding.

Paste the exact lines for each step. Anything that doesn't match is a finding, and we'll file each
one as a GitHub issue.
