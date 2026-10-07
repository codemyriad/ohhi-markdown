<script lang="ts">
  /**
   * The share sheet (sharing-shaping E4, R3/R4): one folder's sharing, worded
   * as invitations. The links are named rows — the label the person typed,
   * read-only when it is, when it was made, *Copy link*, *Remove* — with a
   * new-link row beneath and the honesty paragraph in the body, in full: a
   * link is not a person, and removing one disconnects nobody.
   *
   * The FIRST RUN meets the relay inline: with no operator secret yet, the
   * same sheet asks where it syncs (relay + secret, validated as Settings ›
   * Sync validates them) and remembers both there on the first create — so a
   * fresh install shares a folder without opening Settings.
   *
   * The mechanism is untouched: the carve is the host's `onShare`, and the
   * list / create / remove calls are the relay admin API (`relay-admin.ts`)
   * with the operator secret, exactly as the token manager made them.
   */
  import { untrack } from 'svelte'
  import { z } from 'zod'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { isRelayUrl } from '../config.js'
  import { listShares, mintShare, revokeShare, type RelayShare } from '../relay-admin.js'
  import { encodeShareLink } from '../share-link.js'
  import { relayHost } from '@ohhi/workspace'
  import type { MountInfo } from '../workspace.svelte.js'
  import { createForm } from '../ui/form.svelte.js'
  import CheckControl from '../ui/CheckControl.svelte'
  import Description from '../ui/Description.svelte'
  import Dialog from '../ui/Dialog.svelte'
  import Field from '../ui/Field.svelte'
  import FieldErrors from '../ui/FieldErrors.svelte'
  import TextControl from '../ui/TextControl.svelte'
  import { HEADING, OUTLINE_BUTTON } from '../ui/styles.js'

  interface Props {
    path: string
    /** Non-null when the folder is already a shared mount. */
    mount: MountInfo | null
    /** The relay new shares are created on (Settings › Sync, else the build's). */
    relayUrl: string
    /** Operator secret from Settings ('' = not configured: the first-run block shows). */
    secret: string
    /** Runs the carve; resolves to the folder's link. */
    onShare: () => Promise<string>
    /** Remember the relay and secret in Settings › Sync (the first-run block's answer). */
    onRemember: (relay: string, secret: string) => void
    /** Close the sheet and ask the existing Stop-sharing confirm. */
    onStopSharing: () => void
    onClose: () => void
  }

  let { path, mount, relayUrl, secret, onShare, onRemember, onStopSharing, onClose }: Props = $props()

  const t = $derived($LL.web.share.sheet)

  /**
   * Whether the "Where it syncs" block shows. Seeded once from the secret at
   * open — not derived from it — so remembering the secret mid-share does not
   * pull the block out from under the button the person just pressed.
   */
  // svelte-ignore state_referenced_locally -- seed only, see above
  let setup = $state(!secret)

  // svelte-ignore state_referenced_locally -- seed only; the form owns it after
  const where = createForm(
    z.object({
      relay: z
        .string()
        .trim()
        .min(1, $LL.web.settings.sync.relay_required())
        .refine(isRelayUrl, $LL.web.settings.sync.relay_invalid()),
      secret: z.string().trim().min(1, $LL.web.share.sheet.secret_required()),
    }),
    { relay: relayUrl, secret: '' }
  )

  /**
   * The new-link row. Plain state rather than `createForm`: the row empties
   * after every create, and a form that remembers it was submitted would
   * greet the empty field with its refusal.
   */
  let newLabel = $state('')
  let newReadOnly = $state(false)
  let newLabelError = $state('')
  let creating = $state(false)

  /**
   * The relay this folder's links live on: the room's own (`MountInfo.relay`,
   * the resolution its session connects with), else — not shared yet — the
   * relay a new share is minted on.
   */
  const folderRelay = $derived(mount?.relay ?? relayUrl)
  const host = $derived(relayHost(folderRelay) ?? folderRelay)

  const intro = $derived(
    !mount
      ? t.intro_new()
      : mount.foreign
        ? t.intro_joined({ path, host })
        : t.intro_shared({ path, host })
  )

  /** The list is ours to show only for a folder this vault shared, with the secret. */
  const manages = $derived(mount !== null && !mount.foreign && secret !== '')

  let links = $state<RelayShare[] | null>(null)
  let listError = $state('')
  let listBusy = $state(false)
  let shareBusy = $state(false)
  let shareError = $state('')
  /** After the carve: whether the first link made it onto the clipboard. */
  let justShared = $state<'copied' | 'not-copied' | null>(null)
  let copiedKey = $state<string | null>(null)

  const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))
  const keyOf = (s: RelayShare): string => s.label ?? s.token.slice(0, 8)
  const nameOf = (s: RelayShare): string => s.label ?? t.unnamed()

  function createdOn(s: RelayShare): string {
    if (!s.createdAt) return ''
    const d = new Date(s.createdAt)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  }

  async function refresh(): Promise<void> {
    const room = mount?.room
    if (!room || !secret) return
    listError = ''
    try {
      links = await listShares(folderRelay, secret, room)
    } catch (err) {
      listError = message(err)
    }
  }

  // Load (and reload) the list when the folder becomes shared or the secret arrives.
  $effect(() => {
    if (manages && mount?.room) untrack(() => void refresh())
  })

  async function copy(text: string, key: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text)
      copiedKey = key
      setTimeout(() => {
        if (copiedKey === key) copiedKey = null
      }, 1500)
      return true
    } catch {
      return false // clipboard blocked — the folder's link stays selectable below
    }
  }

  function linkFor(s: RelayShare): string {
    return encodeShareLink({ relay: folderRelay, room: s.folderGuid, token: s.token })
  }

  /** The first-run answer, validated; false keeps the sheet where it is. */
  async function remember(): Promise<boolean> {
    if (!setup) return true
    const ok = await where.submit(({ relay, secret: s }) => onRemember(relay, s))
    return ok
  }

  async function share(): Promise<void> {
    if (!(await remember())) return
    shareBusy = true
    shareError = ''
    try {
      const link = await onShare()
      setup = false
      justShared = (await copy(link, '__folder')) ? 'copied' : 'not-copied'
    } catch (err) {
      shareError = message(err)
    } finally {
      shareBusy = false
    }
  }

  async function saveWhere(): Promise<void> {
    if (await remember()) setup = false
  }

  async function create(): Promise<void> {
    const room = mount?.room
    if (!room) return
    const label = newLabel.trim()
    newLabelError = label ? '' : t.name_required()
    if (!label) return
    creating = true
    listError = ''
    try {
      await mintShare(folderRelay, secret, { folderGuid: room, label, readOnly: newReadOnly })
      newLabel = ''
      newReadOnly = false
      await refresh()
    } catch (err) {
      listError = message(err)
    } finally {
      creating = false
    }
  }

  async function remove(s: RelayShare): Promise<void> {
    listBusy = true
    listError = ''
    try {
      await revokeShare(folderRelay, secret, s.token)
      await refresh()
    } catch (err) {
      listError = message(err)
    } finally {
      listBusy = false
    }
  }

  const button = `${OUTLINE_BUTTON} px-3 py-1.5 text-xs text-base-content/80 disabled:opacity-50`
  const primary =
    'rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50'
  const rowButton =
    'rounded px-2 py-1 text-xs hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50'
