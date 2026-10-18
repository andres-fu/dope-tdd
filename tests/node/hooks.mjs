// Module resolution for unit tests on node --test (see tests/node/register.mjs). The kit resolves imports the way a
// bundler does; Node wants the extension written, so an import with none is tried as .ts, then .tsx.
const KIT = new URL('./kit.mjs', import.meta.url).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'claude-code/testing') {
    return { url: KIT, shortCircuit: true }
  }
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (!/^\.\.?\//.test(specifier) || /\.[cm]?[jt]sx?$/.test(specifier)) {
      throw error
    }
    for (const ext of ['.ts', '.tsx']) {
      try {
        return await nextResolve(specifier + ext, context)
      } catch {
        // try the next extension
      }
    }
    throw error
  }
}
