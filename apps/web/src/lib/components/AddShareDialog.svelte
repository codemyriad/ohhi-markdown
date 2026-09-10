<script lang="ts">
  import { z } from 'zod'
  import { LL } from '@editor/i18n/i18n-svelte'
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
    /** Prefilled destination ('team/' when opened from the tree on 'team'). */
    initialDest?: string
    onClose: () => void
  }

  let { dirs, onJoin, initialDest = '', onClose }: Props = $props()

  const t = $derived($LL.web.share.add)

  const schema = z.object({
    link: z.string().trim().refine(looksLikeShareLink, $LL.web.share.add.link_invalid()),
    dest: z.string().trim().min(1, $LL.web.share.add.dest_required()),
  })
  // svelte-ignore state_referenced_locally -- seed only; the form owns it after
  const form = createForm(schema, { link: '', dest: initialDest })

  async function join(): Promise<void> {
    if (await form.submit(({ link, dest }) => onJoin(link, dest))) onClose()
  }
</script>

<Dialog title={t.title()} description={t.description()} testid="add-share-dialog" {onClose}>
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
        label={t.link()}
        multiline
        rows={2}
        mono
        bind:value={form.data.link}
        onblur={() => form.touch('link')}
        placeholder={t.link_placeholder()}
        testid="add-share-link"
        class="text-[11px]"
      />
      <FieldErrors />
    </Field>

    <Field name="dest" errors={form.errorsFor('dest')} required>
      <TextControl
        label={t.dest()}
        mono
        bind:value={form.data.dest}
        onblur={() => form.touch('dest')}
        list="add-share-dirs"
        placeholder={t.dest_placeholder()}
        testid="add-share-dest"
        class="text-xs"
      />
      <datalist id="add-share-dirs">
        {#each dirs as d (d)}<option value={d}></option>{/each}
      </datalist>
      <Description>{t.dest_hint()}</Description>
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
        {$LL.common.cancel()}
      </button>
      <button
        type="submit"
        data-testid="add-share-join"
        disabled={form.busy}
        class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content hover:bg-primary/90 disabled:opacity-50"
      >
        {form.busy ? t.joining() : t.join()}
      </button>
    </div>
  </form>
</Dialog>
