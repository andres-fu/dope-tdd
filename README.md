# Dope TDD

**D.O.P.E.** Deny, Observe, Prove, Evidence.
*Don't overdub, prove every bar.*

Dope TDD keeps Claude Code test-first. It refuses an edit to source code until
that code's test has been written or seen failing, reads your test runner's
results, and proves each passing test catches the change by undoing the change
and running the test again. Other tools judge whether the agent followed TDD;
Dope TDD proves the test catches the change, by running it, with no judge
model reading each edit.

In the studio, an overdub covers a bad take instead of recording it again.
Bending a test until it passes is the overdub, and Dope TDD hears it.

It is a Claude Code plugin (a *mod*: it runs inside Claude Code). It checks
every Edit, Write and shell command before it runs. A rule in CLAUDE.md is
advice Claude can forget; this is a gate it has to pass, and every refusal
says why and what to do instead.

## What you see

Claude tries to fix a bug before writing a test:

```
dope-tdd: write the failing test first. Touch tests/text/slugify.test.ts, or run it and see it fail, before editing src/text/slugify.
Unblock by one of:
(1) write or edit tests/text/slugify.test.ts so it fails, then run it: npx vitest run tests/text/slugify.test.ts
(2) no test for this code yet: /dope-tdd:pin pins what it does now
(3) neither fits: ask for an override with mcp__dope-tdd__override_request; a person decides, and it is recorded
```

Claude writes the test, sees it fail, fixes the code, and sees it pass. Dope
TDD undoes the fix in a throwaway copy, runs the test again, sees it fail, and
says so. The band above the prompt shows where things stand:

```
☠ dope-tdd   fileGate   red ✓   green ✓   PROVEN      last run: fileGate.test.ts passed · just now
  next  refactor while the test guards it, then commit                        [VIEW TEST]
```

## Install

```bash
claude plugin marketplace add andres-fu/dope-tdd
claude plugin install dope-tdd@dope-tdd --scope project
```

Run it inside the repository you want guarded. `--scope project` turns Dope
TDD on for that project only, in `.claude/settings.json`, which you commit so
your team gets the same guard. `--scope local` keeps it to yourself; the
default, `--scope user`, turns it on in every project on this machine.

Needs Claude Code v2.1.287 or later (the Desktop app's Code tab: v2.1.286 or
later). An older version skips the plugin without saying so: check
`claude --version`, then run `/tdd` in a session. It should say `guard: ON`.
The band draws in the terminal and the Desktop app's Code tab; in the VS Code
chat panel, read the tool results and `/tdd` instead.

**Refusing edits is the point.** To ease off, set `"mode": "warn"` (allow and
count) or `"observe"` (count only) in `dope-tdd.json` at the repo root. To turn
it off: `claude plugin disable dope-tdd@dope-tdd` (add `--scope project` for a
project install), or `claude plugin uninstall dope-tdd@dope-tdd`.

## Try it in ten minutes

`playground/` is a tiny project with planted bugs and no tests. Its
[README](playground/README.md) walks through a test-first fix, pinning code
before a refactor, and watching the guard stop a shortcut. Three things to ask
Claude, there or in your own project:

1. "Fix Bug 1 from BUGS.md." Dope TDD refuses the fix until a test for it
   exists and has failed, then proves the test catches the fix.
2. "Make wrapLines readable without changing its behaviour. Pin the current
   behaviour with a test first, and prove the test can fail before you
   refactor." Claude uses `/dope-tdd:pin`, proves the pins, then refactors.
3. "Show me where this session stands." Claude runs `/tdd`: which modules are
   open, which tests are PROVEN or UNPROVEN, and any workarounds on the record.

## The verdicts

| Word | Means |
| --- | --- |
| **PROVEN** | With your change undone, the test fails. It catches the change. |
| **MISSED** | With your change undone, the test still passes. Nothing checks the change. |
| **UNPROVEN · never failed** | The test has never failed, so it has proven nothing yet. |
| **UNPROVEN · not checked** | The check couldn't run; the reason follows (a timeout, a test that won't load). |
| **CHANGED** | The code moved after the last green. |
| **refactor · not re-checked** | The code changed while its test stayed green; the test guards only what it already asserted. |

