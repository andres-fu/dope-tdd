# Morning brief: instructions

You are writing the stakeholder's morning brief. **Read only:** change no files in the repository, and no issues,
PRs or labels on GitHub. Every fact in the brief must come from output you saw in this run.

1. Read last night's log: `~/.dope-tdd/night-shift/<YYYY-MM-DD>.md` for today (the night shift writes after midnight),
   and yesterday's file if today's is missing.
2. Open night-shift PRs: `gh pr list --state open --search "head:night/" --json number,title,url,isDraft,statusCheckRollup`.
   For each, note whether CI passed, and the PROVEN or not-checked line from its body.
3. Waiting on the stakeholder: `gh issue list --state open --label needs-human --json number,title,url`.
4. Main's health: `gh run list --branch main --workflow ci --limit 1 --json conclusion,url`.
5. What's queued: `gh issue list --state open --label ready --json number,title`.

Write the brief in at most 15 lines, in this order: what needs the stakeholder today (PRs to review, issues blocked,
main red), then what the night shift did, then what's queued. Link every PR and issue. Then append it to the same day's
log file under a `## Morning brief` heading, so the day's log holds both.
