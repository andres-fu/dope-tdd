# Dope TDD

A TDD companion for Claude Code (working name). It keeps Claude test-first,
verifies the evidence per change, and shows it in a band above the prompt.

Status: private prototype, being dogfooded on throughline. See `DOGFOOD.md`
and `docs/decisions/`. Product brief: https://claude.ai/code/artifact/558d3bb2-c32c-4b7f-94e2-f3099742469d

## Install (local)

```bash
claude plugin marketplace add C:/Users/fuent/dope-tdd
claude plugin install dope-tdd@dope-tdd
```

Requires Claude Code v2.1.287+ in the terminal (or the Desktop app's Code tab).

## Try it in ten minutes

`playground/` is a tiny project with planted bugs and no tests. Its
[README](playground/README.md) walks a newcomer, a QA engineer or a team lead
through fixing a bug test-first, pinning behaviour before a refactor, and
watching the guard stop a shortcut. It doubles as the plugin's live test
fixture.

## How it decides

- `src/**/X.ts(x)` can't be edited (Edit, Write, or a shell write) until
  `tests/**/X.test.ts(x)` was created or edited in this session.
- Phases: idle → WRITING (test touched) → RED (a run reported failures) →
  GREEN (a run passed). A run is a `vitest`, `jest`, `npm test`-style command
  at the start of a shell command; its result is read from the runner's own
  summary line, not the exit code.
- After every shell command, `git diff` under `src/` and `tests/` is the
  source of truth: source files changed without a test touched count as
  unguarded, and tests written through the shell count as touched.
- The project must be a git repository; without one the shell backstop
  records nothing.

## What the band says

Above the prompt, three rows: the phase (WRITING, RED, GREEN, PAUSED, IDLE)
with the run trail; the current module with its verdict (SAW RED or NEVER
SAW RED, then CAUGHT, MISSED, UNVERIFIED or REFACTOR from the catch check);
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
  write next; `observe` allows it, counts it, and says nothing, for a
  baseline before a team turns the guard on.
- `scope`: when set, the mode applies only inside these paths and everything
  else is observed. This is how to bring the guard into one area of an old
  codebase at a time.
- `exempt`: paths the guard never touches or counts, such as an entry file
  or generated code. Prefer this to pausing; a pause hides edits, an
  exemption is on the record.

Everything else, including the catch check and the evidence, runs in every
mode. Modes only decide whether an edit is denied and whether Claude is told.

## Develop

```bash
claude plugin test .
claude plugin validate .
```

Tests live in `tests/`; the hooks module is `hooks/register.tsx`, with the
logic in small pure modules beside it.
