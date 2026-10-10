import { describe, expect, it } from 'vitest'
import { lstat, mkdir, readFile, readlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseCommand } from '../src/grammar.js'
import { fixture, inVault, ohhi } from './helpers.js'

const exists = async (p: string): Promise<boolean> => lstat(p).then(() => true, () => false)

describe('ohhi skills / skill (text)', () => {
  it('lists every skill with its shape and problems', async () => {
    const v = await fixture()
    const { out, err, code } = await ohhi(inVault(v, ['skills']))
    expect(code).toBe(0)
    expect(out).toMatch(/^line-edit\s+transform\/selection\/replace\s+Tighten prose/m)
    expect(out).toMatch(/^fact-check .*scripts=true/m)
    expect(out).toMatch(/^Bad_Name .*problems=name-format/m)
    expect(err).toContain('returned=4 total=4')
  })

  it('prints a skill’s instructions on stdout and its facts on stderr', async () => {
    const v = await fixture()
    const { out, err, code } = await ohhi(inVault(v, ['skill', 'line-edit']))
    expect(code).toBe(0)
    expect(out).toBe('# Line edit\n\nShorten long sentences. Prefer concrete verbs.\n')
    expect(err).toContain('kind=transform')
    const missing = await ohhi(inVault(v, ['skill', 'nope']))
    expect(missing.code).toBe(1)
  })
})

describe('ohhi skills export', () => {
  it('parses as a host command, not an op', () => {
    expect(parseCommand(['skills', 'export', '--dry-run'])).toMatchObject({ kind: 'skills-export', dryRun: true })
    expect(parseCommand(['skills'])).toMatchObject({ kind: 'op', op: 'skills' })
    expect(() => parseCommand(['skills', 'export', 'extra'])).toThrow(/no positional/)
    expect(() => parseCommand(['skills', 'export', '--limit', '3'])).toThrow(/not a flag/)
  })

  it('with no skills.json, links every valid skill and records them', async () => {
    const v = await fixture()
    const { out, code } = await ohhi(inVault(v, ['skills', 'export', '--json']))
    expect(code).toBe(0)
    expect(JSON.parse(out)).toEqual({
      schema: 'ohhi.skills-export.v1',
      dir: '.claude/skills',
      linked: ['fact-check', 'line-edit'],
      removed: [],
      blocked: [],
      dryRun: false,
    })
    const link = join(v.root, '.claude/skills/line-edit')
    expect(await readlink(link)).toBe('../../.agents/skills/line-edit')
    expect(await readFile(join(link, 'SKILL.md'), 'utf8')).toBe(v.notes['.agents/skills/line-edit/SKILL.md'])
    const manifest = JSON.parse(await readFile(join(v.root, '.claude/skills/.ohhi-farm.json'), 'utf8'))
    expect(manifest).toEqual({
      version: 1,
      skills: { 'fact-check': { by: 'cli', kind: 'symlink' }, 'line-edit': { by: 'cli', kind: 'symlink' } },
    })
    // Idempotent: a second run changes nothing and still succeeds.
    expect((await ohhi(inVault(v, ['skills', 'export', '--json']))).code).toBe(0)
  })

  it('a disabled or untrusted skill loses its link; an unlisted one never gets one', async () => {
    const v = await fixture()
    await ohhi(inVault(v, ['skills', 'export']))
    await mkdir(join(v.root, '.ohhi'), { recursive: true })
    await writeFile(
      join(v.root, '.ohhi/skills.json'),
      JSON.stringify({ 'line-edit': { enabled: false, trusted: true, installedAt: 1 }, 'fact-check': { enabled: true, trusted: true, installedAt: 1 } })
    )
    const { out, code } = await ohhi(inVault(v, ['skills', 'export', '--json']))
    expect(code).toBe(0)
    expect(JSON.parse(out)).toMatchObject({ linked: ['fact-check'], removed: ['line-edit'] })
    expect(await exists(join(v.root, '.claude/skills/line-edit'))).toBe(false)
    expect(await exists(join(v.root, '.agents/skills/line-edit/SKILL.md'))).toBe(true)
  })

  it('never touches a real folder it did not make', async () => {
    const v = await fixture()
    await mkdir(join(v.root, '.claude/skills/line-edit'), { recursive: true })
    await writeFile(join(v.root, '.claude/skills/line-edit/SKILL.md'), 'mine')
    const { out, err } = await ohhi(inVault(v, ['skills', 'export']))
    expect(out).toContain('linked  .claude/skills/fact-check')
    expect(err).toContain('blocked: .claude/skills/line-edit')
    expect(await readFile(join(v.root, '.claude/skills/line-edit/SKILL.md'), 'utf8')).toBe('mine')
  })

  it('--dry-run reports and writes nothing', async () => {
    const v = await fixture()
    const { out } = await ohhi(inVault(v, ['skills', 'export', '--dry-run']))
    expect(out).toContain('would link  .claude/skills/line-edit')
    expect(await exists(join(v.root, '.claude'))).toBe(false)
  })
})
