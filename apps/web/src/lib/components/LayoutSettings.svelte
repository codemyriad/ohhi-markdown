<script lang="ts">
  /**
   * Settings › Layout and › Editor (round 3, Q6; settings-shaping ST2): a form
   * over this device's layout overrides (`config.layout.overrides`), drawn in
   * two parts — `shell` (Layout: the regions, bars and dock) and `editor`
   * (Editor: how a note opens, line width, typewriter, the inline title).
   * Every control applies at once — the shell re-renders beside the view —
   * and persists as it changes: no Save, no names, no files. Only the fields
   * worth exposing are here, each labelled from the dictionary; a side this
   * device pins as a column (P7) reads *(pinned)* with *Unpin* beside it,
   * since the pin wins over the field. Each part's reset puts ITS fields
   * back to the layout file's own values and leaves the other part's alone.
   *
   * What is stored is the minimal delta over the active file
   * (`overridesFor` — a field set back to the file's value stops being an
   * override); choosing a FILE is the palette's *Use layout file…*. The
   * Layout part opens with the file's one source line (settings-shaping
   * Fork 4, quiet-shell Fork 8): which layout file is in use, its root, and
   * that this form is the device's changes on top of it.
   *
   * E6 adds two to the Layout part: *Pane keys* (Subtle / Full / Off — how
   * the pane mode shows its keys; device config, `config.paneHints`, not a
   * layout override) and the formatting bar's buttons
   * (`FormatBarPicker`, `overrides.bars.format` as a plain list). The bar
   * stays a plain list when any other field here changes, and the part's
   * reset puts it back too.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { CommandRegistry } from '../commands.js'
  import { PANE_HINTS, type PaneHints } from '../config.js'
  import { withFormatBar, withoutFormatBar } from '../format-bar-picker.js'
  import { paneHints } from '../pane-hints.svelte.js'
  import FormatBarPicker from './FormatBarPicker.svelte'
  import { hasOverrides, overridesFor, type ShellSpec } from '../layout-spec.js'
  import { sourceOf } from '../customise-overview.js'
  import { layoutName } from '../layout.js'
  import type { PinSide } from '../pin-layout.js'
  import type { SettingsLayout } from '../settings-host.js'
  import ResourceSource from './ResourceSource.svelte'

  interface Props {
    layout: SettingsLayout
    /** Which fields: Layout's (`shell`) or Editor's (`editor`). */
    part?: 'shell' | 'editor'
    /** The shell's registry: the formatting bar picker's names for commands the dictionary lacks. */
    registry?: CommandRegistry
  }

  let { layout, part = 'shell', registry }: Props = $props()

  const t = $derived($LL.web.settings.layout)
  /** The dictionary's labels as a lookup: `<field>` and `<field>_<value>`. */
  const words = $derived(t as unknown as Record<string, ((p?: unknown) => string) | undefined>)
  const say = (key: string, fallback: string): string => words[key]?.() ?? fallback

  type Section = 'regions' | 'toolbar' | 'dock' | 'panes' | 'editor'
  interface Select {
    /** The label key and the testid: `layout-field:<id>`. */
    id: string
    section: Section
    key: string
    /** The values offered, in order (curated: not every value the spec allows). */
    options: readonly string[]
    /** The side a pin overrides, for the two column fields. */
    pin?: PinSide
    part: 'shell' | 'editor'
  }
  const ALL_SELECTS: readonly Select[] = [
    { id: 'files', section: 'regions', key: 'navigator', options: ['drawer', 'column'], pin: 'navigator', part: 'shell' },
    { id: 'sidebar', section: 'regions', key: 'rail', options: ['dock', 'column'], pin: 'rail', part: 'shell' },
    { id: 'sidebar_position', section: 'dock', key: 'position', options: ['top-right', 'bottom-right'], part: 'shell' },
    { id: 'tabs', section: 'regions', key: 'tabs', options: ['auto', 'always'], part: 'shell' },
    { id: 'toolbar', section: 'toolbar', key: 'position', options: ['top', 'bottom'], part: 'shell' },
    { id: 'format', section: 'regions', key: 'format', options: ['bottom', 'top', 'off'], part: 'shell' },
    { id: 'status', section: 'regions', key: 'status', options: ['corner', 'off'], part: 'shell' },
    { id: 'open', section: 'panes', key: 'open', options: ['replace', 'tab'], part: 'editor' },
    { id: 'measure', section: 'editor', key: 'measure', options: ['narrow', 'comfortable', 'wide'], part: 'editor' },
  ]
  const ALL_CHECKS: readonly { id: string; label: string; key: string; part: 'shell' | 'editor' }[] = [
    { id: 'typewriter', label: 'typewriter', key: 'typewriter', part: 'editor' },
    { id: 'inline-title', label: 'inline_title', key: 'inlineTitle', part: 'editor' },
  ]
  const SELECTS = $derived(ALL_SELECTS.filter((f) => f.part === part))
  const CHECKS = $derived(ALL_CHECKS.filter((f) => f.part === part))
  /** This part's fields as (section, key) pairs — what its reset puts back. */
  const fields = $derived([
    ...SELECTS.map((f) => [f.section, f.key] as const),
    ...CHECKS.map((f) => ['editor' as Section, f.key] as const),
  ])

  const valueOf = (spec: ShellSpec, section: Section, key: string): unknown =>
    (spec[section] as Record<string, unknown>)[key]
  const optionLabel = (f: Select, value: string): string => say(`${f.id}_${value.replaceAll('-', '_')}`, value)
  /** The curated values, plus the file's own when it is one the form does not offer (a file's `off`). */
  const optionsOf = (f: Select): readonly string[] => {
    const now = String(valueOf(layout.ownSpec, f.section, f.key))
    return f.options.includes(now) ? f.options : [...f.options, now]
  }
  const pinned = (f: Select): boolean => f.pin !== undefined && layout.pins?.[f.pin] === 'column'

  /**
   * One field changed: the edited spec (file + overrides + this value) is
   * stored as its delta over the file, and the shell applies it at once.
   */
  function set(section: Section, key: string, value: unknown): void {
    const own = $state.snapshot(layout.ownSpec) as ShellSpec
    const next = { ...own, [section]: { ...(own[section] as object), [key]: value } } as ShellSpec
    const file = $state.snapshot(layout.fileSpec) as ShellSpec
    // The bar stays the plain list the picker wrote, never a delta (E6).
    layout.setOverrides(withFormatBar(overridesFor(file, next), file, next.bars.format))
  }

  /** Any of this part's fields differ from the file's own value. */
  const changed = $derived(
    hasOverrides(layout.overrides) &&
      (fields.some(([section, key]) => valueOf(layout.ownSpec, section, key) !== valueOf(layout.fileSpec, section, key)) ||
        (part === 'shell' && layout.overrides.bars?.format !== undefined))
  )

  /** Put this part's fields back to the file's values; the other part's overrides stay. */
  function resetPart(): void {
    const file = $state.snapshot(layout.fileSpec) as ShellSpec
    const next = $state.snapshot(layout.ownSpec) as unknown as Record<Section, Record<string, unknown>>
    for (const [section, key] of fields) {
      next[section] = { ...next[section], [key]: valueOf(file, section, key) }
    }
    const own = next as unknown as ShellSpec
    const kept = withFormatBar(overridesFor(file, own), file, own.bars.format)
    layout.setOverrides(part === 'shell' ? withoutFormatBar(kept) : kept)
  }

  const hintLabel = (value: PaneHints): string => say(`hints_${value}`, value)

  const selectCls =
    'mt-1 w-full rounded border border-base-300 bg-base-100 px-2 py-1 text-xs focus:border-primary focus:outline-none'
  const smallBtn =
    'rounded border border-base-300 px-2 py-0.5 text-xs font-medium text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50'
