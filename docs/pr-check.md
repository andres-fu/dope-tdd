# The pull-request check

Prove a pull request's tests catch its changes in CI, whoever wrote them, and show what a refactor only moved.

## On every pull request

The plugin guards an agent while it works. The pull-request check proves the
result, whoever wrote it: Claude Code with or without the plugin, another
agent, a cloud workspace, or a person. For each source file a pull request
changes, it finds that module's test, puts back the base branch's version of
the source, runs the test, and expects it to fail.

```yaml
# .github/workflows/dope-tdd.yml
on: pull_request
jobs:
  catch-check:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      # install the project's dependencies here, as its own CI does
      # pin to a release tag or commit, not a branch
      - uses: andres-fu/dope-tdd/tools/pr-check@main
        with:
          base: ${{ github.base_ref }}
```

Each changed module is PROVEN (the test fails without the change), MISSED
(it still passes, so nothing checks the change), MOVED (a new file whose code
came from another file unchanged, by the move check below), UNTESTED, or
UNPROVEN (not checked) with the reason, in the job summary: the same words
the plugin uses. Tests that already fail on the pull request
are set aside by name. By default a MISSED fails the check; `fail-on:
untested` is stricter, `never` only reports. It reads the layout and
`exempt` from `dope-tdd.json`, but not `mode`, `scope` or `catchCheck`, so it
runs experimental runners in place whatever the config says
([#192](https://github.com/andres-fu/dope-tdd/issues/192)). Run locally, it
puts the base version into each source file in place and back again, with
no journal: it refuses to start with uncommitted changes, and a run stopped
halfway leaves the base version on disk until you `git checkout` the file. Run it locally from a pull request's checkout with
`node tools/pr-check/check.ts --base origin/main`. The tools run on Node 22.18 or later as they are (Node strips the TypeScript types); on older Node, put `npx -y tsx@4.19.2` in place of `node`.

Where CI does not run (a fork whose upstream is private, say), run it from
your clone of this plugin against the project, so nothing is added to the
project's dependencies, and paste the table it prints into the pull
request; with the move check's table beside it, a reviewer sees what the
tests catch and what was only moved:

```bash
node ~/dope-tdd/tools/pr-check/check.ts --repo ~/my-project --base upstream/main --fail-on never
node ~/dope-tdd/tools/move-check/check.ts --repo ~/my-project --base upstream/main
```

## Moved code

A refactor that moves code into a new file has nothing for a catch check to
undo. The move check shows that the moved code is the code it was, and
pr-check uses it: a new file whose moved code is all IDENTICAL, RENAMED or
SIGNATURE reads MOVED, naming any new code beside it (a factory wrapper) as
not checked; one whose moved code DIFFERS keeps its verdict, with the first
difference in the note. pr-check takes the same `--rename`. On its own:

```bash
node tools/move-check/check.ts --repo . --base origin/main
```

Each top-level function, class, `const`, `type` alias or `interface` that left
one file between the base and HEAD and appeared in another, including inside a factory there
(`createX({ deps }) { function f() {} }`), is compared as tokens, so spacing
and comments never count:

- **IDENTICAL**: the same code.
- **RENAMED**: the same once names are changed one for one everywhere in it;
  each rename is listed for the reviewer to judge.
- **SIGNATURE**: the same body with new parameters, which is how an injected
  dependency arrives; both parameter lists are shown.
- **DIFFERS**: something else changed; the first difference is shown.

The `export` a move into a new module needs is not a change, and names inside
a template literal's `${…}` take part in renames.

Code that changed shape is found too: a removed `if (x === 'key') { … }` or
`case 'key':` block and an added `key(…) { … }` method or `key: (…) => { … }`
entry are paired by the key and compared like any move, and the row says so:
`bot.js:4 (if 'ping') → commands.js:3 (method)`. A key that is not unique on
either side is never guessed at; its lines stay in the coverage count below.

`--rename 'players.get(=getPlayer('` replaces a token sequence on
the old side first, for a change that is not one name for another, and is
marked "(given)". It applies only to pieces whose new side no longer has the
old code, so code that never changed stays IDENTICAL. A rule whose code holds
`=` (an arrow, `===`) goes as `--rename-from '<old>' --rename-to '<new>'`; a
`--rename` with more than one `=` is refused rather than split in the wrong
place. `--pair 'index.js:358-530=pool.js:40-120'` compares line ranges, for
code that was never a declaration of its own. A range one line too long (a method's closing
`},` included) says so: `range probably includes a closing line: try
commands.js:4-5`. It reads committed code only and
runs nothing from the repository; the output is a table to paste into the pull
request.

Under the counts, the report says how much of the removed code the moves
account for: `Accounted for: 212 of 340 removed lines (62%)`, then the largest
ranges no move covers (edits, deletions, or moves the check did not find), so
a partial report never reads as complete. Blank and comment-only lines are not
counted. `--fail-on uncovered` fails the run when any remain; it is off by
default, since lines a refactor really deleted look the same.
