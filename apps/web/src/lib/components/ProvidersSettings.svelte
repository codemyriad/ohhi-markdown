<script lang="ts">
  /**
   * Settings › AI › Providers (writing-harness-shaping B1): the list of model
   * endpoints, an add/edit form on the shell's form-field pattern, *Test
   * connection*, the default, delete with a confirm — and, per provider, the
   * egress line saying where referenced text goes. The key is write-only:
   * the form never holds the stored one, an empty key field keeps it.
   *
   * Every rule lives in `ai-providers.ts`; this file is the markup.
   *
   * QA round 1 (QA3): the first group of Settings › AI. Rows, not cards: a
   * 36 px grid row per provider — the default radio, the name, its kind and
   * model, the key chip and Edit · Delete in one right-aligned column — with
   * the egress line under it ("Default · text you reference is sent to …").
   * *Local servers* is a popover from the eyebrow row, not a bold disclosure.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { ProviderKind } from '@ohhi/harness'
  import Description from '../ui/Description.svelte'
  import Field from '../ui/Field.svelte'
  import FieldErrors from '../ui/FieldErrors.svelte'
  import TextControl from '../ui/TextControl.svelte'
  import { createForm } from '../ui/form.svelte.js'
  import Popover from '../ui/Popover.svelte'
  import {
    BUTTON,
    BUTTON_PRIMARY,
    BUTTON_SM,
    CARD,
    CHIP,
    EYEBROW,
    GROUP_ROW,
    LINK,
    META,
    ROW,
    ROW_THING,
  } from '../ui/styles.js'
  import { aiConfig } from '../ai-config.svelte.js'
  import { PROVIDER_KINDS } from '@ohhi/harness/config'
  import {
    baseUrlForKind,
    connectionText,
    deleteProvider,
    draftOf,
    emptyDraft,
    kindLabel,
    providerRows,
    providerSchema,
    saveProvider,
    setDefaultProvider,
    testDraft,
    type ConnectionResult,
    type ProviderDraft,
  } from '../ai-providers.js'

  interface Props {
    /** The network for *Test connection*; the webview's own unless a test injects one. */
    fetchImpl?: typeof fetch
  }
  let { fetchImpl }: Props = $props()

  const t = $derived($LL.web.ai.providers)

  let rows = $state(providerRows())
  const refresh = (): void => {
    rows = providerRows()
  }

  /** null = no form open; '' = adding; otherwise the id being edited. */
  let editing = $state<string | null>(null)
  let confirmDelete = $state<string | null>(null)
  let testing = $state(false)
  let result = $state<ConnectionResult | null>(null)

  const form = createForm<ProviderDraft>(providerSchema(), emptyDraft())
  const editingRow = $derived(editing ? rows.find((r) => r.id === editing) : undefined)

  function load(draft: ProviderDraft): void {
    form.reset()
    Object.assign(form.data, draft)
    result = null
  }

  function startAdd(): void {
    editing = ''
    confirmDelete = null
    load(emptyDraft())
  }

  function startEdit(id: string): void {
    const stored = aiConfig().providers.find((p) => p.id === id)
    if (!stored) return
    editing = id
    confirmDelete = null
    load(draftOf(stored))
  }

  function close(): void {
    editing = null
    result = null
  }

  function changeKind(next: ProviderKind): void {
    form.data.baseUrl = baseUrlForKind(form.data.baseUrl, form.data.kind, next)
    form.data.kind = next
    result = null
  }

  async function save(): Promise<void> {
    const ok = await form.submit((draft) => {
      saveProvider(draft, editing || undefined)
    })
    if (ok) {
      refresh()
      close()
    }
  }

  async function test(): Promise<void> {
    testing = true
    result = null
    try {
      result = await testDraft($state.snapshot(form.data) as ProviderDraft, {
        editingId: editing || undefined,
        fetch: fetchImpl,
      })
    } finally {
      testing = false
    }
  }

  function remove(id: string): void {
    deleteProvider(id)
    confirmDelete = null
    if (editing === id) close()
    refresh()
  }

  function makeDefault(id: string): void {
    setDefaultProvider(id)
    refresh()
  }

  const origin = typeof window === 'undefined' ? '' : window.location.origin

  /** *Local servers*: the help popover, anchored to its own button. */
  let localAnchor = $state<HTMLElement | null>(null)
  let localOpen = $state(false)

  const selectCls =
    'mt-1 w-full rounded border border-base-300 bg-base-100 px-2 py-2 text-sm focus:border-primary focus:outline-none'
