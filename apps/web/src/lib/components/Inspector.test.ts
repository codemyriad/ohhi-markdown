// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PathInspection } from '@ohhi/workspace'
import type {
  Workspace,
  WorkspaceInspection,
  WorkspaceMountInspection,
} from '../workspace.svelte.js'
import Inspector from './Inspector.svelte'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const row = (path: string, over: Partial<PathInspection> = {}): PathInspection => ({
  path,
  guid: `g:${path}`,
  kind: 'text',
  lca: { headsDigest: 'aaaaaaaaaaaa', contentHash: 'hash' },
  doc: { headsDigest: 'aaaaaaaaaaaa', equalsLca: true },
  providerAttached: false,
  journalCount: 2,
  open: false,
  ...over,
})

const mount = (mountPath: string, rows: PathInspection[]): WorkspaceMountInspection => ({
  mountPath,
  stats: {
    room: `room-${mountPath || 'root'}-0123456789`,
    mountPath,
    provenance: mountPath ? 'carved' : 'local',
    shared: mountPath !== '',
    entryCount: rows.length,
    docCount: rows.length,
    lcaCount: rows.length,
    journalCount: 4,
  },
  relay: mountPath ? 'wss://relay.example' : null,
  desc: { status: 'active', provenance: mountPath ? 'carved' : 'local', relay: null, neverHeld: false, absorbInto: null },
  rows,
  lcaOrphans: [],
})

const detail = (path: string): WorkspaceInspection => ({
  path,
  guid: `g:${path}`,
  recordKey: `g:${path}`,
  lca: { contentHash: 'hash', headsDigest: 'aaaaaaaaaaaa', eol: 'lf', bom: false, baseTextLength: 12 },
  doc: { headsDigest: 'aaaaaaaaaaaa', textLength: 12, equalsLca: true },
  blob: { present: true, bytes: 300, lastFlushAt: null },
  journal: { count: 2, recent: [{ at: Date.now(), bytes: 12 }] },
  providerAttached: false,
  mount: { path: '', room: 'room-root-0123456789' },
})

const record = (over: Partial<Workspace['ui']['records'][string]> = {}) => ({
  connected: true,
  synced: true,
  pendingLocal: false,
  diskMatchesCrdt: true,
  diverged: false,
  ...over,
})

function fakeWorkspace(
  mounts: WorkspaceMountInspection[],
  opts: { invariants?: string[]; selected?: string | null } = {}
) {
  const ui = {
    settling: false,
    selectedPath: opts.selected ?? null,
    files: mounts.flatMap((m) => m.rows.map((r) => ({ path: r.path, guid: r.guid, kind: r.kind }))),
    records: Object.fromEntries(
      mounts.flatMap((m) => m.rows.map((r) => [r.guid, record({ diverged: r.path.endsWith('bad.md') })]))
    ),
  }
  const inspectMounts = vi.fn(async () => mounts)
  const mountInvariants = vi.fn(() => opts.invariants ?? [])
  const inspect = vi.fn(async (path: string) => detail(path))
  const peek = vi.fn(async (path: string) => ({
    disk: { text: 'one\ntwo\n', hash: 'hash' },
    lca: { text: 'one\ntwo\n', hash: 'hash' },
    doc: { text: path.endsWith('bad.md') ? 'one\n2\n' : 'one\ntwo\n' },
  }))
  const ws = { ui, inspectMounts, mountInvariants, inspect, peek } as unknown as Workspace
  return { ws, inspectMounts, mountInvariants, inspect, peek }
}

const VAULT = [
  mount('', [row('notes/a.md'), row('notes/bad.md'), row('img/x.png', { kind: 'binary', lca: null, doc: null })]),
  mount('shared', [row('shared/s.md', { doc: { headsDigest: 'bbbbbbbbbbbb', equalsLca: false } })]),
]

