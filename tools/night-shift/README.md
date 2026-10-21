# Night shift

An unattended loop that keeps dope-tdd improving overnight: it fixes one `ready` bug a night, test-first, and opens a
pull request; a morning brief says what happened and what needs the stakeholder. Version 1 **never merges**: every PR
waits for the stakeholder.

- [night-shift.md](night-shift.md): what the night run does, step by step, and its hard limits.
- [morning-brief.md](morning-brief.md): the read-only morning summary.

The instructions live here, on `main`, so changing how the night shift works goes through a pull request, CI and the
branch ruleset like any other change.

## How it runs

Two scheduled tasks in the Claude desktop app, on the stakeholder's machine, so dope-tdd loads and guards the work
(plugins do not load in cloud sessions). They run only while the app is open and the machine is awake; a task that was
due while the app was closed runs at the next launch.

The tasks' prompts are only this, so the behaviour stays in the repository:

- **Night shift** (for example 01:00):
  `In C:\Users\fuent\claude-mods\dope-tdd, run git fetch origin, then read tools/night-shift/night-shift.md as it is on origin/main (git show origin/main:tools/night-shift/night-shift.md) and follow it exactly.`
- **Morning brief** (for example 07:00):
  `In C:\Users\fuent\claude-mods\dope-tdd, run git fetch origin, then read tools/night-shift/morning-brief.md as it is on origin/main (git show origin/main:tools/night-shift/morning-brief.md) and follow it exactly.`

Reading the file from `origin/main`, not the working tree, means a branch checked out in the stakeholder's folder can
never change what the night shift does.

## What stops it doing harm

| Risk | What enforces the limit |
| --- | --- |
| Code reaches `main` without review | GitHub's ruleset on `main`: a PR and both CI checks are required; there is no bypass. The night shift is also told never to merge (an instruction). |
| Commits on `main` locally | The branch guard hook (`tools/guard/`). |
| Untested code | dope-tdd in enforce mode, and step 5 stops the night if dope-tdd is not guarding the worktree. |
| Someone files an issue that instructs the agent | Only `ready` issues are taken, and only the maintainer can add labels; issue text is treated as data (an instruction). |
| Releases, rules or the night shift itself changed | An instruction today. CI enforcement is proposed in docs/planning/process-and-agent-os.md (items 5 and 13). |
| Runaway usage | One PR a night, three attempts at green, then it blocks (instructions). |

Stop it: disable the two tasks in the desktop app's scheduled tasks.
