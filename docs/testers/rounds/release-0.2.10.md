# dope-tdd 0.2.10: two more from round 6

0.2.10 fixes two things round 6 found that 0.2.9 did not: one more fix for subagents, and one line on the band.
It changes no rule about what is refused.

## What 0.2.10 changes

- **A subagent is told the rules when it starts.** The session briefing ("Dope TDD is on in this
  project ...") went only into the main session's system prompt, so a subagent learned the rules
  from its first refusal. It is now added to the end of the task a subagent is spawned with. A fork
  already has it; a workflow's agents can't be given it (#222).
- **The CONFIG INVALID band names the stack in force:** `using the defaults: enforce, node,
  default layout`. With an invalid file every field falls back, the stack too, and the band never
  said which stack that was (#223).
- **Docs.** `docs/security-and-data.md` answers each of the plugin directory's scan warnings
  with the code behind it, and the README lists the new hook.

## What to check

**Step 0: update.** Run `claude plugin update dope-tdd`, then `/reload-plugins`, then `/tdd`. The
first line should say `version 0.2.10`.

**Step 1: a briefed subagent.** In a repo with `dope-tdd.json` and the tests committed, start a
worktree-isolated subagent and ask it, before it edits anything, what rules dope-tdd sets. Expect
it to describe them (test first, one test file at a time, the override request) without having
been refused first.

**Step 2: a broken config.** Set `"mode": "Warn"` in a Python project and start a new session.
Expect the band to name the stack: `using the defaults: enforce, <stack>, default layout`. Put it
back after.

Paste the exact lines for each step. Anything that doesn't match is a finding.
