<script lang="ts">
  /**
   * One editable cell of a collection table (bases-shaping A4): a button
   * showing the value until it is activated, then the one editor its kind
   * takes — a text field with the column's known values as suggestions, a
   * number, a date, a checkbox, a comma list, a link target. Enter or blur
   * commits, Escape cancels; the commit hands ONE value up and the view
   * turns it into the one `FmOp` (collection-cells.ts).
   *
   * A boolean is its checkbox directly: a click is the edit.
   */
  import { tick } from 'svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { PropValue } from '@ohhi/index'
  import { cellDraft, cellText, type CellKind } from '../collection-cells.js'

  interface Props {
    value: PropValue | undefined
    kind: CellKind
    /** The column's header, for the accessible name. */
    column: string
    /** The row's name, for the accessible name. */
    row: string
    /** Suggestions for a text cell: the values this property holds elsewhere. */
    options?: readonly string[]
    testid?: string
    onCommit: (raw: string | boolean) => void
  }

  let { value, kind, column, row, options = [], testid, onCommit }: Props = $props()

  const t = $derived($LL.web.collections)
  const uid = $props.id()
  let editing = $state(false)
  let draft = $state('')
  let input = $state<HTMLInputElement>()
  const text = $derived(cellText(value))
  const checked = $derived(value?.kind === 'boolean' && value.value)

  async function open(): Promise<void> {
    draft = cellDraft(value)
    editing = true
    await tick()
    input?.focus()
    input?.select()
  }

  function commit(): void {
    if (!editing) return
    editing = false
    if (draft !== cellDraft(value)) onCommit(draft)
  }

  function cancel(): void {
    editing = false
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  }

  const inputType = $derived(kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text')
  const field = 'w-full rounded border border-base-300 bg-base-100 px-1.5 py-0.5 text-xs text-base-content focus-visible:outline-2 focus-visible:outline-primary'
</script>

{#if kind === 'boolean'}
  <input
    type="checkbox"
    class="dui-checkbox dui-checkbox-xs"
    {checked}
    aria-label={t.edit_cell_bool({ column, name: row })}
    data-testid={testid}
    onchange={(e) => onCommit((e.currentTarget as HTMLInputElement).checked)}
  />
{:else if editing}
  <input
    bind:this={input}
    bind:value={draft}
    type={inputType}
    step={kind === 'number' ? 'any' : undefined}
    list={kind === 'text' && options.length ? `${uid}-options` : undefined}
    class={field}
    aria-label={t.edit_cell({ column, name: row })}
    data-testid={testid ? `${testid}:input` : undefined}
    onkeydown={onKey}
    onblur={commit}
  />
  {#if kind === 'text' && options.length}
    <datalist id="{uid}-options">
      {#each options as option (option)}
        <option value={option}></option>
      {/each}
    </datalist>
  {/if}
{:else}
  <button
    type="button"
    class="block w-full truncate rounded px-1.5 py-0.5 text-left text-xs hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary {text ? 'text-base-content' : 'text-base-content/70'}"
    aria-label={t.edit_cell({ column, name: row })}
    data-testid={testid}
    onclick={open}
  >
    {text || t.empty_cell()}
  </button>
{/if}
