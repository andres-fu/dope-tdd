import { describe, expect, test } from 'claude-code/testing'

import { languageOf, layerOf } from '../hooks/describeTest'
import { formatAgo, formatSpan } from '../hooks/timeText'

describe('languageOf', () => {
  test('names common test file languages by extension', () => {
    expect(languageOf('tests/utils/a.test.ts')).toBe('TS')
    expect(languageOf('tests/components/A.test.tsx')).toBe('TSX')
    expect(languageOf('tests/a.test.js')).toBe('JS')
    expect(languageOf('tests/test_a.py')).toBe('PY')
    expect(languageOf('pkg/a_test.go')).toBe('GO')
  })

  test('falls back to the upper-cased extension, or ? when there is none', () => {
    expect(languageOf('tests/a.test.rb')).toBe('RB')
    expect(languageOf('tests/Makefile')).toBe('?')
  })
})

describe('layerOf', () => {
  test('treats UI folders and .tsx files as frontend', () => {
    expect(layerOf('components/CareerTimeline', 'tsx')).toBe('frontend')
    expect(layerOf('hooks/usePersistedEntries', 'ts')).toBe('frontend')
    expect(layerOf('pages/Home', 'ts')).toBe('frontend')
    expect(layerOf('App', 'tsx')).toBe('frontend')
    expect(layerOf('main', 'ts')).toBe('frontend')
  })

  test('treats server-side folders as backend', () => {
    expect(layerOf('api/entries', 'ts')).toBe('backend')
    expect(layerOf('server/routes/health', 'ts')).toBe('backend')
    expect(layerOf('db/migrate', 'ts')).toBe('backend')
  })

  test('treats everything else as logic', () => {
    expect(layerOf('utils/formatDuration', 'ts')).toBe('logic')
    expect(layerOf('data/career', 'ts')).toBe('logic')
  })
})

describe('time text', () => {
  test('formatAgo reads as a short relative time', () => {
    expect(formatAgo(20_000)).toBe('JUST NOW')
    expect(formatAgo(2 * 60_000)).toBe('2M AGO')
    expect(formatAgo(3 * 3_600_000)).toBe('3H AGO')
    expect(formatAgo(2 * 86_400_000)).toBe('2D AGO')
  })

  test('formatAgo treats a future time (clock skew) as just now', () => {
    expect(formatAgo(-5_000)).toBe('JUST NOW')
  })

  test('formatSpan reads as a compact duration', () => {
    expect(formatSpan(45_000)).toBe('45S')
    expect(formatSpan(3 * 60_000)).toBe('3M')
    expect(formatSpan(130_000)).toBe('2M10S')
    expect(formatSpan(65 * 60_000)).toBe('1H05M')
  })
})
