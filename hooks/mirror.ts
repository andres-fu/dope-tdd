const SOURCE_FILE = /^src\/(.+)\.(ts|tsx)$/
const TEST_FILE = /^tests\/(.+)\.test\.(ts|tsx)$/
const TEST_RUN = /\b(vitest|npm (run )?test)\b/

export type ClassifiedPath =
  | { kind: 'source'; module: string }
  | { kind: 'test'; module: string }
  | { kind: 'other' }

function toForwardSlashes(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/([A-Za-z])\//, (_, drive: string) => `${drive.toUpperCase()}:/`)
}

function relativeTo(root: string, path: string): string | undefined {
  const prefix = toForwardSlashes(root).replace(/\/$/, '') + '/'
  const normalized = toForwardSlashes(path)
  const isInside = normalized.toLowerCase().startsWith(prefix.toLowerCase())
  return isInside ? normalized.slice(prefix.length) : undefined
}

export function classifyPath(root: string, path: string): ClassifiedPath {
  const relative = relativeTo(root, path)
  if (relative === undefined || relative.endsWith('.d.ts')) {
    return { kind: 'other' }
  }

  const source = SOURCE_FILE.exec(relative)
  if (source?.[1] !== undefined) {
    return { kind: 'source', module: source[1] }
  }

  const testFile = TEST_FILE.exec(relative)
  if (testFile?.[1] !== undefined) {
    return { kind: 'test', module: testFile[1] }
  }

  return { kind: 'other' }
}

export function isTestRun(command: string): boolean {
  return TEST_RUN.test(command)
}
