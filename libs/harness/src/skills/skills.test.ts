import { describe, expect, it } from 'vitest'
import { adapterSkillFs, createSkillSource, emptySkillSource, loadSkills, skillsCatalog } from './index.js'

const enc = new TextEncoder()
const md = (name: string, extra = ''): string => `---\nname: ${name}\ndescription: ${name} does a thing.\n${extra}---\n\nBody of ${name}.\n`

/** A `VaultAdapter`-shaped fake: what the app's store and farm read through. */
function fakeAdapter(files: Record<string, string>) {
  return {
    list: async () => Object.keys(files).map((path) => ({ path })),
    read: async (path: string) => (path in files ? enc.encode(files[path]) : null),
  }
}

const vault = {
  '.agents/skills/a-one/SKILL.md': `﻿${md('a-one')}`,
  '.agents/skills/b-two/SKILL.md': md('b-two'),
  '.agents/skills/Broken/SKILL.md': md('Broken'),
  'notes/x.md': '# not a skill',
}

describe('adapterSkillFs', () => {
  it('lists below a dir and decodes (BOM stripped)', async () => {
    const fs = adapterSkillFs(fakeAdapter(vault))
    expect(await fs.list('.agents/skills/a-one')).toEqual(['.agents/skills/a-one/SKILL.md'])
    expect((await fs.read('.agents/skills/a-one/SKILL.md'))?.startsWith('---')).toBe(true)
    expect(await fs.read('nope')).toBeNull()
    expect((await loadSkills(fs)).map((m) => m.name)).toEqual(['Broken', 'a-one', 'b-two'])
  })
})

describe('createSkillSource', () => {
  it('offers valid skills only, narrowed by allow', async () => {
    const fs = adapterSkillFs(fakeAdapter(vault))
    expect((await createSkillSource(fs).list()).map((m) => m.name)).toEqual(['a-one', 'b-two'])
    const onlyB = createSkillSource(fs, (m) => m.name === 'b-two')
    expect((await onlyB.list()).map((m) => m.name)).toEqual(['b-two'])
    expect(await onlyB.body('b-two')).toBe('Body of b-two.\n')
    expect(await onlyB.body('a-one')).toBeNull()
    expect(await onlyB.body('Broken')).toBeNull()
  })

  it('feeds the catalog', async () => {
    const source = createSkillSource(adapterSkillFs(fakeAdapter(vault)))
    expect(skillsCatalog(await source.list())).toContain('<location>.agents/skills/a-one/SKILL.md</location>')
    expect(await emptySkillSource.list()).toEqual([])
  })
})
