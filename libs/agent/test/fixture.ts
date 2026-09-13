/**
 * THE FIXTURE VAULT — one builder, shared across the workspace.
 *
 * `libs/agent`'s suite and `apps/cli`'s conformance suite must exercise the
 * SAME vault or "the core says X, the CLI prints Y" becomes a debate about
 * two fixtures. `apps/cli` imports this file by relative path
 * (`../../../libs/agent/test/fixture.js`), so it has exactly one rule:
 *
 *   IT IMPORTS NOTHING BUT NODE BUILT-INS.
 *
 * No vitest, no `@ohhi/*`, no testkit — `apps/cli` does not depend on those
 * and must not have to. Anything that needs a `Clock` or a backend belongs in
 * `test/harness.ts` beside it, not here.
 *
 * The shape is the REAL vault's, measured (agent-surface-shaping.md, evidence
 * table), because the behaviour under test is shaped by it:
 *
 *  - short, generic, single-noun titles (`JSON.md`, `HTML.md`, `Docs.md`)
 *    that are also the vault's most frequent body terms;
 *  - a link dump whose URLs contain those same words — the case ranked search
 *    must exclude and `--mode exact` must still find;
 *  - a big note that mentions a title word far more often than the note named
 *    for it;
 *  - one note with frontmatter (the real vault: 17 of 1,037) and one whose
 *    frontmatter is nested, so `supported: false` has a fixture;
 *  - a CRLF note, a binary, nested folders, an `.obsidian/` marker directory,
 *    an unpadded daily note, and unresolved links including an embed.
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export interface FixtureVault {
  /** Absolute, realpath'd — compare it to `backend.root` directly. */
  root: string
  /** A data dir OUTSIDE the vault, for the journal. */
  dataDir: string
  /** Vault-relative path -> the exact text written (LF, except where noted). */
  notes: Readonly<Record<string, string>>
  cleanup(): Promise<void>
}

/** `\n` everywhere except `Inbox/CRLF Note.md`, which is deliberately `\r\n`. */
const NOTES: Record<string, string> = {
  'Areas/CS/JSON.md': `# JSON

A tiny note. JSON is a data format. See [[HTML]].
`,
  'Areas/CS/HTML.md': `# HTML

Hypertext markup. Related: [[JSON]], [[Networking]].
`,
  'Areas/CS/Networking.md': `# Networking

TCP, UDP, and the things in between. #cs
`,
  'Areas/Life/Music.md': `# Music

A link dump. Nothing here is about markup, but every line says html.

${Array.from({ length: 30 }, (_, i) => `- https://example.com/music/${i}/index.html`).join('\n')}
`,
  'Edible/Docs.md': `# Edible

The note named Docs that never says the word. Links: [[JSON]], [[Networking]].
`,
  'Edible/Dev Notes/SnapMenu - Restaurant JSON Import.md': `# SnapMenu import

${Array.from({ length: 24 }, (_, i) => `Step ${i + 1}: parse the json payload, validate the json, store the json.`).join('\n')}
`,
  'Daily/02-5-2024.md': `# 02-5-2024

Wrote about [[JSON]] today. Also [[Nothing Here]].
`,
  'Projects/Editor.md': `---
title: Editor
tags: [project, editor]
status: active
created: 2026-01-05
draft: false
retries: 3
notes:
  - first
  - second
---

# Editor

Intro line about [[JSON]] and [[Docs|the docs]].

## Decisions

- Files are canonical.
- CRDTs handle sync.

## Notes

Some prose here. #project

### Open questions

- How does restore work?

## Later

Nothing yet.
`,
  'Projects/Nested.md': `---
meta:
  nested: true
---

# Nested

Frontmatter the flat subset refuses.
`,
  'Inbox/Unresolved Links.md': `# Inbox

Pointing at [[Nothing Here]] and ![[missing-diagram.png]].
`,
  'Inbox/CRLF Note.md': 'CRLF lines\r\nsecond line\r\nthird line\r\n',
  'TODO/Writing.md': `# Writing

Short.
`,
}

/** PNG magic plus a NUL byte — `looksBinary` answers on both counts. */
const BINARY = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02])

/**
 * Write the fixture vault to a fresh temp directory.
 *
 * Layout: `<base>/vault` and `<base>/data`, so the journal never lands inside
 * the vault it protects and `cleanup()` removes both.
 */
export async function makeFixtureVault(prefix = 'ohhi-fixture-'): Promise<FixtureVault> {
  const base = await realpath(await mkdtemp(join(tmpdir(), prefix)))
  const root = join(base, 'vault')
  const dataDir = join(base, 'data')
  await mkdir(root, { recursive: true })
  await mkdir(dataDir, { recursive: true })

  for (const [path, text] of Object.entries(NOTES)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text, 'utf8')
  }
  await mkdir(join(root, 'attachments'), { recursive: true })
  await writeFile(join(root, 'attachments/diagram.png'), BINARY)
  // An empty folder: `ls` must list it, and nothing must index it.
  await mkdir(join(root, 'Areas/Empty'), { recursive: true })
  // The marker that makes this a vault to the walk-up in `resolveVault`.
  await mkdir(join(root, '.obsidian'), { recursive: true })
  await writeFile(join(root, '.obsidian/workspace.json'), '{"main":{}}\n', 'utf8')

  return {
    root,
    dataDir,
    notes: NOTES,
    cleanup: () => rm(base, { recursive: true, force: true }),
  }
}

/** Text notes in the fixture — what `coverage.docs` must report. */
export const FIXTURE_TEXT_NOTES = Object.keys(NOTES).length
/** Binaries in the fixture — what `coverage.skippedBinary` must report. */
export const FIXTURE_BINARIES = 1
