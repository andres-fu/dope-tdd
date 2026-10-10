// node --test tools/pool/find-bugs.test.mjs
// The rules that pick which open-source bugs we touch.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { claimOf, classifyAiPolicy, repoProblem, scoreIssue, shortlistOf, soQuery } from './find-bugs.mjs'

const NOW = Date.parse('2026-10-09T00:00:00Z')
const good = {
  nameWithOwner: 'acme/parser',
  stargazerCount: 2400,
  isArchived: false,
  isFork: false,
  createdAt: '2021-01-01T00:00:00Z',
  description: 'A fast date parser',
  licenseInfo: { spdxId: 'MIT' },
  mentionableUsers: { totalCount: 40 },
  repositoryTopics: { nodes: [{ topic: { name: 'dates' } }] },
}

test('an AI policy that forbids generated work is read as restricting it, either word order', () => {
  assert.equal(classifyAiPolicy(['We do not accept AI-generated pull requests.']).policy, 'restricts')
  assert.equal(classifyAiPolicy(['Contributions written by an LLM will be rejected.']).policy, 'restricts')
  assert.equal(classifyAiPolicy(['Please disclose if you used AI tools.']).policy, 'mentions')
  assert.equal(classifyAiPolicy(['Run the tests before opening a PR.', undefined]).policy, 'none found')
})

test('a good project passes; small, young, lonely, unlicensed, archived or harmful ones do not', () => {
  const opts = { minStars: 500, nowMs: NOW }
  assert.equal(repoProblem(good, opts), null)
  assert.match(repoProblem({ ...good, stargazerCount: 40 }, opts), /stars/)
  assert.equal(repoProblem({ ...good, createdAt: '2026-06-01T00:00:00Z' }, opts), 'under a year old')
  assert.equal(repoProblem({ ...good, mentionableUsers: { totalCount: 2 } }, opts), 'fewer than 5 people around it')
  assert.equal(repoProblem({ ...good, licenseInfo: null }, opts), 'no license')
  assert.equal(repoProblem({ ...good, isArchived: true }, opts), 'archived')
  assert.equal(repoProblem({ ...good, description: 'An aimbot for shooters' }, opts), 'its purpose looks harmful')
  assert.equal(repoProblem(null, opts), 'repository not found')
})

test('corroboration earns points with reasons; a security issue is dropped; a visual one is marked down', () => {
  const issue = { title: 'parseDate returns NaN for ISO weeks', body: 'Steps to reproduce:\n```js\nparseDate("2026-W01")\n```', labels: [{ name: 'bug' }, { name: 'confirmed' }], authorAssociation: 'MEMBER', commentsCount: 3 }
  const scored = scoreIssue(issue)
  assert.equal(scored.score, 8)
  assert.deepEqual(scored.reasons, ['+3 filed by a maintainer', '+2 confirmed or welcomed by label', '+2 has a reproduction', '+1 others engaged'])
  assert.equal(scoreIssue({ ...issue, labels: [{ name: 'security' }] }).drop, 'security issue')
  assert.equal(scoreIssue({ title: 'Tooltip color is wrong in dark mode', body: '', labels: [], authorAssociation: 'NONE', commentsCount: 0 }).score, -2)
})

test('content and docs tasks are not bugs: an "Add new …" task or a docs label is dropped', () => {
  const base = { body: 'Steps to reproduce: x', labels: [{ name: 'good first issue' }], authorAssociation: 'MEMBER', commentsCount: 2 }
  assert.equal(scoreIssue({ ...base, title: '[good first issue, hacktoberfest] 🧧 Add new Example Sentence 973 (good-first-issue)' }).drop, 'not a bug: a content or docs task')
  assert.equal(scoreIssue({ ...base, title: '[docs] Add a runnable offline quick-start example' }).drop, 'not a bug: a content or docs task')
  assert.equal(scoreIssue({ ...base, title: 'Improve the guide', labels: [{ name: 'documentation' }] }).drop, 'not a bug: a content or docs task')
  assert.equal(scoreIssue({ ...base, title: 'Windows path checks are case-sensitive' }).drop, null)
})

test('the shortlist takes at most two issues from one repository', () => {
  const entry = (repo, n, score) => ({ issue: { repository: { nameWithOwner: repo }, number: n }, score })
  const picked = shortlistOf([entry('a/a', 1, 8), entry('a/a', 2, 8), entry('a/a', 3, 8), entry('b/b', 4, 7), entry('c/c', 5, 6)], 4)
  assert.deepEqual(picked.map(e => e.issue.number), [1, 2, 4, 5])
})

test('feature requests and chores are not bugs either', () => {
  const base = { body: '', labels: [{ name: 'good first issue' }], authorAssociation: 'MEMBER', commentsCount: 2 }
  assert.equal(scoreIssue({ ...base, title: '[FEATURE] Add Together AI to provider routing' }).drop, 'not a bug: a feature request or chore')
  assert.equal(scoreIssue({ ...base, title: 'bump to python 3.14' }).drop, 'not a bug: a feature request or chore')
  assert.equal(scoreIssue({ ...base, title: 'Something', labels: [{ name: 'enhancement' }] }).drop, 'not a bug: a feature request or chore')
  assert.equal(scoreIssue({ ...base, title: 'toast.loading() ignores the dismissable prop' }).drop, null)
})

test('the Stack Overflow query names the project and the problem, without bracket tags or noise', () => {
  assert.equal(soQuery({ repository: { name: 'medusa' }, title: '@medusajs/ui: toast.loading() ignores the dismissable prop (hardcoded to false)' }), 'medusa toast.loading() ignores dismissable prop hardcoded false')
  assert.equal(soQuery({ repository: { name: 'jodit' }, title: "[Bug] Paste after a space deletes the space if it's after a tag" }), "jodit Paste after space deletes space if it's after")
})

test('an issue someone asked to take, recently and not withdrawn, is claimed (dapr-agents #885)', () => {
  const say = (login, createdAt, body) => ({ author: { login }, createdAt, body })
  const asked = say('casper', '2026-10-08T10:00:00Z', 'Hi, can you assign it to me? I would like to fix this.')
  assert.deepEqual(claimOf([say('bot', '2026-10-01T00:00:00Z', 'Thanks for the report'), asked], NOW), { by: 'casper', at: '2026-10-08', quote: 'Hi, can you assign it to me? I would like to fix this.' })
  assert.equal(claimOf([say('ana', '2026-10-02T00:00:00Z', "I'd like to work on this")], NOW).by, 'ana')
  assert.equal(claimOf([say('ana', '2026-10-02T00:00:00Z', "I'm working on a fix, PR soon")], NOW).by, 'ana')
  assert.equal(claimOf([say('ana', '2026-10-02T00:00:00Z', 'Can I take this one?')], NOW).by, 'ana')
  // Old claims go stale; a claim taken back frees the issue; talk about the bug is not a claim.
  assert.equal(claimOf([say('ana', '2026-05-01T00:00:00Z', 'Assign it to me please')], NOW), null)
  assert.equal(claimOf([asked, say('casper', '2026-10-08T12:00:00Z', "Sorry, I no longer have time, it's free to take")], NOW), null)
  assert.equal(claimOf([say('ana', '2026-10-02T00:00:00Z', 'I see this too on Windows. Any workaround?')], NOW), null)
  assert.equal(claimOf([], NOW), null)
})
