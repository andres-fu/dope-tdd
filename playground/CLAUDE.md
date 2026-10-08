# Playground conventions

This is a small practice project with planted bugs (see `BUGS.md`). Dope TDD
guards it: a file under `src/` cannot be edited until its test exists.

- Tests live in `tests/` and mirror `src/`: `src/money/formatCents.ts` is
  tested by `tests/money/formatCents.test.ts`.
- Work test-first: write the failing test, run only that test file with
  `npx vitest run tests/<path>.test.ts`, see it fail, then fix the code, then
  run it again.
- Import from `vitest` (`import { expect, test } from 'vitest'`).
- Do not edit `BUGS.md` or `README.md`.
