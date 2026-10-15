// @vitest-environment jsdom
/**
 * The agent's suggestions in the shell over a real CM6
 * view bound to a real Y.Text: what the note shows, the five commands, and
 * spike S14 Q1 as the editor sees it — an agent transaction leaves the
 * human's caret where it belongs and their undo stack alone.
 */
import { createMarkdownEditor, createUndoManager, type MarkdownEditorHandle } from '@ohhi/editor'
import { getLL } from '@ohhi/i18n'
import { createYjsEngine, type EngineDoc } from '@ohhi/sync'
import {
  AgentRuns,
  memoryRecordMap,
  SuggestionStore,
  type AgentOrigin,
  type AppEvent,
  type SuggestionRecord,
} from '@ohhi/workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { event } from './readouts.fixture.js'
import { bindEditor, resetEditors } from './focused-editor.svelte.js'
import { lastAgentWrite, noteSuggestions, suggestionCommands, type SuggestionWorkspace } from './suggestions.svelte.js'

vi.mock('./ai-config.svelte.js', async (orig) => ({ ...(await orig<typeof import('./ai-config.svelte.js')>()), aiEnabled: () => true }))

// jsdom has no layout: CM6 measures text through Range rects.
const emptyRects = (): DOMRectList => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getClientRects ??= emptyRects
Range.prototype.getBoundingClientRect ??= () => new DOMRect()

const PATH = 'notes/plan.md'
const TEXT = 'The plan is to ship in March.\n'
const origin: AgentOrigin = { kind: 'agent', runId: 'r1', sessionId: 's1', name: 'Tighten' }
const t = getLL().web.ai.suggest

/** A facade over one doc's store — the same calls `MountSession` answers. */
function fixture(text = TEXT) {
  const doc: EngineDoc = createYjsEngine().createDoc('g1')
  doc.transact((tx) => tx.insert(0, text), 'local')
  const runs = new AgentRuns()
  const store = new SuggestionStore({ doc, records: memoryRecordMap(), runs })
  const flash = vi.fn()
  const withPath = (r: Omit<SuggestionRecord, 'path'>): SuggestionRecord => ({ ...r, path: PATH })
  const ws: SuggestionWorkspace = {
    suggestionSpans: () => store.spans(),
    subscribeSuggestions: (_p, cb) => store.subscribe(cb),
    acceptSuggestion: (_p, id) => {
      const r = store.accept(id)
      return r ? withPath(r) : null
    },
    rejectSuggestion: (_p, id) => store.reject(id),
    undoAgent: (runId) => {
      const id = runId ?? runs.lastRun()
      return id ? runs.undo(id) : false
    },
    flash,
  }
  let seq = 0
  const propose = (from: number, to: number, proposedText: string) =>
    store.propose({ id: `s${++seq}`, at: seq, from, to, baseText: doc.getText().slice(from, to), proposedText, origin })
  return { doc, store, ws, flash, propose, runs }
}

const views: MarkdownEditorHandle[] = []
function editorOver(f: ReturnType<typeof fixture>) {
  const parent = document.createElement('div')
  document.body.append(parent)
  const undoManager = createUndoManager(f.doc)
  const handle = createMarkdownEditor(parent, {
    doc: f.doc,
    awareness: null,
    user: { name: 'Ana', color: '#336699' },
    undoManager,
    extensions: [noteSuggestions(() => f.ws, () => PATH)],
  })
  views.push(handle)
  // What the pane does: its editor is the focused one.
  bindEditor({ paneId: 'p1', path: PATH, view: handle.view, focused: true })
  return { handle, view: handle.view, parent, undoManager }
}

const flushPush = (): Promise<void> => new Promise((r) => queueMicrotask(r))

function commands(f: ReturnType<typeof fixture>) {
  const rows = suggestionCommands(f.flash, () => f.ws)
  return (id: string) => rows.find((r) => r.id === id)!.run()
}

beforeEach(() => resetEditors())
afterEach(() => {
  for (const h of views.splice(0)) h.destroy()
  document.body.replaceChildren()
})

