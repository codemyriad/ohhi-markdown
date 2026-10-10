import { afterEach, describe, expect, it } from 'vitest'
import { OP_SCHEMAS, runOp } from '../src/index.js'
import {
  loadSkill,
  loadSkills,
  parseFarmManifest,
  parseSkill,
  parseSkillsState,
  planFarm,
  readSkillFrontmatter,
  skillsCatalog,
  usableSkills,
  type SkillFs,
} from '../src/skills.js'
import { FIXTURE_SKILLS, FIXTURE_VALID_SKILLS } from './fixture.js'
import { harness, type Harness } from './harness.js'

const open: Harness[] = []
afterEach(async () => {
  while (open.length) await open.pop()!.cleanup()
})
const h = async (): Promise<Harness> => {
  const v = await harness()
  open.push(v)
  return v
}

/** An in-memory `SkillFs` over a path → text map. */
const memFs = (files: Record<string, string>): SkillFs => ({
  list: async (dir) => Object.keys(files).filter((p) => p.startsWith(`${dir}/`)).sort(),
  read: async (path) => files[path] ?? null,
})

const skillMd = (front: string, body = 'Do the thing.\n'): string => `---\n${front}\n---\n\n${body}`

describe('the frontmatter reader', () => {
  it('reads plain, quoted and folded scalars, lists and a one-level map', () => {
    const read = readSkillFrontmatter(
      [
        '---',
        'name: line-edit',
        "license: 'MIT'",
        'description: >',
        '  First line',
        '  continues.',
        '',
        '  New paragraph.',
        'allowed-tools: [Read, Grep]',
        'tags:',
        '  - a',
        '  - b',
        'metadata:',
        '  ohhi-kind: transform',
        '  ohhi-version: "1.2"',
        '---',
        'Body',
      ].join('\n')
    )
    expect(read?.ok).toBe(true)
    expect(read?.fields.get('name')).toBe('line-edit')
    expect(read?.fields.get('license')).toBe('MIT')
    expect(read?.fields.get('description')).toBe('First line continues.\nNew paragraph.\n')
    expect(read?.fields.get('allowed-tools')).toEqual(['Read', 'Grep'])
    expect(read?.fields.get('tags')).toEqual(['a', 'b'])
    expect(read?.fields.get('metadata')).toEqual({ 'ohhi-kind': 'transform', 'ohhi-version': '1.2' })
    expect(read?.body).toBe('Body')
  })

  it('keeps a literal block’s newlines and strips with `|-`', () => {
    const read = readSkillFrontmatter('---\ndescription: |-\n  one\n  two\n---\n')
    expect(read?.fields.get('description')).toBe('one\ntwo')
  })

  it('answers null without a block, and marks a nested map', () => {
    expect(readSkillFrontmatter('# no block')).toBeNull()
    expect(readSkillFrontmatter('---\nname: x\n')).toBeNull()
    const nested = readSkillFrontmatter('---\nmetadata:\n  a:\n    b: c\n---\n')
    expect(nested?.fields.get('metadata')).toEqual({ nested: true })
  })
})

