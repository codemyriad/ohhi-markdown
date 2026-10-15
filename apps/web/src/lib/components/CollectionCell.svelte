<script lang="ts">
  /**
   * One editable cell of a collection table (bases-shaping A4): a button
   * showing the value until it is activated, then the one editor its kind
   * takes — a text field with the column's known values as suggestions, a
   * number, a date, a checkbox, a comma list, a link target. Enter or blur
   * commits, Escape cancels, and focus returns to the cell either way; the
   * commit hands ONE value up and the view turns it into the one `FmOp`
   * (collection-cells.ts). A refused write (`onCommit` false) leaves the
   * cell showing what the note still says.
   *
   * A boolean is its checkbox directly: a click is the edit.
   *
   * `editable` false (Reading, an embed in a read-only view): the value as
   * text, whatever its kind — read-shaping's `editable(false)`; the X1
   * checkbox in the body is the one exception, and it is not this cell.
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
    /** False: the value as text, no editor of any kind. */
    editable?: boolean
    testid?: string
    /** True when the note took the edit; false when it was refused (the cell shows the old value). */
    onCommit: (raw: string | boolean) => boolean
  }

  let { value, kind, column, row, options = [], editable = true, testid, onCommit }: Props = $props()

  const t = $derived($LL.web.collections)
  const uid = $props.id()
  let editing = $state(false)
  let draft = $state('')
  let input = $state<HTMLInputElement>()
  let button = $state<HTMLButtonElement>()
  const text = $derived(cellText(value))
  const checked = $derived(value?.kind === 'boolean' && value.value)

  async function open(): Promise<void> {
    draft = cellDraft(value)
    editing = true
    await tick()
    input?.focus()
    input?.select()
  }

  /** Leave the editor and put focus back on the cell, so a keyboard user keeps their place. */
  async function close(): Promise<void> {
    editing = false
    await tick()
    button?.focus()
  }

  function commit(): void {
    if (!editing) return
    // The field's own text, not a coerced binding: a cleared number field
    // is '' here, never null.
    const next = input?.value ?? draft
    void close()
    if (next !== cellDraft(value)) onCommit(next)
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      void close()
    }
  }

  function onCheck(e: Event): void {
    const box = e.currentTarget as HTMLInputElement
    const ok = onCommit(box.checked)
    // A refused write: the note did not change, so neither does the box.
    if (!ok) box.checked = checked
  }

  /** A date that carries a time is edited as text: a date field would drop the time. */
  const inputType = $derived(kind === 'number' ? 'number' : kind === 'date' && !/[T ]\d/.test(cellDraft(value)) ? 'date' : 'text')
  /**
   * ONE box for the value at rest and in edit — the same height, padding
   * and border width (transparent at rest) — so opening the editor moves
   * nothing around it: not the table's row, not the properties form's
   * next line (QA round 1). A fixed height, because a date or number field
   * draws its own inner chrome and would otherwise grow the row.
   */
  const box = 'box-border block h-6 w-full rounded border px-1.5 py-0 text-xs leading-[1.375rem]'
  const field = `${box} border-base-300 bg-base-100 text-base-content focus-visible:outline-2 focus-visible:outline-primary`
</script>

{#if !editable}
  <span class="{box} truncate border-transparent {text ? 'text-base-content' : 'text-base-content/70'}" data-testid={testid}>
    {text || t.empty_cell()}
  </span>
{:else if kind === 'boolean'}
  <input
    type="checkbox"
    class="dui-checkbox dui-checkbox-xs"
    {checked}
    aria-label={t.edit_cell_bool({ column, name: row })}
    data-testid={testid}
    onchange={onCheck}
  />
{:else if editing}
  <!-- A flex box, so the whitespace between the field and its suggestion
       list is never a line of its own: inside the editor (the properties
       form, an embed) CodeMirror's surface preserves whitespace, and a
       stray line there grew the row the moment a field opened. -->
  <div class="flex">
    <input
      bind:this={input}
      value={draft}
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
  </div>
{:else}
  <button
    bind:this={button}
    type="button"
    class="{box} truncate border-transparent text-left hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary {text ? 'text-base-content' : 'text-base-content/70'}"
    aria-label={t.edit_cell({ column, name: row })}
    data-testid={testid}
    onclick={open}
  >
    {text || t.empty_cell()}
  </button>
{/if}
