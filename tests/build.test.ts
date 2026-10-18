import { describe, expect, test } from 'claude-code/testing'

import { buildLabel } from '../hooks/build'

// Which build of dope-tdd is running, shown first in /tdd (2026-10-18): after each merged PR, at a glance.
describe('buildLabel', () => {
  test('a merge commit names its pull request, the commit and the date', () => {
    expect(buildLabel('a6b93d4|2026-10-18|Merge pull request #99 from andres-fu/live-trial-fixes', null)).toBe('#99 · a6b93d4 · 2026-10-18')
  })

  test('a squash merge names its pull request too', () => {
    expect(buildLabel('b1c2d3e|2026-10-19|fix: the band shows open overrides (#100)', null)).toBe('#100 · b1c2d3e · 2026-10-19')
  })

  test('any other commit is the commit and the date', () => {
    expect(buildLabel('c3d4e5f|2026-10-19|wip: trying something', null)).toBe('c3d4e5f · 2026-10-19')
  })

  test('not a git checkout: the version in plugin.json, or unknown', () => {
    expect(buildLabel(null, '0.6.0')).toBe('version 0.6.0')
    expect(buildLabel('', null)).toBe('build unknown')
    expect(buildLabel('garbled', null)).toBe('build unknown')
  })
})
