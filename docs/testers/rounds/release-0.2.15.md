# dope-tdd 0.2.15: how this project is reviewed

0.2.15 changes nothing in how the plugin behaves. It is about how the project itself works: its rules
now live in the repo, each change is meant to get a review, and the release page says what changed.

## What 0.2.15 changes

- **Project rules in the repo.** `.claude/CLAUDE.md` holds how we work, what failure looks like here,
  and what review needs, so a tester or a GitHub reader sees the same rules a session does.
- **A review for each change.** `.claude/agents/reviewer.md` is a repeatable fresh-context review.
  Listed paths also need a person, and `/security-review` runs once per release. These are habits:
  nothing forces them yet. The reasoning and evidence are in
  `docs/decisions/2026-10-30_risk-tiers.md`.
- **Only a person merges.** The repo's own branch guard refuses `gh pr merge` from Claude Code. It is
  a nudge with known gaps, for working on this repo, and not part of the plugin.
- **The release page** shows this section and a link to the full note, not the tester steps.
- **Tester docs.** `docs/testers.md` says what to do when an update lands on a different project, and
  the README says what the "Is it on?" picture leaves out.

**Known limit** (#260): the shell reader misses some real writes, such as `echo "$(echo x > src/a.ts)"`
or a shell write inside a `python3 -c` string. 0.2.14 has the same gap, and fixing it is the plan for
the next release.

## What to check

**Step 0: update.** From inside your project, run `claude plugin update dope-tdd@dope-tdd`, adding
`--scope project` or `--scope local` to match your install, then `/reload-plugins`, then `/tdd`. The
first line should say `version 0.2.15`. With the plugin installed in several projects, the update can
land on a different one. If the version didn't change, run these from inside the project, using
`local` instead of `project` if that's how you installed it:

```bash
claude plugin uninstall dope-tdd@dope-tdd --scope project
claude plugin install dope-tdd@dope-tdd --scope project
```

**Step 1: nothing changed.** Make an untested edit to a source file. Expect the usual refusal, naming
the test. Anything that behaves differently from 0.2.14 is a finding.

Paste the exact lines for each step. Anything that doesn't match is a finding.
