# What gets past Dope TDD

Dope TDD keeps an agent test-first and on the record. It is not a security
boundary. This page says what gets past it, why, and what to do about that, so
you can decide how far to trust what it tells you.

Most of this was run on real git and through the plugin's test kit, which fakes
Claude Code, not in a live session. Anything only read from the code says so. The
numbers link to the issue that tracks each item.

## Why it can't be a wall

Three facts set the limit. None of them is a bug that a fix would remove.

- **A shell can do anything, and the guard only has its text.** It reads a command
  before it runs. A script, a formatter or a configured program does things the
  command's text never shows, so reading the text can't settle what will happen.
- **It runs with the agent's own access.** Its checks run on your machine, as you,
  and so does the agent's shell. Anything the guard writes, the agent can reach.
- **Nothing here is signed.** A signature needs a secret the agent can't read, and
  a local tool has nowhere to keep one.

So a refusal stops the honest mistake, which is what the guard is for: an agent
editing code before it has a test. A record shows what happened. Neither stops an
agent that sets out to beat them.

## What gets past a refusal

Some routes need no trick at all. A test only has to be touched to unlock its
module, so adding a comment to a test file lets the next edit through, and so does
deleting it ([#300](https://github.com/andres-fu/dope-tdd/issues/300)). A shell
command can change `dope-tdd.json`, and the guard then follows the new settings
from the next command. That's recorded and said, and it stops nothing. A change
that arrived with a git rewrite alone, `git checkout other -- dope-tdd.json`
included, isn't counted against anyone, and neither is one around a command Claude
Code held read-only or one that only looks read-only and doesn't name the file. A
loosening during any other command is counted against it, even if a person saved
the file in an editor meanwhile. A command judged in a worktree that changes the
main checkout's config isn't seen, and neither is a change between sessions. During a merge, rebase
or cherry-pick nothing is guarded, and that state comes from a marker file in
`.git`. The band says STANDING DOWN.

Otherwise, a refusal needs the guard to name the file before the command runs.
These aren't refused, and the last column says what the guard does instead.

| What | Example | What the guard does |
|---|---|---|
| A program it can't see inside | `python3 fix.py`, `make`, `prettier --write` | After the command, git shows the change and it counts as unguarded |
| A write committed, then a pull or checkout in the same command | `python3 fix.py && git commit -qam x && git pull --rebase` | Nothing: the pull moves the commit the check compares with |
| A write committed with no reflog to read | A repository with `core.logAllRefUpdates=false` and no `logs/HEAD` | A line in the log, nothing in `/tdd`: it can't tell a commit from a pull |
| A write committed by plumbing | `python3 fix.py && git add -A && git update-ref HEAD "$(git commit-tree ...)"` | Nothing: only `git commit` reads as a commit |
| A new file staged in a repository with no commit yet | `python3 fix.py && git add -A` | Nothing: there's no commit to compare with |
| A gitignored file in a watched folder | A generated file under `src/` | Nothing: git doesn't report it ([#297](https://github.com/andres-fu/dope-tdd/issues/297)) |
| A write spelled in a way it doesn't read | `sort -o src/a.ts src/b.ts`, `ls >& src/a.ts`, `echo x 2> a.txt && npm test`, `Set-Content -Pat "src/a.ts" x`, `Set-Content -Path 'src/a.ts','src/b.ts' x`, `& 'Set-Content' "src/a.ts" x` | Said once for that file, charged to nobody; a PowerShell write that looks like a write is charged as unguarded ([#332](https://github.com/andres-fu/dope-tdd/issues/332)) |
| A write hidden in a read or a test run | `echo "$(sed -i ...)"` | Said once for that file, charged to nobody |
| A path through a variable it can't expand | `echo 1 > "$ROOT/src/a.ts"`, `npm test > "$ROOT/src/a.ts"`, `Set-Content -Path $p x` | Not refused. If it lands in a watched folder of the checkout the command ends in, git shows the change after the command: the first and third count as unguarded, the second is said once and charged to nobody ([#309](https://github.com/andres-fu/dope-tdd/issues/309), [#332](https://github.com/andres-fu/dope-tdd/issues/332)) |
| A write hidden beside a git rewrite | `git restore a.ts; echo "$(sed -i ...)"`, `git restore a.ts && git tag -a -m "$(./fix.sh)" v9`, `git rebase --exec ./fix.sh HEAD~1` | Nothing: the change counts as git's ([#284](https://github.com/andres-fu/dope-tdd/issues/284)) |
| A write outside the folders it watches | A file outside `src/` and `tests/`, with the default layout | Nothing, unless the command names it |
| A project with no git repository | A script's write | Nothing: the check after a command needs git |
| A job left running after its command ends | `(sleep 5; ./fix.sh) &` | Nothing, unless it lands while a later command runs. Then that command is charged |

Where the guard reports a write, the write has already landed. Nothing is put back.

[How it works](how-it-works.md) has the detail on each check, and
[#260](https://github.com/andres-fu/dope-tdd/issues/260) tracks reading more of
these before they run.

## What can make a verdict say too much

A verdict is what the guard saw, and these are the gaps in what it sees.

- **PROVEN means the test catches this change.** It doesn't mean the test is a good
  one, or that the code is right.
- **A change the guard reported can miss the next verdict.** A source file that
  changes during a run ending red, or a module changed with no test on record,
  doesn't reach the green's verdict
  ([#323](https://github.com/andres-fu/dope-tdd/issues/323)). A file changed after a
  break was put back reads UNPROVEN.
- **The catch check often can't run, and it says so.** An edit made by a script
  reads **UNPROVEN · not checked: change not captured**. On a strict runner such as
  `node --test`, a change that adds an export can't load its test with the change
  undone, and reads the same way. Those are the safe answer, not a pass, so count
  them as unproven.

## What can forge the record

`dope-tdd.overrides.json` holds the overrides that let an edit through without a
test, so it is the file most worth forging. An Edit or a Write to it is refused.
A shell command that changes it is refused if the guard can read that, and has it
put back as a workaround if not.

**The exception is a command of git alone**, because a pull or a merge can
legitimately bring in other people's overrides, and putting those back would lose
work. Telling the two apart is the part that can't be done. A command can read as
git and still run a script:

- Something hidden in it: `git status "$(./forge.sh)"`.
- An option or alias that runs a program: `git -c alias.x='!./forge.sh' x`,
  `git rebase --exec ./forge.sh HEAD~1`.
- A hook, or anything configured to run, which the command's text never shows.

A record changed that way stays, with no line and no workaround, and an approval in
it works. A job left running does the same from any command, since it lands after
the comparison.

Two fixes were built and dropped, and a third was refused on paper. Each one either
let forgeries through or put back real work
([#283](https://github.com/andres-fu/dope-tdd/issues/283)). Blocking this locally
isn't reliable, and being wrong loses someone's work, which is the worst failure
this project has. So it stays open as a known limit.

**An entry doesn't prove who approved it.** The file is plain text, and nothing in
an entry can show where it came from. A forged entry saying a person approved it
looks like a real one. That comes from reading the code, not from a run.

Three smaller gaps sit beside this one:

- A linked worktree's record isn't watched
  ([#289](https://github.com/andres-fu/dope-tdd/issues/289)).
- A one-change override covers any number of shell writes
  ([#288](https://github.com/andres-fu/dope-tdd/issues/288)).
- The backstop can throw away a person's approval made during a command, or put the
  record back onto a branch without it
  ([#290](https://github.com/andres-fu/dope-tdd/issues/290)).

**Session records are the same.** A digest on a record in `~/.dope-tdd/sessions/`
shows a hand edit only if someone checks it, and nothing you run does: it's checked by
hand, with `verifyRecord` in `hooks/sessionLog.ts`
([#294](https://github.com/andres-fu/dope-tdd/issues/294)). An agent that reads the
code can recompute it anyway. The counts in `/tdd` and the receipt are evidence of
an honest session, not proof that one was.

## What to do about it

- **Read `dope-tdd.overrides.json` in every pull request that changes it.** Ask who
  approved each new entry, and don't take the file's word for it.
- **Run the [pull-request check](pr-check.md) in CI with `fail-on: untested`.** It
  works from the diff, outside the agent's session, and never reads the override
  record. By default it passes a change with no test, which is exactly what an
  override lets through, so set that option if you want those to fail. It does read
  `dope-tdd.json` from the pull request it judges, so review a change to that file
  too: a pull request could exempt itself.
- **Count UNPROVEN as unproven,** and read `/tdd` for workarounds and for changes
  charged to nobody.
- **Use a sandbox if you don't trust the agent.** Claude Code's permissions and an
  isolated environment are the tools for that. Dope TDD is not.

If you find a way past it that isn't on this page, please file an issue. As
[SECURITY.md](../SECURITY.md) says, getting around its rules is a bug, not a
security problem.