describe('suggestions in the note', () => {
  it('draws the base struck and the proposal inserted, and the document is untouched', async () => {
    const f = fixture()
    const { view, parent } = editorOver(f)
    f.propose(4, 8, 'roadmap')
    await flushPush()
    expect(parent.querySelector('del.ed-suggest-del')?.textContent).toBe('plan')
    expect(parent.querySelector('ins.ed-suggest-add')?.textContent).toBe('roadmap')
    expect(view.state.doc.toString()).toBe(TEXT)
    expect(f.doc.getText()).toBe(TEXT)
  })

  it('a human typing inside it makes it stale; accepting it then applies nothing and says so', async () => {
    const f = fixture()
    const { view, parent } = editorOver(f)
    f.propose(4, 8, 'roadmap')
    await flushPush()
    view.dispatch({ changes: { from: 6, insert: 'X' }, userEvent: 'input.type' })
    await flushPush()
    expect(parent.querySelector('.ed-suggest-stale')).not.toBeNull()
    view.dispatch({ selection: { anchor: 5 } })
    await commands(f)('ai.accept-suggestion')
    expect(f.flash).toHaveBeenCalledWith({ level: 'info', text: t.stale() })
    expect(f.doc.getText()).toBe('The plXan is to ship in March.\n')
  })
})

describe('spike S14 Q1 — the agent writes beside a human with yCollab bound', () => {
  it("keeps the human's caret on its character and leaves their undo stack alone", async () => {
    const f = fixture()
    const { view, undoManager } = editorOver(f)
    // The human types (the binding's origin) and parks the caret after "March".
    view.dispatch({ changes: { from: TEXT.length - 1, insert: '!' }, userEvent: 'input.type' })
    const caret = view.state.doc.toString().indexOf('!')
    view.dispatch({ selection: { anchor: caret } })
    expect(undoManager.undoStack).toHaveLength(1)

    const r = f.propose(4, 8, 'roadmap')
    expect(f.ws.acceptSuggestion(PATH, r.id)?.status).toBe('accepted')
    expect(view.state.doc.toString()).toBe('The roadmap is to ship in March.!\n')
    // "plan" → "roadmap" before the caret: it moved by exactly the difference.
    expect(view.state.selection.main.head).toBe(caret + 3)
    expect(view.state.doc.sliceString(view.state.selection.main.head, view.state.selection.main.head + 1)).toBe('!')
    // The human's Ctrl+Z is still theirs alone: it takes the "!" and nothing of the agent's.
    expect(undoManager.undoStack).toHaveLength(1)
    undoManager.undo()
    expect(f.doc.getText()).toBe('The roadmap is to ship in March.\n')
    // …and *Undo the agent's edit* takes the agent's, and nothing of the human's.
    view.dispatch({ changes: { from: 0, insert: '# ' }, userEvent: 'input.type' })
    await commands(f)('ai.undo-agent')
    expect(f.doc.getText()).toBe('# The plan is to ship in March.\n')
    expect(f.flash).toHaveBeenLastCalledWith({ level: 'info', text: t.undone() })
  })
})

