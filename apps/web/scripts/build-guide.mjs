/**
 * Renders the guide pages (first-run-shaping E4, Fork 4-A): every
 * `docs/guide/*.md` becomes a standalone `public/guide/<page>.html`, which
 * Vite copies into `dist/guide/` — served beside the app on the team host and
 * bundled into the desktop app. `src/lib/guide.ts` is the one place the app
 * links to them from. `public/guide/` is generated and git-ignored.
 *
 * The pages are our own docs, but the renderer still treats them as text:
 *  - raw HTML in the markdown is ESCAPED, never passed through (no <script>,
 *    no inline handlers, no iframes);
 *  - a link or image whose URL is not http(s), mailto, a fragment or a
 *    relative path is dropped to its text (no `javascript:` / `data:`);
 *  - the page carries no script at all — the nav is plain links — so it runs
 *    under the app's CSP (`script-src 'self'`) and in a capability-less
 *    desktop window alike.
 * A relative link to another guide page (`sharing.md#…`) is rewritten to its
 * `.html`. The stylesheet is inlined (the policies allow inline styles) and
 * sits outside the app's token layer on purpose: light and dark by
 * `prefers-color-scheme`, a readable measure, nothing else.
 *
 * Run by `rushx build` and `rushx dev` before Vite. Tested by
 * `scripts/build-guide.test.mjs`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Marked } from 'marked'

/** The nav's order; any other page follows, by name. */
export const PAGE_ORDER = ['start', 'sharing', 'recovery', 'import', 'relay', 'customise', 'agents', 'changes']

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c])

/** `null` for a URL the page must not carry; the (rewritten) URL otherwise. */
export function safeUrl(href) {
  const url = String(href ?? '').trim()
  if (url === '') return null
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)
  if (scheme && !['http', 'https', 'mailto'].includes(scheme[1].toLowerCase())) return null
  if (!scheme && !url.startsWith('//')) {
    // A sibling guide page: `sharing.md`, `./sharing.md#the-secret`.
    const m = /^(?:\.\/)?([a-z0-9-]+)\.md(#.*)?$/i.exec(url)
    if (m) return `${m[1]}.html${m[2] ?? ''}`
  }
  if (url.startsWith('//')) return null
  return url
}

/** GitHub-style heading ids, so a page can link to a section. */
export function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z0-9#]+;/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}

/** `---` frontmatter (flat `key: value` lines) and the body after it. */
export function splitFrontmatter(source) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (!m) return { meta: {}, body: source }
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (kv) meta[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return { meta, body: source.slice(m[0].length) }
}

