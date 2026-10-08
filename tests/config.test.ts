import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_CONFIG, describeConfig, globMatches, parseConfig, policyFor } from '../hooks/config'

describe('parseConfig', () => {
  test('no file means enforce everywhere', () => {
    expect(parseConfig(null)).toEqual(DEFAULT_CONFIG)
  })

  test('reads mode, scope and exempt', () => {
    expect(parseConfig('{"mode":"warn","scope":["src/billing/**"],"exempt":["src/main.tsx"]}')).toEqual({
      mode: 'warn',
      scope: ['src/billing/**'],
      exempt: ['src/main.tsx'],
      error: null,
    })
  })

  test('a bad file falls back to enforce and says why', () => {
    expect(parseConfig('{"mode":"strict"}').error).toMatch(/mode must be one of enforce, warn, observe/)
    expect(parseConfig('not json').mode).toBe('enforce')
    expect(parseConfig('{"exempt":"src/main.tsx"}').error).toMatch(/exempt must be a list of path patterns/)
  })
})

describe('globMatches', () => {
  test('** crosses directories, * stays within one, exact paths match themselves', () => {
    expect(globMatches('src/**', 'src/a/b/c.ts')).toBe(true)
    expect(globMatches('src/*.ts', 'src/a.ts')).toBe(true)
    expect(globMatches('src/*.ts', 'src/a/b.ts')).toBe(false)
    expect(globMatches('src/**/*.config.ts', 'src/vite.config.ts')).toBe(true)
    expect(globMatches('src/**/*.config.ts', 'src/a/b/x.config.ts')).toBe(true)
    expect(globMatches('src/main.tsx', 'src/main.tsx')).toBe(true)
    expect(globMatches('src/main.tsx', 'src/main.tsx.bak')).toBe(false)
  })
})

describe('policyFor', () => {
  const config = parseConfig('{"mode":"enforce","scope":["src/billing/**"],"exempt":["src/billing/generated/**"]}')

  test('exempt wins, then out of scope is observed, then the mode applies', () => {
    expect(policyFor(config, 'src/billing/generated/types.ts')).toBe('exempt')
    expect(policyFor(config, 'src/utils/a.ts')).toBe('observe')
    expect(policyFor(config, 'src/billing/invoice.ts')).toBe('enforce')
  })

  test('without a scope the mode applies everywhere', () => {
    expect(policyFor(parseConfig('{"mode":"warn"}'), 'src/anything.ts')).toBe('warn')
  })
})

describe('describeConfig', () => {
  test('says the mode, the scope, the exemptions and any error in plain lines', () => {
    expect(describeConfig(parseConfig('{"mode":"enforce","scope":["src/billing/**"],"exempt":["src/main.tsx"]}'))).toEqual([
      'mode: enforce in src/billing/**',
      'exempt: src/main.tsx',
    ])
    const broken = describeConfig(parseConfig('nope'))
    expect(broken[0]).toBe('mode: enforce')
    expect(broken[1]).toMatch(/^config: dope-tdd\.json: .*\(using defaults\)$/)
  })
})
