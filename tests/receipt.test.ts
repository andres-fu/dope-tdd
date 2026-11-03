import { describe, expect, test } from 'claude-code/testing'

import { recheckLines } from '../hooks/receipt'

// #269: the receipt took origin's default branch as the base and said so as fact. A pull request into another branch
// reads against the wrong code, and a file new since that branch reads as proven by a step that can't fail.
describe('recheckLines: what a reviewer runs to check the proof', () => {
  const facts = { label: 'utils/a', run: 'npx vitest run tests/utils/a.test.ts', base: 'origin/main', baseFrom: 'origin' as const, fails: 'fails' }

  // #355: the steps put back the base's file and then HEAD's, so on a checkout with the change not yet committed they
  // overwrote it, and git states with nothing to show (filters, flags, a pattern in the path) lost work too. Nothing on
  // this machine can say what a reader's checkout holds, so the receipt prints the run alone and the rest in words.
  test('a change to a file the base has: the run is the only command, and the re-check is in words', () => {
    const lines = recheckLines({ ...facts, path: 'src/utils/a.ts', atBase: 'yes' })
    expect(lines.slice(1, 4)).toEqual(['```', facts.run, '```'])
    expect(lines.at(-1)).toMatch(/in a checkout with nothing uncommitted, put `src\/utils\/a\.ts` back as it is on origin\/main, run the test again, and it fails, which is what the catch check saw/)
  })

  test('no line changes a file: no git command is printed, whatever the base and the path', () => {
    for (const atBase of ['yes', 'no', 'unknown'] as const) {
      for (const path of ['src/utils/a.ts', null]) {
        expect(recheckLines({ ...facts, path, atBase }).join('\n')).not.toMatch(/^git /m)
      }
    }
  })

  // Review of #355: a reader told to put the base's file in and never told to restore it keeps a reverted checkout,
  // and a later `commit -a` undoes the change.
  test('every re-check in words ends by putting the file back', () => {
    for (const atBase of ['yes', 'unknown'] as const) {
      expect(recheckLines({ ...facts, path: 'src/utils/a.ts', atBase }).at(-1)).toMatch(/Then put the file back as it was\./)
    }
  })

  test('it quotes how the test failed when the catch check kept the words', () => {
    expect(recheckLines({ ...facts, fails: 'fails with `expected 1 to be 2`', path: 'src/utils/a.ts', atBase: 'yes' }).at(-1)).toMatch(/run the test again, and it fails with `expected 1 to be 2`, which is what the catch check saw/)
  })

  test('it says which branch it took, and what to do when the change goes elsewhere', () => {
    expect(recheckLines({ ...facts, path: 'src/utils/a.ts', atBase: 'yes' }).at(-1)).toMatch(/origin\/main is origin's default branch: if this change goes into another branch, use that one instead/)
  })

  test('a file new since the base has nothing to put back, so no step claims to prove it', () => {
    const lines = recheckLines({ ...facts, path: 'src/utils/a.ts', atBase: 'no' })
    expect(lines.join('\n')).not.toMatch(/git checkout/)
    expect(lines.at(-1)).toMatch(/src\/utils\/a\.ts is new since origin\/main, so there is no older version to put back/)
  })

  test('no change on record: the run is the whole receipt', () => {
    const lines = recheckLines({ ...facts, path: null, atBase: 'no' })
    expect(lines.join('\n')).not.toMatch(/git checkout/)
    expect(lines.at(-1)).toMatch(/No change to utils\/a is on record this session/)
  })

  // Review of #269: a base that isn't there read as "the file is new", which was false.
  test('a base that can\'t be found is said as that, with the branch to use in words, never as a new file', () => {
    const lines = recheckLines({ ...facts, base: 'main', baseFrom: 'guess', path: 'src/utils/a.ts', atBase: 'unknown' })
    expect(lines.at(-1)).not.toMatch(/is new since/)
    expect(lines.at(-1)).toMatch(/main isn't a branch here, so the code before the change couldn't be found: in a checkout with nothing uncommitted, put `src\/utils\/a\.ts` back as it is on the branch this change goes into/)
  })

  test('a guessed base is called a guess, not origin\'s default branch', () => {
    const line = recheckLines({ ...facts, base: 'main', baseFrom: 'guess', path: 'src/utils/a.ts', atBase: 'yes' }).at(-1) ?? ''
    expect(line).not.toMatch(/origin's default branch/)
    expect(line).toMatch(/main is a guess, as origin names no default branch here/)
  })
})
