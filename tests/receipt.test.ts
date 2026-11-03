import { describe, expect, test } from 'claude-code/testing'

import { recheckLines } from '../hooks/receipt'

// #269: the receipt took origin's default branch as the base and said so as fact. A pull request into another branch
// reads against the wrong code, and a file new since that branch reads as proven by a step that can't fail.
describe('recheckLines: what a reviewer runs to check the proof', () => {
  const facts = { label: 'utils/a', run: 'npx vitest run tests/utils/a.test.ts', base: 'origin/main', baseFrom: 'origin' as const, fails: 'fails' }

  test('a change to a file the base has: the run, the base put back, the run, the change put back', () => {
    const lines = recheckLines({ ...facts, path: 'src/utils/a.ts', atBase: 'yes' })
    expect(lines.slice(1, 6)).toEqual(['```', facts.run, 'git checkout origin/main -- src/utils/a.ts', facts.run, 'git checkout HEAD -- src/utils/a.ts'])
    expect(lines.at(-1)).toMatch(/against the code on origin\/main, before the change, and fails/)
  })

  test('it says which branch it took, and what to do when the change goes elsewhere', () => {
    expect(recheckLines({ ...facts, path: 'src/utils/a.ts', atBase: 'yes' }).at(-1)).toMatch(/origin\/main is origin's default branch: if this change goes into another branch, put that branch in its place/)
  })

  test('a file new since the base has nothing to put back, so no step claims to prove it', () => {
    const lines = recheckLines({ ...facts, path: 'src/utils/a.ts', atBase: 'no' })
    expect(lines.join('\n')).not.toMatch(/git checkout/)
    expect(lines.at(-1)).toMatch(/src\/utils\/a\.ts is new since origin\/main, so there is no older version to put back/)
  })

  test('no change on record: the first run is the whole receipt', () => {
    const lines = recheckLines({ ...facts, path: null, atBase: 'no' })
    expect(lines.join('\n')).not.toMatch(/git checkout/)
    expect(lines.at(-1)).toMatch(/No change to utils\/a is on record this session/)
  })

  // Review of #269: a base that isn't there read as "the file is new", which was false.
  test('a base that can\'t be found is said as that, with the steps to fill in, never as a new file', () => {
    const lines = recheckLines({ ...facts, base: 'main', baseFrom: 'guess', path: 'src/utils/a.ts', atBase: 'unknown' })
    expect(lines).toContain('git checkout main -- src/utils/a.ts')
    expect(lines.at(-1)).not.toMatch(/is new since/)
    expect(lines.at(-1)).toMatch(/main isn't a branch here, so this couldn't be checked: put the branch this change goes into in its place/)
  })

  test('a guessed base is called a guess, not origin\'s default branch', () => {
    const line = recheckLines({ ...facts, base: 'main', baseFrom: 'guess', path: 'src/utils/a.ts', atBase: 'yes' }).at(-1) ?? ''
    expect(line).not.toMatch(/origin's default branch/)
    expect(line).toMatch(/main is a guess, as origin names no default branch here/)
  })

  test('a path with a space is quoted, so the step can be pasted', () => {
    expect(recheckLines({ ...facts, path: 'src/my file.ts', atBase: 'yes' })).toContain('git checkout origin/main -- "src/my file.ts"')
  })
})
