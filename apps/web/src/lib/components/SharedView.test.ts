// @vitest-environment jsdom
import { MemoryIndex } from '@ohhi/index'
import { getLL } from '@ohhi/i18n'
import type { AppEvent } from '@ohhi/workspace'
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../panes.js'
import { encodeShareLink } from '../share-link.js'
import type { ViewShell } from '../views.js'
import type { MountInfo, Workspace } from '../workspace.svelte.js'
import SharedView from './SharedView.svelte'

afterEach(cleanup)

const t = getLL().web.shared
const card = getLL().web.relay_card
const NOW = new Date(2026, 9, 3, 15, 0).getTime()
const MIN = 60_000

const rec = (connected: boolean) => ({ connected, synced: connected, pendingLocal: false, diskMatchesCrdt: true, diverged: false })
const link = (room: string, relay = 'wss://relay.ohhi.md') => encodeShareLink({ relay, room, token: 'tok' })

const CS: MountInfo = { path: 'CS', room: 'cs', provenance: 'carved', link: link('cs'), status: 'active', foreign: false, relay: 'wss://relay.ohhi.md' }
const MY: MountInfo = { path: 'Myriad', room: 'my', provenance: 'joined', link: link('my', 'wss://other.example'), status: 'active', foreign: true, relay: 'wss://other.example' }

function setup(over: {
  mounts?: MountInfo[]
  linked?: boolean
  records?: Record<string, ReturnType<typeof rec>>
  presenceByRoom?: Record<string, string[]>
  presenceByPath?: Record<string, { name: string; color: number; clientId: number }[]>
  events?: AppEvent[]
  secret?: string
  relayKnown?: boolean
  pinnedHost?: string
  teamRelay?: string
  networkNote?: string
  probe?: (url: string) => Promise<{ ok: true } | { ok: false; reason: 'unreachable' | 'unhealthy' | 'timeout' }>
} = {}) {
  const ui = {
    mounts: over.mounts ?? [CS, MY],
    linked: over.linked ?? false,
    files: [
      { path: 'CS', guid: 'm1', kind: 'mount' },
      { path: 'CS/Raft, in one page.md', guid: 'g1', kind: 'text' },
      { path: 'CS/Paxos.md', guid: 'g2', kind: 'text' },
      { path: 'Myriad/plan.md', guid: 'g3', kind: 'text' },
      { path: 'notes/a.md', guid: 'g4', kind: 'text' },
    ],
    records: over.records ?? { '//folder:cs': rec(true), '//folder:my': rec(true), g1: rec(true), g2: rec(true), g3: rec(true) },
    presenceByRoom: over.presenceByRoom ?? {},
    presenceByPath: over.presenceByPath ?? {},
    events: over.events ?? [],
  }
  const workspace = { room: 'root', user: { name: 'Chris', color: '#000' }, ui, startedAt: 0, rootRelayUrl: () => 'wss://relay.ohhi.md' }
  const shell: ViewShell = {
    // Short waits (the card's probe debounce) run on the next microtask; the tick never.
    clock: {
      now: () => NOW,
      schedule: (fn: () => void, ms: number) => {
        let live = true
        if (ms <= 500) queueMicrotask(() => live && fn())
        return () => {
          live = false
        }
      },
    },
    index: () => new MemoryIndex(),
    indexRevision: () => 0,
    openPath: vi.fn(),
    openView: vi.fn(),
    createFromLink: vi.fn(),
    renameNote: vi.fn(async (path: string) => path),
    pin: vi.fn(),
    openSettings: vi.fn(),
    shareFolder: vi.fn(),
    addSharedFolder: vi.fn(),
    linkDevice: vi.fn(),
    revealFolder: vi.fn(),
    relayUrl: () => 'wss://relay.ohhi.md',
    secret: () => over.secret ?? '',
    relayKnown: () => over.relayKnown ?? false,
    revision: () => 0,
    inSyncByRoom: () => ({ cs: { since: NOW - 2 * MIN } }),
  }
  const list = vi.fn(async () => [])
  const probe = vi.fn(over.probe ?? (async () => ({ ok: true as const })))
  render(SharedView, {
    workspace: workspace as unknown as Workspace,
    tab: { id: 't', path: null, view: 'shared' } as Tab,
    shell,
    clock: shell.clock,
    list,
    probe,
    pinnedHost: over.pinnedHost ?? '',
    teamRelay: over.teamRelay ?? '',
    networkNote: over.networkNote ?? '',
  })
  return { shell, probe, user: userEvent.setup() }
}

