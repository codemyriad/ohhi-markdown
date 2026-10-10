import { describe, expect, it } from 'vitest'
import { createSkillSource, emptySkillSource, loadSkills, skillsCatalog, usableBy, type SkillFs } from '../src/skills/index.js'

const md = (name: string, extra = ''): string => `---\nname: ${name}\ndescription: ${name} does a thing.\n${extra}---\n\nBody of ${name}.\n`

/** An in-memory `SkillFs`. */
const memFs = (files: Record<string, string>): SkillFs => ({
  list: async (dir) => Object.keys(files).filter((p) => p.startsWith(`${dir}/`)).sort(),
  read: async (path) => files[path] ?? null,
})

const vault = {
  '.agents/skills/a-one/SKILL.md': md('a-one'),
  '.agents/skills/b-two/SKILL.md': md('b-two'),
  '.agents/skills/Broken/SKILL.md': md('Broken'),
  'notes/x.md': '# not a skill',
}

describe('createSkillSource', () => {
  it('offers valid skills only, narrowed by allow', async () => {
    const fs = memFs(vault)
    expect((await createSkillSource(fs).list()).map((m) => m.name)).toEqual(['a-one', 'b-two'])
    const onlyB = createSkillSource(fs, (m) => m.name === 'b-two')
    expect((await onlyB.list()).map((m) => m.name)).toEqual(['b-two'])
    expect(await onlyB.body('b-two')).toBe('Body of b-two.\n')
    expect(await onlyB.body('a-one')).toBeNull()
    expect(await onlyB.body('Broken')).toBeNull()
  })

  it('feeds the catalog', async () => {
    const source = createSkillSource(memFs(vault))
    expect(skillsCatalog(await source.list())).toContain('<location>.agents/skills/a-one/SKILL.md</location>')
    expect(await emptySkillSource.list()).toEqual([])
  })
})

describe('createSkillSource with the trust rule', () => {
  it('offers a trusted skill only while its folder still hashes to what was trusted', async () => {
    const a = (await loadSkills(memFs(vault))).find((m) => m.name === 'a-one')!
    const state = { 'a-one': { enabled: true, trusted: true, installedAt: 0, hash: a.hash } }
    expect((await createSkillSource(memFs(vault), usableBy(state)).list()).map((m) => m.name)).toEqual(['a-one'])
    const changed = memFs({ ...vault, '.agents/skills/a-one/scripts/x.sh': 'rm -rf ~' })
    const source = createSkillSource(changed, usableBy(state))
    expect(await source.list()).toEqual([])
    expect(await source.body('a-one')).toBeNull()
  })
})
