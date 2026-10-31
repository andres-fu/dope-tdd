# 2026-10-30: How much review a change gets

Status: decided 2026-10-30. Part of the 0.2.15 review-process release. The rules themselves are in
`.claude/CLAUDE.md`, under Review; this is the reasoning and the evidence.

## The problem
Every change here gets the same treatment: test first, a deliberate break, CI, one person merging.
That says nothing about how hard to look at a change before it merges, and the size of a change is the
wrong signal: a one-line change to how a shell command is read can let an untested edit through.

[Anthropic's post on how the Claude Code team reviews code](https://claude.dev/blog/solving-code-review-at-anthropic/)
(2026-10-15) asks one question of every change: what could go wrong, and which check is the right one
to catch it? It sets risk from the change, not its author. This adopts that at the size of this project.

## What was decided
- **Every change gets a fresh-context review**, from the `reviewer` agent, before its pull request opens.
- **Listed paths also need a person** to read the evidence.
- **Security review runs once per release.**
- **The rules live in `.claude/CLAUDE.md`**, which every session and review loads.

## Why these paths need a person
`hooks/` is the product. An untested edit let through silently, a verdict word that overclaims and a
misparsed shell command all live there, including in `hooks/messages.ts`, where a sentence can claim
more than was proven. So all of `hooks/` is listed except the three files that draw and format. Naming
the safe files fails safe; naming the risky ones would miss the next new module.

`tools/pr-check/` is what other people's CI runs. `tools/guard/`, `dope-tdd.json` and
`.claude/settings.json` are how this repo holds itself to the rules, and `.claude/CLAUDE.md` and
`.claude/agents/` are the rules. `.github/workflows/` and `tools/release/` can publish. `skills/` are
instructions agents follow, and `.claude-plugin/` decides what users install.

## How this differs from the post
- **Two levels, not three tiers.** There, a tier sets how many people must approve. There is one
  maintainer here, so the only question is whether a person reads it. Three tiers were tried first:
  of the last 74 merged pull requests 50 would be High, 17 Medium and 7 Low, and Low and Medium would
  both just be reviewed.
- **A project subagent, not a product on every pull request.** The post names a fresh-context subagent
  as the option before a pull request. The managed Code Review service and the GitHub Action would run
  it automatically; we start without them. So nothing forces the review to run. If reviews get skipped,
  the Action is the next step.
- **No `REVIEW.md`.** Only the managed service reads that file. Local `/code-review` reads `CLAUDE.md`.
- **Security review per release, not per pull request.** `/security-review` compares against `main`, so
  on a pull request into `release` it reviews the whole unreleased batch anyway, and nothing reaches
  users before `main`.
- **Left out on purpose:** two-person approval, a merge queue, feature flags, classifiers and
  `CODEOWNERS`. There is one maintainer, and the `release` branch and tester rounds already do the job
  of a staged release.

## Checked against the record
An eval on 2026-10-30 ran fresh-context reviews, reading a snapshot of the code at each commit:

| Commit | Prompt | Target | Result |
| --- | --- | --- | --- |
| The change behind #191 | neutral | #191 | Found it, and found #192 too |
| The change behind #233 | neutral | #233 | Missed it; other findings in the same area |
| The change behind #250 | neutral | #250 | Missed it; other findings in the same area |
| The #239 fix, picked as clean | neutral | none | Not clean: it found #260 |
| The change behind #257 | hinted | #257 | Found it |
| The change behind #258 | hinted | #258 | Found it, and three more |

So review finds real bugs, and it misses some: it complements tester rounds and does not replace them.
Each took between two and a half and seven minutes. There was no clean sample, so the false-alarm rate
is still unknown. The findings tested against the code held up; the worktree ones were not all
rechecked. The prompt matters, so the `reviewer` agent keeps its instructions in the repo.

## What would make us change this
Over the next two releases, record for each review how many findings it gave and how many were wrong,
and count tester-found bugs against review-found ones. Baseline on 2026-10-30, before this eval, all issues:
15 from testers, 11 from dogfooding, 7 from review, and no reverts in the repo's history. Findings fixed before
a pull request never become issues, so the review line in the pull request is the count that matters.
Change a path or drop a step by a pull request that names the evidence. Stop and rethink if most
findings are wrong, or if usage becomes a real limit.
