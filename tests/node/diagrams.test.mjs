// The README's diagrams (2026-10-29) must say what the code does. "Is it on?" is drawn from the band's own words, so
// a guard word added, renamed or dropped in the band model fails here until the diagram and the README say it too.
// Node only: it reads the repository's files, which the plugin test runner does not load.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { renderIsItOn } from '../../tools/diagrams/is-it-on.mjs'

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const guardWords = [...read('hooks/bandModel.ts').matchAll(/return \{ word: (['"])([A-Z' ]+)\1, detail:/g)].map(m => m[2])

test('finds the band words to check', () => {
  assert.ok(guardWords.includes('PAUSED'))
  assert.ok(guardWords.length >= 8, `found only ${guardWords.join(', ')}`)
})

test('the diagram and the README name every word the band can show', () => {
  const svg = read('assets/is-it-on.svg').replace(/&#39;/g, "'")
  const readme = read('README.md')
  for (const word of guardWords) {
    assert.ok(svg.includes(word), `assets/is-it-on.svg does not name ${word}`)
    assert.ok(readme.includes(word), `README.md does not name ${word}`)
  }
})

test('the diagram is exactly what tools/diagrams/is-it-on.mjs draws: change it there and run npm run diagrams', () => {
  assert.equal(read('assets/is-it-on.svg'), renderIsItOn())
})

test('the README shows both diagrams', () => {
  const readme = read('README.md')
  assert.ok(readme.includes('(assets/where-it-applies.svg)'))
  assert.ok(readme.includes('(assets/is-it-on.svg)'))
})
