<script lang="ts">
  /**
   * *Add a shared folder* (sharing-shaping E4, R3): the one dialog for
   * receiving a folder share. Paste the link, then CHOOSE where it goes —
   * inside the open vault at a folder (beside your notes, searchable with
   * them) or as a vault of its own. That choice used to be made for you by
   * which screen you happened to be on: the tree joined into the vault, the
   * manager's Join card opened a new vault.
   *
   * A DEVICE link is refused at the field when it would land inside a vault,
   * with the reason (device-link R5): it is a full-access key to a whole
   * vault, and mounting a vault as a folder of another is not a thing this
   * product does. As its own vault, the manager's join already routes a
   * device link to *Link this device*.
   *
   * "As its own vault" says what happens next on this platform (first-run
   * F1): on the desktop an OS folder picker opens with no sentence of its
   * own, so the dialog explains it before it does.
   *
   * Under a valid paste (first-run C3) the link says what it is — its label,
   * its sender as "the name they typed" (never a verified account, R5), its
   * relay's host — and the relay's health check answers whether it is
   * reachable from here ("reachable" = the check answered, never "the link is
   * valid"). The field takes every spelling the codec reads: the bare
   * `editor1:…`, the `…/join#editor1:…` URL and the old `?share=` URL.
   *
   * "Your name" (Fork 5-A) is asked here, prefilled from the saved name, and
   * saved when the join starts.
   */
  import { z } from 'zod'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { relayHost } from '@ohhi/workspace'
  import { loadUser, saveUser, TEAM_NETWORK_NOTE } from '../config.js'
  import { checkRelay, defaultProbe, teamRelayHost, type Probe, type RelayCheck } from '../relay-check.js'
  import { decodeShareLink, looksLikeShareLink, shareLinkErrorText } from '../share-link.js'
  import { createForm } from '../ui/form.svelte.js'
  import Description from '../ui/Description.svelte'
  import Dialog from '../ui/Dialog.svelte'
  import Field from '../ui/Field.svelte'
  import FieldErrors from '../ui/FieldErrors.svelte'
  import TextControl from '../ui/TextControl.svelte'
  import { HEADING } from '../ui/styles.js'

  type Where = 'vault' | 'own'

  interface Props {
    /** The open vault's name; null when none is open (only "as its own vault" then). */
    vaultName: string | null
    /** Existing dirs of the open vault, offered as destination suggestions. */
    dirs?: string[]
    /** Prefilled destination ('team/' when opened from the tree on 'team'). */
    initialDest?: string
    /** Prefilled link (a `?share=` URL arriving at the manager). */
    initialLink?: string
    /** The choice selected at open; defaults to inside the vault when one is open. */
    initialWhere?: Where
    /** Join into the open vault; resolves when the mount is live. Null = no vault open. */
    onJoinIntoVault: ((link: string, destPath: string) => Promise<void>) | null
    /**
     * Open the share as its own vault (the manager's join). A rejection's
     * message is shown in the dialog, which stays open with the paste;
     * resolving `false` keeps it open silently (the desktop folder picker was
     * cancelled — nothing happened, and the paste must not be lost).
     * `name` is the "Your name" field's value, already saved (`saveUser`).
     */
    onJoinAsVault: (link: string, name: string) => void | boolean | Promise<void | boolean>
    onClose: () => void
    /** The desktop app (an OS folder picker follows "as its own vault") or the browser. */
    isTauri: boolean
    /** "Your name" at open; defaults to the saved display name. */
    initialName?: string
    /** The relay health check; tests hand in a fake. */
    probe?: Probe
    /** The build's relay host (the team's), or null in a build without one. */
    teamHost?: string | null
    /** The build's sentence about reaching that relay ('' = none). */
    networkNote?: string
  }

  let {
    vaultName,
    dirs = [],
    initialDest = '',
    initialLink = '',
    initialWhere,
    onJoinIntoVault,
    onJoinAsVault,
    onClose,
    isTauri,
    initialName = loadUser() ?? '',
    probe = defaultProbe,
    teamHost = teamRelayHost(),
    networkNote = TEAM_NETWORK_NOTE,
  }: Props = $props()

  const t = $derived($LL.web.share.add)
  const canJoinInto = $derived(vaultName !== null && onJoinIntoVault !== null)

  /** A link we cannot decode is the FIRST rule's business, not this one's. */
  function isDeviceLink(link: string): boolean {
    try {
      return decodeShareLink(link).kind === 'device'
    } catch {
      return false
    }
  }

  const schema = z
    .object({
      link: z.string().trim().refine(looksLikeShareLink, $LL.web.share.add.link_invalid()),
      where: z.enum(['vault', 'own']),
      dest: z.string().trim(),
      name: z.string().trim(),
    })
    .superRefine((v, ctx) => {
      if (v.where !== 'vault') return
      if (isDeviceLink(v.link)) {
        ctx.addIssue({ code: 'custom', path: ['link'], message: $LL.web.mounts.dialog.device_link_refused() })
      }
      if (!v.dest) {
        ctx.addIssue({ code: 'custom', path: ['dest'], message: $LL.web.share.add.dest_required() })
      }
    })

  // svelte-ignore state_referenced_locally -- seed only; the form owns it after
  const seedWhere: Where = initialWhere ?? (vaultName !== null && onJoinIntoVault !== null ? 'vault' : 'own')
  // svelte-ignore state_referenced_locally -- seed only; the form owns it after
  const form = createForm(schema, { link: initialLink, where: seedWhere, dest: initialDest, name: initialName })

  /** The pasted link, once it decodes. */
  const decoded = $derived.by(() => {
    try {
      return decodeShareLink(form.data.link.trim())
    } catch {
      return null
    }
  })
  const fromHost = $derived(decoded ? (relayHost(decoded.relay) ?? decoded.relay) : null)

  // The relay's health check, run whenever a link that decodes names a relay;
  // a new paste or closing the dialog cancels the one in flight.
  let check = $state<RelayCheck>('pending')
  $effect(() => {
    const relay = decoded?.relay
    if (!relay) return
    check = 'pending'
    return checkRelay(relay, probe, (c) => (check = c))
  })

  /** What the link says about itself: label, sender ("the name they typed"), host. */
  const linkLine = $derived.by(() => {
    if (!decoded || fromHost === null) return null
    const host = fromHost
    if (decoded.kind === 'device') return t.from_device({ host })
    const { label, from } = decoded
    if (label && from) return t.from_label_sender({ label, from, host })
    if (label) return t.from_label({ label, host })
    if (from) return t.from_sender({ from, host })
    return t.from_host({ host })
  })
  const probeLine = $derived.by(() => {
    if (check === 'pending') return t.probe_checking()
    if (check === 'ok') return t.probe_ok()
    // Reached: the network note would be the wrong advice.
    if (check === 'unhealthy') return t.probe_unhealthy()
    const note = teamHost !== null && fromHost === teamHost ? networkNote : ''
    return note ? t.probe_down_note({ note }) : t.probe_down()
  })

  async function join(): Promise<void> {
    let keepOpen = false
    const ok = await form.submit(async ({ link, where, dest, name }) => {
      // Saved when the join starts (Fork 5-A); a blank name keeps the saved one.
      saveUser(name)
      if (where === 'own') {
        const joined = onJoinAsVault(link, name)
        // The manager's join saves the name IT was handed, synchronously, as
        // it starts; this field is the one the person just answered, so it
        // is saved again, last.
        saveUser(name)
        if ((await joined) === false) keepOpen = true
        return
      }
      // The rendering site is where a codec error code becomes a sentence.
      try {
        await onJoinIntoVault?.(link, dest)
      } catch (err) {
        throw new Error(shareLinkErrorText(err))
      }
    })
    if (ok && !keepOpen) onClose()
  }

  const radio = 'flex cursor-pointer items-start gap-2 rounded border border-base-300 p-2 hover:bg-base-200'
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
      {#if linkLine}
        <Description>
          <span data-testid="add-share-about">{linkLine}</span>
          · <span role="status" data-testid="add-share-probe" data-check={check}>{probeLine}</span>
        </Description>
      {/if}
      <FieldErrors />
    </Field>

    <fieldset class="space-y-1.5">
      <legend class="mb-1 {HEADING}">{t.where()}</legend>
      <label class="{radio} {canJoinInto ? '' : 'cursor-not-allowed'}">
        <input
          type="radio"
          name="add-share-where"
          value="vault"
          bind:group={form.data.where}
          disabled={!canJoinInto}
          data-testid="add-share-where-vault"
          class="mt-0.5"
        />
        <span class="min-w-0">
          <span class="block text-sm">{vaultName !== null ? t.into_vault({ vault: vaultName }) : t.into_a_vault()}</span>
          <span class="block text-xs text-base-content/70">
            {canJoinInto ? t.into_vault_hint() : t.into_vault_unavailable()}
          </span>
        </span>
      </label>
      <label class={radio}>
        <input
          type="radio"
          name="add-share-where"
          value="own"
          bind:group={form.data.where}
          data-testid="add-share-where-own"
          class="mt-0.5"
        />
        <span class="min-w-0">
          <span class="block text-sm">{t.own_vault()}</span>
          <span class="block text-xs text-base-content/70">{t.own_vault_hint()}</span>
          {#if form.data.where === 'own'}
            <span class="block text-xs text-base-content/80" data-testid="add-share-own-platform">
              {isTauri ? t.own_vault_desktop() : t.own_vault_browser()}
            </span>
          {/if}
        </span>
      </label>
    </fieldset>

    {#if form.data.where === 'vault'}
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
    {/if}

    <Field name="name">
      <TextControl
        label={t.name()}
        bind:value={form.data.name}
        autocomplete="nickname"
        placeholder={t.name_placeholder()}
        testid="add-share-name"
        class="text-xs"
      />
    </Field>

    <p class="text-xs text-base-content/80" data-testid="add-share-trust">{t.trust()}</p>

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
        class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content shadow-sm hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
      >
        {form.busy ? t.joining() : t.join()}
      </button>
    </div>
  </form>
</Dialog>
