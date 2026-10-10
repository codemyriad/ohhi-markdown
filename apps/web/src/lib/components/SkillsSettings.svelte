<script lang="ts">
  /**
   * Settings › AI › Skills (writing-harness-shaping B9): the vault's
   * `.agents/skills/`, with this device's trust and enabled state.
   *
   * Each skill: name, description, what it takes and gives (`ohhi-kind /
   * -input / -output`), a trust badge, the scripts badge, its problems in
   * words, an enabled switch (only a reviewed, valid skill can be enabled),
   * *Open* (SKILL.md is markdown — it opens in a tab, edited like any note)
   * and, for one that arrived by sync, *Review…*. *New skill…* writes the
   * spec's template and opens it; *Import…* is the review-first import.
   * *Export for Claude Code* is the `.claude/skills/` farm — desktop only;
   * in the browser it says why there is nothing to export.
   *
   * The store is the open vault's (`currentSkills()`); a test hands one in.
   */
  import { z } from 'zod'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import Field from '../ui/Field.svelte'
  import CheckControl from '../ui/CheckControl.svelte'
  import Description from '../ui/Description.svelte'
  import FieldErrors from '../ui/FieldErrors.svelte'
  import TextControl from '../ui/TextControl.svelte'
  import { createForm } from '../ui/form.svelte.js'
  import { CARD, FACT, HEADING, OUTLINE_BUTTON } from '../ui/styles.js'
  import { isTauri } from '../platform.js'
  import { getViewShell } from '../views.js'
  import {
    currentSkills,
    pickLocalSkillFolder,
    problemText,
    validSkillName,
    type ImportCandidate,
    type SkillRow,
    type SkillsStore,
  } from '../skills.svelte.js'
  import SkillImportDialog from './SkillImportDialog.svelte'

  interface Props {
    /** The open vault's skills; `currentSkills()` when not given. */
    skills?: SkillsStore | null
    /** Desktop (a disk Claude Code reads); `isTauri()` when not given. */
    desktop?: boolean
    /** Injected for tests: the import dialog's `fetch` and folder picker. */
    fetchImpl?: typeof fetch
    pickFolder?: (() => Promise<ImportCandidate | null>) | null
  }

  let { skills, desktop, fetchImpl, pickFolder }: Props = $props()

  const store = $derived(skills === undefined ? currentSkills() : skills)
  const onDesktop = $derived(desktop ?? isTauri())
  const folderPicker = $derived(pickFolder === undefined ? (onDesktop ? pickLocalSkillFolder : null) : pickFolder)
  const shell = getViewShell()
  const t = $derived($LL.web.ai.skills)

  let creating = $state(false)
  let importing = $state(false)
  let reviewing = $state<ImportCandidate | null>(null)
  let status = $state('')

  $effect(() => {
    void store?.refresh()
  })

  // svelte-ignore state_referenced_locally -- the rule's words are built once per panel
  const schema = z.object({
    name: z
      .string()
      .trim()
      .refine(validSkillName, $LL.web.ai.skills.create.name_invalid())
      .refine((n) => !store?.rows.some((r) => r.id === n), $LL.web.ai.skills.create.name_taken()),
  })
  const form = createForm(schema, { name: '' })

  async function create(): Promise<void> {
    if (!store) return
    const ok = await form.submit(async ({ name }) => {
      const path = await store.create(name.trim())
      if (!path) throw new Error(t.create.failed())
      shell?.openPath(path)
    })
    if (ok) {
      creating = false
      form.reset()
    }
  }

  async function review(row: SkillRow): Promise<void> {
    reviewing = (await store?.candidate(row.id)) ?? null
  }

  const shape = (row: SkillRow): string | null => {
    const m = row.meta
    if (!m.kind && !m.input && !m.output) return null
    return t.shape({
      kind: m.kind ? t.kind[m.kind]() : t.any(),
      input: m.input ? t.input[m.input]() : t.any(),
      output: m.output ? t.output[m.output === 'new-note' ? 'new_note' : m.output]() : t.any(),
    })
  }

  const BADGE = 'rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase'
</script>

