#!/usr/bin/env node
/**
 * Write `downloads.json` — what Settings › About's *Get the desktop app*
 * reads (src/lib/downloads.ts parses it) — for one release. Run by the
 * release job of .github/workflows/desktop-release.yml over the flattened
 * assets folder, beside apps/desktop/scripts/updater-manifest.mjs; see
 * docs/public-deploy.md.
 *
 *   node downloads-manifest.mjs --dir assets --version 0.1.42 \
 *     --base-url https://dist.ohhi.md/0.1.42 [--date 2026-10-16T10:00:00Z] [--out assets/downloads.json]
 *
 * One entry per installer the folder holds — the macOS .dmg, the Linux
 * .AppImage and .deb, and an Android .apk once the mobile builds ship one —
 * with its size and sha256 and the URL it is served at (<base-url>/<name>:
 * dist.ohhi.md/<version>/ for the public channel, the team host's
 * /updates/<tag>/ for the team one). Updater bundles, signatures, the web
 * archive and the manifests are not installers and are left out. Two files
 * of one kind and arch is ambiguous and fails; so does a folder with none.
 *
 * Node builtins only: the release job runs it with the runner's node, with
 * nothing installed.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

/** The manifest's format version; src/lib/downloads.ts reads this one. */
export const DOWNLOADS_SCHEMA = 1

/** What counts as an installer, in the order the manifest lists them. */
export const INSTALLERS = [
  { os: 'macos', kind: 'dmg', test: /\.dmg$/ },
  { os: 'linux', kind: 'appimage', test: /\.AppImage$/ },
  { os: 'linux', kind: 'deb', test: /\.deb$/ },
  { os: 'android', kind: 'apk', test: /\.apk$/ },
]

/** The arch a release file name says (`ohhi_0.1.42_amd64.deb`, `…_universal.dmg`). */
export function archOf(name) {
  if (/universal/i.test(name)) return 'universal'
  if (/(aarch64|arm64)/i.test(name)) return 'arm64'
  if (/(amd64|x86_64|x64)/i.test(name)) return 'x86_64'
  return 'universal'
}

/**
 * The manifest for these files. Pure.
 * @param {{ files: { name: string, size: number, sha256: string }[], version: string, baseUrl: string, date: string }} input
 */
export function buildDownloads({ files, version, baseUrl, date }) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`version "${version}" is not semver`)
  const base = baseUrl.replace(/\/+$/, '')
  if (!/^https:\/\/[^/\s]+(\/\S*)?$/.test(base)) throw new Error(`base URL "${base}" must be https://`)
  const out = []
  for (const { os, kind, test } of INSTALLERS) {
    const byArch = new Map()
    for (const f of files.filter((f) => test.test(f.name))) {
      if (/\s/.test(f.name)) throw new Error(`asset name "${f.name}" contains whitespace`)
      const arch = archOf(f.name)
      if (byArch.has(arch)) throw new Error(`two ${kind} files for ${arch}: ${byArch.get(arch).name}, ${f.name}`)
      byArch.set(arch, f)
      out.push({ os, kind, arch, name: f.name, url: `${base}/${encodeURIComponent(f.name)}`, size: f.size, sha256: f.sha256 })
    }
  }
  if (!out.length) throw new Error('no installer (.dmg, .AppImage, .deb, .apk) among the assets')
  return { schema: DOWNLOADS_SCHEMA, version, date, files: out }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values: opt } = parseArgs({
    options: {
      dir: { type: 'string' },
      version: { type: 'string' },
      'base-url': { type: 'string' },
      date: { type: 'string' }, // for tests; defaults to now
      out: { type: 'string' },
    },
  })
  try {
    if (!opt.dir || !opt.version || !opt['base-url']) throw new Error('--dir, --version and --base-url are required')
    const files = readdirSync(opt.dir)
      .filter((name) => INSTALLERS.some((i) => i.test.test(name)))
      .map((name) => {
        const path = join(opt.dir, name)
        return { name, size: statSync(path).size, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }
      })
    const manifest = buildDownloads({
      files,
      version: opt.version,
      baseUrl: opt['base-url'],
      date: opt.date ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    })
    const out = opt.out ?? join(opt.dir, 'downloads.json')
    writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(`wrote ${out}: ${opt.version}, ${manifest.files.map((f) => `${f.os}/${f.kind}/${f.arch}`).join(', ')}`)
  } catch (e) {
    console.error(`downloads-manifest: ${e instanceof Error ? e.message : e}`)
    process.exit(1)
  }
}
