<script lang="ts">
  /**
   * Settings › Layout (round 3, Q6): ONE form over this device's layout
   * overrides (`config.layout.overrides`). Every control applies at once —
   * the shell re-renders under the dialog — and persists as it changes: no
   * Save, no names, no files, nothing for the close guard to hold. Only the
   * fields worth exposing are here, each labelled from the dictionary; a
   * side this device pins as a column (P7) reads *(pinned)* with *Unpin*
   * beside it, since the pin wins over the field. *Reset to default* drops
   * every override, back to the layout file's own settings.
   *
   * What is stored is the minimal delta over the active file
   * (`overridesFor` — a field set back to the file's value stops being an
   * override); choosing a FILE is the palette's *Use layout file…*.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { hasOverrides, overridesFor, type ShellSpec } from '../layout-spec.js'
  import type { PinSide } from '../pin-layout.js'
  import type { ShellLayout } from '../shell-layout.svelte.js'

  interface Props {
    layout: Pick<ShellLayout, 'fileSpec' | 'ownSpec' | 'overrides' | 'setOverrides' | 'resetOverrides'> &
      Partial<Pick<ShellLayout, 'pins' | 'unpin'>>
  }

  let { layout }: Props = $props()

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
  }
  const SELECTS: readonly Select[] = [
    { id: 'files', section: 'regions', key: 'navigator', options: ['drawer', 'column'], pin: 'navigator' },
    { id: 'sidebar', section: 'regions', key: 'rail', options: ['dock', 'column'], pin: 'rail' },
    { id: 'sidebar_position', section: 'dock', key: 'position', options: ['top-right', 'bottom-right'] },
    { id: 'tabs', section: 'regions', key: 'tabs', options: ['auto', 'always'] },
    { id: 'toolbar', section: 'toolbar', key: 'position', options: ['top', 'bottom'] },
    { id: 'format', section: 'regions', key: 'format', options: ['bottom', 'top', 'off'] },
    { id: 'status', section: 'regions', key: 'status', options: ['corner', 'off'] },
    { id: 'open', section: 'panes', key: 'open', options: ['replace', 'tab'] },
    { id: 'measure', section: 'editor', key: 'measure', options: ['narrow', 'comfortable', 'wide'] },
  ]
  const CHECKS: readonly { id: string; label: string; key: string }[] = [
    { id: 'typewriter', label: 'typewriter', key: 'typewriter' },
    { id: 'inline-title', label: 'inline_title', key: 'inlineTitle' },
  ]

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
    layout.setOverrides(overridesFor($state.snapshot(layout.fileSpec) as ShellSpec, next))
  }

  const selectCls =
    'mt-1 w-full rounded border border-base-300 bg-base-100 px-2 py-1 text-xs focus:border-primary focus:outline-none'
  const smallBtn =
    'rounded border border-base-300 px-2 py-0.5 text-xs font-medium text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50'
</script>

<section data-testid="settings-layout">
  <p class="text-xs text-base-content/70">{t.intro()}</p>

  <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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

  <div class="mt-4 border-t border-base-300 pt-3">
    <button
      type="button"
      class={smallBtn}
      data-testid="layout-reset"
      disabled={!hasOverrides(layout.overrides)}
      onclick={() => layout.resetOverrides()}
    >
      {t.reset()}
    </button>
  </div>
</section>
