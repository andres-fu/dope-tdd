import { describe, expect, test } from 'claude-code/testing'

import { isTestRun } from '../hooks/mirror'
import { fakeEngine, runBash, runCommand } from './engine'

describe('KNOWN BUGS found overnight 2026-10-07 (expected to fail until fixed; delete this file when fixed)', () => {
  test('reading a vitest config file is not a test run', async ($, on) => {
    fakeEngine(on)

    await runBash($, 'cat vitest.config.ts')
    const status = await runCommand($, 'tdd')

    expect(isTestRun('cat vitest.config.ts')).toBe(false)
    expect(status.text).toMatch(/runs: 0/)
  })

  test('a shell command that creates the mirrored test unlocks its module', async ($, on) => {
    const world = fakeEngine(on)
    world.onBash = () => {
      world.untracked = ''
    }

    await runBash($, "cat > tests/utils/calculateDuration.test.ts <<'EOT'\nit('x', () => {})\nEOT")
    const result = await runBash($, "sed -i 's/a/b/' src/utils/calculateDuration.ts")

    expect(result.deny).toBeUndefined()
  })

})
