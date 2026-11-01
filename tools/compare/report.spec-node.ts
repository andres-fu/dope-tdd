// node --test tools/compare/report.spec-node.ts (not *.test.ts: the plugin test kit would load it)
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { compareReadings, compareSessions, formatReadings, formatSessions, parseArgs, problemsIn, readSessions, sameFiles } from './report.ts'
import type { Session, Step } from './report.ts'

const step = (over: Partial<Step> = {}): Step => ({
  name: 'start',
  brief: 'the briefing',
  band: 'the band',
  walks: 1,
  edits: { 'src/new.ts': { deny: 'refused', context: ['a line'] } },
  status: 'guard: ON',
  ...over,
})
const session = (key: string, steps: Step[] = [step()]): Session => ({ key, steps })
const compared = (base: Session[], head: Session[]) => compareSessions(base, head, [...new Set([...base, ...head].map(({ key }) => key))])

test('parseArgs: the commands alone by default, against release', () => {
  assert.deepEqual(parseArgs([]), { base: 'origin/release', sessions: false, transcripts: null })
})

test('parseArgs: a base, the sessions, and a folder of transcripts', () => {
  assert.deepEqual(parseArgs(['--base', 'main', '--sessions', '--transcripts', '/t']), { base: 'main', sessions: true, transcripts: '/t' })
})

test('parseArgs: a flag it does not know, or one missing its value, is an error, not a run of something else', () => {
  assert.throws(() => parseArgs(['--sesions']), /--sesions/)
  assert.throws(() => parseArgs(['--base']), /--base needs a value/)
  assert.throws(() => parseArgs(['--base', '--sessions']), /--base needs a value/)
})

test('compareReadings: each command from each folder, with what changed', () => {
  const was = (command: string) => (command === 'b' ? ['old'] : [])
  const now = (command: string, folder: string) => (command === 'b' && folder === '/two' ? ['new'] : was(command))

  const result = compareReadings(['a', 'b', 'a'], was, now, ['/one', '/two'])

  assert.equal(result.commands, 2)
  assert.equal(result.readings, 4)
  assert.equal(result.same, 3)
  assert.deepEqual(result.differ, [{ command: 'b', folder: '/two', was: ['old'], now: ['new'] }])
})

test('compareReadings: the order of the paths is not a difference', () => {
  const result = compareReadings(['a'], () => ['x', 'y'], () => ['y', 'x'], ['/one'])
  assert.equal(result.same, 1)
})

test('compareReadings: a reader that throws is counted apart, and never read as agreement', () => {
  const broken = () => {
    throw new Error('no')
  }
  const result = compareReadings(['a'], broken, () => [], ['/one'])
  assert.equal(result.same, 0)
  assert.equal(result.threw, 1)
  assert.match(formatReadings(result), /1 threw/)
})

test('formatReadings: says how much was read, and shows each difference', () => {
  const text = formatReadings(compareReadings(['a'], () => ['x'], () => [], ['/one']))
  assert.match(text, /1 commands, 1 readings: 0 the same, 1 different/)
  assert.match(text, /was \["x"\]/)
})

test('formatReadings: no commands to read says so, not that all is well', () => {
  assert.match(formatReadings(compareReadings([], () => [], () => [], ['/one'])), /none found/)
})

test('compareSessions: identical sessions report nothing changed', () => {
  const result = compared([session('a')], [session('a')])
  assert.equal(result.sessions, 1)
  assert.equal(result.identical, 1)
  assert.deepEqual(result.changed, { refusals: 0, bands: 0, briefings: 0, messagesLost: 0, messagesAdded: 0, messagesMoved: 0, status: 0, walks: 0 })
})

test('compareSessions: each kind of change is counted apart, with an example', () => {
  const changed = step({
    brief: 'another',
    band: 'another',
    walks: 2,
    status: 'guard: OFF',
    edits: { 'src/new.ts': { deny: null, context: ['a new line'] } },
  })
  const result = compared([session('a')], [session('a', [changed])])
  assert.equal(result.identical, 0)
  assert.deepEqual(result.changed, { refusals: 1, bands: 1, briefings: 1, messagesLost: 1, messagesAdded: 1, messagesMoved: 0, status: 1, walks: 1 })
  assert.equal(result.examples.refusals[0], 'a @ start')
})

const said = (context: string[]) => step({ edits: { 'src/new.ts': { deny: 'refused', context } } })