</script>

<section data-testid="ai-providers" aria-labelledby="ai-providers-title">
  <div class={GROUP_ROW}>
    <h3 id="ai-providers-title" class="m-0 {EYEBROW}">{t.title()}</h3>
    <span class="ms-auto flex items-center gap-3">
      <button
        type="button"
        bind:this={localAnchor}
        class={LINK}
        aria-expanded={localOpen}
        data-testid="ai-providers-local-help"
        onclick={() => (localOpen = !localOpen)}>{t.local_help_title()}</button
      >
      {#if editing === null}
        <button type="button" class={BUTTON} data-testid="ai-provider-add" onclick={startAdd}>{t.add()}</button>
      {/if}
    </span>
  </div>
  {#if localOpen}
    <Popover
      anchor={localAnchor}
      placement="bottom-end"
      title={t.local_help_title()}
      testid="ai-providers-local-popover"
      onClose={() => (localOpen = false)}
    >
      <p class="m-0 max-w-sm p-3 text-xs leading-[1.45] text-base-content">{t.local_help({ origin })}</p>
    </Popover>
  {/if}
  <p class="m-0 mb-2 {META}">{t.intro()}</p>

  {#if rows.length === 0}
    <p class="m-0 text-[13px] text-base-content" data-testid="ai-providers-empty">{t.empty()}</p>
  {:else}
    <ul class="m-0 list-none p-0" aria-label={t.title()}>
      {#each rows as row (row.id)}
        <li class="grid grid-cols-[20px_minmax(0,1fr)_auto] {ROW}" data-testid="ai-provider:{row.id}">
          <input
            type="radio"
            name="ai-default-provider"
            class="accent-primary"
            checked={row.isDefault}
            aria-label={t.default_label({ name: row.name })}
            data-testid="ai-provider-default:{row.id}"
            onchange={() => makeDefault(row.id)}
          />
          <div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span class={ROW_THING}>{row.name}</span>
            <span class="min-w-0 {META}">
              {kindLabel(row.kind)} · <code class="font-ed-mono text-[11.5px]">{row.model}</code>
            </span>
          </div>
          <span class="flex items-center justify-end gap-1">
            {#if row.apiKeyConfigured}
              <span class="{CHIP} me-1" data-testid="ai-provider-key:{row.id}">{t.key_configured()}</span>
            {/if}
            <button
              type="button"
              class={BUTTON_SM}
              aria-label={t.edit_label({ name: row.name })}
              data-testid="ai-provider-edit:{row.id}"
              onclick={() => startEdit(row.id)}>{t.edit()}</button
            >
            <button
              type="button"
              class={BUTTON_SM}
              aria-label={t.delete_label({ name: row.name })}
              data-testid="ai-provider-delete:{row.id}"
              onclick={() => (confirmDelete = row.id)}>{t.delete()}</button
            >
          </span>
          <p class="col-start-2 col-end-4 m-0 -mt-0.5 pb-1 {META}" data-testid="ai-provider-egress:{row.id}">
            {#if row.isDefault}<span class="font-medium text-base-content">{t.default()}</span> ·
            {/if}{t.egress({ name: row.name, host: row.host })}
          </p>
          {#if confirmDelete === row.id}
            <div role="alert" class="col-start-2 col-end-4 flex flex-wrap items-center gap-2 pb-2 text-xs text-base-content">
              <span>{t.delete_confirm({ name: row.name })}</span>
              <button
                type="button"
                class="inline-flex h-[22px] items-center rounded-md bg-error px-2 text-[11.5px] font-medium text-error-content"
                data-testid="ai-provider-delete-confirm:{row.id}"
                onclick={() => remove(row.id)}>{t.delete_yes()}</button
              >
              <button type="button" class={BUTTON_SM} onclick={() => (confirmDelete = null)}>{$LL.common.cancel()}</button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if editing !== null}
    <form
      novalidate
      class="{CARD} mt-3 space-y-3 p-3"
      data-testid="ai-provider-form"
      aria-labelledby="ai-provider-form-title"
      onsubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <h4 id="ai-provider-form-title" class="m-0 {EYEBROW}">
        {editingRow ? t.edit_title({ name: editingRow.name }) : t.add_title()}
      </h4>
      <Field name="name" errors={form.errorsFor('name')} required>
        <TextControl
          label={t.field.name()}
          bind:value={form.data.name}
          onblur={() => form.touch('name')}
          placeholder={t.field.name_placeholder()}
          testid="ai-provider-name"
        />
        <FieldErrors />
      </Field>
      <label class="block">
        <span class="block text-[13px] font-medium text-base-content">{t.field.kind()}</span>
        <select
          class={selectCls}
          data-testid="ai-provider-kind"
          value={form.data.kind}
          onchange={(e) => changeKind(e.currentTarget.value as ProviderKind)}
        >
          {#each PROVIDER_KINDS as kind (kind)}
            <option value={kind}>{kindLabel(kind)}</option>
          {/each}
        </select>
      </label>
      <Field name="baseUrl" errors={form.errorsFor('baseUrl')} required={form.data.kind === 'openai-compatible'}>
        <TextControl
          label={t.field.base_url()}
          mono
          bind:value={form.data.baseUrl}
          onblur={() => form.touch('baseUrl')}
          placeholder={form.data.kind === 'openai-compatible' ? 'http://localhost:11434/v1' : ''}
          testid="ai-provider-base-url"
        />
        <Description>
          {form.data.kind === 'openai-compatible' ? t.field.base_url_hint_compatible() : t.field.base_url_hint()}
        </Description>
        <FieldErrors />
      </Field>
      <Field name="model" errors={form.errorsFor('model')} required>
        <TextControl
          label={t.field.model()}
          mono
          bind:value={form.data.model}
          onblur={() => form.touch('model')}
          placeholder={t.field.model_placeholder()}
          testid="ai-provider-model"
        />
        <FieldErrors />
      </Field>
      <Field name="apiKey" errors={form.errorsFor('apiKey')}>
        <TextControl
          label={t.field.api_key()}
          mono
          type="password"
          autocomplete="off"
          bind:value={form.data.apiKey}
          testid="ai-provider-key"
        />
        <Description>
          {#if editingRow?.apiKeyConfigured}{t.field.api_key_keep()}{' '}{/if}{#if form.data.kind === 'openai-compatible'}{t
              .field.api_key_optional()}{' '}{/if}{t.field.api_key_where()}
        </Description>
        <FieldErrors />
      </Field>
      <div class="grid grid-cols-1 gap-3 @md:grid-cols-2">
        <Field name="timeoutSec" errors={form.errorsFor('timeoutSec')}>
          <TextControl
            label={t.field.timeout()}
            inputmode="numeric"
            bind:value={form.data.timeoutSec}
            onblur={() => form.touch('timeoutSec')}
            testid="ai-provider-timeout"
          />
          <Description>{t.field.timeout_hint()}</Description>
          <FieldErrors />
        </Field>
        <Field name="maxTokens" errors={form.errorsFor('maxTokens')}>
          <TextControl
            label={t.field.max_tokens()}
            inputmode="numeric"
            bind:value={form.data.maxTokens}
            onblur={() => form.touch('maxTokens')}
            testid="ai-provider-max-tokens"
          />
          <Description>{t.field.max_tokens_hint()}</Description>
          <FieldErrors />
        </Field>
      </div>

      {#if result}
        <p
          role="status"
          class="m-0 text-xs {result.ok ? 'text-base-content' : 'text-error'}"
          data-testid="ai-provider-test-result"
          data-ok={result.ok}
        >
          {connectionText(result)}
        </p>
      {/if}
      {#if form.formError}
        <p role="alert" class="m-0 text-xs text-error">{form.formError}</p>
      {/if}

      <div class="flex flex-wrap items-center gap-2">
        <button type="submit" class={BUTTON_PRIMARY} data-testid="ai-provider-save" disabled={form.busy}>
          {$LL.web.ai.providers.save()}
        </button>
        <button
          type="button"
          class={BUTTON}
          data-testid="ai-provider-test"
          disabled={testing || !form.valid}
          onclick={() => void test()}
        >
          {testing ? t.testing() : t.test()}
        </button>
        <button type="button" class={BUTTON} data-testid="ai-provider-cancel" onclick={close}>
          {$LL.common.cancel()}
        </button>
      </div>
    </form>
  {/if}

</section>
