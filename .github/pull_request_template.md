Fixes #

<!-- Every bug gets an issue first (the bug template asks for its area, stack and source labels), and the PR that
fixes it says `Fixes #N`. Only a merge into main closes an issue, so the release PR lists it too. No issue? Say why
on this line instead. -->

## What and why

## Evidence

<!-- Only what you saw in this session's output; leave a line out rather than guess. -->
- Test seen failing first:
- Passing: `npm run check` and the POSIX-root pass, or the CI run link
- Compared: the counts from `npm run compare`, with `--sessions` where it can see the change, never its commands, or why it doesn't apply
- Docs: README / docs/testers.md updated, or why none were needed
- Receipt: paste `/tdd receipt`, or say why there is none

## Risk

<!-- .claude/CLAUDE.md, Review, lists the paths that need a person. An agent leaves the last line empty. -->
- Review: what ran, N findings across all rounds, M wrong; each one fixed or answered
- How to revert:
- Needs a person: yes / no
- What the checks would miss:

<details><summary>Review report</summary>

</details>
