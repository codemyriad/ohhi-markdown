/**
 * A comment or a suggestion record is not a text change: the doc's
 * `comments` / `suggestions` maps ride the note's Y.Doc, so every write to
 * them is a doc update, and none of them may re-index the note, mark it
 * unwritten, flush identical bytes or log `doc.changed`.
 *
 * The rule: an update that does not touch the note's `content` Y.Text leaves
 * the text path alone — whoever wrote it, locally or a peer.
 */
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemStoreDir } from '@ohhi/vault'
import type { SyncRecordFields } from '../src/types.js'
import { COMMENTS_ORIGIN } from '../src/threads.js'
import { ydocOf } from '../src/anchors.js'
import { bootVault, seedAdapter, watchWrites, yieldMacro } from './fixture.js'

const origin = { kind: 'agent' as const, runId: 'r1', sessionId: 's1', name: 'Agent' }

async function drain(turns = 12): Promise<void> {
  for (let i = 0; i < turns; i++) await yieldMacro()
}

async function boot() {
  const adapter = await seedAdapter({ 'note.md': 'alpha beta\n' })
  const records = new Map<string, SyncRecordFields>()
  const changed: unknown[] = []
  const vault = await bootVault(adapter, new MemStoreDir(), 'root-room', {
    rootRelay: { url: 'ws://relay.test', token: 't' },
    sessionDefaults: () => ({
      recordFor: (key: string) => {
        let rec = records.get(key)
        if (!rec) {
          rec = { connected: false, synced: false, pendingLocal: false, diskMatchesCrdt: true, diverged: false }
          records.set(key, rec)
        }
        return rec
      },
      events: { onDocChanged: (_guid: string, path: string, o: unknown) => changed.push([path, o]) },
    }),
  })
  const s = vault.root
  s.setOpenPaths(new Set(['note.md']))
  await drain()
  const doc = s.docForPath('note.md')!
  const guid = s.files().find((r) => r.path === 'note.md')!.guid!
  const writes = watchWrites(adapter)
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) {
      vault.clock.advance(1_000)
      await drain()
    }
  }
  const docChanged = () => s.roomEvents().filter((e) => e.kind === 'doc.changed')
  return { vault, s, doc, record: () => records.get(guid)!, changed, writes, settle, docChanged }
}

describe('MountSession: comment and suggestion writes are not text changes', () => {
  it('a local comment write: no doc.changed, the note stays written, nothing is flushed or re-indexed', async () => {
    const t = await boot()
    try {
      const ydoc = ydocOf(t.doc)
      ydoc.transact(() => ydoc.getMap('comments').set('t:1', { id: 't:1', body: 'hm' }), COMMENTS_ORIGIN)
      await t.settle()
      expect(t.changed).toEqual([])
      expect(t.record().diskMatchesCrdt).toBe(true)
      expect(t.writes.paths).toEqual([])
      expect(t.docChanged()).toEqual([])
    } finally {
      t.vault.dispose()
    }
  })

  it('a peer resolving a thread: no doc.changed is logged for it', async () => {
    const t = await boot()
    try {
      const ydoc = ydocOf(t.doc)
      const peer = new Y.Doc()
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(ydoc))
      const before = Y.encodeStateVector(ydoc)
      peer.transact(() => {
        peer.getMap('comments').set('t:1', { id: 't:1', resolved: false })
        peer.getMap('comments').set('t:1', { id: 't:1', resolved: true }) // an overwrite: a delete in the update
      }, COMMENTS_ORIGIN)
      t.vault.engine.applyUpdate(t.doc, Y.encodeStateAsUpdate(peer, before), 'remote')
      await t.settle()
      expect(t.docChanged()).toEqual([])
      expect(t.changed).toEqual([])
      expect(t.writes.paths).toEqual([])
    } finally {
      t.vault.dispose()
    }
  })

  it('an agent proposal (a record only) is not a text change; accepting it is', async () => {
    const t = await boot()
    try {
      const r = await t.s.proposeEdit({ path: 'note.md', from: 0, to: 5, baseText: 'alpha', proposedText: 'ALPHA', origin })
      await t.settle()
      expect(t.changed).toEqual([])
      expect(t.writes.paths).toEqual([])
      t.s.acceptSuggestion('note.md', r.id)
      await t.settle()
      expect(t.changed[0]).toEqual(['note.md', expect.objectContaining({ kind: 'agent' })])
      expect(t.docChanged()).toMatchObject([{ actor: { kind: 'agent', name: 'Agent' } }])
      expect(t.writes.paths).toEqual(['note.md'])
      expect(t.record().diskMatchesCrdt).toBe(true)
    } finally {
      t.vault.dispose()
    }
  })

  it('control: a peer typing is still a text change, logged and flushed', async () => {
    const t = await boot()
    try {
      const ydoc = ydocOf(t.doc)
      const peer = new Y.Doc()
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(ydoc))
      const before = Y.encodeStateVector(ydoc)
      peer.getText('content').insert(0, 'x')
      t.vault.engine.applyUpdate(t.doc, Y.encodeStateAsUpdate(peer, before), 'remote')
      await t.settle()
      expect(t.changed[0]).toEqual(['note.md', 'remote'])
      expect(t.docChanged()).toHaveLength(1)
      expect(t.writes.paths).toEqual(['note.md'])
    } finally {
      t.vault.dispose()
    }
  })
})
