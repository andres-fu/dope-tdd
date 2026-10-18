import type { RunnerKind } from './runners.ts'
import { fallbackTool, runnersFor } from './runners.ts'
import { isInsideRoot, pathKey } from './mirror.ts'
import type { StackName } from './stacks.ts'

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

/**
 * Walks up from the project root, because a monorepo hoists the runner into a parent directory; only the stack's own runners are looked for.
 * `read` gives a marker's text, null when it cannot be read; without it, a runner whose marker must hold certain text is never found.
 */
export async function findRunner(
  root: string,
  stack: StackName,
  testPath: string,
  exists: (path: string) => Promise<boolean>,
  read?: (path: string) => Promise<string | null>,
): Promise<FoundRunner | null> {
  const holds = async (path: string, text: RegExp | undefined): Promise<boolean> => {
    if (text === undefined) {
      return true
    }
    const found = read === undefined ? null : await read(path)
    return found !== null && text.test(found)
  }
  const candidates = runnersFor(stack, testPath)
  // First a runner installed in the test's own package (a monorepo that does not hoist): from the test's folder up to the root.
  const top = pathKey(root)
  for (let dir: string | null = parentDir(testPath.replace(/\\/g, '/')); dir !== null && pathKey(dir) !== top && isInsideRoot(root, dir); dir = parentDir(dir)) {
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
        if ((await exists(`${dir}/${marker}`)) && (await holds(`${dir}/${marker}`, runner.markerText))) {
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
          // The marker itself may name one: Node's own flags in the test script that found the runner.
          const named = runner.launcherFrom === undefined || read === undefined ? undefined : await read(`${dir}/${marker}`)
          const launcher = named === undefined || named === null ? undefined : runner.launcherFrom?.(named)
          return { kind: runner.kind, root: dir, tool: fallbackTool(runner, root), ...(launcher === undefined ? {} : { launcher }) }
        }
      }
    }
  }
  return null
}
