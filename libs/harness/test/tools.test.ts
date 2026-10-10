import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolExecutionOptions } from 'ai'
import { toolsFromContract } from '../src/tools.js'
import type { ProposeEditInput, SuggestionRecord } from '../src/types.js'
import { harness, ORIGIN, type Harness } from './helpers.js'

let h: Harness
beforeEach(async () => {
  h = await harness()
})
afterEach(() => h.cleanup())

const opts = { toolCallId: 't1', messages: [] } as unknown as ToolExecutionOptions<never>
const run = (tools: ReturnType<typeof toolsFromContract>, name: string, input: unknown) =>
  (tools[name].execute as (i: unknown, o: unknown) => Promise<unknown>)(input, opts)

describe('toolsFromContract', () => {
  it('read-only: one ohhi_<op> per read op, carrying the contract’s description', () => {
    const tools = toolsFromContract(h.backend, { mutates: false })
    const names = Object.keys(tools)
    expect(names).toContain('ohhi_search')
    expect(names).toContain('ohhi_read')
    for (const write of ['ohhi_write', 'ohhi_patch', 'ohhi_append', 'ohhi_mv', 'ohhi_rm', 'ohhi_restore']) {
      expect(names).not.toContain(write)
    }
    expect(tools.ohhi_search.description).toMatch(/references and snippets/)
  })

  it('mutating: write/patch/append join; mv/rm/restore never reach the in-app agent', () => {
    const names = Object.keys(toolsFromContract(h.backend, { mutates: true }))
    expect(names).toEqual(expect.arrayContaining(['ohhi_write', 'ohhi_patch', 'ohhi_append']))
    for (const never of ['ohhi_mv', 'ohhi_rm', 'ohhi_restore']) expect(names).not.toContain(never)
  })

  it('a tool runs the op over the backend', async () => {
    const tools = toolsFromContract(h.backend, { mutates: false })
    const out = (await run(tools, 'ohhi_read', { path: 'Projects/Editor.md', outline: true })) as { mode: string }
    expect(out.mode).toBe('outline')
  })

  it('an op error reaches the model with its contract code', async () => {
    const tools = toolsFromContract(h.backend, { mutates: false })
    await expect(run(tools, 'ohhi_read', { path: 'Nope.md' })).rejects.toThrow(/^not_found: /)
  })

  it('without proposeEdit, a mutating write goes straight through the backend', async () => {
    const tools = toolsFromContract(h.backend, { mutates: true })
    await run(tools, 'ohhi_patch', { path: 'Areas/CS/JSON.md', old: 'tiny', new: 'small' })
    expect(await h.text('Areas/CS/JSON.md')).toContain('A small note.')
  })

  describe('with proposeEdit', () => {
    const proposals: ProposeEditInput[] = []
    const proposeEdit = vi.fn(async (input: ProposeEditInput): Promise<SuggestionRecord> => {
      proposals.push(input)
      return {
        id: `sg-${proposals.length}`, path: input.path, origin: input.origin, at: 0,
        range: { from: input.from, to: input.to }, baseText: input.baseText, proposedText: input.proposedText, status: 'pending',
      }
    })
    beforeEach(() => {
      proposals.length = 0
    })

    it('patch proposes the changed span and writes nothing, journals nothing', async () => {
      const before = await h.text('Projects/Editor.md')
      const tools = toolsFromContract(h.backend, { mutates: true, proposeEdit, origin: ORIGIN })
      const out = await run(tools, 'ohhi_patch', { path: 'Projects/Editor.md', old: 'Files are canonical.', new: 'Files are the source of truth.' })
      expect(out).toMatchObject({ schema: 'ohhi.proposal.v1', proposed: true, suggestionId: 'sg-1', path: 'Projects/Editor.md' })
      expect(proposals).toHaveLength(1)
      const p = proposals[0]
      expect(p.origin).toEqual(ORIGIN)
      expect(before.slice(p.from, p.to)).toBe(p.baseText)
      expect(before.slice(0, p.from) + p.proposedText + before.slice(p.to)).toBe(before.replace('Files are canonical.', 'Files are the source of truth.'))
      expect(p.baseText.length).toBeLessThan(25)
      expect(await h.text('Projects/Editor.md')).toBe(before)
      expect(await h.backend.journal.list('Projects/Editor.md')).toEqual([])
    })

    it('append proposes an insertion at the section’s end, by the op’s own placement rule', async () => {
      const before = await h.text('Projects/Editor.md')
      const tools = toolsFromContract(h.backend, { mutates: true, proposeEdit, origin: ORIGIN })
      await run(tools, 'ohhi_append', { path: 'Projects/Editor.md', section: 'Decisions', text: '- Agents propose.' })
      const p = proposals[0]
      expect(p.baseText).toBe('')
      expect(p.proposedText).toContain('- Agents propose.')
      expect(before.slice(0, p.from)).toContain('- CRDTs handle sync.')
      expect(await h.text('Projects/Editor.md')).toBe(before)
    })

    it('write of a new note proposes the whole text over an empty range', async () => {
      const tools = toolsFromContract(h.backend, { mutates: true, proposeEdit, origin: ORIGIN })
      await run(tools, 'ohhi_write', { path: 'Inbox/New.md', text: '# New\n' })
      expect(proposals[0]).toMatchObject({ path: 'Inbox/New.md', from: 0, to: 0, baseText: '', proposedText: '# New\n' })
      expect(await h.backend.exists('Inbox/New.md')).toBeNull()
    })

    it('an op refusal is still a refusal (patch’s uniqueness rule), and nothing is proposed', async () => {
      const tools = toolsFromContract(h.backend, { mutates: true, proposeEdit, origin: ORIGIN })
      await expect(run(tools, 'ohhi_patch', { path: 'Projects/Editor.md', old: 'nowhere to be found', new: 'x' })).rejects.toThrow(/^refused: /)
      expect(proposals).toHaveLength(0)
    })

    it('an edit that changes nothing proposes nothing', async () => {
      const tools = toolsFromContract(h.backend, { mutates: true, proposeEdit, origin: ORIGIN })
      const out = await run(tools, 'ohhi_patch', { path: 'Areas/CS/JSON.md', old: 'tiny', new: 'tiny' })
      expect(out).toMatchObject({ proposed: false })
      expect(proposals).toHaveLength(0)
    })

    it('read tools are untouched by proposeEdit', async () => {
      const tools = toolsFromContract(h.backend, { mutates: true, proposeEdit, origin: ORIGIN })
      expect(tools.ohhi_patch.description).toMatch(/PROPOSED as a suggestion/)
      expect(tools.ohhi_search.description).not.toMatch(/PROPOSED/)
    })
  })
})
