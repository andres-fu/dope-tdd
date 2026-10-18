// `node --import ./tests/node/register.mjs --test tests/<file>.test.ts` runs one unit test file on Node, outside the
// kit: tests/node/hooks.mjs points 'claude-code/testing' at the shim and finds .ts files imported with no extension.
import { register } from 'node:module'

register('./hooks.mjs', import.meta.url)
