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

### Releases

From 0.2.6, `main` only moves when a version ships:

1. Feature and fix pull requests target the `release` branch.
2. When a version is ready, one pull request bumps `version` in
   `.claude-plugin/plugin.json`, adds the tester note under
   `docs/testers/rounds/`, and merges `release` into `main`.
3. The merge on `main` is tagged `vX.Y.Z`. The plugin directory and the
   pull-request check's `uses:` line follow tags, so only a tagged release
   reaches users.

`release` is protected like `main` (pull requests, green CI, no deletion), so
merging it into `main` doesn't delete it. CI fails any pull request into `main`
whose branch is not `release`, so a feature branch can't reach `main` by
mistake: retarget it to `release`.

### The loop

While working, run only the one test file you are changing, as above. A full
`claude plugin test .` takes about 35 seconds and the POSIX-root run about 35
more, so running every suite after every step makes a small change take
minutes. Once, before opening a pull request, run everything:

```bash
npm run check            # validate, plugin test and node --test, all at once
npm run check -- --all   # the same, plus the POSIX-root run
npm run golden           # after changing a message's words: rewrite the golden file
npm run diagrams         # after changing tools/diagrams/is-it-on.mjs: redraw assets/is-it-on.svg
```

The README's two diagrams say what the plugin does, so they change with it.
`assets/is-it-on.svg` is drawn by `tools/diagrams/is-it-on.mjs` from the band's
words, and `tests/node/diagrams.test.mjs` fails when the band gains a word the diagram
or the README does not name, or when the file was edited by hand.
`assets/where-it-applies.svg` is drawn by hand: when what Dope TDD guards
changes, update it with the README's "What it guards" and "What it doesn't
guard" and `docs/setup.md`'s "Where Dope TDD applies", in the same pull request.

Every sentence dope-tdd says to the agent lives in `hooks/messages.ts`, by id,
with an example. Its exact words are pinned once, in
`tests/fixtures/messages.golden.ts`; other tests check which message is said,
with `say(id, facts)`. To change wording, edit the template, run
`npm run golden`, and review the golden file's diff: it is every sentence the
agent will read differently.

`npm run check` starts the suites at the same time, prints each one's output whole as it
finishes (its own summary line included), then one PASS/FAIL line per suite
and a combined verdict; it exits non-zero if any suite failed. The POSIX-root
run is left to CI by default: it runs the same ~1000 kit tests again, which
nearly doubles the local wait, to catch path bugs a Windows machine cannot
produce. CI still runs everything, POSIX root included, on Linux and Windows
for every pull request, and on macOS too for every push to `main`. The guard is unchanged by this: red before an
edit, green after, and the catch check all still apply to the one file you run.

### Live runs

Some claims only a real Claude Code session can settle: which project root it
hands the hooks, where it puts a worktree subagent's worktree, whether the
plugin loads at all. No fake engine shows that. `npm run live` drives real
headless sessions (`claude -p` with stream-json) against throwaway probe repos
and checks what dope-tdd did:

```bash
npm run live                     # this checkout's build, by --plugin-dir, with the installed copy turned off
npm run live -- --installed      # the dope-tdd Claude Code has installed
npm run live -- --only B,D       # some scenarios only
npm run live -- --model sonnet   # a cheaper model
```

| | Session | Asked to | Expected |
|---|---|---|---|
| A | in one guarded repo | edit another repo's `src/calc.js` by absolute path | goes through; `/tdd` lists it as outside this project |
| B | in the probe repo | edit `src/calc.js`, no test touched | refused, naming `tests/calc.test.js` |
| C | in the probe repo | have an `isolation: "worktree"` subagent make that edit | refused; the worktree is under `<probe>/.claude/worktrees/agent-…` |
| D | in a `git worktree add` of the probe | the same subagent edit | refused (went through on 0.2.11, fixed in 0.2.12); the worktree is under the main checkout |
| E | in the probe repo, plugin off | the same edit as B | goes through; no `/tdd` |
| F | in the probe repo, with a worktree at `.claude/worktrees/nested` | red, fix and green there by `cd`, then a run in the main checkout | the red and green count on `calc` and the catch check proves it there; the main checkout's run does not count |

Each scenario prints `PASS` or `FAIL` with its checks; a failure also prints
what the session did and keeps its transcript. The checks read tool results
and `/tdd` output, not what the model says about them. The probes live under
the OS temp folder and are removed afterwards, with any worktree a subagent
left, dope-tdd's session records of those sessions (so they do not count in
your stats) and Claude Code's transcripts of them.

It costs model use: the first full run (2026-10-29, Opus) spent $2.81 for the
five sessions, the subagent ones most; the last line prints each run's cost
and wall time. So it is not part of `npm run check` or CI, and `--only`
or `--model` keep a rerun small. Run it before a release, and after touching
project roots, worktrees, the shell gate or config loading. Its pure parts
(the stream reader, the checks, each scenario's verdict on a good and a broken
run, the probe builder) are unit tested in `tests/node/live.test.mjs` and
`tests/node/liveProbe.test.mjs`, which `npm test` runs.

One check stays manual: `/cd` "isn't available" in a headless session, so
moving a running session into another folder has to be tried by hand in an
interactive one.
