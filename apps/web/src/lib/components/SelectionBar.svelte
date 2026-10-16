<script lang="ts">
  /**
   * The selection handle (selection explorations, shape B as Chris chose it,
   * 2026-10-15): the layout's `bars.selection` — by default *Comment | Ask* —
   * drawn on the small pill `selectionBar` (`@ohhi/editor`) hangs at the end
   * of a settled selection. The editor decides when it shows and where; this
   * draws the items. Formatting stays on the format bar.
   *
   * Every item is a registry command id, so the handle, a palette row and a
   * key are one command (golden rule 7); an item that cannot run now is
   * left out — *Ask* (`ai.ask-selection`) until a provider exists
   * (`selection-bar-items.ts`). One `role=toolbar`, roving focus (Alt+F10
   * from the text reaches it, Escape goes back); a thin divider between
   * items. The two default verbs carry short words; anything else a layout
   * adds is an icon with its command's title.
   *
   * A pointer press keeps the editor's selection (mousedown never takes
   * focus); a keyboard press gives the text the keyboard back first, so the
   * command acts on the selection it was about.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { MarkdownEditorHandle, SelectionBarForm } from '@ohhi/editor'
  import { melt } from '@melt-ui/svelte'
  import { COMMAND_ICONS } from '../command-icons.js'
  import { commandHint } from '../command-hint.js'
  import type { CommandRegistry } from '../commands.js'
  import { selectionItems } from '../selection-bar-items.js'
  import IconButton from '../ui/IconButton.svelte'
  import { roving } from '../ui/roving.js'
  import Tooltip from '../ui/Tooltip.svelte'

  type EditorView = MarkdownEditorHandle['view']

  interface Props {
    /** The layout's `bars.selection`. */
    ids: readonly string[]
    registry: CommandRegistry
    /** The pointer that made the selection: a finger gets thumb-sized buttons. */
    form: SelectionBarForm
    /** The editor the handle hangs in: a keyboard press hands it the keyboard back before running. */
    view: EditorView
  }

  let { ids, registry, form, view }: Props = $props()

  const t = $derived($LL.web.toolbar)

  function available(id: string): boolean {
    const command = registry.get(id)
    return !!command && !!COMMAND_ICONS[id] && (!command.when || command.when())
  }

  /** Re-derived on a locale switch and when a provider comes or goes (`when` reads it reactively). */
  const items = $derived.by(() => {
    void $LL
    return selectionItems(ids, available)
  })

  /** The two default verbs' words on the handle; the registry's title names anything else. */
  const SHORT: Readonly<Record<string, () => string>> = {
    'note.comment': () => $LL.web.toolbar.selection_comment(),
    'ai.ask-selection': () => $LL.web.toolbar.selection_ask(),
  }

  /** The tooltip: the command's title and its key as bound now ("Comment on selection · Ctrl+Shift+M"). */
  const hintOf = (id: string): string => commandHint(registry.get(id)?.title ?? id, registry.binding(id))

  function run(id: string): void {
    // The text gets the keyboard back first: the command means its selection.
    if (!view.hasFocus) view.focus()
    void registry.get(id)?.run()
  }

  /** A pointer press keeps the editor's focus and selection. */
  const keep = (e: MouseEvent): void => e.preventDefault()

  const wordCls = $derived(
    `inline-flex items-center gap-1 rounded-full font-medium text-base-content hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary ${form === 'coarse' ? 'min-h-9 px-3 text-sm' : 'px-2 py-0.5 text-xs'}`
  )
</script>

{#if items.length > 0}
  <div
    use:roving
    role="toolbar"
    aria-label={t.selection_group()}
    aria-orientation="horizontal"
    data-testid="selection-handle-items"
    class="flex items-center"
  >
    {#each items as id, i (id)}
      {#if i > 0}<span role="separator" aria-orientation="vertical" class="mx-0.5 h-3.5 w-px bg-base-300"></span>{/if}
      {@const short = SHORT[id]}
      {#if short}
        <Tooltip text={hintOf(id)} placement="bottom">
          {#snippet children(trigger)}
            <button
              use:melt={trigger}
              type="button"
              class={wordCls}
              data-testid="selection-handle:{id}"
              onmousedown={keep}
              onclick={() => run(id)}
            >
              {short()}
            </button>
          {/snippet}
        </Tooltip>
      {:else}
        <IconButton
          label={registry.get(id)?.title ?? id}
          hint={hintOf(id)}
          icon={COMMAND_ICONS[id]!}
          size={form === 'coarse' ? 'md' : 'sm'}
          placement="bottom"
          testid="selection-handle:{id}"
          class="rounded-full"
          onmousedown={keep}
          onclick={() => run(id)}
        />
      {/if}
    {/each}
  </div>
{/if}
