<script lang="ts">
  /**
   * "Link this device" (device-link-shaping A1, slice N2) — the NEW device's
   * side, reached from the vault manager because there is no vault open yet.
   *
   * The one rule worth refusing at the field: a FOLDER link is not a device
   * link. Pasting one here would silently open somebody's shared folder as a
   * whole vault, so it is refused with the reason and pointed at the affordance
   * that does want it ("Add a shared folder here…", inside a vault). R5 in the
   * other direction: a device link is the only link that carries the vault.
   *
   * Everything after the paste — the destination folder, the emptiness check,
   * merging the link's grants, the boot — belongs to the host (`onLink`); a
   * refusal comes back as a rejection and is shown here, with the paste kept.
   */
  import { z } from 'zod'
  import { LL } from '@editor/i18n/i18n-svelte'
  import { decodeShareLink, looksLikeShareLink, shareLinkErrorText } from '../share-link.js'
  import { createForm } from '../ui/form.svelte.js'
  import Description from '../ui/Description.svelte'
  import Dialog from '../ui/Dialog.svelte'
  import Field from '../ui/Field.svelte'
  import FieldErrors from '../ui/FieldErrors.svelte'
  import TextControl from '../ui/TextControl.svelte'

  interface Props {
    /** Desktop asks for a folder; the browser makes a fresh private vault. */
    isTauri: boolean
    /** Prefilled paste (the `?share=` deep link). */
    initialLink?: string
    /** Runs the link end to end; rejects with the reason, which is shown here. */
    onLink: (link: string) => Promise<void>
    onClose: () => void
  }

  let { isTauri, initialLink = '', onLink, onClose }: Props = $props()

  const t = $derived($LL.web.device_link)

  /** A link we cannot decode is the FIRST rule's business, not this one's. */
  function isDeviceLink(link: string): boolean {
    try {
      return decodeShareLink(link).kind === 'device'
    } catch {
      return true
    }
  }

  // svelte-ignore state_referenced_locally -- seeded once; the form owns it after
  const schema = z.object({
    link: z
      .string()
      .trim()
      .refine(looksLikeShareLink, $LL.web.device_link.join_link_invalid())
      .refine(isDeviceLink, $LL.web.device_link.join_not_device()),
  })
  // svelte-ignore state_referenced_locally -- seed only
  const form = createForm(schema, { link: initialLink })

  async function link(): Promise<void> {
    // A refusal from the host may be a share-link code (a damaged bundle, a
    // grant with no token); the rendering site turns it into a sentence.
    const run = async (value: string): Promise<void> => {
      try {
        await onLink(value)
      } catch (err) {
        throw new Error(shareLinkErrorText(err))
      }
    }
    if (await form.submit(({ link: value }) => run(value))) onClose()
  }
</script>

<Dialog title={t.join_title()} description={t.join_description()} testid="link-device-dialog" {onClose}>
  <!-- novalidate: the schema is the validator; the browser's own bubbles
       would pre-empt it and never fire submit for an empty required field. -->
  <form
    class="space-y-3"
    novalidate
    onsubmit={(e) => {
      e.preventDefault()
      void link()
    }}
  >
    <Field name="link" errors={form.errorsFor('link')} required>
      <TextControl
        label={t.join_link()}
        multiline
        rows={2}
        mono
        bind:value={form.data.link}
        onblur={() => form.touch('link')}
        placeholder={t.join_link_placeholder()}
        testid="link-device-input"
        class="text-[11px]"
      />
      <Description>{isTauri ? t.join_hint_desktop() : t.join_hint_browser()}</Description>
      <FieldErrors />
    </Field>

    <p class="text-xs text-base-content/70" data-testid="link-device-attachments">{t.attachments()}</p>

    {#if form.formError}
      <p class="text-xs text-error" role="alert" data-testid="link-device-error">{form.formError}</p>
    {/if}

    <div class="flex justify-end gap-2">
      <button
        type="button"
        data-testid="link-device-cancel"
        onclick={onClose}
        class="rounded border border-base-300 px-3 py-1.5 text-xs text-base-content/70 hover:bg-base-200"
      >
        {$LL.common.cancel()}
      </button>
      <button
        type="submit"
        data-testid="link-device-submit"
        disabled={form.busy}
        class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content hover:bg-primary/90 disabled:opacity-50"
      >
        {form.busy ? t.join_working() : t.join_submit()}
      </button>
    </div>
  </form>
</Dialog>
