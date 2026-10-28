# How Dope TDD works

What Dope TDD does at each step, how it decides, what the band says, and how the catch check proves a test. The [README](../README.md) has the short version.

## What it enforces

It stands in the path of four tools: Edit, Write, Bash and PowerShell. Other
tools that write files (NotebookEdit, another plugin's or an MCP server's file
tools) are not guarded yet ([#195](https://github.com/andres-fu/dope-tdd/issues/195)).
At each moment it decides before the action runs:

| Claude is about to... | Dope TDD... | Word |
| --- | --- | --- |
| Edit untested source | Refuses, and lists the ways past it: the test to make fail (with its command), or, when the test already passes, one assertion to add and see fail; pin; or an override | the refusal in Claude's reply |
| Touch a test | Unlocks the module; see it fail first | red · |
| Run the module's own test and see it fail | Unlocks it too: the red is the evidence a touch stands for | RED 2MIN |
| Edit a module unlocked in an earlier session (up to 7 days) | Waits for one run of its test this session, red or green, and says why; drops the unlock if the test changed since | the refusal names the command |
| Run the tests | Reads the runner's summary, not the exit code | red ✓ green ✓, last run |
| Go green without a red | Runs the catch check on the change too; if that can't prove the test, says it has proven nothing yet | PROVEN, or UNPROVEN · never failed |
| Go green after red | Undoes the change, runs that test, puts the change back, attaches the verdict | PROVEN, MISSED |
| Bend the test, skip, comment out, loosen config, edit its records | Counts it and asks why | workarounds in `/tdd` |

The mechanism is the one Anthropic describes under
[Guard or change a tool call](https://code.claude.com/docs/en/plugins/mods/events#guard-or-change-a-tool-call);
`claude plugin validate .` prints the actions it steps into. The full table,
with what you see on each surface, is in `docs/testers.md`.

`/dope-tdd:pin` is a skill that walks an agent through changing untested
code: pin what it does today, prove the pins by breaking the code on
purpose, then change it. The band says PROVEN when the proof is in. One break
proves one behaviour, so in a git checkout with a Node runner Dope TDD then
also makes a few small changes to the file in a throwaway copy and names any
the pins did not notice.
A restore that differs only in line endings (a Windows shell edit can rewrite
CRLF as LF) still counts as the code being back.

`/dope-tdd:spike <question>` is for exploring before the path is clear,
when no failing test can be written yet. The agent works in a throwaway git
worktree outside the project (`~/.dope-tdd/spikes/`), writes down what it
learned and the first failing test, removes the copy, and rebuilds in the
project test-first. Nothing in the copy is guarded or kept, so a spike needs
no approval and is not a workaround. `/tdd` lists it with its question
(`docs/decisions/2026-10-26_stumble-twice.md`).

`/tdd` prints the state, `/tdd why` the words, `/tdd setup` the layout it
detects, and `/tdd receipt` the receipt for the current module with the two
commands a reviewer runs to re-check the proof without the plugin, ready to
paste into a pull request. When the catch check saw the test fail on an
assertion (Vitest, node --test, pytest), the PROVEN line and the receipt quote
it, for example ``fails with `expected 2 to be 3` ``, so a reader learns what
the change does without running anything.

Claude cannot switch the guard off. When test-first does not fit, the agent asks for an
override with a reason (`mcp__dope-tdd__override_request`) and stops; you
decide with `/tdd approve` or `/tdd deny <why>`, or the band's buttons. The
agent never approves itself, a hotfix included: an approved hotfix stays
debt until a test is written. With nobody there to approve, the agent is
denied and reports instead. You can pause
the guard yourself with `/tdd pause <minutes> <reason>` (at most two hours);
it comes back on by itself, or with `/tdd resume`, and tells you what was
edited meanwhile. `/tdd override end <module|pause>` ends an override.
Every override is recorded in `dope-tdd.overrides.json` in the repo, so the
pull request shows which role (you, the model approver, or nobody there)
approved what, and the receipt lists them. A pause reason must say what and
why (at least 30 characters; "need to proceed" is refused), only one request
can wait at a time, and a module override open for more than 7 days blocks
new ones. Claude's Edit and Write calls to `dope-tdd.overrides.json` are
refused, and a shell change to it is put back and counted as a workaround.

## How it decides

- `src/**/X.ts(x)` can't be edited (Edit, Write, or a shell write) until
  `tests/**/X.test.ts(x)` was created or edited in this session, or run and
  seen failing. The refusal names the test with the extension of the file
  being edited (`a.js` → `a.test.js`), then lists numbered ways to unblock:
  (1) make that test fail, with the exact command that runs it; (2) pin
  untested code with `/dope-tdd:pin`; (3) ask for an override. The override
  is offered on the module's first refusal only, so it reads as the last
  resort it is. The refusal ends with the band's own "last run" line.
- A module unlocked in an earlier session (up to 7 days) waits for one run of
  its test this session, red or green, before its first edit; the carry-over
  is dropped if that test changed since.
- A module still red when a session ends is kept (up to 7 days), and the
  next session's briefing in that project leads with it: the module, the
  failing test, and to start there. A later session that leaves it green
  clears it; one that never touches it leaves it be.
- A shell write lands where the command sends it: after `cd` (also through a
  variable the command set, `R=/tmp/x; cd $R`), a file outside the project is
  not refused. A destination it cannot expand (`$HOME`, `$(mktemp -d)`) is not
  refused either; the `git` check after the command still records any project
  file that changed.
- A test that imports a module is its test too, but only when the module has
  no test of its own. When a module's own test misses a change, the catch
  check tries the tests seen importing it and names the one that catches it
  (`docs/decisions/2026-10-16_import-unlocks.md`).
- Phases: idle → WRITING (test touched) → RED (a run reported failures) →
  GREEN (a run passed). A run is a `vitest`, `jest`, `npm test`-style command
  at the start of a shell command; its result is read from the runner's own
  summary line, not the exit code.
- The same failure on the module you are on three runs in a row (the same
  assertion message, or the same failing tests) is trying things without
  traction. The red then tells Claude so, and to step back or say BLOCKED,
  again at six runs, nine, and so on. Each spell is kept in the session log.
- A suite run's red is a module's red only when the output names that
  module's test among the files that failed. A suite run thinned to its
  totals (`npm test > out.txt; grep ...`, `| tail -3`) by a runner that names
  failed files (Vitest, Jest, node --test, pytest) says only that something
  failed somewhere: it is a red elsewhere, and the open module keeps its
  phase. Run the module's own test file to see its red. Maven and Gradle pick
  their test by class name and never name files, so their red is still the
  module's.
- After every shell command, `git diff` under `src/` and `tests/` is the
  source of truth: source files changed without a test touched count as
  unguarded, and tests written through the shell count as touched.
- Git putting files back to a saved state (`git restore`, `git checkout --
  <file>`, `git reset --hard`, `git stash`) is not an edit: nothing is counted.
  Git bringing code in from elsewhere (`git checkout main -- <file>`, `git
  pull`, `git merge`, `git stash pop`, `git cherry-pick`) is not counted as
  Claude's edit either, but `/tdd` records it as **brought in by git, not
  guarded**, with the git verb only (the arguments can hold a token).
  Commands that only read beside it (`cat`, `sha256sum`, `git status`) do not
  change that.
- The project must be a git repository; without one the shell backstop
  records nothing.
- While a git rebase, merge, cherry-pick, revert, `am` or bisect is in
  progress, the guard stands down: the code that operation puts on disk was
  written before, so nothing is refused, counted or checked until it ends.
  The band says **STANDING DOWN** (`git rebase in progress`, or the
  operation's name), and Claude is told when it starts and when it ends.

## What the band says

Above the prompt, always, two short lines:

```
☠ dope-tdd   fileGate   red ✓   green ✓   PROVEN      last run: fileGate.test.ts passed · just now
  next  refactor while the test guards it, then commit                        [VIEW TEST]
```

Line 1 is the story: the module as you name it, its red and green, one
verdict (PROVEN; CHANGED when the code moved since the green; MISSED when the
test passes without your change; UNPROVEN with the reason otherwise), and
the last run. A run of one test file says how long it took (`passed in 4S`),
and from 30 seconds calls itself slow (`failed in 45S, slow for one file`):
a loop that slow is where you and the agent drift. Line 2 is the next step.
A third line appears only when you must act, such as an override waiting for you, with APPROVE and DENY. While
the guard enforces it says nothing about itself; when it does not, one word
says so: PAUSED, STANDING DOWN, WARN ONLY, OBSERVING, NOT WATCHING or CAN'T
READ RUNS. GUARD FAILING outranks all of them: an internal error let a call
through unguarded, and the band says how many (it fails open, on the record). Before anything happens it says what it will do. Counts live in
`/tdd`, which prints the full status and event log; `/tdd why` explains every
word; `/tdd reset yes` starts the counts over, on the record. Claude reads
the same facts in its tool results as it works.
