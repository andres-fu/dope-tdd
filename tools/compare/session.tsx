// One session of `npm run compare -- --sessions`, played on a build of dope-tdd through the fake engine: a project, then
// two things that happen in it, with what the session shows after each. compare.ts copies this file beside
// tests/engine.tsx in a throwaway copy of each build, so it never runs here. The same sessions on both builds say what a
// change changed, including in sessions that change part-way, which no reader of a diff can walk through thousands of times.
import { BAND, ROOT, editAt, fakeEngine, test } from './engine'
import { CONFIGS, FILES, MARKERS } from './plan'
import type { Plan } from './plan'

const config = (world: any, text: string) => world.fileContents.set(`${ROOT}/dope-tdd.json`, text)
const tdd = (args: string) => async (_world: any, $: any) => {
  await $.command.run({ command: 'tdd', args })
}
const EVENTS: Record<string, (world: any, $: any) => unknown> = {
  cfgWarn: world => config(world, '{"mode":"warn"}'),
  cfgBroken: world => config(world, 'not json {'),
  cfgBadMode: world => config(world, '{"mode":"loud"}'),
  cfgPy: world => config(world, '{"stack":"python"}'),
  cfgEmpty: world => config(world, '{}'),
  cfgDelete: world => world.fileContents.delete(`${ROOT}/dope-tdd.json`),
  markerPkg: world => world.existingFiles.add(`${ROOT}/package.json`),
  markerPy: world => world.existingFiles.add(`${ROOT}/pyproject.toml`),
  markerGone: world => {
    world.existingFiles.delete(`${ROOT}/package.json`)
    world.existingFiles.delete(`${ROOT}/pyproject.toml`)
  },
  addSrc: world => world.fileContents.set(`${ROOT}/src/x.ts`, 'x'),
  rmSrc: world => {
    world.fileContents.delete(`${ROOT}/src/a.ts`)
    world.fileContents.delete(`${ROOT}/src/x.ts`)
  },
  addPy: world => world.fileContents.set(`${ROOT}/lib/new.py`, 'x'),
  setup: tdd('setup'),
  setupWrite: tdd('setup write'),
}

async function band($: any): Promise<string> {
  const ui = await $.ui.mount({ plugin: 'dope-tdd', surface: 'terminal', ...BAND })
  const drawn = JSON.stringify(await ui.drawn())
  await ui.unmount()
  return drawn
}

async function briefing($: any): Promise<string> {
  const composed = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: ['Edit', 'Bash'], outputStyle: null, traits: [] })
  return composed.sections.find((section: any) => section.id === 'dope-tdd:briefing')?.text ?? ''
}

async function edit($: any, path: string) {
  const result = await editAt($, path)
  return { deny: result.deny ?? null, context: result.context ?? null }
}

export function playSession({ key, c, m, f, a, b }: Plan) {
  test(key, async ($: any, on: any) => {
    const world: any = fakeEngine(on)
    world.hasVitest = false
    const start = CONFIGS[c] ?? null
    if (start !== null) config(world, start)
    for (const marker of MARKERS[m] ?? []) world.existingFiles.add(`${ROOT}/${marker}`)
    for (const file of FILES[f] ?? []) world.fileContents.set(`${ROOT}/${file}`, 'a\n')

    const steps: unknown[] = []
    const capture = async (name: string) => {
      const before = world.listed.length
      const shown = { brief: await briefing($), band: await band($) }
      const walks = world.listed.length - before
      const edits = { 'src/new.ts': await edit($, 'src/new.ts'), 'lib/other.py': await edit($, 'lib/other.py') }
      const status = ((await $.command.run({ command: 'tdd', args: '' })) as { text: string }).text
      steps.push({ name, ...shown, walks, edits, status })
    }
    await capture('start')
    for (const name of [a, b]) {
      const happen = EVENTS[name]
      if (happen === undefined) throw new Error(`plan.ts names an event session.tsx doesn't have: ${name}`)
      await happen(world, $)
      await capture(name)
    }
    console.log(`@@${JSON.stringify({ key, steps })}`)
  })
}
