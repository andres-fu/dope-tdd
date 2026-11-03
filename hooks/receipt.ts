// What `/tdd receipt` tells a reviewer to run to check the proof, out of register.tsx (receiptText).

export type RecheckFacts = {
  label: string
  /** The command that runs the module's test. */
  run: string
  /** The branch the change is compared with. Nothing here knows a pull request's base. */
  base: string
  /** Where `base` came from: origin's default branch, or a guess when origin names none. */
  baseFrom: 'origin' | 'guess'
  /** The changed file, relative to its checkout's root, or null with no change on record. */
  path: string | null
  /** The base has a version of that file to put back: yes, no, or unknown when the base isn't a branch here. */
  atBase: 'yes' | 'no' | 'unknown'
  /** How the test failed with the change undone, in words: `fails`, or `fails with ...`. */
  fails: string
}

/** A path as a shell reads it: quoted when it holds a space. */
function quoted(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path
}

/**
 * The commands and what they show. #269: the base is assumed, so it is named, with what to do when a change goes into
 * another branch. A file the base doesn't have can't be put back, so no step claims to prove it: `git checkout` would
 * fail there, and the second run would pass and show nothing. A base that isn't here is said as that, never as a file
 * that's new.
 */
export function recheckLines({ label, run, base, baseFrom, path, atBase, fails }: RecheckFacts): string[] {
  const steps = path !== null && atBase !== 'no' ? [`git checkout ${base} -- ${quoted(path)}`, run, `git checkout HEAD -- ${quoted(path)}`] : []
  const which = baseFrom === 'origin' ? `${base} is origin's default branch` : `${base} is a guess, as origin names no default branch here`
  const says =
    path === null
      ? `No change to ${label} is on record this session, so there is nothing to put back; the first run is the whole receipt.`
      : atBase === 'unknown'
        ? `${base} isn't a branch here, so this couldn't be checked: put the branch this change goes into in its place. The first run passes; the second should fail, and the last line puts the change back.`
        : atBase === 'no'
          ? `${path} is new since ${base}, so there is no older version to put back, and the first run is the whole receipt. ${which}: if this change goes into another branch, check against that one.`
          : `The first run passes. The second runs the same test against the code on ${base}, before the change, and ${fails}, which is what the catch check saw. The last line puts the change back. ${which}: if this change goes into another branch, put that branch in its place.`
  return ['To check the proof yourself, from the repo root with this change checked out:', '```', run, ...steps, '```', says]
}
