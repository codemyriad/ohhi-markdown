#!/usr/bin/env node
// Pin both Content Security Policies' connect-src to one team host, before the
// web build of a team release (docs/desktop-builds.md, "The connect-src
// trade-off", option 1).
//
//   node apps/desktop/scripts/pin-csp.mjs ohhi.example.ts.net
//
// Replaces the `wss: https:` sources in connect-src of
// apps/desktop/src-tauri/tauri.conf.json and apps/web/public/_headers with
// `wss://<host> https://<host>`, editing only those bytes. Idempotent: a second
// run with the same host changes nothing. Fails if a policy has neither the
// unpinned sources nor this host's (e.g. pinned to another host, or reworded),
// so a release never ships silently unpinned. check-csp.mjs still compares the
// two policies afterwards.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const host = process.argv[2]
if (!host || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i.test(host)) {
  console.error('usage: pin-csp.mjs <host>   (a bare hostname, optionally :port — no scheme or path)')
  process.exit(2)
}

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const targets = [
  // "connect-src": "'self' ipc: … wss: https: …",
  { file: 'apps/desktop/src-tauri/tauri.conf.json', line: /^(\s*"connect-src":\s*")([^"]*)(".*)$/m },
  // Content-Security-Policy: …; connect-src 'self' wss: https: …; …
  { file: 'apps/web/public/_headers', line: /^(\s+Content-Security-Policy:.*?connect-src)([^;]*)(.*)$/m },
]

const unpinned = /(^|\s)wss:\s+https:(?=\s|$)/
const pinned = `wss://${host} https://${host}`

let failed = false
for (const { file, line } of targets) {
  const path = join(repo, file)
  const text = readFileSync(path, 'utf8')
  const m = text.match(line)
  if (!m) {
    console.error(`${file}: no connect-src found`)
    failed = true
    continue
  }
  const sources = m[2]
  if (` ${sources} `.includes(` ${pinned} `) && !unpinned.test(sources)) {
    console.log(`${file}: already pinned to ${host}`)
    continue
  }
  if (!unpinned.test(sources)) {
    console.error(`${file}: connect-src has neither "wss: https:" nor "${pinned}":\n  ${sources.trim()}`)
    failed = true
    continue
  }
  const next = sources.replace(unpinned, (_, lead) => `${lead}${pinned}`)
  writeFileSync(path, text.replace(line, (_, a, _b, c) => `${a}${next}${c}`))
  console.log(`${file}: connect-src pinned to ${host}`)
}
process.exit(failed ? 1 : 0)
