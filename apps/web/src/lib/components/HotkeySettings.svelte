<script lang="ts">
  /**
   * Settings › Keys (tab-groups R1.3; quiet-shell F10): every registered
   * command, the key in force under the ACTIVE keymap file, and a field to
   * change it. Edits are a draft (`hotkey-draft.svelte.ts`, owned by the
   * dialog so a tab switch keeps them); Save writes the keymap file; the
   * built-in `default` is read-only, so it offers *Save as*.
   */
  import { onMount } from 'svelte'
  import { TriangleAlert } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { escapeHtml } from '../html.js'
  import { parseBinding, type CommandBinding, type CommandRegistry } from '../commands.js'
  import { BUILTIN_KEYMAPS } from '../keymap-spec.js'
  import { choiceOf, savableName } from '../resource-kind.js'
  import type { Keymap } from '../keymap.svelte.js'
  import type { HotkeyDraft } from '../hotkey-draft.svelte.js'
  import type { Resources } from '../resources.svelte.js'
  import Description from '../ui/Description.svelte'
  import Field from '../ui/Field.svelte'
  import FieldErrors from '../ui/FieldErrors.svelte'
  import TextControl from '../ui/TextControl.svelte'

  interface Props {
    registry: CommandRegistry
    draft: HotkeyDraft
    keymap?: Pick<Keymap, 'active' | 'resolved' | 'legacy' | 'setActive'>
    resources?: Partial<Pick<Resources, 'keymaps' | 'refreshKeymaps'>>
    /** False with no vault open: a keymap is a file inside one. */
    canSave: boolean
    /** The row recording a chord, if any (Escape in the field cancels it). */
    recording?: string | null
  }

  let { registry, draft, keymap, resources, canSave, recording = $bindable(null) }: Props = $props()

  const t = $derived($LL.web.settings.hotkeys)
  const code = (text: string): string => `<code class="font-ed-mono">${escapeHtml(text)}</code>`
  const EXAMPLE_BINDING = 'Mod+Shift+P'

  onMount(() => void resources?.refreshKeymaps?.())

  /** The rows under the draft — recomputed when the draft or the keymap changes. */
  const rows = $derived.by(() => {
    void draft.preview
    return draft.rows()
  })

  /** What the user has typed per row; re-seeded from the rows whenever they change. */
  let drafts = $state<Record<string, string>>({})
  let errors = $state<Record<string, string>>({})
  $effect(() => {
    drafts = Object.fromEntries(rows.map((row) => [row.id, row.chords.join(', ')]))
  })

  /** Commands in registration order, bucketed by their palette group. */
  const groups = $derived.by(() => {
    const out: { label: string; rows: CommandBinding[] }[] = []
    for (const row of rows) {
      const label = row.group || t.ungrouped()
      const bucket = out.find((b) => b.label === label)
      if (bucket) bucket.rows.push(row)
      else out.push({ label, rows: [row] })
    }
    return out
  })

  /** Command titles as one phrase — the dictionary owns the sentence around it. */
  const list = (titles: string[]): string => titles.join(', ')

  /** `Mod+K, Alt+K` → two chords. A comma followed by a space separates; `Mod+,` stays one. */
  const chordsOf = (typed: string): string[] =>
    typed
      .split(/,\s+/)
      .map((c) => c.trim())
      .filter(Boolean)

  function commit(row: CommandBinding): void {
    const chords = chordsOf((drafts[row.id] ?? '').trim())
    if (chords.some((c) => !parseBinding(c))) {
      errors[row.id] = t.invalid({ example: EXAMPLE_BINDING })
      return
    }
    errors[row.id] = ''
    draft.set(row, chords)
  }

  function resetRow(row: CommandBinding): void {
    errors[row.id] = ''
    draft.reset(row.id)
  }

  // ---- recording a chord ----
  const fields = $state<Record<string, HTMLElement | undefined>>({})

  function startRecording(row: CommandBinding): void {
    errors[row.id] = ''
    recording = row.id
    // Global hotkeys are handled in the capture phase, so without this the
    // chord being recorded would ALSO run whatever it is currently bound to.
    registry.setSuspended(true)
    queueMicrotask(() => fields[row.id]?.querySelector('input')?.focus())
  }

  function stopRecording(): void {
    recording = null
    registry.setSuspended(false)
  }

  // The tab unmounts on a tab switch: never leave the registry suspended.
  $effect(() => () => registry.setSuspended(false))

  function onRecordKey(row: CommandBinding, e: KeyboardEvent): void {
    // Tab is how a keyboard user leaves the field; it must never be recorded.
    if (e.key === 'Tab') {
      stopRecording()
      return
    }
    // Escape cancels the recording and changes nothing (Settings is a view
    // tab now, so there is no dialog for it to close).
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      stopRecording()
      return
    }
    e.preventDefault()
    e.stopPropagation()
    const binding = registry.bindingFor(e)
    if (!binding) return // modifiers only — the user is still reaching
    drafts[row.id] = binding
    stopRecording()
    commit(row)
  }

  // ---- the keymap file ----
  const entry = $derived(keymap?.resolved?.entry ?? null)
  const source = $derived.by(() => {
    if (!keymap || keymap.legacy) return t.legacy()
    if (!entry) return keymap.resolved?.error ? t.fallback({ error: keymap.resolved.error }) : t.from_builtin()
    if (entry.root === 'builtin') return t.from_builtin()
    return entry.root === 'vault' ? t.from_vault({ path: entry.path }) : t.from_user({ path: entry.path })
  })

  let saveName = $state('')
  const nameOk = $derived(savableName(saveName.trim(), BUILTIN_KEYMAPS))
  /** Nothing can be saved over a keymap that did not resolve: the file would not either. */
  const blocked = $derived(draft.unresolved !== null)
  let savedPath = $state('')
  let saveError = $state('')

  async function save(asNew: boolean): Promise<void> {
    saveError = ''
    try {
      savedPath = await draft.save(asNew ? saveName.trim() : undefined)
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err)
    }
  }
