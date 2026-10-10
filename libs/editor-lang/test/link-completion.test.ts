/**
 * The link popover (editor-usability E1): ranking, scope (fork A2), the text a
 * pick writes and where the caret lands. The pure rules first, then the CM6
 * source over a real EditorState, applied through a stand-in view.
 */
import { acceptCompletion, CompletionContext, type Completion, type CompletionResult } from '@codemirror/autocomplete'
import { keymap } from '@codemirror/view'
import { EditorState, Prec } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  createFolder,
  exactMatch,
  headingAnchor,
  linkEdit,
  linkQueryAt,
  linkTarget,
  mountOf,
  rankHeadings,
  rankNotes,
  scopeNotes,
  type LinkNote,
} from '../src/link-completion.js'
import { linkCompletions } from '../src/link-completion-view.js'
import { wikiLinkExtensions, type WikiLinkHost } from '../src/wikilink-view.js'

const all = (paths: string[]): LinkNote[] => paths.map((path) => ({ path, mount: null, group: 'all' }))
const names = (notes: { name: string }[]): string[] => notes.map((n) => n.name)

describe('rankNotes', () => {
  const notes = all([
    'archive/old design.md',
    'Design.md',
    'projects/design-system.md',
    'Redesign notes.md',
    'ideas/the design doc.md',
    'design/README.md',
  ])

  it('ranks a name prefix over a word start over a substring over a path match', () => {
    expect(names(rankNotes('design', notes))).toEqual([
      'Design',
      'design-system',
      'old design',
      'the design doc',
      'Redesign notes',
      'README',
    ])
  })

  it('marks the matched span of the name for the bold highlight', () => {
    const [first, , third] = rankNotes('design', notes)
    expect(first.match).toEqual([0, 6])
    expect(third.match).toEqual([4, 10])
    expect(rankNotes('design', notes).at(-1)?.match).toBe(null) // a path match bolds nothing
  })

  it('boosts recently opened notes within a tier, then breaks ties alphabetically', () => {
    const ranked = rankNotes('d', all(['b/Delta.md', 'Dart.md', 'Echo.md', 'a/Dune.md']), ['a/Dune.md'])
    expect(names(ranked)).toEqual(['Dune', 'Dart', 'Delta'])
  })

  it('gives recent notes first for an empty query, then the rest alphabetically', () => {
    const ranked = rankNotes('', all(['Zeta.md', 'Alpha.md', 'Mid.md', 'Beta.md']), ['Mid.md', 'Zeta.md'])
    expect(names(ranked)).toEqual(['Mid', 'Zeta', 'Alpha', 'Beta'])
  })

  it('puts the share first and caps each group on its own', () => {
    const scoped: LinkNote[] = [
      { path: 'Mine.md', mount: null, group: 'other' },
      ...Array.from({ length: 5 }, (_, i) => ({ path: `Team/n${i}.md`, mount: 'Team', group: 'scope' as const })),
    ]
    const ranked = rankNotes('', scoped, [], 3)
    expect(ranked.map((n) => n.group)).toEqual(['scope', 'scope', 'scope', 'other'])
  })

  it('matches a typed folder path against the whole path', () => {
    expect(names(rankNotes('projects/des', notes))).toEqual(['design-system'])
  })
})

describe('scope (fork A2)', () => {
  const mounts = [{ path: 'Team', name: 'Team' }, { path: 'Team/inner', name: 'Inner' }]

  it('finds the innermost share holding a path, and none for the private root', () => {
    expect(mountOf('Team/a.md', mounts)?.path).toBe('Team')
    expect(mountOf('Team/inner/a.md', mounts)?.path).toBe('Team/inner')
    expect(mountOf('Teamwork/a.md', mounts)).toBe(null)
    expect(mountOf('a.md', mounts)).toBe(null)
  })

  it('splits notes into the share and the rest, leaving the context note out', () => {
    const { mount, notes } = scopeNotes(['Team/a.md', 'Team/b.md', 'Private.md'], 'Team/a.md', mounts)
    expect(mount?.name).toBe('Team')
    expect(notes).toEqual([
      { path: 'Team/b.md', mount: 'Team', group: 'scope' },
      { path: 'Private.md', mount: null, group: 'other' },
    ])
  })

  it('gives a private-root note one ungrouped list', () => {
    const { mount, notes } = scopeNotes(['Team/a.md', 'Private.md'], 'Home.md', mounts)
    expect(mount).toBe(null)
    expect(notes.every((n) => n.group === 'all')).toBe(true)
  })
})