describe('Inspector', () => {
  it('lists every mount, every row across them, and says the invariants hold', async () => {
    const { ws, inspectMounts, mountInvariants } = fakeWorkspace(VAULT)
    render(Inspector, { workspace: ws })

    const nav = await screen.findByRole('navigation', { name: 'Scope' })
    expect(within(nav).getByRole('button', { name: 'All mounts' })).toHaveAttribute('aria-current', 'true')
    expect(await within(nav).findByTestId('inspector-scope:/')).toHaveTextContent('root')
    expect(within(nav).getByTestId('inspector-scope:shared')).toHaveTextContent('carved · active')

    await waitFor(() => expect(screen.getByTestId('inspector-count')).toHaveTextContent('4 of 4 rows'))
    expect(screen.getByTestId('inspector-row:notes/bad.md')).toHaveAttribute('data-state', 'diverged')
    expect(screen.getByTestId('inspector-row:notes/bad.md')).toHaveAttribute('data-chain', 'differs:equal:none')
    expect(screen.getByTestId('inspector-row:shared/s.md')).toHaveAttribute('data-state', 'doc-ahead')
    expect(screen.getByTestId('inspector-row:shared/s.md')).toHaveAttribute('data-chain', 'differs:differs:none')
    expect(screen.getByTestId('inspector-row:notes/a.md')).toHaveAttribute('data-chain', 'equal:equal:none')
    expect(screen.getByTestId('inspector-row:img/x.png')).toHaveAttribute('data-state', 'not-text')
    expect(screen.getByTestId('inspector-invariants')).toHaveTextContent('invariants hold')
    expect(inspectMounts).toHaveBeenCalledTimes(1)
    expect(mountInvariants).toHaveBeenCalledTimes(1)
  })

  it('narrows to one mount, shows its card, and filters rows by state and prefix', async () => {
    const user = userEvent.setup()
    const { ws } = fakeWorkspace(VAULT)
    render(Inspector, { workspace: ws })
    await screen.findByTestId('inspector-row:notes/a.md')

    await user.click(screen.getByTestId('inspector-scope:/'))
    expect(screen.getByTestId('inspector-mount')).toHaveTextContent("at '/'")
    expect(screen.getByTestId('inspector-count')).toHaveTextContent('3 of 3 rows')
    expect(screen.queryByTestId('inspector-row:shared/s.md')).toBeNull()

    await user.selectOptions(screen.getByTestId('inspector-state'), 'diverged')
    expect(screen.getByTestId('inspector-count')).toHaveTextContent('1 of 3 rows')
    expect(screen.getByTestId('inspector-row:notes/bad.md')).toBeVisible()

    await user.selectOptions(screen.getByTestId('inspector-state'), '')
    await user.type(screen.getByTestId('inspector-prefix'), 'img')
    expect(screen.getByTestId('inspector-count')).toHaveTextContent('1 of 3 rows')
    expect(screen.getByTestId('inspector-row:img/x.png')).toBeVisible()
  })

  it('opens on the shell selection, shows its chain and the doc text, and re-reads a row on click', async () => {
    const user = userEvent.setup()
    const { ws, inspect, peek } = fakeWorkspace(VAULT, { selected: 'notes/a.md' })
    render(Inspector, { workspace: ws })

    await waitFor(() => expect(inspect).toHaveBeenCalledWith('notes/a.md'))
    expect(peek).toHaveBeenCalledWith('notes/a.md')
    const file = screen.getByTestId('inspector-file')
    // Measured off the peek's hashes: disk = lca; every link equal → the doc text is the default view.
    await waitFor(() => expect(within(file).getByTestId('inspector-chain')).toHaveAttribute('data-chain', 'equal:equal:none'))
    expect(within(file).getByTestId('inspector-peek')).toHaveAttribute('data-view', 'doc')
    expect(within(file).getByTestId('inspector-peek')).toHaveTextContent('one two')
    expect(within(file).getByTestId('inspector-record')).toHaveTextContent('diverged false')

    await user.click(within(screen.getByTestId('inspector-row:notes/bad.md')).getByRole('button'))
    await waitFor(() => expect(inspect).toHaveBeenCalledWith('notes/bad.md'))
    await waitFor(() => expect(within(file).getByTestId('inspector-record')).toHaveTextContent('diverged true'))
  })

  it('diffs across the link that differs, and lets the reader pick another view', async () => {
    const user = userEvent.setup()
    const { ws } = fakeWorkspace(VAULT, { selected: 'shared/s.md' })
    render(Inspector, { workspace: ws })
    const file = screen.getByTestId('inspector-file')
    // doc ≠ lca by heads → the default view is doc vs lca; the fake's texts are equal there.
    await waitFor(() => expect(within(file).getByTestId('inspector-peek')).toHaveAttribute('data-view', 'doc-lca'))
    expect(within(file).getByTestId('inspector-peek')).toHaveTextContent('identical')

    await user.selectOptions(within(file).getByTestId('inspector-peek-view'), 'lca')
    expect(within(file).getByTestId('inspector-peek')).toHaveAttribute('data-view', 'lca')
    expect(within(file).getByTestId('inspector-peek')).toHaveTextContent('one two')
  })

  it('renders a real diff with added and removed lines', async () => {
    const { ws } = fakeWorkspace(VAULT, { selected: 'notes/bad.md' })
    render(Inspector, { workspace: ws })
    const file = screen.getByTestId('inspector-file')
    // diverged → disk ≠ lca inferred, but the peek measures disk = lca, so the doc-vs-lca diff wins... via the picker.
    await waitFor(() => expect(within(file).getByTestId('inspector-peek')).toBeVisible())
    await userEvent.setup().selectOptions(within(file).getByTestId('inspector-peek-view'), 'doc-lca')
    const peekEl = within(file).getByTestId('inspector-peek')
    await waitFor(() => expect(peekEl).toHaveAttribute('data-view', 'doc-lca'))
    expect(peekEl).toHaveTextContent('− two')
    expect(peekEl).toHaveTextContent('+ 2')
  })

  it('lists invariant violations in red at the top', async () => {
    const { ws } = fakeWorkspace(VAULT, { invariants: ["desc at 'x' has no live mount"] })
    render(Inspector, { workspace: ws })
    await waitFor(() =>
      expect(screen.getByTestId('inspector-invariants')).toHaveTextContent('1 invariant violation')
    )
    expect(screen.getByTestId('inspector-violations')).toHaveTextContent("desc at 'x' has no live mount")
  })

  it('refreshes on the button, never on a timer', async () => {
    const user = userEvent.setup()
    const { ws, inspectMounts } = fakeWorkspace(VAULT)
    render(Inspector, { workspace: ws })
    await screen.findByTestId('inspector-row:notes/a.md')
    expect(inspectMounts).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(inspectMounts).toHaveBeenCalledTimes(2))
  })
})
