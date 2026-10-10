<script lang="ts">
  /**
   * Import a skill, or review one that arrived by sync (writing-harness B9,
   * research note harness-skills §4 — show before enable). Nothing is written
   * and nothing is trusted until *Trust and enable*: the review pane shows
   * SKILL.md verbatim, every file, the pre-approved tools, every link, the
   * scripts warning and the loader's problems, because a skill is
   * instructions an agent will follow.
   *
   * Import sources: a GitHub `owner/repo/path` or a `github.com/…/tree/…`
   * link (fetched through the contents API, pinned to the commit), or — on
   * desktop — a local folder. `review` skips straight to the pane for a skill
   * already in the vault.
   */
  import { z } from 'zod'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import Dialog from '../ui/Dialog.svelte'
  import Description from '../ui/Description.svelte'
  import Field from '../ui/Field.svelte'
  import FieldErrors from '../ui/FieldErrors.svelte'
  import TextControl from '../ui/TextControl.svelte'
  import { createForm } from '../ui/form.svelte.js'
  import { CARD, FACT, OUTLINE_BUTTON } from '../ui/styles.js'
  import {
    fetchGithubSkill,
    importErrorText,
    parseGithubSource,
    problemText,
    reviewOf,
    type ImportCandidate,
    type SkillsStore,
  } from '../skills.svelte.js'

  interface Props {
    store: Pick<SkillsStore, 'rows' | 'install' | 'trust'>
    /** A skill already in the vault: review it, then trust it in place. */
    review?: ImportCandidate | null
    /** Desktop: pick a local folder. Absent in the browser. */
    pickFolder?: (() => Promise<ImportCandidate | null>) | null
    /** Injected for tests; the global `fetch` otherwise. */
    fetchImpl?: typeof fetch
    onClose: () => void
    /** After a skill was trusted: what to say. */
    onDone?: (message: string) => void
  }

  let { store, review = null, pickFolder = null, fetchImpl, onClose, onDone }: Props = $props()

  const t = $derived($LL.web.ai.skills.import_dialog)

  // svelte-ignore state_referenced_locally -- the review target is fixed for the dialog's life
  let candidate = $state<ImportCandidate | null>(review)
  let error = $state('')
  let busy = $state(false)

  // svelte-ignore state_referenced_locally -- the rule's words are built once per dialog
  const schema = z.object({
    source: z.string().trim().refine((s) => parseGithubSource(s) !== null, $LL.web.ai.skills.import_dialog.bad_source()),
  })
  const form = createForm(schema, { source: '' })

  const reviewing = $derived(candidate ? reviewOf(candidate) : null)
  const exists = $derived(!review && !!candidate && store.rows.some((r) => r.id === candidate!.name))

  async function fetchSource(): Promise<void> {
    error = ''
    await form.submit(async ({ source }) => {
      const src = parseGithubSource(source)
      if (!src) return
      try {
        candidate = await fetchGithubSkill(src, fetchImpl)
      } catch (err) {
        error = importErrorText(err)
      }
    })
  }

  async function chooseFolder(): Promise<void> {
    if (!pickFolder) return
    error = ''
    busy = true
    try {
      candidate = (await pickFolder()) ?? candidate
    } catch (err) {
      error = importErrorText(err)
    } finally {
      busy = false
    }
  }

  async function trust(): Promise<void> {
    if (!candidate) return
    error = ''
    busy = true
    try {
      if (review) await store.trust(candidate.name)
      else await store.install(candidate)
      onDone?.(t.imported({ name: candidate.name }))
      onClose()
    } catch (err) {
      error = importErrorText(err)
    } finally {
      busy = false
    }
  }
</script>

<Dialog
  title={reviewing ? t.review_title({ name: reviewing.name }) : t.title()}
  description={t.description()}
  testid="skill-import-dialog"
  width="lg"
  {onClose}
