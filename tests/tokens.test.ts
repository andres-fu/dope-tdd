import { describe, expect, test } from 'claude-code/testing'

import { tokenize } from '../hooks/tokens'

describe('tokenize', () => {
  test('gives each token its kind, line and offset, and skips whitespace and comments', () => {
    expect(tokenize("a //x\n  === 'b'")).toEqual([
      { text: 'a', kind: 'name', line: 1, start: 0 },
      { text: '===', kind: 'punct', line: 2, start: 8 },
      { text: "'b'", kind: 'string', line: 2, start: 12 },
    ])
  })
})
