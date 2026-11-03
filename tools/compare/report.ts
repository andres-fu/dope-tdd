// What `npm run compare` found, as plain data: tools/compare/compare.ts gathers it, and this says what changed. A run that
// proved less than it should says INCOMPLETE and fails (problemsIn): a clean report from a short run, or from comparing a
// build with itself, is the worst thing this tool can do.

export type Options = { base: string; sessions: boolean; transcripts: string | null }

/** What one reader said about one command, from one folder: the files it writes. */
export type Reader = (command: string, folder: string) => readonly string[]

export type Readings = {
  commands: number
  readings: number
  same: number
  threw: number
  differ: { command: string; folder: string; was: readonly string[]; now: readonly string[] }[]
}

export type EditResult = { deny: string | null; context: readonly string[] | null }

/** What a session showed after one thing happened in it. */
export type Step = { name: string; brief: string; band: string; walks: number; edits: Record<string, EditResult>; status: string }

export type Session = { key: string; steps: Step[] }

type Kind = 'refusals' | 'bands' | 'briefings' | 'messagesLost' | 'messagesAdded' | 'messagesMoved' | 'status' | 'walks'

export type Compared = {
  sessions: number
  identical: number
  missing: string[]
  changed: Record<Kind, number>
  examples: Record<Kind, string[]>
}

const KINDS: readonly (readonly [Kind, string])[] = [
  ['refusals', 'refusals changed'],
  ['bands', 'bands changed'],
  ['briefings', 'briefings changed'],
  ['messagesLost', 'messages lost'],
  ['messagesAdded', 'messages added'],
  ['messagesMoved', 'messages moved'],
  ['status', '/tdd changed'],
  ['walks', 'walks changed'],
]
const MAX_EXAMPLES = 3
const SESSION_LINE = '@@'

