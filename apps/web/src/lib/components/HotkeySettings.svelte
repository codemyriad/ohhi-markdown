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
   *
   * Focus never drops to the page: after a recording, a ×, a Reset or an
   * Undo it lands on the row's first chip (or its +). What happened is said
   * in two live regions that are always in the page and empty when idle —
   * a status (the change, naming the command, its keys and the file) and an
   * alert (a failure) — cleared before each message, so the same sentence
   * twice is announced twice.
   */
  import { onMount, tick } from 'svelte'
  import { getLL } from '@ohhi/i18n'
  import { ChevronDown, ChevronRight, Keyboard, Plus, TriangleAlert, X } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { CommandBinding, CommandRegistry } from '../commands.js'
  import {
    HOTKEY_FILTERS,
    filterCounts,
    filterRows,
    groupRows,
    isChanged,
    takesTypingKey,
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
    /** Opens the Log (where a failed keys migration says why); absent → not offered. */
    onShowLog?: () => void
  }

  let { registry, keymap, resources, canSave, legacy = () => ({}), onShowLog }: Props = $props()
  const uid = $props.id()

  const t = $derived($LL.web.settings.keys)
  const format = (keys: string): string => registry.format(keys)

  onMount(() => void resources?.refreshKeymaps?.())

  const noKeymap = {
    active: 'default' as const,
    resolved: null,
    legacy: true,
    save: () => Promise.reject(new Error(getLL().web.keymaps.needs_vault())),
    restore: () => Promise.reject(new Error(getLL().web.keymaps.needs_vault())),
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

  // ---- focus and the live regions (review H1, H2) ----
  let root = $state<HTMLElement | undefined>()
  /** The status region's sentence (polite) and the alert region's (a failure). */
  let status = $state('')
  let alert = $state('')

  /** Say `text` in a region: both emptied first, so the same sentence twice is announced twice. */
  async function say(region: 'status' | 'alert', text: string): Promise<void> {
    status = ''
    alert = ''
    await tick()
    if (region === 'status') status = text
    else alert = text
  }

  /** Chip `at` of row `id`, else its first chip, else its +, else the search field (the row was filtered out). */
  async function focusRow(id: string, at = 0): Promise<void> {
    await tick()
    const find = (testid: string) => root?.querySelector<HTMLElement>(`[data-testid="${testid}"]`) ?? null
    const el = find(`hotkey-chip:${id}:${at}`) ?? find(`hotkey-chip:${id}:0`) ?? find(`hotkey-add:${id}`) ?? searchField
    el?.focus()
  }

  const keysText = (chords: readonly string[]): string =>
    chords.length > 0 ? chords.map(format).join(', ') : t.unbound()
  const titleOf = (id: string): string => rows.find((r) => r.id === id)?.title ?? id

  /** Say what the last write or Undo did, or why it did not. */
  async function report(): Promise<void> {
    const problem = writer.problem
    if (problem) {
      if (problem.kind === 'stale') return say('alert', t.undo_stale({ path: problem.path }))
      if (problem.kind === 'undo') return say('alert', t.undo_error({ error: problem.message }))
      return say('alert', t.error({ error: problem.message }))
    }
    const last = writer.last
    if (last) {
      const parts = { command: titleOf(last.id), keys: keysText(last.chords), path: last.path }
      return say('status', last.created ? t.created(parts) : t.saved(parts))
    }
    const undone = writer.undone
    if (undone) {
      const chords = rows.find((r) => r.id === undone.id)?.chords ?? []
      return say('status', t.undone({ command: titleOf(undone.id), keys: keysText(chords), path: undone.path }))
    }
  }

  /** Write `chords` for `row`, say so, and put focus back on the row (chip `at`). */
  async function change(row: CommandBinding, chords: string[], at = 0): Promise<void> {
    await writer.set(row, chords)
    await report()
    await focusRow(row.id, at)
  }

  async function reset(row: CommandBinding): Promise<void> {
    await writer.reset(row)
    await report()
    await focusRow(row.id)
  }

  async function undo(): Promise<void> {
    await writer.undo()
    await report()
    await tick()
    // Undo keeps the focus while there is more to undo; else back to the row it put back.
    const button = root?.querySelector<HTMLElement>('[data-testid="keymap-undo"]')
    if (button) button.focus()
    else if (writer.undone) await focusRow(writer.undone.id)
    else searchField?.focus()
  }

  function onRecordKey(row: CommandBinding, e: KeyboardEvent): void {
    // Tab is how a keyboard user leaves; it is never recorded.
    if (e.key === 'Tab') return stopRecording()
    e.preventDefault()
    e.stopPropagation()
    // Escape cancels the recording, changes nothing, and gives the focus back to the row.
    if (e.key === 'Escape') {
      const at = recording?.at
      stopRecording()
      void focusRow(row.id, typeof at === 'number' ? at : 0)
      return
    }
    const binding = registry.bindingFor(e)
    if (!binding || !recording) return // modifiers only — the user is still reaching
    // A key that types (a letter, Enter, Space…) on its own is refused; still recording.
    if (takesTypingKey(binding)) {
      void say('alert', t.needs_modifier())
      return
    }
    const at = recording.at
    const next = withChord(row.chords, binding, at, format)
    stopRecording()
    const landed = next.findIndex((c) => format(c) === format(binding))
    void change(row, next, landed >= 0 ? landed : 0)
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
    if (!keymap) return ''
    if (keymap.legacy) return t.legacy()
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

<section bind:this={root} data-testid="settings-hotkeys" class="space-y-3">
  <p class="text-xs text-base-content/70">{t.intro()}</p>

  {#if keymap}
    <div data-testid="keymap-file">
      {#if source}
        <ResourceSource label={t.keymap()} testid="keymap-source" {source}>
          <span data-testid="keymap-from">{sourceNote}</span>
        </ResourceSource>
      {:else}
        <p class="mb-3 text-xs text-base-content/70" data-testid="keymap-from">
          {sourceNote}
          {#if keymap.legacy && onShowLog}
            <button
              type="button"
              data-testid="keymap-show-log"
              onclick={() => onShowLog?.()}
              class="ml-1 rounded text-primary underline-offset-2 hover:underline">{t.show_log()}</button
            >
          {/if}
        </p>
      {/if}
      <label class="flex items-center gap-1.5 text-xs">
        <span class="text-base-content/80">{t.pick()}</span>
        <select
          data-testid="keymap-pick"
          value={keymap.legacy ? '' : keymap.active}
          onchange={(e) => void keymap.setActive(e.currentTarget.value as typeof keymap.active)}
          class="rounded border border-base-300 bg-base-100 px-2 py-1 text-xs focus:border-primary focus:outline-none"
        >
          {#if keymap.legacy}
            <option value="" disabled>{t.on_device()}</option>
          {/if}
          {#each resources?.keymaps ?? [] as option (option.name)}
            <option value={choiceOf(option, BUILTIN_KEYMAPS)}
              >{t.pick_option({ name: option.name, source: $LL.web.settings.customise.from[option.root]() })}</option
            >
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
    <!-- How many rows the search, the pressed keys or a chip leave: always in the page, empty when nothing narrows. -->
    <p role="status" class="text-[11px] text-base-content/70" data-testid="hotkey-result-count">
      {#if text.trim() || (byKeys && chord) || filter !== 'all'}{t.result_count({ count: shown.length })}{/if}
    </p>
  </div>

  {#if rows.length === 0}
    <p class="text-xs text-base-content/70">{t.none()}</p>
  {:else if groups.length === 0}
    <p class="text-xs text-base-content/70" data-testid="hotkey-no-match">{t.no_match()}</p>
  {/if}

  {#each groups as group, gi (group.label)}
    {@const open = !collapsed[group.label]}
    {@const listId = `${uid}-group-${gi}`}
    <div data-testid="hotkey-group:{group.label}">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={group.changed > 0
            ? t.group_label_changed({ group: group.label, count: group.rows.length, changed: group.changed })
            : t.group_label({ group: group.label, count: group.rows.length })}
          data-testid="hotkey-group-toggle:{group.label}"
          onclick={() => (collapsed[group.label] = open)}
          class="flex w-full items-center gap-1 rounded py-1 text-left text-[11px] font-semibold tracking-wide text-base-content/70 uppercase hover:text-base-content"
        >
          {#if open}<ChevronDown size={13} aria-hidden="true" />{:else}<ChevronRight size={13} aria-hidden="true" />{/if}
          <span>{group.label}</span>
          <span class="font-normal tabular-nums normal-case">{group.rows.length}</span>
          {#if group.changed > 0}
            <span class="font-normal normal-case text-primary"><span aria-hidden="true">·</span> {t.group_changed({ count: group.changed })}</span>
          {/if}
        </button>
      </h3>
      {#if open}
        <ul id={listId} class="divide-y divide-base-200">
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
                      onclick={() => void reset(row)}
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
                        onclick={() => void change(row, withoutChord(row.chords, i), i)}
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

  <!-- The status bar: two live regions always in the page (empty when idle), and Undo. -->
  <div
    class="sticky bottom-0 flex flex-wrap items-center gap-2 bg-base-100 text-xs {status || alert || writer.canUndo
      ? 'border-t border-base-300 py-2'
      : ''}"
    data-testid="keymap-status"
  >
    <p role="alert" class="text-error {alert ? 'flex-1' : ''}" data-testid="keymap-save-error">{alert}</p>
    <p role="status" class="text-base-content/80 {status ? 'flex-1' : ''}" data-testid="keymap-saved">{status}</p>
    {#if writer.canUndo}
      <button
        type="button"
        data-testid="keymap-undo"
        onclick={() => void undo()}
        class="{OUTLINE_BUTTON} px-2 py-1 text-xs font-medium text-base-content/80"
      >
        {t.undo()}
      </button>
    {/if}
  </div>
</section>
