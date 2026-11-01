# How Dope TDD works

What Dope TDD does at each step, how it decides, what the band says, and how the catch check proves a test. The [README](../README.md) has the short version.

## What it enforces

It stands in the path of five tools: Edit, Write, NotebookEdit, Bash and
PowerShell. NotebookEdit is guarded like Edit, by the file it names
([#195](https://github.com/andres-fu/dope-tdd/issues/195)). Other tools that
write files, another plugin's or an MCP server's file tools, are not guarded.
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
refused, and a shell change to it is put back and counted as a workaround. A
command of git alone is left alone, since a pull can bring in other people's
overrides, and [what gets past it](what-gets-past.md) says what that leaves open.

## How it decides

- `src/**/X.ts(x)` can't be edited (Edit, Write, NotebookEdit, or a shell
  write) until `tests/**/X.test.ts(x)` was created or edited in this session,
  or run and seen failing. The refusal names the test with the extension of
  the file being edited (`a.js` → `a.test.js`), then lists numbered ways to unblock:
  (1) make that test fail, with the exact command that runs it; (2) pin
  untested code with `/dope-tdd:pin`; (3) ask for an override. The override
  is offered on the module's first refusal only, so it reads as the last
  resort it is. The refusal ends with the band's own "last run" line.
- A module unlocked in an earlier session (up to 7 days) waits for one run of
  its test this session, red or green, before its first edit; the carry-over
  is dropped if that test changed since. Edits under it are not counted as
  test-first, since the test came first in an earlier session: `/tdd` counts
  them apart (`under an earlier session's unlock`) until the test is touched
  or seen failing this session.
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
  summary line, not the exit code. A command that runs its tests more than
  once is read from its last summary: red, a fix, then green is green.
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
- After every shell command, reads and test runs included, `git diff` under
  `src/` and `tests/` is the source of truth, so a change the same command stages
  isn't seen ([#292](https://github.com/andres-fu/dope-tdd/issues/292)). Source
  files changed without a test touched count as unguarded, and tests written
  through the shell count as
  touched. The command's text only decides whose change it was. One Claude Code
  held read-only can't have made it. One that only looks read-only, a read or a
  test run, may hide a write (`echo "$(sed -i ...)"`), so each code or test file
  changed around it is said once and listed in `/tdd` under **changed during a
  read or test run**. Nobody is charged or credited. The change also counts
  against the module's next verdict where it can, though a verdict can still miss
  it ([#285](https://github.com/andres-fu/dope-tdd/issues/285)). A write the reader
  names, as it does `ls 2> src/a.ts`, is the command's as usual
  ([#281](https://github.com/andres-fu/dope-tdd/issues/281)). Beside a git rewrite
  changes still count as git's, so a write hidden there isn't seen
  ([#284](https://github.com/andres-fu/dope-tdd/issues/284)).
- Before a shell command runs, its writes are read from the command: a
  redirect, `tee`, `cp`, `mv`, `sed -i`, a PowerShell write or a script's file
  write. Quoted text is data, so a commit message or an echoed sentence that
  mentions `>> src/a.ts` writes nothing; a command that hands its quotes to a
  shell (`sh -c "…"`, `ssh host "…"`, `eval "…"`) still has them read. A path
  spelled `./src/a.ts`, `src//a.ts` or `lib/../src/a.ts` is the file it names, for
  a shell write and for Edit, Write and NotebookEdit. A `..` is resolved by
  reading the path, so through a symbolic link it can land elsewhere. In a script's
  text, or in quotes in PowerShell, a dotted path is left as text, since import
  paths are spelled that way
  ([#272](https://github.com/andres-fu/dope-tdd/issues/272)).
- Code the guard can't pair with a test goes through, and isn't guarded. There
  are two kinds, each told to Claude once a session, whichever tool wrote the
  file, and `/tdd` lists each file
  ([#259](https://github.com/andres-fu/dope-tdd/issues/259)). For code of the
  project's stack that the layout misses, `/tdd setup` shows whether a different
  layout would cover it. An Edit or Write to it turns the band to NOT WATCHING
  while no module is current; a shell write doesn't, since it may only be build
  output. Code of another stack Dope TDD reads can't be covered, since one
  `dope-tdd.json` guards one stack, so it never reaches the band. A shell write
  counts when the file it names changed on disk, or `git` saw a file change in
  the folders it watches and it is still there. A deleted file isn't an edit.
  Exempt files, helpers in a test folder, another stack's tests, languages Dope
  TDD doesn't read (Go) and notebooks don't count. Nothing is said while the guard
  is paused, and a kind first seen then isn't said afterwards.
- Git putting files back to a saved state (`git restore`, `git checkout --
  <file>`, `git reset --hard`, `git stash`) is not an edit: nothing is counted.
  Git bringing code in from elsewhere (`git checkout main -- <file>`, `git
  pull`, `git merge`, `git stash pop`, `git cherry-pick`) is not counted as
  Claude's edit either, but `/tdd` records it as **brought in by git, not
  guarded**, with the git verb only, never its arguments.
  Commands that only read beside it (`cat`, `sha256sum`, `git status`) do not
  change that.
- The project must be a git repository; without one the shell backstop
  records nothing.
- A subagent started with `isolation: "worktree"` works in
  `.claude/worktrees/<name>/`. Its Edit and Write calls, and shell writes that
  name a path inside the worktree, are judged against that worktree, so they
  are refused and unlocked like the main checkout's. The first path it reads,
  searches or edits there places the agent in that worktree: from then on its
  shell commands, the `git` check after them and its catch check run in the
  worktree, with its own `dope-tdd.json`, and its `cd` doesn't move anyone
  else's shell. A shell command it runs before naming any such path is read
  from the main folder. An unlock counts only in the checkout its test is in: a
  test touched in a worktree doesn't unlock the main checkout's module, nor the
  other way round ([#198](https://github.com/andres-fu/dope-tdd/issues/198)).
  Every agent still shares one current module and phase, and one test per
  module: when two checkouts work on the same module, the last test touch holds
  the unlock and the other is refused until it touches its test again
  ([#227](https://github.com/andres-fu/dope-tdd/issues/227)).
- A session's own shell can work in `.claude/worktrees/<name>/` too, as the
  desktop app sets up, with no agent to place it. Each shell command is judged
  by where it works: the folder its test run is in, else the first file it
  writes, else where it ends. Inside a worktree, its writes, the `git` check
  around it, its `dope-tdd.json` and its catch check are that worktree's, and
  the catch check builds its throwaway copy from there. A run counts for a
  module only in the checkout its unlock belongs to: a run of the main
  checkout's copy of a test says so and changes nothing for a module unlocked
  in a worktree, nor the other way round. A runner installed in the main
  checkout is found from a worktree under it, as `npx` finds it there. Dope TDD
  knows a shell's folder only from the `cd` commands it sees. Headless Claude
  Code puts the shell back at the project after each command without saying so:
  a relative `cd` that then only makes sense from the project is read from
  there, but a bare command is read from where the last `cd` left it. There,
  put the `cd` and the command in one call
  ([#250](https://github.com/andres-fu/dope-tdd/issues/250)).
- A subagent gets the session briefing too: Claude Code adds it only to the main
  session's system prompt, so Dope TDD appends it to the task the subagent is
  spawned with. A fork already carries it, and a workflow's agents can't be
  given it.
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
a loop that slow is where you and the agent drift. A red counts how long it
has been open (`RED 2MIN`, an alarm from ten minutes); after half an hour with
nothing happening it reads `RED · open 45MIN · nothing for 30MIN`, left rather
than in progress. A module whose test file is deleted is dropped, with its
unlock, and `/tdd` lists it once. Line 2 is the next step.
A third line appears only when you must act, such as an override waiting for you, with APPROVE and DENY. While
the guard enforces it says nothing about itself; when it does not, one word
says so: PAUSED, STANDING DOWN, WARN ONLY, OBSERVING, NOT WATCHING or CAN'T
READ RUNS, or CONFIG INVALID when `dope-tdd.json` could not be read and the
defaults apply (and, when the default layout matches none of the code, that
nothing is guarded). After a refused edit, the band says so
(`refused: stats · write its test first · a subagent · 2min ago`) until that
module's test is touched or run, so a subagent's refusal is seen too.
GUARD FAILING outranks all of them: an internal error let a call
through unguarded, and the band says how many (it fails open, on the record). Before anything happens it says what it will do. Counts live in
`/tdd`, which prints the full status and event log; `/tdd why` explains every
word; `/tdd reset yes` starts the counts over, on the record. Claude reads
the same facts in its tool results as it works.
