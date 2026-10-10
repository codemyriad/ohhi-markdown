<script lang="ts" module>
  /** A layout naming a command the shell does not have: said once per id, not per render. */
  const warned = new Set<string>()
  function warnOnce(id: string): void {
    if (warned.has(id)) return
    warned.add(id)
    console.warn(`[format bar] "${id}" in bars.format is not a command this bar can show — skipped`)
  }
</script>

<script lang="ts">
  /**
   * The format bar (round 2, P2; round 3, Q2): `bars.format` — command ids
   * rendered as buttons whose names and bindings come from the registry, so
   * a button, a palette row and a key are one command; `"|"` is a
   * separator. It floats over the editor as a pill, like the dock's strip:
   * `regions.format` says where its HOST (`EditorArea.svelte`'s floating
   * layer) puts it — bottom centre, under the header centred, or nowhere —
   * and the bar opens its tooltips and menus away from that edge.
   *
   * One tab stop (`role=toolbar`, roving focus — arrows, Home, End). At a
   * narrow width (a container query on the floating layer — the bar's own
   * width is its content's) every command folds into one *Format* menu.
   * Every `toolbar:format.*`, `toolbar-format*` and `toolbar-menu:*` testid
   * is the toolbar's, kept; the pill is `format-bar`, with `data-position`.
   */
  import { ChevronDown, Heading, Type, type LucideIcon } from '@lucide/svelte'
  import { melt } from '@melt-ui/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { TOOLBAR_ITEM_IDS } from '../command-ids.js'
  import { FORMAT_ICONS } from '../format-icons.js'
  import type { CommandRegistry } from '../commands.js'
  import { SEPARATOR } from '../layout-spec.js'
  import { focusedOf } from '../readout-state.js'
  import type { ReadoutContext } from '../readouts.js'
  import DropdownMenu, { type MenuItemAttrs } from '../ui/DropdownMenu.svelte'
  import IconButton from '../ui/IconButton.svelte'
  import MenuItem from '../ui/MenuItem.svelte'
  import MenuSeparator from '../ui/MenuSeparator.svelte'
  import { menuPlacement, sideAwayFrom, type Side } from '../ui/placement.js'
  import { roving } from '../ui/roving.js'

  interface Props {
    /** The command ids to draw: the layout's `bars.format`. */
    ids: readonly string[]
    /** Which edge of the editor area the bar floats at: its overlays open away from it. */
    edge: Side
    ctx: ReadoutContext
    registry: CommandRegistry
  }

  let { ids, edge, ctx, registry }: Props = $props()

  /** The icon each format command is drawn with. A command id with none here is not a format button. */
  const ICONS = FORMAT_ICONS

  /** The one grouped entry (Fork 4's "paragraph style"): a menu of the block styles. */
  const [PARAGRAPH_STYLE] = TOOLBAR_ITEM_IDS
  const STYLE_IDS = ['format.paragraph', 'format.heading-1', 'format.heading-2', 'format.heading-3', 'format.quote']

  type Entry =
    | { kind: 'separator'; key: string }
    | { kind: 'command'; key: string; id: string; title: string; binding: string; icon: LucideIcon }
    | { kind: 'styles'; key: string; items: Extract<Entry, { kind: 'command' }>[] }

  function commandEntry(id: string, key: string): Extract<Entry, { kind: 'command' }> | null {
    const command = registry.get(id)
    const icon = ICONS[id]
    if (!command || !icon) return null
    return { kind: 'command', key, id, title: command.title, binding: registry.binding(id), icon }
  }

  /**
   * The bar as entries. Re-derived on a locale switch (`$LL`), since the
   * registry's titles are read at registration — and so are the
   * dictionary's — through the same store.
   */
  const entries = $derived.by((): Entry[] => {
    void $LL
    const out: Entry[] = []
    ids.forEach((id, i) => {
      const key = `${i}:${id}`
      if (id === SEPARATOR) return void out.push({ kind: 'separator', key })
      if (id === PARAGRAPH_STYLE) {
        const items = STYLE_IDS.map((s) => commandEntry(s, s)).filter((e) => e !== null)
        if (items.length > 0) out.push({ kind: 'styles', key, items })
        else warnOnce(id)
        return
      }
      const entry = commandEntry(id, key)
      if (entry) out.push(entry)
      else warnOnce(id)
    })
    return out
  })

  /** What the collapsed *Format* menu lists: every command, the style group flattened. */
  const flat = $derived(
    entries.flatMap((e) => (e.kind === 'styles' ? [...e.items, { kind: 'separator' as const, key: `${e.key}/end` }] : [e]))
  )

  /** A note, live, not in Reading — the guard the format commands' own `when` applies. */
  const canFormat = $derived.by(() => {
    const { tab } = focusedOf(ctx.panes.layout)
    return tab?.path != null && ctx.panes.modeOf(tab) !== 'reading'
  })

  const t = $derived($LL.web.toolbar)
  const tip = $derived(sideAwayFrom(edge))
  const menuAt = $derived(menuPlacement(tip, 'start'))
  const named = (e: { title: string; binding: string }): string =>
    e.binding ? t.with_binding({ title: e.title, binding: e.binding }) : e.title

  function run(id: string): void {
    void registry.get(id)?.run()
  }

  // ---- one row, scrolling sideways (E6) ----

  let scroller = $state<HTMLElement | null>(null)
  /** Whether there is more of the bar past each end. */
  let more = $state({ start: false, end: false })

  function measureScroll(): void {
    const el = scroller
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    const next = { start: max > 1 && el.scrollLeft > 1, end: max > 1 && el.scrollLeft < max - 1 }
    if (next.start !== more.start || next.end !== more.end) more = next
  }

  /** The fade: a mask (no colour of its own) over the last 24px at an end with more. */
  const fade = $derived(
    more.start || more.end
      ? `linear-gradient(to right, ${more.start ? 'transparent, #000 24px' : '#000, #000'}, ${more.end ? '#000 calc(100% - 24px), transparent' : '#000'})`
      : undefined
  )

  $effect(() => {
    const el = scroller
    // Re-observed when the entries change: a new button widens the content, not the box.
    void entries.length
    if (!el) return
    const observer = new ResizeObserver(measureScroll)
    observer.observe(el)
    for (const child of el.children) observer.observe(child)
    measureScroll()
    // A vertical wheel scrolls the bar sideways — but only when it can move,
    // so a wheel over a bar that fits still scrolls the note under it.
    // Not Svelte's `onwheel`: that listener is passive and cannot take the event.
    const wheel = (e: WheelEvent): void => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return
      const max = el.scrollWidth - el.clientWidth
      if (max <= 1) return
      const to = Math.max(0, Math.min(max, el.scrollLeft + e.deltaY))
      if (to === el.scrollLeft) return
      e.preventDefault()
      el.scrollLeft = to
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      observer.disconnect()
      el.removeEventListener('wheel', wheel)
    }
  })

  /** Keep the editor's focus and selection when a button is pressed with a pointer. */
  const keepEditorFocus = (e: MouseEvent): void => e.preventDefault()
