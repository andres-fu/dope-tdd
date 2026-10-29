# Security and data

What Dope TDD runs on your machine, what it sends, and what it keeps.

## Your record

When a session that did anything ends, Dope TDD writes its counts and
receipt to one file on your machine, `~/.dope-tdd/sessions/<date>-<session>.json`.
It never goes in the repository and never leaves your computer. Set
`DOPE_TDD_LOG=off` to keep nothing.

## What Dope TDD runs

Dope TDD is a Claude Code mod. Like every plugin's hooks, the programs it
starts run as you, **outside Claude Code's permission rules, PreToolUse hooks
and sandbox** ([plugin security](https://code.claude.com/docs/en/plugins/security)):
your allow and deny rules for Bash do not apply to them. This is what it
starts, and when:

| When | What it runs | Where |
| --- | --- | --- |
| A module's own test goes green, in `warn` or `enforce` (the catch check) | Node: the runner from your `node_modules` (Vitest, Jest, ava), or `node --test` with the flags your `package.json` test script passes (`--import`, `--require`, `--env-file`, ...), on that one test file | A throwaway git worktree in `.git/dope-tdd/wt` |
| The same, on an experimental stack, only with `"catchCheck": true` | pytest or `unittest` through your `.venv` python, or `uv run` / `poetry run` / `pdm run` / `pipenv run` when a lockfile names one, else `python`; `mvnw`, `gradlew`, `mvn`, `gradle`; `dotnet test`; the Godot binary named in `dope-tdd.json` | Your project folder, with your change undone for one run |
| A red run whose output was cut short, so not every failing test was named, in `warn` or `enforce` (Node; another stack only with `"catchCheck": true`) | The same one-file command, once, to read all the names | Your project folder |
| Around shell commands, edits and checks | `git`: `diff`, `ls-files`, `status`, `rev-parse`, `cat-file`, `symbolic-ref`, `worktree add`/`remove --force`, `update-ref`, `hash-object -w` (the check lock's objects stay in `.git/objects` until git cleans up), and `rm` inside the copy | Your repository. `worktree add` runs with hooks off (`core.hooksPath` at a folder that does not exist), so none of your git hooks run |
| A nested package's `node_modules` during a check | `node -e` to link it into the copy (a junction on Windows, a symlink elsewhere) and unlink it before the copy goes, and to remove the copy | `.git/dope-tdd/wt` |
| A plugin project (`.claude-plugin/plugin.json`) with `"catchCheck": true` | `claude plugin test .` | Your project folder |
| At session start | `node -e` to delete its own session logs older than 30 days, and spike copies older than 7 days | `~/.dope-tdd/sessions/`, `~/.dope-tdd/spikes/` |

Every test run it starts has `CI=1` set and stops after 60 seconds at most.
Its `git` calls and `node -e` helpers run without `CI=1`, with their own
limits (up to two minutes for `git worktree add`). Your
runners can reach the network on their own: `uv run` may sync your
environment, Maven and Gradle wrappers download, `dotnet test` restores
packages. `claude plugin validate .` lists what the mod calls
(`$.process.run`, `$.fs.write`, `$.model.complete`).

For admins: Claude Code's [mods admin page](https://code.claude.com/docs/en/plugins/mods/admin)
shows how to keep user mods from loading (`allowManagedModsOnly`) or to refuse
a mod that calls `$.process.run`. Dope TDD calls it for the runs above.

## What Dope TDD sends

Nothing of its own: no network requests, no telemetry. The one exception is
opt-in and experimental. With `"overrides": { "approver": "model" }`, each
override request the agent makes, except a hotfix or a pause, goes to the model
API through the session's own client, the same API Claude Code already talks to. It sends the request
(scope, kind, path, reason, what ends it, minutes), the module's test path and
its last catch-check verdict, how many requests it has had this week and
today, and up to 120 lines of the uncommitted diff of that module and its
test. Lines that start as a comment (`//`, `#`, `/*`, `*`, `<!--`) are left
out; everything else goes as it is, including the inside of a block comment,
a docstring, and any string literal, so don't turn it on for code that holds
secrets.

## What Dope TDD stores

Everything below lives under your user account.

It never stores the conversation: not your prompts, not Claude's replies.
Two kinds of text you or Claude type are kept: a spike's question (up to 120
characters, in the session log) and override and pause reasons (in
`dope-tdd.overrides.json`, with the session id and time). What carries from
one session to the next is test state only (which modules were unlocked or
left red, with module and test names and the failing tests' names or
message), and the next session's briefing reads it back so Claude picks up
where the tests stand.

To prove a test can fail, it reverts your change, reruns the test and puts the
change back, so it holds a copy of the source file it is checking:

| What | Where | Holds | Kept |
|---|---|---|---|
| Session state | Claude Code's plugin state, held for the session. Claude Code lets any installed plugin read another's state | Before and after text of each file with an open change, counters, module and test names | Until the change is judged or the session ends |
| Catch-check journal | Claude Code's plugin store: a plain JSON file under `~/.claude/plugins/store/`. Only an in-place check writes one | Before and after text of the file being checked, so an interrupted check can put it back | Removed when the check ends; one left behind is settled and removed at the next session start in that project, never from another |
| Unlocks | Plugin store | A test path, a time and a short hash of the test (no text) | 7 days |
| Left red | Plugin store | Each module still red when a session ended: module name, failing test names or message, time | 7 days, or until a session leaves it green |
| Check lock | Git ref `refs/worktree/dope-tdd-check` and plugin store | Module name and time | Removed when the check ends |
| Check worktree | `.git/dope-tdd/wt` | A copy of your checkout, dirty and untracked files included (an untracked `.env` that isn't in `.gitignore` too) | Removed when the check ends |
| Session log | `~/.dope-tdd/sessions/` | Counts, the status receipt (module and test names), how long each one-file run took (module, outcome, milliseconds), each stuck spell (module, failure, runs), the modules left red (module, failing tests), each spike (question, time), the repository folder name (in a linked worktree, the main checkout's), and a digest of all of it, so a hand edit shows; no source text | 30 days; `DOPE_TDD_LOG=off` keeps none |
| Spike copies | `~/.dope-tdd/spikes/` | A git worktree of your project, made by `/dope-tdd:spike` for exploring | Removed by the skill when the spike ends; one left behind is removed at a session start after 7 days |
| Kept changes | `~/.dope-tdd/kept/` (`<temp>/dope-tdd-kept/` with no home folder) | Your edit, only when a file changed during a check and could not be restored. If writing it fails, only its size is logged | Until you delete it; named at every session start |
| Override record | `dope-tdd.overrides.json` in the repo | Each override: scope, kind, reason, what ends it, the decider's role (never a name) and, for the model, its reason, the session id and times, the files edited under it | In your repo, as long as you keep it; commit it with the change |

The session log is evidence of how a session went, not proof. A shell
command that changes an existing record is recorded as a workaround and
Claude is told, and the digest shows a hand edit later. Neither can stop an
agent that reads this code: anything the plugin can write, an agent with a
shell can too. Proof is what the pull-request check below re-runs in CI.

Files matched by `exempt` in `dope-tdd.json` are not captured. The 30-day
cleanup uses `node`; where it is missing, the files stay until you delete
them. Delete `~/.dope-tdd/` at any time. Source text is never written to the
Claude Code log.

## For the plugin directory's reviewer

The directory's scan holds Dope TDD on the warnings below. What the code
behind each one does, checked against 0.2.11 (all in `hooks/register.tsx`
unless named):

- **Includes a mod.** Its code runs inside Claude Code, as the person, like
  every plugin's hooks. It registers no tool that runs code on its own; the one
  tool it adds, `mcp__dope-tdd__override_request`, records a request in
  `dope-tdd.overrides.json` and waits for a person.
- **Starts programs, with a computed command.** Three kinds, each as an
  argument list (`$.process.run(argv)`), never through a shell: `git`, with
  arguments it builds itself; the project's test runner on one test file,
  where the runner comes from the project's own files and the file is the one
  being checked (`runPlan.ts`, `findRunner.ts`); and short `node -e` helpers
  that link and remove its check copy and prune old logs.
- **Writes files.** Only those listed under "What Dope TDD stores", plus
  `dope-tdd.json` on `/tdd setup write`, `dope-tdd.overrides.json`, and its
  check copy under `.git/dope-tdd/`.
- **Reads local data, and can send data out.** It reads the files it checks,
  git's view of the changes, and the test runner's output. The only send is the
  opt-in model approver above (`"overrides": { "approver": "model" }`, off by
  default): `$.model.complete`, through the session's own client, to the model
  API Claude Code already uses. Nothing else leaves the machine; there is no
  `fetch` or other network call.
- **Reads the conversation, and can send data out.** It reads the output of
  Bash and PowerShell calls to find the test runner's summary line, the
  question a `/dope-tdd:spike` run carries, and an override's reason. Of these,
  only an override request's fields go out, and only with the opt-in approver.
