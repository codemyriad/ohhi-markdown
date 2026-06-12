<script lang="ts">
  import type { EngineDoc } from '@editor/sync'
  import type { Awareness } from 'y-protocols/awareness'
  import { createMarkdownEditor } from './markdown-editor.js'
  import type { CollabUser } from './binding.js'

  interface Props {
    doc: EngineDoc
    awareness?: Awareness | null
    user: CollabUser
    readOnly?: boolean
  }

  let { doc, awareness = null, user, readOnly = false }: Props = $props()

  let host = $state<HTMLDivElement>()

  // CM6 owns everything inside `host`; Svelte never renders in there.
  // Recreate-on-prop-change is deliberate in V1: a new `doc` means a new
  // Y.Text binding, so a fresh view is the correct (and simplest) move.
  // Compartment-based reconfigure arrives with the live-preview slice.
  $effect(() => {
    if (!host) return
    const editor = createMarkdownEditor(host, { doc, awareness, user, readOnly })
    return () => editor.destroy()
  })
</script>

<div bind:this={host} class="h-full min-h-0 overflow-auto"></div>
