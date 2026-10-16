<script lang="ts" module>
  /**
   * Where "Download" goes: the getting-started guide's install section, on
   * this page's own origin — never the private repository's Releases page,
   * which answers 404 to anyone outside the GitHub org.
   */
  export const DOWNLOAD_HREF = '/guide/start.html#install'
</script>

<script lang="ts">
  /**
   * The join page (first-run-shaping C2, Fork 1-A / 3-B): what a browser
   * shows at `https://<host>/join#editor1:…` — the link in its URL form,
   * clicked from a chat. Rendered INSTEAD of the vault manager, in the
   * browser build only (`params.ts` `joinPageLink`; a Tauri window never
   * reaches `/join`, the desktop's dialogs read the URL instead).
   *
   * It says what the link is before anything is picked: who sent it — the
   * name THEY TYPED, never a verified account (R5) — what you get, which
   * relay it syncs through and whether that relay answers from here (R3; a
   * health check, never "the link is valid"). Then where it should go: *In
   * the desktop app* copies the link for the app's *Add a folder someone
   * shared* (Fork 3-B — no deep link yet); *In this browser* is the choice
   * itself (amended 2026-10-16, `join-share-brief`): **inside one
   * of the browser's vaults** — the tab can read the browser's vault list
   * even though it has no vault open — with a picker when there are several
   * and a folder that defaults to the link's label; or **as a shared vault
   * of its own**, which hands off to the manager's Add dialog as before.
   * "Inside" is preselected whenever the browser has a vault; own-vault
   * stays one click away and is the only choice when it has none.
   *
   * A device link is not a folder share and is never offered as one: the
   * page says what it is and routes it to *Link this device* (device-link R5).
   */
  import { z } from 'zod'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { relayHost } from '@ohhi/workspace'
  import { CircleAlert, CircleCheck, Copy, Globe, LoaderCircle, Monitor } from '@lucide/svelte'
  import { loadUser, saveUser, TEAM_NETWORK_NOTE, type VaultEntry } from '../config.js'
  import { guideHref } from '../guide.js'
  import { checkRelay, defaultProbe, teamRelayHost, type Probe, type RelayCheck } from '../relay-check.js'
  import { decodeShareLink, folderNameOfLabel, shareLinkErrorText, type DecodedShareLink } from '../share-link.js'
  import { createForm } from '../ui/form.svelte.js'
  import Description from '../ui/Description.svelte'
  import Field from '../ui/Field.svelte'
  import FieldErrors from '../ui/FieldErrors.svelte'
  import SelectControl from '../ui/SelectControl.svelte'
  import TextControl from '../ui/TextControl.svelte'
  import Wordmark from '../ui/Wordmark.svelte'
  import { CARD, FACT, HEADING, OUTLINE_BUTTON } from '../ui/styles.js'

  interface Props {
    /** The page's address (or any spelling the codec reads). */
    link: string
    /** *As a shared vault of its own* for a folder link: the manager's Add dialog, prefilled. */
    onAddHere: (link: string) => void
    /** *Link this device* for a device link: the manager's device dialog, prefilled. */
    onLinkHere: (link: string) => void
    /**
     * *Inside <vault>*: open `entry` and mount the folder at `dest` once it
     * is live (App.svelte's pending join). `name` is "Your name", already
     * saved. Absent, or `vaults` empty: only own-vault is offered.
     */
    onAddInto?: (link: string, entry: VaultEntry, dest: string, name: string) => void
    /** The browser's remembered vaults (`config.vaults`), newest first. */
    vaults?: VaultEntry[]
    /** The vault last opened in this browser, preselected when there are several. */
    lastRoom?: string | null
    /** "Your name" at open; defaults to the saved display name. */
    initialName?: string
    /** The build's relay host (the team's), or null in a build without one. */
    teamHost?: string | null
    /** The build's sentence about reaching that relay ('' = none). */
    networkNote?: string
    /** The relay health check; tests hand in a fake. */
    probe?: Probe
    /** Where "Download" goes; default `DOWNLOAD_HREF`, the guide's install section. */
    downloadHref?: string
  }

  let {
    link,
    onAddHere,
    onLinkHere,
    onAddInto,
    vaults = [],
    lastRoom = null,
    initialName = loadUser() ?? '',
    teamHost = teamRelayHost(),
    networkNote = TEAM_NETWORK_NOTE,
    probe = defaultProbe,
    downloadHref = DOWNLOAD_HREF,
  }: Props = $props()

  const t = $derived($LL.web.join_page)

  type Decoded = { ok: true; link: DecodedShareLink } | { ok: false; error: string }
  const decoded: Decoded = $derived.by(() => {
    try {
      return { ok: true, link: decodeShareLink(link) }
    } catch (err) {
      return { ok: false, error: shareLinkErrorText(err) }
    }
  })

  const share = $derived(decoded.ok ? decoded.link : null)
  const host = $derived(share ? (relayHost(share.relay) ?? share.relay) : '')
  const isTeam = $derived(teamHost !== null && host === teamHost)

  // ---- the relay probe, run on load (and again if the link changes) ----
  // The effect's teardown cancels it: leaving the page drops the answer.
  let check = $state<RelayCheck>('pending')
  $effect(() => {
    const relay = share?.relay
    if (!relay) return
    check = 'pending'
    return checkRelay(relay, probe, (c) => (check = c))
  })

  // ---- the copy action (Fork 3-B) ----
  let copied = $state<'idle' | 'done' | 'failed'>('idle')
  let fallbackLink = $state('')
  function copy(): void {
    fallbackLink = link
    // In the click handler itself: browsers grant the clipboard to a user gesture.
    let pending: Promise<void>
    try {
      pending = navigator.clipboard.writeText(link)
    } catch {
      copied = 'failed'
      return
    }
    pending.then(
      () => (copied = 'done'),
      () => (copied = 'failed')
    )
  }

  const isDevice = $derived(share?.kind === 'device')
  const label = $derived(share?.label ?? t.a_folder())

  // ---- where in this browser (C2 amended): inside a vault, or its own ----
  /** Only when the browser has somewhere to put it AND the host can run the pending join. */
  const canJoinInto = $derived(vaults.length > 0 && onAddInto !== undefined)
  type Where = 'vault' | 'own'
  const schema = z
    .object({
      where: z.enum(['vault', 'own']),
      room: z.string(),
      dest: z.string().trim(),
      name: z.string().trim(),
    })
    .superRefine((v, ctx) => {
      if (v.where !== 'vault') return
      if (!v.dest) ctx.addIssue({ code: 'custom', path: ['dest'], message: $LL.web.share.add.dest_required() })
      else if (/[\\:*?"<>|\u0000-\u001f]/.test(v.dest) || v.dest.split('/').some((s) => !s.trim() || s.startsWith('.'))) {
        ctx.addIssue({ code: 'custom', path: ['dest'], message: $LL.web.tree_op.invalid_name({ name: v.dest }) })
      }
    })
  // svelte-ignore state_referenced_locally -- seeds only; the form owns them after
  const preselected = vaults.find((v) => v.room === lastRoom) ?? vaults[0] ?? null
  // svelte-ignore state_referenced_locally -- seeds only; the form owns them after
  const form = createForm(schema, {
    where: (canJoinInto ? 'vault' : 'own') as Where,
    room: preselected?.room ?? '',
    // The folder defaults to the link's label — its last segment, as the
    // own-vault name does (first-run F1) — editable.
    dest: share?.kind === 'folder' ? folderNameOfLabel(share.label) : '',
    name: initialName,
  })
  const chosen = $derived(vaults.find((v) => v.room === form.data.room) ?? vaults[0] ?? null)
  /** What an own vault will be called: the link's label, else the relay's host (the manager's `joinedVaultName`). */
  const ownName = $derived(
    (share?.kind === 'folder' ? folderNameOfLabel(share.label) : '') ||
      $LL.web.manager.joined_vault_name({ host })
  )

  async function addInto(): Promise<void> {
    await form.submit(({ dest, name }) => {
      if (!chosen || !onAddInto) return
      saveUser(name)
      onAddInto(link, chosen, dest, name)
    })
  }

  const radio = 'flex cursor-pointer items-start gap-2 rounded border border-base-300 p-2 hover:bg-base-200'
  const primary =
    'rounded bg-primary px-4 py-2 text-sm font-medium text-primary-content shadow-sm hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary'
  const outline = `${OUTLINE_BUTTON} inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-base-content/80`
  const linkCls = 'text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary'
</script>

<main class="flex min-h-full items-start justify-center bg-base-200 px-4 py-12 text-base-content" data-testid="join-page">
  <div class="w-full max-w-xl space-y-6 {CARD} p-6 shadow-sm">
    <p class="m-0 flex flex-wrap items-baseline gap-x-1.5 text-sm text-base-content/70" data-testid="join-brand">
      <Wordmark testid="join-wordmark" /> <span>{t.brand_suffix()}</span>
    </p>

    {#if !decoded.ok}
      <section class="space-y-2" data-testid="join-error">
        <h1 class="flex items-center gap-2 text-xl font-semibold">
          <CircleAlert size={20} strokeWidth={1.75} aria-hidden="true" class="shrink-0 text-error" />
          {t.error_heading()}
        </h1>
        <p class="text-sm" role="alert">{decoded.error}</p>
        <p class="text-sm text-base-content/70">{t.error_fallback()}</p>
      </section>
    {:else if share}
      <header class="space-y-1.5">
        {#if isDevice}
          <h1 class="text-xl font-semibold" data-testid="join-heading">{t.device_heading()}</h1>
          <p class="text-sm text-base-content/80" data-testid="join-device-body">
            {t.device_body({ label: share.label ?? t.device_vault() })}
          </p>
        {:else}
          <h1 class="text-xl font-semibold" data-testid="join-heading">
            {share.from ? t.heading_from({ from: share.from, label }) : t.heading_anon({ label })}
          </h1>
          <p class="text-sm text-base-content/70" data-testid="join-sender-note">
            {share.from ? t.from_note({ from: share.from }) : t.anon_note()}
          </p>
        {/if}
      </header>

      <dl class="space-y-3" aria-label={t.facts()}>
        {#if !isDevice}
          <div>
            <dt class={FACT}>{t.what_you_get()}</dt>
            <dd class="mt-0.5 text-sm">{t.what_you_get_body()}</dd>
          </div>
        {/if}
        <div>
          <dt class={FACT}>{t.syncs_through()}</dt>
          <dd class="mt-0.5 text-sm" data-testid="join-syncs-through">
            {isTeam ? t.syncs_team({ host }) : t.syncs_other({ host })}
            {#if isTeam && networkNote}{networkNote}{/if}
            {t.offline()}
          </dd>
          <dd class="mt-1.5">
            <div class="flex items-start gap-1.5 text-sm" role="status" data-testid="join-relay" data-check={check}>
              {#if check === 'pending'}
                <LoaderCircle size={16} strokeWidth={1.75} aria-hidden="true" class="mt-0.5 shrink-0 animate-spin text-base-content/70" />
                <span class="text-base-content/70">{t.relay_checking()}</span>
              {:else if check === 'ok'}
                <CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" class="mt-0.5 shrink-0 text-success" />
                <span>{t.relay_ok()}</span>
              {:else if check === 'unhealthy'}
                <!-- Reached, so no network advice: the relay itself needs its operator. -->
                <CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" class="mt-0.5 shrink-0 text-warning" />
                <span>{t.relay_unhealthy()}</span>
              {:else}
                <CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" class="mt-0.5 shrink-0 text-warning" />
                <span>
                  {t.relay_down()}
                  {isTeam ? networkNote : t.relay_down_other()}
                  {t.reload()}
                </span>
              {/if}
            </div>
          </dd>
        </div>
      </dl>

      <section class="space-y-3" aria-labelledby="join-where">
        <h2 id="join-where" class={HEADING}>{t.where()}</h2>
        <!-- Two rows, not two columns (Chris, 2026-10-16): the browser row
             carries a form, and a column beside it only stretched to match. -->
        <div class="flex flex-col gap-3">
          <div class="{CARD} flex flex-wrap items-center gap-x-4 gap-y-2 p-4" data-testid="join-option-desktop">
            <div class="min-w-0 flex-1">
              <h3 class="flex items-center gap-1.5 text-sm font-semibold">
                <Monitor size={16} strokeWidth={1.75} aria-hidden="true" />
                {t.desktop()}
              </h3>
              <p class="mt-0.5 text-xs text-base-content/70">{isDevice ? t.device_desktop_hint() : t.desktop_hint()}</p>
            </div>
            <button type="button" class={outline} data-testid="join-copy" onclick={copy}>
              <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
              {t.copy()}
            </button>
          </div>
          <div class="{CARD} p-4" data-testid="join-option-browser">
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div class="min-w-0 flex-1">
                <h3 class="flex items-center gap-1.5 text-sm font-semibold">
                  <Globe size={16} strokeWidth={1.75} aria-hidden="true" />
                  {t.browser()}
                </h3>
                <p class="mt-0.5 text-xs text-base-content/70">{isDevice ? t.device_browser_hint() : t.browser_hint()}</p>
                {#if !isDevice && !canJoinInto}
                  <!-- No vault in this browser yet: the Add dialog makes one, and says it is a shared vault. -->
                  <p class="mt-0.5 text-xs text-base-content/80" data-testid="join-own-only">{t.own_vault_hint()}</p>
                {/if}
              </div>
              {#if isDevice}
                <button type="button" class={primary} data-testid="join-link-here" onclick={() => onLinkHere(link)}>
                  {t.link_here()}
                </button>
              {:else if !canJoinInto}
                <button type="button" class={primary} data-testid="join-add-here" onclick={() => onAddHere(link)}>
                  {t.add_here()}
                </button>
              {/if}
            </div>
            {#if !isDevice && canJoinInto}
              <!-- The browser has a vault: the row IS the choice (C2 amended
                   2026-10-16). Inside <vault> is preselected; own-vault is one
                   click away, and says that it makes a SHARED vault. The choice
                   on the left, what it needs on the right; one column when narrow. -->
              <form
                class="mt-3 flex flex-col gap-3"
                novalidate
                onsubmit={(e) => {
                  e.preventDefault()
                  if (form.data.where === 'own') {
                    // The name goes with the link: the manager's dialog opens prefilled with it.
                    saveUser(form.data.name.trim())
                    onAddHere(link)
                  } else void addInto()
                }}
              >
                <!-- The two choices side by side, then what the chosen one needs, in one row too (Chris, 2026-10-16). -->
                <fieldset>
                  <legend class="mb-1 block text-xs font-semibold tracking-wide text-base-content/70 uppercase">{t.where_here()}</legend>
                  <div class="grid gap-2 sm:grid-cols-2">
                    <label class={radio}>
                      <input type="radio" name="join-where" value="vault" bind:group={form.data.where} data-testid="join-where-vault" class="mt-0.5" />
                      <span class="min-w-0 flex-1">
                        <span class="block text-sm">
                          {vaults.length === 1 ? t.inside_vault({ vault: vaults[0]!.name }) : t.inside_vault({ vault: chosen?.name ?? '' })}
                        </span>
                        <span class="block text-xs text-base-content/70">{t.inside_vault_hint()}</span>
                      </span>
                    </label>
                    <label class={radio}>
                      <input type="radio" name="join-where" value="own" bind:group={form.data.where} data-testid="join-where-own" class="mt-0.5" />
                      <span class="min-w-0">
                        <span class="block text-sm">{t.own_vault()}</span>
                        <span class="block text-xs text-base-content/70">{t.own_vault_hint()}</span>
                      </span>
                    </label>
                  </div>
                </fieldset>
                <div class="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                  {#if form.data.where === 'vault'}
                    {#if vaults.length > 1}
                      <Field name="join-vault">
                        <SelectControl label={t.vault_picker()} bind:value={form.data.room} testid="join-vault-picker">
                          {#each vaults as v (v.room)}
                            <option value={v.room}>{v.name}</option>
                          {/each}
                        </SelectControl>
                      </Field>
                    {/if}
                    <Field name="join-dest" errors={form.errorsFor('dest')} required class={vaults.length > 1 ? '' : 'sm:col-span-2'}>
                      <TextControl
                        label={t.folder()}
                        mono
                        bind:value={form.data.dest}
                        onblur={() => form.touch('dest')}
                        testid="join-dest"
                        class="text-xs"
                      />
                      <Description>{t.folder_hint()}</Description>
                      <FieldErrors />
                    </Field>
                  {:else}
                    <!-- Own-vault: what it will be called, after the folder (the manager's rule),
                         in the same box as the field below it — read-only, since the name is the folder's. -->
                    <Field name="join-own-vault" class="sm:col-span-2">
                      <div data-testid="join-own-platform">
                        <TextControl
                          label={t.vault_name()}
                          value={ownName}
                          readonly
                          tabindex={-1}
                          testid="join-own-name"
                          class="bg-base-200 text-base-content/80"
                        />
                        <Description>{t.vault_name_hint()}</Description>
                      </div>
                    </Field>
                  {/if}
                  <!-- Your name is always the row below, whole, whichever choice is made. -->
                  <Field name="join-name" class="sm:col-span-2">
                    <TextControl
                      label={t.name()}
                      bind:value={form.data.name}
                      autocomplete="nickname"
                      placeholder={$LL.web.share.add.name_placeholder()}
                      testid="join-name"
                      class="text-xs"
                    />
                    <Description>{t.name_hint()}</Description>
                  </Field>
                </div>
                <div class="flex flex-wrap items-center gap-3">
                  <button type="submit" class={primary} data-testid="join-add-here" disabled={form.busy}>
                    {form.data.where === 'vault' && chosen ? t.add_into({ vault: chosen.name }) : t.add_here()}
                  </button>
                  {#if form.formError}
                    <p class="m-0 text-xs text-error" role="alert" data-testid="join-error-line">{form.formError}</p>
                  {/if}
                </div>
              </form>
            {/if}
          </div>
        </div>
        <div aria-live="polite">
          {#if copied === 'done'}
            <p class="text-sm" data-testid="join-copied">{isDevice ? t.device_copied() : t.copied()}</p>
          {:else if copied === 'failed'}
            <div class="space-y-2" data-testid="join-copy-failed">
              <p class="text-sm">{isDevice ? t.device_copy_failed() : t.copy_failed()}</p>
              <Field name="join-link">
                <TextControl
                  label={t.link_label()}
                  mono
                  readonly
                  bind:value={fallbackLink}
                  onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
                  testid="join-link-text"
                  class="text-[11px]"
                />
              </Field>
            </div>
          {/if}
        </div>
      </section>
    {/if}

    <footer class="space-y-1 border-t border-base-300 pt-4 text-xs text-base-content/70">
      <p>
        {t.no_app()}
        <a class={linkCls} href={downloadHref} data-testid="join-download">{t.download()}</a>
      </p>
      <p>
        {t.new_to_app()}
        <a class={linkCls} href={guideHref('start')} data-testid="join-guide">{t.guide()}</a>
      </p>
    </footer>
  </div>
</main>
