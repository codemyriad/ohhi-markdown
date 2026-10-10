<script lang="ts" module>
  /** The id of option `i` in the listbox `id` — what the caller's `aria-activedescendant` names. */
  export function optionId(id: string, i: number): string {
    return `${id}-opt-${i}`
  }
</script>

<script lang="ts" generics="T">
  /**
   * A listbox the CALLER drives: a completion menu under a text field that
   * keeps the focus (the composer's `@` / `/` menus). The field owns the
   * keys (arrows, Enter/Tab, Escape) and points at the active option with
   * `aria-activedescendant={optionId(id, active)}`; this draws the list —
   * `role=listbox` / `option`, `aria-selected` on the active one — and takes
   * the pointer's pick. A press never steals the field's focus. Tokens only.
   */
  import type { Snippet } from 'svelte'

  interface Props {
    /** The listbox's id: the field's `aria-controls`. */
    id: string
    options: readonly T[]
    /** The active option's index (the caller moves it). */
    active: number
    label: string
    /** Each option's content. */
    option: Snippet<[T, boolean]>
    /** A stable key per option. */
    key: (item: T) => string
    /** What the list says when it has no options. */
    empty: string
    onPick: (item: T, index: number) => void
    testid?: string
    /** Extra attributes per option (`data-kind`, a test id). */
    optionAttrs?: (item: T) => Record<string, string>
  }

  let { id, options, active, label, option, key, empty, onPick, testid, optionAttrs }: Props = $props()
</script>

<ul
  {id}
  role="listbox"
  aria-label={label}
  data-testid={testid}
  class="m-0 max-h-56 list-none overflow-y-auto rounded-lg border border-base-300 bg-base-100 p-1 shadow-lg"
>
  {#each options as item, i (key(item))}
    <!-- svelte-ignore a11y_click_events_have_key_events -- the field drives
         this listbox's keys through aria-activedescendant; the click is the
         pointer's path -->
    <li
      id={optionId(id, i)}
      role="option"
      aria-selected={i === active}
      {...optionAttrs?.(item) ?? {}}
      class="flex cursor-pointer items-baseline gap-2 rounded px-2 py-1 text-xs {i === active
        ? 'bg-base-200 text-base-content'
        : 'text-base-content/80'}"
      onmousedown={(e) => e.preventDefault()}
      onclick={() => onPick(item, i)}
    >
      {@render option(item, i === active)}
    </li>
  {:else}
    <li role="option" aria-selected="false" aria-disabled="true" class="px-2 py-1 text-xs text-base-content/70">{empty}</li>
  {/each}
</ul>