When the check saw the test fail on an assertion (Vitest, node --test,
pytest), PROVEN quotes it: ``fails with `expected 2 to be 3` ``. `/tdd why`
explains every word on the band.

## When test-first doesn't fit

- **Untested code to change**: `/dope-tdd:pin` pins what the code does today,
  proves the pins by breaking the code on purpose, then lets you change it.
- **Not sure what to test yet**: `/dope-tdd:spike <question>` explores in a
  throwaway git worktree outside the project, writes down what it learned and
  the first failing test, then rebuilds in the project test-first. No approval
  needed.
- **Neither fits**: Claude asks for an override with a reason and stops. You
  decide with `/tdd approve` or `/tdd deny <why>`, or the band's buttons.
  Claude never approves itself, and every override is recorded in
  `dope-tdd.overrides.json`, so the pull request shows it.
- **You need a break**: `/tdd pause <minutes> <reason>`, up to two hours. It
  comes back on by itself and tells you what was edited meanwhile.

Skipped tests, removed assertions, commented-out code and loosened settings
are let through but counted as workarounds, and Claude is asked why.

## Your project

Out of the box Dope TDD pairs `src/<module>.ts` with `tests/<module>.test.ts`
(and the usual layouts for Python and Godot). If your tests live elsewhere,
run `/tdd setup`: it reads the repo and shows the stack, the layout and the
JSON to use, and `/tdd setup write` saves it. Monorepos, per-folder layouts
and presets are in [docs/setup.md](docs/setup.md).

| Stack | Status |
| --- | --- |
| Node: Vitest, Jest, ava, `node --test` | Supported |
| Python (pytest, unittest), Godot 4 (gdUnit4, `dotnet test`), Java (Maven, Gradle), .NET (`dotnet test`) | Experimental: refusals and test reading work; the catch check is off until `"catchCheck": true`, because it undoes your change on disk for one run |
| Go, Rust, Ruby | Not read yet |

The project must be a git repository.

## Settings

An optional `dope-tdd.json` at the repo root, committed with the code. Every
setting shows in `/tdd`.

```json
{ "mode": "warn", "scope": ["src/billing/**"], "exempt": ["src/main.tsx", "src/generated/**"] }
```

- `mode`: `enforce` (default), `warn` or `observe`.
- `scope`: guard only these paths; everything else is observed.
- `exempt`: paths the guard never touches, such as an entry file or generated code.
- `catchCheck`, `pause`, `overrides`: see [docs/settings.md](docs/settings.md).
- `layout`, `layouts`, `roots`, `stack`: see [docs/setup.md](docs/setup.md).

## Privacy and safety

- It runs your test runner and `git` as you, outside Claude Code's sandbox and
  permission rules, like every plugin's hooks.
- It sends nothing over the network, unless you turn on the experimental
  model approver for overrides.
- It keeps test state and session logs on your machine under `~/.dope-tdd/`,
  never the conversation. The only typed text it keeps is a spike's question
  and override reasons (those in `dope-tdd.overrides.json`, in your repo).
  Delete `~/.dope-tdd/` any time; `DOPE_TDD_LOG=off` keeps no logs.

Exactly what it runs, sends and stores: [docs/security-and-data.md](docs/security-and-data.md).

## On every pull request

The plugin guards an agent while it works. The pull-request check proves the
result in CI, whoever wrote it: for each changed source file it puts back the
base version, runs the module's test, and expects it to fail. It uses the same
verdicts, adds MOVED for code a refactor only moved, and fails on MISSED by
default. Setup and the move check: [docs/pr-check.md](docs/pr-check.md).

## More

- [How it works](docs/how-it-works.md): every step, how it decides, the band.
- [Testers' guide](docs/testers.md): a first session, and the rough edges.
- [Contributing](CONTRIBUTING.md): build, test and change Dope TDD.
- `DOGFOOD.md` and `docs/decisions/`: what was learned along the way.

Status: early, public, and used daily on its own code and on real projects.
Tell us the one moment it was wrong, silent or annoying with the **Tester
report** issue template. Security problems go privately: see `SECURITY.md`.

## License

MIT. Copyright (c) 2026 Andres Fuentes. See `LICENSE`.
