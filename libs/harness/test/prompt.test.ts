import { describe, expect, it } from 'vitest'
import { skillsCatalog } from '@ohhi/agent/skills'
import { renderRefs, systemPrompt } from '../src/prompt.js'
import type { Mention, SkillMeta } from '../src/types.js'

const skill = (name: string, extra: Partial<SkillMeta> = {}): SkillMeta => ({
  name,
  description: `Does ${name} things & more <well>.`,
  dir: `.agents/skills/${name}`,
  metadata: {},
  hasScripts: false,
  problems: [],
  ...extra,
})

const linesRef: Mention = {
  id: 'r1',
  ref: { kind: 'lines', path: 'Projects/Editor.md', lines: { from: 14, to: 17 } },
  label: 'Editor.md (14–17)',
  hash: 'abc123',
  snapshot: '## Decisions\n\n- Files are canonical.\n- CRDTs handle sync.',
}

describe('systemPrompt', () => {
  it('always carries the vault discipline: narrow before you read', () => {
    const p = systemPrompt({ skills: [], refs: [] })
    expect(p).toContain('## Working with the vault')
    expect(p).toContain('ohhi_search')
    expect(p).toContain('outline: true')
    expect(p).toContain('## Changing notes')
    expect(p).not.toContain('<available_skills>')
    expect(p).not.toContain('## References')
    expect(p).not.toContain('## Active skill')
  })

  it('lists valid skills in the <available_skills> catalog, escaped, and drops invalid ones', () => {
    const p = systemPrompt({ skills: [skill('line-edit'), skill('Bad Name', { problems: ['name'] })], refs: [] })
    expect(p).toContain('## Skills')
    expect(p).toContain('<name>line-edit</name>')
    expect(p).toContain('<description>Does line-edit things &amp; more &lt;well&gt;.</description>')
    expect(p).toContain('<location>.agents/skills/line-edit/SKILL.md</location>')
    expect(p).not.toContain('Bad Name')
  })

  it('carries the active skill body verbatim under its own heading', () => {
    const body = 'Tighten each sentence.\nKeep the meaning.\n'
    const p = systemPrompt({ skills: [], skill: { meta: skill('line-edit'), body }, refs: [] })
    expect(p).toContain('## Active skill: line-edit')
    expect(p).toContain('Tighten each sentence.\nKeep the meaning.')
  })

  it('renders references under their own heading', () => {
    const p = systemPrompt({ skills: [], refs: [linesRef] })
    expect(p).toContain('## References')
    expect(p).toContain('### Projects/Editor.md (14–17) · hash abc123')
  })

  it('adds the thread rule only for a turn a comment asked: answer a question, propose a change plus one line', () => {
    expect(systemPrompt({ skills: [], refs: [] })).not.toContain('## A comment asked')
    const p = systemPrompt({ skills: [], refs: [], thread: true })
    expect(p).toContain('## A comment asked')
    expect(p).toMatch(/A question: answer it/)
    expect(p).toMatch(/propose the edit \(ohhi_patch/)
  })

  it('is a pure function of its inputs and stays short', () => {
    const input = { skills: [skill('a'), skill('b')], skill: { meta: skill('a'), body: 'x' }, refs: [linesRef] }
    expect(systemPrompt(input)).toBe(systemPrompt(input))
    expect(systemPrompt({ skills: [], refs: [] }).split('\n').length).toBeLessThan(40)
  })
})

describe('renderRefs', () => {
  it('fences a snapshot under `path (from–to)` + hash', () => {
    expect(renderRefs([linesRef])).toBe(
      '### Projects/Editor.md (14–17) · hash abc123\n```markdown\n## Decisions\n\n- Files are canonical.\n- CRDTs handle sync.\n```',
    )
  })

  it('picks a fence longer than any backtick run in the snapshot', () => {
    const r = renderRefs([{ ...linesRef, snapshot: 'code:\n```js\nx\n```\n' }])
    expect(r).toContain('````markdown\ncode:\n```js\nx\n```\n````')
  })

  it('names sections, folders and whole files; unattached ones point at the tools', () => {
    const r = renderRefs([
      { id: 's', ref: { kind: 'section', path: 'Projects/Editor.md', section: 'Decisions' }, label: 'x', snapshot: '- a' },
      { id: 'f', ref: { kind: 'folder', path: 'Areas/CS/' }, label: 'x' },
      { id: 'w', ref: { kind: 'file', path: 'Areas/CS/JSON.md' }, label: 'x', hash: 'h1' },
    ])
    expect(r).toContain('### Projects/Editor.md › Decisions\n```markdown\n- a\n```')
    expect(r).toContain('### Areas/CS/ (folder)\n(not attached — list it with ohhi_ls)')
    expect(r).toContain('### Areas/CS/JSON.md · hash h1\n(not attached — read it with ohhi_read (outline first))')
  })

  it('is empty for no references', () => {
    expect(renderRefs([])).toBe('')
    expect(skillsCatalog([])).toBe('')
  })
})
