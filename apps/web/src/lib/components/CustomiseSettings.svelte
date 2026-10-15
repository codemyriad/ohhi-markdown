<script lang="ts">
  /**
   * Settings › Customise (settings-shaping ST4; quiet-shell F16 at last, and
   * Fork 8's "which root each name came from"): the shell as files, in one
   * overview.
   *
   *  - the roots in precedence order — this vault's `.ohhi/` → your config
   *    folder (desktop only, read-only) → built in — each with its folder;
   *  - one row per kind: what is in use, the root it came from (a pill), what
   *    it shadows, and every other name with its own pill;
   *  - the problems: every layout or keymap file that does not parse or
   *    validate, read fresh from the files on every change and reload, so a
   *    broken file stays listed until it is fixed (not a notice that scrolls
   *    away);
   *  - *Reload files* runs `app.reload-resources`, the palette's command;
   *  - read-only verbs: *Copy path* (the desktop app has no opener plugin, so
   *    there is no reveal or *Open folder* — the path is copied instead) and
   *    *Copy as JSON* (the resolved file in use);
   *  - a prompt to copy that hands the job to an agent, filled with the
   *    vault's folder.
   *
   * The derivations are `customise-overview.ts`; the loader's `overview()`
   * reads the roots. `Settings.svelte` draws the heading and the lede; with
   * no vault open it draws the "open a vault" notice instead (NEEDS_VAULT).
   *
   * QA round 1 (QA5, Fork 8): Customise is the umbrella in the nav and this
   * page is its hub. It opens with what is in use — one full-width row per
   * kind: the name and its source chip on one line, the detail line in full
   * (never ellipsised: it is the thing you came to read), and a door to the
   * part of Settings that chooses it (`env.openSection`). Then the roots, in
   * order with a › between them (no numbers: the order is the rule) and
   * *Reload files* on their eyebrow row; the files, a table with fixed
   * columns whose prose moved to the group's foot and *Show in Log* on the
   * eyebrow row; the problems; and asking an agent.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { CommandRegistry } from '../commands.js'
  import {
    filePath,
    kindRows,
    problemInUse,
    problemNames,
    rootLines,
    type KindRow,
    type ThemeInUse,
  } from '../customise-overview.js'
  import { openGuide as openGuidePage, type GuidePage } from '../guide.js'
  import { keymapFile, keymapName } from '../keymap-spec.js'
  import type { Keymap } from '../keymap.svelte.js'
  import { hasOverrides } from '../layout-spec.js'
  import { layoutName } from '../layout.js'
  import { RESOURCE_KINDS, type ResourceOverview, type Resources, type RootId } from '../resources.svelte.js'
  import { getSettingsEnv, type SettingsLayout } from '../settings-host.js'
  import { builtinThemeLabel, themePath, themeState } from '../theme.svelte.js'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import type { SettingsSection } from '../settings.js'
  import { BUTTON, BUTTON_SM, EYEBROW, GROUP, GROUP_ROW, LINK, META, MUTED, ROW, ROW_THING } from '../ui/styles.js'
  import RootPill from './RootPill.svelte'

  interface Props {
    /** `app.reload-resources` runs through it. */
    registry?: Pick<CommandRegistry, 'get'>
    resources?: Partial<Pick<Resources, 'overview' | 'onChange' | 'themes'>>
    layout?: SettingsLayout
    keymap?: Pick<Keymap, 'active' | 'resolved'>
    /** Injected for the tests. */
    write?: (text: string) => Promise<void>
    /** Opens a guide page; injected for the tests. */
    openGuide?: (page: GuidePage) => void
    /** Opens the Log on its Customise filter (`openView('log', 'customise')`); absent → not offered. */
    showLog?: () => void
  }

  let {
    registry,
    resources,
    layout,
    keymap,
    write = (text) => navigator.clipboard.writeText(text),
    openGuide = (page) => void openGuidePage(page),
    showLog,
  }: Props = $props()

  const env = getSettingsEnv()
  const t = $derived($LL.web.settings.customise)

  // ---- the files, read fresh on open, on every change and on reload ----
  let overview = $state<ResourceOverview | null>(null)
  let seq = 0
  async function load(): Promise<void> {
    const mine = ++seq
    const next = (await resources?.overview?.().catch(() => null)) ?? null
    if (mine === seq) overview = next
  }
  $effect(() => {
    const feed = resources?.onChange
    void load()
    if (!feed) return
    const offs = RESOURCE_KINDS.map((kind) => feed(kind, () => void load()))
    return () => offs.forEach((off) => off())
  })

  // ---- what is in use ----
  const theme = $derived<ThemeInUse>(
    themeState.fellBackFrom
      ? {
          builtin: true,
          name: builtinThemeLabel($LL, themeState.name) ?? themeState.name,
          fellBackFrom: themeState.fellBackFrom,
        }
      : themeState.pref.startsWith('custom:')
      ? {
          builtin: false,
          name: themeState.pref.slice('custom:'.length),
          path: themePath(themeState.pref.slice('custom:'.length)),
        }
      : { builtin: true, name: builtinThemeLabel($LL, themeState.name) ?? themeState.name }
  )
  const rows = $derived<KindRow[]>(
    kindRows({
      overview: overview ?? { entries: { layouts: [], keymaps: [], templates: [] } },
      layout: {
        chosen: layout?.active ? layoutName(layout.active) : 'default',
        entry: layout?.source ?? null,
        error: layout?.specError ?? null,
      },
      keymap: {
        chosen: keymap ? keymapName(keymap.active) : 'default',
        entry: keymap?.resolved?.entry ?? null,
        error: keymap?.resolved?.error ?? null,
      },
      theme,
      themes: resources?.themes ?? [],
    })
  )
  const problems = $derived(overview?.problems ?? [])
  const roots = $derived(rootLines({ roots: overview?.roots ?? null, vault: env.vault, desktop: env.desktop }))
  const deviceChanges = $derived(layout ? hasOverrides(layout.overrides) : false)

  // ---- verbs ----
  /**
   * Copy feedback (Agents' pattern): the button that copied says *Copied*
   * (or *Could not copy*) for two seconds, and one always-present live
   * region next to nothing else says it too — beside the button, not at the
   * foot of a long section, and it clears itself.
   */
  let done = $state<{ id: string; ok: boolean } | null>(null)
  let reset: ReturnType<typeof setTimeout> | undefined
  async function copy(id: string, text: string): Promise<void> {
    clearTimeout(reset)
    done = null
    try {
      await write(text)
      done = { id, ok: true }
    } catch {
      done = { id, ok: false }
    }
    reset = setTimeout(() => (done = null), 2000)
  }
  $effect(() => () => clearTimeout(reset))
  /** A copy button's word: *Copied* / *Could not copy* just after, else its own. */
  const said = (id: string, label: string): string =>
    done?.id === id ? (done.ok ? t.copied() : t.copy_failed()) : label
  const copyPath = (id: string, path: string, root: RootId): Promise<void> =>
    copy(id, filePath(path, root, env.vault))

  /** The resolved file a kind has in use, as JSON; null when there is none to copy. */
  function jsonOf(kind: KindRow['kind']): string | null {
    if (kind === 'layouts' && layout) return `${JSON.stringify($state.snapshot(layout.fileSpec), null, 2)}\n`
    if (kind === 'keymaps' && keymap) {
      const bindings = keymap.resolved ? $state.snapshot(keymap.resolved.bindings) : {}
      return `${JSON.stringify(keymapFile(bindings), null, 2)}\n`
    }
    return null
  }

  function reload(): void {
    const command = registry?.get('app.reload-resources')
    if (command) void command.run()
    else void load()
  }

  const prompt = $derived(env.vault?.kind === 'tauri' && env.vault.path ? t.agent_prompt({ vault: env.vault.path }) : null)
  const shadowsOf = (list: readonly RootId[]): string => list.map((r) => t.from[r]()).join(', ')

  const smallBtn = BUTTON_SM

  /** The part of Settings that chooses each kind: the hub's doors. Templates are inserted from the palette. */
  const DOOR: Record<KindRow['kind'], SettingsSection | null> = {
    layouts: 'layout',
    keymaps: 'keys',
    themes: 'appearance',
    templates: null,
  }
  /** The theme follows the system (the device chose `system`, not a theme by name). */
  const followsSystem = $derived(themeState.pref === 'system')