</script>

<section data-testid={part === 'shell' ? 'settings-layout' : 'settings-editor-layout'}>
  {#if part === 'shell' && layout.active !== undefined}
    <ResourceSource
      label={$LL.web.settings.customise.source.layout()}
      testid="layout-source"
      source={sourceOf({
        chosen: layoutName(layout.active),
        entry: layout.source ?? null,
        error: layout.specError ?? null,
      })}
    >
      {$LL.web.settings.customise.source.layout_overrides()}
    </ResourceSource>
  {/if}
  {#if part === 'shell'}<p class="text-xs text-base-content/70">{t.intro()}</p>{/if}

  <div class="mt-3 grid grid-cols-1 gap-3 @md:grid-cols-2">
    {#each SELECTS as field (field.id)}
      {#if pinned(field)}
        <div class="block">
          <span class="text-xs text-base-content/80">{say(field.id, field.id)}</span>
          <div class="mt-1 flex items-center gap-2">
            <span class="text-xs text-base-content" data-testid="layout-pinned:{field.id}">
              {t.pinned({ value: optionLabel(field, 'column') })}
            </span>
            <button
              type="button"
              class={smallBtn}
              data-testid="layout-unpin:{field.id}"
              aria-label={t.unpin_label({ what: say(field.id, field.id) })}
              onclick={() => field.pin && layout.unpin?.(field.pin)}
            >
              {t.unpin()}
            </button>
          </div>
        </div>
      {:else}
        <label class="block">
          <span class="text-xs text-base-content/80">{say(field.id, field.id)}</span>
          <select
            data-testid="layout-field:{field.id}"
            value={valueOf(layout.ownSpec, field.section, field.key)}
            onchange={(e) => set(field.section, field.key, e.currentTarget.value)}
            class={selectCls}
          >
            {#each optionsOf(field) as value (value)}
              <option {value}>{optionLabel(field, value)}</option>
            {/each}
          </select>
        </label>
      {/if}
    {/each}
  </div>

  {#each CHECKS as field (field.id)}
    <label class="mt-2 flex items-center gap-2 text-sm text-base-content/80">
      <input
        type="checkbox"
        data-testid="layout-field:{field.id}"
        checked={valueOf(layout.ownSpec, 'editor', field.key) === true}
        onchange={(e) => set('editor', field.key, e.currentTarget.checked)}
      />
      {say(field.label, field.id)}
    </label>
  {/each}

  {#if part === 'shell'}
    <label class="mt-3 block @md:w-1/2 @md:pr-1.5">
      <span class="text-xs text-base-content/80">{t.hints()}</span>
      <select
        data-testid="layout-field:hints"
        value={paneHints.value}
        onchange={(e) => paneHints.set(e.currentTarget.value as PaneHints)}
        class={selectCls}
      >
        {#each PANE_HINTS as value (value)}
          <option {value}>{hintLabel(value)}</option>
        {/each}
      </select>
    </label>
    <FormatBarPicker {layout} {registry} />
  {/if}

  <div class="mt-4 border-t border-base-300 pt-3">
    <button
      type="button"
      class={smallBtn}
      data-testid={part === 'shell' ? 'layout-reset' : 'layout-reset-editor'}
      disabled={!changed}
      onclick={resetPart}
    >
      {part === 'shell' ? t.reset() : t.reset_editor()}
    </button>
  </div>
</section>
