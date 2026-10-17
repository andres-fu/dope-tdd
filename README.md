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
| Edit untested source | Refuses, names the test to write first | BLOCKED |
| Touch a test | Unlocks the module; see it fail first | WRITING |
| Run the module's own test and see it fail | Unlocks it too: the red is the evidence a touch stands for | RED |
| Edit a module unlocked in an earlier session (up to 7 days) | Waits for one run of its test this session, red or green, and says why; drops the unlock if the test changed since | NEEDS RUN |
| Run the tests | Reads the runner's summary, not the exit code | RED, GREEN |
| Go green without a red | Says the test has proven nothing yet | NEVER SAW RED |
| Go green after red | Reverts, runs that test, restores, attaches the verdict | CAUGHT, MISSED |
| Bend the test, skip, comment out, loosen config | Counts it and asks why | WORKAROUNDS |

The mechanism is the one Anthropic describes under
[Guard or change a tool call](https://code.claude.com/docs/en/plugins/mods/events#guard-or-change-a-tool-call);
`claude plugin validate .` prints the actions it steps into. The full table,
with what you see on each surface, is in `docs/testers.md`.

`/dope-tdd:pin` is a skill that walks an agent through changing untested
code: pin what it does today, prove the pins by breaking the code on
purpose, then change it. The band says PROVEN when the proof is in.

`/tdd` prints the state, `/tdd why` the words, `/tdd setup` the layout it
detects, and `/tdd receipt` the receipt for the current module with the two
commands a reviewer runs to re-check the proof without the plugin, ready to
paste into a pull request. `/tdd off` pauses the guard for the conversation
(on the record, as a workaround) and `/tdd on` resumes it.

Status: private prototype, being dogfooded on throughline. See `DOGFOOD.md`
and `docs/decisions/`. Product brief: https://claude.ai/code/artifact/558d3bb2-c32c-4b7f-94e2-f3099742469d

## Install

From GitHub (the repository is private for now, so you need access to it):

```bash
claude plugin marketplace add andres-fu/dope-tdd
claude plugin install dope-tdd@dope-tdd
```

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

A monorepo adds `"roots": ["packages/*"]` and each package is its own project.
A folder whose tests sit differently from the rest names its own layout, with
templates that start inside the folder:

```json
{ "layout": { "source": "{module}.{ext}", "test": "test/{module}.test.{ext}" }, "layouts": { "dashboard": "colocated" } }
```

Here `dashboard/src/lib/a.ts` pairs with `dashboard/src/lib/a.test.ts`, a
refusal names that file, and everything outside `dashboard/` keeps the main
layout. The deepest folder wins; `roots` do not apply inside one.
Not sure? `/tdd setup` reads the repo and shows the stack and layout it finds
with the JSON to use; `/tdd setup write` saves it.

## Languages

Node is supported. The other stacks are **experimental**: the guard, the
runs and the counts work, but their catch check has no throwaway copy and
would undo your change on disk for one test run, so it stays off until
`"catchCheck": true` is in `dope-tdd.json`; until then a green there is
UNVERIFIED and says why.

| Stack | Runner for the catch check | Summary reader | Layout presets |
| --- | --- | --- | --- |
| Node | Vitest, Jest, ava from `node_modules`; Node's built-in runner (`node --test <file>`) when a `test` script in `package.json` runs `node --test` | from real output (`node --test`: spec and TAP reporters) | `mirror`, `colocated`, `__tests__`, `flat` |
| Python (experimental) | pytest, through the project's venv when there is one | from real output | `mirror`, `package`, `colocated`, `flat` |
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

## How it decides

- `src/**/X.ts(x)` can't be edited (Edit, Write, or a shell write) until
  `tests/**/X.test.ts(x)` was created or edited in this session.
- A test that imports a module is its test too, but only when the module has
  no test of its own. When a module's own test misses a change, the catch
  check tries the tests seen importing it and names the one that catches it
  (`docs/decisions/2026-10-16_import-unlocks.md`).
- Phases: idle → WRITING (test touched) → RED (a run reported failures) →
  GREEN (a run passed). A run is a `vitest`, `jest`, `npm test`-style command
  at the start of a shell command; its result is read from the runner's own
  summary line, not the exit code.
- After every shell command, `git diff` under `src/` and `tests/` is the
  source of truth: source files changed without a test touched count as
  unguarded, and tests written through the shell count as touched.
- The project must be a git repository; without one the shell backstop
  records nothing.
- While a git rebase, merge, cherry-pick, revert, `am` or bisect is in
  progress, the guard stands down: the code that operation puts on disk was
  written before, so nothing is refused, counted or checked until it ends.
  The band says **GIT REBASE** (or the operation's name), and Claude is told
  when it starts and when it ends.

## What the band says

Above the prompt, three rows: the phase (WRITING, RED, GREEN, PAUSED, IDLE)
with the run trail; the current module with its verdict (SAW RED or NEVER
SAW RED, then CAUGHT, MISSED or UNVERIFIED from the catch check, or REFACTOR, in plain text, for a change made while green that was not re-checked);
and the session tally. `/tdd why` explains every word, `/tdd` prints the
full status and event log, and Claude reads the same lines in its tool
results as it works.

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
  no briefing, and no catch check, so nothing on disk is ever touched. Use it
  for a baseline of how an agent works on its own before a team turns the
  guard on.
- `scope`: when set, the mode applies only inside these paths and everything
  else is observed. This is how to bring the guard into one area of an old
  codebase at a time.
- `exempt`: paths the guard never touches or counts, such as an entry file
  or generated code. Prefer this to pausing; a pause hides edits, an
  exemption is on the record. An entry file no test can load (one that
  connects to a service or exits at load time) belongs here, committed:
  an exemption already in the file when a session starts is not counted,
  only one added during a session is, as a loosening the agent explains.
  Keep the entry file to wiring and move logic into modules that are tested.
- `catchCheck`: `false` turns the catch check off, for a repo whose dev
  server, `tsc --watch` or test watcher would rebuild on every revert. A
  green then stops at GREEN; turning it off is recorded as a loosening.
  `true` also lets an experimental runner (pytest, gdUnit4, Maven, Gradle,
  `dotnet test`) check in place, as described next.

With Vitest, Jest or ava in an ordinary git clone, the catch check undoes
your change in a throwaway copy inside `.git` and never writes your files.
Otherwise (a linked worktree, a copy that cannot reproduce the project, or
an experimental runner with `"catchCheck": true`) it writes the old code
into your file for the length of one test run, then puts your change back. If the session ends mid-check, the
change is put back on the way out (or at the next session start). If the
file changed under it, your file is left alone and the change is kept in
`~/.dope-tdd/kept/<repo>/`, never inside the repository.

A new file has no old code to put back. In that throwaway copy (Node, a git
clone) the check makes up to four small changes to it instead, one at a time:
a flipped comparison or `&&`, a nudged integer, a negated `if`, `true` for
`false`. Strings and comments are never touched. If the test fails for any of
them, the file is PROVEN, and the changes it did not notice are named; if it
passes for all of them, it is MISSED. Anywhere else a new file stays
unverified.

The counts run in every mode. Modes decide whether an edit is denied, whether
Claude is told, and whether the catch check runs: `warn` and `enforce` check,
`observe` only measures and touches nothing on disk in your project.

## Your record

When a session that did anything ends, Dope TDD writes its counts and
receipt to one file on your machine, `~/.dope-tdd/sessions/<date>-<session>.json`.
It never goes in the repository and never leaves your computer. Set
`DOPE_TDD_LOG=off` to keep nothing.

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

Each changed module is CAUGHT (the test fails without the change), MISSED
(it still passes, so nothing checks the change), MOVED (a new file whose code
came from another file unchanged, by the move check below), UNTESTED, or
UNVERIFIED with the reason, in the job summary. Tests that already fail on the pull request
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

Each top-level function, class or `const` that left one file between the base
and HEAD and appeared in another, including inside a factory there
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
code that was never a declaration of its own. It reads committed code only and
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

## Try it, and tell us

Testers start at `docs/testers.md`. Report with the **Tester report** issue
template; the one moment the plugin was wrong, silent or annoying is the most
useful thing you can send.

## License

MIT. Copyright (c) 2026 Andres Fuentes. See `LICENSE`.
