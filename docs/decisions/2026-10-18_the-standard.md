# 2026-10-18 — The standard: what good looks like (DRAFT v0.5, frozen while the product catches up)

> Drafted by Claude from the 2026-10-18 conversation, for Andres to edit until it sounds like him.
> Lines marked **[today]** describe what dope-tdd already does; **[proposed]** is not built yet;
> **[decide]** is an open question for Andres. v0.2 folded in the industry review of the same day and
> Andres's answers to the v0.1 questions; v0.3, his answers to v0.2's; v0.4, a review of example
> tests and of dope-tdd's own data; v0.5, a verified second review and Andres's decisions on it.
>
> **Frozen.** Most of this is [proposed]. No new rules until the product makes the existing ones true.

## The manifesto
**[Andres writes this: one page, his own words. Everything below is the reference behind it.]**

## Why this exists
Code changes. A product owner changes their mind, a bug turns up at 3 a.m., a feature grows. What
makes the next change cheap and safe is a set of tests you can trust. That is the whole point of TDD:
it is a pain up front and it makes every later change easier.

AI agents write code fast and claim "tests pass" for free. dope-tdd turns that claim into evidence.

**The promise: every change is proven by a test that can fail before it is committed, and every
exception is explained.**

## Who it is for
- **Engineers** who want their agents to work the way a disciplined engineer would.
- **The agents and humans who come back later** to change the code. We write for them.

Not, first, for people who want safety without caring how: they are welcome, but we do not bend the
standard for them.

## Our stance
We are opinionated. We say what a good test and good code look like, and we hold the bar. People
choose whether to adopt it; we do not offer a setting for every taste. Like a formatter, the value is
in not having the argument.

The standard has two layers, and both are ours:
1. **Rules dope-tdd enforces.** Deterministic, cheap, checked on every change. If we cannot check it
   mechanically, it is not a rule. A judgement, such as whether an override was warranted, is a
   principle: an approver decides it and the record keeps it. Only its mechanical part is a rule (a
   kind, a reason, what ends it, the rising bar). *(Clarified 2026-10-18 with override v1.)*
2. **Principles dope-tdd teaches.** In the advice it gives, the skills and the docs. Judgement lives here.
3. **Examples dope-tdd shows.** A handful of tests and code we consider excellent, each beside a bad
   version and one line on why. Agents follow examples far more reliably than abstract principles, so
   this is how taste is passed on. The first pairs: [the examples](2026-10-18_the-standard-examples.md).

The layers stack. Ours is the base, opinionated and shipped with dope-tdd. A company or project adds
its own on top (its CLAUDE.md, its own examples), because every company is different. Whenever a
person corrects an agent, the correction becomes a rule or an example, so it is never said twice.

## Guardrails, not walls
We cannot foresee every situation, and it is not intelligent to gate everything. So:
- **Every guardrail can be passed.** By the agent or the engineer, always.
- **Passing one takes a reason and a scope.** Every reason is recorded and shows on the receipt.
  Nothing is silent.
- **No agent approves its own exception.** The agent asks; an approver decides. The approver is a
  role: a person today, and next a reviewer model or a team's own EM, PM or principal agent. With
  nobody to approve, the agent stops and reports. A hotfix is the one exception: it always passes,
  recorded, as debt (see Hotfixes).
- **Exceptions stay rare,** by rising friction and visibility, not a hard budget: one request waits
  at a time, an override left open past a week blocks the next, the approver sees each request's
  history, and the receipt shows overrides per cycle.

**Scopes.** *(Built in override v1, 2026-10-18.)*
- **This change:** one edit, the default, for almost everything.
- **This module, until a condition:** "a spike on the parser until the spike PR closes". The
  override names what ends it, and the receipt shows it until a person ends it.
- **A pause: every module, for a set time.** No silent or open-ended bypass: a pause has a reason
  and minutes (at most two hours), ends by itself, and what was edited during it stays debt on the
  receipt until someone deals with it. *(Changed 2026-10-18 from "no session scope": the rule we
  meant was no silent or open-ended bypass, and a person who cannot pause uninstalls, which loses the
  record entirely.)*

**Reasons.** A kind, so reports can count them, and one line of free text, so a person can read why.
Kinds: spike, hotfix, generated code, legacy (no tests yet), other. A mock is not a kind: mocks
follow the mocking rule, and needing an override for one means the rule is missing.
A good reason is specific: it says what, why, and what happens next. "Needed to proceed" is not a
reason; "trying two parsers to see which handles Windows output; the loser is deleted" is. The
mechanical part is checked (a kind, a reason long enough to say something and not an empty phrase,
what ends a module override, minutes for a pause); the rest is the approver's judgement, taught by
examples.

