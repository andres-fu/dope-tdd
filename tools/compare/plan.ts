// The sessions `npm run compare -- --sessions` plays, as plain data, so compare.ts knows every session that should come
// back without running any, and a session both builds lost still reads as missing.
export const CONFIGS: Record<string, string | null> = { none: null, warn: '{"mode":"warn"}', broken: 'not json {' }
export const MARKERS: Record<string, string[]> = { none: [], pkg: ['package.json'], nestedPkg: ['web/package.json'], pkgSln: ['package.json', 'App.sln'] }
export const FILES: Record<string, string[]> = {
  py: ['api.py', 'db.py', 'tests/test_api.py'],
  ts: ['src/a.ts', 'tests/a.test.ts'],
  site: ['site/src/lib/countup.ts', 'site/src/lib/countup.test.ts'],
  cs: ['MyApp/Service.cs', 'MyApp/Util.cs', 'MyApp.Tests/ServiceTests.cs'],
  nested: ['web/src/a.ts', 'web/src/a.test.ts', 'api.py', 'db.py', 'server.py'],
  pyGo: ['lib/a.py', 'lib/b.py', 'lib/c.py', 'x.go', 'y.go', 'z.go', 'w.go'],
  lua: ['main.lua', 'run.sh'],
}
export const EVENT_NAMES = ['cfgWarn', 'cfgBroken', 'cfgBadMode', 'cfgPy', 'cfgEmpty', 'cfgDelete', 'markerPkg', 'markerPy', 'markerGone', 'addSrc', 'rmSrc', 'addPy', 'setup', 'setupWrite']

export type Plan = { key: string; c: string; m: string; f: string; a: string; b: string }

/** Every session: each project, then each pair of things that can happen in it. */
export const ALL: Plan[] = Object.keys(CONFIGS).flatMap(c =>
  Object.keys(MARKERS).flatMap(m =>
    Object.keys(FILES).flatMap(f => EVENT_NAMES.flatMap(a => EVENT_NAMES.map(b => ({ key: `${c}/${m}/${f}/${a}/${b}`, c, m, f, a, b })))),
  ),
)
