import { describe, expect, test } from 'claude-code/testing'

import { SPIKE_SKILL, SPIKE_TTL_MS, removeFolderArgv, spikeQuestion, staleSpikes } from '../hooks/spike'

// Stumble twice (idea 19, docs/decisions/2026-10-26_stumble-twice.md): a spike is explored in a throwaway worktree
// outside the project, recorded, and rebuilt test-first.
describe('SPIKE_SKILL', () => {
  test('matches the spike skill, typed or called by the agent, and nothing else', () => {
    expect(SPIKE_SKILL.test('dope-tdd:spike')).toBe(true)
    expect(SPIKE_SKILL.test('spike')).toBe(true)
    expect(SPIKE_SKILL.test('dope-tdd:pin')).toBe(false)
    expect(SPIKE_SKILL.test('spikes')).toBe(false)
  })
})

describe('spikeQuestion', () => {
  test('reads the Question line the skill carries', () => {
    expect(spikeQuestion('# Spike\n\nQuestion: can the parser stream?\n\nSteps...')).toBe('can the parser stream?')
  })

  test('no question given: says so', () => {
    expect(spikeQuestion('# Spike\n\nQuestion: \n')).toBe('(no question given)')
    expect(spikeQuestion('no line at all')).toBe('(no question given)')
    // The placeholder left unfilled is no question either.
    expect(spikeQuestion('Question: $ARGUMENTS')).toBe('(no question given)')
  })

  test('a long question is cut to 120 characters', () => {
    const question = spikeQuestion(`Question: ${'a'.repeat(200)}`)
    expect(question.length).toBe(120)
    expect(question.endsWith('…')).toBe(true)
  })
})

describe('staleSpikes', () => {
  const NOW = Date.UTC(2026, 9, 26)
  const dir = (name: string, ageMs: number, isLink = false) => ({ name, kind: 'dir' as const, isLink, mtimeMs: NOW - ageMs })

  test('folders older than 7 days, never a link or a file', () => {
    const entries = [
      dir('old', SPIKE_TTL_MS + 1),
      dir('new', 1000),
      dir('linked', SPIKE_TTL_MS + 1, true),
      { name: 'note.txt', kind: 'file' as const, isLink: false, mtimeMs: 0 },
    ]
    expect(staleSpikes(entries, NOW)).toEqual(['old'])
  })

  test('a folder dated in the future is kept', () => {
    expect(staleSpikes([dir('skewed', -60_000)], NOW)).toEqual([])
  })
})

describe('removeFolderArgv', () => {
  test('the path is an argument, never part of the script', () => {
    const argv = removeFolderArgv("C:/Users/x/.dope-tdd/spikes/a'b")
    expect(argv.slice(0, 2)).toEqual(['node', '-e'])
    expect(argv[2]).toMatch(/recursive: true/)
    expect(argv[2]).not.toMatch(/a'b/)
    expect(argv[3]).toBe("C:/Users/x/.dope-tdd/spikes/a'b")
  })
})
