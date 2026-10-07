<script lang="ts">
  /**
   * The header's one line about the open note: its folders, then the note's
   * name. This is where "where am I" lives now that the header carries
   * nothing else.
   *
   * With the workspace in hand, a folder crumb opens a small popover about
   * that folder (sharing Fork 6-B, *This note* dissolved): whether it is
   * local or shared, by whom in the loosest honest sense and through which
   * relay — "Shared by you · relay.ohhi.md" — with *Show in navigator* and,
   * for a shared one, *Open Shared*. Without it, a crumb reveals the folder.
   */
  import { ChevronRight } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { folderShareFacts } from '../shared.svelte.js'
  import type { MenuPlacement } from '../ui/placement.js'
  import Popover from '../ui/Popover.svelte'
  import { getViewShell } from '../views.js'
  import type { Workspace } from '../workspace.svelte.js'

  interface Props {
    path: string | null
    onReveal: (dir: string) => void
    /** The open vault: crumbs become the folder popover. */
    workspace?: Workspace
    /** Where the folder popover opens: upward from a bottom toolbar. */
    placement?: MenuPlacement
  }

  let { path, onReveal, workspace, placement = 'bottom-start' }: Props = $props()

  const shell = getViewShell()
  const t = $derived($LL.web.breadcrumb)
  const parts = $derived(path ? path.split('/') : [])
  const dirs = $derived(parts.slice(0, -1))
  const name = $derived(parts.at(-1)?.replace(/\.md$/i, '') ?? '')

  let open = $state<{ dir: string; anchor: HTMLElement } | null>(null)
  const facts = $derived(
    open && workspace
      ? folderShareFacts(open.dir, workspace.ui.mounts, workspace.ui.linked, workspace.rootRelayUrl?.() ?? null)
      : null
  )
  const line = $derived.by(() => {
    if (!facts || facts.kind === 'local') return t.local()
    if (facts.status === 'needs-token') return $LL.web.mounts.rail_link_needed()
    const n = $LL.web.note
    const state =
      facts.tone === 'devices' ? n.on_your_devices() : facts.tone === 'yours' ? n.shared_by_you() : n.shared_with_you()
    return n.with_host({ state, host: facts.host })
  })

  /**
   * Which folder's popover was open when the press on a crumb began: the
   * popover's click-outside closes it on that same press, so the click that
   * follows must not read "closed" and open it again (the Drawer's rule) — a
   * second click on the same crumb closes it.
   */
  let openAtPress: string | null | undefined = undefined
  function crumb(full: string, e: MouseEvent): void {
    if (!workspace) return onReveal(full)
    const was = openAtPress === undefined ? (open?.dir ?? null) : openAtPress
    openAtPress = undefined
    open = was === full ? null : { dir: full, anchor: e.currentTarget as HTMLElement }
  }
  const verb =
    'rounded border border-base-300 px-2 py-0.5 text-[11px] text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary'
</script>

{#if path}
  <nav aria-label={t.label()} data-testid="breadcrumb" class="min-w-0">
    <ol class="flex min-w-0 items-center gap-0.5 text-sm">
      {#each dirs as dir, i (i)}
        {@const full = dirs.slice(0, i + 1).join('/')}
        <li class="flex min-w-0 items-center gap-0.5">
          <button
            type="button"
            data-testid="crumb:{full}"
            onpointerdowncapture={() => (openAtPress = open?.dir ?? null)}
            onclick={(e) => crumb(full, e)}
            title={workspace ? t.folder_title({ path: full }) : t.show_in_navigator({ path: full })}
            aria-haspopup={workspace ? 'dialog' : undefined}
            aria-expanded={workspace ? open?.dir === full : undefined}
            class="truncate rounded px-1 py-0.5 text-base-content/70 hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
          >
            {dir}
          </button>
          <ChevronRight size={12} aria-hidden="true" class="shrink-0 text-base-content/70" />
        </li>
      {/each}
      <li aria-current="page" data-testid="crumb-note" class="truncate px-1 font-medium text-base-content">
        {name}
      </li>
    </ol>
  </nav>
{:else}
  <span data-testid="breadcrumb" class="text-sm text-base-content/70">{t.no_note()}</span>
{/if}

{#if open}
  {@const dir = open.dir}
  <Popover anchor={open.anchor} {placement} title={t.folder_title({ path: dir })} testid="crumb-popover" onClose={() => (open = null)}>
    <div class="flex max-w-72 flex-col gap-2 p-3 text-xs">
      <p class="m-0 truncate font-ed-mono font-medium text-base-content">{dir}</p>
      <p data-testid="crumb-share-state" class="m-0 text-base-content/80">{line}</p>
      <div class="flex flex-wrap gap-1.5">
        <button
          type="button"
          data-testid="crumb-reveal"
          onclick={() => {
            const target = dir // read before closing: `dir` derives from `open`
            open = null
            onReveal(target)
          }}
          class={verb}>{t.reveal()}</button
        >
        {#if facts?.kind === 'shared' && shell}
          <button
            type="button"
            data-testid="crumb-open-shared"
            onclick={() => {
              open = null
              shell.openView('shared')
            }}
            class={verb}>{t.open_shared()}</button
          >
        {/if}
      </div>
    </div>
  </Popover>
{/if}
