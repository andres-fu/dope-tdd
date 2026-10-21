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

  // Karl's Axiom backend (2026-10-19): api.py at the root, a React app in klq-frontend, and the app's package.json at
  // the root too. The marker said node and suggested roots ["klq-frontend"], which would guard the app and not api.py.
  test('a package.json at the root whose code all sits in a nested package does not outvote Python at the root', () => {
    const inferred = inferLayout({
      files: ['api.py', 'axiom_supabase.py', 'klq-frontend/src/App.tsx', 'klq-frontend/src/main.tsx', 'klq-frontend/src/lib/a.ts'],
      packageDirs: ['', 'klq-frontend'],
      rootEntries: ['package.json', 'api.py', 'axiom_supabase.py', 'klq-frontend'],
    })
    expect(inferred.stack).toBe('python')
    expect(inferred.stackReason).toBe('2 python files at the root; the node code sits only under klq-frontend')
    expect(inferred.roots).toEqual([])
    // With #131's layout pick, setup suggests all of Karl's hand-written config.
    expect(suggestedConfig(DEFAULT_CONFIG, inferred)).toEqual({ stack: 'python', layout: 'package' })
    // Verified review D4 (2026-10-20): only Python files at the root itself were counted, so the common FastAPI layout,
    // app/main.py and app/routers/, still read as node beside a frontend and a root package.json.
    const fastapi = inferLayout({
      files: ['app/main.py', 'app/routers/items.py', 'vite.config.ts', 'frontend/src/App.tsx', 'frontend/src/main.tsx'],
      packageDirs: ['', 'frontend'],
      rootEntries: ['package.json', 'pyproject.toml', 'app', 'frontend', 'vite.config.ts'],
    })
    expect(fastapi.stack).toBe('python')
    expect(fastapi.stackReason).toBe('2 python files outside frontend against 1 node file outside frontend (vite.config.ts)')
    // Karl's round 3: one stray Sidebar.jsx at the root no longer outvotes the Python there; the reason says it was weighed.
    const stray = inferLayout({
      files: ['api.py', 'axiom_supabase.py', 'db.py', 'Sidebar.jsx', 'klq-frontend/src/App.tsx', 'klq-frontend/src/Sidebar.jsx'],
      packageDirs: ['', 'klq-frontend'],
      rootEntries: ['package.json', 'requirements.txt', 'api.py', 'axiom_supabase.py', 'db.py', 'Sidebar.jsx', 'klq-frontend'],
    })
    expect(stray.stack).toBe('python')
    expect(stray.stackReason).toBe('3 python files at the root against 1 node file outside klq-frontend (Sidebar.jsx)')
    expect(suggestedConfig(DEFAULT_CONFIG, stray)).toEqual({ stack: 'python', layout: 'package' })
    // With no nested package, the root package.json is the root's own: a couple of Python scripts beside it stay node.
    const flatNode = inferLayout({ files: ['index.js', 'a.py', 'b.py'], packageDirs: [''], rootEntries: ['package.json', 'index.js', 'a.py', 'b.py'] })
    expect(flatNode.stack).toBe('node')
    // Node code at the root as plentiful as the other stack's keeps the marker's word, and so does a nested app with no other stack at the root.
    const atRoot = inferLayout({ files: ['api.py', 'vite.config.ts', 'klq-frontend/src/App.tsx'], packageDirs: ['', 'klq-frontend'], rootEntries: ['package.json', 'api.py', 'vite.config.ts', 'klq-frontend'] })
    expect(atRoot.stack).toBe('node')
    const onlyNode = inferLayout({ files: ['web/src/App.tsx'], packageDirs: ['', 'web'], rootEntries: ['package.json', 'web'] })
    expect(onlyNode.stack).toBe('node')
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

  // Karl's round 4 (2026-10-20): with no file, `; stack node` beside `detected stack: python` read as a contradiction.
  // Both were true: the guard reads only the root's markers until the file names a stack. Now it says that.
  test('with no file, a stack the root markers chose that differs from the detected one is said as what runs until saved', () => {
    const survey = { files: ['api.py', 'tests/test_api.py', 'tools/x.py'], packageDirs: [] }
    const text = formatSetup(parseConfig(null, 'node'), inferLayout(survey), survey, false)
    expect(text).toMatch(/^detected stack: python/m)
    expect(text).toMatch(/^current dope-tdd\.json: none\. Until one is saved, the guard runs as node \(from the markers at the root\), not python$/m)
  })

  test('says so when the current layout already matches', () => {
    const survey = { files: ['tests/a.test.ts'], packageDirs: [''] }
    expect(formatSetup(DEFAULT_CONFIG, inferLayout(survey), survey, true)).toMatch(/already matches; nothing to write/)
  })
})
