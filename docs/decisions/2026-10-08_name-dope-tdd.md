# 2026-10-08 — The name is Dope TDD

## What was decided
The plugin is **Dope TDD**: plugin and marketplace id `dope-tdd`, band title
DOPE TDD, line prefix `dope-tdd:` in everything Claude reads, settings file
`dope-tdd.json`, status tool `mcp__dope-tdd__status`, command `/tdd`. The
GitHub repository and the local folder keep the name `red-first` until the
owner renames them; the marketplace is registered by path, so nothing
depends on the folder name. Decision notes and the dogfood log keep the
names in use at the time they were written.

## Why
The owner's pick. It says what the tool is without explanation, which "Red
First" and "sawred" did not, and it sounds like the person who made it,
which fits a tool whose pitch is honesty. Checked clear on npm, PyPI and
GitHub, and no plugin in the Claude Code directories uses it.

## Alternatives considered
- Red First: the working name; diluted by two small same-idea repos and
  needs explaining.
- sawred, redledger, first-red: clear and evocative, less legible to a
  newcomer.

## Trade-offs accepted
- "Dope" is slang and may read as unserious to a team lead or an exec. The
  mitigation is in the product, not the name: receipts and reports stay in
  plain words, and the evidence is never playful.
- The per-plugin store moves with the id, so unlocks remembered under the
  old name are not carried over.
