#!/usr/bin/env node
// The scorecard: one main goal and the limits around it, every number
// computed from the records on this machine and never typed by hand. Each
// figure names the rows it came from, so anyone can check it; what is not
// measured yet says so instead of showing a guess.
//
//   node tools/pool/scorecard.mjs          write ~/.dope-tdd/pool/scorecard.md and print it
//
// Sources, all under ~/.dope-tdd:
//   pool/ledger.jsonl        one line per launcher run (tools/pool/ab.mjs)
//   sessions/*.json          one record per Claude Code session that did anything
//   pool/prs.json            the PRs we opened on other people's repositories (tools/pool/prs.mjs)
//   pool/checks.jsonl        hand-checked verdicts: { id, mode, verdict, correct, note }

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const GUARDED = new Set(['enforce', 'warn'])

function sum(rows, field) {
  return rows.reduce((total, row) => total + (typeof row[field] === 'number' ? row[field] : 0), 0)
}

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Guarded and unguarded legs of the same A/B run, as ratios guarded / unguarded. */
function overheadPairs(ledger) {
  const byId = new Map()
  for (const row of ledger) {
    const legs = byId.get(row.id) ?? {}
    legs[row.mode] = row
    byId.set(row.id, legs)
  }
  const pairs = []
  for (const [id, legs] of byId) {
    const guarded = legs.enforce ?? legs.warn
    const plain = legs.observe
    if (guarded === undefined || plain === undefined) continue
    const ratio = field => (typeof guarded[field] === 'number' && typeof plain[field] === 'number' && plain[field] > 0 ? guarded[field] / plain[field] : null)
    pairs.push({ id, cost: ratio('costUsd'), turns: ratio('turns'), time: ratio('durationMs') })
  }
  return pairs
}

/** Everything the page shows, from the raw records alone. */
export function computeScorecard({ ledger = [], sessions = [], prs = [], checks = [] }) {
  const guarded = ledger.filter(row => GUARDED.has(row.mode))
  const proved = guarded.filter(row => (row.caught ?? 0) + (row.proven ?? 0) > 0)
  const pairs = overheadPairs(ledger)
  const ratios = field => pairs.map(pair => pair[field]).filter(value => value !== null)
  return {
    goal: {
      guardedRuns: guarded.length,
      proved: proved.length,
      share: guarded.length === 0 ? null : proved.length / guarded.length,
      provedIds: proved.map(row => `${row.id}/${row.mode}`),
      unprovedIds: guarded.filter(row => !proved.includes(row)).map(row => `${row.id}/${row.mode}`),
    },
    wrongVerdicts: { checked: checks.length, wrong: checks.filter(check => check.correct === false).length, wrongIds: checks.filter(check => check.correct === false).map(check => check.id) },
    overhead: {
      pairs: pairs.length,
      pairIds: pairs.map(pair => pair.id),
      cost: median(ratios('cost')),
      turns: median(ratios('turns')),
      time: median(ratios('time')),
    },
    checkTime: (() => {
      const timed = guarded.filter(row => typeof row.checkMs === 'number' && typeof row.durationMs === 'number' && row.durationMs > 0)
      const checkMs = sum(timed, 'checkMs')
      const runMs = sum(timed, 'durationMs')
      return { runs: timed.length, checkMs, runMs, share: runMs === 0 ? null : checkMs / runMs }
    })(),
    refusals: { runs: guarded.length, total: sum(guarded, 'blocked'), max: guarded.reduce((most, row) => Math.max(most, row.blocked ?? 0), 0) },
    workarounds: { runs: guarded.length, total: sum(guarded, 'workarounds') },
    proofGaps: { missed: sum(guarded, 'missed'), unguarded: sum(guarded, 'unguarded') },
    cost: { runs: ledger.length, total: sum(ledger, 'costUsd'), perRun: ledger.length === 0 ? null : sum(ledger, 'costUsd') / ledger.length },
    sessions: {
      count: sessions.length,
      guarded: sessions.filter(record => GUARDED.has(record.mode)).length,
      blocked: sum(sessions, 'blocked'),
      workarounds: sum(sessions, 'workarounds'),
      caught: sum(sessions, 'caught'),
      proven: sum(sessions, 'proven'),
      missed: sum(sessions, 'missed'),
      unverified: sum(sessions, 'unverified'),
      refactors: sum(sessions, 'refactors'),
    },
    prs: {
      total: prs.length,
      merged: prs.filter(pr => pr.status === 'merged').length,
      open: prs.filter(pr => pr.status === 'open').length,
      closed: prs.filter(pr => pr.status === 'closed').length,
      evidenced: prs.filter(pr => ['caught', 'proven', 'refactor'].includes(pr.verdict)).length,
      checkedAt: prs.map(pr => pr.checkedAt).filter(Boolean).sort().pop() ?? null,
    },
  }
}

