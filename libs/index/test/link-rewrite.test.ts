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
  const refs = await collectMoveRefs(index, paths, from, to)
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

  it('`expect` covers the byte that ends the target, so [[a]] in the index never passes for [[ab]] on disk', async () => {
    const planned = await plan({ 'a.md': '', 'N.md': 'See [[a]] and [[a|x]] and [[a#h]].' }, 'a.md', 'Plans.md')
    const edits = planned[0].edits
    expect(edits.map((e) => e.expect).sort()).toEqual(['a#', 'a]', 'a|'])
    expect(edits.every((e) => e.to - e.from === 1)).toBe(true)
    expect(applyLinkEdits('See [[a]] and [[a|x]] and [[a#h]].', edits)).toBe('See [[Plans]] and [[Plans|x]] and [[Plans#h]].')
    // Grown under the index: `[[ab]]` would have become `[[Plansb]]`.
    expect(applyLinkEdits('See [[ab]] and [[a|x]] and [[a#h]].', edits)).toBeNull()
    // A hand-made edit whose terminator is not one a link can end on is refused too.
    expect(applyLinkEdits('See [[a]]', [{ from: 6, to: 7, expect: 'a ', insert: 'b' }])).toBeNull()
  })
})

describe('what a rename must not do', () => {
  it('a case-only rename rewrites nothing: every link still resolves', async () => {
    const vault = { 'Pillars/Clusters.md': '', 'A.md': '[[Clusters]] [[clusters]] [[Pillars/Clusters]] [[Pillars/Clusters.md|x]]' }
    expect(await plan(vault, 'Pillars/Clusters.md', 'Pillars/clusters.md')).toEqual([])
  })

  it('a link in a code span is not a link, so it is neither a backlink nor rewritten', async () => {
    const vault = { 'Clusters.md': '', 'A.md': 'Real [[Clusters]]; sample `[[Clusters]]`; fenced:\n```\n[[Clusters]]\n```\n' }
    const v = await after(vault, 'Clusters.md', 'Groupings.md')
    expect(v['A.md']).toBe('Real [[Groupings]]; sample `[[Clusters]]`; fenced:\n```\n[[Clusters]]\n```\n')
  })

  it('a referrer that is not a markdown note is left alone', async () => {
    const vault = { 'Clusters.md': '', 'Board.canvas': '{"nodes":[{"text":"[[Clusters]]"}]}', 'A.md': '[[Clusters]]' }
    const planned = await plan(vault, 'Clusters.md', 'Groupings.md')
    expect(planned.map((n) => n.path)).toEqual(['A.md'])
  })
})

describe('the written form is kept', () => {
  it('a lower-case bare link and a bare link with .md both take the new name', async () => {
    const v = await after({ 'Clusters.md': '', 'A.md': '[[clusters]] and [[Clusters.md]] and [[clusters.MD|x]]' }, 'Clusters.md', 'Groupings.md')
    expect(v['A.md']).toBe('[[Groupings]] and [[Groupings.md]] and [[Groupings.md|x]]')
  })

  it('a frontmatter flow list of links is rewritten item by item, brackets and quotes kept', async () => {
    const v = await after(
      { 'Clusters.md': '', 'Other.md': '', 'A.md': '---\nrelated: ["[[Clusters]]", "[[Other]]", "[[Clusters|c]]"]\n---\n' },
      'Clusters.md',
      'Groupings.md'
    )
    expect(v['A.md']).toBe('---\nrelated: ["[[Groupings]]", "[[Other]]", "[[Groupings|c]]"]\n---\n')
  })
})

describe('namesakes — a rename must not capture another note.s links', () => {
  it('a bare link that meant the other note becomes a path when the renamed note would capture it', async () => {
    const vault = {
      'Pillars/Clusters.md': '',
      'Other/Groupings.md': '',
      // From Pillars/Y, [[Groupings]] means Other/Groupings today (the only one); once
      // Pillars/Groupings exists it would win by proximity — so the link is pinned.
      'Pillars/Y.md': 'See [[Groupings]] and [[Clusters]].',
      'Z.md': '[[Groupings]]',
    }
    const planned = await plan(vault, 'Pillars/Clusters.md', 'Pillars/Groupings.md')
    expect(planned.map((n) => [n.path, n.edits.length])).toEqual([['Pillars/Y.md', 2]])
    const v = await after(vault, 'Pillars/Clusters.md', 'Pillars/Groupings.md')
    expect(v['Pillars/Y.md']).toBe('See [[Other/Groupings]] and [[Pillars/Groupings]].')
    // Z sits at the root, equally far from both: the tie falls to the alphabet and
    // Other/Groupings still wins, so the link still lands where it did — untouched.
    expect(v['Z.md']).toBe('[[Groupings]]')
  })
})

describe('partial paths', () => {
  it('a suffix that still names the moved note alone is kept; one that no longer resolves takes the same depth', async () => {
    const vault = { 'Areas/CS/Clusters.md': '', 'A.md': '[[CS/Clusters]] and [[Areas/CS/Clusters]]' }
    // The folder moves deeper: the suffix still ends the path, and nothing else does.
    const deeper = await after(vault, 'Areas', 'Archive/Areas')
    expect(deeper['A.md']).toBe('[[CS/Clusters]] and [[Archive/Areas/CS/Clusters]]')
    // The folder is renamed: the suffix is stale, and its same-depth sibling names the note alone.
    const renamed = await after(vault, 'Areas/CS', 'Areas/Computing')
    expect(renamed['A.md']).toBe('[[Computing/Clusters]] and [[Areas/Computing/Clusters]]')
  })

  it('a same-depth suffix two notes end with is not offered; the full path is', async () => {
    const vault = { 'Areas/CS/Clusters.md': '', 'Other/Computing/Clusters.md': '', 'A.md': '[[CS/Clusters]]' }
    const v = await after(vault, 'Areas/CS', 'Areas/Computing')
    expect(v['A.md']).toBe('[[Areas/Computing/Clusters]]')
  })

  it('a suffix the move makes ambiguous is pinned to the full path', async () => {
    const vault = { 'Areas/CS/Clusters.md': '', 'Old/Clusters.md': '', 'A.md': '[[CS/Clusters]]' }
    // Old/Clusters moves to Other/CS/Clusters: now two paths end with CS/Clusters.
    const v = await after(vault, 'Old', 'Other/CS')
    expect(v['A.md']).toBe('[[Areas/CS/Clusters]]')
  })
})

describe('collectMoveRefs', () => {
  it('pages through more backlinks than one page holds', async () => {
    const vault: Vault = { 'T.md': '' }
    for (let i = 0; i < 120; i++) vault[`n${i}.md`] = `[[T]]`
    const index = indexOf(vault)
    const refs = await collectMoveRefs(index, Object.keys(vault), 'T.md', 'U.md')
    expect(refs).toHaveLength(120)
    expect(planLinkRewrites(refs, 'T.md', 'U.md', Object.keys(vault))).toHaveLength(120)
  })
})
