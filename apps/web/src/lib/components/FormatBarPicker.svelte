<script lang="ts">
  /**
   * Settings › Layout › Formatting bar buttons (E6): which buttons the
   * format bar shows, and in what order. Two rows — the bar's items as they
   * are drawn (separators included), and everything not on it (dashed, with
   * a Separator that is always on offer). Drag to reorder, or between the
   * rows to show or hide; every pill is also a menu button (Move left / Move
   * right / Hide, or Add to the bar), the keyboard's way to do the same.
   *
   * Reads the resolved `bars.format` (the layout file plus this device's
   * overrides) and writes `overrides.bars.format` as a full plain list
   * through the device-override store — config, never a layout file. *Reset
   * to layout file* drops just that override. The list logic is
   * `format-bar-picker.ts`.
   *
   * `bar="selection"` (selection explorations, shape B) is the same picker
   * over the selection handle, `bars.selection`: its own words and testids
   * (`selection-bar-*`), its own candidates (the comment, the agent's
   * selection verbs, the format commands).
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { tick } from 'svelte'
  import type { LucideIcon } from '@lucide/svelte'
  import { melt } from '@melt-ui/svelte'
  import { Undo2 } from '@lucide/svelte'
  import type { CommandRegistry } from '../commands.js'
  import { COMMAND_ICONS, PARAGRAPH_STYLE_ICON } from '../command-icons.js'
  import { TOOLBAR_ITEM_IDS } from '../command-ids.js'
  import {
    CANDIDATES,
    barOverridden,
    hideAt,
    moveBy,
    moveTo,
    pickerRows,
    pillKeys,
    showAt,
    withFormatBar,
    withoutFormatBar,
    type PickerBar,
  } from '../format-bar-picker.js'
  import { SEPARATOR, type LayoutFile, type ShellSpec } from '../layout-spec.js'
  import type { SettingsLayout } from '../settings-host.js'
  import DropdownMenu from '../ui/DropdownMenu.svelte'
  import MenuItem from '../ui/MenuItem.svelte'
  import { OUTLINE_BUTTON } from '../ui/styles.js'

  interface Props {
    layout: SettingsLayout
    registry?: CommandRegistry
    /** Which bar: the format bar (default) or the selection row. */
    bar?: PickerBar
  }

  let { layout, registry, bar = 'format' }: Props = $props()

  const t = $derived(bar === 'format' ? $LL.web.settings.layout.bar : $LL.web.settings.layout.selection_bar)
  /** Every testid and element id is the bar's: `format-bar-*` (E6's, kept) or `selection-bar-*`. */
  const p = $derived(bar === 'format' ? 'format-bar' : 'selection-bar')
  const rows = $derived(pickerRows(layout.ownSpec.bars[bar], CANDIDATES[bar]))
  const shownKeys = $derived(pillKeys(rows.shown))
  const overridden = $derived(barOverridden(layout.overrides, bar))

  /** The one grouped entry (`TOOLBAR_ITEM_IDS`): the paragraph-style menu. */
  const [PARAGRAPH_STYLE] = TOOLBAR_ITEM_IDS

  /** A pill's name: the dictionary's command title, the registry's for anything else. */
  function nameOf(id: string): string {
    if (id === SEPARATOR) return t.separator()
    if (id === PARAGRAPH_STYLE) return $LL.web.toolbar.paragraph_style()
    const words = $LL.web.commands.format as unknown as Record<string, (() => string) | undefined>
    const own = id.startsWith('format.') ? words[id.slice('format.'.length).replace(/-/g, '_')]?.() : undefined
    if (own) return own
    if (id === 'note.comment') return $LL.web.ai.commands.comment()
    return registry?.get(id)?.title ?? id
  }
  const iconOf = (id: string): LucideIcon | null =>
    id === PARAGRAPH_STYLE ? PARAGRAPH_STYLE_ICON : (COMMAND_ICONS[id] ?? null)

  /** What a screen reader hears after a change made from a pill's menu. */
  let announce = $state('')
  let root = $state<HTMLElement | null>(null)

  function write(list: readonly string[]): void {
    const overrides = $state.snapshot(layout.overrides) as LayoutFile
    const file = $state.snapshot(layout.fileSpec) as ShellSpec
    layout.setOverrides(withFormatBar(overrides, file, list, bar))
  }

  function reset(): void {
    layout.setOverrides(withoutFormatBar($state.snapshot(layout.overrides) as LayoutFile, bar))
  }

  /** After a change from the keyboard: focus where the pill went, and say so. */
  async function refocus(selector: string, said: string): Promise<void> {
    announce = said
    await tick()
    root?.querySelector<HTMLElement>(selector)?.focus()
  }

  function move(index: number, delta: -1 | 1): void {
    const key = shownKeys[index]!
    const id = rows.shown[index]!
    const next = moveBy(rows.shown, index, delta)
    write(next)
    const at = id === SEPARATOR ? Math.min(Math.max(index + delta, 0), next.length - 1) : next.indexOf(id)
    const nextKey = id === SEPARATOR ? (pillKeys(next)[at] ?? key) : key
    void refocus(`[data-pill="shown:${CSS.escape(nextKey)}"]`, t.moved({ name: nameOf(id), n: at + 1, total: next.length }))
  }

  function hide(index: number): void {
    const id = rows.shown[index]!
    write(hideAt(rows.shown, index))
    const target = id === SEPARATOR ? SEPARATOR : id
    void refocus(`[data-pill="hidden:${CSS.escape(target)}"]`, t.hidden_now({ name: nameOf(id) }))
  }

  function show(id: string): void {
    const next = showAt(rows.shown, id)
    write(next)
    const selector =
      id === SEPARATOR ? `[data-pill="hidden:${CSS.escape(SEPARATOR)}"]` : `[data-pill="shown:${CSS.escape(id)}"]`
    void refocus(selector, t.shown_now({ name: nameOf(id) }))
  }

  // ---- drag and drop ----

  type Drag = { from: 'shown'; index: number } | { from: 'hidden'; id: string }
  let drag = $state<Drag | null>(null)
  /** Where a drop would land on the bar: before this index (`length` = the end). */
  let dropAt = $state<number | null>(null)
  let overHidden = $state(false)

  function start(e: DragEvent, d: Drag): void {
    drag = d
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      // Some engines start no drag without data.
      e.dataTransfer.setData('text/plain', d.from === 'shown' ? rows.shown[d.index]! : d.id)
    }
  }

  function end(): void {
    drag = null
    dropAt = null
    overHidden = false
  }

  /** Over a pill on the bar: before it, or after it past its middle. */
  function overPill(e: DragEvent, index: number): void {
    if (!drag) return
    e.preventDefault()
    e.stopPropagation()
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    dropAt = e.clientX > box.left + box.width / 2 ? index + 1 : index
    overHidden = false
  }

  function overShownRow(e: DragEvent): void {
    if (!drag) return
    e.preventDefault()
    if (dropAt === null) dropAt = rows.shown.length
    overHidden = false
  }

  function overHiddenRow(e: DragEvent): void {
    if (!drag || drag.from !== 'shown') return
    e.preventDefault()
    overHidden = true
    dropAt = null
  }

  function dropOnShown(e: DragEvent): void {
    if (!drag) return
    e.preventDefault()
    const at = dropAt ?? rows.shown.length
    if (drag.from === 'shown') {
      // Removing the item first shifts every later index by one.
      write(moveTo(rows.shown, drag.index, at > drag.index ? at - 1 : at))
    } else {
      write(showAt(rows.shown, drag.id, at))
    }
    end()
  }

  function dropOnHidden(e: DragEvent): void {
    if (!drag || drag.from !== 'shown') return
    e.preventDefault()
    write(hideAt(rows.shown, drag.index))
    end()
  }

  const rowCls = 'flex min-h-10 flex-wrap items-center gap-1 rounded-lg border border-dashed p-1.5'
  const pillCls =
    'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs focus-visible:outline-2 focus-visible:outline-primary'
