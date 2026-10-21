# Process hardening and Agent OS: running tab

Started 2026-10-21. One place for everything we're discussing, so we can weigh it and pick an order.
Status: **agreed** (you said yes), **proposed** (my suggestion, not decided yet), **open** (a question for you), **done**.

## The big picture (2026-10-21)

| Layer | What it is | Status |
| --- | --- | --- |
| Engine | the Claude model | done (Anthropic) |
| Harness | Claude Code: sessions, worktrees, scheduled tasks, phone access | done (Anthropic) |
| Rules and roles | agent-os: charter, 7 roles, skills, CI gates, principal review, lessons, decisions | done, v0.1 |
| Enforcement | dope-tdd (test-first in every session), CI gates, branch guard, ruleset | mostly done |
| **Operating the team** | a work queue (issues, board), a runner (night shift), a room you watch, a daily log | **missing: this is what makes agent-os do the work** |

agent-os today is a rulebook and checks: you are the one running the team. Everything designed today
is the missing bottom layer, and it belongs **in agent-os**, not in dope-tdd. **Decided 2026-10-21:**
- the night shift moves out of dope-tdd (#163 closed unmerged) into agent-os, as a spec first
  (agent-os's own loop: idea, then a spec the stakeholder approves, then a plan, then code);
- agent-os's first real project is agent-os itself: build the operating layer there, test-first,
  guarded by dope-tdd;
- dope-tdd keeps its own small backlog and is run by the agent-os night shift like any other project.

## Goal

Harden how we build dope-tdd with automated guardrails, keep it simple, then use dope-tdd
and the same guardrails to start building Agent OS.

Principle: **a mistake that happens twice becomes a check, not a note.** CLAUDE.md and memory
notes are context Claude reads; they enforce nothing. The docs say so too: to block an action,
use a PreToolUse hook. Only hooks, CI and GitHub settings actually stop anything.

## Decisions so far

| Decision | Status |
| --- | --- |
| Behaviour changes update README and docs/testers.md in the same PR | agreed (saved as a working rule; #154 caught the docs up) |
| Version bumps go out last, before we tell testers | agreed (0.2.3 is the release; it merged early, see the misses below) |
| Every bug becomes a GitHub issue; the fix PR says `Fixes #N` | **done**: labels, bug and PR templates (#161); #160 closed itself on merge. Bugs only: a feature's PR says why it has no issue |
| Keep it simple: a few high-level rules, enforced by checks | agreed |
| Harden first, then start Agent OS | agreed |
| Branch protection on `main` (PR plus both CI checks, no force push or deletion, no bypass) | **done**: ruleset 25573409, applied 2026-10-21 |
| Build our own small team room instead of adopting agentchattr | agreed |
| Night shift v1 opens PRs but never merges; you review in the morning | proposed; moving to agent-os as a spec |
| The operating layer (queue, runner, room, log) is built in agent-os, with agent-os as its own first project, guarded by dope-tdd | agreed |

## Misses we saw (why we're doing this)

- Docs not updated for #150, #152 and #153.
- Work started on `main` without a branch (#157; caught before the commit).
- A PR description quoted a test count nobody saw. Twice, a test's expected text was written without checking it.
- Ran a bare `python` despite a note saying it hangs here; a shell edit garbled the debt ledger.
- Filtered test output hid the summary line, so dope-tdd logged 13 runs as unread.
- Two version bumps (#151, #156) merged before the fixes they were meant to follow.
- Guessed why `/tdd` was missing instead of checking first.
- Recent findings never became issues: the newest issue is #76; rounds 2-4 live in PR descriptions, the ledger and Downloads.

## Proposals

| # | Item | Build or adopt | Status |
| --- | --- | --- | --- |
| 1 | Branch guard: block `git commit` and `git push` on main (PreToolUse hook reading the branch from the hook's `cwd`), plus GitHub branch protection on main | build (hook) and a GitHub setting | **done**: hook in #161, ruleset on main |
| 2 | Command guard: block known-bad commands on this machine (bare `python`, `python3`) and warn on test output filtered in a way that hides the summary | build (same hook script) | proposed |
| 3 | Repo CLAUDE.md: about 8 rules, only what checks can't enforce | build | proposed (draft rules are below) |
| 4 | CI: a PR touching hooks or messages must touch README or testers.md, or say "docs: none needed" | build (small GitHub Action) | proposed |
| 5 | CI: only the release workflow may change the version in `plugin.json` | build | proposed |
| 6 | Release workflow: one button that checks main is green, bumps, tags, drafts the tester note and pulls the installed copy | build | proposed |
| 7 | New-user smoke test: fresh home folder, `claude plugin validate --strict`, `claude -p --output-format stream-json` checking `plugin_errors`, `/tdd setup` and one red-green cycle on a Node and a Python sample | build from built-in parts; `claude plugin eval` for scored runs | proposed; CI needs an API key secret (open question) |
| 8 | Fast single-file test run: `npm run t -- <file>` that always prints the summary line | build | proposed |
| 9 | Issues: a small label set (area, stack, source, kind), an issue template, and a pattern query before each release (3+ issues in one area means add a guardrail) | build with `gh` (no plugin needed) | **done** except the pattern query (labels and templates in #161) |
| 13 | CI: a PR that changes code for a bug must name its issue (`Fixes #N`); other PRs say why there's none | build | proposed |
| 14 | GitHub as the Scrum board: issues for stories and tasks too (not only bugs), sub-issues for tasks, a milestone per sprint or release, a free GitHub Project board (Backlog, Ready, In progress, Review, Done, with an Iteration field). agent-os's product-manager role owns the backlog; the night shift takes from Ready. Docs stay in `docs/` (reviewed in PRs), not the wiki | adopt GitHub features (free) | proposed 2026-10-21; if agreed, reopen #162 as the night shift's story |
| 10 | Cross-stack checks: one test table that runs every runner's sample output through each shared rule; parallel agents per stack for bigger sweeps | build (table); adopt the built-in Workflow tool and subagents with worktrees | proposed |
| 11 | Tester rounds: a fixed scenario script (the same as #7) plus free exploration; reports saved in the repo, not Downloads | process | proposed |
| 12 | `/ship` skill: refuses on main, runs the checks, writes the PR description from output it saw | build, or adopt commit-commands and add our checks around it | proposed (see plugins) |

Draft rules for item 3: work on a branch (hook); test first, see it fail (dope-tdd); every number
in a PR or reply comes from output seen this session; behaviour changes update docs in the same
PR (CI); releases only through the release workflow (CI); a repeated mistake becomes a check;
one concern per PR, follow-ups as issues; check before you explain.

## Build vs adopt: Anthropic plugins and built-ins

Researched 2026-10-21 by reading the official marketplace READMEs and code, and the Claude Code docs, in full.

| Option | What it really does | Verdict |
| --- | --- | --- |
| commit-commands (Anthropic) | `/commit`, `/commit-push-pr` (makes a branch if on main, opens the PR), `/clean_gone` | **adopt** (trial); its PR description comes from commits, so claim-checking stays ours |
| code-review (Anthropic) | 4 parallel reviewers, only issues scoring 80 or more; needs `gh` | **adopt**: `/code-review` is already in this session, so use it before each merge |
| pr-review-toolkit (Anthropic) | 6 review agents; `pr-test-analyzer` judges test gaps | **trial** for the test-gap agent |
| claude-md-management (Anthropic) | audits CLAUDE.md against the code; `/revise-claude-md` captures lessons learned | **adopt** once the repo CLAUDE.md exists |
| plugin-dev (Anthropic) | hook-development skill with schema, test and lint scripts for hooks | **trial** when writing the guard hooks |
| hookify (Anthropic) | regex rules in `.claude/*.local.md` that warn or block; `/hookify` turns a conversation into rules | **skip for now**: its hooks call `python3`, which on this machine is the Microsoft Store placeholder (it exits 0 having printed "not found"), so the rules would silently never fire. It also can't see the git branch. |
| security-guidance (Anthropic) | pattern warnings, plus model reviews at Stop and on commit; advisory only; sends diffs to the model | **skip for now** (token cost and data sent); revisit for Agent OS |
| feature-dev (Anthropic) | 7-phase feature flow with parallel explorer, architect and reviewer agents, gated on your approval | **adopt for Agent OS** feature work |
| ralph-loop (Anthropic) | Stop-hook loop; unlimited unless a cap or completion promise is set; needs bash, jq and perl | **skip** |
| Built-ins | `claude plugin validate`, `plugin test`, `plugin eval`, `claude -p` stream-json init events, `--worktree`, subagents with `isolation: worktree`, the Workflow tool, `claude-code-action` | **adopt** as parts for #7 and #10 |

Gaps nothing covers, so we build them: a branch-aware guard, a docs-sync gate, release ordering,
checking PR claims, and pattern tracking across issues.

## What agent-os already has (read 2026-10-21)

andres-fu/agent-os (private, plain Node ESM `.mjs`, no dependencies, `node --test`, about 7,800 lines)
already contains much of what we proposed above for dope-tdd:

- **A charter** (CLAUDE.md): honesty rules ("CI is the only source of tests pass", label claims as
  observed, inferred or unknown, `BLOCKED` when stuck), cost rules, and security triggers.
- **Seven roles** in `.claude/agents/`: product manager, engineering manager, developer, principal
  engineer, security and compliance, QA, UX reviewer.
- **Gates** in free CI with no model: tests, a check that lessons have evidence, secrets (gitleaks),
  semgrep, an npm audit, and flags on edits to existing tests. Actions are pinned to commits.
- **Merge authority**: authors never merge. A principal-engineer review runs in CI from main with
  read-only tools and posts a required status; GitHub merges when everything is green, and the
  stakeholder merges protected paths.
- **A lessons ledger** (L-0001 to L-0014) with an "enforced by" column (gate, hook, agent rule or
  none). This is our principle that a repeat mistake becomes a check, already built.
- **A PR evidence receipt template** (failing run seen, CI run link, criteria mapped to tests).
- Skills `/onboard`, `/retro` and `/escalate`; a `docs/decisions/` meeting room.
- A dope-tdd catch-check job in gates.yml, commented out because dope-tdd is private.

**So:** proposals 3 (charter), 4 to 5 (CI gates), 9 (issues and patterns, through lessons), 11 and
12 overlap with agent-os. Rather than building them twice, **dope-tdd could adopt the agent-os
template** and become its first real project. Status: proposed.

## Agents talking to each other and to you: Anthropic's options (docs, read 2026-10-21)

| Option | Agent to agent | Agent to you | Plan, maturity | Fit |
| --- | --- | --- | --- | --- |
| Cross-session messaging (`SendMessage`, `ListAgents`) | peer to peer, by name; plain text; not durable (the receiver must be running) | one-line previews in the transcript; messages can be held for your approval | on by default; native Windows from v2.1.234 | **yes**: the bus between role sessions on your machine, today |
| Remote Control | across machines, through it | browser and phone UI with push notifications; permission prompts reach your phone | Pro, Max, Team, Enterprise; claude.ai login (no API key) | **yes**: your "chat UI" to each session today, with approvals |
| Agent teams | lead plus teammates; shared task list and mailbox | agent panel under the lead's prompt | experimental, interactive only (not `-p` or the SDK) | maybe, for one sitting; not unattended |
| Channels (Discord, Telegram, iMessage; custom servers) | no, it connects a chat to one session | the chat app itself, two-way | research preview; needs Bun | **a cheap Discord bridge** for one session each |
| Claude Tag (Slack) | not described | Slack threads, steerable by anyone in the channel | **Team or Enterprise only**; public beta. The older per-user Slack app was retired 2026-10-05 | not on a Max plan |
| Agent SDK (TypeScript, Python) | subagents; named siblings via SendMessage | nothing built in: you build the UI (`canUseTool`, `defer`, Notification hooks to a Slack webhook) | **API key** (claude.ai login isn't allowed in third-party apps unless approved) | the route for a real custom app; costs API tokens |
| Managed Agents | hub and spoke: a lead plus up to 20 subagents, one level deep | event stream; you build the UI | beta; API key | later, if Anthropic should host the sandbox |
| GitHub Actions | through issues and PR comments | `@claude` in comments | API key or `claude setup-token` | already used by agent-os's principal review |

TypeScript is the better fit than Python for an orchestrator: the SDK has about 30 hook events in
TypeScript against 10 in Python (Python lacks SessionStart, SessionEnd, TaskCreated, TeammateIdle and
others), and TypeScript bundles the Claude Code binary.

Checked live 2026-10-21 with `ListAgents`: this session can see 36 peer sessions, including the
VibeCast session and the dope-tdd data-audit session (both interactive Desktop sessions, idle), so
cross-session messaging does reach *separate* sessions, not just subagents. What it lacks: messages
are not stored (offline sessions don't get them), it's one-to-one with no rooms, threads or history,
and approvals happen inside each receiving session.

Nothing documented gives a durable message bus or Slack coordination across agents on a Max plan.
That part, if we want it, is ours to build or buy (third-party research running).

## Third-party chat options (research, read in full 2026-10-21)

| Option | What it is | Agent to agent | Approvals | Licence, activity | Verdict |
| --- | --- | --- | --- | --- | --- |
| claude-threads | runs the real Claude Code CLI locally, one session per Slack or Mattermost thread; worktrees; resumes after a restart; Windows supported | not described | emoji reactions (allow, allow all, deny) | Apache-2.0; release 2026-10-01, pushed 2026-10-20 | **best chat UI to trial** |
| MCP Agent Mail (Rust) | MCP server: agent identities, inboxes, threads, searchable Git- and SQLite-backed history, file leases, a human "overseer" web UI | yes, the whole point | human composer; leases guard commits | "MIT+Rider" (rider unread: **read it first**); very active | **best agent-to-agent bus to trial** |
| OpenAgents | Slack-like workspace for agents and humans, @mentions, shared threads; hosted or self-hosted | yes | not documented | Apache-2.0, about 4.2k stars, very active | watch |
| open-tag | self-hosted Slack clone for agents (channels, delegation, task board) | yes | not documented | Apache-2.0; quiet since August | too early |
| Slack Code (Slack's own, launched 2026-08) | partner agents including Claude Code get project channels with plan, diff and preview tabs | unverified | human approves before shipping | free on Slack plans | watch: custom agents not open yet |
| Microsoft Agent Framework | group-chat orchestration with a first-party Claude Agent SDK adapter | yes | yes | MIT, 1.0 | heavy, Python or .NET |
| zulipchat-mcp | each session bound to a Zulip topic; `/approve` in the topic | via topics | yes | MIT, early | promising, early |
| Official Discord channel plugin | Discord to one session | **no: it drops messages from bots** (verified in its source) | permission relay buttons | Apache-2.0 | your phone link to one session only |
| Avoid | AutoGen (maintenance mode), mattermost-claude-code (stopped), the Matrix bridge (dangerous flag, no approvals), Agent Room's hosted rooms (a room code is the only gate), Agentrooms and Codey (macOS only), Multica (custom licence) | | | | |

Security rule for any bridge: **anyone who can post in a bridged channel effectively has shell
access.** Tight allowlists, no bypass modes, and treat chat as untrusted input (agent-os lesson L-0008).

## The CEO dashboard (your goal, 2026-10-21)

What you want: one place to see how every agent on the team is doing, read their chats, and jump in
when you can, without paying for anything. Sharpened 2026-10-21:

1. **A team chat room:** each agent shown as a person (name, role, avatar), posting in one channel,
   with you reading along and jumping in.
2. **A daily log:** each day's sessions and conversations kept, for tracking and spotting patterns.

Not needed: another app to *run* agents in parallel. The Claude desktop app already does that.
Note: Claude Code already saves every session's transcript locally, so a daily log can be built from
those files even if the chat tool keeps no history.

Leads from a Gemini search (your PDF), **unverified until checked against each tool's own repo**:

- **Desktop apps, one worktree per agent:** Orca, Pane, Emdash and Nimbalyst (free, Windows and Mac
  per Gemini). Conductor itself is paid and Mac only.
- **Chat between you and agents:** agentchattr (a local chat server, `@claude` tags),
  snedea/claude-agent-chat, xhluca/agent-talk and PatilShreyas/claude-code-session-bridge.
- **What we already have:** the Claude desktop app's Code tab (this one), with parallel sessions,
  worktrees, split view and Remote Control on the phone.

Visibly wrong in Gemini's answer:
- its dashboard code loads Tailwind from a URL that isn't a script;
- "agent confidence %" gauges would be numbers the agents make up about themselves;
- it calls REA (your fork) a viral 285K-star project.

**Verified 2026-10-21** (each README read in full, GitHub API for licence and activity):

| Tool | Free? | Windows | Team chat room (1) | Daily log (2) | Notes |
| --- | --- | --- | --- | --- | --- |
| **agentchattr** (bcurts) | yes, MIT | native (first-class) | **yes**: agents as named, coloured, role-tagged personas with avatars in shared channels; `@mentions` wake them; decision buttons; a loop guard on agent-to-agent chat | timestamped JSONL under `./data`, date dividers, export; no search, but per-day files are easy to build | runs your own `claude` subscription; agents must be started through its launchers to be woken; **don't use its skip-permissions launchers or `--allow-network`**; last release 2026-07 |
| Nimbalyst | yes, MIT (personal) | native | no | best: search and resume sessions, a kanban of sessions, iPhone approvals | analytics on by default (opt out) |
| Pane | yes, AGPL plus extra terms | native | partial: one orchestrator chat that can message every agent | no | adds a skill and an MCP server to `~/.claude` by default |
| Orca | yes, MIT | native | no | scrollback only | best for running agents side by side, which we already have; telemetry on by default; the API reports 100k stars, which is odd for its age |
| Emdash | yes, Apache-2.0 | native | no | local SQLite | Gemini cited the wrong site (superset.sh is a different, Mac-only product) |
| agent-talk | yes, MIT | not stated | no human room | a history skill | messages go through a relay; encryption unaudited |
| session-bridge | free | **no** | no | no | stale |
| snedea/claude-agent-chat | needs an API key | not stated | debate bots, not your agents | Docker | abandoned |
| Conductor | free tier, Pro $50/month | **Mac only** | no | no | not an option on Windows |

~~Verdict: trial agentchattr.~~ **Decided 2026-10-21: build our own small team room** inside agent-os
(TypeScript, test-first, guarded by dope-tdd), borrowing agentchattr's good ideas (it's MIT, so we can
read and reuse its source with the notice; no reverse engineering needed). Smallest version that
meets both needs:
- one local web page: a channel where each agent shows as a person (name, role, avatar), and you can
  post into it;
- agents post through one small MCP tool (`room_post`), so Claude desktop sessions, night-shift runs
  and subagents can all join;
- every message is appended to `log/YYYY-MM-DD.jsonl`, and the morning brief reads that file: that's
  the daily log;
- later, if needed: `@mention` wake-ups through Claude Code's own cross-session messaging, decision
  buttons, a loop guard.

Order unchanged: guardrails, then the night shift, then the room.

Also found 2026-10-21: **dope-tdd's repo is public** (agent-os's notes say private), so agent-os can
turn on its dope-tdd catch-check job without sharing anything.

## Night shift: the Kaizen loop (your goal, 2026-10-21; design proposed)

Goal: work keeps moving and improving while you sleep; you're woken only for something urgent.

What exists (checked 2026-10-21):
- **Local scheduled tasks** (desktop app): fresh session per run, on your PC, so dope-tdd guards it.
  Runs only while the app is open and the PC is awake (keep-awake stops idle sleep; a closed lid
  still sleeps).
- **Cloud routines** (schedule or GitHub events): run with the PC off, but plugins don't load in the
  cloud (lesson L-0005), so no dope-tdd. Only committed CLAUDE.md, repo hooks and CI apply.
- **Push notifications** to your phone through Remote Control: the "urgent only" channel.

Design:
1. **Night shift** (local, for example 1 a.m.): take the smallest open issue labelled `ready`; fix
   it test-first in a worktree; open a PR with `Fixes #N`; CI and the principal-engineer review
   decide (ordinary PRs auto-merge, protected paths wait for you). Stuck: `BLOCKED: <why>` on the
   issue, label `needs-human`, stop. Push to your phone only when main is broken, there's a security
   problem, or data could be lost. Write the day's log entry.
2. **Morning brief** (7 a.m.): merged, waiting on you, lessons proposed, usage spent. It doubles as
   the daily log; the chat room can show it live later.
3. **Weekly Kaizen pass:** group issues by label; an area with 3 or more becomes a guardrail or lesson.

Must exist before it runs unattended:
- branch protection and required CI on dope-tdd;
- the hook that blocks commits on main;
- issue labels (`ready`, `needs-human`, area, stack);
- a cap of 1 or 2 PRs a night, and a turn or usage budget;
- releases are never touched by the night shift.

Revised order: guardrails, then the night shift, then the chat room to watch it.

## Recommendations (proposed 2026-10-21)

**Stack: TypeScript on Node, run directly with no build step, tests on `node --test`.**
- dope-tdd fully supports Node with `node --test`, including the safe throwaway-copy catch check;
  Python is still experimental there.
- The Agent SDK has about 3 times more hooks in TypeScript and bundles the CLI.
- Same language as dope-tdd and as Claude Code mods, so code and lessons move between them.
- Node runs `.ts` files directly (type stripping); raise agent-os's `engines` from 20 to 22.18+.
  Convert the `.mjs` tools as they're touched, not all at once.

**Chat, in stages: start with what's free and built in, add a real chat UI when it hurts.**
1. **Now:** role agents as separate Claude Code sessions (worktrees) using cross-session messaging,
   Remote Control on your phone for approvals, and GitHub (issues, PR comments, `docs/decisions/`) as
   the durable record agent-os already uses.
2. **Trial, one week each, per the agent-os toolbox rule:** claude-threads with a free Slack
   workspace (or self-hosted Mattermost) for the "talk to the team in threads" feel, and MCP Agent
   Mail for agent-to-agent threads with history (after reading its licence rider).
3. **Only if those fall short:** build a small custom channel plugin (Anthropic's documented way to
   put your own chat in front of sessions), or move to the Agent SDK with an API key.
4. **Don't buy yet:** Claude Tag needs a Team or Enterprise plan; Slack Code doesn't take custom
   agents yet.

**Order of work (proposed):**
1. Merge #157, release 0.2.3 to Karl with the round-5 script.
2. dope-tdd adopts the agent-os template (charter, gates, receipts, lessons) instead of building
   its own; add the branch guard hook and the release workflow, which agent-os lacks too.
3. Enable the dope-tdd catch-check job in agent-os (it's commented out because dope-tdd is private).
4. agent-os moves to TypeScript as files are touched.
5. The chat trials (stage 2).

## Open questions

- Agent OS stack: recommendation is TypeScript on Node (see Recommendations). Your call.
- Chat: staged plan in Recommendations. Your call on the trials and on a Team plan (needed for Claude Tag).
- dope-tdd is public, so agent-os can turn on its catch-check job: when?
- An API key secret in GitHub for the smoke test and evals in CI?
- Which plugins to install for the trial: commit-commands, pr-review-toolkit, plugin-dev?

## In flight

- #157 and #158 merged; the installed copy is at #158 (0.2.3), the build Karl tests.
- **#158:** a break whose red was only an error read as PROVEN once the code was put back
  (#132's second door). Found while writing Karl's round-5 script: checking each expected message
  against the code path it goes through turned up a false proof. Lesson candidate: **derive tester
  scripts from the code, and turn them into the smoke test (proposal 7)**, so this kind of check runs
  every release, not only when a script happens to be written.
- Karl's reply and round-5 script: `docs/testers/rounds/round-5-karl.md`. Ready to send; his report
  goes back into `docs/testers/rounds/`, and each mismatch becomes a GitHub issue.
- Guardrails done (#161 and the ruleset). **Now: agent-os.** dope-tdd guards it, and the night
  shift goes in as its first spec. Then the rest of the operating layer there (queue, room, log).
