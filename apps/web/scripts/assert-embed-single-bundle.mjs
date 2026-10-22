// The embedded page's script must stay ONE classic script (nextcloud-build
// decision 1): AppAPI's CSP is `script-src-elem 'strict-dynamic' 'nonce-…'`,
// so a second chunk, an `import()` or ESM syntax would be refused in the page.
// Run by `rushx build:embed` after the build; exits non-zero on any of them.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('../dist-embed/', import.meta.url))

/** Every `.js` under `dir`, recursively. */
function jsFiles(at) {
  const out = []
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    const p = join(at, entry.name)
    if (entry.isDirectory()) out.push(...jsFiles(p))
    else if (/\.(c|m)?js$/.test(entry.name)) out.push(p)
  }
  return out
}

/** Problems with one bundle's source ([] = a single classic script). */
export function problemsOf(source) {
  const problems = []
  if (/\bimport\s*\(/.test(source)) problems.push('a dynamic import()')
  if (/(^|[;\n}])\s*import[\s{*'"]/.test(source)) problems.push('a top-level import statement')
  if (/(^|[;\n}])\s*export[\s{*]/.test(source)) problems.push('an export statement')
  return problems
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  let files
  try {
    files = jsFiles(dir)
  } catch {
    console.error(`assert-embed-single-bundle: ${dir} is missing — run the embed build first`)
    process.exit(1)
  }
  const errors = []
  if (files.length !== 1) errors.push(`expected exactly one .js in dist-embed/, found ${files.length}: ${files.join(', ')}`)
  for (const f of files) for (const p of problemsOf(readFileSync(f, 'utf8'))) errors.push(`${f}: ${p}`)
  if (errors.length > 0) {
    for (const e of errors) console.error(`assert-embed-single-bundle: ${e}`)
    process.exit(1)
  }
  console.log(`assert-embed-single-bundle: ok (${files[0]})`)
}
