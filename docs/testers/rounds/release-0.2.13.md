# dope-tdd 0.2.13: the rest of round 7

0.2.13 fixes the round 7 findings 0.2.12 left open, and two found using dope-tdd on itself.

## What 0.2.13 changes

- **A config mistake no longer hides unguarded edits** (#234). `"mode"` is read in any case, so
  `"Warn"` is `warn`. When `dope-tdd.json` is not read, `/tdd` leads with `guard: ON with the defaults:
  dope-tdd.json was not read`. When edited code matches no test layout, it says `guard: ON, but N edited
  code files match no test layout and were not guarded`, and each such edit is an event.
- **Quoted text is data** (#239). A redirect, `sed -i`, `cp` or `tee` inside a commit message or an
  echoed sentence is no longer read as a write and refused.
- **One runner** (#235). The briefing reads the project's test files and names the runner the stack
  prefers among them, so a project with one pytest test is briefed `python -m pytest` every session.
- **`test-first` counts only this session's tests** (#236). Edits under an unlock carried over from an
  earlier session show as `under an earlier session's unlock N`, outside the ratio.
- **The spike line claims only a start** (#237).
- **The last summary decides** (#243). A command that runs a test red, then green, is green.
- **Reds left alone, and reds whose test is gone** (#244). After half an hour with nothing happening
  the band reads `RED · open 45MIN · nothing for 30MIN`. A module whose test file is deleted is dropped,
  with its unlock, and `/tdd` lists it once.

## What to check

**Step 0: update.** From inside your project, run `claude plugin update dope-tdd`, then
`/reload-plugins`, then `/tdd`. The first line should say `version 0.2.13`.

**Step 1: the round 7 `"Warn"` case.** Set `"mode": "Warn"` in `dope-tdd.json` and run `/tdd`. Expect
`mode: warn` and no "was not read". Then set `"mode": "strict"` and make an untested edit to code
the default layout doesn't pair with a test. Expect `/tdd` to lead with `guard: ON with the defaults`
and to list the edit.

**Step 2: one runner.** In the Axiom backend, start three sessions with the same `dope-tdd.json`,
some with `tests/` committed and some untracked. Expect the briefing to name the same runner each
time, and the refusal to name the same one.

**Step 3: the round 7 stale unlock.** With a module carrying an unlock from an earlier session, run
its test once, make an untested edit, then run `/tdd`. Expect `under an earlier session's unlock 1`
and `test-first: 0/0`.

**Step 4: a commit message.** Ask Claude to commit with a message that mentions
`>> <a guarded source file>`. Expect no refusal.

Paste the exact lines for each step. Anything that doesn't match is a finding.
