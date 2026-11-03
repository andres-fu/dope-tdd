import { describe, expect, test } from 'claude-code/testing'

import { recheckLines } from '../hooks/receipt'

// #269: the receipt took origin's default branch as the base and said so as fact. A pull request into another branch
// reads against the wrong code, and a file new since that branch reads as proven by a step that can't fail.
describe('recheckLines: what a reviewer runs to check the proof', () => {
  const base = { label: 'utils/a', run: 'npx vitest run tests/utils/a.test.ts', base: 'main', fails: 'fails' }

  test('a change to a file the base has: the run, the base put back, the run, the change put back', () => {
    const lines = recheckLines({ ...base, path: 'src/utils/a.ts', atBase: true })
    expect(lines.slice(1, 6)).toEqual(['```', base.run, 'git checkout main -- src/utils/a.ts', base.run, 'git checkout HEAD -- src/utils/a.ts'])
    expect(lines.at(-1)).toMatch(/against the code on main, before the change, and fails/)
  })

  test('it says which branch it took, and what to do when the change goes elsewhere', () => {
    expect(recheckLines({ ...base, path: 'src/utils/a.ts', atBase: true }).at(-1)).toMatch(/main is origin's default branch: if this change goes into another branch, put that branch in its place/)
  })

  test('a file new since the base has nothing to put back, so no step claims to prove it', () => {
    const lines = recheckLines({ ...base, path: 'src/utils/a.ts', atBase: false })
    expect(lines.join('\n')).not.toMatch(/git checkout/)
    expect(lines.at(-1)).toMatch(/src\/utils\/a\.ts is new since main, so there is no older version to put back/)
  })

  test('no change on record: the first run is the whole receipt', () => {
    const lines = recheckLines({ ...base, path: null, atBase: false })
    expect(lines.join('\n')).not.toMatch(/git checkout/)
    expect(lines.at(-1)).toMatch(/No change to utils\/a is on record this session/)
  })
})
