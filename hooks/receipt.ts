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

/**
 * The run, and how to see the proof in words. #269: the base is assumed, so it is named, with what to do when a change
 * goes into another branch. A file the base doesn't have has no older version to check against. A base that isn't here
 * is said as that, never as a file that's new. #355: no command that changes a file is printed. Steps that put back the
 * base's file and then HEAD's overwrote a change not yet committed, and git states that show nothing (a filter, a flag,
 * a pattern in the path) lost work too; nothing here can say what the reader's checkout holds.
 */
export function recheckLines({ label, run, base, baseFrom, path, atBase, fails }: RecheckFacts): string[] {
  const which = baseFrom === 'origin' ? `${base} is origin's default branch` : `${base} is a guess, as origin names no default branch here`
  const putBack = (version: string): string => `in a checkout with nothing uncommitted, put \`${path}\` back as it is on ${version}, run the test again`
  const says =
    path === null
      ? `No change to ${label} is on record this session, so the run is the whole receipt.`
      : atBase === 'unknown'
        ? `${base} isn't a branch here, so the code before the change couldn't be found: ${putBack('the branch this change goes into')}, and it should fail. Then put the file back as it was.`
        : atBase === 'no'
          ? `${path} is new since ${base}, so there is no older version to put back, and the run is the whole receipt. ${which}: if this change goes into another branch, check against that one.`
          : `The run passes. To see it fail without the change: ${putBack(base)}, and it ${fails}, which is what the catch check saw. Then put the file back as it was. ${which}: if this change goes into another branch, use that one instead.`
  return ['To check the proof yourself, from the repo root with this change checked out:', '```', run, '```', says]
}