export function parseArgs(argv: readonly string[]): Options {
  const options: Options = { base: 'origin/release', sessions: false, transcripts: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--sessions') {
      options.sessions = true
    } else if (arg === '--base' || arg === '--transcripts') {
      const value = argv[++i]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`)
      if (arg === '--base') options.base = value
      else options.transcripts = value
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return options
}

const sorted = (paths: readonly string[]): string => JSON.stringify([...paths].sort())

/** Each distinct command read by both readers, from each folder. */
export function compareReadings(commands: readonly string[], was: Reader, now: Reader, folders: readonly string[]): Readings {
  const distinct = [...new Set(commands)]
  const result: Readings = { commands: distinct.length, readings: 0, same: 0, threw: 0, differ: [] }
  for (const command of distinct) {
    for (const folder of folders) {
      result.readings++
      try {
        const before = was(command, folder)
        const after = now(command, folder)
        if (sorted(before) === sorted(after)) result.same++
        else result.differ.push({ command, folder, was: before, now: after })
      } catch {
        result.threw++
      }
    }
  }
  return result
}

export function formatReadings(result: Readings): string {
  if (result.commands === 0) {
    return 'real commands: none found'
  }
  const shown = result.differ.flatMap(({ command, folder, was, now }) => [
    `  ${folder}: ${command.replace(/\s*\n\s*/g, ' / ').slice(0, 140)}`,
    `    was ${JSON.stringify(was)}`,
    `    now ${JSON.stringify(now)}`,
  ])
  const threw = result.threw === 0 ? '' : `, ${result.threw} threw`
  return [`real commands: ${result.commands} commands, ${result.readings} readings: ${result.same} the same, ${result.differ.length} different${threw}`, ...shown].join('\n')
}

/** The session lines in a test run's output. A line that doesn't parse was cut off, so its session reads as missing. */
export function readSessions(output: string): Map<string, Session> {
  const sessions = new Map<string, Session>()
  for (const line of output.split('\n')) {
    if (!line.startsWith(`${SESSION_LINE}{`)) continue
    try {
      const session = JSON.parse(line.slice(SESSION_LINE.length)) as Session
      sessions.set(session.key, session)
    } catch {
      // Cut off mid-line: the session is missing, and compareSessions says so.
    }
  }
  return sessions
}

const timesIn = (lines: readonly string[], line: string): number => lines.filter(entry => entry === line).length

function changesIn(base: Step, head: Step): Set<Kind> {
  const changes = new Set<Kind>()
  if (base.brief !== head.brief) changes.add('briefings')
  if (base.band !== head.band) changes.add('bands')
  if (base.walks !== head.walks) changes.add('walks')
  if (base.status !== head.status) changes.add('status')
  for (const [path, was] of Object.entries(base.edits)) {
    const now = head.edits[path] ?? { deny: null, context: null }
    if (was.deny !== now.deny) changes.add('refusals')
    const before = was.context ?? []
    const after = now.context ?? []
    if (before.some(line => timesIn(before, line) > timesIn(after, line))) changes.add('messagesLost')
    if (after.some(line => timesIn(after, line) > timesIn(before, line))) changes.add('messagesAdded')
    if (JSON.stringify(before) !== JSON.stringify(after) && before.length === after.length && before.every(line => timesIn(before, line) === timesIn(after, line))) {
      changes.add('messagesMoved')
    }
  }
  return changes
}

/** `planned` is every session that should have been played, so a session both sides lost still reads as missing. */
export function compareSessions(base: readonly Session[], head: readonly Session[], planned: readonly string[]): Compared {
  const bases = new Map(base.map(session => [session.key, session]))
  const heads = new Map(head.map(session => [session.key, session]))
  const none = (): Record<Kind, number> => ({ refusals: 0, bands: 0, briefings: 0, messagesLost: 0, messagesAdded: 0, messagesMoved: 0, status: 0, walks: 0 })
  const keys = [...new Set([...planned, ...bases.keys(), ...heads.keys()])]
  const result: Compared = {
    sessions: keys.length,
    identical: 0,
    missing: [],
    changed: none(),
    examples: { refusals: [], bands: [], briefings: [], messagesLost: [], messagesAdded: [], messagesMoved: [], status: [], walks: [] },
  }
  for (const key of keys) {
    const before = bases.get(key)
    const after = heads.get(key)
    if (before === undefined || after === undefined) {
      result.missing.push(key)
      continue
    }
    let same = true
    for (let index = 0; index < Math.max(before.steps.length, after.steps.length); index++) {
      const was = before.steps[index]
      const now = after.steps[index]
      if (was === undefined || now === undefined) {
        result.missing.push(`${key} @ ${(was ?? now)?.name}`)
        same = false
        continue
      }
      for (const kind of changesIn(was, now)) {
        same = false
        result.changed[kind]++
        if (result.examples[kind].length < MAX_EXAMPLES) result.examples[kind].push(`${key} @ ${was.name}`)
      }
    }
    if (same) result.identical++
  }
  return result
}

export function formatSessions(result: Compared): string {
  const rows = KINDS.flatMap(([kind, label]) => [`  ${label.padEnd(18)} ${result.changed[kind]}`, ...result.examples[kind].map(example => `      ${example}`)])
  return [`sessions: ${result.sessions} sessions, ${result.identical} identical`, ...rows].join('\n')
}

/** Two sets of files, path to text, with nothing to tell them apart. */
export function sameFiles(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  return a.size === b.size && [...a].every(([path, text]) => b.get(path) === text)
}

/** Why this run proved less than it should. Any at all fails the run; a difference never does. */
export function problemsIn(run: { readings: Readings; sameBuild: boolean; kitFailures: readonly string[]; compared?: Compared }): string[] {
  const { readings, sameBuild, kitFailures, compared } = run
  return [
    ...(sameBuild ? ['both sides have the same hooks, so nothing was compared: pick a --base from before the change'] : []),
    ...(readings.commands === 0 ? ['no commands found. Point --transcripts at a folder of session logs'] : []),
    ...(readings.threw === 0 ? [] : [`${readings.threw} readings threw`]),
    ...kitFailures,
    ...(compared !== undefined && compared.sessions === 0 ? ['no sessions were planned or played'] : []),
    ...(compared === undefined || compared.missing.length === 0 ? [] : [`${compared.missing.length} missing, for example ${compared.missing.slice(0, MAX_EXAMPLES).join(', ')}`]),
  ]
}
