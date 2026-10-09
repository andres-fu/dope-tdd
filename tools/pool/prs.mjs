#!/usr/bin/env node
// The PRs we open on other people's repositories, and what each one changed:
// in their code (the bug, the receipt, the review) and in ours (the Dope TDD
// commits it led to). Kept in ~/.dope-tdd/pool/prs.json, outside every
// repository, because it names other people's code.
//
//   node tools/pool/prs.mjs                 refresh every PR's status from GitHub, print the report
//   node tools/pool/prs.mjs --offline       print the report without asking GitHub
//   node tools/pool/prs.mjs add --repo owner/name --number 31 --bug "..." \
//     [--found scout|ab|read] [--verdict caught|proven|refactor|none] [--cost 0.19] [--led-to "05d0ee8 ..."]...
//
// Writes ~/.dope-tdd/pool/prs.md beside the JSON.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const POOL = join(homedir(), '.dope-tdd', 'pool')
const FILE = join(POOL, 'prs.json')

function load() {
  return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : []
}

function save(prs) {
  mkdirSync(POOL, { recursive: true })
  writeFileSync(FILE, `${JSON.stringify(prs, null, 2)}\n`)
}

function add(argv) {
  const entry = { found: 'read', verdict: 'none', costUsd: null, ledTo: [], status: 'unknown' }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    const value = argv[++i]
    if (key === '--repo') entry.repo = value
    else if (key === '--number') entry.number = Number(value)
    else if (key === '--bug') entry.bug = value
    else if (key === '--found') entry.found = value
    else if (key === '--verdict') entry.verdict = value
    else if (key === '--cost') entry.costUsd = Number(value)
    else if (key === '--led-to') entry.ledTo.push(value)
    else throw new Error(`unknown argument ${key}`)
  }
  if (!entry.repo || !entry.number || !entry.bug) throw new Error('--repo, --number and --bug are required')
  const prs = load().filter(pr => !(pr.repo === entry.repo && pr.number === entry.number))
  prs.push(entry)
  save(prs)
  console.log(`recorded ${entry.repo}#${entry.number}`)
}

/** State, merge time and the people who said something, from gh. */
function refresh(pr) {
  try {
    const out = execFileSync('gh', ['pr', 'view', String(pr.number), '-R', pr.repo, '--json', 'state,mergedAt,url,title,reviews,comments'], { encoding: 'utf8' })
    const view = JSON.parse(out)
    const voices = [...view.reviews, ...view.comments].map(item => ({ who: item.author?.login ?? '?', state: item.state ?? 'COMMENTED', body: (item.body ?? '').slice(0, 200) }))
    return { ...pr, status: view.state.toLowerCase(), mergedAt: view.mergedAt || null, url: view.url, title: view.title, feedback: voices, checkedAt: new Date().toISOString() }
  } catch (error) {
    return { ...pr, refreshError: String(error.message ?? error).split('\n')[0] }
  }
}

function report(prs) {
  const merged = prs.filter(pr => pr.status === 'merged').length
  const open = prs.filter(pr => pr.status === 'open').length
  const closed = prs.filter(pr => pr.status === 'closed').length
  const evidenced = prs.filter(pr => ['caught', 'proven', 'refactor'].includes(pr.verdict)).length
  const cost = prs.reduce((sum, pr) => sum + (pr.costUsd ?? 0), 0)
  const priced = prs.filter(pr => pr.costUsd !== null).length
  const modChanges = prs.reduce((sum, pr) => sum + pr.ledTo.length, 0)
  const lines = [
    '# Our PRs on real repositories',
    '',
    `${prs.length} PRs: ${merged} merged, ${open} open, ${closed} closed. ${evidenced} of ${prs.length} carry a receipt with evidence (caught, proven or a named refactor).`,
    `${modChanges} changes to Dope TDD came out of them. Agent cost on record: $${cost.toFixed(2)} at list price across ${priced} of ${prs.length} PRs.`,
    '',
    '| PR | status | the bug | found by | receipt | cost | led to in Dope TDD |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...prs.map(pr => {
      const voices = (pr.feedback ?? []).filter(voice => voice.body !== '' || voice.state !== 'COMMENTED')
      const status = `${pr.status}${voices.length > 0 ? ` (${voices.length} review note${voices.length === 1 ? '' : 's'})` : ''}`
      return `| [${pr.repo.split('/')[1]}#${pr.number}](${pr.url ?? `https://github.com/${pr.repo}/pull/${pr.number}`}) | ${status} | ${pr.bug} | ${pr.found} | ${pr.verdict} | ${pr.costUsd === null ? '' : `$${pr.costUsd.toFixed(2)}`} | ${pr.ledTo.join('; ')} |`
    }),
  ]
  const feedback = prs.flatMap(pr => (pr.feedback ?? []).filter(voice => voice.body !== '').map(voice => `- ${pr.repo.split('/')[1]}#${pr.number}, ${voice.who} (${voice.state.toLowerCase()}): ${voice.body.replace(/\s+/g, ' ')}`))
  if (feedback.length > 0) lines.push('', '## What the maintainers said', '', ...feedback)
  return lines.join('\n')
}

function main() {
  const [command, ...rest] = process.argv.slice(2)
  if (command === 'add') return add(rest)
  let prs = load()
  if (command !== '--offline') {
    prs = prs.map(refresh)
    save(prs)
  }
  const text = report(prs)
  writeFileSync(join(POOL, 'prs.md'), `${text}\n`)
  console.log(text)
  for (const pr of prs.filter(pr => pr.refreshError)) console.log(`\ncould not refresh ${pr.repo}#${pr.number}: ${pr.refreshError}`)
}

main()
