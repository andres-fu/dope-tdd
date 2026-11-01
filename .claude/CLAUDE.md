# Dope TDD

A Claude Code plugin that refuses edits to untested code and proves each test by undoing the change
and rerunning it. The repo is public, and the plugin guards its own development here
(`dope-tdd.json`).

This file loads in every session in this repo, and review follows it, so it holds the project's rules.
Personal notes belong elsewhere. It lives in `.claude/` because the repo root is the plugin root, where
`claude plugin validate --strict` refuses a `CLAUDE.md`.

**Keep it true.** A change that makes a line here out of date updates that line in the same pull
request. Review flags one that doesn't.

## Goals and non-goals

- Verified evidence for each change: the test was seen red, and it catches the change.
- Most useful on existing code: bug fixes and debt in untested code, plug and play, with a UI that
  explains itself.
- Cheap in model use and seconds. A slow guard gets turned off.
- Claude Code only.
- Cheat detectors advise and record. They never block.

## Commands

```bash
node --import ./tests/node/register.mjs --test tests/runPlan.test.ts   # one test file
npm run check -- --all   # once, before opening a pull request; CI also runs the tools/ tests
npm run golden           # after changing a message's words
npm run diagrams         # after changing tools/diagrams/is-it-on.mjs
npm run compare -- --sessions   # before the first review of a change to hooks/
```

[CONTRIBUTING.md](../CONTRIBUTING.md) has the build, the test layout, the release steps and the live
runs.

## How we work

- **Branch from `release` and open pull requests into `release`.** Only the release pull request goes
  into `main`. A pull request stacked on another's branch merges into that branch, so retarget it once
  its parent merges.
- **Bugs become issues first**, with the template's `area:`, `stack:` and `source:` labels. Add `ready`
  only when the fix is small and clear. The fix's pull request says `Fixes #N`, and the release pull
  request lists it, since only a merge into `main` closes an issue. A feature gets no issue: its pull
  request says "No issue: a feature, tracked in <where>".
- **One pull request per item, test-first.** Each fix is broken once on purpose, to prove a test
  catches it.
- **Prove first, then review.** Before the first review of a change to `hooks/`, run the comparison,
  account for each kind of change it reports, and do the deliberate breaks, so review time goes to
  design. Run it again after a review fix that changes behaviour. It plays no test run or catch check,
  so clean counts say nothing about those. The pull request gives its counts, never its commands: they
  come from private session logs.
- **One pull request per sitting.** A person merges every change, and reads worse at the end of a long
  stretch. An agent stops once one is green and reviewed, and starts the next only when asked. A merge
  alone isn't asking.
- **Docs go in the same pull request.** A behaviour change updates whichever of `README.md`,
  `docs/testers.md` and `docs/how-it-works.md` describe it, and the pull request says which changed.
- **Correctness before UI.** Every verdict word carries its context. Workarounds (config loosened, test
  bent, skipped, assertion removed) are tracked as signals.
- **Triaging a tester report:** first confirm which build they ran, since an installed copy shows only
  `plugin.json`'s version. Then split each finding into its claims and map every claim to an issue
  before closing the triage.
- **Public writing is neutral and factual.** No local paths or usernames. Describe other people's
  projects generically, and name testers only with their consent. Check every claim in a public reply
  against git, not memory.
- **Voice:** music and hip-hop metaphors in product copy. Evidence stays plain.

## What failure looks like here

Dope TDD asks people to trust what it says about their code. It fails when that trust is misplaced.
Look for these first, when writing code and when reviewing it.

1. **It lets an untested edit through silently.** A write the guard should have seen reaches the disk
   with no refusal and nothing on the record: a new tool, a new way to spell a shell write, a worktree
   read against the wrong root. Unsure must fail safe and say so.
2. **A verdict word overclaims.** PROVEN, MISSED, green or `guard: ON` says more than was seen: a green
   read from an exit code instead of the runner's summary line, a catch check that ran no tests, a
   count that credits work not done this session.
3. **It misreads a shell command.** Quoted text taken for a write, the wrong result kept from a command
   with two runs, a command judged in the wrong folder. A false refusal stops good work, and a missed
   write is failure 1.
4. **It loses someone's work.** The catch check undoes a change on disk and puts it back. Anything that
   can leave a file reverted, or overwrite an edit made in the meantime, is the worst bug here.

These are findings too:

- A behaviour change that leaves a doc describing the old behaviour.
- A new decision in `hooks/register.tsx` or `hooks/draw.tsx`. Those files are exempt from the guard, so
  decisions belong in a pure module beside them, with its own test.
- A fix that handles one surface when the same rule applies on others.
- A test that passes with the change undone, or a test weakened to get a green.
- Anything in `tools/pr-check/` or `.github/workflows/` that runs text it did not write.
- A change that makes a line in this file out of date.

Style alone is not a finding. Neither is a preference the code around it does not share.

## Review

**Every change gets one review before its pull request opens**, from the `reviewer` agent
(`.claude/agents/reviewer.md`). Nothing forces this yet, so it holds only if we keep to it. Fix or answer
every finding, and paste the report in the pull request. A fix that changes behaviour gets another
round; the pull request counts findings across all rounds.

**These paths also need a person:**

- `hooks/`, except `hooks/draw.tsx`, `hooks/theme.ts`, `hooks/timeText.ts`
- `tools/pr-check/`, `tools/guard/`, `tools/release/`, `.github/workflows/`
- `skills/`, `.claude-plugin/`
- `dope-tdd.json`, `.claude/settings.json`, `.claude/CLAUDE.md`, `.claude/agents/`

The person reads the pull request's Evidence and Risk sections, which carry the receipt and the review's
report, and writes what the checks would miss, in their own words. An agent leaves that line empty. An
agent's approval never counts as a person's.

**Only a person merges.** An agent stops once a pull request is green and reviewed, whatever it touches.

**Each release**, pull `release`, run `/security-review` on it before opening the release pull request,
and fix or answer every finding. It compares against `main`, so one run covers the batch. The release pull
request adds no other review.

**Report.** Start with the count: `2 Important, 1 Nit, 1 Pre-existing`, or `No findings`. Give each
finding a file and line, and say what goes wrong, with what input.

- **Important**: one of the failures above, or anything that should stop the merge.
- **Nit**: worth fixing, not worth waiting for. Three at most per review.
- **Pre-existing**: a real problem this change did not cause. It becomes an issue, not a blocker.

If you can't point to a line or say what goes wrong, it isn't a finding yet: say what you checked and
could not confirm. Flag the class of bug, not each case. After three rounds of review and fixes, stop
and rethink the approach. A finding that keeps coming back belongs in a test or in this file.

**Skip** `playground/` (its bugs are planted), `assets/is-it-on.svg` (review
`tools/diagrams/is-it-on.mjs`), `tests/fixtures/runnerOutputs.ts` (real runner output), and earlier
releases in `docs/testers/rounds/` and `docs/decisions/` (a record of what was said then). Don't skip
`tests/fixtures/messages.golden.ts`: its diff is every sentence the agent will read differently.
