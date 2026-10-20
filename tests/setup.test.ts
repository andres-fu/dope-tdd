import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_CONFIG, parseConfig } from '../hooks/config'
import { formatSetup, inferLayout, suggestedConfig } from '../hooks/setup'

describe('inferLayout', () => {
  test('tests under tests/ mean mirror', () => {
    const inferred = inferLayout({ files: ['src/a.ts', 'tests/a.test.ts', 'tests/b/c.test.ts'], packageDirs: [''] })
    expect(inferred.layout.name).toBe('mirror')
    expect(inferred.reason).toBe('2 of 2 test files sit under tests/')
  })

  test('tests next to their sources mean colocated; the majority wins', () => {
    const inferred = inferLayout({ files: ['src/a.ts', 'src/a.test.ts', 'src/b.test.ts', 'tests/old.test.ts'], packageDirs: [''] })
    expect(inferred.layout.name).toBe('colocated')
    expect(inferred.reason).toBe('2 of 3 test files sit next to their source')
  })

  test('tests in __tests__ folders mean __tests__', () => {
    expect(inferLayout({ files: ['src/utils/__tests__/a.test.ts'], packageDirs: [''] }).layout.name).toBe('__tests__')
  })

  test('no test files means the default, and says so', () => {
    const inferred = inferLayout({ files: ['src/a.ts'], packageDirs: [''] })
    expect(inferred.layout.name).toBe('mirror')
    expect(inferred.reason).toMatch(/no test files found/)
  })

  test('sibling packages with a src/ become a root glob, and the layout is read inside them', () => {
    const inferred = inferLayout({
      files: ['packages/app/src/a.ts', 'packages/app/tests/a.test.ts', 'packages/web/src/b.ts', 'packages/web/tests/b.test.ts', 'tools/x.js'],
      packageDirs: ['', 'packages/app', 'packages/web', 'tools'],
    })
    expect(inferred.roots).toEqual(['packages/*'])
    expect(inferred.layout.name).toBe('mirror')
    expect(inferred.testFiles).toBe(2)
  })

  // Karl's Axiom backend (2026-10-19): with no tests yet, Python's default mirror layout covers only src/, so a
  // root-level api.py paired with no test and an edit to it would have gone through unguarded.
  test('with no test files, the layout that covers the code is chosen over a default that covers none of it', () => {
    const flat = inferLayout({ files: ['api.py', 'axiom_supabase.py', 'lib/util.py'], packageDirs: [], rootEntries: ['requirements.txt', 'api.py', 'lib'] })
    expect(flat.stack).toBe('python')
    expect(flat.layout.name).toBe('package')
    expect(flat.reason).toBe('no test files found; package covers 3 of 3 code files, mirror covers 0')
    expect(suggestedConfig(DEFAULT_CONFIG, flat)).toEqual({ stack: 'python', layout: 'package' })
    // Code under src/ is covered by the default, which stays.
    const src = inferLayout({ files: ['src/pkg/calc.py'], packageDirs: [], rootEntries: ['pyproject.toml', 'src'] })
    expect(src.layout.name).toBe('mirror')
    expect(src.reason).toBe('no test files found, assuming the default')
  })
})

describe('suggestedConfig and formatSetup', () => {
  test('the suggestion keeps mode, scope and exempt and adds only what differs from the default', () => {
    const current = parseConfig('{"mode":"warn","exempt":["src/main.tsx"]}')
    const inferred = inferLayout({ files: ['src/a.test.ts'], packageDirs: [''] })
    expect(suggestedConfig(current, inferred)).toEqual({ mode: 'warn', exempt: ['src/main.tsx'], layout: 'colocated' })
    expect(suggestedConfig(DEFAULT_CONFIG, inferLayout({ files: ['tests/a.test.ts'], packageDirs: [''] }))).toEqual({})
  })

  test('the setup text shows what was detected, examples, the current config and the JSON to write', () => {
    const survey = { files: ['src/utils/a.ts', 'src/utils/a.test.ts', 'src/b.test.ts'], packageDirs: [''] }
    const text = formatSetup(DEFAULT_CONFIG, inferLayout(survey), survey, false)
    expect(text).toMatch(/detected layout: colocated \(src\/\{module\}\.\{ext\} ↔ src\/\{module\}\.test\.\{ext\}\); 2 of 2 test files sit next to their source/)
    expect(text).toMatch(/  src\/utils\/a\.test\.ts ↔ src\/utils\/a\.ts/)
    expect(text).toMatch(/  src\/b\.test\.ts ↔ src\/b\.\* \(no source file found\)/)
    expect(text).toMatch(/current dope-tdd\.json: none \(mirror by default\)/)
    expect(text).toMatch(/"layout": "colocated"/)
    expect(text).toMatch(/\/tdd setup write saves it/)
  })

  test('says so when the current layout already matches', () => {
    const survey = { files: ['tests/a.test.ts'], packageDirs: [''] }
    expect(formatSetup(DEFAULT_CONFIG, inferLayout(survey), survey, true)).toMatch(/already matches; nothing to write/)
  })
})
