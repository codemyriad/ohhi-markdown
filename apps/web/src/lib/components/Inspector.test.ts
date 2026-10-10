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
import { fakeViewShell } from '../readouts.fixture.js'
import { viewShellContext } from '../views.js'
import type { Tab } from '../panes.js'
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
  const flash = vi.fn()
  const ws = { ui, inspectMounts, mountInvariants, inspect, peek, flash } as unknown as Workspace
  return { ws, inspectMounts, mountInvariants, inspect, peek, flash }
}

const VAULT = [
  mount('', [row('notes/a.md'), row('notes/bad.md'), row('img/x.png', { kind: 'binary', lca: null, doc: null })]),
  mount('shared', [row('shared/s.md', { doc: { headsDigest: 'bbbbbbbbbbbb', equalsLca: false } })]),
]

const NEEDS_LINK: WorkspaceMountInspection = {
  ...mount('team', [row('team/t.md', { doc: null })]),
  relay: null,
  desc: { status: 'needs-token', provenance: 'joined', relay: null, neverHeld: true, absorbInto: null },
}

const fileTab = (path: string): Tab =>
  ({ id: 't1', path: null, view: 'inspector', viewArg: path, pinned: false, cursor: null, scroll: 0 }) as unknown as Tab

const paths = () => screen.getAllByTestId(/^inspector-row:/).map((el) => el.dataset.testid!.slice('inspector-row:'.length))