test('compareSessions: a message said twice is a message added, and one said once less is lost', () => {
  const twice = compared([session('a', [said(['x'])])], [session('a', [said(['x', 'x'])])])
  assert.equal(twice.changed.messagesAdded, 1)
  assert.equal(twice.identical, 0)
  const once = compared([session('a', [said(['x', 'x'])])], [session('a', [said(['x'])])])
  assert.equal(once.changed.messagesLost, 1)
})

test('compareSessions: the same messages in another order are moved, not identical', () => {
  const result = compared([session('a', [said(['x', 'y'])])], [session('a', [said(['y', 'x'])])])
  assert.equal(result.changed.messagesMoved, 1)
  assert.equal(result.identical, 0)
})

test('compareSessions: a session on either side only is reported, so a short run never reads as clean', () => {
  assert.deepEqual(compared([session('a'), session('b')], [session('a')]).missing, ['b'])
  assert.deepEqual(compared([session('a')], [session('a'), session('b')]).missing, ['b'])
})

test('compareSessions: a session the plan holds and neither side played is missing: both sides failing is not agreement', () => {
  const result = compareSessions([session('a')], [session('a')], ['a', 'b'])
  assert.deepEqual(result.missing, ['b'])
  assert.equal(result.sessions, 2)
})

test('compareSessions: a session with fewer or more steps on either side is missing a step, and is not identical', () => {
  const short = compared([session('a', [step(), step({ name: 'next' })])], [session('a')])
  assert.deepEqual(short.missing, ['a @ next'])
  assert.equal(short.identical, 0)
  const long = compared([session('a')], [session('a', [step(), step({ name: 'next' })])])
  assert.deepEqual(long.missing, ['a @ next'])
  assert.equal(long.identical, 0)
})

test('sameFiles: the same files with the same text, however they are ordered', () => {
  assert.equal(sameFiles(new Map([['a', '1'], ['b', '2']]), new Map([['b', '2'], ['a', '1']])), true)
  assert.equal(sameFiles(new Map([['a', '1']]), new Map([['a', '2']])), false)
  assert.equal(sameFiles(new Map([['a', '1'], ['b', '2']]), new Map([['a', '1'], ['b', '3']])), false)
  assert.equal(sameFiles(new Map([['a', '1']]), new Map([['a', '1'], ['b', '2']])), false)
})

const clean = { readings: compareReadings(['a'], () => [], () => [], ['/one']), sameBuild: false, kitFailures: [] }

test('problemsIn: a run that compared everything has none', () => {
  assert.deepEqual(problemsIn(clean), [])
  assert.deepEqual(problemsIn({ ...clean, compared: compared([session('a')], [session('a')]) }), [])
})

test('problemsIn: no commands, a reader that threw, or the same build on both sides means nothing was proved', () => {
  assert.match(problemsIn({ ...clean, readings: compareReadings([], () => [], () => [], ['/one']) }).join(), /no commands/)
  assert.match(problemsIn({ ...clean, readings: compareReadings(['a'], () => { throw new Error('no') }, () => [], ['/one']) }).join(), /1 readings threw/)
  assert.match(problemsIn({ ...clean, sameBuild: true }).join(), /same hooks/)
})

test('problemsIn: a kit that failed, sessions that went missing, or no sessions at all are each said', () => {
  assert.match(problemsIn({ ...clean, kitFailures: ['head, batch 2: exit 3'] }).join(), /head, batch 2: exit 3/)
  assert.match(problemsIn({ ...clean, compared: compared([session('a'), session('b')], [session('a')]) }).join(), /1 missing, for example b/)
  assert.match(problemsIn({ ...clean, compared: compareSessions([], [], []) }).join(), /no sessions/)
})

test('formatSessions: leads with refusals, and names what changed', () => {
  const text = formatSessions(compared([session('a')], [session('a', [step({ edits: { 'src/new.ts': { deny: null, context: ['a line'] } } })])]))
  assert.match(text, /1 sessions/)
  assert.match(text, /refusals changed\s+1/)
  assert.ok(text.indexOf('refusals') < text.indexOf('bands'))
  assert.match(text, /a @ start/)
})

test('readSessions: reads the lines the harness printed', () => {
  assert.deepEqual([...readSessions(['(pass) a test', `@@${JSON.stringify(session('a'))}`, '  1 pass'].join('\n')).keys()], ['a'])
})

test('readSessions: a line cut off mid-way is skipped, so its session reads as missing', () => {
  assert.deepEqual([...readSessions('@@{"key":"a').keys()], [])
})
