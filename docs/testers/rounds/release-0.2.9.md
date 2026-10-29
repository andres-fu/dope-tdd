# dope-tdd 0.2.9: what round 6 found, fixed

0.2.9 fixes what tester round 6 found on 0.2.8. It changes no rule about what is refused. It
changes what you and Claude are told, and when.

## What 0.2.9 changes

- **A subagent sees the override option.** The override is offered on a module's first refusal,
  and that was counted for the whole session: a subagent refused after the main session never saw
  option (3). It is now counted per agent (#212).
- **The band shows refusals.** After a refused edit the band reads
  `refused: <module> · write its test first · <when>`, with `· a subagent` when it was one, until
  that module's test is touched or run (#216).
- **`/tdd` event rows say the seconds** under an hour (`8MIN12S AGO`), so events seconds apart stay
  apart from one read to the next, and a subagent's rows end `· subagent` (#216).
- **The spike line says only what is known.** `/tdd` reads `spikes started: N (last: ...), each in
  a throwaway copy outside the project`, and the event reads `spike started`. It used to say "then
  rebuilt test-first", which nothing tracks (#213).
- **An invalid `dope-tdd.json` is said plainly** (#214):
  - The session-start text says `mode: enforce, the default; dope-tdd.json was not read`.
  - The message on the edit that broke the file says the whole file is ignored and names the
    defaults in force, instead of listing field changes like `stack python → node`.
  - When the default layout matches none of the project's code, the band says nothing is guarded.
- **Docs: subagents in their own worktree.** A worktree holds only committed files, and can be
  created from the default remote branch. Commit `dope-tdd.json` and your tests there, or a
  worktree-isolated subagent runs unguarded (#215, `docs/setup.md`).
- The plugin's privacy policy link now points at `docs/security-and-data.md`.

## What to check

**Step 0: update.** Run `claude plugin update dope-tdd`, then `/reload-plugins`, then `/tdd`. The
first line should say `version 0.2.9`.

**Step 1: a subagent refusal.** In a repo with `dope-tdd.json` and the tests committed, have the
main session try an untested edit to a module, then have a worktree-isolated subagent try the same
edit. Expect option (3) in both refusals, and the band to show `refused: ... · a subagent`.

**Step 2: event rows.** Run `/tdd` and expect rows under an hour with seconds, and the subagent's
row ending `· subagent`.

**Step 3: a broken config.** Set `"mode": "Warn"` and start a new session. Expect the session-start
header to say `the default; dope-tdd.json was not read`. Put it back after.

**Step 4: a spike.** Run `/dope-tdd:spike <a question>` and expect `/tdd` to say `spikes started`.

Paste the exact lines for each step. Anything that doesn't match is a finding.
