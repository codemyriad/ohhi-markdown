// @vitest-environment jsdom
/**
 * The pane over a collection's moving parts (the collections integration
 * review): the real membership tracker on a SimClock, the real index, real
 * Yjs docs and the real editor, with only the vault's bookkeeping faked.
 *
 *  - A row-note renamed keeps its properties form through the remount: the
 *    tracker carries the answer to the new path, so the view on the new path
 *    draws the form at once instead of flashing the strip, and the old path
 *    keeps no answer a later note there could inherit.
 *  - The folder its collection reads renamed, with the `.base` rewritten as
 *    `relocate` does it: the collection still has the note, and the form stays
 *    once the tracker re-asks.
 *  - An embedded collection whose `.base` moves while the embed's text stays
 *    put follows it: the pane refreshes the preview when the path set moves.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import { flushSync } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyLinkEdits, MemoryIndex } from '@ohhi/index'
import { planCollectionMoves } from '@ohhi/collections'
import { createYjsEngine, type EngineDoc } from '@ohhi/sync'
import { SimClock } from '@ohhi/testkit'
import { createMembership } from '../collection-membership.svelte.js'
import { DENSE_CHROME } from '../pane-chrome.js'
import { newTab, type Pane as PaneNode } from '../panes.js'
import { fakeViewShell } from '../readouts.fixture.js'
import { viewShellContext } from '../views.js'
import type { PaneShell } from '../workspace-panes.svelte.js'
import type { Workspace } from '../workspace.svelte.js'
import Pane from './Pane.svelte'

afterEach(() => cleanup())

const BASE = 'filters:\n  and:\n    - file.inFolder("Competitors")\nviews:\n  - type: table\n    name: All\n    order:\n      - file.name\n'
const ROW = '---\nthreat: direct\n---\n\n# Ingredifind\n'

function vault(files: Record<string, string>) {
  const engine = createYjsEngine()
  const docs = new Map<string, EngineDoc>()
  const guids = new Map<string, string>()
  const index = new MemoryIndex()
  const ui = $state({ files: [] as { path: string; guid: string; kind: 'text' }[], records: {}, presenceByPath: {} })
  const clock = new SimClock()
  let n = 0
  const listFiles = (): void => {
    ui.files = [...docs.keys()].sort().map((path) => ({ path, guid: guids.get(path)!, kind: 'text' as const }))
  }
  for (const [path, text] of Object.entries(files)) {
    const guid = `g${n++}`
    const doc = engine.createDoc(guid)
    doc.transact((t) => t.insert(0, text), 'local')
    docs.set(path, doc)
    guids.set(path, guid)
    index.upsert({ guid, path, text })
  }
  listFiles()
  const membership = createMembership({
    index: () => index,
    clock,
    paths: () => ui.files.map((f) => f.path),
    textOf: (path) => docs.get(path)?.getText() ?? null,
  })
  const workspace = {
    ui,
    user: { name: 'Test', color: '#888888' },
    docForPath: (path: string) => docs.get(path) ?? null,
    awarenessForPath: () => null,
    undoManagerFor: () => null,
    readAttachment: async () => null,
    focus: () => {},
    flash: () => {},
    createFile: async () => null,
    // The writing harness's seams on a note: no agent here, so nothing pending.
    suggestionSpans: () => [],
    subscribeSuggestions: () => () => {},
    threadsFor: () => null,
  } as unknown as Workspace

  /** A rename as the shell learns of it: index, tracker, tree — then the tab follows. */
  function rename(from: string, to: string, pane: PaneNode): void {
    for (const path of [...docs.keys()]) {
      const next = path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : null
      if (next === null) continue
      docs.set(next, docs.get(path)!)
      guids.set(next, guids.get(path)!)
      docs.delete(path)
      guids.delete(path)
      index.rename(guids.get(next)!, next)
    }
    membership.renamed(from, to)
    listFiles()
    for (const tab of pane.tabs) {
      if (tab.path === from) tab.path = to
      else if (tab.path?.startsWith(`${from}/`)) tab.path = `${to}${tab.path.slice(from.length)}`
    }
  }

  /** What the shell was asked to open — the embed's caption opens the collection it is showing. */
  const opened = vi.fn()
  return { docs, index, ui, clock, membership, workspace, rename, opened }
}

function mountPane(v: ReturnType<typeof vault>, path: string) {
  // The caret at the end, off the frontmatter: a caret inside it shows the YAML, not the form.
  const end = v.docs.get(path)!.getText().length
  const pane = $state<PaneNode>({
    kind: 'pane',
    id: 'p1',
    tabs: [newTab(() => 't1', path, { anchor: end, head: end })],
    groups: [],
    active: 't1',
  })
  const panes = {
    layout: { tree: pane, focus: 'p1', zoom: null },
    mode: null,
    paneIndex: () => 1,
    modeOf: () => 'live',
    label: () => 'Pane 1',
    registerPane: () => {},
    registerEditor: () => {},
    registerCapture: () => {},
    setResume: (tabId: string, resume: { cursor: { anchor: number; head: number }; scroll: number }) => {
      const tab = pane.tabs.find((t) => t.id === tabId)
      if (tab) Object.assign(tab, resume)
    },
    navigate: () => {},
    focusPane: () => {},
    hoverExternal: () => {},
    leaveExternal: () => {},
    dropExternal: () => {},
    sync: () => {},
  } as unknown as PaneShell
  const shell = fakeViewShell(0, { index: () => v.index, membership: v.membership, clock: v.clock, openPath: v.opened })
  render(Pane, {
    props: {
      pane,
      focused: true,
      panes,
      workspace: v.workspace,
      dark: false,
      inlineTitle: false,
      chrome: { ...DENSE_CHROME, tabs: 'auto', statusbar: 'merged' },
      search: async () => [],
      recent: () => [],
      newNote: () => {},
      openQuick: () => {},
      resolveLink: (target: string) => resolveIn(v, target),
      createFromLink: () => {},
      linkCandidates: () => [],
      searchTag: () => {},
      tags: () => [],
      reveal: null,
    },
    context: viewShellContext(shell),
  })
  return pane
}

