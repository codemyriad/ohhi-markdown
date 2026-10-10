/**
 * Spike S14 Q1/Q2 (`plans/spike-s14-agent-origin.md`): the in-app agent as a
 * second origin on the live doc.
 *
 * The binding's undo manager is mirrored exactly as `libs/editor` builds it:
 * `createUndoManager` is `new Y.UndoManager(ytext)` (default trackedOrigins
 * `{null}`), and `yCollab` adds its `YSyncConfig` object as a tracked origin
 * — a human keystroke is a transaction with THAT object as origin.
 */
import { MemStoreDir } from '@ohhi/vault'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { AgentRuns, isAgentOrigin, ytextOf, type AgentOrigin, type AppEvent } from '../src/index.js'
import { bootVault, seedAdapter } from './fixture.js'

const run = (runId: string, name = 'Tighten'): AgentOrigin => ({ kind: 'agent', runId, sessionId: 's1', name })

/** A doc bound as the editor binds it: the human's manager and the binding's origin. */
function boundDoc(text: string) {
  const doc = new Y.Doc()
  const ytext = ytextOf(doc)
  ytext.insert(0, text)
  const human = new Y.UndoManager(ytext) // createUndoManager(doc)
  const syncConf = { kind: 'y-sync-config' } // yCollab's YSyncConfig
  human.addTrackedOrigin(syncConf)
  const type = (index: number, s: string): void => doc.transact(() => ytext.insert(index, s), syncConf)
  return { doc, ytext, human, type }
}

describe('isAgentOrigin', () => {
  it('recognises an agent origin structurally (a record read back from JSON too)', () => {
    expect(isAgentOrigin(run('r1'))).toBe(true)
    expect(isAgentOrigin(JSON.parse(JSON.stringify(run('r1'))))).toBe(true)
    for (const o of [null, 'local', 'disk', { kind: 'agent' }, { kind: 'peer', runId: 'x', name: 'y' }]) {
      expect(isAgentOrigin(o)).toBe(false)
    }
  })
})

describe('AgentRuns (spike S14 Q1/Q2)', () => {
  it('hands out ONE frozen origin object per run, whatever copy asks', () => {
    const runs = new AgentRuns()
    const a = runs.origin(run('r1'))
    expect(runs.origin({ ...run('r1') })).toBe(a)
    expect(Object.isFrozen(a)).toBe(true)
    expect(runs.origin(run('r2'))).not.toBe(a)
  })

  it("Q1: the binding's undo manager never captures an agent transaction", () => {
    const { doc, ytext, human, type } = boundDoc('hello world')
    const runs = new AgentRuns()
    type(5, ',')
    expect(human.undoStack).toHaveLength(1)
    const origin = runs.track(run('r1'), ytext)
    doc.transact(() => ytext.insert(ytext.length, ' — agent'), origin)
    expect(human.undoStack).toHaveLength(1)
    // The human's Ctrl+Z takes back their comma and nothing of the agent's.
    human.undo()
    expect(ytext.toString()).toBe('hello world — agent')
    expect(human.undoStack).toHaveLength(0)
  })

  it("Q2: undoing a run removes only the agent's items, even after a human typed inside them", () => {
    const { doc, ytext, type } = boundDoc('The draft.')
    const runs = new AgentRuns()
    const origin = runs.track(run('r1'), ytext)
    // The agent replaces "draft" with "first version".
    doc.transact(() => {
      ytext.delete(4, 5)
      ytext.insert(4, 'first version')
    }, origin)
    expect(ytext.toString()).toBe('The first version.')
    // The human types INSIDE the agent's text.
    type(10, 'good ')
    expect(ytext.toString()).toBe('The first good version.')
    expect(runs.undo('r1')).toBe(true)
    // The agent's characters are gone and its deletion restored; the human's
    // typing is KEPT, whole. Where it lands is Yjs's positional answer: the
    // restored original goes back where it was (before the agent's insert,
    // which skipped past the deleted run), so the human's words follow it.
    expect(ytext.toString()).toBe('The draftgood .')
    expect(ytext.toString()).toContain('good ')
    expect(runs.undo('r1')).toBe(false)
  })

  it('a run spans docs; the last run with something to undo is the newest writer', () => {
    const one = boundDoc('one')
    const two = boundDoc('two')
    const runs = new AgentRuns()
    const o1 = runs.track(run('r1'), one.ytext)
    one.doc.transact(() => one.ytext.insert(3, '!'), o1)
    runs.track(run('r1'), two.ytext)
    two.doc.transact(() => two.ytext.insert(3, '!'), o1)
    const o2 = runs.track(run('r2'), one.ytext)
    one.doc.transact(() => one.ytext.insert(0, '> '), o2)
    expect(runs.lastRun()).toBe('r2')
    expect(runs.undo('r2')).toBe(true)
    expect(runs.lastRun()).toBe('r1')
    expect(runs.undo('r1')).toBe(true)
    expect([one.ytext.toString(), two.ytext.toString()]).toEqual(['one', 'two'])
    expect(runs.lastRun()).toBeNull()
  })

  it("a transaction under an origin the run's manager was not given is not captured", () => {
    const { doc, ytext } = boundDoc('abc')
    const runs = new AgentRuns()
    runs.track(run('r1'), ytext)
    // A fresh copy is a different object: only the canonical origin counts.
    doc.transact(() => ytext.insert(0, 'x'), { ...run('r1') })
    expect(runs.undo('r1')).toBe(false)
    expect(ytext.toString()).toBe('xabc')
  })
})

