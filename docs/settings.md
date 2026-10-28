# Settings

Everything `dope-tdd.json` can set, and how the catch check runs.

## Settings, checked into the repo

An optional `dope-tdd.json` at the repository root sets how strict the guard
is and where. Every setting shows in `/tdd`, so nothing is hidden. If the file
doesn't parse or a value is invalid, Dope TDD uses the defaults (`enforce`,
the default layout) for all of it, and only `/tdd` says so, in a
`config: … (using defaults)` line
([#193](https://github.com/andres-fu/dope-tdd/issues/193)). Some stacks add
exemptions of their own: Godot exempts `addons/**`, .NET `bin/**` and `obj/**`.

```json
{
  "mode": "warn",
  "scope": ["src/billing/**"],
  "exempt": ["src/main.tsx", "src/generated/**"]
}
```

- `mode`: `enforce` (default) denies a source edit until its test is
  touched; `warn` allows it, counts it as unguarded, and tells Claude what to
  write next; `observe` allows it, counts it, and says nothing: no advice,
  no briefing, no catch check and no test run of its own, so nothing on disk
  is ever touched and nothing of your project's is started. Use it
  for a baseline of how an agent works on its own before a team turns the
  guard on.
- `scope`: when set, the mode applies only inside these paths and everything
  else is observed. This is how to bring the guard into one area of an old
  codebase at a time.
- `exempt`: paths the guard never touches or counts, such as an entry file
  or generated code. Prefer this to pausing; a pause is temporary debt, an
  exemption is a standing decision on the record. An entry file no test can load (one that
  connects to a service or exits at load time) belongs here, committed:
  an exemption already in the file when a session starts is not counted,
  only one added during a session is, as a loosening the agent explains.
  Keep the entry file to wiring and move logic into modules that are tested.
- `catchCheck`: `false` turns the catch check off, for a repo whose dev
  server, `tsc --watch` or test watcher would rebuild on every revert. A
  green then stops at GREEN; turning it off is recorded as a loosening.
  `true` also lets an experimental runner (pytest, unittest, gdUnit4, Maven, Gradle,
  `dotnet test`) check in place, as described next.
- `pause`: `false` locks `/tdd pause` out for the repo; `{ "maxMinutes": 30 }`
  sets a shorter limit. The limit can only be tightened below two hours,
  and allowing longer pauses is recorded as a loosening.
- `overrides` (experimental): `{ "approver": "model" }` gives the approver's role to a
  reviewer model instead of you, for agents running on their own. It is the
  one thing Dope TDD sends off your machine (see What Dope TDD sends). It has
  no tools, sees the request as data and the module's hunks only, answers
  APPROVE, DENY or ESCALATE, and anything else, a failed call, or a repeat
  on the same module goes to you (or is denied when nobody is there).
  Hotfixes and your own pauses never go to it, but an agent's pause
  request does, and an APPROVE pauses every module: set `"pause": false`
  alongside it if that's too much ([#194](https://github.com/andres-fu/dope-tdd/issues/194)). It is a different model
  from the session's unless you name one: `"model": "claude-opus-5-5"`,
  `"effort": "high"`. Its decisions are recorded as the model's, with its
  reason, and turning it on is recorded as a loosening.

## How the catch check runs

With Vitest, Jest, ava or `node --test` in a git checkout (a clone or a linked
worktree), the catch check undoes your change in a throwaway copy inside the
checkout's git directory (`.git/dope-tdd/wt`; in a linked worktree,
`<main>/.git/worktrees/<name>/dope-tdd/wt`) and never writes your files. A
green can be held for a few minutes while it runs: making the copy (up to two
minutes on a large checkout), a baseline and the check (up to 60 seconds
each), then any importer and small-change checks (three minutes at most). A nested package's
own `node_modules` (tests run from `site/` with `site/node_modules`) is
linked into the copy so its config loads there, and unlinked before the copy
is removed; the link is never followed when it goes. If that copy cannot be
made or cannot run the test (more than 300 changed files, a slow checkout,
a test that is not green there), the green is UNPROVEN · not checked, and
the reason names the step that failed (for example "the test did not pass in
the throwaway copy with your change in (red)", which a config that resolves
paths from the project folder can cause); it never falls back to your file. Outside a git checkout, or with
an experimental runner and `"catchCheck": true`, it writes the old code into
your file for the length of one test run, then puts your change back. The
file is compared again just before that, so a save from your editor in the
meantime stops the check instead of being overwritten. If the session ends
mid-check, the change is put back on the way out (or at the next session
start). If the file changed under it, your file is left alone and the change
is kept in `~/.dope-tdd/kept/<repo>-<hash>/` (the temp folder when there is
no home folder), never inside the repository.

The check runs for the current module only. When a whole-suite green also
closes another module's red cycle, that module's fix was never checked: it
counts as not checked, and `/tdd` names it (`not checked utils/other`). Run
that module's own test to check it.

A test that fails only on an error (an import, a collection or a compile that
broke) has checked nothing. Such a red unlocks the module but does not prove
a pin, and Claude is told no assertion ran. A check run that fails that way
is UNPROVEN · not checked, never PROVEN, and so is a break put back after
such a red: a break that only stopped the test from loading proves nothing.

A new file has no old code to put back. In that throwaway copy (Node, a git
clone) the check makes up to four small changes to it instead, one at a time:
a flipped comparison or `&&`, a nudged integer, a negated `if`, `true` for
`false`. Strings and comments are never touched. If the test fails for any of
them, the file is PROVEN, and the changes it did not notice are named; if it
passes for all of them, it is MISSED. Anywhere else a new file stays
UNPROVEN · not checked.

The counts run in every mode. Modes decide whether an edit is denied, whether
Claude is told, and whether the catch check runs: `warn` and `enforce` check,
`observe` only measures and touches nothing on disk in your project.
