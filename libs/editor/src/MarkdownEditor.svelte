<script lang="ts">
  import { untrack } from 'svelte'
  import type { Extension } from '@codemirror/state'
  import type { EngineDoc } from '@ohhi/sync'
  import type { Awareness } from 'y-protocols/awareness'
  import type { ViewMode } from '@ohhi/editor-lang'
  import { createMarkdownEditor, type MarkdownEditorHandle } from './markdown-editor.js'
  import type { CollabUndoManager, CollabUser } from './binding.js'

  interface Props {
    doc: EngineDoc
    awareness?: Awareness | null
    user: CollabUser
    readOnly?: boolean
    /**
     * Live / Source / Reading. Applied by reconfigure, never by rebuilding:
     * a mode toggle keeps the Y.Text binding, the scroll and the undo stack
     * (read-shaping.md B3).
     */
    mode?: ViewMode
    /** Only drives CM6's own dark/light base rules; colours come from CSS. */
    dark?: boolean
    /** Host extensions (wikilinks, completion). Must be a STABLE array. */
    extensions?: Extension[]
    /**
     * Put the caret here and scroll to it (a search result's Enter). A NEW
     * object each time, so the same offset twice still reveals; null does
     * nothing.
     */
    reveal?: { offset: number } | null
    /**
     * The doc's undo manager, owned by the shell so the stack outlives this
     * view (tab-groups B2). Read untracked like `dark`/`extensions`: it
     * belongs to the doc, so it only ever changes when `doc` does.
     */
    undoManager?: CollabUndoManager | null
    /**
     * The view's lifecycle handle. Called with the handle once CM6 is mounted
     * — `restore()` a resume point here — and once more with `null`
     * immediately BEFORE the view is destroyed, at which point the handle you
     * were given at mount is still live: that is where `capture()` runs
     * (tab-groups B2).
     */
    onhandle?: (handle: MarkdownEditorHandle | null) => void
  }

  let {
    doc,
    awareness = null,
    user,
    readOnly = false,
    mode = 'live',
    dark = false,
    extensions = [],
    reveal = null,
    undoManager = null,
    onhandle,
  }: Props = $props()

  let host = $state<HTMLDivElement>()
  let handle = $state.raw<MarkdownEditorHandle | null>(null)

  // CM6 owns everything inside `host`; Svelte never renders in there.
  // Lifecycle depends on doc/awareness/user only — `dark` and `extensions`
  // are read untracked and applied by reconfigure below, so neither a theme
  // flip nor a new extension set rebinds the Y.Text.
  $effect(() => {
    if (!host) return
    const manager = untrack(() => undoManager)
    const report = untrack(() => onhandle)
    const h = createMarkdownEditor(host, {
      doc,
      awareness,
      user,
      readOnly,
      mode: untrack(() => mode),
      dark: untrack(() => dark),
      extensions: untrack(() => extensions),
      ...(manager ? { undoManager: manager } : {}),
    })
    handle = h
    report?.(h)
    return () => {
      // Before destroy(): the shell's `capture()` needs a live view.
      report?.(null)
      h.destroy()
      handle = null
    }
  })

  $effect(() => {
    handle?.setDark(dark)
  })

  $effect(() => {
    handle?.setMode(mode)
  })

  $effect(() => {
    handle?.setExtensions(extensions)
  })

  $effect(() => {
    if (reveal) handle?.reveal(reveal.offset)
  })
</script>

<div bind:this={host} class="h-full min-h-0 overflow-auto bg-ed-surface"></div>