describe('linkTarget', () => {
  const paths = ['Team/sub/Plan.md', 'Archive/sub/Plan.md', 'Other/Plan.md', 'Team/Solo.md']

  it('is the bare name when the name is unique', () => {
    expect(linkTarget('Team/Solo.md', paths)).toBe('Solo')
  })

  it('grows to the shortest unique trailing path when the name is shared', () => {
    expect(linkTarget('Other/Plan.md', paths)).toBe('Other/Plan')
    expect(linkTarget('Team/sub/Plan.md', paths)).toBe('Team/sub/Plan')
  })

  it('inside a share, never reaches past the share root (a vault path would not resolve for collaborators)', () => {
    expect(linkTarget('Team/sub/Plan.md', paths, 'Team')).toBe('sub/Plan')
    expect(linkTarget('Team/Solo.md', paths, 'Team')).toBe('Solo')
  })

  it('grows past a share-relative target that is an exact vault path of another note (exact paths win in resolve)', () => {
    const vault = ['Team/sub/Plan.md', 'sub/Plan.md', 'Team/Home.md']
    // `sub/Plan` would open the root `sub/Plan.md`: write the vault path instead.
    expect(linkTarget('Team/sub/Plan.md', vault, 'Team', false, 'Team/Home.md')).toBe('Team/sub/Plan')
    expect(linkTarget('Team/sub/Plan.md', vault, 'Team', true, 'Team/Home.md')).toBe('Team/sub/Plan')
    // The root note itself is still `sub/Plan`, which resolves to it.
    expect(linkTarget('sub/Plan.md', vault, '', false, 'Team/Home.md')).toBe('sub/Plan')
    // A share-relative target nothing else claims by exact path stays share-relative.
    expect(linkTarget('Team/sub/Plan.md', ['Team/sub/Plan.md', 'Other/Plan.md'], 'Team', false, 'Team/Home.md')).toBe(
      'sub/Plan'
    )
  })

  it('writes the whole root-relative path when a path was typed', () => {
    expect(linkTarget('Team/Solo.md', paths, 'Team', true)).toBe('Solo')
    expect(linkTarget('Team/Solo.md', paths, '', true)).toBe('Team/Solo')
  })
})

describe('linkQueryAt', () => {
  it('reads the target typed after `[[`', () => {
    expect(linkQueryAt('see [[Des', 9)).toEqual({ open: 6, target: 'Des', heading: null })
    expect(linkQueryAt('see [[', 6)).toEqual({ open: 6, target: '', heading: null })
  })

  it('switches to a heading query past a `#`', () => {
    expect(linkQueryAt('[[Design#Dec', 12)).toEqual({ open: 2, target: 'Design', heading: { from: 9, query: 'Dec' } })
    expect(linkQueryAt('[[#', 3)?.heading).toEqual({ from: 3, query: '' })
  })

  it('stays out of a closed link and out of an alias', () => {
    expect(linkQueryAt('[[Design]] and', 14)).toBe(null)
    expect(linkQueryAt('[[Design|my al', 14)).toBe(null)
    expect(linkQueryAt('no link here', 5)).toBe(null)
  })
})

