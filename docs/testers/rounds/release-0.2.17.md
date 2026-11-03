# dope-tdd 0.2.17: fewer false refusals, a truer PROVEN, and a nudge toward Edit

0.2.17 is the round 8B release. Every step in the 0.2.16 note passed on that round, so this one fixes
what the round found beside the steps, plus what review found in the same week.

## What 0.2.17 changes

- **A write from a shell names only what its shape names** (#332). A PowerShell verb or `sed -i`
  anywhere in a command, quotes included, used to make every source path the command mentioned a
  write, so a here-string naming `api.py`, a `grep` whose pattern named the verbs, or an issue body
  pasted into `gh` were refused as edits to files they never touched. Now the verb must be the shell's
  own word, and the target is the path after the verb or after `-Path`, or sed's file arguments. In a
  PowerShell command, a here-string is one quoted span; Bash has none. A target the shape can't name,
  such as `-Path $p`, is said after the command instead, as unguarded.
- **The override record is still read eagerly.** A command that names `dope-tdd.overrides.json` or
  `dope-tdd.json` beside a write verb is a write to it, even when the name only sits in a note's text,
  as in 0.2.16 (#322 stays open). A findings note written with `Add-Content` that names the record is
  refused, so write such a note from a file.
- **A forged record behind a git command is put back** (part of #348). A script after a PowerShell
  here-string commit message read as git alone, so a change it made to the record stayed. The command
  is now split the way its shell runs it. A here-string git command piped to something else, such as
  `| Select-Object`, has a pulled-in record put back, as its plain form always did.
- **PROVEN reads the disk** (#285). After a deliberate break was put back, a script or formatter could
  change the file and the word stayed. Now the file is compared with the code put back; a difference
  reads UNPROVEN: "the file changed after you put it back".
- **The pull-request check is judged by the base's config** (#319). A pull request could pass by
  adding an exemption or switching the mode off in its own `dope-tdd.json`. The check now reads the
  base's copy, and the report says so when the pull request changes it.
- **A script's change points to the Edit tool.** The line for a shell write with no test touched, and
  the verdict for a change the catch check couldn't capture, now say to use the Edit tool next time,
  and why.
- **Smaller:** a green says whether its own module saw red, not the previous one's (#311). A file with
  a non-ASCII name is seen by the shell check (#299). A helper in a `__tests__` folder beside the code
  is not source (#275). `/tdd receipt` names the branch it compares with (#269). Under `observe`,
  `/tdd` no longer says the catch check is on (#336). The outside-project notice reads "and nothing
  else outside it is guarded this session either", and the unpaired-code notice "and other code like
  it won't be guarded this session either" (#338, a tester's wording). The session record's digest is
  said to be checked by hand (#294). A `sed -i` inside text handed to a shell (`eval "…"`, `ssh host
  "…"`) names its file again (#350).
- **README:** with a `--scope local` install, `/cd` into a worktree unloads the plugin until `/cd`
  back, with nothing said. Whether project and user installs stay on is untested (#339).

With thanks to Karl Kloss for round 8B, which found most of this.

**Known limits, open from round 8B:** the band can read `committed` for uncommitted work in a worktree
(#333), keep a stale `refused` line under observe or after an unguarded write (#334), say NOT
WATCHING while refusing (#335), and merge two checkouts under one module name (#337). Those are the
next wording pass. `/cd` at local scope is Claude Code's loading, reported separately (#339).

**Known limits, found by this release's reviews:** some PowerShell quoting the reader doesn't model (a
`#` comment, `--%`, a backtick escape, `$(…)` in double quotes) can hide a source write from the
refusal; the check after the command still counts it where git sees the file (#347). A test run inside
`(cd elsewhere && …)` is counted as this project's run (#352).

## What to check

**Step 0: update.** From inside your project, run `claude plugin update dope-tdd@dope-tdd`, adding
`--scope project` or `--scope local` to match your install, then `/reload-plugins`, then `/tdd`. The
first line should say `version 0.2.17`. If it didn't change, uninstall and install again with the
same scope, from inside the project.

**Step 1: the here-string that was refused.** Repeat round 8B's 5.5 command, or any PowerShell
`Add-Content -Path $p -Value $t` whose here-string names a source file. Expect it to run, with no
`dope-tdd:` line. Then `Set-Content src/<a source file> x` with no test touched: expect a refusal.

**Step 2: a script's write.** Write a short script that changes a source file whose test hasn't been
touched, and run it. Expect the line to contain "Use the Edit tool for code changes next time."

**Step 3: `/cd` at project scope.** With the plugin installed `--scope project` in a repo whose
committed `.claude/settings.json` enables it, `/cd` into a worktree under `.claude/worktrees/`. Does
the band stay? Does `/tdd` answer? This is the untested half of #339.

**Step 4: observe.** Set `"mode": "observe"` and `"catchCheck": true`, run `/tdd`. Expect
`catch check: not under observe (dope-tdd.json sets it on)`. Put it back.

**Step 5: the words.** In a fresh session, since each notice is said once a session, edit a file
outside the project, and a file no layout covers. Paste the two notices.

Paste the exact lines for each step. Anything that doesn't match is a finding.

**First round, for a new tester:** before the steps above, say which OS and shell, which language and
test runner, and whether you'll use it on real work or a fixture. Then install at `--scope project`
in one repo, run `/tdd`, and try the three things in the README's "Try it in ten minutes". Paste what
the band and `/tdd` said at each one, and anything you didn't believe.
