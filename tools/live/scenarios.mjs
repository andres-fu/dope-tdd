// The live suite's scenarios: what a real headless Claude Code session is asked to do in a probe repo, and what
// dope-tdd must then have done. Each was first seen by hand on 2026-10-29; D is the tester's worktree subagent
// finding, which went through on 0.2.11 and is refused from 0.2.12 (#233).
//
// A run's folders (tools/live/probe.mjs): `<root>/probe` is the guarded probe repo whose src/calc.js is edited,
// `<root>/home` a second guarded repo (A's session runs there), `<root>/linked` a `git worktree add` of the probe.
// `ctx` holds them and the build expected: { mode: 'branch' | 'installed', checkout, checkoutSha, root, probe,
// calcBefore, calcAfter }, where calcBefore and calcAfter are the probe's src/calc.js before and after the run.
import { buildOf, check, dopePlugin, isRefusal, isUnder, samePath, tddReport } from './checks.mjs'

const CHANGE = 'use the Edit tool once to change "return a + b" to "return a + b + 0"'
const subagentPrompt = `Use the Agent tool once, with isolation set to "worktree", and give the subagent this task: Read src/calc.js in your worktree, then ${CHANGE}. Do not touch any test. Report the Edit tool result word for word. Then reply with the subagent's report and stop.`
const fwd = path => path.replace(/\\/g, '/')

export const dirOf = (ctx, where) => (where === 'probe' ? ctx.probe : `${ctx.root}/${where}`)

/** A relative path from the stream, taken against the folder the session started in. */
function absolute(path, cwd) {
  return /^([a-z]:)?[\\/]/i.test(path) ? path : `${cwd}/${path}`
}

function edits(run, { subagent }) {
  const cwd = run.inits[0]?.cwd ?? ''
  return run.calls
    .filter(call => call.name === 'Edit' && (call.parent !== null) === subagent && typeof call.input?.file_path === 'string')
    .map(call => ({ ...call, path: absolute(call.input.file_path, cwd) }))
}

/** The build that ran is the one asked for: the checkout by --plugin-dir in branch mode, else the installed copy. */
function buildChecks(run, ctx) {
  const plugin = dopePlugin(run)
  if (ctx.mode === 'branch') {
    const checks = [check('dope-tdd loaded from the checkout', plugin !== null && samePath(plugin.path, ctx.checkout), plugin === null ? 'not loaded' : `loaded from ${plugin.path}`)]
    const build = buildOf(tddReport(run))
    if (build !== null) {
      checks.push(check(`/tdd names the checkout's commit ${ctx.checkoutSha.slice(0, 7)}`, build.sha !== null && ctx.checkoutSha.startsWith(build.sha), `it names ${build.sha}`))
    }
    return checks
  }
  return [check('dope-tdd loaded from the installed copy', plugin !== null && !plugin.source.endsWith('@inline'), plugin === null ? 'not loaded' : `${plugin.source} at ${plugin.path}`)]
}

function sessionCheck(run, ctx, where) {
  const cwd = run.inits[0]?.cwd
  return check(`the session ran in ${where}`, cwd !== undefined && samePath(cwd, dirOf(ctx, where)), `it ran in ${cwd}`)
}

function refusalChecks(edit) {
  return [
    check('dope-tdd refused it', isRefusal(edit?.result), edit?.result === null || edit === undefined ? 'no result' : edit.result.text.split('\n')[0]),
    check('the refusal names tests/calc.test.js', edit?.result?.text.includes('tests/calc.test.js')),
  ]
}

function wentThroughChecks(edit, ctx) {
  return [
    check('the edit went through', edit?.result != null && !edit.result.error, edit?.result?.text.split('\n')[0] ?? 'no result'),
    check('src/calc.js changed on disk', ctx.calcAfter !== ctx.calcBefore),
  ]
}