const pct = value => (value === null ? 'n/a' : `${Math.round(value * 100)}%`)
const times = value => (value === null ? 'n/a' : `${value.toFixed(2)}×`)

export function renderScorecard(card, sources) {
  const { goal, wrongVerdicts, overhead, refusals, workarounds, proofGaps, cost, sessions, prs } = card
  return [
    '# Dope TDD scorecard',
    '',
    `Computed ${sources.at} from the records on this machine; no number here is typed by hand. Sources at the bottom.`,
    '',
    '## Main goal: proven changes, no extra effort for the person',
    '',
    `- Guarded runs that ended with proof (CAUGHT or PROVEN): **${goal.proved} of ${goal.guardedRuns} (${pct(goal.share)})**. Without proof: ${goal.unprovedIds.length === 0 ? 'none' : goal.unprovedIds.join(', ')}.`,
    '- Effort for the person: **not measured automatically yet**. Count setup steps and interventions per tester by hand.',
    '',
    '## Limits',
    '',
    '| Limit | Now | Line not to cross |',
    '| --- | --- | --- |',
    `| Wrong verdicts (hand-checked) | ${wrongVerdicts.checked === 0 ? 'no hand-checked runs yet' : `${wrongVerdicts.wrong} of ${wrongVerdicts.checked}`} | 0 |`,
    `| Overhead, guarded vs unguarded (median of ${overhead.pairs} A/B pairs) | cost ${times(overhead.cost)}, turns ${times(overhead.turns)}, time ${times(overhead.time)} | ≤ 1.25× |`,
    `| Catch check's share of guarded run time (${card.checkTime.runs} runs) | ${card.checkTime.runs === 0 ? 'not recorded yet' : pct(card.checkTime.share)} | info: the rest is the agent's own steps |`,
    `| Refusals per guarded run | ${refusals.total} in ${refusals.runs} runs (max ${refusals.max} in one) | ≤ 1 on average |`,
    `| Workarounds in guarded runs | ${workarounds.total} in ${workarounds.runs} runs | 0 without a stated reason |`,
    `| Proof gaps in guarded runs | missed ${proofGaps.missed}, unguarded edits ${proofGaps.unguarded} | 0 |`,
    '',
    '## Spend (launcher runs, list-price estimate; on a subscription it is plan usage, not a bill)',
    '',
    `- ${cost.runs} runs, $${cost.total.toFixed(2)} total, ${cost.perRun === null ? 'n/a' : `$${cost.perRun.toFixed(2)}`} per run.`,
    '',
    '## Every session on this machine',
    '',
    `- ${sessions.count} sessions (${sessions.guarded} guarded): blocked ${sessions.blocked}, workarounds ${sessions.workarounds}; caught ${sessions.caught}, proven ${sessions.proven}, missed ${sessions.missed}, unverified ${sessions.unverified}; refactors ${sessions.refactors}.`,
    '',
    '## Our PRs on other repositories',
    '',
    `- ${prs.total} PRs: ${prs.merged} merged, ${prs.open} open, ${prs.closed} closed; ${prs.evidenced} of ${prs.total} carry evidence. Status as of ${prs.checkedAt ?? 'never refreshed'} (run tools/pool/prs.mjs to refresh).`,
    '',
    '## Sources',
    '',
    ...sources.files.map(file => `- ${file.path}: ${file.rows} ${file.rows === 1 ? 'record' : 'records'}${file.missing ? ' (not found)' : ''}`),
    `- A/B pairs used for overhead: ${overhead.pairIds.join(', ') || 'none'}`,
    `- Guarded runs with proof: ${goal.provedIds.join(', ') || 'none'}`,
    '',
  ].join('\n')
}

