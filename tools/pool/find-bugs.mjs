#!/usr/bin/env node
// Find open-source bugs worth fixing, the fast way: filter in bulk, verify
// only a short list. One GitHub search per language and label, then one
// batched lookup of every repository (stars, age, license, community, topics
// and its contribution guide), then the rules below, then a ranked shortlist.
// Nothing here is verified against code: the shortlist is leads, marked so.
//
//   node tools/pool/find-bugs.mjs [--langs typescript,javascript,python] [--min-stars 500]
//                                 [--since 2026-07-01] [--top 15]
//
// Writes ~/.dope-tdd/pool/candidates/<date>-search.md (every kept and dropped
// lead with its reasons) and appends the shortlist to ~/.dope-tdd/pool/candidates.jsonl.
//
// The rules, from the owner: corroborated bugs; nothing dangerous; good
// projects run by real people; honor each project's AI policy; on the record.

import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AI_WORDS = /\b(?:AI|A\.I\.|LLMs?|large language models?|Copilot|ChatGPT|Claude|generative|machine[- ]generated|AI[- ]generated|AI[- ]assisted)\b/
const AI_BAN = new RegExp(
  String.raw`(?:do not|don't|not (?:be )?accept(?:ed)?|no longer accept|will not accept|won't accept|prohibit(?:ed)?|forbid(?:den)?|banned?|reject(?:ed)?|not allowed|not permitted)[^.\n]{0,100}` +
    String.raw`(?:\bAI\b|LLM|generated|Copilot|ChatGPT)|(?:\bAI\b|LLM|generated|Copilot|ChatGPT)[^.\n]{0,100}(?:not (?:be )?accept(?:ed)?|prohibited|forbidden|banned|rejected|not allowed|not permitted)`,
  'i',
)
const HARMFUL = /\b(?:malware|exploit|cheat|aimbot|wallhack|crack(?:er|ing)?|keylog|spyware|stalker|ransom|botnet|ddos|phish|carding|gambl|casino|bypass(?:es)? (?:anti|captcha|paywall)|account generator)\b/i
const SECURITY_LABEL = /secur|vulnerab|\bcve\b/i
const REPRO = /steps to reproduce|to reproduce|expected (?:behaviou?r|result|output)|actual (?:behaviou?r|result|output)|```/i
const UI_ONLY = /\b(?:css|layout|styl(?:e|ing)|color|colour|font|icon|animation|responsive|dark mode|tooltip|modal|scroll(?:bar)?|pixel|alignment|ui)\b/i
const MAINTAINER = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
// "Add new Example Sentence 973", "[docs] …": content to add or docs to write, not a bug.
const CONTENT_TASK = /\badd new\b|^\s*\[docs?\]|\bdocs?:/i
// "[FEATURE] …", "Feature request: …", "bump to python 3.14": new work or upkeep, not a defect.
const FEATURE_OR_CHORE = /^\s*\[feat(?:ure)?\]|\bfeature request\b|^\s*(?:bump|chore\b|upgrade to\b)/i
// "assign it to me", "I'd like to work on this", "can I take this?", "I'm working on a fix": someone else's turn.
const CLAIM = /\bassign (?:it|this|the issue)? ?to me\b|\b(?:i'?d|i would|i'?ll|i will|i want to|i'?m going to) (?:like to |love to )?(?:work on|take|fix|pick up|handle)\b|\bcan i (?:work on|take|pick up|fix|handle)\b|\bi'?m (?:currently )?(?:working on|on it|looking into)\b/i
const UNCLAIM = /\bno longer\b|\bfree to take\b|\bunassign\b|\bcan'?t (?:work on|continue|finish)\b|\bgo ahead\b|\bnot (?:going to|working on)\b/i
/** A claim older than this is stale: the issue is open to others again. */
const CLAIM_DAYS = 60
/** No one repository fills the shortlist: at most this many issues from each. */
const PER_REPO = 2

const STOPWORDS = new Set(['a', 'an', 'the', 'to', 'of', 'is', 'are', 'in', 'on', 'for', 'with', 'and', 'or', 'when', 'be', 'by'])

/** A Stack Overflow search for this bug: the project's name, then up to eight words of the problem. */
export function soQuery(issue) {
  const words = issue.title
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/(^|\s)@[\w.-]+\/[\w.-]+:/g, ' ')
    .replace(/\(([^)]+)\)/g, ' $1 ')
    .split(/\s+/)
    .filter(word => word !== '' && !STOPWORDS.has(word.toLowerCase()))
  return [issue.repository.name, ...words.slice(0, 8)].join(' ')
}

/** Questions on Stack Overflow that match: a lead to read, never proof on its own. Null when the API cannot be reached. */
async function stackOverflowHits(query) {
  const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&site=stackoverflow&pagesize=3&q=${encodeURIComponent(query)}`
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const body = await response.json()
    return { total: body.items?.length ?? 0, top: (body.items ?? []).slice(0, 2).map(item => ({ title: item.title, link: item.link })) }
  } catch {
    return null
  }
}