describe('the commands', () => {
  it('accept/reject at the caret, and say so when the caret is in none', async () => {
    const f = fixture()
    const { view } = editorOver(f)
    const run = commands(f)
    const a = f.propose(4, 8, 'roadmap')
    const b = f.propose(15, 19, 'land')
    await flushPush()
    view.dispatch({ selection: { anchor: 0 } })
    await run('ai.accept-suggestion')
    expect(f.flash).toHaveBeenLastCalledWith({ level: 'info', text: t.none_at_caret() })
    view.dispatch({ selection: { anchor: 6 } })
    await run('ai.accept-suggestion')
    expect(f.doc.getText()).toBe('The roadmap is to ship in March.\n')
    await flushPush()
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('ship') + 1 } })
    await run('ai.reject-suggestion')
    expect(f.store.list().map((r) => [r.id, r.status])).toEqual([[a.id, 'accepted']])
    expect(f.doc.getText()).toBe('The roadmap is to ship in March.\n')
    expect(b.id).toBeTruthy()
  })

  it('accept-all applies the pending ones and counts the stale; reject-all clears the note', async () => {
    const f = fixture()
    const { view } = editorOver(f)
    const run = commands(f)
    f.propose(4, 8, 'roadmap')
    f.propose(15, 19, 'land')
    f.propose(23, 29, 'May.')
    await flushPush()
    view.dispatch({ changes: { from: 25, insert: 'x' }, userEvent: 'input.type' }) // stales "March."
    await flushPush()
    await run('ai.accept-all')
    expect(f.flash).toHaveBeenLastCalledWith({ level: 'info', text: t.accepted_some({ count: 2, stale: 1 }) })
    expect(f.doc.getText()).toBe('The roadmap is to land in Maxrch.\n')
    await flushPush()
    await run('ai.reject-all')
    expect(f.flash).toHaveBeenLastCalledWith({ level: 'info', text: t.rejected_all({ count: 1 }) })
    await flushPush()
    await run('ai.reject-all')
    expect(f.flash).toHaveBeenLastCalledWith({ level: 'info', text: t.none_in_note() })
    await run('ai.accept-all')
    expect(f.flash).toHaveBeenLastCalledWith({ level: 'info', text: t.none_in_note() })
  })

  it('undo-agent with nothing to undo says so; every row is gated on a provider', async () => {
    const f = fixture()
    editorOver(f)
    await commands(f)('ai.undo-agent')
    expect(f.flash).toHaveBeenLastCalledWith({ level: 'info', text: t.nothing_to_undo() })
    const rows = suggestionCommands(undefined, () => null)
    expect(rows.map((r) => r.id)).toEqual([
      'ai.accept-suggestion',
      'ai.reject-suggestion',
      'ai.accept-all',
      'ai.reject-all',
      'ai.next-suggestion',
      'ai.previous-suggestion',
      'ai.undo-agent',
    ])
    // Stepping ships unbound (Explorations Fork 4: no default keys until Chris picks them).
    expect(rows.filter((r) => /^ai\.(next|previous)-suggestion$/.test(r.id)).map((r) => r.keys)).toEqual([undefined, undefined])
    // The note-wide rows need only a provider; the two caret rows also need the caret in a suggestion (below).
    expect(rows.slice(2).every((r) => r.when?.() === true)).toBe(true)
  })

  it('accept/reject at the caret carry Mod+Enter / Mod+Backspace, offered only while the caret is in a suggestion', async () => {
    const f = fixture()
    const { view } = editorOver(f)
    const rows = suggestionCommands(f.flash, () => f.ws)
    const accept = rows.find((r) => r.id === 'ai.accept-suggestion')!
    const reject = rows.find((r) => r.id === 'ai.reject-suggestion')!
    expect(accept.keys).toBe('Mod+Enter')
    expect(reject.keys).toBe('Mod+Backspace')
    // No suggestion in the note: the rows are off, so the registry leaves the
    // keys to CodeMirror (`Mod-Enter` is its blank line).
    expect(accept.when?.()).toBe(false)
    expect(reject.when?.()).toBe(false)
    f.propose(4, 8, 'roadmap')
    await flushPush()
    view.dispatch({ selection: { anchor: 0 } })
    expect(accept.when?.()).toBe(false)
    view.dispatch({ selection: { anchor: 5 } })
    expect(accept.when?.()).toBe(true)
    expect(reject.when?.()).toBe(true)
    await accept.run()
    expect(f.doc.getText()).toBe('The roadmap is to ship in March.\n')
    expect(accept.when?.()).toBe(false)
  })
})