**The record.** Overrides live in `dope-tdd.overrides.json` in the repo, so who approved what is in
the pull request's diff. Only dope-tdd writes it. It names roles (human, hotfix rule, unattended),
never people.

There is no quiet "off". There is an override with a reason, a pause with a time, and there is
uninstalling.

## Answering upward
Whoever ships a change answers for it: to their EM, a director, the CTO, the customer, customer
support. When someone asks "why did this ship like this?", the answer must already be written down, by
whoever made the call, when they made it. The receipt is that record: what changed, the test that
proves it, what was overridden and why, and what is left unproven. It is written to be read by
someone who was not there. **[proposed: reasons on every override; the receipt in the PR description]**

## Own your space, report across boundaries
*Added 2026-10-18 as a correction to the frozen draft: a gap, not a new rule.*

An agent changes only what it was assigned: its repository, its branch or worktree, its module. Two
agents in one repository still each own only their own assignment.
- **Anything it finds elsewhere, it reports** to the owner, never fixes in place: what, where, when.
- **It tells its human first,** and the report is recorded, so it shows on the receipt and in the logs.
- **In an emergency it proposes, never takes over:** a pull request or an issue, which the owner decides
  on. Posting in someone else's repository is still an outward action, so it asks its human before it
  posts.
- **No response from the owner:** escalate to a human. Never take over.
- **Be a good owner too:** reports about your space must be easy to find and acted on.

