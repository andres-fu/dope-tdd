# Contributing to Dope TDD

How to build, test and change Dope TDD itself. Bugs become issues first, using the bug template; security problems go privately, see [SECURITY.md](SECURITY.md).

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

`npm run check` starts the suites at the same time, prints each one's output whole as it
finishes (its own summary line included), then one PASS/FAIL line per suite
and a combined verdict; it exits non-zero if any suite failed. The POSIX-root
pass is left to CI by default: it runs the same ~1000 kit tests again, which
nearly doubles the local wait, to catch path bugs a Windows machine cannot
produce. CI still runs everything, POSIX root included, on Linux and Windows
for every pull request, and on macOS too for every push to `main`. The guard is unchanged by this: red before an
edit, green after, and the catch check all still apply to the one file you run.
