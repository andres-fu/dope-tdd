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
  const holdsText = async (path: string, says: (text: string) => boolean): Promise<boolean> => {
    const found = read === undefined ? null : await read(path)
    return found !== null && says(found)
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
  // The walk stops at the repository's top (the nearest folder with a .git), or at the root outside git: a monorepo
  // hoists its runner to its top, but a program in a folder above the repository is nobody's to run (verified review
  // A15, 2026-10-20: the walk had no bound). A worktree nested under the checkout it came from is no top: its shell
  // walks up to that checkout's node_modules, so its catch check must too (#250).
  let repoTop = root
  for (let dir: string | null = root; dir !== null; dir = parentDir(dir)) {
    if (!/[\\/]\.claude[\\/]worktrees[\\/][^\\/]+$/.test(dir) && (await exists(`${dir}/.git`))) {
      repoTop = dir
      break
    }
  }
  const topKey = pathKey(repoTop)
  for (let dir: string | null = root; dir !== null; dir = pathKey(dir) === topKey ? null : parentDir(dir)) {
    for (const runner of candidates) {
      if (runner.markers.length === 0) {
        // No marker to find (dotnet, unittest): a program in the repo still wins over the one on PATH, such as a venv's python.
        for (const candidate of runner.tools) {
          if (await exists(`${root}/${candidate}`)) {
            return { kind: runner.kind, root, tool: `${root}/${candidate}` }
          }
        }
        return { kind: runner.kind, root, tool: fallbackTool(runner, root) }
      }
      // A marker by its presence (or its text), a file that lists the runner, and, at the root, the test file itself.
      const signs = [
        ...runner.markers.map(marker => ({ path: `${dir}/${marker}`, says: (text: string) => runner.markerText?.test(text) ?? true, needsText: runner.markerText !== undefined })),
        ...(runner.listedIn?.files ?? []).map(file => ({ path: `${dir}/${file}`, says: (text: string) => runner.listedIn?.text.test(text) === true, needsText: true })),
        ...(runner.testFileSays === undefined || pathKey(dir) !== top ? [] : [{ path: testPath, says: runner.testFileSays, needsText: true }]),
      ]
      for (const { path: marker, says, needsText } of signs) {
        if ((await exists(marker)) && (!needsText || (await holdsText(marker, says)))) {
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
          const named = runner.launcherFrom === undefined || read === undefined ? undefined : await read(marker)
          const launcher = named === undefined || named === null ? undefined : runner.launcherFrom?.(named)
          // A .tsx or .jsx test this runner can load only through a JSX-capable loader the script does not pass: not its runner.
          if (runner.jsxLoader !== undefined && /\.[jt]sx$/.test(testPath) && !(launcher ?? []).some(arg => runner.jsxLoader?.test(arg))) {
            continue
          }
          return { kind: runner.kind, root: dir, tool: fallbackTool(runner, root), ...(launcher === undefined ? {} : { launcher }) }
        }
      }
    }
  }
  return null
}
