import { describe, expect, it } from 'vitest'
import type { SkillMeta } from '@ohhi/harness'
import { mentionOptions, skillOptions, type MentionSources } from './composer-mentions.js'

const skill = (name: string, description = `${name} things`): SkillMeta => ({
  name,
  description,
  dir: `.agents/skills/${name}`,
  metadata: {},
  hasScripts: false,
  problems: [],
})

function sources(over: Partial<MentionSources> = {}): MentionSources {
  return {
    quickOpen: async (q) =>
      ['notes/plan.md', 'notes/ideas.md', 'diary.md']
        .filter((p) => p.includes(q))
        .map((path) => ({ path, spans: q ? [{ from: path.indexOf(q), to: path.indexOf(q) + q.length }] : [] })),
    folders: () => ['notes', 'projects/harness'],
    currentNote: () => 'notes/plan.md',
    headings: async () => [
      { text: 'Plan', level: 1 },
      { text: 'Decisions', level: 2 },
    ],
    selection: () => null,
    skills: async () => [skill('summarize'), skill('tighten-prose')],
    ...over,
  }
}

describe('mention options', () => {
  it('an empty @ offers the note’s headings, then notes, then folders', async () => {
    const opts = await mentionOptions('', sources())
    expect(opts.map((o) => o.kind)).toEqual(['section', 'section', 'file', 'file', 'file', 'folder', 'folder'])
    const decisions = opts.find((o) => o.title === 'Decisions')!
    expect(decisions).toMatchObject({ kind: 'section', subtitle: 'plan.md › Decisions', ref: { kind: 'section', path: 'notes/plan.md', section: 'Decisions' } })
    expect(opts.find((o) => o.kind === 'file')).toMatchObject({ title: 'notes/plan.md', subtitle: 'notes', ref: { kind: 'file', path: 'notes/plan.md' } })
    expect(opts.find((o) => o.kind === 'folder')).toMatchObject({ title: 'notes/', ref: { kind: 'folder', path: 'notes' } })
  })

  it('puts the live selection first, as an L-range', async () => {
    const opts = await mentionOptions('', sources({ selection: () => ({ path: 'notes/plan.md', lines: { from: 12, to: 20 } }) }))
    expect(opts[0]).toMatchObject({ kind: 'lines', title: 'plan.md (12–20)', path: 'notes/plan.md', subtitle: 'The selection in plan.md' })
  })

  it('ranks by the query and carries the match spans', async () => {
    const opts = await mentionOptions('ide', sources())
    expect(opts.map((o) => o.title)).toEqual(['notes/ideas.md'])
    expect(opts[0].spans).toEqual([{ from: 6, to: 9 }])

    const harness = await mentionOptions('harn', sources())
    expect(harness.map((o) => o.title)).toContain('projects/harness/')
  })

  it('a # query narrows to headings', async () => {
    const opts = await mentionOptions('#dec', sources())
    expect(opts.map((o) => [o.kind, o.title])).toEqual([['section', 'Decisions']])
  })

  it('with no note in focus there are no headings', async () => {
    const opts = await mentionOptions('', sources({ currentNote: () => null }))
    expect(opts.some((o) => o.kind === 'section')).toBe(false)
  })

  it('/ lists skills by name, best match first', async () => {
    const opts = await skillOptions('tig', sources())
    expect(opts.map((o) => o.title)).toEqual(['tighten-prose'])
    expect(opts[0]).toMatchObject({ kind: 'skill', subtitle: 'tighten-prose things' })
    expect((await skillOptions('', sources())).length).toBe(2)
    expect(await skillOptions('', sources({ skills: async () => [] }))).toEqual([])
  })
})
