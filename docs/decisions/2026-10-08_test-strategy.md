# 2026-10-08 — Test strategy without daily dogfooding; honest RED from runner output

## What was decided
The owner can't use the plugin daily for two weeks, so the dogfood gate is
replaced by three repeatable layers:

1. **Scenario tests** in `tests/scenarios.test.tsx`: end-to-end scripts on the
   engine harness for the flows the product is for. Bug fix in untested code
   (blocked → touched → red → edited → green), pinning behaviour before a
   refactor (green-first is called out; breaking on purpose clears it), and
   the pause escape hatch.
2. **A playground** in `playground/`: a tiny Vitest project with three planted
   bugs, one ugly-but-correct function, a `BUGS.md` written as bug reports, a
   `CLAUDE.md` with the conventions, and a `README.md` walkthrough written for
   newcomers and QA. It is the live fixture for headless runs
   (`claude -p ... --plugin-dir ..` or the installed plugin), a self-check for
   new users, and a demo. It ships with no `tests/` folder and is reset after
   every run, because `claude plugin test .` sweeps up any test file in the repo.
3. **Headless live runs** against the playground, with the model told to call
   the status tool at the end so the evidence can be read from the transcript.

Two bugs the first live run exposed are fixed:

- **RED from the runner's summary, not the exit code.** Claude piped
  `vitest run` through `tail -30`, so the shell reported success and the
  failing run was logged as a pass. `hooks/runOutcome.ts` reads the Vitest or
  Jest summary lines (`Tests N failed | M passed`, `Tests: N failed, M passed`),
  treats a suite that failed to load as a failure, treats "No test files
  found" as not a run, and falls back to the shell result only when there is
  no summary to read.
- **Git paths relative to the session root.** `git diff --numstat` prints
  paths relative to the repository root, so a project inside a bigger repo
  (the playground, any monorepo package) never matched `src/`. `--relative`
  fixes it; `ls-files` was already cwd-relative.

## Why
The owner's words: "I can't dogfood, figure out a test strategy", and the
playground "is a way someone can also verify it's working" and should teach
"the benefits of unit tests and TDD". The live run found in ten minutes what
reading the code had not: the one signal the whole product rests on (saw red)
was being lost on the most common way Claude runs tests.

## Alternatives considered
- Keep relying on `isError`: wrong whenever the command is piped or `|| true`.
- Vitest/Jest JSON reporters via a wrapper command: exact, but it means
  rewriting Claude's command, which is intrusive and runner-specific.
- A separate playground repo: cleaner for `claude plugin test`, but one more
  thing to clone; keeping it in-repo with a reset rule is simpler for now.

## Trade-offs accepted
- Summary parsing is runner-specific (Vitest and Jest today); pytest and
  others fall back to the exit code until their summaries are added.
- Playground runs cost the owner's plan tokens (Sonnet is used for the driver).
- The playground's "NEVER SAW RED" warning on a characterization test is
  explained in the walkthrough rather than fixed; a pinning state is the next
  design item.
