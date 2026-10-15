/**
 * Renames follow into collections: a `.base`'s `file.inFolder("…")` and
 * `file.hasLink("…")` strings follow a move the way a wikilink does, and
 * nothing else in the file moves a byte.
 */
import { applyLinkEdits } from '@ohhi/index'
import { describe, expect, it } from 'vitest'
import { newCollectionText } from '../src/create.js'
import { compileStatement, fileCallStrings } from '../src/filter.js'
import { parseCollection } from '../src/parse.js'
import { planCollectionMoves, planCollectionRewrites } from '../src/rewrite.js'

const VAULT = [
  'Competitors.base',
  'Competitors/Ingredifind.md',
  'Competitors/Deep/Quiteful.md',
  'Areas/CS/Clusters.md',
  'Pricing.md',
  'Notes/Clusters overview.md',
]

const BASE = `# The matrix — file.inFolder("Competitors") in a comment stays
filters:
  and:
    - file.inFolder("Competitors")
    - '!file.hasTag("archived")'
properties:
  title:
    displayName: file.inFolder("Competitors")
views:
  - type: table
    name: Deep
    filters:
      or:
        - file.inFolder("Competitors/Deep/")
        - 'file.hasLink("Clusters") && threat == "direct"'
        - title == "file.inFolder(\\"Competitors\\")"
        - file.inFolder("CompetitorsArchive")
    order:
      - file.name
  - type: table
    name: By path
    filters: "file.hasLink('Areas/CS/Clusters')"
    order:
      - file.name
`

const plan = (text: string, from: string, to: string) => planCollectionRewrites(text, from, to, { vaultPaths: VAULT })
const apply = (text: string, from: string, to: string): string => {
  const out = applyLinkEdits(text, plan(text, from, to))
  if (out === null) throw new Error('the plan did not apply')
  return out
}

describe('planCollectionRewrites', () => {
  it('rewrites an inFolder naming the moved folder exactly, and one under it, keeping its slashes', () => {
    const out = apply(BASE, 'Competitors', 'Rivals')
    expect(out).toContain('    - file.inFolder("Rivals")\n')
    expect(out).toContain('        - file.inFolder("Rivals/Deep/")\n')
    // The rest of the file is byte for byte what it was.
    expect(out.replace(/Rivals/g, 'Competitors')).toBe(BASE)
  })

  it('leaves a comment, a display name, a string that only contains the words, and a folder that merely shares a prefix', () => {
    const out = apply(BASE, 'Competitors', 'Rivals')
    expect(out).toContain('# The matrix — file.inFolder("Competitors") in a comment stays')
    expect(out).toContain('    displayName: file.inFolder("Competitors")')
    expect(out).toContain('title == "file.inFolder(\\"Competitors\\")"')
    expect(out).toContain('file.inFolder("CompetitorsArchive")')
    expect(out).toContain(`'!file.hasTag("archived")'`)
  })

  it('moves an inFolder under its folder when only the subfolder moves, and not at all when an unrelated one does', () => {
    expect(apply(BASE, 'Competitors/Deep', 'Archive/Deep')).toContain('file.inFolder("Archive/Deep/")')
    expect(plan(BASE, 'Pricing.md', 'Money.md')).toEqual([])
  })

  it('rewrites a bare hasLink only when the basename changes, keeping it bare', () => {
    // Between folders: the bare name still resolves; nothing changes.
    expect(plan(BASE, 'Areas/CS/Clusters.md', 'Archive/Clusters.md').filter((e) => e.expect.startsWith('Clusters'))).toEqual([])
    const out = apply(BASE, 'Areas/CS/Clusters.md', 'Areas/CS/Topics.md')
    expect(out).toContain(`'file.hasLink("Topics") && threat == "direct"'`)
  })

  it('rewrites a hasLink written as a path when the path changes, as a path', () => {
    const out = apply(BASE, 'Areas/CS/Clusters.md', 'Archive/Clusters.md')
    expect(out).toContain(`filters: "file.hasLink('Archive/Clusters')"`)
    // And when a folder above it moves.
    expect(apply(BASE, 'Areas', 'Old Areas')).toContain(`"file.hasLink('Old Areas/CS/Clusters')"`)
  })

  it('answers edits in descending offset order, each expecting the old string and its closing quote', () => {
    const edits = plan(BASE, 'Competitors', 'Rivals')
    expect(edits).toHaveLength(2)
    expect(edits[0].from).toBeGreaterThan(edits[1].from)
    for (const e of edits) {
      expect(e.expect.endsWith('"')).toBe(true)
      expect(BASE.slice(e.from, e.from + e.expect.length)).toBe(e.expect)
    }
    // A text that changed under the plan is refused whole.
    expect(applyLinkEdits(BASE.replace('- file.inFolder("Competitors")', '- file.inFolder("Competitorz")'), edits)).toBeNull()
  })

  it('keeps what "New collection" writes working after its folder is renamed', () => {
    const text = newCollectionText({ folder: 'Competitors' })
    const out = apply(text, 'Competitors', 'Rivals')
    expect(parseCollection(out).filters).toEqual({ and: ['file.inFolder("Rivals")'] })
    expect(compileStatement('file.inFolder("Rivals")')).toEqual({ op: 'inFolder', folder: 'Rivals' })
  })

  it('leaves a new name the statement cannot hold byte for byte, and a file that is not YAML', () => {
    const single = `filters: 'file.inFolder("Competitors")'\n`
    expect(planCollectionRewrites(single, 'Competitors', "Alex's rivals", { vaultPaths: VAULT })).toEqual([])
    expect(planCollectionRewrites(single, 'Competitors', 'Rivals', { vaultPaths: VAULT })).toHaveLength(1)
    expect(plan('filters: [unclosed\n', 'Competitors', 'Rivals')).toEqual([])
  })

  it('plans every collection a move touches, at its path after the move', () => {
    const moves = planCollectionMoves(
      [
        { path: 'Competitors.base', text: BASE },
        { path: 'Competitors/Inner.base', text: newCollectionText({ folder: 'Competitors' }) },
        { path: 'Other.base', text: newCollectionText({ folder: 'Pricing' }) },
      ],
      'Competitors',
      'Rivals',
      VAULT
    )
    expect(moves.map((m) => [m.path, m.edits.length])).toEqual([
      ['Competitors.base', 2],
      ['Rivals/Inner.base', 1],
    ])
  })
})

describe('fileCallStrings', () => {
  it('finds the first argument of the two calls, with its offsets, and nothing inside another string', () => {
    const s = `file.inFolder( "A/B" ) && file.hasLink('C') && x == "file.hasLink('D')" && this.file.inFolder("E")`
    const calls = fileCallStrings(s)
    expect(calls.map((c) => [c.fn, c.value, s.slice(c.from, c.to), c.quote, c.verbatim])).toEqual([
      ['inFolder', 'A/B', 'A/B', '"', true],
      ['hasLink', 'C', 'C', "'", true],
    ])
    expect(fileCallStrings('file.inFolder("a\\"b")')[0].verbatim).toBe(false)
    expect(fileCallStrings('file.inFolder("unterminated')).toEqual([])
  })
})
