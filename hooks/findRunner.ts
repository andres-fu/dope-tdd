import type { RunnerKind } from './runners'
import { fallbackTool, runnersFor } from './runners'
import { isInsideRoot } from './mirror'
import type { StackName } from './stacks'

/**
 * Where a test file's runner is, and what to run it with: shared by the plugin (which asks Claude Code whether a
 * file exists) and the pull-request check (which asks the disk), so both find the same runner the same way.
 */
export type FoundRunner = { kind: RunnerKind; root: string; tool: string; launcher?: readonly string[] }

export function parentDir(dir: string): string | null {
  const trimmed = dir.replace(/[\\/]+$/, '')
  const cut = trimmed.replace(/[\\/][^\\/]*$/, '')
  return cut === trimmed || cut === '' ? null : cut
}

/** Walks up from the project root, because a monorepo hoists the runner into a parent directory; only the stack's own runners are looked for. */
export async function findRunner(root: string, stack: StackName, testPath: string, exists: (path: string) => Promise<boolean>): Promise<FoundRunner | null> {
  const candidates = runnersFor(stack, testPath)
  // First a runner installed in the test's own package (a monorepo that does not hoist): from the test's folder up to the root.
  const top = root.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
  for (let dir: string | null = parentDir(testPath.replace(/\\/g, '/')); dir !== null && dir.toLowerCase() !== top && isInsideRoot(root, dir); dir = parentDir(dir)) {
    for (const runner of candidates) {
      for (const candidate of runner.tools) {
        if (await exists(`${dir}/${candidate}`)) {
          return { kind: runner.kind, root: dir, tool: `${dir}/${candidate}` }
        }
      }
    }
  }
  for (let dir: string | null = root; dir !== null; dir = parentDir(dir)) {
    for (const runner of candidates) {
      if (runner.markers.length === 0) {
        return { kind: runner.kind, root, tool: fallbackTool(runner, root) }
      }
      for (const marker of runner.markers) {
        if (await exists(`${dir}/${marker}`)) {
          for (const candidate of runner.tools) {
            if (await exists(`${dir}/${candidate}`)) {
              return { kind: runner.kind, root: dir, tool: `${dir}/${candidate}` }
            }
          }
          // No program in the repo: a lockfile may name the launcher that knows where the environment lives.
          for (const launcher of runner.launchers ?? []) {
            if (await exists(`${dir}/${launcher.marker}`)) {
              return { kind: runner.kind, root: dir, tool: fallbackTool(runner, root), launcher: launcher.argv }
            }
          }
          return { kind: runner.kind, root: dir, tool: fallbackTool(runner, root) }
        }
      }
    }
  }
  return null
}
