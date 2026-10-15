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
   *
   * QA round 1 (QA3): the second group of Settings › AI, inline. The eyebrow
   * row carries *New skill…* and *Import…*; each skill is a row — its switch,
   * its name and shape, the trust and scripts chips, one verb (*Review…* for
   * one that needs it, else *Open*) — with what it needs said under it.
   */
  import { z } from 'zod'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import Field from '../ui/Field.svelte'
  import CheckControl from '../ui/CheckControl.svelte'
  import Description from '../ui/Description.svelte'
  import FieldErrors from '../ui/FieldErrors.svelte'
  import TextControl from '../ui/TextControl.svelte'
  import { createForm } from '../ui/form.svelte.js'
  import {
    BUTTON,
    BUTTON_PRIMARY,
    BUTTON_SM,
    CARD,
    CHIP,
    EYEBROW,
    GROUP_ROW,
    META,
    ROW,
    ROW_SETTING,
  } from '../ui/styles.js'
  import { isTauri } from '../platform.js'
  import { getViewShell } from '../views.js'
  import { isValidSkillName } from '@ohhi/harness/skills'
  import { currentSkills, problemText, type SkillRow, type SkillsStore } from '../skills.svelte.js'
  import { pickLocalSkillFolder, type ImportCandidate } from '../skill-import.js'
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
  let reviewing = $state<(ImportCandidate & { hash?: string }) | null>(null)
  let status = $state('')

  $effect(() => {
    void store?.refresh()
  })

  // svelte-ignore state_referenced_locally -- the rule's words are built once per panel
  const schema = z.object({
    name: z
      .string()
      .trim()
      .refine(isValidSkillName, $LL.web.ai.skills.create.name_invalid())
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

  /** A trust chip that needs you is the warning colour's ink on the base, never a filled block. */
  const CHIP_WARN = `${CHIP} border-warning text-base-content`
</script>

<section data-testid="ai-skills" aria-labelledby="ai-skills-title">
  <div class={GROUP_ROW}>
    <h3 id="ai-skills-title" class="m-0 {EYEBROW}">{t.list()}</h3>
    {#if store}
      <span class="ms-auto flex gap-1.5">
        <button
          type="button"
          data-testid="ai-skills-new"
          onclick={() => (creating = !creating)}
          aria-expanded={creating}
          class={BUTTON}
        >
          {t.new()}
        </button>
        <button type="button" data-testid="ai-skills-import" onclick={() => (importing = true)} class={BUTTON}>
          {t.import()}
        </button>
      </span>
    {/if}
  </div>
  <p class="m-0 mb-2 {META}">{t.intro()}</p>

  {#if !store}
    <p class="m-0 rounded-lg border border-dashed border-base-300 px-3 py-2.5 text-[13px] text-base-content" data-testid="ai-skills-no-vault">
      {t.no_vault()}
    </p>
  {:else}
    {#if creating}
      <form
        class="{CARD} mb-3 space-y-2 p-3"
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
          <button type="button" onclick={() => (creating = false)} class={BUTTON}>
            {t.create.cancel()}
          </button>
          <button type="submit" data-testid="ai-skills-create-submit" disabled={form.busy} class={BUTTON_PRIMARY}>
            {t.create.submit()}
          </button>
        </div>
      </form>
    {/if}

    {#if store.ready && store.rows.length === 0}
      <p class="m-0 text-[13px] text-base-content" data-testid="ai-skills-empty">{t.empty()}</p>
    {:else}
      <ul class="m-0 list-none p-0" aria-label={t.list()} data-testid="ai-skills-list">
        {#each store.rows as row (row.id)}
          <li class="grid grid-cols-[20px_minmax(0,1fr)_auto] {ROW}" data-testid="ai-skill:{row.id}">
            <!-- Only a reviewed, valid skill can be switched on. -->
            <input
              type="checkbox"
              class="accent-primary"
              aria-label={t.enabled({ name: row.meta.name })}
              checked={row.enabled && row.trusted}
              disabled={!row.trusted || !row.valid}
              data-testid="ai-skill-enabled:{row.id}"
              onchange={(e) => void store.setEnabled(row.id, e.currentTarget.checked)}
            />
            <div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span class="font-ed-mono {ROW_SETTING} font-semibold">{row.meta.name}</span>
              {#if shape(row)}
                <span class={META} data-testid="ai-skill-shape:{row.id}">{shape(row)}</span>
              {/if}
            </div>
            <span class="flex flex-wrap items-center justify-end gap-1">
              {#if !row.valid}
                <span class="{CHIP} border-error text-error" data-testid="ai-skill-invalid:{row.id}">{t.invalid()}</span>
              {/if}
              {#if row.meta.hasScripts}
                <span class={CHIP} data-testid="ai-skill-scripts:{row.id}">{t.scripts()}</span>
              {/if}
              <span class={row.trusted ? CHIP : CHIP_WARN} data-testid="ai-skill-trust:{row.id}" data-trusted={row.trusted}>
                {row.trusted ? t.trusted() : t.untrusted()}
              </span>
              {#if !row.trusted}
                <button
                  type="button"
                  data-testid="ai-skill-review:{row.id}"
                  onclick={() => void review(row)}
                  class="{BUTTON_SM} ms-1"
                >
                  {t.review()}
                </button>
              {:else if shell}
                <button
                  type="button"
                  data-testid="ai-skill-open:{row.id}"
                  aria-label={t.open({ name: row.meta.name })}
                  onclick={() => shell.openPath(`${row.meta.dir}/SKILL.md`)}
                  class="{BUTTON_SM} ms-1"
                >
                  {t.open_short()}
                </button>
              {/if}
            </span>
            <div class="col-start-2 col-end-4 -mt-0.5 space-y-0.5 pb-1">
              <p class="m-0 {META}">{row.meta.description}</p>
              {#if !row.trusted}
                <p class="m-0 {META}">{t.untrusted_hint()}</p>
              {/if}
              {#if row.meta.hasScripts}
                <p class="m-0 {META}">{t.scripts_hint()}</p>
              {/if}
              {#if row.meta.problems.length > 0}
                <ul class="m-0 list-disc pl-5 text-xs text-error" data-testid="ai-skill-problems:{row.id}">
                  {#each row.meta.problems as code (code)}
                    <li>{problemText(code)}</li>
                  {/each}
                </ul>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <section aria-labelledby="ai-skills-farm-title" class="mt-3 space-y-1 border-t border-base-200 pt-2">
      <h4 id="ai-skills-farm-title" class="sr-only">{t.farm.title()}</h4>
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
          <p class="m-0 {META}" data-testid="ai-skills-farm-result">
            {t.farm.result({ written: store.farm.last.written.length + store.farm.last.linked.length, blocked: store.farm.last.blocked.length })}
          </p>
        {/if}
        {#if store.farm.error}
          <p class="m-0 text-xs text-error" role="alert">{t.farm.failed({ message: store.farm.error })}</p>
        {/if}
      {:else}
        <p class="m-0 {META}" data-testid="ai-skills-farm-unavailable">
          {onDesktop ? t.farm.unavailable() : t.farm.browser()}
        </p>
      {/if}
    </section>

    {#if status}
      <p class="m-0 mt-2 {META}" role="status" data-testid="ai-skills-status">{status}</p>
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
