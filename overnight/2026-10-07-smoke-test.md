# Smoke test — red-first on main (103a418), 2026-10-07 night

Environment: Linux container, Claude Code 2.1.292 (`claude --version`).

## Results

| Check | Result |
| --- | --- |
| `claude plugin validate .` | Passed. Notes it prints: four gating hooks "without .catch" (status tool, Edit, Write, Bash); `types/index.d.ts` declares nothing on `$` (fine). |
| `claude plugin test .` | 75 pass, 1 fail of 76 (on main). |

The one failure on main, `band buttons > view test opens a pane showing the
current test source` (`tests/band.test.tsx:177`), is a fixture problem, not a
mod bug: `tests/engine.tsx:5` sets `ROOT = 'C:/work/throughline'`, and on
Linux the engine resolves that non-absolute path against the process cwd
(`/home/user/red-first/C:/work/throughline/...`), so the mocked `fs.read` is
asked for a path the fixture does not know and the pane draws NOT FOUND.
On Windows it passes. Fix: use a POSIX-absolute `ROOT` (`/work/throughline`)
in the shared fixture and keep one dedicated Windows-path test (there already
is one in `guard.test.tsx`).

`tests/overnight-known-bugs.test.tsx` on this branch holds two labeled
failing tests for items 1 and 2 below. Delete the file when they are fixed.

## Bugs, edge cases, simplifications (file:line · severity)

1. `hooks/mirror.ts:3` · **high** · `isTestRun` matches `\bvitest\b`, so
   `cat vitest.config.ts`, `grep vitest package.json` or `npm test -- --help`
   count as a passing run: phase flips to GREEN, a cycle closes, "never saw
   red" can increment. Needs a run-shaped match (`vitest run`, `vitest`
   as argv[0]/after npx, `npm test`), not a substring.
2. `hooks/register.tsx:119-176` · **high** · a test file created or edited by
   a shell command (`cat > tests/x.test.ts <<EOF`, `sed -i` on a test) never
   counts as a touch, so the module stays locked and the following source
   write is denied or unguarded. Claude writes tests with heredocs often. The
   post-call git diff should be taken for `tests/` too and recorded as a touch.
3. `hooks/register.tsx:103-116` + `hooks/gitChanges.ts:8` · **medium** · the
   tracked-file signature is `added/deleted` line counts from `--numstat`.
   A shell edit that changes an already-changed line keeps `1/1` and is
   invisible to the backstop. Use content hashes (`git hash-object` on the
   changed files, or `git diff --stat`'s is not better) or mtime+size.
4. `hooks/register.tsx:160-166` · **medium** · pass/fail is `result.isError`.
   A `vitest run` that exits non-zero because of a config/import error is
   recorded as RED (fine) but `vitest run || true`, or a runner missing from
   the project, is recorded as a pass. Parsing "Tests N failed/passed" from
   the output, or a JSON reporter, would make RED honest.
5. `hooks/bashWrites.ts:4` · **medium** · `SCRIPT_WRITE` matches
   `.write(` and `open(..., 'w')` anywhere, so `node -e "process.stdout.write(
   fs.readFileSync('src/App.tsx'))"` is denied as a write. False denies are
   what pushed the guard to "paused" in dogfooding. Same for item 6.
6. `hooks/bashWrites.ts:22` · **medium** · with `sed -i` or a script write
   anywhere in the command, every mentioned `src/` path is a write
   (`sed -i ... tests/a.test.ts && cat src/utils/b.ts` denies `b`).
7. `hooks/register.tsx:149-157` · **low** · `git checkout -- src/X.ts`,
   `git stash`, `git restore` change the numstat and are counted as
   unguarded edits of X. Relevant once the catch check exists.
8. `hooks/mirror.ts:3` · **low** · `pnpm test`, `yarn test`, `bun test`,
   `npx jest` are not test runs. Fine for throughline, not for an MVP that
   others install.
9. `hooks/draw.tsx:43` · **low** · `idle` draws as `✎ WRITING`; after RESET
   with a module kept, the band says WRITING with no open cycle.
10. `hooks/draw.tsx:127` and `:27` · **low** · band title and SVG alt are
    hard-coded "THROUGHLINE"; the product is Red First and the repo name is
    known from `$.session.root()`.
11. `hooks/stats.ts:48,59` · **low** · `normalizeStats` accepts any array for
    `history` and `events`; a corrupted event without a string `kind` makes
    `/tdd` throw at `summary.ts:25`.
12. `hooks/register.tsx:124-125,169` · **low** · the deny decision and the
    reminder use `current` read before the call; a parallel Edit that
    unlocks the module during the call is not seen. Harmless today.
13. `hooks/register.tsx:211` · **low** · `$.clock.every` is registered on
    every `session.start`; on hot reload the module restarts so timers are
    dropped by the engine, but worth one line of confirmation in a test.
14. `tests/guard.test.tsx:9-44` · simplification · duplicates `BAND`,
    `editAt`, `writeAt`, `runBash` from `tests/engine.tsx`;
    `answerAsEngine(on, _bashFails)` has a dead parameter.
15. `hooks/register.tsx:67` · by design but worth a README line · a brand new
    `src/` module is blocked until a mirrored test exists, including
    `src/main.tsx`; only `.ts/.tsx` under `src/` are guarded (no `.js`,
    `.css`, `.py`).

## What would confuse a new teammate

- `README.md` install uses `C:/Users/fuent/red-first`; needs "clone, then
  `claude plugin marketplace add <path-to-clone>`".
- `tsconfig.json` extends `./.claude-plugin/types/tsconfig.json`, which does
  not exist in a fresh clone: the engine writes it the first time the mod is
  loaded. A fresh clone cannot `tsc` and there is no `.gitignore`, so the
  generated folder will get committed by accident. Add a `.gitignore` with
  `.claude-plugin/types/` and one README sentence.
- No `LICENSE` file; the band shows throughline branding and the
  andresfuentes.net skull, which a teammate would not expect from a plugin.
- `claude plugin test` needs 2.1.287+; the README says so, but not that the
  tests are platform-sensitive (the `C:/` fixture).
- The mod needs the project to be a git repo; otherwise the Bash backstop
  silently logs and counts nothing. Say so.
- `DOGFOOD.md` is good; a 5-line "how it decides" (mirror rule, WRITING/RED/
  GREEN, what counts as a run) in the README would save reading three
  decision notes.
