#!/usr/bin/env node
// CSP guard for the desktop + hosted web builds. Run after `rushx build` in apps/web.
//
//   node apps/desktop/scripts/check-csp.mjs          check (exit 1 on drift)
//   node apps/desktop/scripts/check-csp.mjs --print  print the inline-script hashes
//
// What it pins (docs/desktop-builds.md, "Content Security Policy"):
//  1. Every inline <script> in apps/web/dist/index.html has its sha256 in the
//     web policy (apps/web/public/_headers) — Tauri hashes its own at compile
//     time, so only the static Cloudflare policy can go stale.
//  2. Neither policy allows 'unsafe-eval', inline script, or plugins.
//  3. The two policies agree, apart from Tauri's IPC sources and those hashes.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const html = readFileSync(join(repo, 'apps/web/dist/index.html'), 'utf8')
const hashes = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
  (m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`
)
if (process.argv.includes('--print')) {
  console.log(hashes.join('\n'))
  process.exit(0)
}

const parse = (csp) =>
  new Map(
    csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...sources]) => [name, sources])
  )
const headers = readFileSync(join(repo, 'apps/web/public/_headers'), 'utf8')
const webLine = headers.match(/^\s+Content-Security-Policy:\s*(.+)$/m)
const desk = JSON.parse(readFileSync(join(repo, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8')).app.security.csp
const policies = {
  web: webLine ? parse(webLine[1]) : null,
  // tauri.conf.json takes the policy as a string or as { directive: sources }.
  desktop: !desk
    ? null
    : parse(typeof desk === 'string' ? desk : Object.entries(desk).map(([k, v]) => `${k} ${[v].flat().join(' ')}`).join(';')),
}

const errors = []
for (const [name, p] of Object.entries(policies)) {
  if (!p) {
    errors.push(`${name}: no Content-Security-Policy found`)
    continue
  }
  const script = p.get('script-src') ?? p.get('default-src') ?? []
  if ([...p.values()].flat().includes("'unsafe-eval'")) errors.push(`${name}: 'unsafe-eval' is allowed`)
  if (script.includes("'unsafe-inline'")) errors.push(`${name}: script-src allows 'unsafe-inline'`)
  if (script.some((s) => /^(https?:|\*|data:|blob:)/.test(s))) errors.push(`${name}: script-src allows a remote/data/blob source`)
  if ((p.get('object-src') ?? []).join(' ') !== "'none'") errors.push(`${name}: object-src is not 'none'`)
}
if (policies.web) {
  const pinned = (policies.web.get('script-src') ?? []).filter((s) => s.startsWith("'sha256-"))
  for (const h of hashes) if (!pinned.includes(h)) errors.push(`web: inline script hash ${h} missing from _headers script-src`)
  for (const h of pinned) if (!hashes.includes(h)) errors.push(`web: stale hash ${h} in _headers script-src`)
}
if (policies.web && policies.desktop) {
  const norm = (p, drop) =>
    [...p].map(([k, v]) => `${k} ${v.filter((s) => !drop.test(s)).join(' ')}`).sort().join('; ')
  const web = norm(policies.web, /^'sha256-/)
  const desktop = norm(policies.desktop, /^(ipc:|http:\/\/ipc\.localhost)$/)
  if (web !== desktop) errors.push(`web and desktop policies differ:\n    web:     ${web}\n    desktop: ${desktop}`)
}

if (errors.length) {
  console.error(`CSP check failed:\n  ${errors.join('\n  ')}\nCurrent inline-script hashes:\n  ${hashes.join('\n  ')}`)
  process.exit(1)
}
console.log(`CSP check ok (${hashes.length} inline script hash${hashes.length === 1 ? '' : 'es'} pinned; web + desktop policies sane)`)
