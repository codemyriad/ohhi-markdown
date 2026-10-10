<script lang="ts">
  /**
   * The properties form at the top of a row-note (bases-shaping A7, Fork
   * 3-B): one row per flat-subset entry — the key, and the SAME typed editor
   * the collection table uses for a value of that kind (`CollectionCell`).
   * The pane mounts it INTO a CodeMirror block widget over the frontmatter
   * lines (`PropertiesFormWidget`), so it sits where the YAML is and leaves
   * the moment the caret enters the block: the active-region rule shows the
   * text, and every byte stays reachable (read-shaping R4.1.1).
   *
   * An edit is `patchFrontmatter` over the document's text RIGHT NOW — one
   * value's bytes, nothing re-emitted (golden rule 2) — handed back to the
   * widget, which dispatches it as one editor transaction: the path typing
   * takes, so it undoes, syncs and diffs like a keystroke. A key is a button
   * into the YAML at its line; *Edit as YAML* at the end is the keyboard's
   * door when no key is the one wanted; the gutter at the left is the same
   * door for the mouse.
   */
  import type { PropertiesEditor } from '@ohhi/editor-lang'
  import { parseFrontmatter, patchFrontmatter } from '@ohhi/frontmatter'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { typeProperty, type PropValue } from '@ohhi/index'
  import { displayName, kindOf, opFor, type CellKind } from '../collection-cells.js'
  import { getViewShell } from '../views.js'
  import type { Workspace } from '../workspace.svelte.js'
  import CollectionCell from './CollectionCell.svelte'

  interface Props {
    workspace: Workspace
    /** The note's path — its name is the rows' accessible name. */
    path: string
    /** The frontmatter block's own text, `---` to `---`. */
    text: string
    /** Live: keys are doors into the YAML. Reading has no caret to hand back. */
    editable: boolean
    editor: PropertiesEditor
  }

  let { workspace, path, text, editable, editor }: Props = $props()

  const shell = getViewShell()
  const t = $derived($LL.web.collections)
  const name = $derived(displayName(path))

  interface FormRow {
    key: string
    value: PropValue
    kind: CellKind
    /** 0-based document line of the entry — where a click on the key lands. */
    line: number
  }
  const rows = $derived.by<FormRow[]>(() =>
    parseFrontmatter(text).entries.map((e) => {
      const value = typeProperty(e.value, e.quoted)
      return { key: e.key, value, kind: kindOf(value) ?? 'text', line: e.lines[0] }
    })
  )

  /**
   * A text row's suggestions: the values the vault holds for that key, from
   * the index — what the table offers a column. Fetched once per key the
   * form shows, never per keystroke.
   */
  let options = $state.raw<Map<string, string[]>>(new Map())
  $effect(() => {
    const keys = rows.filter((r) => r.kind === 'text').map((r) => r.key)
    if (!shell || keys.length === 0) return
    let live = true
    const index = shell.index()
    void Promise.all(keys.map((key) => index.propertyValues(key, { limit: 50 }))).then((pages) => {
      if (!live) return
      options = new Map(keys.map((key, i) => [key, pages[i]!.items.map((v) => v.value)]))
    })
    return () => {
      live = false
    }
  })

  /** One value's edit → one patch over the text as it is now → one transaction. True when the editor took it. */
  function commit(row: FormRow, raw: string | boolean): boolean {
    const result = patchFrontmatter(editor.text(), opFor(row.key, row.kind, raw))
    if (!result.ok) {
      const reasons = t.reason as unknown as Record<string, () => string>
      const reason = (reasons[result.reason] ?? reasons.unsupported)()
      workspace.flash({ level: 'warn', text: t.not_patched({ name, reason }), path })
      return false
    }
    return editor.apply(result.changes)
  }
</script>

<div class="ed-properties" role="group" aria-label={t.properties_label({ name })} data-testid="properties-form">
  {#if editable}
    <!-- The mouse's door into the YAML; the keys and the button below are the keyboard's. -->
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <div class="ed-properties-gutter" aria-hidden="true" data-testid="properties-gutter" onclick={() => editor.enter(0)}></div>
  {/if}
  <dl class="ed-properties-rows">
    {#each rows as row (row.key)}
      <div class="ed-properties-row">
        <dt class="ed-properties-key">
          {#if editable}
            <button type="button" aria-label={t.property_key({ key: row.key })} data-testid="property-key:{row.key}" onclick={() => editor.enter(row.line)}>
              {row.key}
            </button>
          {:else}
            <span data-testid="property-key:{row.key}">{row.key}</span>
          {/if}
        </dt>
        <dd class="ed-properties-value">
          <CollectionCell
            value={row.value}
            kind={row.kind}
            column={row.key}
            row={name}
            options={options.get(row.key) ?? []}
            testid="property:{row.key}"
            onCommit={(raw) => commit(row, raw)}
          />
        </dd>
      </div>
    {/each}
  </dl>
  {#if editable}
    <button type="button" class="ed-properties-yaml" data-testid="properties-yaml" onclick={() => editor.enter(0)}>{t.open_yaml()}</button>
  {/if}
</div>

<style>
  /* Inside the editor's surface: the strip's fencing comes from the widget's
     class in libs/editor/theme.ts; this is the form's own layout, in tokens. */
  .ed-properties {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.15em;
    padding: 0.4em 1rem 0.4em 1.25rem;
    color: var(--ed-ink);
  }
  .ed-properties-gutter {
    position: absolute;
    inset: 0 auto 0 0;
    width: 1rem;
    cursor: text;
  }
  .ed-properties-rows {
    display: flex;
    flex-direction: column;
    gap: 0.15em;
    margin: 0;
  }
  .ed-properties-row {
    display: grid;
    grid-template-columns: minmax(6rem, 10rem) minmax(0, 1fr);
    align-items: center;
    gap: 0.5em;
  }
  .ed-properties-key {
    margin: 0;
    min-width: 0;
    color: var(--ed-ink-muted);
  }
  .ed-properties-key button,
  .ed-properties-key span {
    display: block;
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0.15em 0.4em;
    border: 0;
    border-radius: 0.25em;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
  }
  .ed-properties-key button {
    cursor: text;
  }
  .ed-properties-key button:hover {
    color: var(--ed-ink);
    background: var(--ed-active-line);
  }
  .ed-properties-key button:focus-visible,
  .ed-properties-yaml:focus-visible {
    outline: 2px solid var(--ed-caret);
    outline-offset: 1px;
  }
  .ed-properties-value {
    margin: 0;
    min-width: 0;
  }
  .ed-properties-yaml {
    align-self: flex-start;
    margin-top: 0.15em;
    padding: 0.1em 0.4em;
    border: 0;
    border-radius: 0.25em;
    background: transparent;
    color: var(--ed-ink-muted);
    font: inherit;
    font-size: 0.9em;
    cursor: text;
  }
  .ed-properties-yaml:hover {
    color: var(--ed-ink);
    background: var(--ed-active-line);
  }
</style>
