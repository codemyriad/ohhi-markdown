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
   * reads the roots. `Settings.svelte` draws the heading; with no vault open
   * it draws the "open a vault" notice instead (NEEDS_VAULT).
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
  import { HEADING, OUTLINE_BUTTON } from '../ui/styles.js'
  import RootPill from './RootPill.svelte'

  interface Props {
    /** `app.reload-resources` runs through it. */
    registry?: Pick<CommandRegistry, 'get'>
    resources?: Partial<Pick<Resources, 'overview' | 'onChange'>>
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
    themeState.pref.startsWith('custom:')
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

  const smallBtn = `${OUTLINE_BUTTON} px-2 py-0.5 text-xs font-medium text-base-content/80`
</script>

<div data-testid="settings-customise" class="space-y-5">
  <!-- The roots, in precedence order (Fork 8: the vault wins). -->
  <section aria-labelledby="customise-roots-h" data-testid="customise-roots">
    <h3 id="customise-roots-h" class={HEADING}>{t.roots()}</h3>
    <p class="mt-1 text-xs text-base-content/70">{t.roots_rule()}</p>
    <ol class="mt-2 grid gap-2 @lg:grid-cols-3">
      {#each roots as line, i (line.id)}
        <li class="rounded border border-base-300 px-3 py-2" data-testid="customise-root:{line.id}" data-detail={line.detail}>
          <p class="text-xs font-semibold text-base-content"><span aria-hidden="true">{i + 1} · </span>{t.root[line.id]()}</p>
          <p class="mt-0.5 text-xs text-base-content/80">
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
            <p class="mt-1 break-all font-ed-mono text-[11px] text-base-content/80" data-testid="customise-root-path:{line.id}">
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
    {#if env.desktop}<p class="mt-1 text-xs text-base-content/70">{t.no_reveal()}</p>{/if}
  </section>

  <!-- One row per kind; below 28rem (a narrow pane) each row stacks as a card. -->
  <section aria-labelledby="customise-kinds-h">
    <h3 id="customise-kinds-h" class={HEADING}>{t.kinds()}</h3>
    <table class="mt-2 w-full border-collapse text-left text-xs @max-md:block" data-testid="customise-kinds">
      <thead class="@max-md:hidden">
        <tr class="border-b border-base-300 text-base-content/80">
          <th scope="col" class="py-1 pr-3 font-medium">{t.col_kind()}</th>
          <th scope="col" class="py-1 pr-3 font-medium">{t.col_in_use()}</th>
          <th scope="col" class="py-1 font-medium">{t.col_also()}</th>
        </tr>
      </thead>
      <tbody class="@max-md:block">
        {#each rows as row (row.kind)}
          {@const broken = problemNames(problems, row.kind)}
          {@const json = jsonOf(row.kind)}
          <tr class="border-b border-base-300 align-top @max-md:block @max-md:py-2" data-testid="customise-kind:{row.kind}">
            <th scope="row" class="py-2 pr-3 font-medium text-base-content @max-md:block @max-md:p-0">{t.kind[row.kind]()}</th>
            <td class="py-2 pr-3 @max-md:block @max-md:p-0 @max-md:pt-1" data-testid="customise-in-use:{row.kind}">
              {#if row.inUse}
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="font-semibold text-base-content">{row.inUse.name}</span>
                  <RootPill root={row.inUse.root} />
                  {#if row.inUse.shadows.length}
                    <span class="text-base-content/80">{t.shadows({ roots: shadowsOf(row.inUse.shadows) })}</span>
                  {/if}
                </div>
                {#if row.kind === 'layouts' && layout?.held}
                  <p class="mt-0.5 text-base-content/80" data-testid="customise-held">{t.held()}</p>
                {/if}
                {#if row.kind === 'layouts' && deviceChanges}
                  <p class="mt-0.5 text-base-content/70" data-testid="customise-device-changes">{t.device_changes()}</p>
                {/if}
                {#if row.fellBackFrom}
                  <p class="mt-0.5 text-error" data-testid="customise-fallback:{row.kind}">
                    {t.fell_back({ name: row.fellBackFrom })}
                  </p>
                {/if}
                {#if row.inUse.path}
                  <p class="mt-0.5 break-all font-ed-mono text-[11px] text-base-content/80">{row.inUse.path}</p>
                {/if}
                {#if row.inUse.path || json}
                  <div class="mt-1 flex flex-wrap gap-1.5">
                    {#if row.inUse.path}
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
                  </div>
                {/if}
              {:else}
                <p class="font-semibold text-base-content">{t.templates_count({ count: row.total })}</p>
                <p class="mt-0.5 text-base-content/70">{t.templates_how()}</p>
              {/if}
            </td>
            <td class="py-2 @max-md:block @max-md:p-0 @max-md:pt-1.5">
              <span class="hidden text-base-content/70 @max-md:mb-0.5 @max-md:block">{t.col_also()}</span>
              {#if row.kind === 'themes'}
                <p class="text-base-content/70">{t.themes_how()}</p>
              {:else if row.others.length === 0}
                <span class="text-base-content/70">{t.nothing_else()}</span>
              {:else}
                <ul class="flex flex-wrap gap-x-3 gap-y-1">
                  {#each row.others as entry (entry.name)}
                    <li class="flex items-center gap-1" data-testid="customise-entry:{row.kind}:{entry.name}">
                      <span class="text-base-content">{entry.name}</span>
                      <RootPill root={entry.root} />
                      {#if entry.shadows.length}
                        <span class="text-base-content/80">{t.shadows({ roots: shadowsOf(entry.shadows) })}</span>
                      {/if}
                      {#if broken.has(entry.name)}<span class="text-error">{t.cant_use()}</span>{/if}
                    </li>
                  {/each}
                </ul>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <!-- Problems: listed until fixed. -->
  <section aria-labelledby="customise-problems-h" data-testid="customise-problems">
    <h3 id="customise-problems-h" class={HEADING}>{t.problems()}</h3>
    {#if problems.length === 0}
      <p class="mt-1 text-xs text-base-content/70" data-testid="customise-problems-none">{t.problems_none()}</p>
    {:else}
      <p class="mt-1 text-xs text-base-content/80">{t.problems_count({ count: problems.length })}</p>
      <ul class="mt-2 space-y-2">
        {#each problems as problem (`${problem.kind}:${problem.name}`)}
          <li class="rounded border border-error/40 px-3 py-2 text-xs" data-testid="customise-problem:{problem.path}">
            <div class="flex flex-wrap items-center gap-1.5">
              <code class="break-all font-ed-mono font-semibold text-base-content">{problem.path}</code>
              <RootPill root={problem.root} />
            </div>
            <p class="mt-1 break-words text-base-content" data-testid="customise-problem-message">{problem.message}</p>
            <p class="mt-0.5 text-base-content/70">
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
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="{OUTLINE_BUTTON} px-3 py-1.5 text-xs font-medium text-base-content/80"
        data-testid="customise-reload"
        onclick={reload}
      >
        {t.reload()}
      </button>
      {#if showLog}
        <button
          type="button"
          class="{OUTLINE_BUTTON} px-3 py-1.5 text-xs font-medium text-base-content/80"
          data-testid="customise-show-log"
          onclick={showLog}
        >
          {t.show_in_log()}
        </button>
      {/if}
      <p class="text-xs text-base-content/70">{t.reload_hint()}</p>
    </div>
  </section>

  <!-- Hand the job to an agent. -->
  <section aria-labelledby="customise-agent-h" data-testid="customise-agent">
    <h3 id="customise-agent-h" class={HEADING}>{t.agent()}</h3>
    {#if prompt}
      <pre
        class="mt-2 whitespace-pre-wrap break-words rounded border border-base-300 bg-base-200 px-3 py-2 font-ed-mono text-[11px] text-base-content"
        data-testid="customise-prompt">{prompt}</pre>
      <button
        type="button"
        class="{OUTLINE_BUTTON} mt-2 px-3 py-1.5 text-xs font-medium text-base-content/80"
        data-testid="customise-copy-prompt"
        onclick={() => void copy('prompt', prompt ?? '')}
      >
        {said('prompt', t.copy_prompt())}
      </button>
    {:else}
      <p class="mt-1 text-xs text-base-content/80" data-testid="customise-agent-browser">{t.agent_browser()}</p>
    {/if}
    <!-- settings-shaping ST6: the guide page (`docs/guide/customise.md`). -->
    <p class="mt-3">
      <button
        type="button"
        data-testid="customise-guide"
        aria-label={t.read_guide_label()}
        onclick={() => openGuide('customise')}
        class="text-xs font-medium text-base-content underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
      >
        {t.read_guide()}
      </button>
    </p>
  </section>

  <p class="sr-only" role="status" data-testid="customise-status">
    {done ? (done.ok ? t.copied() : t.copy_failed()) : ''}
  </p>
</div>