</script>

{#if entries.some((e) => e.kind !== 'separator')}
  <!-- Folds by the floating layer's width (its `@container`), not the window's. -->
  <div
    use:roving
    role="toolbar"
    aria-label={t.format_group()}
    aria-orientation="horizontal"
    data-testid="format-bar"
    data-position={edge}
    class="pointer-events-auto flex h-9 max-w-full shrink-0 items-center justify-center rounded-lg border border-base-300 bg-base-100 px-1 text-xs text-base-content/70 shadow-sm"
  >
    <div data-testid="toolbar-format" class="flex min-w-0 items-center">
      <!-- Wide: every command its own button, on ONE row that never wraps
           (E6): it grows to the pane's width, then scrolls sideways — no
           scrollbar, a fade at whichever end has more, the wheel mapped
           to horizontal. Focus moving to a button scrolls it into view. -->
      <div
        bind:this={scroller}
        data-testid="format-bar-scroll"
        data-more-start={more.start}
        data-more-end={more.end}
        onscroll={measureScroll}
        style:mask-image={fade}
        style:-webkit-mask-image={fade}
        class="flex min-w-0 flex-nowrap items-center gap-0.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] @max-[30rem]:hidden [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
        {#each entries as entry (entry.key)}
          {#if entry.kind === 'separator'}
            <span role="separator" aria-orientation="vertical" class="mx-1 h-4 w-px bg-base-300"></span>
          {:else if entry.kind === 'command'}
            <IconButton
              label={named(entry)}
              icon={entry.icon}
              placement={tip}
              disabled={!canFormat}
              testid="toolbar:{entry.id}"
              onmousedown={keepEditorFocus}
              onclick={() => run(entry.id)}
            />
          {:else}
            {@render styleMenu(entry.items)}
          {/if}
        {/each}
      </div>
      <!-- Narrow: one menu. -->
      <div class="hidden @max-[30rem]:flex">
        <DropdownMenu placement={menuAt} testid="toolbar-format-menu-list">
          {#snippet trigger(attrs)}
            <button
              use:melt={attrs}
              type="button"
              data-testid="toolbar-format-menu"
              onmousedown={keepEditorFocus}
              class="flex items-center gap-1 rounded px-1.5 py-1 text-base-content/70 hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
            >
              <Type size={16} strokeWidth={1.75} aria-hidden="true" />
              {t.format_menu()}
              <ChevronDown size={12} aria-hidden="true" />
            </button>
          {/snippet}
          {#snippet children(attrs)}
            {#each flat as entry, i (entry.key)}
              {#if entry.kind === 'separator'}
                {#if i > 0 && i < flat.length - 1}<MenuSeparator separator={attrs.separator} />{/if}
              {:else if entry.kind === 'command'}
                {@render commandRow(attrs.item, entry)}
              {/if}
            {/each}
          {/snippet}
        </DropdownMenu>
      </div>
    </div>
  </div>
{/if}

{#snippet styleMenu(items: Extract<Entry, { kind: 'command' }>[])}
  <DropdownMenu placement={menuAt} testid="toolbar-paragraph-style-list">
    {#snippet trigger(attrs)}
      <button
        use:melt={attrs}
        type="button"
        data-testid="toolbar:{PARAGRAPH_STYLE}"
        aria-label={t.paragraph_style()}
        title={t.paragraph_style()}
        onmousedown={keepEditorFocus}
        class="flex items-center rounded p-1 text-base-content/70 hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
      >
        <Heading size={16} strokeWidth={1.75} aria-hidden="true" />
        <ChevronDown size={12} aria-hidden="true" />
      </button>
    {/snippet}
    {#snippet children(attrs)}
      {#each items as entry (entry.key)}
        {@render commandRow(attrs.item, entry)}
      {/each}
    {/snippet}
  </DropdownMenu>
{/snippet}

{#snippet commandRow(item: MenuItemAttrs, entry: Extract<Entry, { kind: 'command' }>)}
  {@const Icon = entry.icon}
  <!-- The rows, not the trigger, carry "no note to format": Melt reads a
       trigger's `disabled` once, at mount, so a trigger that started disabled
       (no note yet) would stay `aria-disabled` after one opens. -->
  <MenuItem {item} disabled={!canFormat} testid="toolbar-menu:{entry.id}" onSelect={() => run(entry.id)}>
    <span class="flex items-center gap-2">
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
      <span class="flex-1">{entry.title}</span>
      {#if entry.binding}<kbd class="font-ed-mono text-[10px] text-base-content/70">{entry.binding}</kbd>{/if}
    </span>
  </MenuItem>
{/snippet}
