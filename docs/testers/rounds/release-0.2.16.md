# dope-tdd 0.2.16: fewer silent gaps, and a page that says what's left

0.2.16 is about what used to pass with nothing said: a project it couldn't identify, code it can't
pair with a test, and writes that left no record. It also says plainly what still gets past.

## What 0.2.16 changes

- **It works out the project when nothing says** (#268). With no `dope-tdd.json` and no marker, a
  session assumed Node, so a folder of Python or C# wasn't guarded and nothing said so. It now looks at
  the project's file names once and uses that stack and layout from memory, writing nothing. If that
  can't decide, or it's mostly a language Dope TDD doesn't read yet, the briefing says so. C# is paired
  only under `src/`: code in project folders is told that nothing pairs.
- **It says when code goes unguarded** (#259). The first edit of each kind in a session that it can't
  pair with a test is told to the agent, by Edit, Write or a shell write it can see, and `/tdd` lists
  each file. The edit still goes through.
- **A path is the file it names** (#272). `./src/a.ts`, `src//a.ts` and `lib/../src/a.ts` no longer get
  past a refusal.
- **The git check runs after every shell command** (#281, #282). Reads and test runs used to skip it,
  so a write hidden in one left no record. What changed around a command that only looks read-only is
  said once, listed in `/tdd`, and charged to nobody.
- **A write the same command stages or commits still shows** (#292), as `unguarded` in `/tdd`.
- **A config changed through a shell is on the record** (#293). Loosening `dope-tdd.json` from a script
  now counts as a workaround, and the agent is asked why.
- **A redirect beside a test run is the command writing** (#304): `echo x > a.txt && npm test`.
- **`/tdd` says `refused`, as the band does.** It said `blocked`. Older session records still read.
- **New page: [What gets past it](https://github.com/andres-fu/dope-tdd/blob/main/docs/what-gets-past.md).** What the guard can't stop, why it can't be
  a wall, and what to do about it. Read it before relying on a verdict.

With thanks to @KlossKarl, whose tester reports led to much of this, and who is now credited in the
README's Liner notes.

**Known limits:** the shell reader still misses some real writes (#260). Some of those are said after
the command, and some aren't said at all: the page above lists which. A path through a variable it can't expand isn't
refused (#309). `2>`, `&>` and `>&` beside a test run read as harmless, and so does a run's own
output to a file (#260). A `>` in quoted text reads as a redirect (#310). Edits to a language Dope TDD
doesn't read aren't counted, and the briefing says so only when that language leads the project.

## What to check

**Step 0: update.** From inside your project, run `claude plugin update dope-tdd@dope-tdd`, adding
`--scope project` or `--scope local` to match your install, then `/reload-plugins`, then `/tdd`. The
first line should say `version 0.2.16`. With the plugin installed in several projects, the update can
land on a different one. If the version didn't change, run these from inside the project, using
`local` instead of `project` if that's how you installed it:

```bash
claude plugin uninstall dope-tdd@dope-tdd --scope project
claude plugin install dope-tdd@dope-tdd --scope project
```

**Step 1: a project with nothing to go on.** Open a session in a folder of just `.py` files, with no
`dope-tdd.json`, `requirements.txt`, `pyproject.toml`, `setup.py` or `conftest.py`, or in a C# repo
with only a `.sln` and its code under `src/`. Ask Claude what the session briefing says about the
project. Expect it to say the project was read from its code. Then ask Claude to edit a source file
with no test touched. Expect a refusal naming the test.

**Step 2: code it can't pair.** In a guarded project, ask Claude to edit a code file no layout covers,
or one in another language, such as `tools/gen.py` in a Node project. Expect the edit to go through,
a line to the agent the first time, and the file listed in `/tdd`.

**Step 3: a path with dots.** Ask Claude to run `echo 1 >> ./src/<a source file>` with no test touched.
Expect a refusal.

**Step 4: a script's write.** Pick a source file whose test hasn't been touched this session. Ask
Claude to write a short script that changes it, then run the script and `git add` that file in one
command. Expect it to go through, and `unguarded` in `/tdd` to go up by one.

**Step 5: a loosened config.** Ask Claude to run a script that sets `"mode": "observe"` in
`dope-tdd.json`. Expect a line asking why, and `/tdd` to count a workaround. Put it back afterwards.

**Step 6: the word.** After a refusal, run `/tdd`. Expect `refused` and its count on the test-first
row, and `refused <module>` in the events.

**Question for Karl:** the outside-project wording was to change in this release, and it didn't, since
what it should say isn't on record. What did you want it to say?

Paste the exact lines for each step. Anything that doesn't match is a finding.
