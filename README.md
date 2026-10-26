# Dope TDD

**D.O.P.E.** Deny, Observe, Prove, Evidence.
*Don't overdub, prove every bar.*

The TDD companion for Claude Code. It **denies** a source edit until its test
exists, **observes** every edit and every run, through the shell too,
**proves** that each test catches the change it guards by undoing the change
and running the test, and keeps the **evidence** where you and Claude can
both read it. The motto: in the studio an overdub covers a bad take instead
of recording it again; bending a test until it passes is the overdub, and
the catch check hears it. Every bar is every change.

It is a Claude Code mod, so it runs inside Claude Code, in the path of every
Edit, Write and shell call. An edit to untested source is refused before it
happens, not flagged after. A test run's result is held until the catch check
has reverted the change, run the test and restored it, so the line Claude
reads back carries the verdict. A rule in CLAUDE.md is advice Claude can
forget or argue with; this is a gate it has to pass, and every refusal says
why, so it can.

## What it enforces

It stands in the path of four tools: Edit, Write, Bash and PowerShell. At
each moment it decides before the action runs:

| Claude is about to... | Dope TDD... | Word |
| --- | --- | --- |
| Edit untested source | Refuses, and lists the ways past it: the test to make fail (with its command), or, when the test already passes, one assertion to add and see fail; pin; or an override | the refusal in Claude's reply |
| Touch a test | Unlocks the module; see it fail first | red · |
| Run the module's own test and see it fail | Unlocks it too: the red is the evidence a touch stands for | RED 2M |
| Edit a module unlocked in an earlier session (up to 7 days) | Waits for one run of its test this session, red or green, and says why; drops the unlock if the test changed since | the refusal names the command |
| Run the tests | Reads the runner's summary, not the exit code | red ✓ green ✓, last run |
| Go green without a red | Says the test has proven nothing yet | UNPROVEN · never failed |
| Go green after red | Reverts, runs that test, restores, attaches the verdict | PROVEN, MISSED |
| Bend the test, skip, comment out, loosen config | Counts it and asks why | workarounds in `/tdd` |

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

`/tdd` prints the state, `/tdd why` the words, `/tdd setup` the layout it
detects, and `/tdd receipt` the receipt for the current module with the two
commands a reviewer runs to re-check the proof without the plugin, ready to
paste into a pull request.

There is no off switch. When test-first does not fit, the agent asks for an
override with a reason (`mcp__dope-tdd__override_request`) and stops; you
decide with `/tdd approve` or `/tdd deny <why>`, or the band's buttons. The
agent never approves itself, a hotfix included: an approved hotfix stays
debt until a test is written. With nobody there to approve, the agent is
denied and reports instead. You can pause
the guard yourself with `/tdd pause <minutes> <reason>` (at most two hours);
it comes back on by itself, or with `/tdd resume`, and tells you what was
edited meanwhile. `/tdd override end <module|pause>` ends an override.
Every override is recorded in `dope-tdd.overrides.json` in the repo, so the
pull request shows who approved what, and the receipt lists them.

Status: early, public, and used daily on its own code and on real projects.
Trying it? Start with [docs/testers.md](docs/testers.md): install, run
`/tdd setup`, then give Claude your real task. `DOGFOOD.md` and
`docs/decisions/` record what was learned along the way.

## Install

From GitHub:

```bash
claude plugin marketplace add andres-fu/dope-tdd
claude plugin install dope-tdd@dope-tdd --scope project
```

We recommend `--scope project`, run inside the repository you want guarded.
It turns Dope TDD on for that project only, in `.claude/settings.json`,
which you commit so your team gets the same guard. Use `--scope local` to
keep it to yourself in that one repository. The default, `--scope user`, turns
it on in every project you open on this machine, and its memory (unlocks,
session logs) then spans all of them.

Or from a clone, which loads the folder in place so edits apply live:

```bash
claude plugin marketplace add C:/path/to/dope-tdd
claude plugin install dope-tdd@dope-tdd
```

