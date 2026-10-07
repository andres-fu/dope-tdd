import type { Layer } from '../types'

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'TS',
  tsx: 'TSX',
  js: 'JS',
  jsx: 'JSX',
  py: 'PY',
  go: 'GO',
}

const FRONTEND_FOLDERS = ['components', 'pages', 'hooks', 'views', 'ui']
const FRONTEND_ENTRY_POINTS = ['App', 'main', 'index']
const BACKEND_FOLDERS = ['server', 'api', 'routes', 'db', 'backend']

export function languageOf(path: string): string {
  const fileName = path.split('/').pop() ?? ''
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) {
    return '?'
  }
  const extension = fileName.slice(dot + 1).toLowerCase()
  return LANGUAGE_BY_EXTENSION[extension] ?? extension.toUpperCase()
}

export function layerOf(module: string, extension: string): Layer {
  const segments = module.split('/')
  const hasFolder = (folders: string[]) => segments.some(s => folders.includes(s))

  if (hasFolder(BACKEND_FOLDERS)) {
    return 'backend'
  }
  const isEntryPoint = segments.length === 1 && FRONTEND_ENTRY_POINTS.includes(module)
  if (hasFolder(FRONTEND_FOLDERS) || extension === 'tsx' || extension === 'jsx' || isEntryPoint) {
    return 'frontend'
  }
  return 'logic'
}