This is how teams that work well already behave (on-call pages the owner; contributors open pull
requests), and agents need it more: they act fast, at scale and often unwatched, and a fix in the wrong
place is hard to trace. dope-tdd follows it itself: a session never repairs another project's
interrupted catch check; it names it to the user and records it. **[today: #89]**

## What the research says (2026-10-18)
The industry review (sources in the research session's report) changes some of this draft:
- **Process gates are contested; outcome gates are not.** The only published evaluation of TDD with
  agents (Böckeler, Thoughtworks, on martinfowler.com) found no benefit from enforced red-green on
  small, new Python tasks with no collaborators. It was exploratory: two runs per side per batch, judged
  by a model. TDD runs used 3 to 8 times the tokens, which is not 3 to 8 times the cost: the count
  includes cache re-reads, as the author notes. Agents also faked the red step under TDD prompts. Uncle
  Bob reportedly gates on quality thresholds rather than on test-first (secondhand). We say "the only
  published evaluation found no benefit on small greenfield tasks", never "TDD does not help agents".
- **Design before code.** The author's explanation for why non-TDD runs did better: they worked out
  types, contracts and edge cases first, while TDD runs locked in the shape of their first test and
  rarely revisited it. That argues for a design step before the first test, not against tests.
- **Gaming is real and documented:** deleting or skipping tests, editing them to match, special-casing
  outputs, faking red (Beck, EvilGenie, Böckeler). Cheap file-change checks catch the blatant cases.
- **Over-mocking is measured:** 36% of agent commits add mocks against 26% of others (Hora and Robbes,
  1.2M commits). This is the Node/TypeScript risk to target first.
- **Guards get bypassed when they misfire.** tdd-guard's own README names refactors and multi-step
  edits as its weak spots; a related tool ships its guard off by default.
- **No evidence yet that test discipline improves delivery metrics with agents.** AI raises throughput
  and instability (DORA 2025, Faros 2025, secondhand). Our delivery claims are a hypothesis to measure,
  not a fact to sell.

**Decided (v0.2, confirmed by Andres in v0.3).** The outcome is what we hold the line on: proven before commit.
Test-first stays the default and the taught way, guarded at the edit as today, but like every
guardrail it can be passed with a recorded reason. We do not claim test-first is the only road to
correct code; the evidence does not support that, and the catch check proves the outcome either way.

## The loop
0. **Design.** Before the first test, write down the contract: inputs, outputs, edge cases, errors.
   The tests then follow a design instead of inventing one. **[taught, not checked]**
1. **Red.** Write or change the test first, and see it fail for the right reason. **[today: enforced
   at the edit; see the decision above]**
2. **Green.** Make it pass with the simplest change. **[today]**
3. **Proven.** dope-tdd undoes the change (or plants a small mutant in new code) and reruns the
   test. It must fail. CAUGHT or PROVEN, never MISSED. **[today]**
4. **Refactor.** With the tests proven, clean up: names, duplication, structure. This is the safe
   moment, and the one most often skipped. **[proposed: a nudge after a proven green, a REFACTOR
   state on the band until the next red or commit]**
5. **Commit.** Only proven work is committed or put up for review. **[proposed]**
   - **At a commit:** a warning to the agent naming what is red, MISSED or unproven. The agent fixes
     it or overrides with a reason. Today nothing is said at a commit.
   - **At a PR:** the receipt goes in the description, listing anything unproven or overridden, with
     reasons. This is where humans step in.
   - **Strict mode,** for teams that want a refusal at the commit: off by default.
   - Agents can run this loop entirely on their own; humans read the receipt rather than watch.
   - **The receipt is short** and sits where people already look: one summary line, then the detail.
     A receipt nobody reads is accountability theatre.

## A good test (the rules)
A test that breaks any of these is not good, whatever the coverage report says.

1. **It can fail.** Undoing the change makes it fail. **[today: the catch check]**
2. **It asserts something real.** A test whose only checks are "is defined", "is truthy", "does not
   throw" or `expect(true)` is an assertion-free test (the Liar). An assertion of absence ("never
   contains", "was not called") also proves something was there to check, or it passes when nothing
   happened at all. **[proposed]**
3. **It does not mock the thing it tests.** That is gaming, and is flagged. **[proposed]**
   Other mocks are a tool, used within reason: sometimes you must stub something until a change
   elsewhere lands. A change's new mocks are counted on the receipt, and a temporary one carries a
   reason. Agents add mocks far more than people do (see the research), so this is the first rule to
   build. **[proposed]**
4. **It is not skipped, focused or commented out.** **[today: recorded as a workaround]**
5. **It was not bent to fit the code.** A test edited after a red, with the code untouched, is the
   test agreeing with the bug. **[today: recorded]**
6. **It is fast.** One unit test file runs in well under a second. **[proposed: measured and shown
   first; a hard number once we have real data]**
7. **It gives the same answer twice.** **[proposed: compare with the catch check's baseline run]**
8. **It tests behaviour, not internals.** A test that reaches into private state (`as any`, an
   `_underscored` field, a function the module does not export) breaks on a harmless refactor and
   proves nothing a user would notice. **[proposed]**
9. **A commit is a behaviour change or a refactor, never both.** Mixing them hides which lines
   changed what the code does. dope-tdd already knows which changes were refactors, so it can say so
   at the commit (Beck, *Tidy First?*). **[proposed]**
10. **It does not print to the console.** Stray output is noise or a hidden error; a test that passes
    while printing is not self-validating (Zod's suite fails on console output). **[proposed]**

Gaming is not blocked, it is shown. Every workaround goes on the receipt, where the human sees it.
Blocking teaches the agent to game more cleverly; showing makes it pointless.

## A good test (the principles)
- **F.I.R.S.T.** (Uncle Bob): Fast, Independent, Repeatable, Self-validating, Timely. Our rules map onto
  it, and onto Beck's Test Desiderata.
- It tests behaviour through the public interface, not the internals.
- Its name reads as a line of the spec.
- It covers the edges that matter: empty, boundary, error.
- Someone who has never seen the code can read it and know what the code does.
- **Mock only at the process boundary:** the network, the mail provider, the clock, the disk. Never
  inside the unit. A fake repository standing in for the database is at the boundary, so it is
  allowed; mocking your own pure collaborators (a price calculator inside checkout) is not. A
  temporary mock elsewhere carries a recorded reason (see rule 3).
- **Deny the network by default** in the test runner, so no test passes or fails depending on the day.
  **[proposed: recommended by `/tdd setup`, not detected]**
- **Each test owns its data.** No shared fixtures that tests change.
- **Arrange, Act, Assert,** with names in the form "when X, then Y". About seven statements per test is
  a smell threshold, not a rule: a table of cases is still one concept.
- **Avoid the named smells:** assertion roulette (many assertions, no telling which one failed), the
  mystery guest (setup hidden in helpers, so the reader cannot see what a case depends on), and the
  eager test (one test checking several behaviours). One behaviour per test, its setup in plain sight.
- **[decide]** fixtures, and how much testing is enough.

## Good code (the principles)
- **Easy to change** is the measure of good. Everything below serves it.
- **Keep it simple.** The simplest thing that passes the test.
- **Don't repeat yourself, by the rule of three.** Extract on the third repeat, not the second: with
  agents writing similar code fast, the wrong abstraction is as costly as duplication.
- **Modular, with a thin shell.** Decisions live in pure code that is quick to test; the code that
  talks to the outside world stays too simple to need many tests (the Humble Object). Code that is
  hard to test is telling you its design is wrong.
- **No hard-coding** of what will change: paths, names, limits.
- **Shared code becomes a library** when two places need it, not before.
- **Privacy by design.** The core privacy principles are followed strictly, always, whether or not a
  law requires it yet: collect only what is needed, keep it only as long as needed, know where it
  lives, never log personal data, be able to delete it on request. These are GDPR's principles, and
  they are cheap from the start and painful to retrofit; building to them makes going global a
  non-event. The heavy machinery (consent management, impact assessments, data residency) comes only
  when the code really processes personal data at that scale, and domain rules (PCI, HIPAA, WCAG) only
  where their domain applies. Strict principles always; ceremony only when it applies.
- **[decide]** naming, function size, comments.

dope-tdd does not lint style. It makes refactoring safe, nudges at the right moment, and leaves taste
to people and their linters. **[proposed: report hard numbers on a change, such as size growth or
code duplicated by it, as facts rather than refusals]**

## The shape of a suite
Our position, stated as ours rather than as a consensus: **a pyramid at the core, a thin component
layer at the boundary, very few end-to-end tests.**
- **Unit tests for the pure core:** domain logic and decisions, no network, disk or clock.
- **Component tests where the code meets the world:** the API, the database, the configuration. They
  catch wiring faults that unit tests cannot (dope-tdd itself was blind to its own repository on
  2026-10-18 through a configuration fault, while every unit test passed).
- **A handful of end-to-end tests,** in CI, outside dope-tdd's loop.

This is Functional Core, Imperative Shell (Gary Bernhardt, 2012; Mark Seemann) and matches how
library authors such as Zod and Vitest test. The best-known Node voices differ: Yoni Goldberg
recommends mostly component tests (the diamond), Kent C. Dodds mostly integration (the trophy). We
part from them because the catch check proves what it can rerun quickly, and fast tests beside the
module are where agents change code most cheaply.

## Speed is part of good
A slow suite is a reliability problem: if a fix takes 20 minutes of tests to ship, recovery takes at
least 20 minutes. dope-tdd tracks and shows, on the receipt: time per test file, time per suite, and
its own overhead (milliseconds per tool call, seconds per catch check, tokens it adds per turn).
**[proposed]** Budgets come later, from real numbers rather than guesses.

## Hotfixes
How a company declares a hotfix is its own business; we do not model it. A hotfix is an override
whose reason says so. It goes through, and the receipt shows the missing test as debt until one is
written. Strict by default, never in the way of recovery.

## What dope-tdd proves, and what it does not
- **Proves:** each change is caught by a test that can fail; no gaming went unseen.
- **Does not prove:** that the tests are the right ones, that every edge case is covered, or anything
  only integration, end-to-end, smoke or contract suites can show. dope-tdd is the inner loop; it sits
  beside those suites, never instead of them.
- **Never lies.** No false green, no reassuring zeros. "Not watching" must look different from "all
  good". When no edited file matches the layout, or a run cannot be read, dope-tdd says so loudly and
  offers `/tdd setup`. **[proposed: today the band shows zeros when it cannot see the code or read the
  runner]**
- **No generic mutation tools.** We do not run Stryker or similar. The catch check is targeted
  mutation: its mutant is the real change, undone, so it proves the test catches this change, fast
  enough for the inner loop. **[decided v0.5]**

## Compliance
Code coverage is not a security or compliance control: it shows code ran, nothing more. GDPR, HIPAA,
PCI, PII handling and WCAG each require specific behaviour (data masked, access logged, consent
recorded, labels present), and an agent applies them only when it knows they apply. So:
- **The project says which apply,** in its own layer (its CLAUDE.md or a requirements document): "this
  service handles card data; PCI applies."
- **Each requirement becomes a test:** "card numbers never appear in logs", "every form input has a
  label". dope-tdd then proves that test can fail, and records anyone who weakens or skips it. A
  "never appears" test also proves something was logged, or it passes when the logger is silent
  (example 6).
- **Specialised tools cover the rest:** secret scanning, static security analysis, accessibility
  checkers.

dope-tdd does not judge compliance. It keeps compliance requirements from silently regressing.

dope-tdd holds itself to the same principles. By default it sends nothing off the machine. A repo
that opts into a reviewer model for overrides (`"overrides": { "approver": "model" }`) sends, per
request, the request itself and the uncommitted hunks of that one module and its test, comments
removed, to the model API through the session's own client, the same API the session already uses.
Nothing else is sent, and turning it on is recorded as a loosening. The
override record is kept in the repo on purpose, since it is part of the change, and holds roles,
never names. What it stores
locally (session state, the catch-check journal, session logs) is to be minimised (hashes rather than
file texts), given a retention limit, and listed in the README. The audit of 2026-10-18 confirmed that
the shipped plugin sends nothing off the machine, and found where it falls short: one log line can
carry source text, and session logs, kept copies and orphaned journals are never pruned. **[proposed:
those fixes, then hashes in place of file texts]**

## Measuring it
Only what dope-tdd can see, on the engineer's machine:
- **Inner-loop cycle time:** first test touched, red, proven green, commit.
- **Its own cost:** seconds and tokens per session.
- **Lead time to merge:** from git and the PR, where available.
- **What it caught:** MISSED tests strengthened, untested edits refused, workarounds shown.
- **Override rate:** how often guardrails are passed, and with which kinds of reason. A high rate means
  a rule is wrong or being gamed; both are worth knowing. Reasons can be written to sound plausible, so
  the rate matters more than any single reason.

These are our slice of the team's delivery measures (change failure rate, time to restore, lead time
for changes). Deploys and incidents belong to the team's own tools; we say so rather than guess. That
dope-tdd lowers change failure rate or review time is a hypothesis: no study shows it yet, so we
measure it before we claim it.

## Scope
- **Supported:** Node and TypeScript (Vitest, Jest, `node --test`). The catch check runs in a
  throwaway worktree and never touches the engineer's files.
- **Experimental:** everything else, until the core is clearly winning. No new languages before then.
- **One plugin, many stacks:** the core is language-neutral; each stack is an adapter (how to run one
  test file, how to read its result, where tests live).

## Direction: proof in CI
The proof does not need Claude Code. After the commit warning and the receipt, the next step is a
check that runs on every pull request: it reruns the catch check and verifies the receipt. **[proposed]**
- It works for any agent and any human, not only Claude Code.
- It fits teams whose agents work with no human watching: the PR is where proof is checked.
- It turns the receipt from a claim into something a reviewer can verify.
- It reduces our dependence on one host's plugin interface, which is young and could change, or be
  matched by a built-in feature.

## Sources
The standard draws on, and cites rather than copies:
- Kent Beck, *Test-Driven Development: By Example*, and his *Test Desiderata*: twelve properties of a
  good test (isolated, composable, fast, deterministic, behavioural, structure-insensitive, specific,
  predictive, inspiring, readable, writable, automated). Our rules and principles map onto them.
- Kent Beck, "Augmented Coding: Beyond the Vibes" (2025): strict TDD with agents, and watching for
  agents that disable or delete tests.
- Vladimir Khorikov, *Unit Testing: Principles, Practices, and Patterns*: mocks only at the boundary
  with dependencies outside the process; test observable behaviour.
- Gerard Meszaros, *xUnit Test Patterns* (xunitpatterns.com): the names of the test smells.
- Martin Fowler, "Mocks Aren't Stubs": classical and mockist testing.
- Kent C. Dodds, "Testing Implementation Details".
- Birgitta Böckeler, "TDD in the agent loop" (martinfowler.com): the only published evaluation of
  TDD with agents; exploratory, small greenfield tasks (see "What the research says").
- Kent Beck, *Tidy First?* (2023): never mix tidying with behaviour changes (rule 9).
- Gary Bernhardt, "Functional Core, Imperative Shell" (2012), and Mark Seemann: the architecture behind
  our suite shape.
- Robert C. Martin, F.I.R.S.T.
- Reference code, linked rather than copied:
  - Zod (MIT): `packages/zod/src/v4/classic/tests/` and its root `vitest.config.ts` (isolated files,
    type checks, fail on console). Its maintainer writes tests with Claude and holds them to this bar,
    the closest real example of our situation.
  - Vitest (MIT): `test/unit/` (renamed from `test/core/`) beside `test/e2e/`.
  - rmanguinho/clean-ts-api (GPL-3.0-or-later, link only): use-case and repository tests in
    TypeScript, with a spy per repository interface. One valid style, not our rule.
  - Yoni Goldberg, nodejs-testing-best-practices (no licence file, link only): test anatomy and data
    isolation. Not a source for test-first: its section 1.4 argues against it.
- Hora and Robbes, MSR 2026: agents add mocks in 36% of commits, against 26% for others.
- Robert C. Martin, *Clean Code* and *Clean Architecture*; and John Ousterhout, *A Philosophy of
  Software Design*, the strongest case against TDD as a design method, which we answer: code is rarely
  a one-person show, and tests are how the next person changes it safely.

**[decide]** Check each source and its licence before the standard is published; the example code is
original.

## Open questions for Andres
1. The manifesto, at the top: his own words, one page.
2. The standard's name, and whether it is published on its own, apart from the plugin.
3. The first examples: approve, edit or replace each pair in the examples file.
4. Still open in the text: fixtures, how much testing is enough, naming, function size, comments.