describe('Inspector', () => {
  it('lists every mount as a chip and a strip line, every row worst first, and says the invariants hold', async () => {
    const { ws, inspectMounts, mountInvariants } = fakeWorkspace(VAULT)
    render(Inspector, { workspace: ws, form: 'column' })

    const scope = await screen.findByRole('group', { name: 'Scope' })
    expect(within(scope).getByTestId('inspector-scope:all')).toHaveAttribute('aria-pressed', 'true')
    expect(await within(scope).findByTestId('inspector-scope:/')).toHaveTextContent('root')
    // The root holds a diverged row → its dot is diverged; the shared mount's row is base pending.
    expect(within(scope).getByTestId('inspector-scope:/')).toHaveAttribute('data-tone', 'diverged')
    expect(within(scope).getByTestId('inspector-scope:shared')).toHaveAttribute('data-tone', 'pending')

    expect(screen.getByTestId('inspector-mount-line:shared')).toHaveTextContent('carved · active')
    expect(screen.getByTestId('inspector-mount-line:shared')).toHaveTextContent('relay.example')
    expect(screen.getByTestId('inspector-mount-line:shared')).toHaveTextContent('1 base pending')
    expect(screen.getByTestId('inspector-mount-line:/')).toHaveTextContent('1 diverged')

    await waitFor(() => expect(screen.getByTestId('inspector-count')).toHaveTextContent('4 of 4 rows'))
    expect(paths()).toEqual(['notes/bad.md', 'shared/s.md', 'notes/a.md', 'img/x.png'])
    expect(screen.getByTestId('inspector-row:notes/bad.md')).toHaveAttribute('data-state', 'diverged')
    expect(screen.getByTestId('inspector-row:notes/bad.md')).toHaveAttribute('data-chain', 'differs:equal:none')
    expect(screen.getByTestId('inspector-row:shared/s.md')).toHaveAttribute('data-state', 'doc-ahead')
    expect(screen.getByTestId('inspector-row:shared/s.md')).toHaveTextContent('Base pending')
    expect(screen.getByTestId('inspector-row:shared/s.md')).toHaveAttribute('data-chain', 'differs:differs:none')
    expect(screen.getByTestId('inspector-row:notes/a.md')).toHaveAttribute('data-chain', 'equal:equal:none')
    expect(screen.getByTestId('inspector-row:img/x.png')).toHaveAttribute('data-state', 'not-text')
    expect(screen.getByTestId('inspector-invariants')).toHaveTextContent('invariants hold')
    expect(screen.getByTestId('inspector-age')).toHaveTextContent('snapshot')
    // The chain column names its stages once; no legend anywhere.
    expect(screen.getByRole('columnheader', { name: /disk · base · doc · relay/ })).toBeInTheDocument()
    expect(inspectMounts).toHaveBeenCalledTimes(1)
    expect(mountInvariants).toHaveBeenCalledTimes(1)
  })

  it('tallies every state as a chip that narrows and clears, and sorts by path on request', async () => {
    const user = userEvent.setup()
    const { ws } = fakeWorkspace(VAULT)
    render(Inspector, { workspace: ws, form: 'column' })
    await screen.findByTestId('inspector-row:notes/a.md')

    const tally = screen.getByRole('group', { name: 'States' })
    // Every state listed, zero included, in ROW_STATES order.
    expect(within(tally).getAllByRole('button').map((b) => b.dataset.testid)).toEqual([
      'inspector-state:diverged',
      'inspector-state:disk-changed',
      'inspector-state:doc-ahead',
      'inspector-state:no-lca',
      'inspector-state:no-doc',
      'inspector-state:in-sync',
      'inspector-state:not-text',
    ])
    expect(screen.getByTestId('inspector-state:disk-changed')).toHaveTextContent('Flush pending 0')
    const diverged = screen.getByTestId('inspector-state:diverged')
    await user.click(diverged)
    expect(diverged).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('inspector-count')).toHaveTextContent('1 of 4 rows')
    await user.click(diverged)
    expect(diverged).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('inspector-count')).toHaveTextContent('4 of 4 rows')

    await user.click(screen.getByTestId('inspector-sort:path'))
    expect(screen.getByTestId('inspector-sort')).toHaveAttribute('data-sort', 'path')
    expect(paths()).toEqual(['notes/a.md', 'notes/bad.md', 'shared/s.md', 'img/x.png'])
  })

  it('narrows to one mount from its strip line, shows its two-line card, and filters by path', async () => {
    const user = userEvent.setup()
    const { ws } = fakeWorkspace(VAULT)
    render(Inspector, { workspace: ws, form: 'column' })
    await screen.findByTestId('inspector-row:notes/a.md')

    await user.click(screen.getByTestId('inspector-mount-line:/'))
    expect(screen.getByTestId('inspector-scope:/')).toHaveAttribute('aria-pressed', 'true')
    const card = screen.getByTestId('inspector-mount')
    expect(card).toHaveTextContent('local · active')
    expect(card).toHaveTextContent('3 entries · 3 docs · 3 base · 4 journal')
    expect(screen.getByTestId('inspector-agreement')).toHaveTextContent('mounts.json agrees')
    expect(card).toHaveTextContent('0 open here')
    expect(screen.queryByTestId('inspector-mounts')).toBeNull()
    expect(screen.getByTestId('inspector-count')).toHaveTextContent('3 of 3 rows')
    expect(screen.queryByTestId('inspector-row:shared/s.md')).toBeNull()

    await user.type(screen.getByTestId('inspector-prefix'), 'img')
    expect(screen.getByTestId('inspector-count')).toHaveTextContent('1 of 3 rows')
    expect(screen.getByTestId('inspector-row:img/x.png')).toBeVisible()
  })

  it('says a needs-token folder needs a link, never held, and paints it not syncing', async () => {
    const user = userEvent.setup()
    const { ws } = fakeWorkspace([...VAULT, NEEDS_LINK])
    render(Inspector, { workspace: ws, form: 'column' })
    const line = await screen.findByTestId('inspector-mount-line:team')
    expect(line).toHaveTextContent('needs a link, never held')
    expect(line).toHaveTextContent('not syncing')
    expect(screen.getByTestId('inspector-scope:team')).toHaveAttribute('data-tone', 'offline')
    await user.click(line)
    expect(screen.getByTestId('inspector-agreement')).toHaveTextContent('needs a link, never held')
  })

  it('opens on the shell selection, shows its chain, sentence and the doc text, and re-reads a row on click', async () => {
    const user = userEvent.setup()
    const { ws, inspect, peek } = fakeWorkspace(VAULT, { selected: 'notes/a.md' })
    render(Inspector, { workspace: ws, form: 'column' })

    await waitFor(() => expect(inspect).toHaveBeenCalledWith('notes/a.md'))
    expect(peek).toHaveBeenCalledWith('notes/a.md')
    const file = screen.getByTestId('inspector-file')
    // Measured off the peek's hashes: disk = lca; every link equal → the doc text is the default view.
    await waitFor(() => expect(within(file).getByTestId('inspector-chain')).toHaveAttribute('data-chain', 'equal:equal:none'))
    expect(within(file).getByTestId('inspector-say')).toHaveTextContent('Disk, the base and the document are the same text.')
    expect(within(file).getByTestId('inspector-peek')).toHaveAttribute('data-view', 'doc')
    expect(within(file).getByTestId('inspector-peek')).toHaveTextContent('one two')
    expect(within(file).getByTestId('inspector-record')).toHaveTextContent('diverged false')
    expect(file).toHaveTextContent('2 saved versions')

    await user.click(within(screen.getByTestId('inspector-row:notes/bad.md')).getByRole('button', { name: 'notes/bad.md' }))
    await waitFor(() => expect(inspect).toHaveBeenCalledWith('notes/bad.md'))
    await waitFor(() => expect(within(file).getByTestId('inspector-record')).toHaveTextContent('diverged true'))
    expect(within(file).getByTestId('inspector-file-state')).toHaveTextContent('Diverged')
  })

  it('diffs across the link that differs, and lets the reader pick another view', async () => {
    const user = userEvent.setup()
    const { ws } = fakeWorkspace(VAULT, { selected: 'shared/s.md' })
    render(Inspector, { workspace: ws, form: 'column' })
    const file = screen.getByTestId('inspector-file')
    // doc ≠ lca by heads → the default view is doc vs lca; the fake's texts are equal there.
    await waitFor(() => expect(within(file).getByTestId('inspector-peek')).toHaveAttribute('data-view', 'doc-lca'))
    expect(within(file).getByTestId('inspector-peek')).toHaveTextContent('identical')
    const picker = within(file).getByTestId('inspector-peek-view')
    expect(within(picker).getByRole('group', { name: 'Differences' })).toBeInTheDocument()

    await user.click(within(within(picker).getByRole('group', { name: 'Texts' })).getByRole('button', { name: 'base' }))
    expect(within(file).getByTestId('inspector-peek')).toHaveAttribute('data-view', 'lca')
    expect(within(file).getByTestId('inspector-peek')).toHaveTextContent('one two')
  })

  it('renders a real diff with added and removed lines', async () => {
    const user = userEvent.setup()
    const { ws } = fakeWorkspace(VAULT, { selected: 'notes/bad.md' })
    render(Inspector, { workspace: ws, form: 'column' })
    const file = screen.getByTestId('inspector-file')
    await waitFor(() => expect(within(file).getByTestId('inspector-peek')).toBeVisible())
    await user.click(within(file).getByTestId('inspector-peek-view:doc-lca'))
    const peekEl = within(file).getByTestId('inspector-peek')
    await waitFor(() => expect(peekEl).toHaveAttribute('data-view', 'doc-lca'))
    expect(peekEl).toHaveTextContent('− two')
    expect(peekEl).toHaveTextContent('+ 2')
  })

  it('as a drawer: closes on its button and on Escape, the row stays marked, a click reopens it', async () => {
    const user = userEvent.setup()
    const { ws } = fakeWorkspace(VAULT, { selected: 'notes/a.md' })
    render(Inspector, { workspace: ws, form: 'drawer' })
    await screen.findByTestId('inspector-row:notes/a.md')
    const region = await screen.findByRole('region', { name: 'notes/a.md' })
    expect(screen.getByTestId('inspector-row:notes/a.md')).toHaveAttribute('data-selected', 'true')

    await user.click(within(region).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('region', { name: 'notes/a.md' })).toBeNull()
    expect(screen.getByTestId('inspector-row:notes/a.md')).toHaveAttribute('data-selected', 'true')

    await user.click(within(screen.getByTestId('inspector-row:notes/a.md')).getByRole('button', { name: 'notes/a.md' }))
    const again = await screen.findByRole('region', { name: 'notes/a.md' })
    within(again).getByRole('button', { name: 'Close' }).focus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: 'notes/a.md' })).toBeNull()
  })

  it('as a column: always present, no Close', async () => {
    const { ws } = fakeWorkspace(VAULT, { selected: 'notes/a.md' })
    render(Inspector, { workspace: ws, form: 'column' })
    const region = await screen.findByRole('region', { name: 'notes/a.md' })
    expect(within(region).queryByRole('button', { name: 'Close' })).toBeNull()
  })

  it('row and detail verbs go through the shell', async () => {
    const user = userEvent.setup()
    const shell = fakeViewShell(0)
    const { ws } = fakeWorkspace(VAULT, { selected: 'notes/a.md' })
    render(Inspector, { props: { workspace: ws, form: 'column' }, context: viewShellContext(shell) })
    await screen.findByTestId('inspector-row:shared/s.md')

    await user.click(screen.getByRole('button', { name: 'Open shared/s.md' }))
    expect(shell.openPath).toHaveBeenCalledWith('shared/s.md')
    await user.click(screen.getByRole('button', { name: 'Open shared/s.md in its own tab' }))
    expect(shell.openView).toHaveBeenCalledWith('inspector', 'shared/s.md')

    const region = await screen.findByRole('region', { name: 'notes/a.md' })
    await user.click(within(region).getByRole('button', { name: 'Reveal in navigator' }))
    expect(shell.revealFolder).toHaveBeenCalledWith('notes')
    await user.click(within(region).getByRole('button', { name: 'Open note' }))
    expect(shell.openPath).toHaveBeenCalledWith('notes/a.md')
    await user.click(within(region).getByRole('button', { name: 'Open in its own tab' }))
    expect(shell.openView).toHaveBeenCalledWith('inspector', 'notes/a.md')
  })

  it('a tab opened on a path renders that file alone, with the way back to the inspector', async () => {
    const user = userEvent.setup()
    const shell = fakeViewShell(0)
    const { ws, inspect } = fakeWorkspace(VAULT, { selected: 'notes/a.md' })
    render(Inspector, { props: { workspace: ws, tab: fileTab('notes/bad.md') }, context: viewShellContext(shell) })
    await waitFor(() => expect(inspect).toHaveBeenCalledWith('notes/bad.md'))
    const file = screen.getByTestId('inspector-file')
    expect(file).toHaveAttribute('data-form', 'tab')
    await waitFor(() => expect(within(file).getByTestId('inspector-file-state')).toHaveTextContent('Diverged'))
    expect(screen.queryByTestId('inspector-rows')).toBeNull()
    expect(within(file).queryByRole('button', { name: 'Open in its own tab' })).toBeNull()
    await user.click(within(file).getByRole('button', { name: 'Open the inspector' }))
    expect(shell.openView).toHaveBeenCalledWith('inspector')
  })

  it('copies a report of the scope or of the file, and falls back to a textarea when the clipboard refuses', async () => {
    const user = userEvent.setup()
    const writeClipboard = vi.fn(async (_text: string) => {})
    const { ws, flash } = fakeWorkspace(VAULT, { selected: 'notes/a.md' })
    render(Inspector, { workspace: ws, form: 'column', writeClipboard })
    await screen.findByTestId('inspector-row:notes/a.md')
    await waitFor(() => expect(screen.getByTestId('inspector-chain')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Copy report' }))
    await user.click(screen.getByRole('menuitem', { name: 'Every row in scope' }))
    expect(writeClipboard).toHaveBeenCalledTimes(1)
    const scopeText = writeClipboard.mock.calls[0][0]
    expect(scopeText).toContain('scope: All mounts')
    expect(scopeText).toMatch(/Diverged\s+disk ≠≠≠ base ═══ doc – relay {2}notes\/bad\.md/)
    expect(flash).toHaveBeenCalledWith({ level: 'info', text: 'Inspector report copied' })

    await user.click(screen.getByRole('button', { name: 'Copy report' }))
    await user.click(screen.getByRole('menuitem', { name: 'The selected file' }))
    expect(writeClipboard.mock.calls[1][0]).toContain('path: notes/a.md')

    writeClipboard.mockRejectedValueOnce(new Error('denied'))
    await user.click(screen.getByRole('button', { name: 'Copy report' }))
    await user.click(screen.getByRole('menuitem', { name: 'Every row in scope' }))
    expect(await screen.findByTestId('inspector-copy-fallback')).toBeInTheDocument()
    expect((screen.getByTestId('inspector-copy-fallback') as HTMLTextAreaElement).value).toContain('scope: All mounts')
  })

  it('lists invariant violations at the top', async () => {
    const { ws } = fakeWorkspace(VAULT, { invariants: ["desc at 'x' has no live mount"] })
    render(Inspector, { workspace: ws, form: 'column' })
    await waitFor(() =>
      expect(screen.getByTestId('inspector-invariants')).toHaveTextContent('1 invariant violation')
    )
    expect(screen.getByTestId('inspector-violations')).toHaveTextContent("desc at 'x' has no live mount")
  })

  it('refreshes on the button, never on a timer, and dates the snapshot from now', async () => {
    const user = userEvent.setup()
    let t = 1_000_000
    const { ws, inspectMounts } = fakeWorkspace(VAULT)
    render(Inspector, { workspace: ws, form: 'column', now: () => t })
    await screen.findByTestId('inspector-row:notes/a.md')
    expect(screen.getByTestId('inspector-age')).toHaveTextContent('snapshot just now')
    expect(inspectMounts).toHaveBeenCalledTimes(1)
    t += 5_000
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(inspectMounts).toHaveBeenCalledTimes(2))
  })
})
