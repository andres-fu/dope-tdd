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
      layout: DEFAULT_CONFIG.layout,
      roots: [],
      stack: 'node',
      stackSource: 'default',
      godot: null,
      error: null,
      layoutGuessed: true,
    })
    expect(parseConfig('{"layout":"colocated","roots":["packages/*"]}').layout.name).toBe('colocated')
    expect(parseConfig('{"layout":{"source":"lib/{module}.{ext}","test":"spec/{module}.spec.{ext}"}}').layout.name).toBe('custom')
    expect(parseConfig('{"layout":"nested"}').error).toMatch(/layout must be one of mirror, colocated, __tests__/)
    expect(parseConfig('{"layout":{"source":"lib/{module}.ts","test":"x"}}').error).toMatch(/must contain \{ext\}/)
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

describe('layouts: a folder with a layout of its own', () => {
  test('reads a folder → layout map in the main layout\'s terms, and says it', () => {
    const config = parseConfig('{"layout":{"source":"{module}.{ext}","test":"test/{module}.test.{ext}"},"layouts":{"dashboard/":"colocated","tools/gen":{"source":"{module}.{ext}","test":"{module}.spec.{ext}"}}}')
    expect(config.error).toBe(null)
    expect(config.layouts).toEqual([
      { folder: 'dashboard', layout: { name: 'colocated', source: 'src/{module}.{ext}', test: 'src/{module}.test.{ext}' } },
      { folder: 'tools/gen', layout: { name: 'custom', source: '{module}.{ext}', test: '{module}.spec.{ext}' } },
    ])
    expect(describeConfig(config)).toContain('layout in dashboard/: colocated (src/{module}.{ext} ↔ src/{module}.test.{ext})')
    expect(parseConfig('{}').layouts).toBe(undefined)
  })

  test('a folder must be a plain path inside the project, and its layout a real one', () => {
    expect(parseConfig('{"layouts":["dashboard"]}').error).toMatch(/layouts must map folders to layouts/)
    expect(parseConfig('{"layouts":{"apps/*":"colocated"}}').error).toMatch(/layouts: "apps\/\*" must be a plain folder/)
    expect(parseConfig('{"layouts":{"../web":"colocated"}}').error).toMatch(/layouts: "\.\.\/web" must be a plain folder/)
    expect(parseConfig('{"layouts":{"":"colocated"}}').error).toMatch(/layouts: "" must be a plain folder/)
    expect(parseConfig('{"layouts":{"/srv/web":"colocated"}}').error).toMatch(/layouts: "\/srv\/web" must be a plain folder/)
    expect(parseConfig('{"layouts":{"C:/work/web":"colocated"}}').error).toMatch(/layouts: "C:\/work\/web" must be a plain folder/)
    expect(parseConfig('{"layouts":{"web":"nested"}}').error).toMatch(/layouts: web: layout must be one of/)
  })
})

describe('describeConfig', () => {
  test('says the mode, the scope, the exemptions and any error in plain lines', () => {
    expect(describeConfig(parseConfig('{"mode":"enforce","scope":["src/billing/**"],"exempt":["src/main.tsx"],"roots":["packages/*"]}'))).toEqual([
      'mode: enforce in src/billing/**',
      'exempt: src/main.tsx',
      'layout: mirror (src/{module}.{ext} ↔ tests/{module}.test.{ext})',
      'roots: packages/*',
    ])
    const broken = describeConfig(parseConfig('nope'))
    expect(broken[0]).toBe('mode: enforce')
    expect(broken.at(-1)).toMatch(/^config: dope-tdd\.json: .*\(using defaults\)$/)
  })
})
