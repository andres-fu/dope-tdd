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

## Develop

```bash
claude plugin test .
claude plugin validate .
```

Tests live in `tests/`; the hooks module is `hooks/register.tsx`, with the
logic in small pure modules beside it.