>
  {#if !reviewing}
    <form
      class="space-y-3"
      novalidate
      onsubmit={(e) => {
        e.preventDefault()
        void fetchSource()
      }}
    >
      <Field name="source" errors={form.errorsFor('source')} required>
        <TextControl
          label={t.source()}
          mono
          bind:value={form.data.source}
          onblur={() => form.touch('source')}
          placeholder={t.source_placeholder()}
          testid="skill-import-source"
        />
        <Description>{t.source_hint()}</Description>
        <FieldErrors />
      </Field>
      <div class="flex flex-wrap justify-end gap-2">
        {#if pickFolder}
          <button
            type="button"
            data-testid="skill-import-folder"
            disabled={busy}
            onclick={() => void chooseFolder()}
            class="{OUTLINE_BUTTON} px-3 py-1.5 text-xs text-base-content disabled:opacity-50"
          >
            {t.folder()}
          </button>
        {/if}
        <button
          type="submit"
          data-testid="skill-import-fetch"
          disabled={form.busy}
          class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content hover:bg-primary/90 disabled:opacity-50"
        >
          {form.busy ? t.fetching() : t.fetch()}
        </button>
      </div>
    </form>
  {:else}
    <div class="space-y-3 text-sm" data-testid="skill-review">
      {#if reviewing.meta.hasScripts}
        <p class="m-0 rounded border border-warning px-3 py-2 text-xs text-base-content" data-testid="skill-review-scripts">
          {t.scripts()}
        </p>
      {/if}
      {#if exists}
        <p class="m-0 text-xs text-error" role="alert" data-testid="skill-review-exists">{t.exists({ name: reviewing.name })}</p>
      {/if}
      {#if reviewing.meta.problems.length > 0}
        <section aria-label={t.problems()}>
          <h4 class="m-0 {FACT}">{t.problems()}</h4>
          <ul class="m-0 mt-1 list-disc pl-5 text-xs text-error" data-testid="skill-review-problems">
            {#each reviewing.meta.problems as code (code)}
              <li>{problemText(code)}</li>
            {/each}
          </ul>
        </section>
      {/if}
      {#if reviewing.allowedTools}
        <p class="m-0 text-xs text-base-content/80" data-testid="skill-review-tools">
          {t.allowed_tools({ tools: reviewing.allowedTools })}
        </p>
      {/if}
      {#if candidate?.sha}
        <p class="m-0 font-ed-mono text-[11px] text-base-content/80" data-testid="skill-review-sha">
          {t.pinned({ sha: candidate.sha.slice(0, 12) })}
        </p>
      {/if}

      <section aria-label={t.instructions()}>
        <h4 class="m-0 {FACT}">{t.instructions()}</h4>
        <pre
          class="{CARD} m-0 mt-1 max-h-64 overflow-auto p-3 font-ed-mono text-[11px] whitespace-pre-wrap text-base-content"
          data-testid="skill-review-skillmd">{reviewing.skillMd}</pre>
      </section>

      <section aria-label={t.files()}>
        <h4 class="m-0 {FACT}">{t.files()}</h4>
        <ul class="m-0 mt-1 list-none p-0 font-ed-mono text-[11px] text-base-content" data-testid="skill-review-files">
          {#each reviewing.files as file (file.rel)}
            <li>{file.rel}</li>
          {/each}
        </ul>
        {#if reviewing.binaryCount > 0}
          <p class="m-0 mt-1 text-xs text-base-content/80">{t.binary_skipped({ count: reviewing.binaryCount })}</p>
        {/if}
      </section>

      <section aria-label={t.urls()}>
        <h4 class="m-0 {FACT}">{t.urls()}</h4>
        {#if reviewing.urls.length === 0}
          <p class="m-0 mt-1 text-xs text-base-content/80">{t.urls_none()}</p>
        {:else}
          <ul class="m-0 mt-1 list-none p-0 font-ed-mono text-[11px] break-all text-base-content" data-testid="skill-review-urls">
            {#each reviewing.urls as url (url)}
              <li>{url}</li>
            {/each}
          </ul>
        {/if}
      </section>

      <div class="flex justify-end gap-2">
        <button
          type="button"
          data-testid="skill-import-cancel"
          onclick={onClose}
          class="{OUTLINE_BUTTON} px-3 py-1.5 text-xs text-base-content"
        >
          {t.cancel()}
        </button>
        <button
          type="button"
          data-testid="skill-import-trust"
          disabled={busy || exists}
          onclick={() => void trust()}
          class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content hover:bg-primary/90 disabled:opacity-50"
        >
          {t.trust()}
        </button>
      </div>
    </div>
  {/if}

  {#if error}
    <p class="mt-2 text-xs text-error" role="alert" data-testid="skill-import-error">{error}</p>
  {/if}
</Dialog>
