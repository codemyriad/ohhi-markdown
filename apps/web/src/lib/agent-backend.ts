/**
 * `createAppBackend` (writing-harness-shaping B3): the `libs/agent` contract
 * over the LIVE workspace, so the in-app agent runs the same ops `ohhi` runs
 * — and no op changes (agent-surface-shaping R3.1, the reason the
 * `VaultBackend` seam exists).
 *
 * What differs from the files backend is where text comes from:
 *
 *  - An enrolled (or open) note's text is its **Y.Text** (`docForPath` →
 *    `EngineDoc.getText()`), never the disk copy: the agent cannot read a
 *    stale file or miss an unflushed edit. The adapter's `read` serves those
 *    bytes in the note's own EOL flavour and BOM (read off disk once), so the
 *    `hash` an op reports is the disk's whenever the two agree — usable as an
 *    `expectHash` later.
 *  - A tracked (never-shared) file has no doc (golden rule 3): its bytes come
 *    from the owning mount (`Workspace.readFileBytes`).
 *  - `index()` is the app's own `MemoryIndex` (navigation's), not a second
 *    one. It is keyed by doc guid where the files backend's guids ARE paths,
 *    so the two guid-keyed queries (`outgoing`, `headings`) are translated
 *    path → guid on the way in. Nothing is rebuilt.
 *
 * **Reads only, this wave.** Every write path — the adapter's writers and the
 * journal's `record`/`rename` — throws `refused` ("proposals land in H3"):
 * F routes `write`/`patch`/`append` through `proposeEdit` instead (the
 * harness's proposing tools override the adapter's `writeAtomic` and the
 * journal's `record`, so they never reach these refusals).
 *
 * Known gaps, each honest rather than invented: `mtime` is null (the
 * workspace keeps none, so `changes` sees the journal only); `journal` is the
 * ROOT mount's (a shared folder's pre-images are its own mount's).
 */
import type { AgentHost } from '@ohhi/harness'
import type { IndexDoc, VaultIndex } from '@ohhi/index'
import {
  decodeFile,
  IGNORED_DIRS,
  renderFile,
  type Clock,
  type FileStat,
  type PreImageJournal,
  type VaultAdapter,
} from '@ohhi/vault'
import type { FileRow, Workspace } from './workspace.svelte.js'

/** `@ohhi/agent`'s backend, as the harness names it (apps/web does not depend on `@ohhi/agent`). */
export type VaultBackend = AgentHost['backend']
type VaultFile = Awaited<ReturnType<VaultBackend['files']>> extends ReadonlyMap<string, infer F> ? F : never
type Coverage = Awaited<ReturnType<VaultBackend['coverage']>>

/**
 * A write this backend will not do. Shaped like `@ohhi/agent`'s `OpError`
 * (`code` + a `refused: …` message — what the harness's tools show the model
 * for an `OpError`), because `apps/web` cannot import the class itself:
 * `@ohhi/agent` is not one of its dependencies.
 * TODO(F): use `OpError('refused', …)` once the harness re-exports it.
 */
export class RefusedError extends Error {
  readonly code = 'refused' as const
  constructor(message: string) {
    super(`refused: ${message}`)
    this.name = 'OpError'
  }
}

const refuse = (): never => {
  throw new RefusedError('proposals land in H3 — this agent cannot write yet')
}

/** What the backend needs from the shell — narrow, so a test can hand in a fake. */
export interface AppBackendHost {
  /** What `stats` prints as the vault root (the app has no realpath). */
  root: string
  clock: Clock
  /** The app's index (navigation's `MemoryIndex`). */
  index: VaultIndex
  /** The workspace's rows (`ui.files`), read live. */
  files(): readonly FileRow[]
  /** An enrolled note's live text (its Y.Text), or null when it has no doc. */
  liveText(path: string): string | null
  /** A file's bytes from its owning mount (tracked files, binaries, EOL/BOM). */
  readFileBytes(path: string): Promise<Uint8Array | null>
  /** The root mount's pre-image journal, when there is one. */
  journal(): PreImageJournal | null
}

/** The host over the running workspace and the app's index. */
export function workspaceBackendHost(workspace: Workspace, index: VaultIndex, clock: Clock): AppBackendHost {
  return {
    root: workspace.room,
    clock,
    index,
    files: () => workspace.ui.files,
    liveText: (path) => workspace.docForPath(path)?.getText() ?? null,
    readFileBytes: (path) => workspace.readFileBytes(path),
    journal: () => workspace.journalFor(''),
  }
}

const enc = new TextEncoder()

/** The parent folders of a path, nearest last: `a/b/c.md` → `a`, `a/b`. */
function parentsOf(path: string): string[] {
  const parts = path.split('/')
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
}

const EMPTY_JOURNAL: PreImageJournal = {
  record: async () => refuse(),
  list: async () => [],
  entries: async () => [],
  latest: async () => null,
  rename: async () => refuse(),
}

/**
 * The index, with the guid-keyed queries taking a path as the ops pass one.
 * A delegate, not a copy: every call lands on the app's index.
 */
