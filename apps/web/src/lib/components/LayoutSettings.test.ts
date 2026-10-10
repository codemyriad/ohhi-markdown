// @vitest-environment jsdom
/**
 * Settings › Layout and › Editor (round 3, Q6; settings-shaping ST2): a form
 * over this device's overrides in two parts, applied live — every change
 * goes straight to the layout (no Save, no names), the stored overrides are
 * only what differs from the file, a pinned side says so with *Unpin*, and
 * each part's reset puts back only its own fields.
 */
import { cleanup, render, screen, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import {
  EXAMPLES,
  LAYOUT_SCHEMA_ID,
  NO_OVERRIDES,
  PRESETS,
  applyOverrides,
  type LayoutFile,
  type ShellSpec,
} from '../layout-spec.js'
import { applyPins, withPin, type LayoutPins, type PinSide } from '../pin-layout.js'
import { box } from '../shell-actions.fixture.svelte.js'
import LayoutSettings from './LayoutSettings.svelte'

afterEach(() => cleanup())

const $schema = LAYOUT_SCHEMA_ID
const t = getLL().web.settings.layout

/** The shell layout's override surface, the way `createShellLayout` does it (file → overrides → pins). */
function setup(opts: { file?: ShellSpec; overrides?: LayoutFile; pins?: LayoutPins; part?: 'shell' | 'editor' } = {}) {
  const file = opts.file ?? PRESETS.default
  const overrides = box<LayoutFile>(opts.overrides ?? NO_OVERRIDES)
  const pins = box<LayoutPins>(opts.pins ?? {})
  const layout = {
    get fileSpec(): ShellSpec {
      return file
    },
    get ownSpec(): ShellSpec {
      return applyOverrides(file, overrides.value)
    },
    get spec(): ShellSpec {
      return applyPins(this.ownSpec, pins.value)
    },
    get overrides(): LayoutFile {
      return overrides.value
    },
    get pins(): LayoutPins {
      return pins.value
    },
    setOverrides: vi.fn((next: LayoutFile) => {
      overrides.value = next
    }),
    resetOverrides: vi.fn(() => {
      overrides.value = NO_OVERRIDES
    }),
    unpin: vi.fn((side: PinSide) => {
      pins.value = withPin(pins.value, side, false)
    }),
  }
  render(LayoutSettings, { layout, part: opts.part ?? 'shell' })
  return { layout }
}

const field = (id: string): HTMLSelectElement => screen.getByTestId(`layout-field:${id}`) as HTMLSelectElement

describe('Settings › Layout (round 3, Q6)', () => {
  it('is one form of curated fields in two parts, labelled from the dictionary — no cards, no names, no Save', () => {
    setup()
    for (const id of ['files', 'sidebar', 'sidebar_position', 'tabs', 'toolbar', 'format', 'status']) {
      expect(field(id)).toBeInTheDocument()
    }
    // The editor's options are Editor's part (finding 6), not Layout's.
    for (const id of ['open', 'measure', 'typewriter', 'inline-title']) {
      expect(screen.queryByTestId(`layout-field:${id}`)).toBeNull()
    }
    expect(screen.getByText(t.files())).toBeInTheDocument()
    expect(within(field('files')).getByRole('option', { name: t.files_drawer() })).toBeInTheDocument()
    expect(within(field('status')).getByRole('option', { name: t.status_corner() })).toBeInTheDocument()
    // The default file's values, shown.
    expect(field('files').value).toBe('drawer')
    expect(field('toolbar').value).toBe('top')
    expect(field('status').value).toBe('corner')
    for (const gone of ['layout-save', 'layout-save-name', 'layout-create-toggle', 'layout-list']) {
      expect(screen.queryByTestId(gone)).toBeNull()
    }
    // Only the values worth offering: no header or status-bar choices.
    expect(screen.queryByTestId('layout-field:header')).toBeNull()
    expect(screen.queryByTestId('layout-field:statusbar')).toBeNull()

    cleanup()
    setup({ part: 'editor' })
    expect(field('open').value).toBe('replace')
    expect(field('measure')).toBeInTheDocument()
    expect(screen.getByTestId('layout-field:typewriter')).toBeInTheDocument()
    expect(screen.getByTestId('layout-field:inline-title')).toBeInTheDocument()
    expect(screen.queryByTestId('layout-field:toolbar')).toBeNull()
  })

  it('applies every change at once, storing only what differs from the file', async () => {
    const user = userEvent.setup()
    const { layout } = setup()
    await user.selectOptions(field('toolbar'), 'bottom')
    expect(layout.setOverrides).toHaveBeenLastCalledWith({ $schema, toolbar: { position: 'bottom' } })
    expect(layout.spec.toolbar.position).toBe('bottom')
    expect(field('toolbar').value).toBe('bottom')

    await user.selectOptions(field('status'), 'off')
    await user.selectOptions(field('sidebar_position'), 'bottom-right')
    expect(layout.overrides).toEqual({
      $schema,
      regions: { status: 'off' },
      toolbar: { position: 'bottom' },
      dock: { position: 'bottom-right' },
    })

    // Back to the file's own value: no longer an override.
    await user.selectOptions(field('toolbar'), 'top')
    expect(layout.overrides).toEqual({ $schema, regions: { status: 'off' }, dock: { position: 'bottom-right' } })
  })

  it('each part resets only its own fields; the button is off when its part has none', async () => {
    const user = userEvent.setup()
    const { layout } = setup({ overrides: { $schema, toolbar: { position: 'bottom' }, editor: { measure: 'wide' } } })
    expect(field('toolbar').value).toBe('bottom')
    const reset = screen.getByTestId('layout-reset')
    expect(reset).toBeEnabled()
    await user.click(reset)
    // The editor's override is Editor's to reset, and stays.
    expect(layout.overrides).toEqual({ $schema, editor: { measure: 'wide' } })
    expect(field('toolbar').value).toBe('top')
    expect(screen.getByTestId('layout-reset')).toBeDisabled()
  })

  it('a pinned side reads "as a column (pinned)" with Unpin beside it, in place of its field', async () => {
    const user = userEvent.setup()
    const { layout } = setup({ pins: { navigator: 'column' } })
    expect(screen.queryByTestId('layout-field:files')).toBeNull()
    expect(screen.getByTestId('layout-pinned:files')).toHaveTextContent(t.pinned({ value: t.files_column() }))
    // The other side is still its field.
    expect(field('sidebar').value).toBe('dock')
    await user.click(screen.getByTestId('layout-unpin:files'))
    expect(layout.unpin).toHaveBeenCalledWith('navigator')
    expect(field('files').value).toBe('drawer')
  })

  it('over another file, a value the form does not offer is still shown — and the edit is a delta over that file', async () => {
    const user = userEvent.setup()
    const offFile: ShellSpec = { ...EXAMPLES.dense, regions: { ...EXAMPLES.dense.regions, navigator: 'off' } }
    const { layout } = setup({ file: offFile })
    expect(field('files').value).toBe('off')
    expect(within(field('files')).getByRole('option', { name: t.files_off() })).toBeInTheDocument()
    await user.selectOptions(field('files'), 'drawer')
    expect(layout.overrides).toEqual({ $schema, regions: { navigator: 'drawer' } })
  })
})

describe('Settings › Layout names its file (settings-shaping Fork 4, quiet-shell Fork 8)', () => {
  const c = getLL().web.settings.customise
  const withSource = (extra: object): void => {
    const layout = {
      fileSpec: PRESETS.default,
      ownSpec: PRESETS.default,
      overrides: NO_OVERRIDES,
      setOverrides: vi.fn(),
      resetOverrides: vi.fn(),
      ...extra,
    }
    render(LayoutSettings, { layout, part: 'shell' })
  }

  it('one line: the layout file in use, its root, what it shadows, and that the form is device changes on top', () => {
    withSource({
      active: 'custom:dense',
      source: { name: 'dense', root: 'vault', path: '.ohhi/layouts/dense.json', shadows: ['user'] },
      specError: null,
    })
    const line = screen.getByTestId('layout-source')
    expect(screen.getByTestId('layout-source-name')).toHaveTextContent('dense')
    expect(line).toHaveTextContent(c.from.vault())
    expect(line).toHaveTextContent(c.shadows({ roots: c.from.user() }))
    expect(line).toHaveTextContent('.ohhi/layouts/dense.json')
    expect(line).toHaveTextContent(c.source.layout_overrides())
    expect(screen.getByTestId('layout-source-copy')).toBeVisible()
  })

  it('a chosen file that cannot be used says the built-in default stands in', () => {
    withSource({ active: 'custom:focus', source: null, specError: 'not JSON' })
    expect(screen.getByTestId('layout-source-name')).toHaveTextContent('default')
    expect(screen.getByTestId('layout-source')).toHaveTextContent(c.from.builtin())
    expect(screen.getByTestId('layout-source-fallback')).toHaveTextContent(c.fell_back({ name: 'focus' }))
    expect(screen.queryByTestId('layout-source-copy')).toBeNull()
  })

  it('the Editor part has no source line', () => {
    const layout = {
      fileSpec: PRESETS.default,
      ownSpec: PRESETS.default,
      overrides: NO_OVERRIDES,
      setOverrides: vi.fn(),
      resetOverrides: vi.fn(),
      active: 'default' as const,
      source: null,
      specError: null,
    }
    render(LayoutSettings, { layout, part: 'editor' })
    expect(screen.queryByTestId('layout-source')).toBeNull()
  })
})
