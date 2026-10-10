/**
 * Test fakes for the writing harness, shared by its tests: the `.ohhi/`
 * app-file seam over a Map, and one note's comment-thread registry over a
 * real Yjs doc.
 */
import { createYjsEngine, type EngineDoc } from '@ohhi/sync'
import { SimClock } from '@ohhi/testkit'
import type { ThreadFiles } from '@ohhi/workspace'
import type { VaultAppFiles } from './session-store.js'
import { createThreadRegistry } from './threads.svelte.js'

/** The app-file seam over a Map, as `.ohhi/` would hold it; `writes` lists every write's path. */
export function memAppFiles(seed: Record<string, string> = {}): VaultAppFiles & { files: Map<string, string>; writes: string[] } {
  const files = new Map(Object.entries(seed))
  const writes: string[] = []
  return {
    files,
    writes,
    readAppFile: async (path) => files.get(path) ?? null,
    writeAppFile: async (path, text) => {
      writes.push(path)
      files.set(path, text)
    },
    listAppDir: async (dir) => [...files.keys()].filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')),
  }
}

/** A Yjs doc holding `text`. */
export function docWith(text: string, guid = 'g1'): EngineDoc {
  const doc = createYjsEngine().createDoc(guid)
  doc.transact((t) => t.insert(0, text), 'local')
  return doc
}

/**
 * One note (`path`, guid `g1`) with `text`, and the thread registry over it.
 * `doc.current` may be swapped (a rebuilt doc) or nulled (the note closed).
 */
export function threadsFixture(opts: { text: string; path: string; clock?: SimClock }) {
  const doc: { current: EngineDoc | null } = { current: docWith(opts.text) }
  const store = new Map<string, string>()
  const files: ThreadFiles & { store: Map<string, string> } = {
    store,
    read: async (p) => store.get(p) ?? null,
    write: async (p, t) => void store.set(p, t),
  }
  const clock = opts.clock ?? new SimClock()
  const registry = createThreadRegistry({
    clock,
    docForPath: (p) => (p === opts.path ? doc.current : null),
    guidFor: (p) => (p === opts.path ? 'g1' : null),
    pathFor: () => opts.path,
    files,
  })
  return { doc, registry, files, clock }
}