describe('parseSkill validates per the spec', () => {
  const dir = '.agents/skills/line-edit'

  it('a valid skill has no problems and carries the ohhi fields', () => {
    const { meta, body } = parseSkill(
      dir,
      skillMd('name: line-edit\ndescription: Polish prose.\nmetadata:\n  ohhi-kind: transform\n  ohhi-input: selection\n  ohhi-output: replace'),
      [`${dir}/SKILL.md`]
    )
    expect(meta).toEqual({
      name: 'line-edit',
      description: 'Polish prose.',
      dir,
      metadata: { 'ohhi-kind': 'transform', 'ohhi-input': 'selection', 'ohhi-output': 'replace' },
      kind: 'transform',
      input: 'selection',
      output: 'replace',
      hasScripts: false,
      problems: [],
    })
    expect(body).toBe('Do the thing.\n')
  })

  it.each([
    ['name: Line_Edit\ndescription: d', 'name-format'],
    ['name: other\ndescription: d', 'name-mismatch'],
    ['description: d', 'name-missing'],
    ['name: line-edit', 'description-missing'],
    [`name: line-edit\ndescription: ${'x'.repeat(1025)}`, 'description-length'],
    [`name: line-edit\ndescription: d\ncompatibility: ${'x'.repeat(501)}`, 'compatibility-length'],
    ['name: line-edit\ndescription: d\nmetadata:\n  a:\n    b: c', 'metadata-nested'],
    ['name: line-edit\ndescription: d\nmetadata:\n  ohhi-kind: rewrite', 'metadata-kind'],
    ['name: line-edit\ndescription: d\nmetadata:\n  ohhi-input: page', 'metadata-input'],
    ['name: line-edit\ndescription: d\nmetadata:\n  ohhi-output: email', 'metadata-output'],
    ['name: line-edit\ndescription: d\ncontext: fork', 'lint-context'],
    ['name: line-edit\ndescription: d\nhooks: x', 'lint-hooks'],
  ])('%s → %s', (front, problem) => {
    expect(parseSkill(dir, skillMd(front)).meta.problems).toContain(problem)
  })

  it('reserves `anthropic`, `claude` and `synced` in a name', () => {
    expect(parseSkill('.agents/skills/claude-helper', skillMd('name: claude-helper\ndescription: d')).meta.problems).toContain('name-reserved')
    expect(parseSkill('.agents/skills/synced', skillMd('name: synced\ndescription: d')).meta.problems).toContain('name-reserved')
  })

  it('flags a body over 500 lines and a `!`cmd`` injection', () => {
    const long = parseSkill(dir, skillMd('name: line-edit\ndescription: d', 'x\n'.repeat(600)))
    expect(long.meta.problems).toContain('body-length')
    const bang = parseSkill(dir, skillMd('name: line-edit\ndescription: d', 'Today is !`date`.\n'))
    expect(bang.meta.problems).toContain('lint-command')
  })

  it('a missing block is a problem, and the whole text is the body', () => {
    const { meta, body } = parseSkill(dir, '# Just a note\n')
    expect(meta.problems).toEqual(expect.arrayContaining(['frontmatter-missing', 'name-missing', 'description-missing']))
    expect(meta.name).toBe('line-edit')
    expect(body).toBe('# Just a note\n')
  })

  it('hasScripts follows a scripts/ folder', () => {
    const { meta } = parseSkill(dir, skillMd('name: line-edit\ndescription: d'), [`${dir}/SKILL.md`, `${dir}/scripts/run.py`])
    expect(meta.hasScripts).toBe(true)
  })
})

describe('loadSkills / loadSkill', () => {
  const fs = memFs({
    '.agents/skills/b-skill/SKILL.md': skillMd('name: b-skill\ndescription: B'),
    '.agents/skills/a-skill/SKILL.md': skillMd('name: a-skill\ndescription: A'),
    '.agents/skills/a-skill/references/x.md': 'ref',
    '.agents/skills/no-skill-md/README.md': 'not a skill',
    '.agents/skills/a-skill/nested/SKILL.md': skillMd('name: nested\ndescription: deep'),
  })

  it('finds `<root>/<name>/SKILL.md` only, sorted', async () => {
    expect((await loadSkills(fs)).map((m) => m.name)).toEqual(['a-skill', 'b-skill'])
  })

  it('loads one by name, and refuses a name that climbs out', async () => {
    expect((await loadSkill(fs, 'a-skill'))?.body).toBe('Do the thing.\n')
    expect(await loadSkill(fs, 'nope')).toBeNull()
    expect(await loadSkill(fs, '../x')).toBeNull()
    expect(await loadSkill(fs, '.hidden')).toBeNull()
  })
})

describe('skillsCatalog', () => {
  it('renders the spec’s <available_skills> block for valid skills, escaped; empty → ""', () => {
    expect(
      skillsCatalog([
        { name: 'a', description: 'Use <when> & why', dir: '.agents/skills/a', problems: [] },
        { name: 'B', description: 'broken', dir: '.agents/skills/B', problems: ['name-format'] },
      ])
    ).toBe(
      [
        '<available_skills>',
        '  <skill>',
        '    <name>a</name>',
        '    <description>Use &lt;when&gt; &amp; why</description>',
        '    <location>.agents/skills/a/SKILL.md</location>',
        '  </skill>',
        '</available_skills>',
      ].join('\n')
    )
    expect(skillsCatalog([])).toBe('')
  })
})

