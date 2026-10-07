<script lang="ts">
  /**
   * "Add link…" for a mount this device holds no token for (device-link N1,
   * spike S10 Q2, `status:'needs-token'`).
   *
   * A SIBLING of `AddSharedFolderDialog`, not a mode of it: joining asks for a link
   * AND a destination and creates a mount; this one has a mount already — the
   * folder, its files and its room are all here — and supplies the one thing
   * missing. Pasting activates it in place: no re-seed, no re-download, no
   * file on disk touched, so the copy has to say something quite different
   * from "join this into your vault".
   *
   * The link is validated three times on purpose: it must look like a share
   * link, it must not be a DEVICE link (a key to a whole vault, R5 — the
   * workspace refuses it too, but a refusal at the field is the one a person
   * sees), and — when the caller knows the mount's room — it must be a link
   * for THIS folder. Refusing at the field with a reason beats a round-trip
   * that comes back as a toast.
   */
  import { z } from 'zod'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { decodeShareLink, looksLikeShareLink, shareLinkErrorText } from '../share-link.js'
  import { createForm } from '../ui/form.svelte.js'
  import Description from '../ui/Description.svelte'
  import Dialog from '../ui/Dialog.svelte'
  import Field from '../ui/Field.svelte'
  import FieldErrors from '../ui/FieldErrors.svelte'
  import TextControl from '../ui/TextControl.svelte'

  interface Props {
    /** The mount root the link is for. */
    path: string
    /** The mount's room, when known: a link for another room is refused here. */
    room?: string
    /** Stores the token and activates the mount in place; rejects with the reason. */
    onAdd: (link: string) => Promise<void>
    onClose: () => void
  }

  let { path, room = '', onAdd, onClose }: Props = $props()

  const t = $derived($LL.web.mounts.dialog)

  /** A link we cannot decode is the FIRST rule's business, not these ones'. */
  function decoded(link: string): ReturnType<typeof decodeShareLink> | null {
    try {
      return decodeShareLink(link)
    } catch {
      return null
    }
  }

  /** R5: a device link is a key to a whole vault, not a folder's link. */
  function isNotDeviceLink(link: string): boolean {
    return decoded(link)?.kind !== 'device'
  }

  function isForThisRoom(link: string): boolean {
    if (!room) return true
    const target = decoded(link)
    return target === null || target.room === room
  }

  // svelte-ignore state_referenced_locally -- one dialog per mount root: the
  // schema (and its refusal text) is built once, for that root
  const schema = z.object({
    link: z
      .string()
      .trim()
      .refine(looksLikeShareLink, $LL.web.mounts.dialog.link_invalid())
      .refine(isNotDeviceLink, $LL.web.mounts.dialog.device_link_refused())
      .refine(isForThisRoom, $LL.web.mounts.dialog.wrong_room({ path })),
  })
  const form = createForm(schema, { link: '' })

  async function add(): Promise<void> {
    // The codec throws codes, not sentences: this is the rendering site, so
    // this is where a code becomes the line the user reads.
    const run = async (link: string): Promise<void> => {
      try {
        await onAdd(link)
      } catch (err) {
        throw new Error(shareLinkErrorText(err))
      }
    }
    if (await form.submit(({ link }) => run(link))) onClose()
  }
</script>

<Dialog title={t.title({ path })} description={t.description()} testid="add-link-dialog" {onClose}>
  <!-- novalidate: the schema is the validator; the browser's own bubbles
       would pre-empt it and never fire submit for an empty required field. -->
  <form
    class="space-y-3"
    novalidate
    onsubmit={(e) => {
      e.preventDefault()
      void add()
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
        testid="add-link-input"
        class="text-[11px]"
      />
      <Description>{$LL.web.mounts.link_needed_title()}</Description>
      <FieldErrors />
    </Field>

    {#if form.formError}
      <p class="text-xs text-error" role="alert" data-testid="add-link-error">{form.formError}</p>
    {/if}

    <div class="flex justify-end gap-2">
      <button
        type="button"
        data-testid="add-link-cancel"
        onclick={onClose}
        class="rounded border border-base-300 px-3 py-1.5 text-xs text-base-content/70 hover:bg-base-200"
      >
        {$LL.common.cancel()}
      </button>
      <button
        type="submit"
        data-testid="add-link-submit"
        disabled={form.busy}
        class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content hover:bg-primary/90 disabled:opacity-50"
      >
        {form.busy ? t.adding() : t.add()}
      </button>
    </div>
  </form>
</Dialog>
