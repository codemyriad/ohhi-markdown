<script lang="ts" module>
  import { History, Link, MessageSquare, type LucideIcon } from '@lucide/svelte'
  import type { RailSectionId } from '../layout.js'

  /** One icon per dock tab (`RAIL_SECTIONS`): the strip's and the tab row's. */
  export const DOCK_ICONS: Record<RailSectionId, LucideIcon> = { links: Link, history: History, comments: MessageSquare }
</script>

<script lang="ts">
  /**
   * The dock's panel (Round 2 P4): the note's sections — Links, History,
   * Comments — behind one tab row, with pin and collapse at the row's end,
   * and under it a context line naming the note they are about. ONE panel for
   * both forms: floating over the editor's right edge (`form: 'float'`, the
   * dock), or standing as the right column (`form: 'column'`, pinned). Which
   * tab is showing is `layout.railTab` and whether it is open `layout.railOpen`
   * — the same two states in either form, so a pinned column never also opens
   * a popover (the bug the Note menu had).
   *
   * The tab row (Round 3 Q3) is the note tab strip's height (32 px): small
   * labels beside their icons (`DOCK_ICONS`, the strip's own), pin and
   * collapse at its right end at the strip's control size — or, pinned as
   * the column, unpin alone (Chris, 2026-10-06: "once it's pinned I should
   * only have the option to unpin it").
   */
  import { ChevronsRight, Pin, PinOff } from '@lucide/svelte'
  import { untrack } from 'svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { RAIL_SECTIONS } from '../layout.js'
  import { overridesFor, type ShellSpec } from '../layout-spec.js'
  import type { Navigation } from '../navigation.svelte.js'
  import type { ShellLayout } from '../shell-layout.svelte.js'
  import IconButton from '../ui/IconButton.svelte'
  import Tabs from '../ui/Tabs.svelte'
  import { getViewShell, shellClock } from '../views.js'
  import type { Workspace } from '../workspace.svelte.js'
  import DockNoteContext from './DockNoteContext.svelte'
  import HistorySection from './HistorySection.svelte'
  import LinksPanel from './LinksPanel.svelte'
  import PinWideOnly from './PinWideOnly.svelte'
  import ThreadList from './ThreadList.svelte'
  import { openThread } from '../threads.svelte.js'

  interface Props {
    workspace: Workspace
    nav: Navigation
    layout: ShellLayout
    form: 'float' | 'column'
    /** Close the panel down to the strip; the host gives focus back to it. */
    onCollapse: () => void
    /** Put focus on the active tab once mounted (opened from the strip). */
    autofocus?: boolean
  }

  let { workspace, nav, layout, form, onCollapse, autofocus = false }: Props = $props()

  // Opening and creating are the ViewShell's verbs; no shell (a unit test) → none.
  const shell = getViewShell()
  const clock = shellClock()
  const t = $derived($LL.web.rail)

  const tabs = $derived(
    RAIL_SECTIONS.map((id) => ({ value: id, label: t.sections[id](), testid: `rail-tab:${id}`, icon: DOCK_ICONS[id] }))
  )
  /**
   * Unpin the column: back to the dock, whose collapsed form is the floating
   * strip. A device pin (`config.layout.pins`) is dropped; a column the
   * layout itself (or a Settings override) asks for becomes a device
   * override to `dock` — what Settings › Layout › Sidebar would write.
   */
  function unpin(): void {
    if (layout.pinned('rail')) layout.unpin('rail')
    if (layout.spec.regions.rail === 'column') {
      const own = $state.snapshot(layout.ownSpec) as ShellSpec
      const next = { ...own, regions: { ...own.regions, rail: 'dock' } } as ShellSpec
      layout.setOverrides(overridesFor($state.snapshot(layout.fileSpec) as ShellSpec, next))
    }
    // Closed, and focus goes back to the floating strip, as a collapse's does.
    onCollapse()
  }

  /**
   * The note every section follows, and the context line names: the focused
   * note, or the one focused last while a session or a view has the focus
   * (`ui.dockNote`, `dock-note.ts`). One read, so the line naming the note
   * and the bodies under it can never disagree.
   */
  const dockNote = $derived(workspace.ui.dockNote ?? null)
  const selectedPath = $derived(dockNote?.path ?? null)
  /** The open note's own sync record — History reads it. */
  const noteRecord = $derived.by(() => {
    if (!selectedPath) return null
    const guid = workspace.ui.files.find((f) => f.path === selectedPath)?.guid
    return (guid ? workspace.ui.records[guid] : undefined) ?? null
  })

  let root = $state<HTMLElement>()
  $effect(() => {
    if (autofocus) root?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus()
  })

  /**
   * `ui/Tabs` seeds its tab once; a tab picked from elsewhere while the panel
   * is open (`showSection` — the tree's *History*) re-mounts it on that tab.
   * A click in the row itself is the row's own news and keeps its focus.
   */
  let picked: RailSectionId = untrack(() => layout.railTab)
  let generation = $state(0)
  $effect(() => {
    const tab = layout.railTab
    if (tab !== picked) {
      picked = tab
      generation++
    }
  })
  function pick(next: string): void {
    const id = RAIL_SECTIONS.find((s) => s === next)
    if (!id) return
    picked = id
    layout.railTab = id
  }

  function onKeydown(e: KeyboardEvent): void {
    // The floating panel is a layer over the editor: Escape takes it down.
    // A dialog inside (History's restore confirm) owns its own Escape.
    if (form !== 'float' || e.key !== 'Escape' || e.defaultPrevented) return
    if ((e.target as HTMLElement | null)?.closest('[role="dialog"], [role="menu"]')) return
    e.preventDefault()
    onCollapse()
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -- Escape is a shortcut
     over the panel's own controls, not an interaction of the container -->
<div
  bind:this={root}
  data-testid="dock-panel"
  data-form={form}
  onkeydown={onKeydown}
  class="flex min-h-0 flex-1 flex-col bg-base-100 text-xs"
>
  <!-- `*:`: ui/Tabs' root takes the height, so only the section scrolls. -->
  <div class="flex min-h-0 flex-1 flex-col *:min-h-0 *:flex-1">
    {#key generation}
      <Tabs
        {tabs}
        bind:value={() => layout.railTab, pick}
        label={t.tabs()}
        testid="rail-tabs"
        size="sm"
        end={rowControls}
      >
        {#snippet panel(id)}
          <div class="flex h-full min-h-0 flex-col">
            <!-- The note the sections are about, above whichever is showing. -->
            <DockNoteContext note={dockNote} />
            <div data-testid="rail-section:{id}" class="min-h-0 flex-1 overflow-y-auto px-1 pt-1">
              <!-- The sections' own headings are h3s: this is the level above them. -->
              <h2 class="sr-only">{t.sections[id as RailSectionId]()}</h2>
              {#if id === 'links'}
                <LinksPanel
                  backlinks={nav.links.backlinks}
                  outgoing={nav.links.outgoing}
                  path={selectedPath}
                  onOpen={(path, opts) => shell?.openPath(path, opts)}
                  onCreate={(target) => shell?.createFromLink(target)}
                />
              {:else if id === 'history'}
                <HistorySection
                  path={selectedPath}
                  load={(p) => workspace.fileHistory(p)}
                  restore={(p, seq) => workspace.restorePreImage(p, seq)}
                  written={noteRecord?.diskMatchesCrdt ?? true}
                  now={() => clock.now()}
                />
              {:else if id === 'comments'}
                <!-- Comment threads (writing-harness B8): not AI-gated. -->
                <ThreadList
                  registry={nav.registry}
                  path={selectedPath}
                  {workspace}
                  onOpen={(thread) => selectedPath && openThread(selectedPath, thread)}
                  onExported={(p) => shell?.openPath(p)}
                  flash={(input) => workspace.flash(input)}
                />
              {/if}
            </div>
          </div>
        {/snippet}
      </Tabs>
    {/key}
  </div>
</div>

<!-- The tab row's right end (outside its tablist). Floating: pin and
     collapse. Pinned as the column: unpin ONLY — a pinned column is not
     collapsed, it is unpinned, which returns it to the floating strip. -->
{#snippet rowControls()}
  {#if form === 'float'}
    {#if layout.pinsHonoured}
      <IconButton label={t.pin()} icon={Pin} placement="bottom" testid="rail-pin" onclick={() => layout.pin('rail')} />
    {:else}
      <!-- A small screen (QA round 1): pins apply on wider screens only. -->
      <PinWideOnly
        pinned={layout.pinned('rail')}
        testid="rail-pin"
        onExplain={(text) => workspace.flash({ level: 'info', text })}
      />
    {/if}
    <IconButton label={t.collapse()} icon={ChevronsRight} placement="bottom" testid="rail-collapse" onclick={onCollapse} />
  {:else}
    <IconButton label={t.unpin()} icon={PinOff} placement="bottom" testid="rail-unpin" onclick={unpin} />
  {/if}
{/snippet}
