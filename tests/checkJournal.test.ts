import { describe, expect, test } from 'claude-code/testing'

import { afterRevert, elsewhereNotice, repairStep, RUNNING_GRACE_MS } from '../hooks/checkJournal'

const NOW = 1_000_000_000

describe("another project's interrupted catch check: reported to its owner, never repaired from here (#89)", () => {
  test('nothing found elsewhere: nothing to say', () => {
    expect(elsewhereNotice([], NOW)).toBeNull()
  })

  test('an interrupted check elsewhere names the files that may still be reverted, and where they get put back', () => {
    const found = [{ paths: ['C:/elsewhere/proj/m.ts'], atMs: NOW - 2 * RUNNING_GRACE_MS }]
    expect(elsewhereNotice(found, NOW)).toBe(
      'dope-tdd: a catch check in another project was interrupted and may have left C:/elsewhere/proj/m.ts reverted. ' +
        'Open a session in that project and dope-tdd puts it back; nothing there was changed from here.',
    )
  })

  test('a check that may still be running elsewhere is not reported', () => {
    expect(elsewhereNotice([{ paths: ['C:/elsewhere/proj/m.ts'], atMs: NOW - 60_000 }], NOW)).toBeNull()
  })

  test('a journal from an earlier build, with no time, is reported: its check is long over', () => {
    expect(elsewhereNotice([{ paths: ['C:/old/a.ts'] }], NOW)).toMatch(/may have left C:\/old\/a\.ts reverted/)
  })

  test('many files: the first three are named, and how many more there are', () => {
    const found = [{ paths: ['C:/p/a.ts', 'C:/p/b.ts'] }, { paths: ['C:/q/c.ts', 'C:/q/d.ts', 'C:/q/e.ts'] }]
    expect(elsewhereNotice(found, NOW)).toMatch(/may have left C:\/p\/a\.ts, C:\/p\/b\.ts, C:\/q\/c\.ts and 2 more reverted\. .*puts them back/)
  })
})

// Out of register.tsx: what a file the catch check reverted needs once its run is over (checkAgainst), and what a
// journal left by a check that died needs at the next start (repairInterruptedCheck). Each reads the file first.
describe('afterRevert: the reverted file once the check has run', () => {
  test('still the old code: the change goes back', () => {
    expect(afterRevert('old', 'old', 'new')).toBe('restore')
  })

  test('already the change: nothing to write', () => {
    expect(afterRevert('new', 'old', 'new')).toBe('as-is')
  })

  test('something else, or gone: it moved while reverted, and is left as it is', () => {
    expect(afterRevert('a save from the editor', 'old', 'new')).toBe('moved')
    expect(afterRevert(null, 'old', 'new')).toBe('moved')
  })

  test('the old code is looked for first', () => {
    expect(afterRevert('same', 'same', 'same')).toBe('restore')
  })
})

describe('repairStep: a journal left by a check that died', () => {
  test('the file has the change already: nothing to do', () => {
    expect(repairStep('new', { before: 'old', after: 'new' })).toBe('as-is')
  })

  test('still the old code: the change goes back', () => {
    expect(repairStep('old', { before: 'old', after: 'new' })).toBe('restore')
  })

  test('moved since, or gone: the hand that moved it knew more, so the change is kept aside instead', () => {
    expect(repairStep('edited since', { before: 'old', after: 'new' })).toBe('keep-aside')
    expect(repairStep(null, { before: 'old', after: 'new' })).toBe('keep-aside')
  })

  test('the change is looked for first', () => {
    expect(repairStep('same', { before: 'same', after: 'same' })).toBe('as-is')
  })
})
