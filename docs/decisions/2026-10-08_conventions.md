# 2026-10-08 — Where tests live: layouts, roots, /tdd setup

## What was decided
1. **A layout is two path templates.** `source` and `test`, with the tokens
   `{module}`, `{dir}`, `{name}` and `{ext}`. Presets: `mirror`
   (`src/{module}.{ext}` ↔ `tests/{module}.test.{ext}`, the default),
   `colocated` (`src/{module}.test.{ext}`), `__tests__`
   (`src/{dir}__tests__/{name}.test.{ext}`), or a custom `{ source, test }`.
   The test template is matched first, so a colocated test is never taken
   for a source.
2. **Roots make a monorepo many projects.** `"roots": ["packages/*"]`: a
   path's leading segments are matched against each root glob, the layout
   applies to the rest, and the module id carries the package
   (`packages/app/utils/a`). Files under no root are left alone.
3. **Every message follows the layout.** The deny names the test to touch
   and the source to edit under the layout and root; the advice lines do the
   same; git is asked about the directories the templates (or roots) start in.
4. **`/tdd setup` reads the repo.** It walks the tree (skipping dependencies,
   build output and hidden folders, six levels, five thousand files), counts
   where the test files sit, groups sibling packages with a `src/` into a
   roots glob, shows examples with their source, the current config, and the
   JSON to write. `/tdd setup write` saves it, keeping mode, scope and exempt,
   logs a config event (`setup: ...`, not a workaround) and toasts.

## Why
Both architect reviews called hard-coded conventions the adoption blocker:
"every edit denied, nothing can unlock; the first minute in most repos". The
brownfield pitch dies at install without this. Templates rather than a list
of special cases because the next repo has a shape nobody listed.

## Alternatives considered
- A list of layouts tried in order per file: rejected; two layouts at once
  makes "which test unlocks this" ambiguous, and roots cover the real case
  (several packages, one convention).
- Writing the config at install without asking: rejected; `/tdd setup`
  shows first and writes only when told, and the write is on the record.

## Trade-offs accepted
- One layout per repo (per root). A repo mid-migration between two layouts
  gets the majority one and sees the rest as "other".
- `{ext}` is TypeScript and JavaScript; other languages wait for a runner.
- The survey is bounded; a very large tree is sampled, and the text says
  how many test files were seen.
- The playground and this repo's own tests still use `tests/`; this repo's
  hooks live in `hooks/`, so Dope TDD's own advice names `src/<module>`
  for them until a custom layout is set here.
