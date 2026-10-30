// Draws assets/is-it-on.svg, the README's "Is it on?" diagram, from the band's own words (the guard words in the band
// model). Change the rows here, then run `npm run diagrams`; tests/diagrams.test.ts fails when the file and this
// disagree, or when the band gains a word that the diagram and the README do not name.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROWS = [
  { mark: 'on', title: 'Guarding', sub: 'nothing done yet', band: ['ready · write a failing test, or edit code'], mean: ['Every untested edit to this', "project's code is refused."] },
  { mark: 'on', title: 'Guarding', sub: 'it stopped an edit', band: ['refused: stats · write its test first'], mean: ['It refused an untested edit:', 'this is it doing its job.'] },
  { mark: 'off', title: 'On, not refusing', sub: 'on purpose', band: ['PAUSED · WARN ONLY · OBSERVING', 'STANDING DOWN'], mean: ['Edits go through. The band', "says why, and when it's back."] },
  // CAN'T READ RUNS still refuses edits, and CONFIG INVALID guards with the defaults: something is off, not all off.
  { mark: 'off', title: 'On, needs a fix', sub: 'something is off', band: ['NOT WATCHING · CONFIG INVALID', "CAN'T READ RUNS"], mean: ['The band names what is wrong', 'and how to fix it.'] },
  { mark: 'fail', title: 'Guard failing', sub: 'an internal error', band: ['GUARD FAILING'], mean: ['Calls went through unguarded.', 'The band says how many.'] },
  { mark: 'none', title: 'Not running here', sub: 'the plugin is off', band: null, mean: ['Not enabled for this folder:', 'check the install scope.'] },
]

const esc = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;')

export function renderIsItOn() {
  let y = 124
  const body = ROWS.map(r => {
    const top = y
    y += 68
    const mark =
      r.mark === 'on' ? `<rect x="32" y="${top + 15}" width="8" height="8" fill="#B83D01"/>`
      : r.mark === 'fail' ? `<rect x="32.5" y="${top + 15.5}" width="7" height="7" fill="none" stroke="#B83D01" stroke-width="1.5"/>`
      : `<rect x="32.5" y="${top + 15.5}" width="7" height="7" fill="none" stroke="#181818" stroke-width="1"/>`
    const box = r.band === null
      ? `<rect x="214" y="${top + 4}" width="300" height="48" rx="6" fill="#FBF9F5" stroke="#181818" stroke-width="1" stroke-dasharray="4 3"/>
  <text class="dim" x="228" y="${top + 33}" font-size="13" font-style="italic">no band, and no /tdd command</text>`
      : `<rect class="card" x="214" y="${top + 4}" width="300" height="48" rx="6"/>
  ${r.band.length === 1
        ? `<text class="mono" x="228" y="${top + 32}" font-size="11.5">${esc(r.band[0])}</text>`
        : `<text class="mono" x="228" y="${top + 24}" font-size="11.5">${esc(r.band[0])}</text>
  <text class="mono" x="228" y="${top + 41}" font-size="11.5">${esc(r.band[1])}</text>`}`
    return `  ${mark}
  <text class="serif" x="50" y="${top + 23}" font-size="15">${esc(r.title)}</text>
  <text class="dim" x="50" y="${top + 41}" font-size="13">${esc(r.sub)}</text>
  ${box}
  <text class="dim" x="534" y="${top + 24}" font-size="13">${esc(r.mean[0])}</text>
  <text class="dim" x="534" y="${top + 41}" font-size="13">${esc(r.mean[1])}</text>`
  }).join('\n\n')
  const height = y + 64
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 760 ${height}" style="max-width: 760px; height: auto" role="img" aria-labelledby="t d">
  <title id="t">Is Dope TDD on?</title>
  <desc id="d">How to read the band above the prompt. Guarding: the band reads "ready" before anything happens, or "refused" after it stops an untested edit. On but not refusing, on purpose: PAUSED, WARN ONLY, OBSERVING or STANDING DOWN. On but needing a fix, which the band names: NOT WATCHING, CONFIG INVALID or CAN'T READ RUNS. GUARD FAILING: an internal error let calls through. Not running here: no band and no /tdd command, so the plugin is not enabled for this folder. Any time, /tdd shows the guard, mode, stack and layout.</desc>
  <style>
    .display { font-family: Anton, 'Arial Narrow', sans-serif; font-size: 28px; letter-spacing: 0.5px; fill: #181818; }
    .serif { font-family: Georgia, 'Times New Roman', serif; fill: #181818; }
    .dim { font-family: Georgia, 'Times New Roman', serif; fill: #6B655C; }
    .mono { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; fill: #181818; }
    .kicker { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 12px; letter-spacing: 1.5px; fill: #B83D01; }
    .card { fill: #FFFFFF; stroke: #181818; stroke-width: 1; }
  </style>

  <rect x="0.75" y="0.75" width="758.5" height="${height - 1.5}" rx="16" fill="#FBF9F5" stroke="#181818" stroke-width="1.5"/>

  <text class="display" x="32" y="56">IS IT ON?</text>
  <text class="dim" x="32" y="80" font-size="15" font-style="italic">Read the band above the prompt.</text>
  <text class="kicker" x="50" y="112">STATE</text>
  <text class="kicker" x="214" y="112">THE BAND SAYS</text>
  <text class="kicker" x="534" y="112">WHAT IT MEANS</text>

${body}

  <line x1="32" y1="${y + 8}" x2="728" y2="${y + 8}" stroke="#181818" stroke-width="0.75"/>
  <text class="dim" x="32" y="${y + 36}" font-size="14">Not sure? Run <tspan class="mono" font-size="13">/tdd</tspan>: it shows the guard, the mode, the stack and the layout, and any error in dope-tdd.json.</text>
</svg>
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('../../assets/is-it-on.svg', import.meta.url), renderIsItOn())
}
