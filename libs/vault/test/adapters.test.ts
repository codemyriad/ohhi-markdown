/**
 * Adapter-seam guarantees that must hold for EVERY implementation, not just
 * the two that happen to have been edited.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createYjsEngine } from '@ohhi/sync'
import { createWebDavFake, SimClock } from '@ohhi/testkit'
import { AppDirListeners } from '../src/app-dir.js'
import { enrollFolder } from '../src/enrollment.js'
import { hashBytes } from '../src/hash.js'
import { MemVaultAdapter } from '../src/mem-adapter.js'
import { NodeVaultAdapter } from '../src/node-adapter.js'
import { VaultSession } from '../src/session.js'
import { WebDavVaultAdapter } from '../src/webdav/index.js'
import { MemJournal, MemLcaStore } from '../src/stores.js'
import {
  IGNORED_DIRS,
  isTempName,
  WriteConflictError,
  type VaultAdapter,
  type WatchEvent,
} from '../src/types.js'

const enc = new TextEncoder()

describe('IGNORED_DIRS', () => {
  it("hides Editor's own directory, and every other app's, from listings", () => {
    // The guarantee has to be a property of the SEAM. `.ohhi/themes/x.css`
    // getting enrolled means Editor syncs a stylesheet as a note while
    // rendering itself from it — the same bug in each adapter that forgets.
    for (const dir of ['.git', '.obsidian', '.ohhi', '.ohhi-cache', '.trash', 'node_modules']) {
      expect(IGNORED_DIRS.has(dir), `${dir} must be ignored`).toBe(true)
    }
  })

  it('still ignores the pre-rename app folders, so an older vault never enrols them', () => {
    for (const dir of ['.editor', '.editor-cache']) {
      expect(IGNORED_DIRS.has(dir), `${dir} must be ignored`).toBe(true)
    }
  })

  it('ignores the skills farm copy (.claude/skills mirrors .agents/skills)', () => {
    expect(IGNORED_DIRS.has('.claude')).toBe(true)
    // The canonical skills folder is vault content, not an ignored app dir.
    expect(IGNORED_DIRS.has('.agents')).toBe(false)
  })

  it('excludes ignored paths from list() and listDirs()', async () => {
    const a = new MemVaultAdapter()
    await a.writeAtomic('note.md', enc.encode('hi'))
    await a.mkdir('real')
    await a.writeAtomic('.ohhi/themes/mine/theme.css', enc.encode(':root{}'))
    await a.writeAtomic('.editor/themes/old/theme.css', enc.encode(':root{}'))
    await a.writeAtomic('.obsidian/app.json', enc.encode('{}'))
    await a.writeAtomic('.trash/old.md', enc.encode('gone'))
    expect((await a.list()).map((f) => f.path)).toEqual(['note.md'])
    expect(await a.listDirs()).toEqual(['real'])
  })

  it('still READS an ignored path directly — that is how a vault theme loads', async () => {
    const a = new MemVaultAdapter()
    await a.writeAtomic('.ohhi/themes/mine/theme.css', enc.encode(':root{}'))
    expect(await a.read('.ohhi/themes/mine/theme.css')).not.toBeNull()
  })
})

describe('isTempName', () => {
  it('matches the current temp infix and the pre-rename one a crashed old build leaves', () => {
    expect(isTempName('note.md.ohhi-tmp-123-456')).toBe(true)
    expect(isTempName('Areas/note.md.editor-tmp-123-456')).toBe(true)
    expect(isTempName('note.md')).toBe(false)
    expect(isTempName('ohhi-tmp notes.md')).toBe(false)
  })
})

/**
 * The compare-and-swap at the write seam (Spike S11 finding F1).
 *
 * This is a SEAM guarantee, so it is asserted over every adapter a test
 * process can build — the in-memory one and the real filesystem one — from one
 * table. `MemVaultAdapter` is what the L1 fixtures race against;
 * `NodeVaultAdapter` is what `ohhi` and the desktop app actually write with,
 * and the only one where "immediately before the rename" is a real instruction.
 */
