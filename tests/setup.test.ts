import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_CONFIG, parseConfig } from '../hooks/config'
import { activeLayoutNote, answerFrom, briefingNote, formatSetup, inferLayout, isUnreadLanguage, layoutMismatch, inferenceFor, needsWalk, projectNote, projectStack, readProject, setupInference, suggestedConfig, withInference } from '../hooks/setup'

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

  // Karl's round 4 (2026-10-20): setup never named a runner, so the pytest choice could only be seen in a later hint.
  test('names the command a test runs with, once one is found, and says nothing of a runner when none is', () => {
    const survey = { files: ['api.py', 'tests/test_api.py'], packageDirs: [] }
    const text = formatSetup(parseConfig(null, 'python'), inferLayout(survey), survey, false, 'python -m pytest <test file>')
    expect(text).toMatch(/^test command: python -m pytest <test file>$/m)
    expect(formatSetup(parseConfig(null, 'python'), inferLayout(survey), survey, false)).not.toMatch(/test command/)
  })

  test('says so when the current layout already matches', () => {
    const survey = { files: ['tests/a.test.ts'], packageDirs: [''] }
    expect(formatSetup(DEFAULT_CONFIG, inferLayout(survey), survey, true)).toMatch(/already matches; nothing to write/)
  })
})

// #167, seen adopting dope-tdd in an Astro site: no dope-tdd.json, tests beside their sources in a site/ package. The
// default mirror layout matched no file, so the guard paired nothing and said nothing.
describe('layoutMismatch', () => {
  const astro = { files: ['site/src/lib/countup.ts', 'site/src/lib/countup.test.ts', 'site/src/data/projects.ts'], packageDirs: ['site'] }

  test('/tdd setup finds the co-located layout inside the package', () => {
    const inferred = inferLayout(astro)
    expect(inferred.layout.name).toBe('colocated')
    expect(inferred.roots).toEqual(['site'])
  })

  test('with no config file and a default layout that matches no source file, it says so and names what setup finds', () => {
    const note = layoutMismatch(astro, DEFAULT_CONFIG)
    expect(note).toMatch(/default layout matches none of this project's code/)
    expect(note).toMatch(/colocated \(src\/\{module\}\.\{ext\} ↔ src\/\{module\}\.test\.\{ext\}\) under site/)
    expect(note).toMatch(/no edit is refused until a dope-tdd\.json is saved: ask the user to run \/tdd setup/)
  })

  test('nothing to say when the default fits, a config file names the layout, or there is no code', () => {
    expect(layoutMismatch({ files: ['src/a.ts', 'tests/a.test.ts'], packageDirs: [''] }, DEFAULT_CONFIG)).toBeNull()
    expect(layoutMismatch(astro, { ...DEFAULT_CONFIG, layoutGuessed: false })).toBeNull()
    expect(layoutMismatch({ files: [], packageDirs: [] }, DEFAULT_CONFIG)).toBeNull()
  })
})

// #268 (2026-10-31): with no marker a session assumed Node, so a Python or C# project went unguarded and nothing said so.
describe('readProject: what the repo says it is', () => {
  const survey = (files: string[], rootEntries: string[] = [], unread: string[] = []) => ({ files, packageDirs: [], rootEntries, unread })

  test('with no marker, the code decides: Python files mean Python', () => {
    expect(readProject(survey(['api.py', 'tests/test_api.py', 'db.py']))).toMatchObject({ kind: 'clear', stack: 'python' })
    expect(readProject(survey(['src/App.java', 'src/AppTest.java']))).toMatchObject({ kind: 'clear', stack: 'java' })
  })

  test('.cs files with no project.godot are .NET, on a count that used to give Godot', () => {
    expect(readProject(survey(['App.cs', 'AppTests.cs']))).toMatchObject({ kind: 'clear', stack: 'dotnet' })
    expect(readProject(survey(['player.gd', 'level.gd', 'App.cs', 'Other.cs']))).toMatchObject({ kind: 'mixed' })
  })

  test('one stack with three quarters of the code is clear; below that it can\'t tell', () => {
    expect(readProject(survey(['a.py', 'b.py', 'c.py', 'tool.js']))).toMatchObject({ kind: 'clear', stack: 'python' })
    expect(readProject(survey(['a.py', 'b.py', 'c.py', 'd.py', 'e.py', 'tool.js', 'x.js']))).toMatchObject({ kind: 'mixed' })
    expect(readProject(survey(['a.py', 'b.py', 'tool.js']))).toMatchObject({ kind: 'mixed', languages: ['python', 'node'] })
  })

  test('no code at all is empty, not Node', () => {
    expect(readProject(survey([]))).toEqual({ kind: 'empty' })
  })

  test('a language we do not read says so, and outweighs a stray script', () => {
    expect(readProject(survey([], [], ['main.go', 'util.go']))).toEqual({ kind: 'unsupported', languages: ['Go'], unguarded: [] })
    expect(readProject(survey(['tools/gen.js'], [], ['main.go', 'util.go', 'cmd.go', 'x.rs']))).toEqual({ kind: 'unsupported', languages: ['Go', 'Rust'], unguarded: [] })
    expect(readProject(survey(['a.py', 'b.py', 'c.py', 'd.py'], [], ['gen.go']))).toMatchObject({ kind: 'clear', stack: 'python' })
  })
})

describe('readProject: the edges', () => {
  const survey = (files: string[], rootEntries: string[] = [], unread: string[] = []) => ({ files, packageDirs: [], rootEntries, unread })

  test('unread code counts in the share, so it can stop one language being clear', () => {
    expect(readProject(survey(['a.py', 'b.py', 'c.py'], [], ['x.go', 'y.go']))).toMatchObject({ kind: 'mixed', languages: ['python', 'Go'] })
  })

  test('languages are named most first', () => {
    expect(readProject(survey(['a.py', 'x.js', 'y.js'], [], ['g.go', 'h.go', 'i.go']))).toMatchObject({ kind: 'mixed', languages: ['Go', 'node'] })
    expect(readProject(survey(['a.py'], [], ['a.rs', 'b.go', 'c.go']))).toMatchObject({ kind: 'unsupported', languages: ['Go', 'Rust'] })
  })

  test('as much unread code as code is not unsupported: a language here is still read', () => {
    expect(readProject(survey(['a.py', 'b.py'], [], ['x.go', 'y.go']))).toMatchObject({ kind: 'mixed' })
  })

  test('languages we do not read are named, not called empty', () => {
    for (const [file, language] of [['a.swift', 'Swift'], ['a.kt', 'Kotlin'], ['a.c', 'C'], ['a.cpp', 'C++'], ['a.fs', 'F#'], ['a.scala', 'Scala'], ['a.dart', 'Dart']] as const) {
      expect(isUnreadLanguage(file)).toBe(true)
      expect(readProject(survey([], [], [file]))).toEqual({ kind: 'unsupported', languages: [language], unguarded: [] })
    }
    expect(isUnreadLanguage('README.md')).toBe(false)
    expect(isUnreadLanguage('a.py')).toBe(false)
    expect(isUnreadLanguage('constructor')).toBe(false)
    expect(isUnreadLanguage('x.constructor')).toBe(false)
    expect(isUnreadLanguage('go')).toBe(false)
  })
})

describe('readProject: code that is guarded by nothing', () => {
  const survey = (files: string[], unread: string[]): Survey => ({ files, packageDirs: [], unread })

  test('names the readable stacks the Node defaults leave out', () => {
    expect(readProject(survey(['a.py', 'App.cs'], ['x.go', 'y.go', 'z.go']))).toEqual({ kind: 'unsupported', languages: ['Go'], unguarded: ['dotnet', 'python'] })
  })

  test('Node code is guarded by the defaults, so it is not named', () => {
    expect(readProject(survey(['tool.js'], ['x.go', 'y.go']))).toEqual({ kind: 'unsupported', languages: ['Go'], unguarded: [] })
  })

  test('other spellings of the languages it names count too', () => {
    for (const [file, language] of [['x.h', 'C'], ['x.hpp', 'C++'], ['x.cxx', 'C++'], ['x.exs', 'Elixir']] as const) {
      expect(readProject(survey([], [file]))).toEqual({ kind: 'unsupported', languages: [language], unguarded: [] })
    }
  })
})

describe('answerFrom: what one walk settles', () => {
  const survey = (files: string[], packageDirs: string[] = []): Survey => ({ files, packageDirs })

  test('a layout read from the repo means no note while it applies, and keeps what the default would say for a config that arrives', () => {
    const answer = answerFrom(survey(['site/src/lib/countup.ts', 'site/src/lib/countup.test.ts'], ['site']))
    expect(answer.reading).toMatchObject({ kind: 'clear', stack: 'node' })
    expect(answer.inferred?.roots).toEqual(['site'])
    expect(answer.layoutNote).toBeNull()
    expect(answer.defaultNote).toMatch(/default layout matches none/)
  })

  test('a layout that still pairs nothing is said under the stack the repo was read as', () => {
    const answer = answerFrom(survey(['MyApp/Service.cs', 'MyApp/Util.cs']))
    expect(answer.reading).toMatchObject({ kind: 'clear', stack: 'dotnet' })
    expect(answer.layoutNote).toMatch(/no edit is refused/)
    expect(answer.layoutNote).toMatch(/It finds dotnet/)
  })

  test('so is one under a reading that is not clear, where C# is still .NET', () => {
    const answer = answerFrom(survey(['Api/Service.cs', 'Api/Util.cs', 'Api/Repo.cs', 'web/a.ts', 'web/b.ts']))
    expect(answer.reading).toMatchObject({ kind: 'mixed' })
    expect(answer.layoutNote).toMatch(/no edit is refused/)
    expect(answer.layoutNote).not.toMatch(/godot/)
  })

  test('a reading that is not clear sets no layout', () => {
    const answer = answerFrom(survey(['a.py', 'b.py', 'tool.js']))
    expect(answer.inferred).toBeNull()
  })
})

describe('activeLayoutNote: the note for the config in force', () => {
  const answer = { reading: { kind: 'empty' } as const, inferred: null, layoutNote: 'the reading', defaultNote: 'the default' }
  const guessed = parseConfig(null, undefined)

  test('the reading while it applies', () => {
    expect(activeLayoutNote(answer, guessed, 'the default')).toBe('the reading')
    expect(activeLayoutNote({ ...answer, layoutNote: null }, guessed, 'the default')).toBeNull()
  })

  test('the default once it stops applying, and none when a config names the layout', () => {
    expect(activeLayoutNote(null, guessed, 'the default')).toBe('the default')
    expect(activeLayoutNote(null, parseConfig('{"layout":"mirror"}', undefined), 'the default')).toBeNull()
  })
})

describe('setupInference: what /tdd setup detects', () => {
  const survey: Survey = { files: ['api.py', 'db.py'], packageDirs: [] }

  test('a stack the config pins comes first', () => {
    const inferred = setupInference(survey, parseConfig('{"stack":"node"}', undefined), { kind: 'clear', stack: 'python', reason: 'r' })
    expect(inferred).toMatchObject({ stack: 'node', stackReason: 'named in dope-tdd.json' })
  })

  test("a clear reading gives its stack and its own reason, since no file names it", () => {
    const inferred = setupInference(survey, parseConfig(null, 'python'), { kind: 'clear', stack: 'python', reason: '2 python files, no marker at the root' })
    expect(inferred).toMatchObject({ stack: 'python', stackReason: '2 python files, no marker at the root' })
  })

  test('with no reading the survey decides, as it always did', () => {
    expect(setupInference(survey, parseConfig(null, undefined), null).stack).toBe('python')
    expect(setupInference({ files: ['App.cs', 'Other.cs'], packageDirs: [] }, parseConfig(null, undefined), null).stack).toBe('godot')
  })

  test('a reading that is not clear still takes the stack with the most code, and C# is .NET there too', () => {
    const cs: Survey = { files: ['Api/Service.cs', 'Api/Util.cs', 'Api/Repo.cs', 'web/a.ts', 'web/b.ts'], packageDirs: [] }
    expect(setupInference(cs, parseConfig(null, undefined), { kind: 'mixed', languages: ['dotnet', 'node'] })).toMatchObject({ stack: 'dotnet', stackReason: '3 dotnet files, no marker at the root' })
    expect(setupInference({ files: ['App.cs'], packageDirs: [] }, parseConfig(null, undefined), { kind: 'unsupported', languages: ['Go'], unguarded: ['dotnet'] }).stack).toBe('dotnet')
  })

  test('with no code it reads, the survey decides, and names no stack', () => {
    expect(setupInference({ files: [], packageDirs: [] }, parseConfig(null, undefined), { kind: 'empty' }).stack).toBe('node')
  })
})

describe('formatSetup: what the guard runs as until a file is saved', () => {
  const survey: Survey = { files: ['api.py', 'db.py'], packageDirs: [] }

  test('says the markers decided when they did, and the default when nothing did', () => {
    expect(formatSetup(parseConfig(null, 'node'), inferLayout(survey), survey, false)).toContain('the guard runs as node (from the markers at the root), not python')
    expect(formatSetup(parseConfig(null, undefined), inferLayout(survey), survey, false)).toContain('the guard runs as node (the default, with no marker at the root), not python')
  })
})

describe('needsWalk: the new reading is only for a project with nothing to go on', () => {
  test('no config and no marker reads the repo', () => {
    expect(needsWalk(null, undefined)).toBe(true)
  })

  test('any config file, valid or not, or a marker, stays as it was', () => {
    expect(needsWalk('{"layout":"mirror"}', undefined)).toBe(false)
    expect(needsWalk('{"stack":"python"}', undefined)).toBe(false)
    expect(needsWalk('not json', undefined)).toBe(false)
    expect(needsWalk(null, 'node')).toBe(false)
  })
})

describe('projectStack', () => {
  test('only a clear reading sets a stack', () => {
    expect(projectStack({ kind: 'clear', stack: 'python', reason: 'r' })).toBe('python')
    expect(projectStack({ kind: 'mixed', languages: ['python', 'node'] })).toBeUndefined()
    expect(projectStack({ kind: 'empty' })).toBeUndefined()
    expect(projectStack({ kind: 'unsupported', languages: ['Go'] })).toBeUndefined()
  })
})

describe('projectNote: what the briefing says', () => {
  test('a stack read from the code says so and how to keep it', () => {
    const note = projectNote({ kind: 'clear', stack: 'python', reason: '3 python files, no marker at the root' })
    expect(note).toContain('read from its code as python')
    expect(note).toContain('/tdd setup write')
  })

  test('mixed and empty say the Node defaults are what runs, because they are', () => {
    expect(projectNote({ kind: 'mixed', languages: ['python', 'node'] })).toContain('Node defaults')
    expect(projectNote({ kind: 'mixed', languages: ['python', 'Go'] })).toContain('python and Go')
    expect(projectNote({ kind: 'mixed', languages: ['python', 'node'] })).toContain('other code is not guarded')
    expect(projectNote({ kind: 'mixed', languages: ['python', 'node'] })).toContain('/tdd setup write guards one stack, the one with the most code')
    expect(projectNote({ kind: 'empty' })).toContain('Node defaults')
    expect(projectNote({ kind: 'empty' })).toContain('any other code is not guarded')
  })

  test('unsupported says that code is not guarded', () => {
    expect(projectNote({ kind: 'unsupported', languages: ['Go', 'Rust'], unguarded: [] })).toContain('Go and Rust')
    expect(projectNote({ kind: 'unsupported', languages: ['Go', 'Rust'], unguarded: [] })).toContain('not guarded')
    expect(projectNote({ kind: 'unsupported', languages: ['Go'], unguarded: [] })).not.toContain('/tdd setup')
    expect(projectNote({ kind: 'unsupported', languages: ['Go'], unguarded: ['python', 'java'] })).toContain("The python and java code here isn't guarded either. /tdd setup write guards one stack, the one with the most code.")
  })
})

describe('briefingNote: which note wins', () => {
  test('with a reading, its note wins over the layout note, so mixed and unsupported are always said', () => {
    expect(briefingNote({ kind: 'unsupported', languages: ['Go'], unguarded: [] }, 'the layout note')).toContain('Go')
    expect(briefingNote({ kind: 'mixed', languages: ['python', 'node'] }, 'the layout note')).toContain('python and node')
  })

  test('a reading that is not clear keeps the layout warning beside it (#167)', () => {
    expect(briefingNote({ kind: 'mixed', languages: ['python', 'node'] }, 'the layout note')).toContain('the layout note')
    expect(briefingNote({ kind: 'empty' }, null)).not.toContain('null')
  })

  test('a clear reading whose layout still pairs nothing keeps the warning: nothing is guarded, so it must be said', () => {
    expect(briefingNote({ kind: 'clear', stack: 'node', reason: 'r' }, 'the layout note')).toBe('the layout note')
    expect(briefingNote({ kind: 'clear', stack: 'node', reason: 'r' }, null)).toContain('read from its code')
  })

  test('with no reading, the layout note is unchanged', () => {
    expect(briefingNote(null, 'the layout note')).toBe('the layout note')
    expect(briefingNote(null, null)).toBeNull()
  })
})

describe('inferenceFor: when the layout the repo shows replaces the default', () => {
  test('a default that pairs nothing gives way to the layout the repo shows', () => {
    const survey = { files: ['site/src/a.ts', 'site/src/a.test.ts'], packageDirs: ['site'], rootEntries: [] }
    expect(inferenceFor(survey, parseConfig(null, 'node'))?.layout.name).toBe('colocated')
  })

  test('a default that already pairs code stays, so a root package is not dropped for a nested one', () => {
    const survey = { files: ['src/x.ts', 'tests/x.test.ts', 'packages/web/src/y.ts'], packageDirs: ['packages/web'], rootEntries: [] }
    expect(inferenceFor(survey, parseConfig(null, 'node'))).toBeNull()
  })

  test('applying it keeps the rest of the config', () => {
    const survey = { files: ['site/src/a.ts', 'site/src/a.test.ts'], packageDirs: ['site'], rootEntries: [] }
    const config = parseConfig(null, 'node')
    const used = withInference(config, inferenceFor(survey, config))
    expect(used.layout.name).toBe('colocated')
    expect(used.layoutGuessed).toBe(true)
    expect(withInference(config, null)).toBe(config)
  })
})
