<script lang="ts">
  /**
   * `sync` (foundations-plan P5): ONE icon for the sync state and the people
   * — what `note.pill`, `vault.pill` and `people` were. The Shared view's
   * glyph, its STROKE the state: the focused note's `pillStatus` when a note
   * is open, else the vault rollup (`scopedRollup`). The colour is libs/ui's
   * UNLAYERED `[data-status] > .ed-sync-icon` rules on the svg itself, so no
   * theme can repaint or hide it (golden rule 4); `data-status` and the old
   * testids (`sync-pill-note`, `toolbar-vault-pill`) ride the button.
   *
   * Beside it, the avatars of whoever is online in the rooms you are in
   * (`PresenceStack`, cap three + "+N"); alone, just the icon (R6). Hover or
   * focus opens a hover card (`ui/Popover`, `peek`) listing who is editing
   * where, per room, each row a jump to their caret; a click opens Shared.
   * In a status bar (`ctx.pane`) it renders compact: a count, not avatars.
   *
   * While developer tools are on (`ctx.devtools`), the card is also the
   * inspector's door for the focused note (devtools-shaping Fork 7, DT5):
   * a footer entry opens that note's detail in its own tab
   * (`openView('inspector', path)`), and the card opens with a note focused
   * even when nobody else is here. Off, the card is exactly the people list.
   */
  import { ScanSearch } from '@lucide/svelte'
  import type * as Y from 'yjs'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { vaultLabel, vaultTitle, pillTitle } from '../../pill-status.js'
  import { caretOffset, initialsOf, noteName, onlinePeers, whoIsWhere, type Peer } from '../../presence.js'
  import { noteStatus } from '../../readout-state.js'
  import { readoutPlacement, readoutTestid, targetOf, type ReadoutContext } from '../../readouts.js'
  import { scopedRollup } from '../../share-status.js'
  import { getViewShell, shellClock, VIEWS } from '../../views.js'
  import IconButton from '../../ui/IconButton.svelte'
  import Popover from '../../ui/Popover.svelte'
  import PresenceStack from '../PresenceStack.svelte'

  let { ctx }: { ctx: Pick<ReadoutContext, 'workspace' | 'panes' | 'nav' | 'merged' | 'side' | 'pane' | 'devtools'> } = $props()

  const shell = getViewShell()
  const clock = shellClock()
  /** Leaving the icon for the card crosses a gap; this long, the card waits. */
  const CLOSE_DELAY_MS = 200

  const ui = $derived(ctx.workspace.ui)
  const focused = $derived(targetOf(ctx))
  const note = $derived(noteStatus(ui.files, ui.records, focused.path))
  const rollup = $derived(scopedRollup(ui.files, ui.records, ui.mounts, ui.linked))
  const status = $derived(note ?? rollup ?? null)
  const testid = $derived(
    note ? readoutTestid(ctx, 'sync-pill-note') : ctx.pane ? readoutTestid(ctx, 'vault-pill') : 'toolbar-vault-pill'
  )
  const self = $derived(ctx.workspace.user.name)
  const peers = $derived(onlinePeers(ui.presenceByRoom, self))
  const groups = $derived(
    peers.length ? whoIsWhere(ui.presenceByPath, ui.presenceByRoom, ui.mounts, ctx.workspace.room, self) : []
  )
  const compact = $derived(ctx.pane !== undefined)
  /** The note the card's inspector door opens; null while developer tools are off or no note is focused. */
  const inspectPath = $derived(ctx.devtools?.() ? focused.path : null)
  /** Whether the hover card has anything to show: people, or the inspector's door. */
  const hasCard = $derived(peers.length > 0 || inspectPath !== null)
  const t = $derived($LL.web.presence)
  const words = $derived(status ? vaultLabel(status) : $LL.web.shell.nothing_shared())
  const said = $derived(peers.length ? t.sync.with_people({ status: words, count: peers.length }) : words)
  /** A host's read-only grant (Nextcloud): every reading of the state says so. */
  const readOnly = $derived(ctx.workspace.ui.readOnly === true)
  const ro = (s: string): string => (readOnly ? $LL.web.pill.read_only({ state: s }) : s)
  const label = $derived($LL.web.shared.door.aria({ status: ro(said) }))
  const title = $derived(ro(status ? (note ? pillTitle(status) : vaultTitle(status)) : said))

  let open = $state(false)
  let host = $state<HTMLElement>()
  let cancelClose: (() => void) | null = null
  function stopClosing(): void {
    cancelClose?.()
    cancelClose = null
  }
  function show(): void {
    stopClosing()
    if (hasCard) open = true
  }
  function hideSoon(): void {
    stopClosing()
    cancelClose = clock.schedule(() => {
      cancelClose = null
      open = false
    }, CLOSE_DELAY_MS)
  }
  function leaveFocus(e: FocusEvent): void {
    if (!(e.relatedTarget instanceof Node && host?.contains(e.relatedTarget))) hideSoon()
  }
  $effect(() => {
    if (!hasCard) open = false
  })
  $effect(() => stopClosing)

  function openShared(): void {
    stopClosing()
    open = false
    shell?.openView('shared')
  }

  function inspect(path: string): void {
    stopClosing()
    open = false
    // A pane's own status bar speaks for THAT pane's note: focus it first, so
    // the tab opens beside the note it describes, not in the focused pane.
    if (ctx.pane && !ctx.pane.focused) ctx.panes.focusPane(ctx.pane.id)
    shell?.openView('inspector', path)
  }

  function jump(path: string, peer: Peer): void {
    open = false
    shell?.openPath(path)
    const doc = ctx.workspace.docForPath(path)
    const states = ctx.workspace.awarenessForPath(path)?.getStates() as
      | Map<number, Record<string, unknown>>
      | undefined
    const offset = doc ? caretOffset(states, doc.raw() as Y.Doc, peer.clientId) : null
    // A NEW object every time, so the same caret twice still reveals.
    if (offset !== null) ctx.nav.pending.reveal = { offset }
  }

  const folderName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