function createMarked() {
  const marked = new Marked({ gfm: true, async: false })
  marked.use({
    renderer: {
      // Raw HTML is shown as text, never parsed.
      html({ text }) {
        return escapeHtml(text)
      },
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens)
        return `<h${depth} id="${escapeHtml(slug(inner))}">${inner}</h${depth}>\n`
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens)
        const url = safeUrl(href)
        if (url === null) return inner
        const external = /^https?:/i.test(url)
        return `<a href="${escapeHtml(url)}"${title ? ` title="${escapeHtml(title)}"` : ''}${external ? ' rel="noopener noreferrer"' : ''}>${inner}</a>`
      },
      image({ href, title, text }) {
        const url = safeUrl(href)
        if (url === null) return escapeHtml(text)
        return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ''}>`
      },
    },
  })
  return marked
}

export const STYLE = `
:root { color-scheme: light dark; --bg: #fdfcfa; --fg: #23211f; --muted: #5d5954; --rule: #e4e0da; --link: #1f5fa8; --code: #f1eee9; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #1c1b1a; --fg: #e9e6e1; --muted: #aaa49c; --rule: #3a3734; --link: #8ab8f0; --code: #2a2826; }
}
* { box-sizing: border-box; }
html { background: var(--bg); color: var(--fg); }
body { margin: 0; font: 16px/1.6 "Public Sans", system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif; }
nav { border-bottom: 1px solid var(--rule); padding: 0.75rem 1rem; }
nav ul { list-style: none; margin: 0 auto; padding: 0; max-width: 42rem; display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; font-size: 0.875rem; }
nav a { color: var(--muted); text-decoration: none; }
nav a:hover, nav a:focus-visible { color: var(--fg); text-decoration: underline; }
nav a[aria-current="page"] { color: var(--fg); font-weight: 600; }
main { margin: 0 auto; max-width: 42rem; padding: 1.5rem 1rem 4rem; }
h1 { font-size: 1.75rem; line-height: 1.25; margin: 0.5rem 0 1rem; }
h2 { font-size: 1.25rem; margin: 2rem 0 0.5rem; }
h3 { font-size: 1.05rem; margin: 1.5rem 0 0.5rem; }
a { color: var(--link); }
code { font: 0.875em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--code); padding: 0.1em 0.3em; border-radius: 3px; }
pre { background: var(--code); padding: 0.75rem 1rem; border-radius: 6px; overflow-x: auto; }
pre code { padding: 0; background: none; }
table { border-collapse: collapse; width: 100%; font-size: 0.9375rem; }
th, td { border: 1px solid var(--rule); padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
blockquote { margin: 1rem 0; padding: 0 1rem; border-left: 3px solid var(--rule); color: var(--muted); }
hr { border: 0; border-top: 1px solid var(--rule); margin: 2rem 0; }
footer { color: var(--muted); font-size: 0.8125rem; margin-top: 3rem; }
`.trim()

/** The page's title: frontmatter `title:`, else its first `# ` heading, else its name. */
export function pageTitle(meta, body, name) {
  if (meta.title) return meta.title
  const h1 = /^#\s+(.+)$/m.exec(body)
  return h1 ? h1[1].trim() : name
}

/**
 * One page as a standalone HTML document. `nav` is every page's
 * `{ name, title }`, in order; the current one is marked.
 */
export function renderPage({ name, source, nav }) {
  const { meta, body } = splitFrontmatter(source)
  const title = pageTitle(meta, body, name)
  const content = createMarked().parse(body)
  const links = nav
    .map(
      (p) =>
        `<li><a href="${escapeHtml(p.name)}.html"${p.name === name ? ' aria-current="page"' : ''}>${escapeHtml(p.title)}</a></li>`
    )
    .join('')
  const dated = meta.date ? `<footer>Updated ${escapeHtml(meta.date)}</footer>` : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Oh hi markdown</title>
<style>${STYLE}</style>
</head>
<body>
<nav aria-label="Guide"><ul>${links}</ul></nav>
<main>
${content}${dated}
</main>
</body>
</html>
`
}

/** Every page of `srcDir` rendered into `outDir` (emptied first). Returns the page names written. */
export function buildGuide(srcDir, outDir) {
  const files = readdirSync(srcDir).filter((f) => f.endsWith('.md'))
  const rank = (n) => (PAGE_ORDER.includes(n) ? PAGE_ORDER.indexOf(n) : PAGE_ORDER.length)
  const pages = files
    .map((f) => {
      const name = basename(f, '.md')
      const source = readFileSync(join(srcDir, f), 'utf8')
      const { meta, body } = splitFrontmatter(source)
      return { name, source, title: pageTitle(meta, body, name) }
    })
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
  const nav = pages.map(({ name, title }) => ({ name, title }))
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  for (const page of pages) writeFileSync(join(outDir, `${page.name}.html`), renderPage({ ...page, nav }), 'utf8')
  // `/guide/` itself: the first page, so a bare link lands somewhere.
  if (pages[0]) writeFileSync(join(outDir, 'index.html'), renderPage({ ...pages[0], nav }), 'utf8')
  return pages.map((p) => p.name)
}

// Run directly: docs/guide → apps/web/public/guide.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = resolve(here, '../../../docs/guide')
  const out = resolve(here, '../public/guide')
  if (!existsSync(src)) {
    console.error(`build-guide: no ${src}`)
    process.exit(1)
  }
  const names = buildGuide(src, out)
  console.log(`build-guide: ${names.length} page${names.length === 1 ? '' : 's'} → public/guide/`)
}
