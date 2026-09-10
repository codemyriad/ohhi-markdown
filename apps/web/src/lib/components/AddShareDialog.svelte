<script lang="ts">
  import { z } from 'zod'
  import { looksLikeShareLink } from '../share-link.js'
  import { createForm } from '../ui/form.svelte.js'
  import Description from '../ui/Description.svelte'
  import Dialog from '../ui/Dialog.svelte'
  import Field from '../ui/Field.svelte'
  import FieldErrors from '../ui/FieldErrors.svelte'
  import TextControl from '../ui/TextControl.svelte'

  interface Props {
    /** Existing dirs, offered as destination suggestions. */
    dirs: string[]
    /** Runs the join; resolves when the mount is live. */
    onJoin: (link: string, destPath: string) => Promise<void>
    onClose: () => void
  }

  let { dirs, onJoin, onClose }: Props = $props()

  const schema = z.object({
    link: z
      .string()
      .trim()
      .refine(looksLikeShareLink, 'That doesn’t look like a share link — they start with "editor1:".'),
    dest: z.string().trim().min(1, 'Pick a folder for the shared content to live in.'),
  })
  const form = createForm(schema, { link: '', dest: '' })

  async function join(): Promise<void> {
    if (await form.submit(({ link, dest }) => onJoin(link, dest))) onClose()
  }
</script>

<Dialog
  title="Add a shared folder"
  description="Paste a share link and pick where it lives in this vault. The folder must be new or empty — it fills with the shared content and stays in sync alongside your local notes."
  testid="add-share-dialog"
  {onClose}
>
  <!-- novalidate: the schema is the validator; the browser's own bubbles
       would pre-empt it and never fire submit for an empty required field. -->
  <form
    class="space-y-3"
    novalidate
    onsubmit={(e) => {
      e.preventDefault()
      void join()
    }}
  >
    <Field name="link" errors={form.errorsFor('link')} required>
      <TextControl
        label="Share link"
        multiline
        rows={2}
        mono
        bind:value={form.data.link}
        onblur={() => form.touch('link')}
        placeholder="editor1:…"
        testid="add-share-link"
        class="text-[11px]"
      />
      <FieldErrors />
    </Field>

    <Field name="dest" errors={form.errorsFor('dest')} required>
      <TextControl
        label="Destination folder"
        mono
        bind:value={form.data.dest}
        onblur={() => form.touch('dest')}
        list="add-share-dirs"
        placeholder="e.g. shared/team"
        testid="add-share-dest"
        class="text-xs"
      />
      <datalist id="add-share-dirs">
        {#each dirs as d (d)}<option value={d}></option>{/each}
      </datalist>
      <Description>A new folder, or an existing empty one.</Description>
      <FieldErrors />
    </Field>

    {#if form.formError}
      <p class="text-xs text-error" role="alert" data-testid="add-share-error">{form.formError}</p>
    {/if}

    <div class="flex justify-end gap-2">
      <button
        type="button"
        data-testid="add-share-cancel"
        onclick={onClose}
        class="rounded border border-base-300 px-3 py-1.5 text-xs text-base-content/70 hover:bg-base-200"
      >
        Cancel
      </button>
      <button
        type="submit"
        data-testid="add-share-join"
        disabled={form.busy}
        class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content hover:bg-primary/90 disabled:opacity-50"
      >
        {form.busy ? 'Joining…' : 'Join into this vault'}
      </button>
    </div>
  </form>
</Dialog>