<section data-testid="ai-skills" aria-labelledby="ai-skills-title" class="space-y-3">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h3 id="ai-skills-title" class="m-0 {HEADING}">{t.title()}</h3>
    {#if store}
      <div class="flex gap-2">
        <button
          type="button"
          data-testid="ai-skills-new"
          onclick={() => (creating = !creating)}
          aria-expanded={creating}
          class="{OUTLINE_BUTTON} px-2.5 py-1 text-xs text-base-content"
        >
          {t.new()}
        </button>
        <button
          type="button"
          data-testid="ai-skills-import"
          onclick={() => (importing = true)}
          class="{OUTLINE_BUTTON} px-2.5 py-1 text-xs text-base-content"
        >
          {t.import()}
        </button>
      </div>
    {/if}
  </div>
  <p class="m-0 text-xs text-base-content/80">{t.intro()}</p>

  {#if !store}
    <p class="m-0 text-sm text-base-content/80" data-testid="ai-skills-no-vault">{t.no_vault()}</p>
  {:else}
    {#if creating}
      <form
        class="{CARD} space-y-2 p-3"
        novalidate
        aria-label={t.create.title()}
        data-testid="ai-skills-create"
        onsubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <Field name="name" errors={form.errorsFor('name')} required>
          <TextControl
            label={t.create.name()}
            mono
            bind:value={form.data.name}
            onblur={() => form.touch('name')}
            testid="ai-skills-create-name"
          />
          <Description>{t.create.name_hint()}</Description>
          <FieldErrors />
        </Field>
        {#if form.formError}
          <p class="m-0 text-xs text-error" role="alert">{form.formError}</p>
        {/if}
        <div class="flex justify-end gap-2">
          <button type="button" onclick={() => (creating = false)} class="{OUTLINE_BUTTON} px-3 py-1.5 text-xs text-base-content">
            {t.create.cancel()}
          </button>
          <button
            type="submit"
            data-testid="ai-skills-create-submit"
            disabled={form.busy}
            class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content hover:bg-primary/90 disabled:opacity-50"
          >
            {t.create.submit()}
          </button>
        </div>
      </form>
    {/if}

    {#if store.ready && store.rows.length === 0}
      <p class="m-0 text-sm text-base-content/80" data-testid="ai-skills-empty">{t.empty()}</p>
    {:else}
      <ul class="m-0 list-none space-y-2 p-0" aria-label={t.list()} data-testid="ai-skills-list">
        {#each store.rows as row (row.id)}
          <li class="{CARD} space-y-1.5 p-3" data-testid="ai-skill:{row.id}">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-ed-mono text-sm font-semibold text-base-content">{row.meta.name}</span>
              {#if shape(row)}
                <span class="text-xs text-base-content/80" data-testid="ai-skill-shape:{row.id}">{shape(row)}</span>
              {/if}
              <span class="flex-1"></span>
              {#if !row.valid}
                <span class="{BADGE} bg-error text-error-content" data-testid="ai-skill-invalid:{row.id}">{t.invalid()}</span>
              {/if}
              {#if row.meta.hasScripts}
                <span class="{BADGE} border border-base-300 text-base-content" data-testid="ai-skill-scripts:{row.id}">{t.scripts()}</span>
              {/if}
              <span
                class="{BADGE} {row.trusted ? 'bg-success text-success-content' : 'bg-warning text-warning-content'}"
                data-testid="ai-skill-trust:{row.id}"
                data-trusted={row.trusted}
              >
                {row.trusted ? t.trusted() : t.untrusted()}
              </span>
            </div>
            <p class="m-0 text-xs text-base-content/80">{row.meta.description}</p>
            {#if !row.trusted}
              <p class="m-0 text-xs text-base-content/80">{t.untrusted_hint()}</p>
            {/if}
            {#if row.meta.hasScripts}
              <p class="m-0 text-xs text-base-content/80">{t.scripts_hint()}</p>
            {/if}
            {#if row.meta.problems.length > 0}
              <ul class="m-0 list-disc pl-5 text-xs text-error" data-testid="ai-skill-problems:{row.id}">
                {#each row.meta.problems as code (code)}
                  <li>{problemText(code)}</li>
                {/each}
              </ul>
            {/if}
            <div class="flex flex-wrap items-center gap-3 pt-1">
              <Field name="enabled-{row.id}">
                <CheckControl
                  label={t.enabled({ name: row.meta.name })}
                  checked={row.enabled && row.trusted}
                  disabled={!row.trusted || !row.valid}
                  testid="ai-skill-enabled:{row.id}"
                  onchange={(e) => void store.setEnabled(row.id, e.currentTarget.checked)}
                />
              </Field>
              <span class="flex-1"></span>
              {#if !row.trusted}
                <button
                  type="button"
                  data-testid="ai-skill-review:{row.id}"
                  onclick={() => void review(row)}
                  class="{OUTLINE_BUTTON} px-2.5 py-1 text-xs text-base-content"
                >
                  {t.review()}
                </button>
              {/if}
              {#if shell}
                <button
                  type="button"
                  data-testid="ai-skill-open:{row.id}"
                  onclick={() => shell.openPath(`${row.meta.dir}/SKILL.md`)}
                  class="{OUTLINE_BUTTON} px-2.5 py-1 text-xs text-base-content"
                >
                  {t.open({ name: row.meta.name })}
                </button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <section aria-labelledby="ai-skills-farm-title" class="space-y-1 pt-1">
      <h4 id="ai-skills-farm-title" class="m-0 {FACT}">{t.farm.title()}</h4>
      {#if store.farm.available}
        <Field name="farm">
          <CheckControl
            label={t.farm.label()}
            checked={store.farm.enabled}
            testid="ai-skills-farm"
            onchange={(e) => void store.setFarm(e.currentTarget.checked)}
          />
          <Description>{t.farm.hint()}</Description>
        </Field>
        {#if store.farm.last}
          <p class="m-0 text-xs text-base-content/80" data-testid="ai-skills-farm-result">
            {t.farm.result({ written: store.farm.last.written.length + store.farm.last.linked.length, blocked: store.farm.last.blocked.length })}
          </p>
        {/if}
        {#if store.farm.error}
          <p class="m-0 text-xs text-error" role="alert">{t.farm.failed({ message: store.farm.error })}</p>
        {/if}
      {:else}
        <p class="m-0 text-xs text-base-content/80" data-testid="ai-skills-farm-unavailable">
          {onDesktop ? t.farm.unavailable() : t.farm.browser()}
        </p>
      {/if}
    </section>

    {#if status}
      <p class="m-0 text-xs text-base-content/80" role="status" data-testid="ai-skills-status">{status}</p>
    {/if}

    {#if importing || reviewing}
      <SkillImportDialog
        {store}
        review={reviewing}
        pickFolder={reviewing ? null : folderPicker}
        {fetchImpl}
        onDone={(message) => (status = message)}
        onClose={() => {
          importing = false
          reviewing = null
        }}
      />
    {/if}
  {/if}
</section>
