<script lang="ts">
  /**
   * The share sheet (sharing-shaping E4, R3/R4): one folder's sharing, worded
   * as invitations. The links are named rows — the label the person typed,
   * read-only when it is, when it was made, *Copy link*, *Copy message*,
   * *Remove* — with a new-link row beneath and the honesty paragraph in the
   * body, in full: a link is not a person, and removing one disconnects
   * nobody.
   *
   * The FIRST RUN (first-run-shaping D1/D2, Fork 5-A) meets the relay inline,
   * with no operator secret yet: "Syncs through" + the relay card (probed;
   * *Use another…* reveals the address field, never in a pinned build),
   * "Permission to create links" — verified against the relay before any
   * mint, *Share* disabled with the reason until it says "works" — and both
   * are remembered in Settings › Sync on Share. A folder not shared yet also
   * names its FIRST LINK ("who is it for?") and "Your name, shown to them"
   * (prefilled, saved on Share).
   *
   * The carve (`onShare`) mints the OWNER's credential, which this device's
   * own session connects with — so it is never made read-only and never
   * named for someone else. A named first link is minted beside it, for that
   * person, exactly as *Create link* does; without a name the carve's link is
   * the one copied, as before.
   *
   * Links leave the sheet in the URL form when an origin is known
   * (`share-message.ts`: the browser's own; the team host on the desktop;
   * else the bare `editor1:` link), carrying `label` (the folder) and `from`
   * (the name typed) — and *Copy message* wraps one in a sentence (C4).
   */
  import { untrack } from 'svelte'
  import { z } from 'zod'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { Clock } from '@ohhi/vault'
  import {
    DEFAULT_RELAY,
    DEFAULT_RELAY_CONFIGURED,
    TEAM_HOST,
    TEAM_NETWORK_NOTE,
    isRelayUrl,
  } from '../config.js'
  import { isTauri } from '../platform.js'
  import { realClock } from '../real-clock.js'
  import { listShares, mintShare, revokeShare, type RelayShare } from '../relay-admin.js'
  import type { ProbeResult, SecretCheck } from '../relay-probe.js'
  import { decodeShareLink, type ShareTarget } from '../share-link.js'
  import { isTeamRelay, linkOrigin, presentLink, shareMessage } from '../share-message.js'
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
  import RelayCard from './RelayCard.svelte'
  import RelaySecretField, { type SecretState } from './RelaySecretField.svelte'

  interface Props {
    path: string
    /** Non-null when the folder is already a shared mount. */
    mount: MountInfo | null
    /** The relay new shares are created on (Settings › Sync, else the build's). */
    relayUrl: string
    /** Whether a relay is known at all (`relayKnown()`): false → the card's none state. */
    relayKnown?: boolean
    /** Operator secret from Settings ('' = not configured: the first-run block shows). */
    secret: string
    /** The saved display name (Fork 5-A), prefilling "Your name, shown to them". */
    userName?: string
    /** Remember the name typed here (on Share, when it changed). */
    onSaveName?: (name: string) => void
    /** Runs the carve; resolves to the folder's link (the owner's credential). */
    onShare: () => Promise<string>
    /** Remember the relay and secret in Settings › Sync (the first-run block's answer). */
    onRemember: (relay: string, secret: string) => void
    /** Close the sheet and ask the existing Stop-sharing confirm. */
    onStopSharing: () => void
    onClose: () => void
    // ---- environment, injectable for tests ----
    clock?: Clock
    probe?: (relayUrl: string) => Promise<ProbeResult>
    verify?: (relayUrl: string, secret: string) => Promise<SecretCheck>
    /** The pinned host (`TEAM_HOST`); '' = a generic build. */
    pinnedHost?: string
    /** The build's default relay, when it was given one: the team's ('' = none). */
    teamRelay?: string
    networkNote?: string
    secretHint?: string
    desktop?: boolean
    locationOrigin?: string | null
  }

  let {
    path,
    mount,
    relayUrl,
    relayKnown = true,
    secret,
    userName = '',
    onSaveName,
    onShare,
    onRemember,
    onStopSharing,
    onClose,
    clock = realClock,
    probe,
    verify,
    pinnedHost = TEAM_HOST,
    teamRelay = DEFAULT_RELAY_CONFIGURED ? DEFAULT_RELAY : '',
    networkNote = TEAM_NETWORK_NOTE,
    secretHint,
    desktop = isTauri(),
    locationOrigin = typeof location !== 'undefined' ? location.origin : null,
  }: Props = $props()

  const t = $derived($LL.web.share.sheet)

  /**
   * Whether the first-run block shows. Seeded once from the secret at open —
   * not derived from it — so remembering the secret mid-share does not pull
   * the block out from under the button the person just pressed.
   */
  // svelte-ignore state_referenced_locally -- seed only, see above
  let setup = $state(!secret)

  // ---- the relay: the card, and *Use another…* ----
  /** The address field is open: *Use another…*, or no relay is known at all (never in a pinned build). */
  // svelte-ignore state_referenced_locally -- seed only
  let otherOpen = $state(!relayKnown && !pinnedHost)
  // svelte-ignore state_referenced_locally -- seed only; the form owns it after
  const where = createForm(
    z.object({
      relay: z
        .string()
        .trim()
        .min(1, $LL.web.settings.sync.relay_required())
        .refine(isRelayUrl, $LL.web.settings.sync.relay_invalid()),
    }),
    { relay: relayKnown ? relayUrl : '' }
  )
  /** The relay a share would be created on right now. */
  const shareRelay = $derived(otherOpen ? where.data.relay.trim() : relayUrl)
  const shareRelayValid = $derived(isRelayUrl(shareRelay))
  const teamHost = $derived(teamRelay ? (relayHost(teamRelay) ?? '') : '')

  // ---- the secret ----
  let secretValue = $state('')
  let check = $state<SecretState>('idle')

  // ---- the first link and the name (a folder not shared yet) ----
  let firstLabel = $state('')
  let firstReadOnly = $state(false)
  // svelte-ignore state_referenced_locally -- seed only (Fork 5-A: prefilled)
  let yourName = $state(userName)

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
  const folderRelay = $derived(mount?.relay ?? shareRelay)
  const host = $derived(relayHost(folderRelay) ?? folderRelay)

  const intro = $derived(
    !mount
      ? t.intro_new()
      : mount.foreign
        ? t.intro_joined({ path, host })
        : t.intro_shared({ path, host })
  )

  /** The secret this sheet acts with: Settings', or the one being verified in the first run. */
  const actingSecret = $derived(secret || (check === 'ok' ? secretValue.trim() : ''))

  /** The list is ours to show only for a folder this vault shared, with the secret. */
  const manages = $derived(mount !== null && !mount.foreign && actingSecret !== '')

  let links = $state<RelayShare[] | null>(null)
  let listError = $state('')
  let listBusy = $state(false)
  let shareBusy = $state(false)
  let shareError = $state('')
  /** After the carve: the link made, whether it reached the clipboard, and who it is for. */
  let justShared = $state<{ copied: boolean; link: string; name: string } | null>(null)
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
    if (!room || !actingSecret) return
    listError = ''
    try {
      links = await listShares(folderRelay, actingSecret, room)
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
      clock.schedule(() => {
        if (copiedKey === key) copiedKey = null
      }, 1500)
      return true
    } catch {
      return false // clipboard blocked — the link stays selectable
    }
  }

  // ---- the link as it leaves the sheet (C1/C4) ----
  const origin = $derived(linkOrigin({ desktop, locationOrigin, relayUrl: folderRelay }))
  const fromName = $derived(yourName.trim() || userName)

  function present(target: ShareTarget): string {
    return presentLink({ ...target, label: path, ...(fromName ? { from: fromName } : {}) }, origin)
  }

  function messageFor(link: string, relay: string): string {
    const team = isTeamRelay(relay, { defaultRelay: teamRelay, configured: teamRelay !== '' })
    return shareMessage({ folder: path, link, networkNote: team ? networkNote : '', origin })
  }

  function linkFor(s: RelayShare): string {
    return present({ relay: folderRelay, room: s.folderGuid, token: s.token })
  }

  // ---- Share ----
  /** Why *Share* cannot be pressed yet ('' = it can). */
  const shareBlocked = $derived(
    setup && !mount?.foreign ? (otherOpen && !shareRelayValid) || check !== 'ok' : false
  )

  /** The first-run answer; false keeps the sheet where it is. */
  async function remember(): Promise<boolean> {
    if (!setup) return true
    if (otherOpen && !(await where.submit(() => {}))) return false
    if (check !== 'ok') return false
    onRemember(shareRelay, secretValue.trim())
    return true
  }

  async function share(): Promise<void> {
    if (!(await remember())) return
    const usingSecret = actingSecret
    shareBusy = true
    shareError = ''
    try {
      const carved = await onShare()
      setup = false
      const name = yourName.trim()
      if (name && name !== userName) onSaveName?.(name)
      let target: ShareTarget
      try {
        const d = decodeShareLink(carved)
        target = { relay: d.relay, room: d.room, token: d.token }
      } catch {
        // Not a link this codec reads: hand over exactly what the carve gave.
        justShared = { copied: await copy(carved, '__folder'), link: carved, name: '' }
        return
      }
      const label = firstLabel.trim()
      if (label) {
        // One link per person, named for them — beside the owner's own credential.
        const minted = await mintShare(target.relay, usingSecret, {
          folderGuid: target.room,
          label,
          readOnly: firstReadOnly,
        })
        target = { ...target, token: minted.token }
      }
      const link = present(target)
      justShared = { copied: await copy(link, '__folder'), link, name: label }
      void refresh()
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
      await mintShare(folderRelay, actingSecret, { folderGuid: room, label, readOnly: newReadOnly })
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
      await revokeShare(folderRelay, actingSecret, s.token)
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
      <section class="space-y-1.5 rounded-lg border border-base-300 p-3" data-testid="share-done-block">
        <p class="text-xs text-base-content/80" role="status" data-testid="share-done">
          {justShared.copied ? t.shared_copied() : t.shared_not_copied()}
        </p>
        {#if justShared.name}
          <p class="text-xs font-medium">{t.just_made({ name: justShared.name })}</p>
        {/if}
        <input
          readonly
          value={justShared.link}
          aria-label={t.this_link()}
          data-testid="share-done-link"
          class="w-full rounded border border-base-300 px-2 py-1 font-ed-mono text-[11px] select-all"
        />
        <div class="flex justify-end gap-2">
          <button
            type="button"
            data-testid="share-done-copy-link"
            onclick={() => void copy(justShared?.link ?? '', '__done-link')}
            class={button}
          >
            {copiedKey === '__done-link' ? t.copied() : t.copy_link()}
          </button>
          <button
            type="button"
            data-testid="share-done-copy-message"
            onclick={() => void copy(messageFor(justShared?.link ?? '', folderRelay), '__done-message')}
            class={button}
          >
            {copiedKey === '__done-message' ? t.copied() : t.copy_message()}
          </button>
        </div>
      </section>
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
                    data-testid="copy-message:{key}"
                    aria-label={copiedKey === `${key}:message` ? t.copied() : t.copy_message_for({ name })}
                    onclick={() => void copy(messageFor(linkFor(s), folderRelay), `${key}:message`)}
                    class="{rowButton} text-base-content/80"
                  >
                    {copiedKey === `${key}:message` ? t.copied() : t.copy_message()}
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
      <!-- The relay, met inline the first time it is needed (R3/R4). -->
      <section aria-labelledby="share-where-heading" data-testid="share-where" class="space-y-3">
        <div class="space-y-1.5">
          <h3 id="share-where-heading" class={HEADING}>{t.syncs_through()}</h3>
          <RelayCard
            relayUrl={shareRelay}
            known={relayKnown || (otherOpen && shareRelayValid) || !!pinnedHost}
            {pinnedHost}
            {teamHost}
            {networkNote}
            {clock}
            {probe}
            onChange={otherOpen ? undefined : () => (otherOpen = true)}
            changeLabel="use_another"
          />
          {#if otherOpen && !pinnedHost}
            <Field name="relay" errors={where.errorsFor('relay')} required>
              <TextControl
                label={t.relay()}
                mono
                bind:value={where.data.relay}
                onblur={() => where.touch('relay')}
                placeholder="wss://"
                testid="share-relay"
                class="text-xs"
              />
              <FieldErrors />
            </Field>
          {/if}
        </div>
        <RelaySecretField
          relayUrl={shareRelayValid ? shareRelay : ''}
          bind:value={secretValue}
          bind:check
          required
          {clock}
          {verify}
          hint={secretHint}
          testid="share-secret"
        />
        {#if mount}
          <div class="flex justify-end">
            <button
              data-testid="share-save-where"
              disabled={shareBlocked || where.busy}
              onclick={() => void saveWhere()}
              class={button}
            >
              {t.save_where()}
            </button>
          </div>
        {/if}
      </section>
    {/if}

    {#if !mount}
      <!-- The first share names its first link, and who it is from (Fork 5-A). -->
      <section class="space-y-3" data-testid="share-first-link">
        <div class="flex items-end gap-2">
          <Field name="firstLabel" class="min-w-0 flex-1">
            <TextControl
              label={t.first_link()}
              bind:value={firstLabel}
              placeholder={t.new_link_placeholder()}
              testid="first-link-label"
              class="text-xs"
            />
            <Description>{t.first_link_hint()}</Description>
          </Field>
          <Field name="firstReadOnly" class="pb-7">
            <CheckControl
              label={t.read_only_label()}
              bind:checked={firstReadOnly}
              testid="first-link-readonly"
              class="text-xs"
            />
          </Field>
        </div>
        <Field name="yourName">
          <TextControl label={t.your_name()} bind:value={yourName} testid="share-your-name" class="text-xs" />
          <Description>{t.your_name_hint()}</Description>
        </Field>
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
      <div class="flex items-center gap-2">
        {#if mount}
          <button data-testid="close-folder-share" onclick={onClose} class={button}>{t.done()}</button>
        {:else}
          {#if shareBlocked}
            <p id="share-waits" data-testid="share-waits" class="text-xs text-base-content/80">{t.share_waits()}</p>
          {/if}
          <button data-testid="close-folder-share" onclick={onClose} class={button}>
            {$LL.common.cancel()}
          </button>
          <button
            data-testid="confirm-share-folder"
            disabled={shareBusy || where.busy || shareBlocked}
            aria-describedby={shareBlocked ? 'share-waits' : undefined}
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