</script>

<div
  bind:this={host}
  data-testid="sync-readout"
  class="relative inline-flex items-center gap-1"
  role="group"
  onpointerenter={show}
  onpointerleave={hideSoon}
  onfocusin={show}
  onfocusout={leaveFocus}
>
  {#if status}
    <IconButton
      {label}
      icon={VIEWS.shared.icon}
      testid={testid}
      data-status={status}
      data-read-only={readOnly ? '' : undefined}
      title={hasCard ? undefined : title}
      tooltip={false}
      class="ed-sync-host"
      iconClass="ed-sync-icon"
      aria-haspopup={hasCard ? 'dialog' : undefined}
      aria-expanded={hasCard ? open : undefined}
      onclick={openShared}
    />
  {:else}
    <!-- Nothing shared and no note with a relay: no state to colour, so no
         `data-status` and no sync paint — still the door to Shared. -->
    <IconButton
      {label}
      icon={VIEWS.shared.icon}
      testid="toolbar-vault-summary"
      title={hasCard ? undefined : title}
      tooltip={false}
      aria-haspopup={hasCard ? 'dialog' : undefined}
      aria-expanded={hasCard ? open : undefined}
      onclick={openShared}
    />
  {/if}
  {#if peers.length > 0}
    {#if compact}
      <span data-testid="sync-people-count" aria-hidden="true" class="text-[10px] text-base-content/70">{peers.length}</span>
    {:else}
      <PresenceStack {peers} testid="sync-people" />
    {/if}
  {/if}

  {#if open && hasCard}
    <Popover
      anchor={host ?? null}
      placement={readoutPlacement(ctx)}
      title={peers.length ? t.sync.title() : t.sync.title_alone()}
      testid="sync-people-card"
      peek
      onClose={() => (open = false)}
    >
      {#if peers.length > 0}
        <div data-testid="presence" class="max-h-96 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto py-1 text-xs">
          {#each groups as group (group.room)}
            <section>
              <h3 class="px-3 pt-2 pb-1 text-[11px] font-semibold text-base-content/80">
                {group.mountPath ? folderName(group.mountPath) : t.people.vault()}
              </h3>
              <ul>
                {#each group.people as { peer, path } (`${peer.name}:${path ?? ''}`)}
                  <li>
                    {#if path}
                      <button
                        type="button"
                        data-testid="people-row"
                        data-peer={peer.name}
                        data-path={path}
                        title={t.people.jump({ name: peer.name, note: noteName(path) })}
                        onclick={() => jump(path, peer)}
                        class="flex w-full items-center gap-2 px-3 py-1 text-left text-base-content hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        {@render avatar(peer)}
                        <span class="truncate font-medium">{peer.name}</span>
                        <span class="ml-auto truncate text-base-content/70">{t.people.in_note({ note: noteName(path) })}</span>
                      </button>
                    {:else}
                      <div data-testid="people-row" data-peer={peer.name} class="flex items-center gap-2 px-3 py-1 text-base-content">
                        {@render avatar(peer)}
                        <span class="truncate font-medium">{peer.name}</span>
                        <span class="ml-auto truncate text-base-content/70">{t.people.online()}</span>
                      </div>
                    {/if}
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        </div>
      {/if}
      {#if inspectPath}
        <div class="w-72 max-w-[calc(100vw-2rem)] py-1 text-xs {peers.length ? 'border-t border-base-300' : ''}">
          <button
            type="button"
            data-testid="sync-inspect-note"
            title={t.sync.inspect_path({ path: inspectPath })}
            onclick={() => inspect(inspectPath)}
            class="flex w-full items-center gap-2 px-3 py-1 text-left text-base-content hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
          >
            <ScanSearch aria-hidden="true" class="size-4 shrink-0 text-base-content/70" />
            <span class="truncate">{t.sync.inspect()}</span>
          </button>
        </div>
      {/if}
    </Popover>
  {/if}
</div>

{#snippet avatar(peer: Peer)}
  <span
    aria-hidden="true"
    class="inline-grid size-5 shrink-0 place-items-center rounded-full text-[10px] leading-none font-semibold"
    style="background: var(--ed-presence-{peer.color}); color: var(--ed-presence-fg-{peer.color})"
  >
    {initialsOf(peer.name)}
  </span>
{/snippet}
