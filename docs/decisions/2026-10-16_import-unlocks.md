# 2026-10-16 — A test that imports a module stands in for its own test only when it has none

## What was decided
A test that imports a module still unlocks it, by a touch or by a red run,
but only when the module has no test of its own: no file at its layout's
test path in any of the stack's extensions. A module that has its own test
is unlocked by that test, as any module is.

The tests seen importing a module are remembered for the session, newest
first, three at most. When the module's own test misses a change, the catch
check tries up to two of them. If one fails with the change undone, the
verdict is CAUGHT, and Claude reads which test caught it and that its own
test is missing an assertion: "its own test, test/io.test.ts, does not catch
the change, but test/slugify.test.ts does: CAUGHT by test/slugify.test.ts."
If none does, it stays MISSED.

## Why
The import unlock came from the slugify/io A/B run (commit 3587b3a, no
decision then): io had no test of its own, its tests lived in
`test/slugify.test.ts`, and name pairing linked neither file, so an agent
that wrote the failing test first was refused and wrote duplicate tests to
get through. That case is kept.

VibeCast showed the other side (#25). `test/sources/youtube.test.js`
imports `storage.js` and `tokenCrypto.js`, so touching it unlocked both,
though `tokenCrypto` had no test touched and `storage` had a test of its
own. Their catch checks then ran a suite that barely exercised them. The
module's own test is the test the reader expects; an import is a guess.

Running only the own test would have been wrong too, as the VibeCast session
pointed out: `storage.getOauthCredential` is exercised only by the YouTube
test, so a change there would read MISSED although a test catches it. Trying
the importers after a miss keeps that CAUGHT and says where the own test
falls short.

## What it costs
An agent fixing a module through a test that imports it, when the module has
its own test, is refused until it touches or runs that test. A miss costs up
to two more check runs, each within the usual budget.
