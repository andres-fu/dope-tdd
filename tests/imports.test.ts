import { describe, expect, test } from 'claude-code/testing'

import { importCandidates, joinRelative } from '../hooks/imports'

describe('importCandidates', () => {
  test('TypeScript ESM: a .js import names the .ts file, relative to the test', () => {
    const text = 'import { slugify } from "../src/lib/io.js";\nimport { describe } from "vitest";\n'
    expect(importCandidates('test/slugify.test.ts', text, 'node')).toContain('src/lib/io.ts')
  })

  test('a type-only import carries no behaviour and is left out', () => {
    const text = 'import type { Meta } from "../src/types.js";\nimport { readMeta } from "../src/lib/io.js";\n'
    const found = importCandidates('test/io.test.ts', text, 'node')
    expect(found.some(path => path.startsWith('src/types'))).toBe(false)
    expect(found).toContain('src/lib/io.ts')
  })

  test('side-effect imports, re-exports, dynamic imports and require are read too; packages are not', () => {
    const text = "import './setup.js'\nexport * from '../src/a'\nconst b = await import('../src/b.js')\nconst c = require('../src/c')\nimport x from 'lodash'\n"
    const found = importCandidates('test/x.test.ts', text, 'node')
    expect(found).toContain('test/setup.ts')
    expect(found).toContain('src/a.ts')
    expect(found).toContain('src/b.ts')
    expect(found).toContain('src/c.ts')
    expect(found.some(path => path.includes('lodash'))).toBe(false)
  })

  test('Python: dotted and relative imports, at the root or under src', () => {
    const text = 'from pkg.calc import add\nimport pkg.util\nfrom .helpers import x\n'
    const found = importCandidates('tests/pkg/test_calc.py', text, 'python')
    expect(found).toContain('pkg/calc.py')
    expect(found).toContain('src/pkg/calc.py')
    expect(found).toContain('pkg/util.py')
    expect(found).toContain('tests/pkg/helpers.py')
  })

  test('GDScript: preload and load of res:// paths', () => {
    expect(importCandidates('test/player_test.gd', 'const Player = preload("res://scripts/player.gd")\n', 'godot')).toEqual(['scripts/player.gd'])
  })

  test('a path that climbs above the root resolves to nothing', () => {
    expect(joinRelative('test', '../../outside/a.ts')).toBe(null)
    expect(importCandidates('test/a.test.ts', "import { a } from '../../outside/a.js'\n", 'node')).toEqual([])
  })
})
