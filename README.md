# Red First

A TDD companion for Claude Code (working name). It keeps Claude test-first,
verifies the evidence per change, and shows it in a band above the prompt.

Status: private prototype, being dogfooded on throughline. See `DOGFOOD.md`
and `docs/decisions/`. Product brief: https://claude.ai/code/artifact/558d3bb2-c32c-4b7f-94e2-f3099742469d

## Install (local)

```bash
claude plugin marketplace add C:/Users/fuent/red-first
claude plugin install red-first@red-first
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

## Develop

```bash
claude plugin test .
claude plugin validate .
```

Tests live in `tests/`; the hooks module is `hooks/register.tsx`, with the
logic in small pure modules beside it.
