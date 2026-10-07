/**
 * Yjs implementation of the engine seam. The ONLY module (with its tests)
 * that imports `yjs`. Pinned to Yjs 13.6.x — see plans/shaping.md D1 for the
 * v14 migration / Loro swap gates.
 */
import * as Y from 'yjs'
import type {
  EngineDoc,
  FileEntry,
  Heads,
  MapHandle,
  Origin,
  SyncEngine,
  TextHandle,
} from './engine.js'

const TEXT_KEY = 'content'
const MAP_KEY = 'files'

class YjsDoc implements EngineDoc {
  readonly guid: string
  readonly ydoc: Y.Doc

  constructor(guid: string) {
    this.guid = guid
    this.ydoc = new Y.Doc({ guid })
  }

  getText(): string {
    return this.ydoc.getText(TEXT_KEY).toString()
  }

  transact(fn: (text: TextHandle) => void, origin: Origin): void {
    const ytext = this.ydoc.getText(TEXT_KEY)
    this.ydoc.transact(() => {
      fn({
        insert: (index, text) => ytext.insert(index, text),
        delete: (index, length) => ytext.delete(index, length),
      })
    }, origin)
  }

  getMap(): MapHandle {
    return wrapMap(this.ydoc, this.ydoc.getMap<FileEntry>(MAP_KEY))
  }

  transactMap(fn: (map: MapHandle) => void, origin: Origin): void {
    const handle = this.getMap()
    this.ydoc.transact(() => fn(handle), origin)
  }

  raw(): unknown {
    return this.ydoc
  }

  destroy(): void {
    this.ydoc.destroy()
  }
}

function wrapMap(ydoc: Y.Doc, ymap: Y.Map<FileEntry>): MapHandle {
  return {
    get: (key) => ymap.get(key),
    set: (key, value) => ymap.set(key, value),
    delete: (key) => ymap.delete(key),
    entries: () => [...ymap.entries()] as [string, FileEntry][],
    observe: (cb) => {
      const handler = (_ev: Y.YMapEvent<FileEntry>, txn: Y.Transaction) =>
        cb(txn.origin)
      ymap.observe(handler)
      return () => ymap.unobserve(handler)
    },
  }
}

function asYjsDoc(doc: EngineDoc): YjsDoc {
  if (!(doc instanceof YjsDoc)) {
    throw new Error('engine mismatch: doc was not created by the Yjs engine')
  }
  return doc
}

/** Binary layout: [u32le svLen][sv][snapshot]. */
function packHeads(h: Heads): Uint8Array {
  const out = new Uint8Array(4 + h.sv.length + h.snapshot.length)
  new DataView(out.buffer).setUint32(0, h.sv.length, true)
  out.set(h.sv, 4)
  out.set(h.snapshot, 4 + h.sv.length)
  return out
}

function unpackHeads(bytes: Uint8Array): Heads {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const svLen = view.getUint32(0, true)
  return {
    sv: bytes.slice(4, 4 + svLen),
    snapshot: bytes.slice(4 + svLen),
  }
}

export function createYjsEngine(): SyncEngine {
  return {
    createDoc: (guid) => new YjsDoc(guid),

    applyUpdate: (doc, update, origin = 'remote') => {
      Y.applyUpdate(asYjsDoc(doc).ydoc, update, origin)
    },

    encodeUpdateSince: (doc, since) =>
      since === null
        ? Y.encodeStateAsUpdate(asYjsDoc(doc).ydoc)
        : Y.encodeStateAsUpdate(asYjsDoc(doc).ydoc, since.sv),

    heads: (doc) => {
      const ydoc = asYjsDoc(doc).ydoc
      return {
        sv: Y.encodeStateVector(ydoc),
        snapshot: Y.encodeSnapshot(Y.snapshot(ydoc)),
      }
    },

    headsEqual: (a, b) =>
      Y.equalSnapshots(Y.decodeSnapshot(a.snapshot), Y.decodeSnapshot(b.snapshot)),

    encodeHeads: packHeads,
    decodeHeads: unpackHeads,

    clientIdsOf: (update) => [...Y.parseUpdateMeta(update).to.keys()].sort((a, b) => a - b),

    charDeltaOf: (update) => {
      const { structs, ds } = Y.decodeUpdate(update)
      let added = 0
      for (const s of structs) {
        if (s instanceof Y.Item && s.content instanceof Y.ContentString) added += s.length
      }
      let removed = 0
      for (const items of ds.clients.values()) for (const d of items) removed += d.len
      return { added, removed }
    },

    clientIdOf: (doc) => asYjsDoc(doc).ydoc.clientID,

    onUpdate: (doc, cb) => {
      const ydoc = asYjsDoc(doc).ydoc
      const handler = (update: Uint8Array, origin: unknown) => cb(update, origin)
      ydoc.on('update', handler)
      return () => ydoc.off('update', handler)
    },
  }
}