describe('writeAtomic compare-and-swap', () => {
  const temps: string[] = []
  afterAll(async () => {
    for (const dir of temps) await rm(dir, { recursive: true, force: true })
  })

  const adapters: [string, () => Promise<VaultAdapter & { root?: string }>][] = [
    ['MemVaultAdapter', async () => new MemVaultAdapter()],
    [
      'NodeVaultAdapter',
      async () => {
        const root = await mkdtemp(join(tmpdir(), 'vault-cas-'))
        temps.push(root)
        return Object.assign(new NodeVaultAdapter(root), { root })
      },
    ],
    ['WebDavVaultAdapter', async () => new WebDavVaultAdapter({ baseUrl: (await createWebDavFake({ owner: 'u' })).url, headers: () => ({}), clock: new SimClock(), owner: 'u' })],
  ]

  for (const [name, make] of adapters) {
    describe(name, () => {
      it('writes when the hash still matches, and reports the conflict when it does not', async () => {
        const a = await make()
        const before = enc.encode('v1\n')
        await a.writeAtomic('note.md', before)

        // Matching expectation: an ordinary write.
        await a.writeAtomic('note.md', enc.encode('v2\n'), { expectHash: hashBytes(before) })
        expect(await a.read('note.md')).toEqual(enc.encode('v2\n'))

        // Stale expectation (somebody else wrote in between): refused, with
        // both hashes named so the caller can reclassify rather than guess.
        const err = await a
          .writeAtomic('note.md', enc.encode('v3\n'), { expectHash: hashBytes(before) })
          .then(() => null, (e: unknown) => e)
        expect(err).toBeInstanceOf(WriteConflictError)
        expect(err).toMatchObject({
          path: 'note.md',
          expected: hashBytes(before),
          actual: hashBytes(enc.encode('v2\n')),
        })
        // Nothing was written: a refused swap leaves the file exactly as the
        // other writer left it (that is the byte the journal never held).
        expect(await a.read('note.md')).toEqual(enc.encode('v2\n'))
      })

      it("spells 'no file there' as the empty hash, both ways", async () => {
        const a = await make()
        // Creating: `''` is the LcaRecord convention for never-on-disk.
        await a.writeAtomic('fresh.md', enc.encode('new\n'), { expectHash: '' })
        expect(await a.read('fresh.md')).toEqual(enc.encode('new\n'))

        // The same create once the file exists is a conflict, not a clobber.
        await expect(
          a.writeAtomic('fresh.md', enc.encode('again\n'), { expectHash: '' })
        ).rejects.toBeInstanceOf(WriteConflictError)

        // And expecting content where there is none reports `actual: ''`.
        const err = await a
          .writeAtomic('gone.md', enc.encode('x\n'), { expectHash: hashBytes(enc.encode('x\n')) })
          .then(() => null, (e: unknown) => e)
        expect(err).toMatchObject({ actual: '' })
        expect(await a.read('gone.md')).toBeNull()
      })

      it('leaves no temp file behind when the swap loses', async () => {
        const a = await make()
        await a.writeAtomic('note.md', enc.encode('theirs\n'))
        await expect(
          a.writeAtomic('note.md', enc.encode('mine\n'), { expectHash: 'deadbeef' })
        ).rejects.toBeInstanceOf(WriteConflictError)
        // list() hides nothing that is not an ignored dir, and the Node
        // adapter's temp names are filtered out of watch but NOT out of a
        // directory read — so check the directory itself.
        const root = (a as { root?: string }).root
        const names = root ? await readdir(root) : (await a.list()).map((f) => f.path)
        expect(names.filter(isTempName)).toEqual([])
      })

      it('is unconditional when no expectation is passed', async () => {
        const a = await make()
        await a.writeAtomic('note.md', enc.encode('v1\n'))
        await a.writeAtomic('note.md', enc.encode('v2\n'))
        expect(await a.read('note.md')).toEqual(enc.encode('v2\n'))
      })
    })
  }
})

/**
 * `watchAppDir` (spike-resource-root Q1, foundations Stage 1): the resource
 * root's changes reach their own listener and NEVER the vault side — not the
 * watch callback, not `pathToGuid`, not the folder map, not a doc.
 */
