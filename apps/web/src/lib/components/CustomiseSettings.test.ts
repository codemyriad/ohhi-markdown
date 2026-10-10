// @vitest-environment jsdom
/**
 * Settings › Customise (settings-shaping ST4; quiet-shell F16): the roots in
 * precedence order, one row per kind with its source pill, a broken layout
 * file listed under Problems until it is fixed (Reload runs
 * `app.reload-resources`), and the read-only verbs — Copy path, Copy as
 * JSON, the agent prompt filled with the vault's folder.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { CommandRegistry } from '../commands.js'
import { LAYOUT_SCHEMA_ID, NO_OVERRIDES, PRESETS, type ShellSpec } from '../layout-spec.js'
import { fakeVault } from '../resources.fixture.js'
import { createResources } from '../resources.svelte.js'
import { settingsEnvContext, type SettingsEnv, type SettingsVault } from '../settings-host.js'
import CustomiseSettings from './CustomiseSettings.svelte'

afterEach(() => cleanup())

const $schema = LAYOUT_SCHEMA_ID
const t = getLL().web.settings.customise
const DESKTOP_VAULT: SettingsVault = { name: 'black book', kind: 'tauri', path: '/home/me/black book' }

function env(vault: SettingsVault | null, desktop: boolean): SettingsEnv {
  return { vaultOpen: vault !== null, vault, desktop, host: 'view', openSection: vi.fn() }
}

function setup(opts: {
  files: Record<string, unknown>
  vault?: SettingsVault
  desktop?: boolean
  held?: boolean
  openGuide?: (page: string) => void
  showLog?: () => void
}) {
  const v = fakeVault(opts.files)
  const resources = createResources({ vault: () => v.vault, userRoot: async () => null, warn: () => {} })
  const registry = new CommandRegistry(false)
  const reload = vi.fn(() => resources.reloadAll())
  registry.register({ id: 'app.reload-resources', title: 'Reload', run: reload })
  const layout = {
    fileSpec: PRESETS.default as ShellSpec,
    ownSpec: PRESETS.default as ShellSpec,
    overrides: NO_OVERRIDES,
    setOverrides: vi.fn(),
    resetOverrides: vi.fn(),
    active: 'default' as const,
    source: { name: 'default', root: 'builtin' as const, path: 'built-in', shadows: [] },
    specError: null,
    held: opts.held ?? false,
  }
  const write = vi.fn(async (_text: string) => {})
  const vault = opts.vault ?? DESKTOP_VAULT
  render(CustomiseSettings, {
    props: {
      registry,
      resources,
      layout,
      write,
      ...(opts.openGuide ? { openGuide: opts.openGuide } : {}),
      ...(opts.showLog ? { showLog: opts.showLog } : {}),
    },
    context: settingsEnvContext(env(vault, opts.desktop ?? true)),
  })
  return { disk: v.disk, reload, write }
}

describe('Settings › Customise', () => {
  it('a broken layout file is listed under Problems, and stays until it is fixed', async () => {
    const user = userEvent.setup()
    const { disk, reload } = setup({
      files: {
        '.ohhi/layouts/focus.json': '{ "extends": "default",',
        '.ohhi/layouts/dense.json': { $schema, extends: 'default' },
      },
    })
    const problem = await screen.findByTestId('customise-problem:.ohhi/layouts/focus.json')
    expect(problem).toHaveTextContent('not JSON')
    expect(problem).toHaveTextContent(t.problem_unused())
    expect(problem).toHaveTextContent(t.from.vault())
    expect(screen.getByText(t.problems_count({ count: 1 }))).toBeVisible()
    // The kinds table marks it too.
    expect(screen.getByTestId('customise-entry:layouts:focus')).toHaveTextContent(t.cant_use())

    // Reload with the file still broken: still listed.
    await user.click(screen.getByTestId('customise-reload'))
    expect(reload).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.getByTestId('customise-problem:.ohhi/layouts/focus.json')).toBeVisible())

    // Fixed on disk, then reloaded: gone.
    disk.set('.ohhi/layouts/focus.json', JSON.stringify({ $schema, extends: 'default' }))
    await user.click(screen.getByTestId('customise-reload'))
    expect(await screen.findByTestId('customise-problems-none')).toHaveTextContent(t.problems_none())
    expect(screen.queryByTestId('customise-problem:.ohhi/layouts/focus.json')).toBeNull()
  })

  it('shows the roots in order, each kind in use with its source, and what else is there', async () => {
    setup({
      files: {
        '.ohhi/layouts/dense.json': { $schema, extends: 'default' },
        '.ohhi/templates/standup.md': '# Standup\n',
      },
    })
    const roots = screen.getByTestId('customise-roots')
    const items = within(roots).getAllByRole('listitem')
    expect(items.map((li) => li.dataset.testid)).toEqual([
      'customise-root:vault',
      'customise-root:user',
      'customise-root:builtin',
    ])
    expect(screen.getByTestId('customise-root-path:vault')).toHaveTextContent('/home/me/black book/.ohhi')
    expect(screen.getByTestId('customise-root:user')).toHaveTextContent(t.detail.unreadable())

    const layout = screen.getByTestId('customise-in-use:layouts')
    expect(layout).toHaveTextContent('default')
    expect(layout).toHaveTextContent(t.from.builtin())
    expect(await screen.findByTestId('customise-entry:layouts:dense')).toHaveTextContent(t.from.vault())
    expect(await screen.findByTestId('customise-entry:templates:standup')).toBeVisible()
    expect(screen.getByTestId('customise-in-use:themes')).toHaveTextContent(t.from.builtin())
  })

  it('copies the layout in use as JSON, a file’s path on disk, and the agent prompt with the vault’s folder', async () => {
    const user = userEvent.setup()
    const { write } = setup({ files: { '.ohhi/layouts/focus.json': 'nope' } })
    await screen.findByTestId('customise-problem:.ohhi/layouts/focus.json')

    await user.click(screen.getByTestId('customise-copy-json:layouts'))
    expect(JSON.parse(write.mock.calls.at(-1)![0])).toEqual(PRESETS.default)
    expect(screen.getByTestId('customise-status')).toHaveTextContent(t.copied())

    await user.click(screen.getByTestId('customise-problem-copy-path'))
    expect(write.mock.calls.at(-1)![0]).toBe('/home/me/black book/.ohhi/layouts/focus.json')

    expect(screen.getByTestId('customise-prompt')).toHaveTextContent('/home/me/black book')
    await user.click(screen.getByTestId('customise-copy-prompt'))
    expect(write.mock.calls.at(-1)![0]).toBe(t.agent_prompt({ vault: '/home/me/black book' }))
  })

  it('in the browser: no config folder, no copyable folders, and the honest word about agents', async () => {
    setup({ files: {}, vault: { name: 'notes', kind: 'opfs' }, desktop: false })
    expect(screen.getByTestId('customise-root:vault')).toHaveTextContent('.ohhi, in this browser')
    expect(screen.getByTestId('customise-root:user')).toHaveTextContent(t.detail.desktop_only())
    expect(screen.queryByTestId('customise-root-copy:vault')).toBeNull()
    expect(screen.queryByTestId('customise-prompt')).toBeNull()
    expect(screen.getByTestId('customise-agent-browser')).toHaveTextContent(t.agent_browser())
    expect(await screen.findByTestId('customise-problems-none')).toBeVisible()
  })
})

describe('Settings › Customise — doors (settings-shaping ST6)', () => {
  it('Read the guide opens the customise guide page; Show in Log is offered only when the host can open it', async () => {
    const user = userEvent.setup()
    const openGuide = vi.fn()
    const showLog = vi.fn()
    setup({ files: {}, openGuide, showLog })
    const link = screen.getByTestId('customise-guide')
    expect(link).toHaveAccessibleName(t.read_guide_label())
    await user.click(link)
    expect(openGuide).toHaveBeenCalledExactlyOnceWith('customise')
    await user.click(screen.getByTestId('customise-show-log'))
    expect(showLog).toHaveBeenCalledOnce()
    cleanup()
    setup({ files: {} })
    expect(screen.queryByTestId('customise-show-log')).toBeNull()
  })

  it('a reload’s Undo taken: the layout row says it is held for this session', () => {
    setup({ files: {}, held: true })
    expect(screen.getByTestId('customise-held')).toHaveTextContent(t.held())
    cleanup()
    setup({ files: {} })
    expect(screen.queryByTestId('customise-held')).toBeNull()
  })
})
