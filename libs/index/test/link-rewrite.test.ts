/**
 * Renames follow (collections DB6): the planner decides which links a move
 * breaks and how to mend each one with a byte edit; the applier refuses
 * to guess. Driven through a real `MemoryIndex` so the offsets under test
 * are the ones the index actually hands out.
 */
import { describe, expect, it } from 'vitest'
import { MemoryIndex } from '../src/memory-index.js'
import {
  applyLinkEdits,
  collectMoveRefs,
  pathsAfterMove,
  planLinkRewrites,
  type LinkRewrite,
} from '../src/link-rewrite.js'
import type { LinkRef } from '../src/types.js'

type Vault = Record<string, string>

function indexOf(vault: Vault): MemoryIndex {
  const index = new MemoryIndex()
  index.rebuild(Object.entries(vault).map(([path, text]) => ({ guid: `g:${path}`, path, text })))
  return index
}

/** Plan a move over `vault` (every key a text file) plus `extraFiles` (binaries the index never sees). */
async function plan(vault: Vault, from: string, to: string, extraFiles: string[] = []): Promise<LinkRewrite[]> {
  const index = indexOf(vault)
  const paths = [...Object.keys(vault), ...extraFiles]
  const refs = await collectMoveRefs(index, paths, from)
  return planLinkRewrites(refs, from, to, paths)
}

/** The vault after the plan is applied — what the app and the CLI both produce. */
async function after(vault: Vault, from: string, to: string, extraFiles: string[] = []): Promise<Vault> {
  const out: Vault = {}
  for (const [path, text] of Object.entries(vault)) out[pathsAfterMove([path], from, to)[0]] = text
  for (const note of await plan(vault, from, to, extraFiles)) {
    const next = applyLinkEdits(out[note.path], note.edits)
    expect(next, `${note.path} must be addressable`).not.toBeNull()
    out[note.path] = next!
  }
  return out
}

describe('what a rename rewrites', () => {
  it('a bare link follows a basename change, and stays bare when the new name is unique', async () => {
    const v = await after(
      { 'Pillars/Clusters.md': '# Clusters', 'A.md': 'See [[Clusters]] and [[Clusters|the clusters]] and [[Clusters#Why]].' },
      'Pillars/Clusters.md',
      'Pillars/Groupings.md'
    )
    expect(v['A.md']).toBe('See [[Groupings]] and [[Groupings|the clusters]] and [[Groupings#Why]].')
  })

  it('a bare link becomes a path when the new basename is ambiguous in the vault', async () => {
    const v = await after(
      { 'Pillars/Clusters.md': '', 'Other/Groupings.md': '', 'A.md': 'See [[Clusters]].' },
      'Pillars/Clusters.md',
      'Pillars/Groupings.md'
    )
    expect(v['A.md']).toBe('See [[Pillars/Groupings]].')
  })

  it('a path-prefixed link is rewritten to the new path without .md; a written .md is kept', async () => {
    const v = await after(
      { 'Pillars/Clusters.md': '', 'A.md': '[[Pillars/Clusters]] [[Pillars/Clusters.md|x]] [[Pillars/Clusters#H]]' },
      'Pillars/Clusters.md',
      'Archive/Clusters.md'
    )
    expect(v['A.md']).toBe('[[Archive/Clusters]] [[Archive/Clusters.md|x]] [[Archive/Clusters#H]]')
  })

  it('a move between folders leaves bare links alone and rewrites path links', async () => {
    const vault = { 'Pillars/Clusters.md': '', 'A.md': '[[Clusters]] and [[Pillars/Clusters]]' }
    const planned = await plan(vault, 'Pillars/Clusters.md', 'Archive/Clusters.md')
    expect(planned).toHaveLength(1)
    expect(planned[0].edits).toHaveLength(1)
    expect((await after(vault, 'Pillars/Clusters.md', 'Archive/Clusters.md'))['A.md']).toBe(
      '[[Clusters]] and [[Archive/Clusters]]'
    )
  })

  it('embeds follow too, the ! untouched', async () => {
    const v = await after({ 'Diagrams/Flow.md': '', 'A.md': 'Here: ![[Flow]] ![[Diagrams/Flow#part]]' }, 'Diagrams/Flow.md', 'Diagrams/Pipeline.md')
    expect(v['A.md']).toBe('Here: ![[Pipeline]] ![[Diagrams/Pipeline#part]]')
  })

  it('an attachment the index never resolved still follows its embeds', async () => {
    const v = await after(
      { 'A.md': 'Look: ![[diagram.png]] and ![[attachments/diagram.png|big]]' },
      'attachments/diagram.png',
      'attachments/figures/diagram.png',
      ['attachments/diagram.png']
    )
    // The bare embed still resolves by basename; the path one is rewritten.
    expect(v['A.md']).toBe('Look: ![[diagram.png]] and ![[attachments/figures/diagram.png|big]]')
  })

  it('a link inside a frontmatter value is the same byte edit, quotes and list shape kept', async () => {
    const v = await after(
      {
        'Pillars/Clusters.md': '',
        'Cluster A.md': '---\npillar: "[[Clusters]]"\nrelated:\n  - "[[Clusters|alias]]"\n  - "[[Other]]"\n---\n\nBody [[Clusters]].\n',
      },
      'Pillars/Clusters.md',
      'Pillars/Groupings.md'
    )
    expect(v['Cluster A.md']).toBe(
      '---\npillar: "[[Groupings]]"\nrelated:\n  - "[[Groupings|alias]]"\n  - "[[Other]]"\n---\n\nBody [[Groupings]].\n'
    )
  })

  it("the moved note's own [[#heading]] anchors are untouched; its named self-links follow", async () => {
    const vault = { 'Pillars/Clusters.md': 'See [[#Why]] and [[Clusters#Why]].', 'A.md': '' }
    const planned = await plan(vault, 'Pillars/Clusters.md', 'Pillars/Groupings.md')
    expect(planned.map((n) => n.path)).toEqual(['Pillars/Groupings.md'])
    expect(planned[0].edits).toHaveLength(1)
    const v = await after(vault, 'Pillars/Clusters.md', 'Pillars/Groupings.md')
    expect(v['Pillars/Groupings.md']).toBe('See [[#Why]] and [[Groupings#Why]].')
  })

  it('links to other notes are never touched, even ones sharing a prefix', async () => {
    const vault = { 'Clusters.md': '', 'Clusters 2.md': '', 'A.md': '[[Clusters 2]] [[Clusters]]' }
    const v = await after(vault, 'Clusters.md', 'Groupings.md')
    expect(v['A.md']).toBe('[[Clusters 2]] [[Groupings]]')
  })

  it('an ambiguous bare name the move tips the other way is caught', async () => {
    // Two Clusters notes; from Pillars/X, [[Clusters]] resolves to Pillars/Clusters (nearest, then
    // shortest). Once that one leaves the folder, the same text would land on Pillars/Sub/Clusters
    // by proximity — so it is rewritten.
    const vault = { 'Pillars/Clusters.md': '', 'Pillars/Sub/Clusters.md': '', 'Pillars/X.md': '[[Clusters]]' }
    const v = await after(vault, 'Pillars/Clusters.md', 'Archive/Clusters.md')
    expect(v['Pillars/X.md']).toBe('[[Archive/Clusters]]')
  })
})

