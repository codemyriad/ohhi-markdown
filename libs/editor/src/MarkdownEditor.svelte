<script lang="ts">
  import { untrack } from 'svelte'
  import type { Extension } from '@codemirror/state'
  import type { EngineDoc } from '@editor/sync'
  import type { Awareness } from 'y-protocols/awareness'
  import { createMarkdownEditor, type MarkdownEditorHandle } from './markdown-editor.js'
  import type { CollabUser } from './binding.js'

  interface Props {
    doc: EngineDoc
    awareness?: Awareness | null
    user: CollabUser
    readOnly?: boolean
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
  }

  let {
    doc,
    awareness = null,
    user,
    readOnly = false,
    dark = false,
    extensions = [],
    reveal = null,
  }: Props = $props()

  let host = $state<HTMLDivElement>()
  let handle = $state.raw<MarkdownEditorHandle | null>(null)

  // CM6 owns everything inside `host`; Svelte never renders in there.
  // Lifecycle depends on doc/awareness/user only — `dark` and `extensions`
  // are read untracked and applied by reconfigure below, so neither a theme
  // flip nor a new extension set rebinds the Y.Text.
  $effect(() => {
    if (!host) return
    const h = createMarkdownEditor(host, {
      doc,
      awareness,
      user,
      readOnly,
      dark: untrack(() => dark),
      extensions: untrack(() => extensions),
    })
    handle = h
    return () => {
      h.destroy()
      handle = null
    }
  })

  $effect(() => {
    handle?.setDark(dark)
  })

  $effect(() => {
    handle?.setExtensions(extensions)
  })

  $effect(() => {
    if (reveal) handle?.reveal(reveal.offset)
  })
</script>

<div bind:this={host} class="h-full min-h-0 overflow-auto bg-ed-surface"></div>
