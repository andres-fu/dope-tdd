# Security policy

## Supported versions

Only the latest release gets fixes. The version is in `.claude-plugin/plugin.json`; `/tdd` shows
the one you're running.

## Reporting a vulnerability

Report it privately: on GitHub, open the repository's **Security** tab and choose **Report a
vulnerability**. Please don't open a public issue for it.

Say which version you ran, your operating system, and the steps that show the problem. Expect a
first reply within a week.

## What counts

Dope TDD runs on your machine, inside Claude Code, and reads and writes your files. A security
problem includes anything that:

- loses or changes your work outside what it says it does (see `docs/security-and-data.md`)
- writes, deletes or links files outside the project, its `.git` folder, the plugin store or
  `~/.dope-tdd/`
- runs a command you didn't ask for, or runs one with input an attacker controls
- sends anything off your machine beyond what `docs/security-and-data.md` describes

Getting around its own rules (editing source without a test, faking a red) is a bug, not a
security problem: file it as an issue. The README says plainly that an agent with a shell can
change anything the plugin can write; the pull-request check in CI is the proof.