describe('watchAppDir — .ohhi/** is routed, never enrolled', () => {
  it('splits a batch: vault paths to the vault, app-dir paths to their listener, temp names to neither', () => {
    const router = new AppDirListeners()
    const seen: string[][] = []
    router.add('.ohhi', (paths) => seen.push(paths))
    const vault = router.route([
      'note.md',
      '.ohhi/layouts/mine.json',
      '.ohhi/layouts/mine.json.ohhi-tmp-1-2',
      '.git/HEAD',
      'sub/.obsidian/app.json',
    ])
    expect(vault).toEqual(['note.md'])
    expect(seen).toEqual([['.ohhi/layouts/mine.json']])
    expect(() => router.add('notes', () => {})).toThrow(/ignored app directory/)
  })

  it('MemVaultAdapter: a write under .ohhi reaches the app-dir listener and not watch()', async () => {
    const a = new MemVaultAdapter()
    const vaultEvents: WatchEvent[] = []
    const appEvents: string[][] = []
    a.watch((ev) => vaultEvents.push(ev))
    const stop = a.watchAppDir('.ohhi', (paths) => appEvents.push(paths))
    await a.writeAtomic('.ohhi/layouts/writing.json', enc.encode('{}'))
    await a.writeAtomic('.obsidian/app.json', enc.encode('{}'))
    await a.writeAtomic('note.md', enc.encode('hi'))
    expect(appEvents).toEqual([['.ohhi/layouts/writing.json']])
    expect(vaultEvents).toEqual([{ paths: ['note.md'] }])
    expect(await a.listAppDir('.ohhi/layouts')).toEqual(['.ohhi/layouts/writing.json'])
    stop()
    await a.writeAtomic('.ohhi/layouts/writing.json', enc.encode('{ }'))
    expect(appEvents).toHaveLength(1)
  })

  it('NodeVaultAdapter lists one app dir, skipping temp files and subdirectories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vault-appdir-'))
    try {
      const a = new NodeVaultAdapter(root)
      await a.writeAtomic('.ohhi/layouts/b.json', enc.encode('{}'))
      await a.writeAtomic('.ohhi/layouts/a.json', enc.encode('{}'))
      await a.writeAtomic('.ohhi/layouts/deeper/c.json', enc.encode('{}'))
      expect(await a.listAppDir('.ohhi/layouts')).toEqual(['.ohhi/layouts/a.json', '.ohhi/layouts/b.json'])
      expect(await a.listAppDir('.ohhi/keymaps')).toEqual([])
      expect((await a.list()).map((f) => f.path)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('NodeVaultAdapter lists the folders in one app dir — the theme folders — and nothing else', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vault-appdirs-'))
    try {
      const a = new NodeVaultAdapter(root)
      await a.writeAtomic('.ohhi/themes/nord-dark/theme.css', enc.encode('[data-theme="nord-dark"] {}'))
      await a.writeAtomic('.ohhi/themes/Paper/theme.css', enc.encode('[data-theme="Paper"] {}'))
      await a.writeAtomic('.ohhi/themes/stray.css', enc.encode(''))
      await a.mkdir('.ohhi/themes/empty')
      expect(await a.listAppDirs('.ohhi/themes')).toEqual([
        '.ohhi/themes/Paper',
        '.ohhi/themes/empty',
        '.ohhi/themes/nord-dark',
      ])
      expect(await a.listAppDirs('.ohhi/themes/')).toHaveLength(3)
      expect(await a.listAppDirs('.ohhi/layouts')).toEqual([])
      expect(await a.listAppDirs('.ohhi/themes/stray.css')).toEqual([])
      // Still invisible to the vault's own listings.
      expect((await a.list()).map((f) => f.path)).toEqual([])
      expect(await a.listDirs()).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('MemVaultAdapter lists app-dir folders the same way: made, or implied by a file under them', async () => {
    const a = new MemVaultAdapter()
    await a.writeAtomic('.ohhi/themes/nord-dark/theme.css', enc.encode(''))
    await a.writeAtomic('.ohhi/themes/deep/er/theme.css', enc.encode(''))
    await a.writeAtomic('.ohhi/themes/stray.css', enc.encode(''))
    await a.mkdir('.ohhi/themes/empty')
    expect(await a.listAppDirs('.ohhi/themes')).toEqual([
      '.ohhi/themes/deep',
      '.ohhi/themes/empty',
      '.ohhi/themes/nord-dark',
    ])
    expect(await a.listAppDirs('.ohhi/keymaps')).toEqual([])
  })

  it('L1: under a running session, .ohhi/** writes never reach pathToGuid, the map or a doc', async () => {
    const engine = createYjsEngine()
    const adapter = new MemVaultAdapter()
    await adapter.writeAtomic('a.md', enc.encode('hello\n'))
    const lcaStore = new MemLcaStore()
    const clock = new SimClock()
    const folderDoc = engine.createDoc('r/folder')
    const { docs } = await enrollFolder(engine, adapter, folderDoc, lcaStore)
    const activity: string[] = []
    const session = new VaultSession({
      engine,
      adapter,
      lcaStore,
      journal: new MemJournal(),
      clock,
      folderDoc,
      docs,
      events: { onActivity: (_guid, action) => activity.push(action) },
    })
    await session.start()
    const routed: string[] = []
    const stop = adapter.watchAppDir('.ohhi', (paths) => routed.push(...paths))

    // An app write, an external (agent / git) one, a theme, a rename inside it.
    await adapter.writeAtomic('.ohhi/layouts/writing.json', enc.encode('{"$schema":"ohhi.layout.v1"}'))
    adapter.externalWrite('.ohhi/themes/t/theme.css', enc.encode(':root{}'))
    await adapter.rename('.ohhi/layouts/writing.json', '.ohhi/layouts/writing-2.json')
    // …and one real note edited outside, so the session is demonstrably live.
    adapter.externalWrite('a.md', enc.encode('hello, edited\n'))
    for (let i = 0; i < 8; i++) {
      clock.advance(200)
      await new Promise((r) => setTimeout(r, 0))
    }

    expect(routed).toEqual([
      '.ohhi/layouts/writing.json',
      '.ohhi/themes/t/theme.css',
      '.ohhi/layouts/writing.json',
      '.ohhi/layouts/writing-2.json',
    ])
    const mapPaths = [...folderDoc.getMap().entries()].map(([p]) => p)
    expect(mapPaths.some((p) => p.startsWith('.ohhi'))).toBe(false)
    const pathToGuid = (session as unknown as { pathToGuid: Map<string, string> }).pathToGuid
    expect([...pathToGuid.keys()].some((p) => p.startsWith('.ohhi'))).toBe(false)
    expect(pathToGuid.has('a.md')).toBe(true)
    // The note edited in the same window WAS ingested — the session was listening.
    expect(activity).toContain('ingested')
    expect(docs.size).toBe(1)
    stop()
    session.dispose()
  })
})