/** The shell's resolver, cut down: an exact path, else a unique basename. */
function resolveIn(v: ReturnType<typeof vault>, target: string): string | null {
  const paths = v.ui.files.map((f) => f.path)
  if (paths.includes(target)) return target
  const named = paths.filter((p) => p.slice(p.lastIndexOf('/') + 1) === target)
  return named.length === 1 ? named[0] : null
}

describe('Pane — collections across renames', () => {
  it('a renamed row-note draws its form at once on the new path, and the old path keeps no answer', async () => {
    const v = vault({ 'Competitors.base': BASE, 'Competitors/Ingredifind.md': ROW })
    const pane = mountPane(v, 'Competitors/Ingredifind.md')
    await waitFor(() => expect(screen.getByTestId('properties-form')).toBeTruthy())

    v.rename('Competitors/Ingredifind.md', 'Competitors/Ingredifind Ltd.md', pane)
    flushSync()
    // No await: the remounted view on the new path has its form already.
    expect(screen.getByTestId('properties-form')).toBeTruthy()
    expect(v.membership.isMember('Competitors/Ingredifind.md')).toBe(false)
  })

  it('renaming the folder the collection reads, with its .base rewritten as relocate does, keeps the row a row', async () => {
    const v = vault({ 'Competitors.base': BASE, 'Competitors/Ingredifind.md': ROW })
    const pane = mountPane(v, 'Competitors/Ingredifind.md')
    await waitFor(() => expect(screen.getByTestId('properties-form')).toBeTruthy())

    const plan = planCollectionMoves([{ path: 'Competitors.base', text: BASE }], 'Competitors', 'Rivals', v.ui.files.map((f) => f.path))
    v.rename('Competitors', 'Rivals', pane)
    for (const note of plan) {
      const doc = v.docs.get(note.path)!
      const next = applyLinkEdits(doc.getText(), note.edits)!
      doc.transact((t) => {
        t.delete(0, doc.getText().length)
        t.insert(0, next)
      }, 'local')
      v.index.upsert({ guid: 'g0', path: note.path, text: next })
    }
    flushSync()
    expect(v.docs.get('Competitors.base')!.getText()).toContain('file.inFolder("Rivals")')
    // The tracker re-asks on the clock; the answer holds.
    v.membership.invalidate()
    v.clock.advance(1000)
    await new Promise((r) => queueMicrotask(() => r(null)))
    await waitFor(() => expect(v.membership.isMember('Rivals/Ingredifind.md')).toBe(true))
    expect(screen.getByTestId('properties-form')).toBeTruthy()
  })

  it('an embedded collection follows its .base when it moves and the embed text does not change', async () => {
    const v = vault({
      'Competitors.base': BASE,
      'Competitors/Ingredifind.md': ROW,
      'Notes/Embed.md': '# Embed\n\nText.\n\n![[Competitors.base]]\n',
    })
    const pane = mountPane(v, 'Notes/Embed.md')
    await waitFor(() => expect(screen.getByTestId('collection-table').textContent).toContain('Ingredifind'))

    // The .base moves between folders: `![[Competitors.base]]` still resolves, to the new path.
    screen.getByTestId('collection-embed-open').click()
    expect(v.opened).toHaveBeenLastCalledWith('Competitors.base', expect.anything())
    v.rename('Competitors.base', 'Archive/Competitors.base', pane)
    flushSync()
    // The embed now shows (and opens) the collection where it is.
    screen.getByTestId('collection-embed-open').click()
    expect(v.opened).toHaveBeenLastCalledWith('Archive/Competitors.base', expect.anything())
    await waitFor(() => expect(screen.getByTestId('collection-table').textContent).toContain('Ingredifind'))
  })

  // Finding 5 of the review: relocate edits the moved note's own links right
  // after the rename, around the {#key} remount. Whichever side of the remount
  // the edit lands on, the caret is mapped through it — the live view's
  // binding maps it (before: the old view, whose capture then holds the
  // mapped caret; after: the new view, restored first) — so the resume point
  // never predates the edit.
  for (const order of ['edit after the remount', 'edit before the remount'] as const) {
    it(`a note that links to itself keeps its caret through the rename and its own link's rewrite (${order})`, async () => {
      const text = 'See [[Self]] here.\nThe end.'
      const v = vault({ 'Notes/Self.md': text, 'Other.md': 'x' })
      const pane = mountPane(v, 'Notes/Self.md')
      const doc = v.docs.get('Notes/Self.md')!
      const edit = (): void => {
        // `[[Self]]` → `[[Myself]]`: two bytes longer, before the caret.
        const at = doc.getText().indexOf('Self]]')
        doc.transact((t) => {
          t.delete(at, 4)
          t.insert(at, 'Myself')
        }, 'local')
      }
      v.rename('Notes/Self.md', 'Notes/Myself.md', pane)
      if (order === 'edit before the remount') edit()
      flushSync()
      if (order === 'edit after the remount') edit()
      // Leave the note: the teardown captures the caret.
      pane.tabs[0].path = 'Other.md'
      flushSync()
      expect(pane.tabs[0].cursor).toEqual({ anchor: text.length + 2, head: text.length + 2 })
    })
  }
})