</script>

<section data-testid="settings-hotkeys">
  <p class="text-xs text-base-content/70">{t.intro()}</p>
  <p class="mt-1 text-xs text-base-content/70">
    {@html t.syntax({ example: code(EXAMPLE_BINDING), mod: code('Mod') })}
  </p>

  {#if keymap}
    <div class="mt-3 flex flex-wrap items-end gap-2" data-testid="keymap-file">
      <label class="block">
        <span class="text-xs text-base-content/80">{t.keymap()}</span>
        <select
          data-testid="keymap-pick"
          value={keymap.legacy ? '' : keymap.active}
          disabled={draft.dirty}
          onchange={(e) => void keymap.setActive(e.currentTarget.value as typeof keymap.active)}
          class="mt-1 block rounded border border-base-300 bg-base-100 px-2 py-1 text-xs focus:border-primary focus:outline-none"
        >
          {#each resources?.keymaps ?? [] as option (option.name)}
            <option value={choiceOf(option, BUILTIN_KEYMAPS)}>{option.name}</option>
          {/each}
        </select>
      </label>
      <span class="min-w-0 flex-1 text-xs text-base-content/70" data-testid="keymap-from">{source}</span>
    </div>

    <div class="mt-2 flex flex-wrap items-end gap-2" data-testid="keymap-save-row">
      {#if draft.writable}
        <button
          type="button"
          data-testid="keymap-save"
          disabled={!draft.dirty || !canSave}
          onclick={() => void save(false)}
          class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content hover:bg-primary/90 disabled:opacity-50"
        >
          {t.save()}
        </button>
      {/if}
      <form
        class="flex flex-wrap items-end gap-2"
        onsubmit={(e) => {
          e.preventDefault()
          if (nameOk && canSave && !blocked) void save(true)
        }}
      >
        <label class="block">
          <span class="text-xs text-base-content/80">{t.save_as()}</span>
          <input
            data-testid="keymap-save-name"
            bind:value={saveName}
            placeholder={t.name_placeholder()}
            aria-invalid={saveName.trim() !== '' && !nameOk}
            class="mt-1 block w-36 rounded border border-base-300 px-2 py-1 text-xs focus:border-primary focus:outline-none"
          />
        </label>
        <button
          type="submit"
          data-testid="keymap-save-as"
          disabled={!nameOk || !canSave || blocked}
          class="rounded border border-base-300 px-3 py-1.5 text-xs font-medium text-base-content/80 hover:bg-base-200 disabled:opacity-50"
        >
          {t.save_as()}
        </button>
      </form>
      {#if draft.dirty}
        <span class="text-xs text-base-content/70" data-testid="keymap-dirty">{t.unsaved()}</span>
        <button
          type="button"
          data-testid="keymap-discard"
          onclick={() => draft.discard()}
          class="rounded px-2 py-1 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content"
        >
          {t.discard()}
        </button>
      {/if}
    </div>
    {#if !canSave}
      <p class="mt-1 text-xs text-base-content/70">{t.needs_vault()}</p>
    {:else if blocked}
      <p class="mt-1 text-xs text-base-content/70" data-testid="keymap-blocked">{t.cannot_save_fallback()}</p>
    {:else if draft.shadowsBuiltin}
      <p class="mt-1 text-xs text-base-content/70" data-testid="keymap-shadows-builtin">
        {t.builtin_name({ name: keymap.resolved?.entry?.name ?? '' })}
      </p>
    {:else if saveName.trim() !== '' && !nameOk}
      <p class="mt-1 text-xs text-base-content/70">{$LL.web.keymaps.bad_name()}</p>
    {/if}
    {#if saveError}
      <p class="mt-1 text-xs text-error" role="alert" data-testid="keymap-save-error">{saveError}</p>
    {/if}
    {#if savedPath}
      <p class="mt-1 text-xs text-base-content/80" role="status" data-testid="keymap-saved">
        {t.saved({ path: savedPath })}
      </p>
    {/if}
  {/if}

  {#if groups.length === 0}
    <p class="mt-3 text-xs text-base-content/70">{t.none()}</p>
  {/if}
  {#each groups as group (group.label)}
    <h3 class="mt-4 text-xs font-semibold tracking-wide text-base-content/70 uppercase">
      {group.label}
    </h3>
    <ul class="mt-1 space-y-2">
      {#each group.rows as row (row.id)}
        <li data-testid="hotkey-row:{row.id}">
          <Field name={row.id} errors={errors[row.id] ? [errors[row.id]] : []}>
            <div class="flex flex-wrap items-center gap-2">
              <span class="min-w-0 flex-1 truncate text-sm text-base-content/80">{row.title}</span>
              <span
                data-testid="hotkey-binding:{row.id}"
                class="shrink-0 rounded border border-base-300 px-1.5 py-0.5 font-ed-mono text-xs text-base-content"
              >
                {row.display || t.unbound()}
              </span>
              <div class="w-44 shrink-0" bind:this={fields[row.id]}>
                <TextControl
                  label={t.shortcut_for({ command: row.title })}
                  hideLabel
                  mono
                  bind:value={drafts[row.id]}
                  readonly={recording === row.id}
                  placeholder={recording === row.id ? t.recording() : t.placeholder()}
                  testid="hotkey-input:{row.id}"
                  onkeydown={(e: KeyboardEvent) => {
                    if (recording === row.id) onRecordKey(row, e)
                    else if (e.key === 'Enter') {
                      e.preventDefault()
                      commit(row)
                    }
                  }}
                  onblur={() => {
                    if (recording === row.id) stopRecording()
                    commit(row)
                  }}
                />
              </div>
              <button
                type="button"
                data-testid="hotkey-record:{row.id}"
                aria-pressed={recording === row.id}
                aria-label={recording === row.id
                  ? t.stop_recording({ command: row.title })
                  : t.record_for({ command: row.title })}
                onclick={() => (recording === row.id ? stopRecording() : startRecording(row))}
                class="shrink-0 rounded border border-base-300 px-2 py-1 text-xs font-medium text-base-content/80 hover:bg-base-200 aria-pressed:bg-primary aria-pressed:text-primary-content"
              >
                {recording === row.id ? t.recording() : t.record()}
              </button>
              <button
                type="button"
                data-testid="hotkey-reset:{row.id}"
                disabled={!Object.hasOwn(draft.own, row.id)}
                aria-label={t.reset_for({ command: row.title })}
                onclick={() => resetRow(row)}
                class="shrink-0 rounded px-2 py-1 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content disabled:opacity-50"
              >
                {t.reset()}
              </button>
            </div>
            <Description>
              {row.defaultDisplay ? t.default_is({ binding: row.defaultDisplay }) : t.default_none()}
            </Description>
            <!-- A collision is a command that quietly stopped working
                 (`match()` keeps the last registration), and a chord the
                 desktop eats never arrives at all. -->
            {#if row.conflicts.length > 0 || row.reserved}
              <p data-testid="hotkey-warning:{row.id}" class="mt-1 flex items-start gap-1.5 text-xs text-warning">
                <TriangleAlert size={13} aria-hidden="true" class="mt-0.5 shrink-0" />
                <span>
                  {#if row.conflicts.length > 0}
                    {t.conflict({ commands: list(row.conflicts) })}
                  {/if}
                  {#if row.reserved}
                    {t.reserved()}
                  {/if}
                </span>
              </p>
            {/if}
            <FieldErrors />
          </Field>
        </li>
      {/each}
    </ul>
  {/each}
</section>
