/**
 * The app's `.claude/skills/` copy farm (writing-harness B9): copies the
 * wanted skills, re-copies on change, removes only what it made, and shares
 * one manifest with `ohhi skills export`.
 */
import { describe, expect, it } from 'vitest'
import { MemVaultAdapter } from '@ohhi/vault'
import { adapterSkillFs, FARM_MANIFEST, parseFarmManifest } from '@ohhi/harness/skills'
import { clearFarm, syncFarm } from './skills-farm.js'

const enc = new TextEncoder()
const dec = new TextDecoder()

async function vault(files: Record<string, string>): Promise<MemVaultAdapter> {
  const a = new MemVaultAdapter()
  for (const [p, t] of Object.entries(files)) await a.writeAtomic(p, enc.encode(t))
  return a
}
const text = async (a: MemVaultAdapter, p: string): Promise<string | null> => {
  const b = await a.read(p)
  return b ? dec.decode(b) : null
}
const manifest = async (a: MemVaultAdapter) => parseFarmManifest(await text(a, FARM_MANIFEST))

const SKILLS = {
  '.agents/skills/line-edit/SKILL.md': '---\nname: line-edit\n---\nv1\n',
  '.agents/skills/line-edit/references/style.md': 'style',
  '.agents/skills/fact-check/SKILL.md': '---\nname: fact-check\n---\n',
}

describe('syncFarm', () => {
  it('copies every file of each wanted skill and records them', async () => {
    const a = await vault(SKILLS)
    const result = await syncFarm({ fs: a, skills: adapterSkillFs(a), wanted: ['line-edit'] })
    expect(result).toEqual({ written: ['line-edit'], removed: [], blocked: [], linked: [] })
    expect(await text(a, '.claude/skills/line-edit/SKILL.md')).toBe(SKILLS['.agents/skills/line-edit/SKILL.md'])
    expect(await text(a, '.claude/skills/line-edit/references/style.md')).toBe('style')
    expect(await text(a, '.claude/skills/fact-check/SKILL.md')).toBeNull()
    expect((await manifest(a)).skills['line-edit']).toEqual({
      by: 'app',
      kind: 'copy',
      files: ['.claude/skills/line-edit/SKILL.md', '.claude/skills/line-edit/references/style.md'],
    })
  })

  it('re-copies a change and drops a file the skill no longer has', async () => {
    const a = await vault(SKILLS)
    await syncFarm({ fs: a, skills: adapterSkillFs(a), wanted: ['line-edit'] })
    await a.writeAtomic('.agents/skills/line-edit/SKILL.md', enc.encode('---\nname: line-edit\n---\nv2\n'))
    await a.remove('.agents/skills/line-edit/references/style.md')
    await syncFarm({ fs: a, skills: adapterSkillFs(a), wanted: ['line-edit'] })
    expect(await text(a, '.claude/skills/line-edit/SKILL.md')).toContain('v2')
    expect(await text(a, '.claude/skills/line-edit/references/style.md')).toBeNull()
  })

  it('removes its own copy when a skill is no longer wanted (disabled)', async () => {
    const a = await vault(SKILLS)
    await syncFarm({ fs: a, skills: adapterSkillFs(a), wanted: ['line-edit', 'fact-check'] })
    const result = await syncFarm({ fs: a, skills: adapterSkillFs(a), wanted: ['fact-check'] })
    expect(result.removed).toEqual(['line-edit'])
    expect(await text(a, '.claude/skills/line-edit/SKILL.md')).toBeNull()
    expect(await text(a, '.agents/skills/line-edit/SKILL.md')).not.toBeNull()
    expect(Object.keys((await manifest(a)).skills)).toEqual(['fact-check'])
  })

  it('never touches a folder it did not make', async () => {
    const a = await vault({ ...SKILLS, '.claude/skills/line-edit/SKILL.md': 'my own' })
    const result = await syncFarm({ fs: a, skills: adapterSkillFs(a), wanted: ['line-edit'] })
    expect(result.blocked).toEqual(['line-edit'])
    expect(await text(a, '.claude/skills/line-edit/SKILL.md')).toBe('my own')
    expect((await manifest(a)).skills).toEqual({})
  })

  it('leaves a CLI symlink in place while wanted, and asks the platform to remove it when not', async () => {
    const a = await vault({
      ...SKILLS,
      [FARM_MANIFEST]: JSON.stringify({ version: 1, skills: { 'line-edit': { by: 'cli', kind: 'symlink' } } }),
    })
    expect((await syncFarm({ fs: a, skills: adapterSkillFs(a), wanted: ['line-edit'] })).linked).toEqual(['line-edit'])
    const removed: string[] = []
    const fs = { ...a, read: a.read.bind(a), writeAtomic: a.writeAtomic.bind(a), removeDir: a.removeDir.bind(a), remove: async (p: string) => void removed.push(p) }
    const result = await syncFarm({ fs, skills: adapterSkillFs(a), wanted: [] })
    expect(result.removed).toEqual(['line-edit'])
    expect(removed).toEqual(['.claude/skills/line-edit'])
  })

  it('journals the bytes a write replaces, when the host has a journal', async () => {
    const a = await vault(SKILLS)
    await syncFarm({ fs: a, skills: adapterSkillFs(a), wanted: ['fact-check'] })
    const recorded: string[] = []
    const fs = { read: a.read.bind(a), writeAtomic: a.writeAtomic.bind(a), remove: a.remove.bind(a), removeDir: a.removeDir.bind(a), record: async (p: string) => void recorded.push(p) }
    await a.writeAtomic('.agents/skills/fact-check/SKILL.md', enc.encode('changed'))
    await syncFarm({ fs, skills: adapterSkillFs(a), wanted: ['fact-check'] })
    expect(recorded).toEqual(['.claude/skills/fact-check/SKILL.md'])
  })
})

describe('clearFarm', () => {
  it('removes the app’s copies and keeps the CLI’s links', async () => {
    const a = await vault(SKILLS)
    await syncFarm({ fs: a, skills: adapterSkillFs(a), wanted: ['line-edit'] })
    const m = await manifest(a)
    m.skills['fact-check'] = { by: 'cli', kind: 'symlink' }
    await a.writeAtomic(FARM_MANIFEST, enc.encode(JSON.stringify(m)))
    const result = await clearFarm(a)
    expect(result.removed).toEqual(['line-edit'])
    expect(Object.keys((await manifest(a)).skills)).toEqual(['fact-check'])
    expect(await text(a, '.claude/skills/line-edit/SKILL.md')).toBeNull()
  })
})
