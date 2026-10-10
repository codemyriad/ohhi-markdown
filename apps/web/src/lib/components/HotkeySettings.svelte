<script lang="ts">
  /**
   * Settings › Keys (settings-shaping ST3, K1): one row per registered
   * command, and the chord chips are the control — click a chip to record a
   * replacement, × to remove it, + to add another. A row shows its default
   * and a Reset only when its keys differ from it. The toolbar filters:
   * search matches titles, ids and keys; *Press keys* searches by chord
   * (press Ctrl+E to see what it runs); the chips narrow to Changed, Clashes
   * and No key. Groups collapse.
   *
   * Every change writes through (`hotkey-writer.svelte.ts`, Fork 2): no
   * draft, no Save. The first change to a read-only keymap creates
   * `.ohhi/keymaps/mine.json` extending it, and Undo puts back what a write
   * replaced. Pure filtering lives in `hotkey-rows.ts`.
   */
  import { onMount, tick } from 'svelte'
  import { ChevronDown, ChevronRight, Keyboard, Plus, TriangleAlert, X } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { CommandBinding, CommandRegistry } from '../commands.js'
  import {
    HOTKEY_FILTERS,
    filterCounts,
    filterRows,
    groupRows,
    isChanged,
    withChord,
    withoutChord,
    type HotkeyFilter,
  } from '../hotkey-rows.js'
  import { createHotkeyWriter } from '../hotkey-writer.svelte.js'
  import { sourceOf } from '../customise-overview.js'
  import { BUILTIN_KEYMAPS, keymapName, type KeymapBindings } from '../keymap-spec.js'
  import type { Keymap } from '../keymap.svelte.js'
  import { choiceOf } from '../resource-kind.js'
  import type { Resources } from '../resources.svelte.js'
  import IconButton from '../ui/IconButton.svelte'
  import { OUTLINE_BUTTON } from '../ui/styles.js'
  import ResourceSource from './ResourceSource.svelte'

  interface Props {
    registry: CommandRegistry
    keymap?: Pick<Keymap, 'active' | 'resolved' | 'legacy' | 'setActive' | 'save' | 'restore'>
    resources?: Partial<Pick<Resources, 'keymaps' | 'refreshKeymaps' | 'read'>>
    /** False with no vault open: a keymap is a file inside one. */
    canSave: boolean
    /** The legacy per-device map, as bindings (what is in force before a vault's keymap). */
    legacy?: () => KeymapBindings
  }

  let { registry, keymap, resources, canSave, legacy = () => ({}) }: Props = $props()

  const t = $derived($LL.web.settings.keys)
  const format = (keys: string): string => registry.format(keys)

  onMount(() => void resources?.refreshKeymaps?.())

  const noKeymap = {
    active: 'default' as const,
    resolved: null,
    legacy: true,
    save: () => Promise.reject(new Error('no keymap')),
    restore: () => Promise.reject(new Error('no keymap')),
  }
  const writer = createHotkeyWriter({
    get registry() {
      return registry
    },
    get keymap() {
      return keymap ?? noKeymap
    },
    get resources() {
      return resources
    },
    legacy: () => legacy(),
    canSave: () => canSave && keymap !== undefined,
  })

  /** The rows under the keymap in force — recomputed when it changes. */
  const rows = $derived.by(() => {
    void writer.inForce
    return writer.rows()
  })

  // ---- the toolbar ----
  let text = $state('')
  let filter = $state<HotkeyFilter>('all')
  /** "Press keys" mode: the search field records a chord instead of taking text. */
  let byKeys = $state(false)
  let chord = $state<string | null>(null)
  let searchFocused = $state(false)
  let searchField = $state<HTMLInputElement | undefined>()

  const counts = $derived(filterCounts(rows, format))
  const shown = $derived(filterRows(rows, { text, chord: byKeys ? chord : null, filter }, format))
  const groups = $derived(groupRows(shown, t.ungrouped(), format))
  let collapsed = $state<Record<string, boolean>>({})

  // ---- recording a chord into a chip ----
  /** The row recording, and which chip it replaces (`'add'` = a new one). */
  let recording = $state<{ id: string; at: number | 'add' } | null>(null)
  const recorders = $state<Record<string, HTMLInputElement | undefined>>({})

  // Global hotkeys are handled in the capture phase, so while a chord is being
  // pressed into Settings — recorded onto a row, or typed into the search —
  // no key may run a command.
  $effect(() => {
    registry.setSuspended(recording !== null || (byKeys && searchFocused))
  })
  // The section unmounts on a section switch or the tab closing: never leave the registry suspended.
  $effect(() => () => registry.setSuspended(false))

  async function startRecording(row: CommandBinding, at: number | 'add'): Promise<void> {
    recording = { id: row.id, at }
    await tick()
    recorders[row.id]?.focus()
  }

  function stopRecording(): void {
    recording = null
  }

  function onRecordKey(row: CommandBinding, e: KeyboardEvent): void {
    // Tab is how a keyboard user leaves; it is never recorded.
    if (e.key === 'Tab') return stopRecording()
    e.preventDefault()
    e.stopPropagation()
    // Escape cancels the recording and changes nothing.
    if (e.key === 'Escape') return stopRecording()
    const binding = registry.bindingFor(e)
    if (!binding || !recording) return // modifiers only — the user is still reaching
    const next = withChord(row.chords, binding, recording.at, format)
    stopRecording()
    void writer.set(row, next)
  }

  function onSearchKey(e: KeyboardEvent): void {
    if (!byKeys || e.key === 'Tab') return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      if (chord !== null) chord = null
      else byKeys = false
      return
    }
    const binding = registry.bindingFor(e)
    if (binding) chord = binding
  }

  async function togglePressKeys(): Promise<void> {
    byKeys = !byKeys
    chord = null
    await tick()
    searchField?.focus()
  }

  // ---- the source line (Fork 4): the file in use, where it lives, what it extends ----
  const source = $derived(
    keymap && !keymap.legacy
      ? sourceOf({
          chosen: keymapName(keymap.active),
          entry: keymap.resolved?.entry ?? null,
          error: keymap.resolved?.error ?? null,
        })
      : null
  )
  /** The rest of the line: what the file extends, and where a change will go when it is read-only. */
  const sourceNote = $derived.by(() => {
    if (!keymap || keymap.legacy) return t.legacy()
    const resolved = keymap.resolved
    const parts: string[] = []
    const parent = resolved?.entry && resolved.entry.root !== 'builtin' ? resolved.file.extends : undefined
    if (parent) parts.push(t.extends({ name: parent }))
    if (writer.shadowsBuiltin) parts.push(t.shadows_builtin())
    if (!writer.writable && !writer.unresolved) parts.push(t.read_only_hint())
    return parts.join(' ')
  })

  const CHIP = 'rounded border border-base-300 bg-base-100 px-1.5 py-0.5 font-ed-mono text-xs text-base-content'
