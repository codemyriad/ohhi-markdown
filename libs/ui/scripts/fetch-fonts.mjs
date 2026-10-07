#!/usr/bin/env node
/**
 * fetch-fonts — vendors the bundled typefaces into libs/ui/fonts/ and writes
 * libs/ui/src/styles/fonts.css (quiet-shell-shaping F14; foundations Stage 5).
 *
 * The app never fetches a font at runtime: this script is the ONLY network
 * step, run by a person (`cd libs/ui && rushx fonts`), and its output is
 * committed. It asks Google Fonts' css2 API for each family, keeps the
 * `latin` and `latin-ext` @font-face blocks, downloads those files and
 * rewrites the stylesheet with relative url()s, the same unicode-range, and
 * font-display: swap.
 *
 * STATIC instances, one file per weight — never the variable file. A modern
 * Chrome User-Agent gets ONE variable woff2 for every weight, declared as a
 * `font-weight: 400 600` range, and WebKitGTK (the Linux desktop webview)
 * rendered body text from it visibly bold (round 3, Chris's screenshots).
 * Chrome 60's User-Agent still gets woff2 but static per-weight files; the
 * script refuses a file that two weights share or that carries an `fvar`
 * table, so a change on Google's side fails loudly instead of shipping a
 * variable font again.
 *
 * Each family's OFL.txt comes from google/fonts — the licence of exactly the
 * binaries served — and sits beside its files.
 *
 * The url()s are relative to fonts.css, i.e. they point INTO libs/ui — under
 * `vite dev` that is outside apps/web's root, so apps/web/vite.config.ts adds
 * libs/ui/fonts to `server.fs.allow` (without it every face 403s and the
 * console fills with failed font loads — round 3 Q7). A build is unaffected:
 * Vite emits the files as hashed assets.
 *
 * Re-running is idempotent; it rewrites fonts/ and fonts.css from scratch.
 */
import { mkdir, rm, writeFile, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FONTS_DIR = join(ROOT, 'fonts')
const CSS_OUT = join(ROOT, 'src', 'styles', 'fonts.css')
// Old enough that Google serves static instances, new enough for woff2.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.113 Safari/537.36'
const SUBSETS = ['latin', 'latin-ext']

/** family, slug (folder + google/fonts ofl dir), cuts as [weight, italic]. */
const FAMILIES = [
  { family: 'Public Sans', slug: 'publicsans', cuts: [[400, false], [500, false], [600, false], [400, true]] },
  { family: 'JetBrains Mono', slug: 'jetbrainsmono', cuts: [[400, false], [500, false]] },
]

function cssUrl({ family, cuts }) {
  const hasItalic = cuts.some(([, i]) => i)
  const name = family.replace(/ /g, '+')
  const tuples = hasItalic
    ? cuts.map(([w, i]) => `${i ? 1 : 0},${w}`).sort().join(';')
    : cuts.map(([w]) => w).sort((a, b) => a - b).join(';')
  return `https://fonts.googleapis.com/css2?family=${name}:${hasItalic ? 'ital,' : ''}wght@${tuples}&display=swap`
}

async function get(url, as) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return as === 'buffer' ? Buffer.from(await res.arrayBuffer()) : res.text()
}

/** Parse css2 output into [{ subset, style, weight, url, range }]. */
function parse(css) {
  const out = []
  const re = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g
  for (const [, subset, body] of css.matchAll(re)) {
    const field = (k) => body.match(new RegExp(`${k}:\\s*([^;]+);`))?.[1].trim()
    const url = body.match(/url\(([^)]+)\)\s*format\('woff2'\)/)?.[1]
    if (!url) throw new Error(`no woff2 src in the ${subset} block — wrong User-Agent?`)
    out.push({ subset, style: field('font-style'), weight: Number(field('font-weight')), url, range: field('unicode-range') })
  }
  return out
}

/** The table tags in a woff2 file's directory (WOFF2 spec §5). */
function woff2Tags(buf) {
  if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a woff2 file')
  const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep',
    'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF',
    'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat',
    'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd',
    'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill']
  let at = 48
  const base128 = () => {
    let v = 0
    for (let i = 0; i < 5; i++) {
      const b = buf[at++]
      v = v * 128 + (b & 0x7f)
      if (!(b & 0x80)) return v
    }
    throw new Error('bad UIntBase128')
  }
  const tags = []
  for (let n = buf.readUInt16BE(12); n > 0; n--) {
    const flags = buf[at++]
    const tag = (flags & 0x3f) === 63 ? buf.toString('latin1', at, (at += 4)) : KNOWN[flags & 0x3f]
    const version = (flags >> 6) & 3
    base128() // origLength
    if (tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0) base128() // transformLength
    tags.push(tag)
  }
  return tags
}

async function main() {
  await rm(FONTS_DIR, { recursive: true, force: true })
  await mkdir(FONTS_DIR, { recursive: true })
  const rules = []
  for (const fam of FAMILIES) {
    const dir = join(FONTS_DIR, fam.slug)
    await mkdir(dir, { recursive: true })
    const blocks = parse(await get(cssUrl(fam))).filter((b) => SUBSETS.includes(b.subset))
    const seen = new Set()
    for (const f of blocks) {
      if (seen.has(f.url)) throw new Error(`${fam.family}: one file answers several weights — a variable font`)
      seen.add(f.url)
      const bytes = await get(f.url, 'buffer')
      if (woff2Tags(bytes).includes('fvar')) throw new Error(`${fam.family} ${f.weight}: the file is variable (fvar)`)
      const file = `${f.weight}${f.style === 'italic' ? '-italic' : ''}-${f.subset}.woff2`
      await writeFile(join(dir, file), bytes)
      rules.push(
        `/* ${f.subset} */\n@font-face {\n` +
          `  font-family: '${fam.family}';\n` +
          `  font-style: ${f.style};\n` +
          `  font-weight: ${f.weight};\n` +
          `  font-display: swap;\n` +
          `  src: url('../../fonts/${fam.slug}/${file}') format('woff2');\n` +
          `  unicode-range: ${f.range};\n}`,
      )
    }
    await writeFile(
      join(dir, 'OFL.txt'),
      await get(`https://raw.githubusercontent.com/google/fonts/main/ofl/${fam.slug}/OFL.txt`),
    )
  }
  const header =
    '/*\n * GENERATED by libs/ui/scripts/fetch-fonts.mjs (`cd libs/ui && rushx fonts`) —\n' +
    ' * do not hand-edit. The bundled faces (quiet-shell-shaping F14): woff2 from\n' +
    ' * Google Fonts, latin + latin-ext, vendored under libs/ui/fonts/ with each\n' +
    " * family's OFL.txt. Static instances, one file per weight (no variable\n" +
    ' * fonts: WebKitGTK rendered them bold). No runtime fetch: the url()s are\n' +
    ' * relative and Vite emits the files as assets.\n */\n\n'
  await writeFile(CSS_OUT, header + rules.join('\n\n') + '\n')

  let total = 0
  for (const fam of FAMILIES) {
    for (const name of await readdir(join(FONTS_DIR, fam.slug))) {
      if (!name.endsWith('.woff2')) continue
      const { size } = await stat(join(FONTS_DIR, fam.slug, name))
      total += size
      console.log(`${fam.slug}/${name}\t${(size / 1024).toFixed(1)} KB`)
    }
  }
  console.log(`total woff2: ${(total / 1024).toFixed(1)} KB, ${rules.length} @font-face rules`)
}

main().catch((err) => {
  console.error(`fetch-fonts: ${err.message}`)
  process.exit(1)
})