/** The latest recent comment that claims the issue and its author has not taken back, or null. */
export function claimOf(comments, nowMs) {
  let claim = null
  for (const comment of comments) {
    const by = comment.author?.login ?? 'ghost'
    if (claim !== null && claim.by === by && UNCLAIM.test(comment.body)) claim = null
    else if (CLAIM.test(comment.body) && nowMs - Date.parse(comment.createdAt) < CLAIM_DAYS * 86_400_000) {
      claim = { by, at: comment.createdAt.slice(0, 10), quote: comment.body.trim().split(/\n/)[0].slice(0, 160) }
    }
  }
  return claim
}

/** The best-scored issues in order, at most PER_REPO from any one repository. */
export function shortlistOf(ranked, top) {
  const taken = new Map()
  const picked = []
  for (const entry of ranked) {
    const repo = entry.issue.repository.nameWithOwner
    if ((taken.get(repo) ?? 0) >= PER_REPO) continue
    taken.set(repo, (taken.get(repo) ?? 0) + 1)
    picked.push(entry)
    if (picked.length === top) break
  }
  return picked
}

/** What a project's contribution guide says about AI-written work: none found, it restricts it, or it mentions it (read it). */
export function classifyAiPolicy(texts) {
  const joined = texts.filter(Boolean).join('\n')
  if (!AI_WORDS.test(joined)) return { policy: 'none found', quote: null }
  const ban = AI_BAN.exec(joined)
  if (ban) return { policy: 'restricts', quote: ban[0].slice(0, 160) }
  const mention = joined.split(/\n/).find(line => AI_WORDS.test(line)) ?? ''
  return { policy: 'mentions', quote: mention.trim().slice(0, 160) }
}

/** Whether a repository is one we help: why not, or null when it is. */
export function repoProblem(repo, { minStars, nowMs }) {
  if (repo === null) return 'repository not found'
  if (repo.isArchived) return 'archived'
  if (repo.isFork) return 'a fork'
  if (repo.stargazerCount < minStars) return `${repo.stargazerCount} stars, under ${minStars}`
  if (!repo.licenseInfo) return 'no license'
  if (nowMs - Date.parse(repo.createdAt) < 365 * 86_400_000) return 'under a year old'
  if ((repo.mentionableUsers?.totalCount ?? 0) < 5) return 'fewer than 5 people around it'
  const topics = (repo.repositoryTopics?.nodes ?? []).map(node => node.topic.name).join(' ')
  if (HARMFUL.test(`${repo.nameWithOwner} ${repo.description ?? ''} ${topics}`)) return 'its purpose looks harmful'
  return null
}