</script>

<Dialog title={t.title({ path })} description={intro} testid="folder-share-dialog" {onClose}>
  <div class="space-y-4">
    {#if justShared}
      <p class="text-xs text-base-content/80" role="status" data-testid="share-done">
        {justShared === 'copied' ? t.shared_copied() : t.shared_not_copied()}
      </p>
    {/if}

    {#if mount}
      {#if manages}
        <section data-testid="token-manager" aria-labelledby="share-links-heading">
          <h3 id="share-links-heading" class={HEADING}>
            {links === null ? t.links_loading() : t.links({ count: links.length })}
          </h3>
          {#if links && links.length === 0}
            <p class="mt-1 text-xs text-base-content/70">{t.links_none()}</p>
          {:else if links}
            <ul class="mt-1 divide-y divide-base-300">
              {#each links as s (s.token)}
                {@const key = keyOf(s)}
                {@const name = nameOf(s)}
                {@const date = createdOn(s)}
                <li class="flex items-center gap-2 py-1.5" data-testid="token-row:{key}">
                  <span
                    aria-hidden="true"
                    class="flex size-6 shrink-0 items-center justify-center rounded-full bg-base-200 text-xs font-semibold text-base-content/80"
                  >
                    {name.charAt(0).toUpperCase()}
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <span class="truncate text-sm font-medium">{name}</span>
                      {#if s.readOnly}
                        <span class="rounded border border-base-300 px-1 text-[10px] text-base-content/70">
                          {t.read_only()}
                        </span>
                      {/if}
                    </div>
                    {#if date}
                      <div class="text-xs text-base-content/70">{t.created({ date })}</div>
                    {/if}
                  </div>
                  <button
                    data-testid="copy-token:{key}"
                    aria-label={copiedKey === key ? t.copied() : t.copy_link_for({ name })}
                    onclick={() => void copy(linkFor(s), key)}
                    class="{rowButton} text-base-content/80"
                  >
                    {copiedKey === key ? t.copied() : t.copy_link()}
                  </button>
                  <button
                    data-testid="revoke-token:{key}"
                    aria-label={t.remove_for({ name })}
                    disabled={listBusy}
                    onclick={() => void remove(s)}
                    class="{rowButton} text-error"
                  >
                    {t.remove()}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
          {#if listError}
            <p class="mt-1 text-xs text-error" role="alert" data-testid="token-error">{listError}</p>
          {/if}

          <form
            class="mt-3 flex items-end gap-2"
            novalidate
            onsubmit={(e) => {
              e.preventDefault()
              void create()
            }}
          >
            <Field name="label" errors={newLabelError ? [newLabelError] : []} class="min-w-0 flex-1">
              <TextControl
                label={t.new_link()}
                bind:value={newLabel}
                oninput={() => (newLabelError = '')}
                placeholder={t.new_link_placeholder()}
                testid="new-token-label"
                class="text-xs"
              />
              <FieldErrors />
            </Field>
            <Field name="readOnly" class="pb-2">
              <CheckControl
                label={t.read_only_label()}
                bind:checked={newReadOnly}
                testid="new-token-readonly"
                class="text-xs"
              />
            </Field>
            <button type="submit" data-testid="mint-token" disabled={creating} class="mb-0.5 {button}">
              {creating ? t.creating() : t.create()}
            </button>
          </form>
        </section>
      {:else if mount.link}
        <!-- Not ours to list (a folder shared WITH you), or no secret yet: the
             one link this device holds, copyable and selectable. -->
        <section aria-labelledby="share-this-link">
          <h3 id="share-this-link" class={HEADING}>{t.this_link()}</h3>
          <div class="mt-1 flex items-center gap-1">
            <input
              readonly
              value={mount.link}
              aria-labelledby="share-this-link"
              data-testid="folder-share-link"
              class="min-w-0 flex-1 rounded border border-base-300 px-2 py-1 font-ed-mono text-[11px] select-all"
            />
            <button
              data-testid="copy-folder-link"
              onclick={() => void copy(mount?.link ?? '', '__folder')}
              class={button}
            >
              {copiedKey === '__folder' ? t.copied() : t.copy_link()}
            </button>
          </div>
          {#if !mount.foreign && setup}
            <p class="mt-1 text-xs text-base-content/70">{t.links_need_secret()}</p>
          {/if}
        </section>
      {/if}
    {/if}

    {#if setup && !mount?.foreign}
      <!-- The relay, met inline the first time it is needed (R4). -->
      <section
        aria-labelledby="share-where-heading"
        data-testid="share-where"
        class="space-y-3 rounded-lg border border-base-300 p-3"
      >
        <h3 id="share-where-heading" class={HEADING}>{t.where_title()}</h3>
        <Field name="relay" errors={where.errorsFor('relay')} required>
          <TextControl
            label={t.relay()}
            mono
            bind:value={where.data.relay}
            onblur={() => where.touch('relay')}
            testid="share-relay"
            class="text-xs"
          />
          <FieldErrors />
        </Field>
        <Field name="secret" errors={where.errorsFor('secret')} required>
          <TextControl
            label={t.secret()}
            mono
            type="password"
            autocomplete="off"
            bind:value={where.data.secret}
            onblur={() => where.touch('secret')}
            testid="share-secret"
            class="text-xs"
          />
          <Description>{t.where_hint()}</Description>
          <FieldErrors />
        </Field>
        {#if mount}
          <div class="flex justify-end">
            <button data-testid="share-save-where" disabled={where.busy} onclick={() => void saveWhere()} class={button}>
              {t.save_where()}
            </button>
          </div>
        {/if}
      </section>
    {/if}

    {#if shareError}
      <p class="text-xs text-error" role="alert" data-testid="folder-share-error">{shareError}</p>
    {/if}

    <p class="text-xs text-base-content/80" data-testid="share-honesty">{t.honesty()}</p>

    <div class="flex items-center justify-between gap-2 border-t border-base-300 pt-3">
      {#if mount && !mount.foreign}
        <button data-testid="share-stop" onclick={onStopSharing} class="{rowButton} text-error">
          {t.stop()}
        </button>
      {:else}
        <span></span>
      {/if}
      <div class="flex gap-2">
        {#if mount}
          <button data-testid="close-folder-share" onclick={onClose} class={button}>{t.done()}</button>
        {:else}
          <button data-testid="close-folder-share" onclick={onClose} class={button}>
            {$LL.common.cancel()}
          </button>
          <button
            data-testid="confirm-share-folder"
            disabled={shareBusy || where.busy}
            onclick={() => void share()}
            class={primary}
          >
            {shareBusy ? t.sharing() : t.share()}
          </button>
        {/if}
      </div>
    </div>
  </div>
</Dialog>