describe('SharedView (sharing E2)', () => {
  it('a vault that shares nothing is the onboarding: three doors, the relay introduced where needed', async () => {
    const { shell, user } = setup({ mounts: [] })
    const empty = screen.getByTestId('shared-empty')
    expect(empty).toHaveTextContent(t.empty.title())
    // No relay known: the card's none state, never a probe.
    const relay = within(screen.getByTestId('shared-empty-relay')).getByTestId('relay-card')
    expect(relay).toHaveAttribute('data-state', 'none')
    expect(relay).toHaveTextContent(card.none_host())
    expect(relay).toHaveTextContent(card.none_body())
    await user.click(within(empty).getByTestId('shared-add'))
    expect(shell.addSharedFolder).toHaveBeenCalled()
    await user.click(within(empty).getByTestId('shared-link-device'))
    expect(shell.linkDevice).toHaveBeenCalled()
    // Share a folder… asks which one first, offering only what the tree menu would.
    await user.click(within(empty).getByTestId('shared-share'))
    const select = await screen.findByTestId('share-folder-select')
    expect([...(select as HTMLSelectElement).options].map((o) => o.value)).toEqual(['CS', 'Myriad', 'notes'])
    await user.selectOptions(select, 'notes')
    await user.click(screen.getByTestId('share-folder-next'))
    expect(shell.shareFolder).toHaveBeenCalledWith('notes')
  })

  it('the empty state’s relay card reads the relay, not the secret (first-run D1/D3)', async () => {
    // A team build with the relay baked in and no secret yet: where shares go, probed, and what is still needed.
    const { probe } = setup({ mounts: [], relayKnown: true, teamRelay: 'wss://relay.ohhi.md', networkNote: 'Tailnet only.' })
    const block = screen.getByTestId('shared-empty-relay')
    expect(block).toHaveTextContent(t.empty.relay_label())
    const relay = within(block).getByTestId('relay-card')
    await waitFor(() => expect(relay).toHaveAttribute('data-state', 'reachable'))
    expect(probe).toHaveBeenCalledWith('wss://relay.ohhi.md')
    expect(relay).toHaveTextContent('relay.ohhi.md')
    expect(relay).toHaveTextContent(card.team())
    expect(relay).toHaveTextContent('Tailnet only.')
    expect(block).toHaveTextContent(t.empty.secret_once())
    // The host is said once: the card carries it, nothing repeats it.
    expect(block.textContent!.match(/relay\.ohhi\.md/g)).toHaveLength(1)
    cleanup()
    // With the secret saved, only where shares go.
    setup({ mounts: [], relayKnown: true, secret: 's3cret' })
    expect(screen.getByTestId('shared-empty-relay')).not.toHaveTextContent(t.empty.secret_once())
    cleanup()
    // A secret but no relay known (the dev fallback only): none.
    setup({ mounts: [], relayKnown: false, secret: 's3cret' })
    expect(screen.getByTestId('relay-card')).toHaveAttribute('data-state', 'none')
  })

  it('the empty state in a pinned build: one host only, nothing to change', async () => {
    setup({ mounts: [], relayKnown: true, pinnedHost: 'relay.ohhi.md' })
    const relay = screen.getByTestId('relay-card')
    expect(relay).toHaveTextContent(card.pinned({ host: 'relay.ohhi.md' }))
    expect(within(relay).queryByRole('button', { name: card.change() })).toBeNull()
    cleanup()
    const generic = setup({ mounts: [], relayKnown: true })
    await generic.user.click(within(screen.getByTestId('relay-card')).getByRole('button', { name: card.change() }))
    expect(generic.shell.openSettings).toHaveBeenCalledWith('sync')
  })

  it('can’t reach the relay from here: said on the card, before anything is shared', async () => {
    setup({ mounts: [], relayKnown: true, probe: async () => ({ ok: false, reason: 'unreachable' }) })
    await waitFor(() => expect(screen.getByTestId('relay-card')).toHaveTextContent(card.unreachable()))
  })

  it('the relay card says connected, rooms, people and since when it is in sync with the relay — never "durable"', () => {
    setup({ presenceByRoom: { cs: ['Chris', 'Cynthia'] } })
    const cards = screen.getAllByTestId('relay-card')
    expect(cards.map((c) => c.dataset.state)).toEqual(['connected', 'connected'])
    expect(cards[0]).toHaveTextContent('relay.ohhi.md')
    expect(cards[0]).toHaveTextContent(t.relay.rooms({ count: 1 }))
    expect(cards[0]).toHaveTextContent(t.relay.people({ count: 1 }))
    expect(cards[0]).toHaveTextContent(t.relay.in_sync({ when: '2 min ago' }))
    expect(cards[0]!.textContent).not.toMatch(/durable/i)
    expect(cards[1]).toHaveTextContent(t.relay.only_you())
  })

  it('reads Reconnecting… from the records, with the edits-are-safe line', () => {
    setup({ records: { '//folder:cs': rec(false), '//folder:my': rec(true) } })
    const [down] = screen.getAllByTestId('relay-card')
    expect(down!.dataset.state).toBe('reconnecting')
    expect(down).toHaveTextContent(t.relay.state.reconnecting())
    expect(down).toHaveTextContent(t.relay.safe())
    // The room's own pill agrees: f(records), never green while down.
    expect(screen.getByTestId('shared-room-pill:CS').dataset.status).toBe('offline')
  })

  it('a refusal reads the relay’s reason; a long outage reads offline', () => {
    setup({
      records: {},
      events: [
        { id: 'a', at: NOW - MIN, kind: 'relay.state', level: 'error', scope: { room: 'cs' }, actor: { kind: 'relay' }, count: 1, payload: { to: 'refused', reason: 'no such share' } },
        { id: 'b', at: NOW - MIN, kind: 'relay.state', level: 'info', scope: { room: 'my' }, actor: { kind: 'relay' }, count: 1, payload: { to: 'offline' } },
      ] as AppEvent[],
    })
    const [refused, offline] = screen.getAllByTestId('relay-card')
    expect(refused).toHaveTextContent(t.relay.refused_reason({ reason: 'no such share' }))
    expect(offline!.dataset.state).toBe('offline')
  })

  it('shared folders list carved and joined rooms — never the linked vault, which is a device', () => {
    setup({ linked: true, records: { '//folder:root': rec(true), '//folder:cs': rec(true), '//folder:my': rec(true) } })
    const folders = screen.getByTestId('shared-folders')
    expect(within(folders).getAllByRole('listitem').map((li) => li.dataset.testid)).toEqual([
      'shared-room:CS',
      'shared-room:Myriad',
    ])
    expect(screen.getByTestId('shared-room:CS')).toHaveTextContent(t.folders.by_you())
    expect(screen.getByTestId('shared-room:CS')).toHaveTextContent(t.folders.notes({ count: 2 }))
    expect(screen.getByTestId('shared-room:Myriad')).toHaveTextContent(t.folders.with_you())
    expect(screen.getByTestId('shared-devices-linked')).toHaveTextContent(t.devices.linked())
  })

  it('People: one fact per person — the note they are in, with a jump; you are not listed', async () => {
    const { shell, user } = setup({
      presenceByRoom: { cs: ['Chris', 'Cynthia', 'Sam'] },
      presenceByPath: { 'CS/Raft, in one page.md': [{ name: 'Cynthia', color: 1, clientId: 7 }] },
    })
    const people = screen.getByTestId('shared-presence')
    expect(within(people).getAllByRole('listitem').map((li) => li.dataset.testid)).toEqual([
      'shared-person:Cynthia',
      'shared-person:Sam',
    ])
    const jump = screen.getByTestId('shared-person-jump:Cynthia')
    expect(jump).toHaveTextContent(t.people.in_note({ note: 'Raft, in one page' }))
    expect(screen.getByTestId('shared-person:Sam')).toHaveTextContent(t.people.in_folder({ folder: 'CS' }))
    expect(screen.getByTestId('shared-people')).toHaveTextContent(t.people.honesty())
    await user.click(jump)
    expect(shell.openPath).toHaveBeenCalledWith('CS/Raft, in one page.md')
  })

  it('alone: nobody else online, and who was last here', () => {
    setup({
      events: [
        { id: 'l', at: NOW - 5 * MIN, kind: 'peer.left', level: 'info', scope: { room: 'cs' }, actor: { kind: 'peer', name: 'Cynthia' }, count: 1, payload: {} },
      ] as AppEvent[],
    })
    expect(screen.getByTestId('shared-alone')).toHaveTextContent(t.people.alone())
    expect(screen.getByTestId('shared-alone')).toHaveTextContent(t.people.last_here({ name: 'Cynthia', when: '5 min ago' }))
  })

  it('Changes: folded lines with who and the delta; Show all opens the Log on change kinds', async () => {
    const change = (id: string, at: number, name: string | undefined, added: number): AppEvent =>
      ({
        id,
        at,
        kind: 'doc.changed',
        level: 'info',
        scope: { room: 'cs', path: 'CS/Paxos.md' },
        actor: name ? { kind: 'peer', name } : { kind: 'relay', name: 'relay.ohhi.md' },
        count: 1,
        payload: { guid: 'g2', added, removed: 1 },
      }) as AppEvent
    const { shell, user } = setup({
      events: [change('c1', NOW - MIN, 'Sam', 3), change('c2', NOW - 3 * MIN, 'Sam', 2), change('c3', NOW - 4 * MIN, undefined, 9)],
    })
    const lines = screen.getAllByTestId('change-line')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toHaveTextContent('Sam')
    expect(lines[0]).toHaveTextContent('+5 −2')
    expect(lines[1]).toHaveTextContent(t.who.relay({ host: 'relay.ohhi.md' }))
    await user.click(screen.getByTestId('changes-show-all'))
    expect(shell.openView).toHaveBeenCalledWith('log', 'changes')
  })
})