describe('the pair on a proposal, and stepping', () => {
  /** An editor whose pair runs commands through `run` (as the pane's does through the shell). */
  function controlled(f: ReturnType<typeof fixture>, run: (id: string) => void) {
    const parent = document.createElement('div')
    document.body.append(parent)
    const handle = createMarkdownEditor(parent, {
      doc: f.doc,
      awareness: null,
      user: { name: 'Ana', color: '#336699' },
      undoManager: createUndoManager(f.doc),
      extensions: [noteSuggestions(() => f.ws, () => PATH, { run, keys: (id) => (id === 'ai.accept-suggestion' ? 'Ctrl+Enter' : '') })],
    })
    views.push(handle)
    bindEditor({ paneId: 'p1', path: PATH, view: handle.view, focused: true })
    return { view: handle.view, parent }
  }

  it('draws a named pair on the current proposal; a press puts the caret in it and runs the registry row', async () => {
    const f = fixture()
    const rows = suggestionCommands(f.flash, () => f.ws)
    const ran: string[] = []
    // The pane's `run`: the registry's row, as `ViewShell.runCommand` would run it.
    const { view, parent } = controlled(f, (id) => {
      ran.push(id)
      void rows.find((r) => r.id === id && (!r.when || r.when()))?.run()
    })
    f.propose(15, 19, 'land')
    await flushPush()
    view.dispatch({ selection: { anchor: 0 } })
    const pair = parent.querySelector<HTMLElement>('[data-testid="suggestion-pair"]')!
    expect(pair).not.toBeNull()
    expect(pair.getAttribute('aria-label')).toBe(t.pair({ name: 'Tighten' }))
    const accept = pair.querySelector<HTMLButtonElement>('[data-testid="suggestion-accept"]')!
    expect(accept.textContent).toBe(`${t.accept()}Ctrl+Enter`)
    expect(pair.querySelector('[data-testid="suggestion-reject"]')?.textContent).toBe(t.reject())
    accept.click()
    expect(ran).toEqual(['ai.accept-suggestion'])
    expect(f.doc.getText()).toBe('The plan is to land in March.\n')
  })

  it('without the registry the pair accepts and rejects through the host', async () => {
    const f = fixture()
    const { parent } = editorOver(f)
    f.propose(4, 8, 'roadmap')
    await flushPush()
    parent.querySelector<HTMLButtonElement>('[data-testid="suggestion-reject"]')!.click()
    await flushPush()
    expect(f.store.spans()).toEqual([])
    expect(f.doc.getText()).toBe(TEXT)
  })

  it('a gutter mark per proposal moves the caret to it', async () => {
    const f = fixture('one\ntwo\nthree\n')
    const { view, parent } = editorOver(f)
    f.propose(4, 7, '2')
    const b = f.propose(8, 13, '3')
    await flushPush()
    const marks = parent.querySelectorAll<HTMLButtonElement>('[data-testid^="suggestion-marker:"]')
    expect([...marks].map((m) => m.textContent)).toEqual(['1', '2'])
    expect(marks[1].getAttribute('aria-label')).toBe(t.marker({ n: 2, total: 2, name: 'Tighten' }))
    parent.querySelector<HTMLButtonElement>(`[data-testid="suggestion-marker:${b.id}"]`)!.click()
    expect(view.state.selection.main.head).toBe(8)
  })

  it('next / previous step the caret through the note’s proposals, wrapping; none says so', async () => {
    const f = fixture()
    const { view } = editorOver(f)
    const run = commands(f)
    await run('ai.next-suggestion')
    expect(f.flash).toHaveBeenLastCalledWith({ level: 'info', text: t.none_in_note() })
    f.propose(4, 8, 'roadmap')
    f.propose(15, 19, 'land')
    await flushPush()
    view.dispatch({ selection: { anchor: 0 } })
    await run('ai.next-suggestion')
    expect(view.state.selection.main.head).toBe(4)
    await run('ai.next-suggestion')
    expect(view.state.selection.main.head).toBe(15)
    await run('ai.next-suggestion')
    expect(view.state.selection.main.head).toBe(4)
    await run('ai.previous-suggestion')
    expect(view.state.selection.main.head).toBe(15)
  })
})

describe('lastAgentWrite', () => {
  it("is the newest agent doc.changed in the log, never a peer's or a disk ingest", () => {
    const events: AppEvent[] = [
      event({ kind: 'doc.changed', at: 30, scope: { path: 'b.md' }, actor: { kind: 'peer', name: 'Sam' }, payload: { guid: 'g' } }),
      event({ kind: 'doc.changed', at: 20, scope: { path: 'a.md' }, actor: { kind: 'agent', name: 'Tighten' }, payload: { guid: 'g' } }),
      event({ kind: 'doc.changed', at: 10, scope: { path: 'c.md' }, actor: { kind: 'agent', name: 'Old' }, payload: { guid: 'g' } }),
    ]
    expect(lastAgentWrite(events)).toEqual({ name: 'Tighten', path: 'a.md', at: 20 })
    expect(lastAgentWrite(events.slice(0, 1))).toBeNull()
    expect(lastAgentWrite([event({ kind: 'doc.changed', at: 1, scope: { path: 'd.md' }, actor: { kind: 'disk' }, payload: { guid: 'g' } })])).toBeNull()
  })
})