</script>

<section data-testid="settings-hotkeys" class="space-y-3">
  <p class="text-xs text-base-content/70">{t.intro()}</p>

  {#if keymap}
    <div data-testid="keymap-file">
      {#if source}
        <ResourceSource label={t.keymap()} testid="keymap-source" {source}>
          <span data-testid="keymap-from">{sourceNote}</span>
        </ResourceSource>
      {:else}
        <p class="mb-3 text-xs text-base-content/70" data-testid="keymap-from">{sourceNote}</p>
      {/if}
      <label class="flex items-center gap-1.5 text-xs">
        <span class="text-base-content/80">{t.pick()}</span>
        <select
          data-testid="keymap-pick"
          value={keymap.legacy ? '' : keymap.active}
          onchange={(e) => void keymap.setActive(e.currentTarget.value as typeof keymap.active)}
          class="rounded border border-base-300 bg-base-100 px-2 py-1 text-xs focus:border-primary focus:outline-none"
        >
          {#each resources?.keymaps ?? [] as option (option.name)}
            <option value={choiceOf(option, BUILTIN_KEYMAPS)}>{option.name}</option>
          {/each}
        </select>
      </label>
    </div>
    {#if writer.unresolved}
      <p class="text-xs text-base-content/70" data-testid="keymap-blocked">{t.cannot_write()}</p>
    {/if}
  {/if}

  <div class="space-y-2" data-testid="hotkey-toolbar">
    <div class="flex items-center gap-2">
      <label class="min-w-0 flex-1">
        <span class="sr-only">{byKeys ? t.press_keys_label() : t.search()}</span>
        <input
          bind:this={searchField}
          data-testid="hotkey-search"
          type="search"
          value={byKeys ? (chord ? format(chord) : '') : text}
          readonly={byKeys}
          placeholder={byKeys ? t.press_keys_placeholder() : t.search_placeholder({ count: rows.length })}
          oninput={(e) => {
            if (!byKeys) text = e.currentTarget.value
          }}
          onkeydown={onSearchKey}
          onfocus={() => (searchFocused = true)}
          onblur={() => (searchFocused = false)}
          class="w-full rounded border border-base-300 bg-base-100 px-2 py-1 text-xs focus:border-primary focus:outline-none {byKeys
            ? 'font-ed-mono'
            : ''}"
        />
      </label>
      <button
        type="button"
        data-testid="hotkey-press-keys"
        aria-pressed={byKeys}
        onclick={() => void togglePressKeys()}
        class="{OUTLINE_BUTTON} inline-flex shrink-0 items-center gap-1 px-2 py-1 text-xs text-base-content/80 aria-pressed:bg-base-200 aria-pressed:text-base-content"
      >
        <Keyboard size={14} aria-hidden="true" />
        {t.press_keys()}
      </button>
      {#if byKeys && chord}
        <button
          type="button"
          data-testid="hotkey-chord-clear"
          onclick={() => {
            chord = null
            searchField?.focus()
          }}
          class="shrink-0 rounded px-2 py-1 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content"
        >
          {t.clear()}
        </button>
      {/if}
    </div>
    <div role="group" aria-label={t.filters()} class="flex flex-wrap gap-1.5">
      {#each HOTKEY_FILTERS as f (f)}
        <button
          type="button"
          data-testid="hotkey-filter:{f}"
          aria-pressed={filter === f}
          onclick={() => (filter = f)}
          class="rounded-full border border-base-300 px-2.5 py-0.5 text-xs text-base-content/80 hover:bg-base-200 aria-pressed:border-primary aria-pressed:bg-base-200 aria-pressed:text-base-content"
        >
          {t.filter[f]()} <span class="tabular-nums text-base-content/70">{counts[f]}</span>
        </button>
      {/each}
    </div>
  </div>

  {#if rows.length === 0}
    <p class="text-xs text-base-content/70">{t.none()}</p>
  {:else if groups.length === 0}
    <p class="text-xs text-base-content/70" data-testid="hotkey-no-match">{t.no_match()}</p>
  {/if}

  {#each groups as group (group.label)}
    {@const open = !collapsed[group.label]}
    <div data-testid="hotkey-group:{group.label}">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          data-testid="hotkey-group-toggle:{group.label}"
          onclick={() => (collapsed[group.label] = open)}
          class="flex w-full items-center gap-1 rounded py-1 text-left text-[11px] font-semibold tracking-wide text-base-content/70 uppercase hover:text-base-content"
        >
          {#if open}<ChevronDown size={13} aria-hidden="true" />{:else}<ChevronRight size={13} aria-hidden="true" />{/if}
          <span>{group.label}</span>
          <span class="font-normal tabular-nums normal-case">{group.rows.length}</span>
          {#if group.changed > 0}
            <span class="font-normal normal-case text-primary">· {t.group_changed({ count: group.changed })}</span>
          {/if}
        </button>
      </h3>
      {#if open}
        <ul class="divide-y divide-base-200">
          {#each group.rows as row (row.id)}
            {@const changed = isChanged(row, format)}
            {@const rec = recording?.id === row.id ? recording : null}
            <li data-testid="hotkey-row:{row.id}" class="group/row flex flex-wrap items-start gap-x-3 gap-y-1 py-1">
              <div class="min-w-0 flex-1 py-0.5">
                <span class="text-sm text-base-content/90">{row.title}</span>
                <span
                  data-testid="hotkey-id:{row.id}"
                  class="ml-1 font-ed-mono text-[11px] text-base-content/70 {text.trim() && row.id.includes(text.trim().toLowerCase())
                    ? ''
                    : 'hidden group-hover/row:inline group-focus-within/row:inline'}">{row.id}</span
                >
                {#if changed}
                  <p class="flex items-center gap-2 text-[11px] text-base-content/70">
                    <span data-testid="hotkey-default:{row.id}">
                      {row.defaultKeys ? t.default_is({ binding: format(row.defaultKeys) }) : t.default_none()}
                    </span>
                    <button
                      type="button"
                      data-testid="hotkey-reset:{row.id}"
                      aria-label={t.reset_for({ command: row.title })}
                      disabled={!writer.canWrite}
                      onclick={() => void writer.reset(row)}
                      class="rounded px-1 text-base-content/80 underline-offset-2 hover:underline disabled:opacity-50"
                    >
                      {t.reset()}
                    </button>
                  </p>
                {/if}
                <!-- A clash is a command that quietly stopped working (`match()`
                     keeps the last registration), and a chord the desktop
                     eats never arrives at all. -->
                {#if row.conflicts.length > 0 || row.reserved}
                  <p data-testid="hotkey-warning:{row.id}" class="flex items-start gap-1.5 text-[11px] text-warning">
                    <TriangleAlert size={12} aria-hidden="true" class="mt-0.5 shrink-0" />
                    <span>
                      {#if row.conflicts.length > 0}{t.conflict({ commands: row.conflicts.join(', ') })}{/if}
                      {#if row.reserved}{t.reserved()}{/if}
                    </span>
                  </p>
                {/if}
              </div>
              <div
                class="flex flex-wrap items-center justify-end gap-1"
                data-testid="hotkey-binding:{row.id}"
                data-keys={row.display}
              >
                {#each row.chords as keys, i (i)}
                  {#if rec && rec.at === i}
                    {@render recorder(row)}
                  {:else}
                    <span class="group/chip inline-flex items-center">
                      <button
                        type="button"
                        data-testid="hotkey-chip:{row.id}:{i}"
                        aria-label={t.change_chip({ binding: format(keys), command: row.title })}
                        disabled={!writer.canWrite}
                        onclick={() => void startRecording(row, i)}
                        class="{CHIP} hover:border-primary disabled:opacity-60">{format(keys)}</button
                      >
                      <IconButton
                        icon={X}
                        tooltip={false}
                        label={t.remove_chip({ binding: format(keys), command: row.title })}
                        testid="hotkey-remove:{row.id}:{i}"
                        disabled={!writer.canWrite}
                        onclick={() => void writer.set(row, withoutChord(row.chords, i))}
                        class="opacity-0 group-hover/chip:opacity-100 focus-visible:opacity-100"
                      />
                    </span>
                  {/if}
                {/each}
                {#if rec && rec.at === 'add'}
                  {@render recorder(row)}
                {:else if row.chords.length === 0}
                  <span class="text-xs text-base-content/70" data-testid="hotkey-unbound:{row.id}">{t.unbound()}</span>
                {/if}
                <IconButton
                  icon={Plus}
                  tooltip={false}
                  label={t.add_for({ command: row.title })}
                  testid="hotkey-add:{row.id}"
                  disabled={!writer.canWrite}
                  onclick={() => void startRecording(row, 'add')}
                />
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/each}

  {#snippet recorder(row: CommandBinding)}
    <input
      bind:this={recorders[row.id]}
      data-testid="hotkey-recorder:{row.id}"
      readonly
      aria-label={t.recording_for({ command: row.title })}
      placeholder={t.recording()}
      onkeydown={(e) => onRecordKey(row, e)}
      onblur={stopRecording}
      class="w-44 rounded border border-primary bg-base-100 px-1.5 py-0.5 font-ed-mono text-xs text-base-content placeholder:text-base-content/70 focus:outline-none"
    />
  {/snippet}

  {#if writer.error || writer.last || writer.undone}
    <div
      class="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-base-300 bg-base-100 py-2 text-xs"
      data-testid="keymap-status"
    >
      {#if writer.error}
        <p role="alert" class="flex-1 text-error" data-testid="keymap-save-error">{t.error({ error: writer.error })}</p>
      {:else}
        <p role="status" class="flex-1 text-base-content/80" data-testid="keymap-saved">
          {#if writer.last}
            {writer.last.created ? t.created({ path: writer.last.path }) : t.saved({ path: writer.last.path })}
          {:else}
            {t.undone()}
          {/if}
        </p>
      {/if}
      {#if writer.canUndo}
        <button
          type="button"
          data-testid="keymap-undo"
          onclick={() => void writer.undo()}
          class="{OUTLINE_BUTTON} px-2 py-1 text-xs font-medium text-base-content/80"
        >
          {t.undo()}
        </button>
      {/if}
    </div>
  {/if}
</section>
