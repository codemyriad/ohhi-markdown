<script lang="ts">
  /**
   * Settings › AI › Providers (writing-harness-shaping B1): the list of model
   * endpoints, an add/edit form on the shell's form-field pattern, *Test
   * connection*, the default, delete with a confirm — and, per provider, the
   * egress line saying where referenced text goes. The key is write-only:
   * the form never holds the stored one, an empty key field keeps it.
   *
   * Every rule lives in `ai-providers.ts`; this file is the markup.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { ProviderKind } from '@ohhi/harness'
  import Description from '../ui/Description.svelte'
  import Field from '../ui/Field.svelte'
  import FieldErrors from '../ui/FieldErrors.svelte'
  import TextControl from '../ui/TextControl.svelte'
  import { createForm } from '../ui/form.svelte.js'
  import { CARD, HEADING, OUTLINE_BUTTON } from '../ui/styles.js'
  import { aiConfig } from '../config.js'
  import {
    PROVIDER_KINDS,
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

  const smallBtn = `${OUTLINE_BUTTON} px-2 py-0.5 text-xs font-medium text-base-content/80 disabled:opacity-50`
  const primaryBtn =
    'rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content hover:bg-primary/90 disabled:opacity-50'
  const selectCls =
    'mt-1 w-full rounded border border-base-300 bg-base-100 px-2 py-2 text-sm focus:border-primary focus:outline-none'
</script>

<section data-testid="ai-providers" aria-labelledby="ai-providers-title" class="space-y-3">
  <div class="flex items-center justify-between gap-2">
    <h3 id="ai-providers-title" class="m-0 {HEADING}">{t.title()}</h3>
    {#if editing === null}
      <button type="button" class={smallBtn} data-testid="ai-provider-add" onclick={startAdd}>{t.add()}</button>
    {/if}
  </div>
  <p class="m-0 text-xs text-base-content/70">{t.intro()}</p>

  {#if rows.length === 0}
    <p class="m-0 text-sm text-base-content/80" data-testid="ai-providers-empty">{t.empty()}</p>
  {:else}
    <ul class="m-0 list-none space-y-2 p-0" aria-label={t.title()}>
      {#each rows as row (row.id)}
        <li class="{CARD} p-3" data-testid="ai-provider:{row.id}">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <label class="flex items-center gap-1.5 text-xs text-base-content/80">
              <input
                type="radio"
                name="ai-default-provider"
                checked={row.isDefault}
                aria-label={t.default_label({ name: row.name })}
                data-testid="ai-provider-default:{row.id}"
                onchange={() => makeDefault(row.id)}
              />
              {#if row.isDefault}{t.default()}{/if}
            </label>
            <span class="text-sm font-semibold text-base-content">{row.name}</span>
            <span class="text-xs text-base-content/80">{kindLabel(row.kind)}</span>
            <span class="font-ed-mono text-xs text-base-content/80">{row.model}</span>
            {#if row.apiKeyConfigured}
              <span
                class="rounded bg-base-200 px-1.5 py-0.5 text-[11px] text-base-content"
                data-testid="ai-provider-key:{row.id}">{t.key_configured()}</span
              >
            {/if}
            <span class="ml-auto flex gap-1.5">
              <button
                type="button"
                class={smallBtn}
                aria-label={t.edit_label({ name: row.name })}
                data-testid="ai-provider-edit:{row.id}"
                onclick={() => startEdit(row.id)}>{t.edit()}</button
              >
              <button
                type="button"
                class={smallBtn}
                aria-label={t.delete_label({ name: row.name })}
                data-testid="ai-provider-delete:{row.id}"
                onclick={() => (confirmDelete = row.id)}>{t.delete()}</button
              >
            </span>
          </div>
          <p class="m-0 mt-1 text-xs text-base-content/70" data-testid="ai-provider-egress:{row.id}">
            {t.egress({ name: row.name, host: row.host })}
          </p>
          {#if confirmDelete === row.id}
            <div role="alert" class="mt-2 flex flex-wrap items-center gap-2 text-xs text-base-content">
              <span>{t.delete_confirm({ name: row.name })}</span>
              <button
                type="button"
                class="rounded bg-error px-2 py-0.5 text-xs font-medium text-error-content"
                data-testid="ai-provider-delete-confirm:{row.id}"
                onclick={() => remove(row.id)}>{t.delete_yes()}</button
              >
              <button type="button" class={smallBtn} onclick={() => (confirmDelete = null)}>{$LL.common.cancel()}</button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if editing !== null}
    <form
      novalidate
      class="{CARD} space-y-3 p-3"
      data-testid="ai-provider-form"
      aria-labelledby="ai-provider-form-title"
      onsubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <h4 id="ai-provider-form-title" class="m-0 {HEADING}">
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
        <span class="block text-xs font-semibold tracking-wide text-base-content/70 uppercase">{t.field.kind()}</span>
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
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        <button type="submit" class={primaryBtn} data-testid="ai-provider-save" disabled={form.busy}>
          {$LL.web.ai.providers.save()}
        </button>
        <button
          type="button"
          class="{smallBtn} py-1.5"
          data-testid="ai-provider-test"
          disabled={testing || !form.valid}
          onclick={() => void test()}
        >
          {testing ? t.testing() : t.test()}
        </button>
        <button type="button" class="{smallBtn} py-1.5" data-testid="ai-provider-cancel" onclick={close}>
          {$LL.common.cancel()}
        </button>
      </div>
    </form>
  {/if}

  <details class="text-xs text-base-content/80" data-testid="ai-providers-local-help">
    <summary class="cursor-pointer font-semibold">{t.local_help_title()}</summary>
    <p class="m-0 mt-1">{t.local_help({ origin })}</p>
  </details>
</section>
