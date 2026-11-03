// What `/tdd receipt` tells a reviewer to run to check the proof, out of register.tsx (receiptText).

export type RecheckFacts = {
  label: string
  /** The command that runs the module's test. */
  run: string
  /** The branch the change is compared with: origin's default branch, since nothing here knows a pull request's base. */
  base: string
  /** The changed file, relative to the root, or null with no change on record. */
  path: string | null
  /** The base has a version of that file to put back. */
  atBase: boolean
  /** How the test failed with the change undone, in words: `fails`, or `fails with ...`. */
  fails: string
}

/**
 * The commands and what they show. #269: the base is assumed, so it is named, with what to do when a change goes into
 * another branch. And a file the base doesn't have can't be put back, so no step claims to prove it: `git checkout`
 * would fail there, and the second run would pass and show nothing.
 */
export function recheckLines({ label, run, base, path, atBase, fails }: RecheckFacts): string[] {
  const steps = path !== null && atBase ? [`git checkout ${base} -- ${path}`, run, `git checkout HEAD -- ${path}`] : []
  const says =
    path === null
      ? `No change to ${label} is on record this session, so there is nothing to put back; the first run is the whole receipt.`
      : !atBase
        ? `${path} is new since ${base}, so there is no older version to put back, and the first run is the whole receipt. ${base} is origin's default branch: if this change goes into another branch, check against that one.`
        : `The first run passes. The second runs the same test against the code on ${base}, before the change, and ${fails}, which is what the catch check saw. The last line puts the change back. ${base} is origin's default branch: if this change goes into another branch, put that branch in its place.`
  return ['To check the proof yourself, from the repo root with this change checked out:', '```', run, ...steps, '```', says]
}