function pathKeyed(index: VaultIndex, guidOf: (path: string) => string | undefined): VaultIndex {
  return {
    schemaVersion: index.schemaVersion,
    search: (q, o) => index.search(q, o),
    grep: (p, o) => index.grep(p, o),
    quickOpen: (q, o) => index.quickOpen(q, o),
    backlinks: (t, o) => index.backlinks(t, o),
    outgoing: (key, o) => index.outgoing(guidOf(key) ?? key, o),
    unresolved: (o) => index.unresolved(o),
    tags: (o) => index.tags(o),
    byTag: (t, o) => index.byTag(t, o),
    headings: (key) => index.headings(guidOf(key) ?? key),
    frontmatterKeys: (o) => index.frontmatterKeys(o),
    resolve: (t, from) => index.resolve(t, from),
    stats: () => index.stats(),
  }
}

/** `VaultBackend` over the live workspace — reads only (see the file comment). */
export function createAppBackend(host: AppBackendHost): VaultBackend {
  const rows = (): readonly FileRow[] => host.files()
  const textRows = (): FileRow[] => rows().filter((r) => r.kind === 'text')
  const guidOf = (path: string): string | undefined => textRows().find((r) => r.path === path)?.guid
  /** Binaries' sizes, read once per backend (a run): `ls` should not re-read images. */
  const binarySizes = new Map<string, number>()

  const read = async (path: string): Promise<Uint8Array | null> => {
    const live = host.liveText(path)
    if (live === null) return host.readFileBytes(path)
    // The live text in the disk copy's EOL flavour and BOM: identical bytes
    // (and so an identical hash) whenever the disk is caught up.
    const disk = await host.readFileBytes(path)
    if (!disk) return enc.encode(live)
    const decoded = decodeFile(disk)
    return decoded.text === live ? disk : renderFile(live, decoded.eol, decoded.bom)
  }

  const docs = async (): Promise<ReadonlyMap<string, IndexDoc>> => {
    const out = new Map<string, IndexDoc>()
    for (const row of textRows()) {
      const text = host.liveText(row.path) ?? (await readText(row.path))
      if (text !== null) out.set(row.path, { guid: row.guid, path: row.path, text })
    }
    return out
  }
  const readText = async (path: string): Promise<string | null> => {
    const bytes = await host.readFileBytes(path)
    return bytes ? decodeFile(bytes).text : null
  }

  const files = async (): Promise<ReadonlyMap<string, VaultFile>> => {
    const out = new Map<string, VaultFile>()
    for (const row of rows()) {
      if (row.kind === 'text') {
        const text = host.liveText(row.path) ?? (await readText(row.path)) ?? ''
        out.set(row.path, { path: row.path, size: enc.encode(text).length, mtime: null, kind: 'text' })
      } else if (row.kind === 'binary') {
        let size = binarySizes.get(row.path)
        if (size === undefined) {
          size = (await host.readFileBytes(row.path))?.length ?? 0
          binarySizes.set(row.path, size)
        }
        out.set(row.path, { path: row.path, size, mtime: null, kind: 'binary' })
      }
    }
    return out
  }

  const dirs = async (): Promise<readonly string[]> => {
    const out = new Set<string>()
    for (const row of rows()) {
      if (row.kind === 'dir' || row.kind === 'mount') out.add(row.path)
      for (const parent of parentsOf(row.path)) out.add(parent)
    }
    return [...out].sort()
  }

  const journal = (): PreImageJournal => {
    const j = host.journal()
    if (!j) return EMPTY_JOURNAL
    return {
      record: async () => refuse(),
      rename: async () => refuse(),
      list: (path) => j.list(path),
      entries: (path) => j.entries(path),
      latest: (path) => j.latest(path),
    }
  }

  const adapter: VaultAdapter = {
    list: async (): Promise<FileStat[]> => [...(await files()).values()].map((f) => ({ path: f.path, size: f.size })),
    listDirs: async () => [...(await dirs())],
    read,
    writeAtomic: async () => refuse(),
    rename: async () => refuse(),
    remove: async () => refuse(),
    mkdir: async () => refuse(),
    removeDir: async () => refuse(),
    renameDir: async () => refuse(),
    watch: () => () => {},
  }

  const coverage = async (): Promise<Coverage> => {
    const all = rows()
    return {
      docs: all.filter((r) => r.kind === 'text').length,
      skippedBinary: all.filter((r) => r.kind === 'binary').length,
      ignored: [...IGNORED_DIRS].sort(),
    }
  }

  const index = pathKeyed(host.index, guidOf)

  return {
    root: host.root,
    adapter,
    clock: host.clock,
    get journal() {
      return journal()
    },
    appJournals: [],
    index: async () => index,
    docs,
    files,
    dirs,
    coverage,
    exists: async (path) => {
      const clean = path.replace(/^\/+|\/+$/g, '')
      if (rows().some((r) => r.path === clean && (r.kind === 'text' || r.kind === 'binary'))) return 'file'
      return (await dirs()).includes(clean) ? 'dir' : null
    },
    buildMs: async () => 0,
  }
}
