# dope-tdd 0.2.12: subagents in a linked worktree, and work outside the project

0.2.12 closes the guard hole from round 7's first headline, says when Claude works outside the
project, and adds two README pictures: where Dope TDD applies, and how to tell whether it is on.

## What 0.2.12 changes

- **A subagent's worktree is guarded when the session is itself a linked worktree** (#233). In that
  layout Claude Code puts the subagent's worktree under the *main* checkout's `.claude/worktrees/`,
  outside the session's folder, and dope-tdd read it as outside the project: an untested edit there
  went through and nothing was counted. Reproduced live on 0.2.11 with the plugin at user scope, so
  install scope was not the cause. Now those worktrees are guarded with their own `dope-tdd.json` and
  tests, like worktrees under the session's own folder.
- **Work outside the project is said, once a session** (#238). Dope TDD guards the folder the session
  was opened in. The first code file Claude writes, or test it runs, in another repository goes
  through with a `dope-tdd:` line saying it is not guarded or counted, and to open a Claude Code
  session there. `/tdd` lists it, and the briefing says the same up front.
- **README:** "What it guards", "Is it on?" (the band's states and what each means) and "What it
  doesn't guard", with the reason for each item. `docs/setup.md` mentions `worktree.baseRef`.

## What to check

**Step 0: update.** From inside your project, run `claude plugin update dope-tdd`, then
`/reload-plugins`, then `/tdd`. The first line should say `version 0.2.12`.

**Step 1: a linked worktree.** Open Claude Code in a folder that is a linked git worktree of another
checkout (`git worktree add`), with `dope-tdd.json` and the tests committed and dope-tdd installed at
user scope. Have a worktree-isolated subagent make an untested edit to a source file. Expect it
refused, naming the test. Note where the subagent's worktree landed.

**Step 2: another repository.** In any session, ask Claude to edit a code file in a different
repository by its full path. Expect the edit to go through with one `dope-tdd:` line saying it is
outside this project, and `/tdd` to list it. A second such edit in the same session says nothing.

**Step 3: is it on?** Compare the band with the README's "Is it on?" picture as you work. Anything
the band shows that the picture doesn't explain is a finding.

Paste the exact lines for each step. Anything that doesn't match is a finding.