describe('linkEdit', () => {
  const apply = (line: string, from: number, caret: number, text: string, kind?: 'target' | 'heading') => {
    const e = linkEdit(line, from, caret, text, kind)
    const out = line.slice(0, e.from) + e.insert + line.slice(e.to)
    return `${out.slice(0, e.cursor)}‸${out.slice(e.cursor)}`
  }

  it('closes the link and puts the caret after `]]`', () => {
    expect(apply('see [[Des', 6, 9, 'Design')).toBe('see [[Design]]‸')
  })

  it('steps over a `]]` that is already there (typed or auto-closed)', () => {
    expect(apply('[[Des]] more', 2, 5, 'Design')).toBe('[[Design]]‸ more')
    expect(apply('[[]]', 2, 2, 'Design')).toBe('[[Design]]‸')
  })

  it('completes a lone `]` to `]]`', () => {
    expect(apply('[[Des]', 2, 5, 'Design')).toBe('[[Design]]‸')
  })

  it('replaces the whole target when the caret is in its middle', () => {
    expect(apply('[[Desgn]]', 2, 4, 'Design')).toBe('[[Design]]‸')
  })

  it('keeps a typed |alias and #heading, adds no brackets, caret after the closing `]]`', () => {
    expect(apply('[[Des|the doc]] x', 2, 5, 'Design')).toBe('[[Design|the doc]]‸ x')
    expect(apply('[[Des#Goals]]', 2, 5, 'Design')).toBe('[[Design#Goals]]‸')
  })

  it('guesses nothing about a suffix with no closing `]]`', () => {
    expect(apply('[[Des|alias and [[Other]]', 2, 5, 'Design')).toBe('[[Design‸|alias and [[Other]]')
  })

  it('completes a heading and keeps an alias after it', () => {
    expect(apply('[[Design#Dec', 9, 12, 'Decisions', 'heading')).toBe('[[Design#Decisions]]‸')
    expect(apply('[[Design#De|why]]', 9, 11, 'Decisions', 'heading')).toBe('[[Design#Decisions|why]]‸')
  })
})

describe('headings and the create row', () => {
  it('anchors a heading the way Obsidian does', () => {
    expect(headingAnchor('Q1 | Q2 [draft] #wip')).toBe('Q1 Q2 draft wip')
  })

  it('ranks heading prefixes first, otherwise document order', () => {
    const hs = [
      { level: 1, text: 'Overview' },
      { level: 2, text: 'Open decisions' },
      { level: 2, text: 'Decisions' },
    ]
    expect(rankHeadings('dec', hs).map((h) => h.anchor)).toEqual(['Decisions', 'Open decisions'])
    expect(rankHeadings('', hs).map((h) => h.anchor)).toEqual(['Overview', 'Open decisions', 'Decisions'])
  })

  it('offers to create only when nothing matches exactly', () => {
    expect(exactMatch('design', ['Design.md'])).toBe(true)
    expect(exactMatch('sub/plan', ['Team/sub/Plan.md'])).toBe(true)
    expect(exactMatch('Desig', ['Design.md'])).toBe(false)
  })

  it('creates beside the current note, or at the root for a typed path', () => {
    expect(createFolder('New', 'Team/sub/Note.md')).toBe('Team/sub')
    expect(createFolder('a/New', 'Team/sub/Note.md')).toBe('')
    expect(createFolder('New', null)).toBe('')
  })
})

// ---- the CM6 source -----------------------------------------------------------

const PATHS = ['Team/Plan.md', 'Team/sub/Notes.md', 'Notes.md', 'Private plan.md', 'Team/Here.md']

function host(over: Partial<WikiLinkHost> = {}): WikiLinkHost & { created: string[] } {
  const created: string[] = []
  return {
    created,
    resolve: (t) => PATHS.find((p) => p.replace(/\.md$/, '').endsWith(t)) ?? null,
    open: () => {},
    create: (t) => created.push(t),
    candidates: () => PATHS,
    context: () => ({ path: 'Team/Here.md', mounts: [{ path: 'Team', name: 'Team' }], recents: [] }),
    headings: async () => [
      { level: 1, text: 'Plan' },
      { level: 2, text: 'Goals' },
    ],
    ...over,
  }
}

