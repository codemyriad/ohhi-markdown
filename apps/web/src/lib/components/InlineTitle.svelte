<script lang="ts">
  /**
   * The inline title (foundations round 2, P3): the note's name as an
   * editable heading at the top of its body, as Obsidian draws it. Editing it
   * renames the file — through `file-actions.renameNote`, so the checks, the
   * refusal wording and the journaled rename are the tree's own.
   *
   * It lives OUTSIDE CodeMirror: the pane mounts it into the view's scroller,
   * just before the content (`Pane.svelte`), so it scrolls with the note but
   * is never part of the document, the selection or the undo stack — the
   * editor's focus handling and the tab's resume point never see it.
   *
   * A real `<input>` inside an `<h1>` — no `contenteditable` — so it reads as
   * a heading named by the note's title and edits as a text field.
   *   Enter         commit, then into the note's first line
   *   Tab / ↓       the same: the title is the line above line one
   *   Escape        put the name back
   *   blur          commit
   * A refused name (illegal characters, a name already in the folder) is
   * flashed by `renameNote` and the field goes back to the current name.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'

  interface Props {
    /** The note's vault path; the title is its basename without `.md`. */
    path: string
    /** Rename to `name` (no extension). Resolves the new path, or null when refused. */
    onRename: (name: string) => Promise<string | null>
    /** Move the caret into the note's first line. */
    onExit: () => void
  }

  let { path, onRename, onExit }: Props = $props()

  const title = $derived(path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, ''))

  let input = $state<HTMLInputElement>()
  let draft = $state('')
  let editing = $state(false)
  let committing = false
  /** Renamed: this title belongs to a path that no longer exists, and the pane remounts it. */
  let renamed = false

  // The field follows the note's name whenever the person is not typing in it
  // (a rename from the tree, a peer's rename).
  $effect.pre(() => {
    const next = title
    if (!editing) draft = next
  })

  /** True when there is nothing left to do (unchanged, or renamed); false when refused. */
  async function commit(): Promise<boolean> {
    if (committing || renamed) return true
    const name = draft.trim()
    if (!name || name === title) {
      draft = title
      return true
    }
    committing = true
    try {
      const to = await onRename(name)
      if (to === null) {
        draft = title
        input?.select()
        return false
      }
      renamed = to !== path
      return true
    } finally {
      committing = false
    }
  }

  async function leave(): Promise<void> {
    if (await commit()) {
      editing = false
      onExit()
    }
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.isComposing) return
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey) || e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      void leave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      draft = title
      editing = false
      input?.blur()
    }
  }
</script>

<!-- svelte-ignore a11y_missing_content -- the field's value is the heading's
     text: an embedded textbox contributes its value to the accessible name -->
<h1 class="ed-inline-title-h" data-testid="inline-title">
  <input
    bind:this={input}
    bind:value={draft}
    data-testid="inline-title-input"
    aria-label={$LL.web.note.inline_title()}
    spellcheck="false"
    autocomplete="off"
    enterkeyhint="done"
    onfocus={() => (editing = true)}
    onblur={() => {
      void commit().then(() => (editing = false))
    }}
    {onkeydown}
  />
</h1>

<style>
  /* The pane puts the title's host into CM6's scroller (a flex row) just
     before `.cm-content`: wrapping gives it a row of its own above the text. */
  :global(.cm-scroller.ed-titled) {
    flex-wrap: wrap;
  }
  :global(.ed-inline-title) {
    flex: 0 0 100%;
    min-width: 0;
  }
  .ed-inline-title-h {
    /* The same column as the text below: the measure, centred, the line's inset. */
    max-width: var(--ed-measure);
    margin: 0 auto;
    padding: 1.5rem 1rem 0;
    font-family: var(--ed-font-prose);
    font-size: var(--ed-h1-size);
    font-weight: var(--ed-heading-weight);
    line-height: 1.25;
    color: var(--ed-title);
  }
  input {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    font: inherit;
    color: inherit;
    caret-color: var(--ed-caret);
    text-overflow: ellipsis;
    outline: none;
  }
</style>