function readJsonLines(path) {
  return existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/).filter(line => line.trim() !== '').map(line => JSON.parse(line)) : null
}

/** The rows behind the page, as the published dashboard reads them: the same records, nothing added. */
export function exportRows({ ledger = [], sessions = [], prs = [] }) {
  return {
    runs: ledger.map(row => ({
      run: `${row.id}/${row.mode}`,
      id: row.id,
      repo: row.repo,
      mode: row.mode,
      at: row.at,
      costUsd: row.costUsd,
      turns: row.turns,
      minutes: typeof row.durationMs === 'number' ? Math.round((row.durationMs / 60000) * 100) / 100 : null,
      durationMs: row.durationMs,
      checkMs: row.checkMs ?? null,
      blocked: row.blocked,
      unguarded: row.unguarded,
      caught: row.caught,
      proven: row.proven,
      missed: row.missed,
      workarounds: row.workarounds,
    })),
    sessions: sessions.map(record => ({
      session: record.sessionId.slice(0, 8),
      endedAt: record.endedAt,
      repo: record.repo,
      mode: record.mode,
      blocked: record.blocked,
      workarounds: record.workarounds,
      caught: record.caught,
      proven: record.proven,
      missed: record.missed,
      unverified: record.unverified,
      refactors: record.refactors,
    })),
    prs: prs.map(pr => ({
      pr: `${pr.repo.split('/')[1]}#${pr.number}`,
      repo: pr.repo,
      number: pr.number,
      status: pr.status,
      verdict: pr.verdict,
      bug: pr.bug,
      url: pr.url ?? `https://github.com/${pr.repo}/pull/${pr.number}`,
      costUsd: pr.costUsd,
      checkedAt: pr.checkedAt ?? null,
    })),
  }
}

function main() {
  const base = join(homedir(), '.dope-tdd')
  const ledgerPath = join(base, 'pool', 'ledger.jsonl')
  const checksPath = join(base, 'pool', 'checks.jsonl')
  const prsPath = join(base, 'pool', 'prs.json')
  const sessionsDir = join(base, 'sessions')
  const ledger = readJsonLines(ledgerPath)
  const checks = readJsonLines(checksPath)
  const prs = existsSync(prsPath) ? JSON.parse(readFileSync(prsPath, 'utf8')) : null
  const sessions = existsSync(sessionsDir)
    ? readdirSync(sessionsDir).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(join(sessionsDir, name), 'utf8')))
    : null
  const card = computeScorecard({ ledger: ledger ?? [], sessions: sessions ?? [], prs: prs ?? [], checks: checks ?? [] })
  const text = renderScorecard(card, {
    at: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    files: [
      { path: ledgerPath, rows: ledger?.length ?? 0, missing: ledger === null },
      { path: `${sessionsDir}/*.json`, rows: sessions?.length ?? 0, missing: sessions === null },
      { path: prsPath, rows: prs?.length ?? 0, missing: prs === null },
      { path: checksPath, rows: checks?.length ?? 0, missing: checks === null },
    ],
  })
  writeFileSync(join(base, 'pool', 'scorecard.md'), text)
  console.log(text)
  const exportAt = process.argv.indexOf('--export')
  if (exportAt !== -1 && process.argv[exportAt + 1] !== undefined) {
    const dir = resolve(process.argv[exportAt + 1])
    const rows = exportRows({ ledger: ledger ?? [], sessions: sessions ?? [], prs: prs ?? [] })
    for (const [name, data] of Object.entries(rows)) {
      writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(data, null, 1)}\n`)
    }
    console.log(`\nexported runs, sessions and prs to ${dir}`)
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