describe('skills.json and the farm plan', () => {
  it('parses leniently: malformed rows dropped, absent file is null', () => {
    expect(parseSkillsState(null)).toBeNull()
    expect(parseSkillsState('not json')).toEqual({})
    expect(
      parseSkillsState(JSON.stringify({ a: { enabled: true, trusted: false, installedAt: 5, sha: 'abc' }, b: { enabled: 'yes' } }))
    ).toEqual({ a: { enabled: true, trusted: false, installedAt: 5, sha: 'abc' } })
  })

  it('usable = valid, and trusted+enabled when there is state', () => {
    const metas = [
      { name: 'ok', problems: [] },
      { name: 'bad', problems: ['name-format'] },
      { name: 'off', problems: [] },
      { name: 'new', problems: [] },
    ]
    expect(usableSkills(metas, null).map((m) => m.name)).toEqual(['ok', 'off', 'new'])
    const state = {
      ok: { enabled: true, trusted: true, installedAt: 0 },
      off: { enabled: false, trusted: true, installedAt: 0 },
    }
    expect(usableSkills(metas, state).map((m) => m.name)).toEqual(['ok'])
  })

  it('never touches a folder the manifest does not record; removes only its own', () => {
    const manifest = parseFarmManifest(JSON.stringify({ version: 1, skills: { old: { by: 'cli', kind: 'symlink' }, keep: { by: 'app', kind: 'copy', files: ['x'] } } }))
    expect(planFarm({ wanted: ['keep', 'mine', 'theirs'], manifest, present: ['old', 'keep', 'theirs'] })).toEqual({
      write: ['keep', 'mine'],
      remove: ['old'],
      blocked: ['theirs'],
    })
    expect(parseFarmManifest('{"version":2}')).toEqual({ version: 1, skills: {} })
  })
})

describe('the skills and skill ops over the fixture vault', () => {
  it('skills lists every folder with its problems, and conforms', async () => {
    const { backend } = await h()
    const out = await runOp(backend, 'skills', {})
    expect(OP_SCHEMAS.skills.output.safeParse(out).success).toBe(true)
    expect(out.dir).toBe('.agents/skills')
    expect(out.skills.map((s) => s.dir.split('/').pop())).toEqual([...FIXTURE_SKILLS])
    expect(out.skills.filter((s) => s.problems.length === 0).map((s) => s.name)).toEqual([...FIXTURE_VALID_SKILLS])
    const factCheck = out.skills.find((s) => s.name === 'fact-check')
    expect(factCheck).toMatchObject({ kind: 'check', input: 'section', output: 'annotate', hasScripts: true })
    expect(out.skills.find((s) => s.name === 'Bad_Name')?.problems).toEqual(expect.arrayContaining(['name-format']))
    expect(out.skills.find((s) => s.name === 'deep-meta')?.problems).toEqual(['metadata-nested'])
    expect(out).toMatchObject({ returned: 4, total: 4, nextCursor: null })
  })

  it('pages', async () => {
    const { backend } = await h()
    const first = await runOp(backend, 'skills', { limit: 3 })
    expect(first.returned).toBe(3)
    const second = await runOp(backend, 'skills', { limit: 3, cursor: first.nextCursor! })
    expect(second.skills.map((s) => s.name)).toEqual(['line-edit'])
  })

  it('skill returns meta and body; an unknown name is not_found', async () => {
    const { backend } = await h()
    const out = await runOp(backend, 'skill', { name: 'line-edit' })
    expect(OP_SCHEMAS.skill.output.safeParse(out).success).toBe(true)
    expect(out.meta).toMatchObject({ name: 'line-edit', kind: 'transform', license: 'MIT', problems: [] })
    expect(out.meta.description).toBe('Tighten prose for rhythm and word choice without changing meaning. Use when asked to polish a paragraph or selection.')
    expect(out.body).toBe('# Line edit\n\nShorten long sentences. Prefer concrete verbs.\n')
    await expect(runOp(backend, 'skill', { name: 'nope' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(runOp(backend, 'skill', {})).rejects.toMatchObject({ code: 'usage' })
  })
})