function subagentChecks(run, ctx) {
  const agent = run.calls.find(call => call.name === 'Agent' && call.parent === null)
  const edit = edits(run, { subagent: true }).find(e => /[\\/]src[\\/]calc\.js$/.test(e.path))
  const worktrees = `${ctx.probe}/.claude/worktrees`
  return [
    ...buildChecks(run, ctx),
    check('the model started an Agent with isolation "worktree"', agent?.input?.isolation === 'worktree', agent === undefined ? 'no Agent call' : JSON.stringify(agent.input?.isolation)),
    check('the subagent called Edit on src/calc.js', edit !== undefined, 'no subagent Edit of src/calc.js'),
    check(
      "its worktree is under the main checkout's .claude/worktrees/agent-…",
      edit !== undefined && isUnder(edit.path, worktrees) && /\/\.claude\/worktrees\/agent-[^/]+\//.test(fwd(edit.path)),
      edit?.path ?? '',
    ),
    ...refusalChecks(edit),
    check("the main checkout's src/calc.js is unchanged", ctx.calcAfter === ctx.calcBefore),
  ]
}

export const scenarios = [
  {
    id: 'A',
    title: 'an edit outside the project goes through, and /tdd says it was outside',
    cwd: 'home',
    plugin: 'on',
    messages: ctx => [`Read ${fwd(ctx.probe)}/src/calc.js, then ${CHANGE} in that file. Then quote the tool result word for word and stop.`, '/tdd'],
    check(run, ctx) {
      const target = `${ctx.probe}/src/calc.js`
      const edit = edits(run, { subagent: false }).find(e => samePath(e.path, target))
      const report = tddReport(run) ?? ''
      return [
        ...buildChecks(run, ctx),
        sessionCheck(run, ctx, 'home'),
        check("the model called Edit on the probe's src/calc.js by absolute path", edit !== undefined, 'no such Edit'),
        ...wentThroughChecks(edit, ctx),
        check('/tdd lists it as outside this project, not guarded', report.includes('outside this project, not guarded'), report === '' ? 'no /tdd output' : 'not in its recent events'),
      ]
    },
  },
  {
    id: 'B',
    title: 'an untested edit is refused, naming its test',
    cwd: 'probe',
    plugin: 'on',
    messages: () => [`Read src/calc.js, then ${CHANGE}. Do not touch any test. Then quote the tool result word for word and stop.`, '/tdd'],
    check(run, ctx) {
      const edit = edits(run, { subagent: false }).find(e => samePath(e.path, `${ctx.probe}/src/calc.js`))
      const report = tddReport(run) ?? ''
      return [
        ...buildChecks(run, ctx),
        sessionCheck(run, ctx, 'probe'),
        check('the model called Edit on src/calc.js', edit !== undefined, 'no such Edit'),
        ...refusalChecks(edit),
        check('src/calc.js is unchanged on disk', ctx.calcAfter === ctx.calcBefore),
        check('/tdd lists the block', report.includes('blocked calc'), report === '' ? 'no /tdd output' : 'not in its recent events'),
      ]
    },
  },
  {
    id: 'C',
    title: "a worktree subagent's untested edit is refused",
    cwd: 'probe',
    plugin: 'on',
    messages: () => [subagentPrompt],
    check: (run, ctx) => [sessionCheck(run, ctx, 'probe'), ...subagentChecks(run, ctx)],
  },
  {
    id: 'D',
    title: "from a linked worktree, a worktree subagent's untested edit is refused (went through on 0.2.11)",
    cwd: 'linked',
    plugin: 'on',
    messages: () => [subagentPrompt],
    check: (run, ctx) => [sessionCheck(run, ctx, 'linked'), ...subagentChecks(run, ctx)],
  },
  {
    id: 'E',
    title: 'with the plugin off, the edit goes through and /tdd is absent',
    cwd: 'probe',
    plugin: 'off',
    messages: () => [`Read src/calc.js, then ${CHANGE}. Do not touch any test. Then quote the tool result word for word and stop.`, '/tdd'],
    check(run, ctx) {
      const edit = edits(run, { subagent: false }).find(e => samePath(e.path, `${ctx.probe}/src/calc.js`))
      const plugin = dopePlugin(run)
      return [
        check('dope-tdd is not loaded', plugin === null, plugin === null ? '' : `${plugin.source} at ${plugin.path}`),
        check('/tdd is not a command', !(run.inits[0]?.commands ?? []).includes('tdd')),
        sessionCheck(run, ctx, 'probe'),
        check('the model called Edit on src/calc.js', edit !== undefined, 'no such Edit'),
        ...wentThroughChecks(edit, ctx),
        check('/tdd printed nothing', tddReport(run) === null),
      ]
    },
  },
]
