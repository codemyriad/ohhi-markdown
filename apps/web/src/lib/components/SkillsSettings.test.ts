// @vitest-environment jsdom
/**
 * Settings › AI › Skills (writing-harness B9): the list with its trust gate,
 * review-before-trust, *New skill…*, the GitHub import, *Open*, and the farm
 * setting's two platforms.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { SimClock } from '@ohhi/testkit'
import { MemVaultAdapter } from '@ohhi/vault'
import { SKILLS_STATE_PATH } from '@ohhi/harness/skills'
import { fakeViewShell } from '../readouts.fixture.js'
import { createSkills, pickSkill, type SkillsHost } from '../skills.svelte.js'
import { viewShellContext } from '../views.js'
import SkillsSettings from './SkillsSettings.svelte'

afterEach(cleanup)

const t = getLL().web.ai.skills
const md = (name: string, extra = ''): string => `---\nname: ${name}\ndescription: ${name} does a thing.\n${extra}---\n\nDo it.\n`

function store(files: Record<string, string>, opts: { farm?: boolean } = {}) {
  const vault = new Map(Object.entries(files))
  const app = new Map<string, string>()
  const clock = new SimClock()
  const host: SkillsHost = {
    fs: {
      list: async (dir) => [...vault.keys()].filter((p) => p.startsWith(`${dir}/`)).sort(),
      read: async (p) => vault.get(p) ?? null,
    },
    readState: async () => app.get(SKILLS_STATE_PATH) ?? null,
    writeState: async (text) => void app.set(SKILLS_STATE_PATH, text),
    createFile: async (dir, name, text) => {
      vault.set(`${dir}/${name}`, text)
      return `${dir}/${name}`
    },
    clock,
    ...(opts.farm ? { farm: { fs: new MemVaultAdapter(), enabled: () => true, setEnabled: () => {} } } : {}),
  }
  return { skills: createSkills(host), vault }
}

function show(props: Record<string, unknown>) {
  const shell = fakeViewShell()
  render(SkillsSettings, { props: { desktop: false, ...props }, context: viewShellContext(shell) })
  return { shell, user: userEvent.setup() }
}

describe('Settings › AI › Skills', () => {
  it('with no vault open, says so', () => {
    show({ skills: null })
    expect(screen.getByTestId('ai-skills-no-vault')).toHaveTextContent(t.no_vault())
    expect(screen.queryByTestId('ai-skills-new')).toBeNull()
  })

  it('lists a synced-in skill as needing review, its switch off until trusted; problems in words', async () => {
    const { skills } = store({
      '.agents/skills/line-edit/SKILL.md': md('line-edit', 'metadata:\n  ohhi-kind: transform\n  ohhi-input: selection\n  ohhi-output: replace\n'),
      '.agents/skills/line-edit/scripts/run.sh': 'echo',
      '.agents/skills/Bad/SKILL.md': md('Bad'),
    })
    show({ skills })
    const row = await screen.findByTestId('ai-skill:line-edit')
    expect(within(row).getByTestId('ai-skill-trust:line-edit')).toHaveTextContent(t.untrusted())
    expect(within(row).getByTestId('ai-skill-shape:line-edit')).toHaveTextContent(
      t.shape({ kind: t.kind.transform(), input: t.input.selection(), output: t.output.replace() })
    )
    expect(within(row).getByTestId('ai-skill-scripts:line-edit')).toBeInTheDocument()
    expect(screen.getByTestId('ai-skill-enabled:line-edit')).toBeDisabled()
    expect(screen.getByTestId('ai-skill-invalid:Bad')).toBeInTheDocument()
    expect(screen.getByTestId('ai-skill-problems:Bad')).toHaveTextContent(t.problem.name_format())
  })

  it('Review shows the skill before it is trusted; Trust and enable turns it on', async () => {
    const { skills } = store({ '.agents/skills/line-edit/SKILL.md': md('line-edit', 'allowed-tools: Bash\n') })
    const { user } = show({ skills })
    await user.click(await screen.findByTestId('ai-skill-review:line-edit'))
    const dialog = await screen.findByTestId('skill-import-dialog')
    expect(within(dialog).getByTestId('skill-review-skillmd')).toHaveTextContent('Do it.')
    expect(within(dialog).getByTestId('skill-review-files')).toHaveTextContent('SKILL.md')
    expect(within(dialog).getByTestId('skill-review-tools')).toHaveTextContent('Bash')
    await user.click(within(dialog).getByTestId('skill-import-trust'))
    await waitFor(() => expect(screen.getByTestId('ai-skill-trust:line-edit')).toHaveTextContent(t.trusted()))
    expect(screen.getByTestId('ai-skill-enabled:line-edit')).toBeChecked()
    expect(screen.getByTestId('ai-skill-enabled:line-edit')).not.toBeDisabled()
    expect((await skills.source().list()).map((m) => m.name)).toEqual(['line-edit'])
    // Unchecking disables it for the agent.
    await user.click(screen.getByTestId('ai-skill-enabled:line-edit'))
    await waitFor(async () => expect(await skills.source().list()).toEqual([]))
  })

  it('New skill writes the template, opens it, and lists it as trusted', async () => {
    const { skills, vault } = store({})
    const { shell, user } = show({ skills })
    expect(await screen.findByTestId('ai-skills-empty')).toHaveTextContent(t.empty())
    await user.click(screen.getByTestId('ai-skills-new'))
    await user.type(screen.getByTestId('ai-skills-create-name'), 'Bad Name')
    await user.click(screen.getByTestId('ai-skills-create-submit'))
    expect(await screen.findByTestId('field-errors:name')).toHaveTextContent(t.create.name_invalid())
    await user.clear(screen.getByTestId('ai-skills-create-name'))
    await user.type(screen.getByTestId('ai-skills-create-name'), 'pitch-editor')
    await user.click(screen.getByTestId('ai-skills-create-submit'))
    await waitFor(() => expect(shell.openPath).toHaveBeenCalledWith('.agents/skills/pitch-editor/SKILL.md'))
    expect(vault.get('.agents/skills/pitch-editor/SKILL.md')).toContain('name: pitch-editor')
    expect(await screen.findByTestId('ai-skill-trust:pitch-editor')).toHaveTextContent(t.trusted())
    await user.click(screen.getByTestId('ai-skill-open:pitch-editor'))
    expect(shell.openPath).toHaveBeenLastCalledWith('.agents/skills/pitch-editor/SKILL.md')
  })

  it('imports from GitHub after review, pinned to the commit', async () => {
    const { skills, vault } = store({})
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/commits/main')) return Response.json({ sha: 'cafef00d1234567890' })
      if (u.includes('/contents/')) return Response.json([{ type: 'file', path: 'skills/tidy/SKILL.md', size: 10, download_url: 'https://raw/tidy' }])
      if (u === 'https://raw/tidy') return new Response(md('tidy') + 'See https://example.com\n')
      return new Response('', { status: 404 })
    }) as unknown as typeof fetch
    const { user } = show({ skills, fetchImpl })
    await user.click(await screen.findByTestId('ai-skills-import'))
    const dialog = await screen.findByTestId('skill-import-dialog')
    await user.type(within(dialog).getByTestId('skill-import-source'), 'https://github.com/o/r/tree/main/skills/tidy')
    await user.click(within(dialog).getByTestId('skill-import-fetch'))
    expect(await within(dialog).findByTestId('skill-review-sha')).toHaveTextContent('cafef00d1234')
    expect(within(dialog).getByTestId('skill-review-urls')).toHaveTextContent('https://example.com')
    await user.click(within(dialog).getByTestId('skill-import-trust'))
    expect(await screen.findByTestId('ai-skill-trust:tidy')).toHaveTextContent(t.trusted())
    expect(vault.has('.agents/skills/tidy/SKILL.md')).toBe(true)
    expect(screen.getByTestId('ai-skills-status')).toHaveTextContent(t.import_dialog.imported({ name: 'tidy' }))
  })

  it('a bad source is refused at the field', async () => {
    const { skills } = store({})
    const { user } = show({ skills })
    await user.click(await screen.findByTestId('ai-skills-import'))
    await user.type(screen.getByTestId('skill-import-source'), 'not a repo')
    await user.click(screen.getByTestId('skill-import-fetch'))
    expect(await screen.findByTestId('field-errors:source')).toHaveTextContent(t.import_dialog.bad_source())
  })

  it('the farm: a toggle where a disk exists, the reason in the browser', async () => {
    show({ skills: store({}).skills, desktop: false })
    expect(await screen.findByTestId('ai-skills-farm-unavailable')).toHaveTextContent(t.farm.browser())
    cleanup()
    show({ skills: store({}, { farm: true }).skills, desktop: true })
    expect(await screen.findByTestId('ai-skills-farm')).toBeChecked()
  })
})

describe('ai.run-skill’s picker', () => {
  const meta = (name: string) => ({ name, description: `${name} does a thing.`, dir: `.agents/skills/${name}`, metadata: {}, hasScripts: false, problems: [] })

  it('filters as you type and resolves with the pick', async () => {
    const user = userEvent.setup()
    const picked = pickSkill([meta('line-edit'), meta('fact-check')], 'Run a skill')
    const input = await screen.findByTestId('skill-picker-input')
    expect(screen.getAllByTestId('skill-picker-row')).toHaveLength(2)
    await user.type(input, 'fact')
    expect(screen.getAllByTestId('skill-picker-row')).toHaveLength(1)
    await user.keyboard('{Enter}')
    expect((await picked)?.name).toBe('fact-check')
    await waitFor(() => expect(screen.queryByTestId('skill-picker-input')).toBeNull())
  })

  it('resolves null when dismissed', async () => {
    const picked = pickSkill([meta('line-edit')], 'Run a skill')
    await screen.findByTestId('skill-picker-input')
    await userEvent.setup().keyboard('{Escape}')
    expect(await picked).toBeNull()
  })
})