Requires Claude Code v2.1.287+ (the Desktop app's Code tab: v2.1.286+). An
older Claude Code does not load the plugin and does not say so, so check
`claude --version`, and with more than one install, check which one runs.
In a terminal, `/plugin` shows `1 mod active · dope-tdd` when it loaded. The
hooks run everywhere the plugin loads.
The band above the prompt draws in the terminal and in the Desktop app's Code
tab; in the VS Code extension's chat panel nothing draws, so there the
evidence is in the tool results, `/tdd` and the status tool.

## Where your tests live

Out of the box Dope TDD pairs `src/<module>.ts` with `tests/<module>.test.ts`
in a Node project, `src/pkg/calc.py` with `tests/pkg/test_calc.py` in a Python
project, and `scripts/player.gd` with `test/scripts/player_test.gd` in a Godot
project, which is gdUnit4's own rule. The project's root files say which it is
(`package.json`, `pyproject.toml`, `project.godot`, `pom.xml`); `"stack"` in
`dope-tdd.json` pins it. If your tests sit elsewhere, say so once:

```json
{ "layout": "colocated" }
```

`mirror` (the default), `colocated` (`src/a.test.ts` next to `src/a.ts`),
`__tests__` (`src/__tests__/a.test.ts`), or your own pair of templates:

```json
{ "layout": { "source": "lib/{module}.{ext}", "test": "spec/{module}.spec.{ext}" } }
```

With no `dope-tdd.json`, Dope TDD looks once at the start of a session: if
the default layout matches none of the project's code, nothing would ever be
refused, so Claude is told so, with the layout `/tdd setup` finds (for
example `colocated` under `site`), and asks you to run `/tdd setup`.

A monorepo adds `"roots": ["packages/*"]` and each package is its own project.
One `dope-tdd.json` guards one stack: in a repository with a Python backend
and a React frontend, pick the stack you want guarded and list the other
half in `exempt` (`"exempt": ["frontend/**"]`).
A folder whose tests sit differently from the rest names its own layout, with
templates that start inside the folder:

```json
{ "layout": { "source": "{module}.{ext}", "test": "test/{module}.test.{ext}" }, "layouts": { "dashboard": "colocated" } }
```

Here `dashboard/src/lib/a.ts` pairs with `dashboard/src/lib/a.test.ts`, a
refusal names that file, and everything outside `dashboard/` keeps the main
layout. The deepest folder wins; `roots` do not apply inside one.
Not sure? `/tdd setup` reads the repo and shows the stack and layout it finds,
the command a test runs with (`test command: python -m pytest <test file>`),
and the JSON to use; `/tdd setup write` saves it.

## Languages

Node is supported. The other stacks are **experimental**: the guard, the
runs and the counts work, but their catch check has no throwaway copy and
would undo your change on disk for one test run, so it stays off until
`"catchCheck": true` is in `dope-tdd.json`; until then a green there is
UNPROVEN · not checked, and says why.

| Stack | Runner for the catch check | Summary reader | Layout presets |
| --- | --- | --- | --- |
| Node | Vitest, Jest, ava from `node_modules`; Node's built-in runner (`node --test <file>`) when a `test` script in `package.json` runs `node --test` | from real output (`node --test`: spec and TAP reporters) | `mirror`, `colocated`, `__tests__`, `flat` |
| Python (experimental) | pytest, through the project's venv when there is one, when a pytest config, a requirements file or Pipfile that lists pytest, or a test written for pytest says so; Python's own `unittest` otherwise | from real output | `mirror`, `package`, `colocated`, `flat` |
| Godot 4 (experimental) | gdUnit4 for GDScript, headless, on `godot` in `dope-tdd.json`, else `GODOT_BIN`, else PATH (reader provisional); `dotnet test` for C# (read from a real Roadhouse run) | mixed | `godot`, `godot-src`, `godot-pascal`, `godot-flat`, `godot-csharp` |
| Java (experimental) | Maven, Gradle | provisional | `maven` |
| .NET (experimental) | `dotnet test` | from real output | `dotnet` |

Presets named `flat` and `godot-csharp` pair **by name**: the module is the
file's basename, so `scripts/show/BeatDeck.cs` and `test/BeatDeckTest.cs`
meet at `BeatDeck` wherever each sits. Your own templates can do the same
with `"pairing": "name"` and a `{name}` token on the test side. The runner
for the catch check is chosen by the test file's extension, so a C# test in
a Godot project runs through `dotnet test` and a GDScript one through gdUnit4.

A provisional reader was written from the runner's own source or docs, not
from a run, and is replaced the first time a real run is on record. Until
then a run it cannot read is reported as unread, never guessed. Adding a
language is a row in `hooks/stacks.ts`, a row in `hooks/runners.ts`, a
fixture of real output and a test; the hooks module reads the tables and
knows no language by name.

## Try it in ten minutes

`playground/` is a tiny project with planted bugs and no tests. Its
[README](playground/README.md) walks a newcomer, a QA engineer or a team lead
through fixing a bug test-first, pinning behaviour before a refactor, and
watching the guard stop a shortcut. It doubles as the plugin's live test
fixture.

Three things to ask Claude once it's installed, in your own project or in
`playground/`:

1. "Fix Bug 1 from BUGS.md." (`formatCents` prints `$-12.50` for a refund.)
   Dope TDD refuses the fix until a test for it exists and has failed, then
   proves the test catches the fix.
2. "Make wrapLines readable without changing its behaviour. Pin the current
   behaviour with a test first, and prove the test can fail before you
   refactor." Claude uses `/dope-tdd:pin` to pin today's behaviour, proves
   the pins, then refactors under them.
3. "Show me where this session stands." Claude runs `/tdd` and reads back
   the state: which modules are open, which tests are PROVEN or UNPROVEN, and
   any workarounds on the record.

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
  The band says **GIT REBASE** (or the operation's name), and Claude is told
  when it starts and when it ends.

## What the band says

Above the prompt, always, two short lines:

```
☠ dope-tdd   fileGate   red ✓   green ✓   PROVEN      last run: fileGate.test.ts passed · just now
  next  refactor while the test guards it, then commit                        [VIEW TEST]
```

Line 1 is the story: the module as you name it, its red and green, one
verdict (PROVEN; CHANGED when the code moved since the green; MISSED when the
test passes without your change; UNPROVEN with the reason otherwise), and
the last run. Line 2 is the next step. A third line appears only when you
must act, such as an override waiting for you, with APPROVE and DENY. While
the guard enforces it says nothing about itself; when it does not, one word
says so: PAUSED, STANDING DOWN, WARN ONLY, OBSERVING, NOT WATCHING or CAN'T
READ RUNS. Before anything happens it says what it will do. Counts live in
`/tdd`, which prints the full status and event log; `/tdd why` explains every
word; `/tdd reset yes` starts the counts over, on the record. Claude reads
the same facts in its tool results as it works.

## Settings, checked into the repo

An optional `dope-tdd.json` at the repository root sets how strict the guard
is and where. Every setting shows in `/tdd`, so nothing is hidden.

```json
{
  "mode": "warn",
  "scope": ["src/billing/**"],
  "exempt": ["src/main.tsx", "src/generated/**"]
}
```

- `mode`: `enforce` (default) denies a source edit until its test is
  touched; `warn` allows it, counts it as unguarded, and tells Claude what to
  write next; `observe` allows it, counts it, and says nothing: no advice,
  no briefing, no catch check and no test run of its own, so nothing on disk
  is ever touched and nothing of your project's is started. Use it
  for a baseline of how an agent works on its own before a team turns the
  guard on.
- `scope`: when set, the mode applies only inside these paths and everything
  else is observed. This is how to bring the guard into one area of an old
  codebase at a time.
- `exempt`: paths the guard never touches or counts, such as an entry file
  or generated code. Prefer this to pausing; a pause is temporary debt, an
  exemption is a standing decision on the record. An entry file no test can load (one that
  connects to a service or exits at load time) belongs here, committed:
  an exemption already in the file when a session starts is not counted,
  only one added during a session is, as a loosening the agent explains.
  Keep the entry file to wiring and move logic into modules that are tested.
- `catchCheck`: `false` turns the catch check off, for a repo whose dev
  server, `tsc --watch` or test watcher would rebuild on every revert. A
  green then stops at GREEN; turning it off is recorded as a loosening.
  `true` also lets an experimental runner (pytest, unittest, gdUnit4, Maven, Gradle,
  `dotnet test`) check in place, as described next.
- `pause`: `false` locks `/tdd pause` out for the repo; `{ "maxMinutes": 30 }`
  sets a shorter limit. The limit can only be tightened below two hours,
  and allowing longer pauses is recorded as a loosening.
- `overrides` (experimental): `{ "approver": "model" }` gives the approver's role to a
  reviewer model instead of you, for agents running on their own. It is the
  one thing Dope TDD sends off your machine (see What Dope TDD sends). It has
  no tools, sees the request as data and the module's hunks only, answers
  APPROVE, DENY or ESCALATE, and anything else, a failed call, or a repeat
  on the same module goes to you (or is denied when nobody is there).
  Hotfixes and your own pauses never go to it. It is a different model
  from the session's unless you name one: `"model": "claude-opus-5-5"`,
  `"effort": "high"`. Its decisions are recorded as the model's, with its
  reason, and turning it on is recorded as a loosening.

With Vitest, Jest, ava or `node --test` in a git checkout (a clone or a linked
worktree), the catch check undoes your change in a throwaway copy inside the
checkout's git directory and never writes your files. If that copy cannot be
made or cannot run the test (more than 300 changed files, a slow checkout,
a test that is not green there), the green is UNPROVEN · not checked, and
the reason names the step that failed (for example "the test did not pass in
the throwaway copy with your change in (red)", which a config that resolves
paths from the project folder can cause); it never falls back to your file. Outside a git checkout, or with
an experimental runner and `"catchCheck": true`, it writes the old code into
your file for the length of one test run, then puts your change back. The
file is compared again just before that, so a save from your editor in the
meantime stops the check instead of being overwritten. If the session ends
mid-check, the change is put back on the way out (or at the next session
start). If the file changed under it, your file is left alone and the change
is kept in `~/.dope-tdd/kept/<repo>-<hash>/` (the temp folder when there is
no home folder), never inside the repository.

The check runs for the current module only. When a whole-suite green also
closes another module's red cycle, that module's fix was never checked: it
counts as not checked, and `/tdd` names it (`not checked utils/other`). Run
that module's own test to check it.

A test that fails only on an error (an import, a collection or a compile that
broke) has checked nothing. Such a red unlocks the module but does not prove
a pin, and Claude is told no assertion ran. A check run that fails that way
is UNPROVEN · not checked, never PROVEN, and so is a break put back after
such a red: a break that only stopped the test from loading proves nothing.

A new file has no old code to put back. In that throwaway copy (Node, a git
clone) the check makes up to four small changes to it instead, one at a time:
a flipped comparison or `&&`, a nudged integer, a negated `if`, `true` for
`false`. Strings and comments are never touched. If the test fails for any of
them, the file is PROVEN, and the changes it did not notice are named; if it
passes for all of them, it is MISSED. Anywhere else a new file stays
UNPROVEN · not checked.

The counts run in every mode. Modes decide whether an edit is denied, whether
Claude is told, and whether the catch check runs: `warn` and `enforce` check,
`observe` only measures and touches nothing on disk in your project.

## Your record

When a session that did anything ends, Dope TDD writes its counts and
receipt to one file on your machine, `~/.dope-tdd/sessions/<date>-<session>.json`.
It never goes in the repository and never leaves your computer. Set
`DOPE_TDD_LOG=off` to keep nothing.

## What Dope TDD runs

Dope TDD is a Claude Code mod. Like every plugin's hooks, the programs it
starts run as you, **outside Claude Code's permission rules, PreToolUse hooks
and sandbox** ([plugin security](https://code.claude.com/docs/en/plugins/security)):
your allow and deny rules for Bash do not apply to them. This is what it
starts, and when:

| When | What it runs | Where |
| --- | --- | --- |
| A module's own test goes green, in `warn` or `enforce` (the catch check) | Node: the runner from your `node_modules` (Vitest, Jest, ava), or `node --test` with the flags your `package.json` test script passes (`--import`, `--require`, `--env-file`, ...), on that one test file | A throwaway git worktree in `.git/dope-tdd/wt` |
| The same, on an experimental stack, only with `"catchCheck": true` | pytest or `unittest` through your `.venv` python, or `uv run` / `poetry run` / `pdm run` / `pipenv run` when a lockfile names one, else `python`; `mvnw`, `gradlew`, `mvn`, `gradle`; `dotnet test`; the Godot binary named in `dope-tdd.json` | Your project folder, with your change undone for one run |
| A red run whose output was cut short, so not every failing test was named, in `warn` or `enforce` (Node; another stack only with `"catchCheck": true`) | The same one-file command, once, to read all the names | Your project folder |
| Around shell commands, edits and checks | `git`: `diff`, `ls-files`, `status`, `rev-parse`, `worktree add`/`remove`, `update-ref`, `hash-object` | Your repository. `worktree add` runs with hooks off (`core.hooksPath` at a folder that does not exist), so none of your git hooks run |
| At session start | `node -e` to delete its own session logs older than 30 days | `~/.dope-tdd/sessions/` |

Every run it starts has `CI=1` set and stops after 60 seconds at most. Your
runners can reach the network on their own: `uv run` may sync your
environment, Maven and Gradle wrappers download, `dotnet test` restores
packages. `claude plugin validate .` lists what the mod calls
(`$.process.run`, `$.fs.write`, `$.model.complete`).

For admins: Claude Code's [mods admin page](https://code.claude.com/docs/en/plugins/mods/admin)
shows how to keep user mods from loading (`allowManagedModsOnly`) or to refuse
a mod that calls `$.process.run`. Dope TDD calls it for the runs above.

## What Dope TDD sends

Nothing of its own: no network requests, no telemetry. The one exception is
opt-in and experimental. With `"overrides": { "approver": "model" }`, each
override request the agent makes goes to the model API through the session's
own client, the same API Claude Code already talks to. It sends the request
and its reason, earlier override reasons for that module, and up to 120 lines
of the uncommitted diff of that module and its test. Lines that are only a
comment are left out, but code lines and comments at the end of a code line go
as they are.

## What Dope TDD stores

Everything below lives under your user account.

To prove a test can fail, it reverts your change, reruns the test and puts the
change back, so it holds a copy of the source file it is checking:

| What | Where | Holds | Kept |
|---|---|---|---|
| Session state | Claude Code's plugin state, held for the session. Claude Code lets any installed plugin read another's state | Before and after text of each file with an open change, counters, module and test names | Until the change is judged or the session ends |
| Catch-check journal | Claude Code's plugin store: a plain JSON file under `~/.claude/plugins/store/`. Only an in-place check writes one | Before and after text of the file being checked, so an interrupted check can put it back | Removed when the check ends; one left behind is settled and removed at the next session start in that project, never from another |
| Unlocks | Plugin store | A test path, a time and a short hash of the test (no text) | 7 days |
| Check lock | Git ref `refs/worktree/dope-tdd-check` and plugin store | Module name and time | Removed when the check ends |
| Check worktree | `.git/dope-tdd/wt` | A copy of your checkout, dirty and untracked files included | Removed when the check ends |
| Session log | `~/.dope-tdd/sessions/` | Counts and the status receipt (module and test names), the repository folder name (in a linked worktree, the main checkout's), no source and no absolute path | 30 days; `DOPE_TDD_LOG=off` keeps none |
| Kept changes | `~/.dope-tdd/kept/` | Your edit, only when a file changed during a check and could not be restored | Until you delete it; named at every session start |
| Override record | `dope-tdd.overrides.json` in the repo | Each override: scope, kind, reason, what ends it, the decider's role (never a name), the files edited under it | In your repo, as long as you keep it; commit it with the change |

Files matched by `exempt` in `dope-tdd.json` are not captured. The 30-day
cleanup uses `node`; where it is missing, the files stay until you delete
them. Delete `~/.dope-tdd/` at any time. Source text is never written to the
Claude Code log.

## On every pull request

The plugin guards an agent while it works. The pull-request check proves the
result, whoever wrote it: Claude Code with or without the plugin, another
agent, a cloud workspace, or a person. For each source file a pull request
changes, it finds that module's test, puts back the base branch's version of
the source, runs the test, and expects it to fail.

```yaml
# .github/workflows/dope-tdd.yml
on: pull_request
jobs:
  catch-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      # install the project's dependencies here, as its own CI does
      - uses: andres-fu/dope-tdd/tools/pr-check@main
        with:
          base: ${{ github.base_ref }}
```

Each changed module is PROVEN (the test fails without the change), MISSED
(it still passes, so nothing checks the change), MOVED (a new file whose code
came from another file unchanged, by the move check below), UNTESTED, or
UNPROVEN (not checked) with the reason, in the job summary: the same words
the plugin uses. Tests that already fail on the pull request
are set aside by name. By default a MISSED fails the check; `fail-on:
untested` is stricter, `never` only reports. It reads `dope-tdd.json` the
same way the plugin does. Run it locally from a pull request's checkout with
`node tools/pr-check/check.ts --base origin/main`. The tools run on Node 22.18 or later as they are (Node strips the TypeScript types); on older Node, put `npx -y tsx@4.19.2` in place of `node`.

Where CI does not run (a fork whose upstream is private, say), run it from
your clone of this plugin against the project, so nothing is added to the
project's dependencies, and paste the table it prints into the pull
request; with the move check's table beside it, a reviewer sees what the
tests catch and what was only moved:

```bash
node ~/dope-tdd/tools/pr-check/check.ts --repo ~/my-project --base upstream/main --fail-on never
node ~/dope-tdd/tools/move-check/check.ts --repo ~/my-project --base upstream/main
```

## Moved code

A refactor that moves code into a new file has nothing for a catch check to
undo. The move check shows that the moved code is the code it was, and
pr-check uses it: a new file whose moved code is all IDENTICAL, RENAMED or
SIGNATURE reads MOVED, naming any new code beside it (a factory wrapper) as
not checked; one whose moved code DIFFERS keeps its verdict, with the first
difference in the note. pr-check takes the same `--rename`. On its own:

```bash
node tools/move-check/check.ts --repo . --base origin/main
```

Each top-level function, class, `const`, `type` alias or `interface` that left
one file between the base and HEAD and appeared in another, including inside a factory there
(`createX({ deps }) { function f() {} }`), is compared as tokens, so spacing
and comments never count:

- **IDENTICAL**: the same code.
- **RENAMED**: the same once names are changed one for one everywhere in it;
  each rename is listed for the reviewer to judge.
- **SIGNATURE**: the same body with new parameters, which is how an injected
  dependency arrives; both parameter lists are shown.
- **DIFFERS**: something else changed; the first difference is shown.

The `export` a move into a new module needs is not a change, and names inside
a template literal's `${…}` take part in renames.

Code that changed shape is found too: a removed `if (x === 'key') { … }` or
`case 'key':` block and an added `key(…) { … }` method or `key: (…) => { … }`
entry are paired by the key and compared like any move, and the row says so:
`bot.js:4 (if 'ping') → commands.js:3 (method)`. A key that is not unique on
either side is never guessed at; its lines stay in the coverage count below.

`--rename 'players.get(=getPlayer('` replaces a token sequence on
the old side first, for a change that is not one name for another, and is
marked "(given)". It applies only to pieces whose new side no longer has the
old code, so code that never changed stays IDENTICAL. A rule whose code holds
`=` (an arrow, `===`) goes as `--rename-from '<old>' --rename-to '<new>'`; a
`--rename` with more than one `=` is refused rather than split in the wrong
place. `--pair 'index.js:358-530=pool.js:40-120'` compares line ranges, for
code that was never a declaration of its own. A range one line too long (a method's closing
`},` included) says so: `range probably includes a closing line: try
commands.js:4-5`. It reads committed code only and
runs nothing from the repository; the output is a table to paste into the pull
request.

Under the counts, the report says how much of the removed code the moves
account for: `Accounted for: 212 of 340 removed lines (62%)`, then the largest
ranges no move covers (edits, deletions, or moves the check did not find), so
a partial report never reads as complete. Blank and comment-only lines are not
counted. `--fail-on uncovered` fails the run when any remain; it is off by
default, since lines a refactor really deleted look the same.

## Develop

```bash
claude plugin test .
node tools/posix-root.mjs   # the same tests with a macOS/Linux-shaped fixture root
claude plugin validate .
node tools/replay/replay.ts   # your own sessions through the detectors: what they read, what they missed
```

Tests live in `tests/`; the hooks module is `hooks/register.tsx`, with the
logic in small pure modules beside it.

dope-tdd guards its own development (`dope-tdd.json`). A pure module
`hooks/{module}.ts` pairs with `tests/{module}.test.ts`, and that one file runs
on Node in well under a second:

```bash
node --import ./tests/node/register.mjs --test tests/runPlan.test.ts
npm test   # every unit test on Node, about a second
```

`tests/node/register.mjs` points the kit's `claude-code/testing` import at a
small stand-in on `node:test` (`tests/node/kit.mjs`, held to the kit's behaviour
by `tests/node/kit.test.mjs`), so the same files also run in
`claude plugin test`. The live engine tests (`*.test.tsx`) run only there.
`hooks/register.tsx` and `hooks/draw.tsx` are exempt: the engine reaches them
only through the live tests, which no one file pairs with. #59 keeps moving
their decisions into pure modules that are guarded.

### Branches

Work on a branch and open a pull request; nothing lands on `main` directly.
In this repository Claude Code is held to that by a hook in
`.claude/settings.json`: `tools/guard/branch-guard.ts` refuses `git commit`,
`merge`, `cherry-pick`, `revert`, `rebase`, `am` and `push` while on `main`,
and any push aimed at `main` from another branch (its tests:
`node --test tools/guard/branch-guard.spec-node.ts`). The hook reads the
command's text, so a spelling it misses still meets GitHub's branch protection
on `main`, which is what actually enforces the rule.

### The loop

While working, run only the one test file you are changing, as above. A full
`claude plugin test .` takes about 35 seconds and the POSIX-root pass about 35
more, so running every suite after every step makes a small change take
minutes. Once, before opening a pull request, run everything:

```bash
npm run check            # validate, plugin test and node --test, all at once
npm run check -- --all   # the same, plus the POSIX-root pass
npm run golden           # after changing a message's words: rewrite the golden file
```

Every sentence dope-tdd says to the agent lives in `hooks/messages.ts`, by id,
with an example. Its exact words are pinned once, in
`tests/fixtures/messages.golden.ts`; other tests check which message is said,
with `say(id, facts)`. To change wording, edit the template, run
`npm run golden`, and review the golden file's diff: it is every sentence the
agent will read differently.

It starts the suites at the same time, prints each one's output whole as it
finishes (its own summary line included), then one PASS/FAIL line per suite
and a combined verdict; it exits non-zero if any suite failed. The POSIX-root
pass is left to CI by default: it runs the same ~1000 kit tests again, which
nearly doubles the local wait, to catch path bugs a Windows machine cannot
produce. CI still runs everything, POSIX root included, on Linux and Windows
for every pull request. The guard is unchanged by this: red before an
edit, green after, and the catch check all still apply to the one file you run.

## Try it, and tell us

Testers start at `docs/testers.md`. Report with the **Tester report** issue
template; the one moment the plugin was wrong, silent or annoying is the most
useful thing you can send.

## License

MIT. Copyright (c) 2026 Andres Fuentes. See `LICENSE`.