async function complete(doc: string, h: WikiLinkHost): Promise<{ result: CompletionResult | null; state: EditorState }> {
  const state = EditorState.create({ doc, selection: { anchor: doc.indexOf('‸') === -1 ? doc.length : doc.indexOf('‸') } })
  const clean = EditorState.create({ doc: doc.replace('‸', ''), selection: state.selection })
  const source = linkCompletions(() => h)
  const result = await source(new CompletionContext(clean, clean.selection.main.head, false))
  return { result, state: clean }
}

/** Apply an option through a stand-in view (the source only reads `state` and calls `dispatch`). */
function pick(state: EditorState, result: CompletionResult, option: Completion): string {
  let current = state
  const view = { get state() { return current }, dispatch: (spec: Parameters<EditorState['update']>[0]) => { current = current.update(spec).state } }
  ;(option.apply as (v: unknown, c: Completion, from: number, to: number) => void)(view, option, result.from, result.to ?? result.from)
  const at = current.selection.main.head
  return `${current.doc.sliceString(0, at)}‸${current.doc.sliceString(at)}`
}

describe('linkCompletions', () => {
  it('lists the share first, the rest below, and a create row when nothing matches exactly', async () => {
    const { result } = await complete('[[pla', host())
    const rows = result!.options.map((o) => [o.displayLabel ?? o.label, (o.section as { name: string }).name])
    expect(rows).toEqual([
      ['Plan', 'link:scope'],
      ['Private plan', 'link:other'],
      ['Create “pla”', 'link:create'],
    ])
  })

  it('gives a private-root note one ungrouped list', async () => {
    const h = host({ context: () => ({ path: 'Notes.md', mounts: [{ path: 'Team', name: 'Team' }], recents: [] }) })
    const { result } = await complete('[[', h)
    expect(new Set(result!.options.map((o) => (o.section as { name: string }).name))).toEqual(new Set(['link:all']))
  })

  it('accepts into `[[Target]]` with the caret after the brackets', async () => {
    const { result, state } = await complete('see [[pla', host())
    expect(pick(state, result!, result!.options[0])).toBe('see [[Plan]]‸')
  })

  it('writes an ambiguous name inside a share relative to the share root', async () => {
    const { result, state } = await complete('[[notes', host())
    const scoped = result!.options.find((o) => o.detail === 'Team/sub')!
    expect(pick(state, result!, scoped)).toBe('[[sub/Notes]]‸')
    const other = result!.options.find((o) => o.detail === undefined && o.label === 'Notes')!
    // The root note's whole path IS its name, and an exact path wins in the resolver.
    expect(pick(state, result!, other)).toBe('[[Notes]]‸')
  })

  it('creates the note from the create row after writing the link', async () => {
    const h = host()
    const { result, state } = await complete('[[Brand new', h)
    const create = result!.options.at(-1)!
    expect(pick(state, result!, create)).toBe('[[Brand new]]‸')
    expect(h.created).toEqual(['Brand new'])
  })

  it('completes headings after `#`, async, from the host', async () => {
    const { result, state } = await complete('[[Plan#go‸]]', host())
    expect(result!.options.map((o) => o.label)).toEqual(['Goals'])
    expect(pick(state, result!, result!.options[0])).toBe('[[Plan#Goals]]‸')
  })

  it('puts recent notes in scope first for an empty query', async () => {
    const h = host({
      context: () => ({ path: 'Team/Here.md', mounts: [{ path: 'Team', name: 'Team' }], recents: ['Notes.md', 'Team/sub/Notes.md'] }),
    })
    const { result } = await complete('[[', h)
    expect(result!.options.map((o) => o.detail ?? '/' + o.label)).toEqual(['Team/sub', 'Team', '/Notes', '/Private plan'])
  })
})

describe('keys', () => {
  it('binds Tab to accept, above the list indent at Prec.high', () => {
    const indent = (): boolean => false
    const state = EditorState.create({
      extensions: [Prec.high(keymap.of([{ key: 'Tab', run: indent }])), wikiLinkExtensions()],
    })
    const tab = state
      .facet(keymap)
      .flat()
      .filter((b) => b.key === 'Tab')
      .map((b) => b.run)
    expect(tab[0]).toBe(acceptCompletion)
    expect(tab).toContain(indent)
  })
})
