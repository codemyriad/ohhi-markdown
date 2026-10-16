<script lang="ts">
  /**
   * The Shared view (sharing-shaping E2, E3's UI, E5): the shared world as a
   * place — a view tab, opened by `app.shared`, `Mod+Shift+S` or the pill
   * (the door, Fork 3-A). Its cards render one plain `SharedSnapshot` from
   * libs/workspace, so every line is `f(records)`, the awareness the app
   * already holds, and the relay's own token lists:
   *
   *  - the relay, first: host, state in words (kill the relay and it says
   *    "Reconnecting…" while every pill agrees), rooms, people, in sync since;
   *  - shared folders: carved and joined rooms only (the linked vault is a
   *    device fact, Chris's correction), counts and stacks, never the note;
   *  - people: ONE fact each — the note their caret is in, with a jump;
   *  - your devices, with the device-link warning and *Link a device…*;
   *  - changes: the room logs folded one line per note per window (E3).
   *
   * With nothing shared it is the onboarding into collaboration instead:
   * the relay first, as the same card in its probed / none / pinned state
   * (first-run D1/D3: it reads the RELAY, not the secret), then three
   * sentences and three doors.
   * The cards stack when the PANE is narrow (a container query), so it reads
   * in a split beside the note too.
   */
  import { Laptop, LogIn, Monitor, Share2 } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { Clock } from '@ohhi/vault'
  import { nothingShared, relayHost, sharedSnapshot, type RelayTokenInput } from '@ohhi/workspace'
  import { actorKey, changeActors, foldChanges, type ChangeLine } from '../changes.js'
  import { actorText } from '../event-text.js'
  import { asPeer, noteName } from '../presence.js'
  import { realClock } from '../real-clock.js'
  import { listShares } from '../relay-admin.js'
  import { clockTick, dayWord, relativeTime } from '../relative-time.js'
  import { roomRollup, snapshotInput } from '../shared.svelte.js'
  import { DEFAULT_RELAY, DEFAULT_RELAY_CONFIGURED, TEAM_HOST, TEAM_NETWORK_NOTE, rootShareKind } from '../config.js'
  import type { ProbeResult } from '../relay-probe.js'
  import RelayCard from './RelayCard.svelte'
  import { shareableDirs } from '../tree-model.js'
  import { CARD, HEADING, OUTLINE_BUTTON } from '../ui/styles.js'
  import { getViewShell, type ViewProps, type ViewShell } from '../views.js'
  import type { LogTime } from '../log-view.js'
  import PresenceStack from './PresenceStack.svelte'
  import ShareFolderPicker from './ShareFolderPicker.svelte'
  import SyncPill from './SyncPill.svelte'
  import { pillTitle } from '../pill-status.js'

  interface Props extends ViewProps {
    /** Injected for the tests; the shell's (via the view context) otherwise. */
    shell?: ViewShell | null
    clock?: Clock
    /** Injected for the tests: the relay admin list call. */
    list?: (relay: string, secret: string, room: string) => Promise<RelayTokenInput[]>
    /** Injected for the tests: the relay health check (the empty state's card). */
    probe?: (relayUrl: string) => Promise<ProbeResult>
    /** The build's pinned host, team relay and network sentence (config.ts); injectable for tests. */
    pinnedHost?: string
    teamRelay?: string
    networkNote?: string
  }

  const ctxShell = getViewShell()
  let {
    workspace,
    shell = ctxShell,
    clock = ctxShell?.clock ?? realClock,
    list = listShares,
    probe,
    pinnedHost = TEAM_HOST,
    teamRelay = DEFAULT_RELAY_CONFIGURED ? DEFAULT_RELAY : '',
    networkNote = TEAM_NETWORK_NOTE,
  }: Props = $props()
  const teamHost = $derived(teamRelay ? (relayHost(teamRelay) ?? '') : '')
  const relayIsKnown = $derived(!!shell?.relayKnown() || !!pinnedHost)
  /** Settings › Sync, where the relay is changed — never offered in a pinned build (the card hides it). */
  const changeRelay = (): void => shell?.openSettings('sync')

  // svelte-ignore state_referenced_locally -- the clock is fixed at mount
  const tick = clockTick(clock)

  const t = $derived($LL.web.shared)
  const ui = $derived(workspace.ui)

  // ---- the relay's token lists (links per carved room; device links on the root) ----
  let tokensByRoom = $state<Record<string, RelayTokenInput[]>>({})
  const secret = $derived(shell?.secret() ?? '')
  /** Rooms whose lists this vault may read: its own carves, and the root's device links. */
  const listable = $derived.by(() => {
    const out: { room: string; relay: string }[] = []
    for (const m of ui.mounts) {
      const yours = m.provenance === 'carved' || (m.provenance === 'adopted' && !m.foreign)
      if (yours && m.status === 'active') out.push({ room: m.room, relay: m.relay })
    }
    out.push({ room: workspace.room, relay: workspace.rootRelayUrl() })
    return out
  })
  $effect(() => {
    void shell?.revision()
    const rooms = listable
    const key = secret
    if (!key) {
      tokensByRoom = {}
      return
    }
    let live = true
    void Promise.all(
      rooms.map(async ({ room, relay }) => {
        try {
          return [room, await list(relay, key, room)] as const
        } catch {
          return null // unreadable: the card says less, never something wrong
        }
      })
    ).then((pairs) => {
      if (!live) return
      tokensByRoom = Object.fromEntries(pairs.filter((p) => p !== null))
    })
    return () => {
      live = false
    }
  })

  /** Per-note presence (sharing E1): whose caret is in which note. */
  const presenceByPath = $derived(
    Object.fromEntries(
      Object.entries(ui.presenceByPath ?? {}).map(([path, peers]) => [
        path,
        peers.map((p) => ({ name: p.name, color: String(p.color) })),
      ])
    )
  )
  const snap = $derived(
    sharedSnapshot(snapshotInput(workspace, { tokensByRoom, inSyncByRoom: shell?.inSyncByRoom() ?? {}, presenceByPath }))
  )
  const empty = $derived(nothingShared(snap, ui.linked))
  /** What the root is: a share opened as a vault, a device-linked vault, or local (join-share-brief P2). */
  const rootShare = $derived(rootShareKind(workspace.room, ui.linked))

  // ---- helpers ----
  const ago = (at: number): string => relativeTime(at, $tick, $LL)
  const mountOf = (room: string) => ui.mounts.find((m) => m.room === room)
  const roomName = (room: string): string => mountOf(room)?.path ?? workspace.room

  // ---- the three doors ----
  let picking = $state(false)
  const pickable = $derived(shareableDirs(ui.files, ui.mounts))
  const doorButton = `${OUTLINE_BUTTON} px-2.5 py-1 text-xs text-base-content/80`

  // ---- changes (E3): filter row + the fold ----
  let roomFilter = $state('')
  let personFilter = $state('')
  let timeFilter = $state<LogTime>('all')
  const days = $derived(
    foldChanges(
      ui.events,
      {
        ...(roomFilter ? { room: roomFilter } : {}),
        ...(personFilter ? { person: personFilter } : {}),
        time: timeFilter,
      },
      $tick
    )
  )
  const anyChanges = $derived(foldChanges(ui.events).length > 0)
  const todayCount = $derived(foldChanges(ui.events, { time: 'today' }, $tick).reduce((n, d) => n + d.lines.length, 0))
  const actors = $derived(changeActors(ui.events))
  const changeRooms = $derived([
    ...(ui.linked ? [{ room: workspace.room, label: t.devices.this_device() }] : []),
    ...snap.rooms.map((r) => ({ room: r.room, label: r.path })),
  ])
  function dayLabel(day: number): string {
    // By the calendar, never `today − 24 h`: a daylight-saving day is 23 or 25 hours long.
    const word = dayWord(day, $tick)
    if (word === 'today') return t.changes.day_today()
    if (word === 'yesterday') return t.changes.day_yesterday()
    return new Date(day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  }
  const clockTime = (at: number): string =>
    new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  function lineWhat(l: ChangeLine): string {
    if (l.kind === 'file.created') return t.changes.created()
    if (l.kind === 'file.deleted') return t.changes.deleted()
    if (l.kind === 'file.moved') return t.changes.moved({ from: l.from ?? '' })
    return ''
  }
  function delta(l: ChangeLine): string {
    const parts: string[] = []
    if (l.added) parts.push(`+${l.added}`)
    if (l.removed) parts.push(`−${l.removed}`)
    return parts.join(' ')
  }
  const select = 'rounded border border-base-300 bg-base-100 px-1 py-0.5 text-[11px] text-base-content'
</script>

<section
  data-testid="shared-view"
  aria-labelledby="shared-view-title"
  class="@container h-full min-h-0 overflow-y-auto bg-base-200 text-sm text-base-content"
>
  <div class="mx-auto flex max-w-5xl flex-col gap-4 p-4">
    <header class="flex flex-wrap items-center gap-2">
      <h2 id="shared-view-title" class="m-0 mr-auto text-base font-semibold">{t.title()}</h2>
      {#if !empty}
        <button type="button" data-testid="shared-share" onclick={() => (picking = true)} class={doorButton}
          >{t.actions.share()}</button
        >
        <button type="button" data-testid="shared-add" onclick={() => shell?.addSharedFolder('')} class={doorButton}
          >{t.actions.add()}</button
        >
        <button type="button" data-testid="shared-link-device" onclick={() => shell?.linkDevice()} class={doorButton}
          >{t.actions.link()}</button
        >
      {/if}
    </header>

    {#if empty}
      <!-- The onboarding into collaboration (Frame C, empty). -->
      <div data-testid="shared-empty" class="flex flex-col gap-4">
        <div class="grid gap-1">
          <h3 class="m-0 text-lg font-semibold">{t.empty.title()}</h3>
          <p class="text-base-content/80">{t.empty.body()}</p>
        </div>
        <!-- The relay first (first-run D1/D3): it reads the RELAY, not the
             secret — a team build knows where shares go before anyone has
             the secret; what is still needed sits under the card. -->
        <div data-testid="shared-empty-relay" class="grid gap-1.5">
          <h4 class="m-0 {HEADING}">{t.empty.relay_label()}</h4>
          <RelayCard
            relayUrl={shell?.relayUrl() ?? ''}
            known={relayIsKnown}
            {pinnedHost}
            {teamHost}
            {networkNote}
            {clock}
            {probe}
            onChange={changeRelay}
          />
          {#if relayIsKnown && !secret}
            <p data-testid="shared-empty-secret" class="m-0 text-xs text-base-content/80">{t.empty.secret_once()}</p>
          {/if}
        </div>
        <div class="grid grid-cols-1 gap-3 @2xl:grid-cols-3">
          <div class="{CARD} grid content-start gap-2 p-4">
            <Share2 size={20} aria-hidden="true" class="text-primary" />
            <h4 class="m-0 font-semibold">{t.empty.share_title()}</h4>
            <p class="text-xs text-base-content/80">{t.empty.share_body()}</p>
            <button
              type="button"
              data-testid="shared-share"
              onclick={() => (picking = true)}
              class="justify-self-start rounded bg-primary px-2.5 py-1 text-xs text-primary-content focus-visible:outline-2 focus-visible:outline-primary"
              >{t.actions.share()}</button
            >
          </div>
          <div class="{CARD} grid content-start gap-2 p-4">
            <LogIn size={20} aria-hidden="true" class="text-primary" />
            <h4 class="m-0 font-semibold">{t.empty.add_title()}</h4>
            <p class="text-xs text-base-content/80">{t.empty.add_body()}</p>
            <button type="button" data-testid="shared-add" onclick={() => shell?.addSharedFolder('')} class="{doorButton} justify-self-start"
              >{t.actions.add()}</button
            >
          </div>
          <div class="{CARD} grid content-start gap-2 p-4">
            <Laptop size={20} aria-hidden="true" class="text-primary" />
            <h4 class="m-0 font-semibold">{t.empty.link_title()}</h4>
            <p class="text-xs text-base-content/80">{t.empty.link_body()}</p>
            <button type="button" data-testid="shared-link-device" onclick={() => shell?.linkDevice()} class="{doorButton} justify-self-start"
              >{t.actions.link()}</button
            >
          </div>
        </div>
      </div>
    {:else}
      <!-- The relay, first: a place with a state (R4). -->
      {#each snap.relays as relay (relay.host)}
        <RelayCard
          relayUrl={relay.host}
          connection={relay}
          showPeople
          {pinnedHost}
          {teamHost}
          {clock}
          onChange={changeRelay}
        />
      {/each}

      <div class="grid grid-cols-1 gap-3 @3xl:grid-cols-[1.3fr_1fr_1fr]">
        <!-- Shared folders: carved and joined rooms only; counts and stacks, never the note. -->
        <div data-testid="shared-folders" class="{CARD} grid content-start gap-2 p-3">
          <h3 class="m-0 flex items-center gap-2 {HEADING}">
            {t.folders.title()}<span class="ml-auto tracking-normal normal-case">{snap.rooms.length}</span>
          </h3>
          {#if snap.rooms.length === 0 && rootShare !== 'joined'}
            <p class="text-xs text-base-content/80">{t.empty.share_body()}</p>
          {/if}
          <ul class="grid gap-2">
            {#if rootShare === 'joined'}
              <!-- A share opened as a vault (join-share-brief P2): the root IS the
                   shared folder, so it reads as one — "This whole vault". -->
              <li
                data-testid="shared-root"
                data-provenance="joined"
                class="grid grid-cols-[3px_1fr] items-center gap-2.5 rounded-lg border border-base-300 py-2 pr-2.5"
              >
                <span aria-hidden="true" class="self-stretch rounded-l-lg bg-secondary"></span>
                <div class="grid min-w-0 gap-0.5">
                  <span class="truncate font-medium">{t.folders.whole_vault()}</span>
                  <span class="text-xs text-base-content/80">{t.folders.whole_vault_body()}</span>
                </div>
              </li>
            {/if}
            {#each snap.rooms as room (room.room)}
              {@const status = roomRollup(workspace, room.room)}
              <li
                data-testid="shared-room:{room.path}"
                data-provenance={room.provenance}
                class="grid grid-cols-[3px_1fr_auto] items-center gap-2.5 rounded-lg border border-base-300 py-2 pr-2.5"
              >
                <span
                  aria-hidden="true"
                  class="self-stretch rounded-l-lg {room.provenance === 'carved' ? 'bg-primary' : 'bg-secondary'}"
                ></span>
                <div class="grid min-w-0 gap-0.5">
                  <span class="truncate font-medium">{room.path}</span>
                  <span class="flex flex-wrap gap-x-2 text-xs text-base-content/80">
                    <span>{room.provenance === 'carved' ? t.folders.by_you() : t.folders.with_you()}</span>
                    <span>{t.folders.notes({ count: room.noteCount })}</span>
                    {#if room.links}<span data-testid="shared-room-links">{t.folders.links({ count: room.links.length })}</span>{/if}
                    {#if room.lastChangeAt !== undefined}<span>{t.folders.changed({ when: ago(room.lastChangeAt) })}</span>{/if}
                    {#if room.status === 'needs-token'}<span>{$LL.web.mounts.link_needed()}</span>{/if}
                  </span>
                  <span class="flex flex-wrap gap-1.5 pt-1">
                    <button
                      type="button"
                      data-testid="shared-room-manage:{room.path}"
                      onclick={() => shell?.shareFolder(room.path)}
                      class="{OUTLINE_BUTTON} px-2 py-0.5 text-[11px] text-base-content/80"
                      >{room.provenance === 'carved' ? t.folders.manage() : t.folders.details()}</button
                    >
                    <button
                      type="button"
                      data-testid="shared-room-open:{room.path}"
                      aria-label={t.folders.open_folder({ path: room.path })}
                      onclick={() => shell?.revealFolder(room.path)}
                      class="{OUTLINE_BUTTON} px-2 py-0.5 text-[11px] text-base-content/80">{t.folders.open()}</button
                    >
                  </span>
                </div>
                <span class="flex items-center gap-2">
                  {#if room.peers.length}
                    <!-- The one avatar renderer (PresenceStack): the presence band and its ink, capped by `capped()`. -->
                    <span data-testid="shared-room-stack:{room.path}" class="flex items-center" title={room.peers.map((p) => p.name).join(', ')}>
                      <span aria-hidden="true" class="contents">
                        <PresenceStack peers={room.peers.map(asPeer)} testid="shared-room-peers:{room.path}" size="md" />
                      </span>
                      <span class="sr-only">{t.folders.online({ count: room.peers.length })}</span>
                    </span>
                  {/if}
                  {#if status}<SyncPill {status} testid="shared-room-pill:{room.path}" title={pillTitle(status)} />{/if}
                </span>
              </li>
            {/each}
          </ul>
        </div>

        <!-- People (E5): one fact per person — the note their caret is in. -->
        <div data-testid="shared-people" class="{CARD} grid content-start gap-1.5 p-3">
          <h3 class="m-0 flex items-center gap-2 {HEADING}">
            {t.people.title()}<span class="ml-auto tracking-normal normal-case"
              >{snap.people.length ? t.people.online({ count: snap.people.length }) : t.people.only_you()}</span
            >
          </h3>
          <ul data-testid="shared-presence" class="grid gap-1">
            {#each snap.people as p (p.name)}
              <li data-testid="shared-person:{p.name}" class="flex min-w-0 items-center gap-2 py-0.5">
                <!-- The name follows in text, so the initial is decoration here. -->
                <span aria-hidden="true" class="contents">
                  <PresenceStack peers={[asPeer(p)]} testid="shared-person-initial:{p.name}" size="md" />
                </span>
                <span class="font-medium">{p.name}</span>
                {#if p.path}
                  <button
                    type="button"
                    data-testid="shared-person-jump:{p.name}"
                    aria-label={t.people.jump({ note: noteName(p.path), name: p.name })}
                    onclick={() => shell?.openPath(p.path!)}
                    class="ml-auto truncate rounded px-1 text-xs text-base-content/80 hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
                    >{t.people.in_note({ note: noteName(p.path) })}</button
                  >
                {:else if mountOf(p.room)}
                  <span class="ml-auto truncate text-xs text-base-content/80">{t.people.in_folder({ folder: roomName(p.room) })}</span>
                {/if}
              </li>
            {/each}
          </ul>
          {#if snap.people.length === 0}
            <p data-testid="shared-alone" class="text-xs text-base-content/80">
              {t.people.alone()}
              {#if snap.lastSeen}{t.people.last_here({ name: snap.lastSeen.name, when: ago(snap.lastSeen.at) })}{/if}
            </p>
          {/if}
          <p class="text-[11px] text-base-content/80">{t.people.honesty()}</p>
        </div>

        <!-- Your devices: the only place the linked vault appears. -->
        <div data-testid="shared-devices" class="{CARD} grid content-start gap-1.5 p-3">
          <h3 class="m-0 flex items-center gap-2 {HEADING}">
            {t.devices.title()}<span class="ml-auto tracking-normal normal-case">{snap.devices.length}</span>
          </h3>
          <ul class="grid gap-1">
            {#each snap.devices as d, i (i)}
              <li data-testid={d.thisDevice ? 'shared-device-this' : 'shared-device'} class="flex items-center gap-2 py-0.5">
                {#if d.thisDevice}
                  <Monitor size={16} aria-hidden="true" class="text-base-content/70" />
                  <span class="font-medium">{d.label || t.devices.this_device()}</span>
                  {#if d.label}<span class="ml-auto font-ed-mono text-[11px] text-base-content/80">{t.devices.this_device_tag()}</span>{/if}
                {:else}
                  <Laptop size={16} aria-hidden="true" class="text-base-content/70" />
                  <span class="font-medium">{d.label || t.devices.unnamed()}</span>
                  {#if d.onlineAt !== undefined}
                    <span class="ml-auto font-ed-mono text-[11px] text-base-content/80">{t.devices.online_at({ when: ago(d.onlineAt) })}</span>
                  {/if}
                {/if}
              </li>
            {/each}
          </ul>
          {#if rootShare === 'devices'}
            <p data-testid="shared-devices-linked" class="text-xs text-base-content/80">{t.devices.linked()}</p>
            {#if !secret}<p class="text-[11px] text-base-content/80">{t.devices.needs_secret()}</p>{/if}
          {/if}
          <p class="text-[11px] text-base-content/80">{$LL.web.device_link.full_access_warning()}</p>
          <button
            type="button"
            data-testid="shared-devices-link"
            onclick={() => shell?.linkDevice()}
            class="{OUTLINE_BUTTON} justify-self-start px-2 py-0.5 text-[11px] text-base-content/80">{t.actions.link()}</button
          >
        </div>
      </div>

      <!-- Changes (E3): compact by default, filterable; Show all is the Log. -->
      <div data-testid="shared-changes" class="{CARD} grid content-start gap-2 p-3">
        <h3 class="m-0 flex items-center gap-2 {HEADING}">
          {t.changes.title()}<span class="ml-auto tracking-normal normal-case">{t.changes.today({ count: todayCount })}</span>
        </h3>
        <div role="group" aria-label={t.changes.filters()} class="flex flex-wrap items-center gap-2 text-[11px] text-base-content/80">
          <label class="flex items-center gap-1"
            >{t.changes.room_label()}
            <select data-testid="changes-room" bind:value={roomFilter} class={select}>
              <option value="">{t.changes.room_all()}</option>
              {#each changeRooms as r (r.room)}<option value={r.room}>{r.label}</option>{/each}
            </select></label
          >
          <label class="flex items-center gap-1"
            >{t.changes.person_label()}
            <select data-testid="changes-person" bind:value={personFilter} class={select}>
              <option value="">{t.changes.person_all()}</option>
              {#each actors as a (actorKey(a))}<option value={actorKey(a)}>{actorText(a, $LL)}</option>{/each}
            </select></label
          >
          <label class="flex items-center gap-1"
            >{t.changes.time_label()}
            <select data-testid="changes-time" bind:value={timeFilter} class={select}>
              <option value="all">{t.changes.time.all()}</option>
              <option value="today">{t.changes.time.today()}</option>
              <option value="week">{t.changes.time.week()}</option>
            </select></label
          >
          <button
            type="button"
            data-testid="changes-show-all"
            onclick={() => shell?.openView('log', 'changes')}
            class="{OUTLINE_BUTTON} ml-auto px-2 py-0.5 text-[11px] text-base-content/80">{t.changes.show_all()}</button
          >
        </div>
        {#if days.length === 0}
          <p data-testid="changes-empty" class="text-xs text-base-content/80">
            {anyChanges ? t.changes.none_filtered() : t.changes.none()}
          </p>
        {:else}
          {#each days as day (day.day)}
            <h4 class="m-0 mt-1 {HEADING}">{dayLabel(day.day)}</h4>
            <ol class="grid gap-0.5">
              {#each day.lines as line (line.id)}
                <li data-testid="change-line" class="flex min-w-0 items-start gap-2 py-1 text-xs">
                  <span class="min-w-10 pt-0.5 font-ed-mono text-[11px] text-base-content/80">{clockTime(line.at)}</span>
                  <span class="grid min-w-0 gap-px">
                    <span class="font-medium">{actorText(line.actor, $LL)}</span>
                    <span class="flex min-w-0 gap-1 text-base-content/80">
                      {#if line.kind === 'file.deleted'}
                        <span class="truncate">{line.path}</span>
                      {:else}
                        <button
                          type="button"
                          onclick={() => shell?.openPath(line.path)}
                          class="truncate rounded text-left hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                          >{line.path.replace(/\.md$/i, '')}</button
                        >
                      {/if}
                      {#if lineWhat(line)}<span>· {lineWhat(line)}</span>{/if}
                    </span>
                  </span>
                  <span class="ml-auto pt-0.5 font-ed-mono text-[11px] whitespace-nowrap text-base-content/80">{delta(line)}</span>
                </li>
              {/each}
            </ol>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</section>

{#if picking}
  <ShareFolderPicker
    dirs={pickable}
    onPick={(dir) => {
      picking = false
      shell?.shareFolder(dir)
    }}
    onClose={() => (picking = false)}
  />
{/if}
