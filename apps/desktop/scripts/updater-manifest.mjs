#!/usr/bin/env node
// Write the Tauri v2 static updater manifest (latest.json) for one release.
// Run by the release job of .github/workflows/desktop-release.yml over the
// flattened assets folder; see docs/desktop-builds.md ("Updates").
//
//   node updater-manifest.mjs --dir assets --version 0.1.42 \
//     --base-url https://ohhi.example.com/updates/v0.1.42 [--notes "…"] [--out assets/latest.json]
//
// Platforms: linux-x86_64 and linux-x86_64-appimage → the one *.AppImage;
// linux-x86_64-deb → the one *.deb, only when its .sig exists (the updater
// looks up `{os}-{arch}-{bundle}` before `{os}-{arch}`, so without this key a
// .deb install would be handed the AppImage); darwin-aarch64 and
// darwin-x86_64 → the one universal *.app.tar.gz. Each needs its .sig next to
// it (the minisign signature tauri build writes when createUpdaterArtifacts is
// on); the manifest carries the .sig file's contents, not a URL. Exactly one
// file per kind, or it fails: two AppImages would mean an ambiguous update.
// Asset URLs are <base-url>/<file name>, the place the team host mirrors them to.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values: opt } = parseArgs({
  options: {
    dir: { type: 'string' },
    version: { type: 'string' },
    'base-url': { type: 'string' },
    notes: { type: 'string', default: '' },
    out: { type: 'string' },
    'pub-date': { type: 'string' }, // for tests; defaults to now
  },
})
const fail = (msg) => {
  console.error(`updater-manifest: ${msg}`)
  process.exit(1)
}
if (!opt.dir || !opt.version || !opt['base-url']) fail('--dir, --version and --base-url are required')
// The updater compares semver; a leading "v" or a non-semver string would never update.
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(opt.version)) fail(`version "${opt.version}" is not semver`)
const base = opt['base-url'].replace(/\/+$/, '')
if (!/^https:\/\/[^/\s]+(\/\S*)?$/.test(base)) fail(`base URL "${base}" must be https://`)

const files = readdirSync(opt.dir)
function artifact(suffix, label) {
  const found = files.filter((f) => f.endsWith(suffix))
  if (found.length !== 1) fail(`expected exactly one *${suffix} (${label}), found ${found.length}: ${found.join(', ') || 'none'}`)
  const name = found[0]
  if (/\s/.test(name)) fail(`asset name "${name}" contains whitespace`)
  if (!files.includes(`${name}.sig`)) fail(`${name} has no ${name}.sig — was createUpdaterArtifacts on and the signing key set?`)
  const signature = readFileSync(join(opt.dir, `${name}.sig`), 'utf8').trim()
  if (!signature) fail(`${name}.sig is empty`)
  return { signature, url: `${base}/${encodeURIComponent(name)}` }
}

const linux = artifact('.AppImage', 'Linux')
const mac = artifact('.app.tar.gz', 'macOS universal')
const debs = files.filter((f) => f.endsWith('.deb'))
const deb = debs.length === 1 && files.includes(`${debs[0]}.sig`) ? artifact('.deb', 'Linux .deb') : null
const manifest = {
  version: opt.version,
  notes: opt.notes,
  pub_date: opt['pub-date'] ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  platforms: {
    'linux-x86_64': linux,
    'linux-x86_64-appimage': linux,
    ...(deb ? { 'linux-x86_64-deb': deb } : {}),
    'darwin-aarch64': mac,
    'darwin-x86_64': mac,
  },
}
const out = opt.out ?? join(opt.dir, 'latest.json')
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`wrote ${out}: ${opt.version}, ${Object.keys(manifest.platforms).join(', ')}`)