describe('MountSession: agent writes are logged as the agent (B3/B7 event log)', () => {
  it('accept logs doc.changed with actor agent, folds a run, and undoAgent takes it back', async () => {
    const base = await seedAdapter({ 'note.md': 'alpha beta gamma\n' })
    const vault = await bootVault(base, new MemStoreDir(), 'root-room')
    try {
      const s = vault.root
      const origin = run('r1', 'Tighten')
      const one = await s.proposeEdit({ path: 'note.md', from: 6, to: 10, baseText: 'beta', proposedText: 'BETA', origin })
      const two = await s.proposeEdit({ path: 'note.md', from: 0, to: 5, baseText: 'alpha', proposedText: 'Alpha', origin })
      // Proposing writes no text and logs nothing.
      expect(changes(s.roomEvents())).toHaveLength(0)
      expect(s.acceptSuggestion('note.md', one.id)).toMatchObject({ status: 'accepted', path: 'note.md' })
      expect(s.acceptSuggestion('note.md', two.id)?.status).toBe('accepted')
      expect(s.docForPath('note.md')!.getText()).toBe('Alpha BETA gamma\n')
      const logged = changes(s.roomEvents())
      expect(logged).toHaveLength(1)
      expect(logged[0]).toMatchObject({
        kind: 'doc.changed',
        actor: { kind: 'agent', name: 'Tighten' },
        scope: { path: 'note.md' },
        count: 2,
        payload: { added: 9, removed: 9 },
      })
      // A human edit is still never logged.
      const doc = s.docForPath('note.md')!
      doc.transact((t) => t.insert(doc.getText().length, 'mine\n'), 'local')
      expect(changes(s.roomEvents())).toHaveLength(1)
      expect(s.lastAgentRun()).toBe('r1')
      expect(s.undoAgent()).toBe(true)
      expect(s.docForPath('note.md')!.getText()).toBe('alpha beta gamma\nmine\n')
      expect(s.undoAgent('r1')).toBe(false)
    } finally {
      vault.dispose()
    }
  })

  it('a proposal against text the agent did not read is refused; an unknown path throws', async () => {
    const base = await seedAdapter({ 'note.md': 'alpha\n' })
    const vault = await bootVault(base, new MemStoreDir(), 'root-room')
    try {
      await expect(
        vault.root.proposeEdit({ path: 'note.md', from: 0, to: 5, baseText: 'omega', proposedText: 'x', origin: run('r1') })
      ).rejects.toThrow(/not the text the agent read/)
      await expect(
        vault.root.proposeEdit({ path: 'nope.md', from: 0, to: 0, baseText: '', proposedText: 'x', origin: run('r1') })
      ).rejects.toThrow(/no live doc/)
      expect(vault.root.suggestionsFor('nope.md')).toEqual([])
      expect(vault.root.acceptSuggestion('note.md', 'missing')).toBeNull()
      expect(vault.root.rejectSuggestion('note.md', 'missing')).toBe(false)
    } finally {
      vault.dispose()
    }
  })
})

function changes(events: AppEvent[]): AppEvent[] {
  return events.filter((e) => e.kind === 'doc.changed')
}
