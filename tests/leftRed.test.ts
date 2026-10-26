import { describe, expect, test } from 'claude-code/testing'

import { LEFT_RED_TTL_MS, freshLeftRed, leftRedAtEnd, leftRedKey, leftRedNote, redModules } from '../hooks/leftRed'
import { FRESH_MODULE, INITIAL_STATS } from '../hooks/stats'
import type { ModuleState, TddStats } from '../types'

const NOW = Date.UTC(2026, 9, 26, 12)

function withModules(modules: Record<string, Partial<ModuleState>>, extra: Partial<TddStats> = {}): TddStats {
  return { ...INITIAL_STATS, ...extra, modules: Object.fromEntries(Object.entries(modules).map(([id, m]) => [id, { ...FRESH_MODULE, ...m }])) }
}

// Idea 15 (Theory of Developer Momentum): a module still red when a session ends is a stop, and the next session
// should start from it instead of finding it again.
describe('redModules', () => {
  test('names each module still red, with the tests its red named', () => {
    const s = withModules({ 'utils/a': { phase: 'red', redFailures: ['formats months'] }, 'utils/b': { phase: 'green' } })
    expect(redModules(s, NOW)).toEqual([{ module: 'utils/a', failing: ['formats months'], atMs: NOW }])
  })

  test('the stuck failure message is the failing line when it is about that module', () => {
    const s = withModules({ 'utils/a': { phase: 'red', redFailures: ['x'] } }, { sameRed: { module: 'utils/a', failure: 'expected 1 to be 2', runs: 2 } })
    expect(redModules(s, NOW)[0]?.failing).toEqual(['expected 1 to be 2'])
  })

  test('no red module: nothing', () => {
    expect(redModules(withModules({ 'utils/a': { phase: 'writing' } }), NOW)).toEqual([])
  })
})

describe('leftRedAtEnd', () => {
  const old = { module: 'utils/old', failing: ['y'], atMs: NOW - 1000 }

  test('keeps an earlier stop this session never touched, and adds this session\'s reds', () => {
    const s = withModules({ 'utils/a': { phase: 'red' } })
    expect(leftRedAtEnd([old], s, NOW).map(entry => entry.module)).toEqual(['utils/old', 'utils/a'])
  })

  test('an earlier stop this session worked on and left green is cleared', () => {
    const s = withModules({ 'utils/old': { phase: 'green' } })
    expect(leftRedAtEnd([old], s, NOW)).toEqual([])
  })

  test('an earlier stop still red is restated as of now', () => {
    const s = withModules({ 'utils/old': { phase: 'red', redFailures: ['z'] } })
    expect(leftRedAtEnd([old], s, NOW)).toEqual([{ module: 'utils/old', failing: ['z'], atMs: NOW }])
  })
})

describe('freshLeftRed', () => {
  test('drops entries older than the carry-over window and anything malformed', () => {
    const fresh = { module: 'utils/a', failing: ['x'], atMs: NOW - 1000 }
    const stale = { module: 'utils/b', failing: [], atMs: NOW - LEFT_RED_TTL_MS - 1 }
    expect(freshLeftRed([fresh, stale, { module: 3 }, 'x'], NOW)).toEqual([fresh])
    expect(freshLeftRed(undefined, NOW)).toEqual([])
    expect(freshLeftRed([null, fresh], NOW)).toEqual([fresh])
    expect(freshLeftRed({ module: 'utils/a' }, NOW)).toEqual([])
  })
})

describe('leftRedKey', () => {
  test('one key per root, whatever the spelling', () => {
    expect(leftRedKey('C:\\work\\x\\')).toBe('left-red:c:/work/x')
  })
})

describe('leftRedNote', () => {
  test('names the module, the failing test, and the next step', () => {
    expect(leftRedNote([{ module: 'utils/a', failing: ['formats months'], atMs: NOW }])).toBe(
      'Left red when an earlier session ended: utils/a (failing: `formats months`). Start there: run its test, then make it pass or say why it stays red.',
    )
  })

  test('several modules, and one with no failing test named', () => {
    const note = leftRedNote([
      { module: 'utils/a', failing: ['x', 'y'], atMs: NOW },
      { module: 'utils/b', failing: [], atMs: NOW },
    ])
    expect(note).toMatch(/^Left red when an earlier session ended: utils\/a \(failing: `x`, `y`\); utils\/b\. Start there/)
  })

  test('nothing left red: no note', () => {
    expect(leftRedNote([])).toBeNull()
  })
})