</script>

<div bind:this={root} class="mt-4 space-y-2" data-testid="{p}-picker">
  <h3 class="text-[13px] font-semibold text-base-content">{t.title()}</h3>
  <p class="text-xs text-base-content/70">{t.intro()}</p>

  <p class="text-xs text-base-content/70" id="{p}-shown-label">{t.shown()}</p>
  <ul
    aria-labelledby="{p}-shown-label"
    data-testid="{p}-shown"
    class="{rowCls} {drag ? 'border-primary' : 'border-base-300'}"
    ondragover={overShownRow}
    ondragleave={() => (dropAt = null)}
    ondrop={dropOnShown}
  >
    {#each rows.shown as id, index (shownKeys[index])}
      {@const key = shownKeys[index]}
      {@const Icon = iconOf(id)}
      <li
        draggable="true"
        ondragstart={(e) => start(e, { from: 'shown', index })}
        ondragend={end}
        ondragover={(e) => overPill(e, index)}
        class="flex items-center {dropAt === index ? 'border-l-2 border-primary pl-0.5' : ''} {dropAt ===
          rows.shown.length && index === rows.shown.length - 1
          ? 'border-r-2 border-primary pr-0.5'
          : ''}"
      >
        <DropdownMenu placement="bottom-start" testid="{p}-pill-menu:{key}">
          {#snippet trigger(attrs)}
            <button
              use:melt={attrs}
              type="button"
              data-pill="shown:{key}"
              data-testid="{p}-pill:{key}"
              aria-label={t.pill_shown({ name: nameOf(id), n: index + 1, total: rows.shown.length })}
              class="{pillCls} cursor-grab border-base-300 bg-base-100 text-base-content"
            >
              {#if id === SEPARATOR}
                <span aria-hidden="true" class="text-base-content/70">|</span>
              {:else}
                {#if Icon}<Icon size={12} strokeWidth={1.75} aria-hidden="true" />{/if}
                {nameOf(id)}
              {/if}
            </button>
          {/snippet}
          {#snippet children(menu)}
            <MenuItem item={menu.item} disabled={index === 0} testid="{p}-left:{key}" onSelect={() => move(index, -1)}>
              {t.move_left()}
            </MenuItem>
            <MenuItem
              item={menu.item}
              disabled={index === rows.shown.length - 1}
              testid="{p}-right:{key}"
              onSelect={() => move(index, 1)}
            >
              {t.move_right()}
            </MenuItem>
            <MenuItem item={menu.item} testid="{p}-hide:{key}" onSelect={() => hide(index)}>
              {id === SEPARATOR ? t.remove() : t.hide()}
            </MenuItem>
          {/snippet}
        </DropdownMenu>
      </li>
    {:else}
      <li class="px-1 text-xs text-base-content/70">{t.empty_shown()}</li>
    {/each}
  </ul>

  <p class="text-xs text-base-content/70" id="{p}-hidden-label">{t.hidden()}</p>
  <ul
    aria-labelledby="{p}-hidden-label"
    data-testid="{p}-hidden"
    class="{rowCls} {overHidden ? 'border-primary' : 'border-base-300'}"
    ondragover={overHiddenRow}
    ondragleave={() => (overHidden = false)}
    ondrop={dropOnHidden}
  >
    {#each [...rows.hidden, SEPARATOR] as id (id)}
      {@const Icon = iconOf(id)}
      <li draggable="true" ondragstart={(e) => start(e, { from: 'hidden', id })} ondragend={end} class="flex">
        <DropdownMenu placement="bottom-start" testid="{p}-pill-menu:hidden:{id}">
          {#snippet trigger(attrs)}
            <button
              use:melt={attrs}
              type="button"
              data-pill="hidden:{id}"
              data-testid="{p}-pill:hidden:{id}"
              aria-label={t.pill_hidden({ name: nameOf(id) })}
              class="{pillCls} cursor-grab border-dashed border-base-300 bg-base-200 text-base-content/70"
            >
              {#if Icon}<Icon size={12} strokeWidth={1.75} aria-hidden="true" />{/if}
              {id === SEPARATOR ? `| ${nameOf(id)}` : nameOf(id)}
            </button>
          {/snippet}
          {#snippet children(menu)}
            <MenuItem item={menu.item} testid="{p}-show:{id}" onSelect={() => show(id)}>{t.show()}</MenuItem>
          {/snippet}
        </DropdownMenu>
      </li>
    {/each}
  </ul>
  {#if rows.hidden.length === 0}<p class="text-xs text-base-content/70">{t.empty_hidden()}</p>{/if}

  <p class="sr-only" aria-live="polite" data-testid="{p}-announce">{announce}</p>

  <button
    type="button"
    data-testid="{p}-reset"
    disabled={!overridden}
    onclick={reset}
    class="{OUTLINE_BUTTON} inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-base-content disabled:opacity-50"
  >
    <Undo2 size={12} aria-hidden="true" />
    {t.reset()}
  </button>
</div>