describe('folder moves', () => {
  const vault: Vault = {
    'Pillars/Clusters.md': 'Sibling: [[Pricing]] and [[Pillars/Pricing]].',
    'Pillars/Pricing.md': '',
    'Pillars/Deep/Note.md': '',
    'A.md': '[[Clusters]] [[Pillars/Clusters]] [[Pillars/Deep/Note|deep]] ![[Pricing]]',
  }

  it('every note under the folder moves; path links follow, bare links do not', async () => {
    const v = await after(vault, 'Pillars', 'Archive/Pillars')
    expect(v['A.md']).toBe('[[Clusters]] [[Archive/Pillars/Clusters]] [[Archive/Pillars/Deep/Note|deep]] ![[Pricing]]')
    // A note inside the folder is planned at its NEW path, its own path links rewritten.
    expect(v['Archive/Pillars/Clusters.md']).toBe('Sibling: [[Pricing]] and [[Archive/Pillars/Pricing]].')
    expect(Object.keys(v).sort()).toEqual(['A.md', 'Archive/Pillars/Clusters.md', 'Archive/Pillars/Deep/Note.md', 'Archive/Pillars/Pricing.md'])
  })

  it('groups edits per note, in descending offset order', async () => {
    const planned = await plan(vault, 'Pillars', 'Archive/Pillars')
    const a = planned.find((n) => n.path === 'A.md')!
    expect(a.edits.map((e) => e.from)).toEqual([...a.edits.map((e) => e.from)].sort((x, y) => y - x))
    expect(a.edits).toHaveLength(2)
    expect(planned.map((n) => n.path)).toEqual(['A.md', 'Archive/Pillars/Clusters.md'])
  })
})

describe('the applier refuses to guess', () => {
  it('returns null when the bytes at an edit are not the link the index saw', async () => {
    const planned = await plan({ 'Clusters.md': '', 'A.md': 'See [[Clusters]].' }, 'Clusters.md', 'Groupings.md')
    expect(applyLinkEdits('See [[Clusters]].', planned[0].edits)).toBe('See [[Groupings]].')
    // The note changed under the index: nothing is applied, not even the edits that would fit.
    expect(applyLinkEdits('Now: [[Clusters]].', planned[0].edits)).toBeNull()
  })

  it('a link with whitespace inside the brackets is reported rather than mangled', () => {
    const refs: LinkRef[] = [
      { guid: 'g', path: 'A.md', target: 'Clusters', alias: null, anchor: null, embed: false, resolved: 'Clusters.md', offset: 0, line: 1, context: '' },
    ]
    const planned = planLinkRewrites(refs, 'Clusters.md', 'Groupings.md', ['Clusters.md', 'A.md'])
    expect(applyLinkEdits('[[ Clusters ]]', planned[0].edits)).toBeNull()
  })
})

describe('collectMoveRefs', () => {
  it('pages through more backlinks than one page holds', async () => {
    const vault: Vault = { 'T.md': '' }
    for (let i = 0; i < 120; i++) vault[`n${i}.md`] = `[[T]]`
    const index = indexOf(vault)
    const refs = await collectMoveRefs(index, Object.keys(vault), 'T.md')
    expect(refs).toHaveLength(120)
    expect(planLinkRewrites(refs, 'T.md', 'U.md', Object.keys(vault))).toHaveLength(120)
  })
})