</script>

<div data-testid="settings-customise">
  <!-- What is in use (Fork 8): one full-width row per kind — the name and its
       source on one line, the detail in full, a door to the part that chooses it. -->
  <section aria-labelledby="customise-strip-h" data-testid="customise-strip">
    <div class={GROUP_ROW}>
      <h3 id="customise-strip-h" class="m-0 {EYEBROW}">{t.kinds()}</h3>
    </div>
    <ul class="m-0 list-none p-0">
      {#each rows as row (row.kind)}
        {@const door = DOOR[row.kind]}
        <li
          class="grid grid-cols-[minmax(0,1fr)_auto] {ROW} @md:grid-cols-[6.5rem_minmax(0,1fr)_auto]"
          data-testid="customise-strip:{row.kind}"
        >
          <span class="col-span-2 pt-1 text-[11px] font-semibold tracking-[0.06em] uppercase @md:col-span-1 @md:pt-0 {MUTED}"
            >{t.kind[row.kind]()}</span
          >
          <div class="min-w-0 py-1">
            {#if row.inUse}
              <p class="m-0 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span class="whitespace-nowrap {ROW_THING}">{row.inUse.name}</span>
                <RootPill root={row.inUse.root} />
              </p>
            {:else}
              <p class="m-0 {ROW_THING}">{t.templates_count({ count: row.total })}</p>
            {/if}
            <!-- The detail, in full: it wraps rather than being cut. -->
            {#if row.kind === 'layouts'}
              <p class="m-0 {META}">
                {#if deviceChanges}<span data-testid="customise-device-changes">{t.device_changes()}</span>{:else}{t.no_device_changes()}{/if}{#if row.inUse?.path}{' · '}<code class="font-ed-mono text-[11.5px] break-all">{row.inUse.path}</code>{/if}
              </p>
              {#if layout?.held}
                <p class="m-0 text-xs leading-[1.45] text-base-content" data-testid="customise-held">{t.held()}</p>
              {/if}
            {:else if row.kind === 'keymaps'}
              <p class="m-0 {META}">
                {#if row.inUse?.path}<code class="font-ed-mono text-[11.5px] break-all">{row.inUse.path}</code>{:else}{t.detail.ships()}{/if}{#if row.inUse?.shadows.length}{' · '}{t.shadows({ roots: shadowsOf(row.inUse.shadows) })}{/if}
              </p>
            {:else if row.kind === 'themes'}
              <p class="m-0 {META}">
                {#if row.inUse?.path}<code class="font-ed-mono text-[11.5px] break-all">{row.inUse.path}</code>{:else if followsSystem}{t.follows_system()}{:else}{t.detail.ships()}{/if}
              </p>
            {:else}
              <p class="m-0 {META}" data-testid="customise-templates">
                {#if row.others.length}{row.others.map((e) => e.name).join(', ')}{' · '}{/if}{t.templates_how()}
              </p>
            {/if}
            {#if row.fellBackFrom}
              <p class="m-0 text-xs leading-[1.45] text-error" data-testid="customise-fallback:{row.kind}">
                {t.fell_back({ name: row.fellBackFrom })}
              </p>
            {/if}
          </div>
          {#if door}
            <button
              type="button"
              class="{BUTTON_SM} self-center"
              data-testid="customise-door:{row.kind}"
              aria-label={t.door_label({ section: $LL.web.settings.nav[door]() })}
              onclick={() => env.openSection(door)}
            >
              {$LL.web.settings.nav[door]()}
              <ChevronRight size={12} strokeWidth={2} aria-hidden="true" />
            </button>
          {:else}
            <span></span>
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  <!-- The roots, in precedence order (Fork 8: the vault wins); › between them, no numbers. -->
  <section class={GROUP} aria-labelledby="customise-roots-h" data-testid="customise-roots">
    <div class={GROUP_ROW}>
      <h3 id="customise-roots-h" class="m-0 {EYEBROW}">{t.roots()}</h3>
      <button type="button" class="{BUTTON} ms-auto" data-testid="customise-reload" onclick={reload}>
        {t.reload()}
      </button>
    </div>
    <p class="m-0 mb-2 {META}">{t.roots_rule()}</p>
    <ol class="m-0 grid list-none gap-2 p-0 @lg:grid-cols-3">
      {#each roots as line, i (line.id)}
        <li
          class="relative min-w-0 rounded-lg border border-base-300 px-3 py-2 {line.detail === 'desktop-only' ||
          line.detail === 'no-vault'
            ? 'border-dashed'
            : ''}"
          data-testid="customise-root:{line.id}"
          data-detail={line.detail}
        >
          {#if i > 0}
            <span
              aria-hidden="true"
              class="absolute top-1/2 -left-[13px] hidden -translate-y-1/2 text-[13px] @lg:block {MUTED}">›</span
            >
          {/if}
          <p class="m-0 text-[13px] font-semibold text-base-content">{t.root[line.id]()}</p>
          <p class="m-0 {META}">
            {line.detail === 'browser'
              ? t.detail.browser({ name: env.vault?.name ?? '' })
              : line.detail === 'no-vault'
                ? t.detail.no_vault()
                : line.detail === 'read-only'
                  ? t.detail.read_only()
                  : line.detail === 'unreadable'
                    ? t.detail.unreadable()
                    : line.detail === 'desktop-only'
                      ? t.detail.desktop_only()
                      : line.detail === 'ships'
                        ? t.detail.ships()
                        : t.detail.disk()}
          </p>
          {#if line.path && line.copyable}
            <p class="m-0 mt-1 font-ed-mono text-[11px] break-all text-base-content" data-testid="customise-root-path:{line.id}">
              {line.path}
            </p>
            <button
              type="button"
              class="{smallBtn} mt-1"
              data-testid="customise-root-copy:{line.id}"
              aria-label={t.copy_path_label({ what: t.root[line.id]() })}
              onclick={() => void copy(`root:${line.id}`, line.path ?? '')}
            >
              {said(`root:${line.id}`, t.copy_path())}
            </button>
          {/if}
        </li>
      {/each}
    </ol>
    <p class="m-0 mt-2 {META}">{t.reload_hint()}{#if env.desktop}{' '}{t.no_reveal()}{/if}</p>
  </section>

  <!-- The files: fixed columns, one line per cell; below 28rem (a narrow pane) each row stacks as a card. -->
  <section class={GROUP} aria-labelledby="customise-kinds-h">
    <div class={GROUP_ROW}>
      <h3 id="customise-kinds-h" class="m-0 {EYEBROW}">{t.files()}</h3>
      {#if showLog}
        <button type="button" class="{LINK} ms-auto" data-testid="customise-show-log" onclick={showLog}>
          {t.show_in_log()}
        </button>
      {/if}
    </div>
    <table class="w-full table-fixed border-collapse text-left text-xs @max-md:block" data-testid="customise-kinds">
      <thead class="@max-md:hidden">
        <tr class="border-b border-base-300">
          <th scope="col" class="w-[6.5rem] py-1.5 pr-2 {EYEBROW}">{t.col_kind()}</th>
          <th scope="col" class="py-1.5 pr-2 {EYEBROW}">{t.col_in_use()}</th>
          <th scope="col" class="py-1.5 pr-2 {EYEBROW}">{t.col_also()}</th>
          <th scope="col" class="w-[8.5rem] py-1.5 text-right {EYEBROW}"><span class="sr-only">{t.col_actions()}</span></th>
        </tr>
      </thead>
      <tbody class="@max-md:block">
        {#each rows as row (row.kind)}
          {@const broken = problemNames(problems, row.kind)}
          {@const json = jsonOf(row.kind)}
          <tr class="h-9 border-b border-base-200 align-middle @max-md:block @max-md:h-auto @max-md:py-2" data-testid="customise-kind:{row.kind}">
            <th scope="row" class="truncate pr-2 font-medium text-base-content @max-md:block @max-md:p-0">{t.kind[row.kind]()}</th>
            <td class="truncate pr-2 @max-md:block @max-md:p-0 @max-md:pt-1 @max-md:whitespace-normal" data-testid="customise-in-use:{row.kind}">
              {#if row.inUse}
                <span class="font-semibold text-base-content">{row.inUse.name}</span>
                <RootPill root={row.inUse.root} />
                {#if row.inUse.shadows.length}
                  <span class={MUTED}>{t.shadows({ roots: shadowsOf(row.inUse.shadows) })}</span>
                {/if}
              {:else}
                <span class="font-semibold text-base-content">{t.templates_count({ count: row.total })}</span>
              {/if}
            </td>
            <td class="truncate pr-2 @max-md:block @max-md:p-0 @max-md:pt-1.5 @max-md:whitespace-normal">
              <span class="hidden @max-md:mb-0.5 @max-md:block {MUTED}">{t.col_also()}</span>
              {#if row.others.length === 0}
                <span class={MUTED}>{t.nothing_else()}</span>
              {:else}
                <ul class="m-0 inline list-none p-0 @max-md:flex @max-md:flex-wrap @max-md:gap-x-3 @max-md:gap-y-1">
                  {#each row.others as entry, i (entry.name)}
                    <li class="inline" data-testid="customise-entry:{row.kind}:{entry.name}">
                      {#if i > 0}<span class="me-1 @max-md:hidden {MUTED}">,</span>{/if}<span class="text-base-content">{entry.name}</span>
                      <RootPill root={entry.root} />
                      {#if entry.shadows.length}
                        <span class={MUTED}>{t.shadows({ roots: shadowsOf(entry.shadows) })}</span>
                      {/if}
                      {#if broken.has(entry.name)}<span class="text-error">{t.cant_use()}</span>{/if}
                    </li>
                  {/each}
                </ul>
              {/if}
            </td>
            <td class="text-right whitespace-nowrap @max-md:block @max-md:pt-1.5 @max-md:text-left">
              {#if row.inUse?.path}
                {@const path = row.inUse.path}
                {@const root = row.inUse.root}
                <button
                  type="button"
                  class={smallBtn}
                  data-testid="customise-copy-path:{row.kind}"
                  aria-label={t.copy_path_label({ what: path })}
                  onclick={() => void copyPath(`path:${row.kind}`, path, root)}
                >
                  {said(`path:${row.kind}`, t.copy_path())}
                </button>
              {/if}
              {#if json}
                <button
                  type="button"
                  class={smallBtn}
                  data-testid="customise-copy-json:{row.kind}"
                  aria-label={t.copy_json_label({ kind: t.kind[row.kind]() })}
                  onclick={() => void copy(`json:${row.kind}`, json)}
                >
                  {said(`json:${row.kind}`, t.copy_json())}
                </button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <!-- The prose the cells used to hold, at the group's foot. -->
    <p class="m-0 mt-2 {META}">{t.files_foot()}</p>
  </section>

  <!-- Problems: listed until fixed. -->
  <section class={GROUP} aria-labelledby="customise-problems-h" data-testid="customise-problems">
    <div class={GROUP_ROW}>
      <h3 id="customise-problems-h" class="m-0 {EYEBROW}">{t.problems()}</h3>
    </div>
    {#if problems.length === 0}
      <p class="m-0 {META}" data-testid="customise-problems-none">{t.problems_none()}</p>
    {:else}
      <p class="m-0 text-xs leading-[1.45] text-base-content">{t.problems_count({ count: problems.length })}</p>
      <ul class="m-0 mt-2 list-none space-y-2 p-0">
        {#each problems as problem (`${problem.kind}:${problem.name}`)}
          <li class="rounded-lg border border-error/40 px-3 py-2 text-xs" data-testid="customise-problem:{problem.path}">
            <div class="flex flex-wrap items-center gap-1.5">
              <code class="font-ed-mono font-semibold break-all text-base-content">{problem.path}</code>
              <RootPill root={problem.root} />
            </div>
            <p class="m-0 mt-1 break-words text-base-content" data-testid="customise-problem-message">{problem.message}</p>
            <p class="m-0 mt-0.5 {MUTED}">
              {problemInUse(problem, rows) ? t.problem_in_use() : t.problem_unused()}
            </p>
            <div class="mt-1 flex flex-wrap gap-1.5">
              <button
                type="button"
                class={smallBtn}
                data-testid="customise-problem-copy-error"
                onclick={() => void copy(`error:${problem.path}`, `${problem.path}: ${problem.message}`)}
              >
                {said(`error:${problem.path}`, t.copy_error())}
              </button>
              {#if problem.root !== 'builtin'}
                <button
                  type="button"
                  class={smallBtn}
                  data-testid="customise-problem-copy-path"
                  aria-label={t.copy_path_label({ what: problem.path })}
                  onclick={() => void copyPath(`problem:${problem.path}`, problem.path, problem.root)}
                >
                  {said(`problem:${problem.path}`, t.copy_path())}
                </button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- Hand the job to an agent; the guide on the eyebrow row. -->
  <section class={GROUP} aria-labelledby="customise-agent-h" data-testid="customise-agent">
    <div class={GROUP_ROW}>
      <h3 id="customise-agent-h" class="m-0 {EYEBROW}">{t.agent()}</h3>
      <!-- settings-shaping ST6: the guide page (`docs/guide/customise.md`). -->
      <button
        type="button"
        data-testid="customise-guide"
        aria-label={t.read_guide_label()}
        onclick={() => openGuide('customise')}
        class="{LINK} ms-auto"
      >
        {t.read_guide()}
      </button>
    </div>
    {#if prompt}
      <pre
        class="m-0 mt-1 rounded-md bg-base-200 px-3 py-2 font-ed-mono text-[11px] break-words whitespace-pre-wrap text-base-content"
        data-testid="customise-prompt">{prompt}</pre>
      <button type="button" class="{BUTTON} mt-2" data-testid="customise-copy-prompt" onclick={() => void copy('prompt', prompt ?? '')}>
        {said('prompt', t.copy_prompt())}
      </button>
    {:else}
      <p class="m-0 {META}" data-testid="customise-agent-browser">{t.agent_browser()}</p>
    {/if}
  </section>

  <p class="sr-only" role="status" data-testid="customise-status">
    {done ? (done.ok ? t.copied() : t.copy_failed()) : ''}
  </p>
</div>