/** Corroboration and fit, as points with their reasons; a security issue is dropped outright. */
export function scoreIssue(issue) {
  const labels = (issue.labels ?? []).map(label => label.name)
  if (labels.some(name => SECURITY_LABEL.test(name))) return { drop: 'security issue', score: 0, reasons: [] }
  // A task to add content or write docs is not a bug to fix, however welcome it is.
  if (CONTENT_TASK.test(issue.title) || labels.some(name => /^(?:docs?|documentation)$/i.test(name))) {
    return { drop: 'not a bug: a content or docs task', score: 0, reasons: [] }
  }
  if (FEATURE_OR_CHORE.test(issue.title) || labels.some(name => /^(?:enhancement|feature(?: request)?|chore|dependencies)$/i.test(name))) {
    return { drop: 'not a bug: a feature request or chore', score: 0, reasons: [] }
  }
  const reasons = []
  let score = 0
  const add = (points, why) => {
    score += points
    reasons.push(`${points > 0 ? '+' : ''}${points} ${why}`)
  }
  if (MAINTAINER.has(issue.authorAssociation)) add(3, 'filed by a maintainer')
  if (labels.some(name => /confirm|accepted|triaged|good first issue|help wanted/i.test(name))) add(2, 'confirmed or welcomed by label')
  if (REPRO.test(issue.body ?? '')) add(2, 'has a reproduction')
  if (issue.commentsCount >= 1 && issue.commentsCount <= 10) add(1, 'others engaged')
  if (UI_ONLY.test(issue.title)) add(-2, 'looks visual, hard to unit test')
  return { drop: null, score, reasons }
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function search(lang, label, since) {
  const fields = 'repository,title,url,number,body,labels,authorAssociation,commentsCount,updatedAt'
  const out = gh(['search', 'issues', '--label', label, '--language', lang, '--state', 'open', '--no-assignee', '--comments', '<15', '--updated', `>=${since}`, '--limit', '100', '--json', fields, '--', '-linked:pr'])
  return JSON.parse(out).map(issue => ({ ...issue, lang }))
}

const GUIDES = ['CONTRIBUTING.md', '.github/CONTRIBUTING.md', 'docs/CONTRIBUTING.md', 'AI_POLICY.md', '.github/AI_POLICY.md']

function lookupRepos(names) {
  const repos = {}
  for (let at = 0; at < names.length; at += 40) {
    const batch = names.slice(at, at + 40)
    const parts = batch.map((full, i) => {
      const [owner, name] = full.split('/')
      const guides = GUIDES.map((path, g) => `g${g}: object(expression: ${JSON.stringify(`HEAD:${path}`)}) { ... on Blob { text } }`).join(' ')
      return `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { nameWithOwner stargazerCount isArchived isFork createdAt pushedAt description licenseInfo { spdxId } mentionableUsers { totalCount } repositoryTopics(first: 10) { nodes { topic { name } } } ${guides} }`
    })
    let data = {}
    try {
      data = JSON.parse(gh(['api', 'graphql', '-f', `query={ ${parts.join(' ')} }`])).data ?? {}
    } catch (error) {
      // A repository that cannot be read (renamed, private) fails the whole batch; read that batch one by one.
      for (const [i, full] of batch.entries()) {
        try {
          data[`r${i}`] = JSON.parse(gh(['api', 'graphql', '-f', `query={ r0: ${parts[i].slice(parts[i].indexOf(':') + 1)} }`])).data?.r0 ?? null
        } catch {
          data[`r${i}`] = null
        }
      }
    }
    batch.forEach((full, i) => {
      repos[full] = data[`r${i}`] ?? null
    })
  }
  return repos
}

/** The last 30 comments of each issue, oldest first, in batches of 40 issues. */
function lookupComments(issues) {
  const comments = new Map()
  for (let at = 0; at < issues.length; at += 40) {
    const batch = issues.slice(at, at + 40)
    const parts = batch.map((issue, i) => {
      const [owner, name] = issue.repository.nameWithOwner.split('/')
      return `i${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { issue(number: ${issue.number}) { comments(last: 30) { nodes { author { login } createdAt body } } } }`
    })
    let data = {}
    try {
      data = JSON.parse(gh(['api', 'graphql', '-f', `query={ ${parts.join(' ')} }`])).data ?? {}
    } catch {
      // Unreadable: the issue stays in, unchecked for claims, rather than the search failing.
    }
    batch.forEach((issue, i) => comments.set(issue.url, data[`i${i}`]?.issue?.comments?.nodes ?? []))
  }
  return comments
}

function parseArgs(argv) {
  const args = { langs: ['typescript', 'javascript', 'python'], minStars: 500, since: new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10), top: 15 }
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1]
    if (argv[i] === '--langs') args.langs = value.split(',')
    else if (argv[i] === '--min-stars') args.minStars = Number(value)
    else if (argv[i] === '--since') args.since = value
    else if (argv[i] === '--top') args.top = Number(value)
    else continue
    i++
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const started = Date.now()
  const seen = new Map()
  for (const lang of args.langs) {
    for (const label of ['bug', 'good first issue']) {
      for (const issue of search(lang, label, args.since)) seen.set(issue.url, issue)
    }
  }
  const issues = [...seen.values()]
  const repos = lookupRepos([...new Set(issues.map(issue => issue.repository.nameWithOwner))])
  const kept = []
  const dropped = []
  for (const issue of issues) {
    const name = issue.repository.nameWithOwner
    const repo = repos[name]
    const problem = repoProblem(repo, { minStars: args.minStars, nowMs: started })
    if (problem) {
      dropped.push({ issue, why: problem })
      continue
    }
    const ai = classifyAiPolicy(GUIDES.map((_, g) => repo[`g${g}`]?.text))
    if (ai.policy === 'restricts') {
      dropped.push({ issue, why: `AI policy restricts it: "${ai.quote}"` })
      continue
    }
    const scored = scoreIssue(issue)
    if (scored.drop) {
      dropped.push({ issue, why: scored.drop })
      continue
    }
    kept.push({ issue, repo, ai, ...scored })
  }
  // Someone asked to take it: their turn, not ours (dapr-agents #885 was claimed 4 hours before our comment).
  const comments = lookupComments(kept.map(entry => entry.issue))
  for (const entry of [...kept]) {
    const claim = claimOf(comments.get(entry.issue.url), started)
    if (claim === null) continue
    kept.splice(kept.indexOf(entry), 1)
    dropped.push({ issue: entry.issue, why: 'claimed in a comment', claim })
  }
  kept.sort((a, b) => b.score - a.score || b.repo.stargazerCount - a.repo.stargazerCount)
  const shortlist = shortlistOf(kept, args.top)
  // Corroboration from outside the issue tracker: the same problem asked about on Stack Overflow.
  for (const entry of shortlist) {
    entry.so = await stackOverflowHits(soQuery(entry.issue))
    if (entry.so !== null && entry.so.total > 0) {
      entry.score += 1
      entry.reasons.push('+1 asked about on Stack Overflow')
    }
  }

  const day = new Date(started).toISOString().slice(0, 10)
  const dir = join(homedir(), '.dope-tdd', 'pool', 'candidates')
  mkdirSync(dir, { recursive: true })
  const line = entry => `| ${entry.score} | [${entry.issue.repository.nameWithOwner}#${entry.issue.number}](${entry.issue.url}) | ${entry.repo.stargazerCount} | ${entry.issue.lang} | ${entry.issue.title.replace(/\|/g, '/').slice(0, 90)} | ${entry.reasons.join('; ')} | ${entry.ai.policy}${entry.ai.quote ? `: "${entry.ai.quote.replace(/\|/g, '/')}"` : ''} | ${entry.so === null || entry.so === undefined ? 'not checked' : entry.so.total === 0 ? 'none' : entry.so.top.map(hit => `[${hit.title.replace(/[|\]\[]/g, '/').slice(0, 60)}](${hit.link})`).join('<br>')} |`
  const report = [
    `# Bug search ${day}`,
    '',
    `Searched ${args.langs.join(', ')}, labels bug and good first issue, open, unassigned, unclaimed in comments, no linked PR, under 15 comments, updated since ${args.since}. ${issues.length} issues in ${new Set(issues.map(issue => issue.repository.nameWithOwner)).size} repositories; ${kept.length} kept, ${dropped.length} dropped; ${((Date.now() - started) / 1000).toFixed(1)} s.`,
    '',
    'Nothing below is verified against code yet: these are leads. Next: read the code for the shortlist, in parallel.',
    '',
    `## Shortlist (top ${shortlist.length})`,
    '',
    '| Score | Issue | Stars | Language | Title | Why | AI policy | Stack Overflow |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...shortlist.map(line),
    '',
    '## Kept but not shortlisted',
    '',
    ...kept.filter(entry => !shortlist.includes(entry)).map(entry => `- ${entry.score} · [${entry.issue.repository.nameWithOwner}#${entry.issue.number}](${entry.issue.url}) ${entry.issue.title.slice(0, 90)}`),
    '',
    '## Dropped, with the reason',
    '',
    ...Object.entries(dropped.reduce((groups, entry) => ((groups[entry.why.startsWith('AI policy') ? 'AI policy restricts it' : entry.why] ??= []).push(entry), groups), {}))
      .sort((a, b) => b[1].length - a[1].length)
      .map(([why, entries]) => `- ${why}: ${entries.length} (${[...new Set(entries.map(entry => entry.issue.repository.nameWithOwner))].slice(0, 6).join(', ')}${entries.length > 6 ? ', …' : ''})`),
    '',
  ].join('\n')
  const reportPath = join(dir, `${day}-search.md`)
  writeFileSync(reportPath, report)
  for (const entry of shortlist) {
    appendFileSync(
      join(homedir(), '.dope-tdd', 'pool', 'candidates.jsonl'),
      `${JSON.stringify({ at: new Date(started).toISOString(), repo: entry.issue.repository.nameWithOwner, issue: entry.issue.number, url: entry.issue.url, bug: entry.issue.title, lang: entry.issue.lang, found: 'search', verified: false, status: 'found', score: entry.score, reasons: entry.reasons, aiPolicy: entry.ai.policy, stars: entry.repo.stargazerCount, stackOverflow: entry.so ?? null })}\n`,
    )
  }
  console.log(report.split('## Kept but not shortlisted')[0])
  console.log(`report: ${reportPath}`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(String(error?.stack ?? error))
    process.exit(1)
  })
}
