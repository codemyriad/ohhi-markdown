<script lang="ts">
  /**
   * Settings › Agents (settings-shaping ST5, R7; the user's note
   * "instructions / easy setup / basic exposure to the Oh hi CLI/MCP").
   * `Settings.svelte` draws the heading. In order:
   *
   *  1. What an agent can do here — `AGENT_CAPABILITIES`, a plain-words view
   *     of the contract's ops (a unit test holds it to `OP_NAMES`).
   *  2. Connect one — three routes as tabs (Claude Code, another MCP client,
   *     the terminal), every line filled in with this vault's folder and
   *     copyable, plus how `ohhi` itself is got today: the repo's install
   *     scripts (Fork 6, the desktop sidecar, is deferred — so there is no
   *     "is it installed" probe either).
   *
   * Where it is drawn decides what it says (`getSettingsEnv()`):
   *  - a folder vault (`tauri`, path known): the routes with its path;
   *  - a vault in browser storage (`opfs`) or memory: Fork 5 — the section
   *    stays, and says honestly that no agent can reach it, with the two ways
   *    to give one a folder on disk (a folder vault in the desktop app; or
   *    linking the desktop app from Sync & devices, which keeps a copy as
   *    files in a folder it picks — `manager.linkThisDevice`);
   *  - no vault (the manager's page): the routes with a placeholder path.
   *
   * Recent agent activity waits for spike S22 (attribution) and is not drawn.
   * There is no guide page for agent access yet (settings-shaping ST6), so
   * the reference is named, not linked.
   */
  import type { Snippet } from 'svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import {
    AGENT_CAPABILITIES,
    INSTALL_OHHI,
    INSTALL_SKILL,
    PLACEHOLDER_VAULT_PATH,
    claudeCodeSkillLine,
    claudeMcpAddLine,
    mcpConfigJson,
    terminalLines,
  } from '../agent-setup.js'
  import { getSettingsEnv } from '../settings-host.js'
  import { HEADING, OUTLINE_BUTTON } from '../ui/styles.js'
  import { Tabs } from '../ui/index.js'

  interface Props {
    /** Injected for the tests; the system clipboard otherwise. */
    writeClipboard?: (text: string) => Promise<void>
  }

  let { writeClipboard = (text) => navigator.clipboard.writeText(text) }: Props = $props()

  const env = getSettingsEnv()
  const t = $derived($LL.web.settings.agents)

  const vault = $derived(env.vault)
  /** The vault's folder on disk, when it has one. */
  const folder = $derived(vault?.kind === 'tauri' && vault.path ? vault.path : null)
  /** A vault is open, but it lives in browser storage or memory: no agent can reach it. */
  const unreachable = $derived(env.vaultOpen && vault !== null && folder === null)
  const path = $derived(folder ?? PLACEHOLDER_VAULT_PATH)

  let route = $state('claude')
  const routes = $derived([
    { value: 'claude', label: t.route_claude(), testid: 'agents-route:claude' },
    { value: 'mcp', label: t.route_mcp(), testid: 'agents-route:mcp' },
    { value: 'terminal', label: t.route_terminal(), testid: 'agents-route:terminal' },
  ])

  /** Which snippet was just copied (or failed to), for the button's word and the status line. */
  let copied = $state<string | null>(null)
  let failed = $state(false)
  let reset: ReturnType<typeof setTimeout> | undefined

  async function copy(id: string, text: string): Promise<void> {
    clearTimeout(reset)
    try {
      await writeClipboard(text)
      copied = id
      failed = false
    } catch {
      copied = null
      failed = true
    }
    reset = setTimeout(() => {
      copied = null
      failed = false
    }, 2000)
  }

  $effect(() => () => clearTimeout(reset))

  const pre =
    'min-w-0 flex-1 rounded border border-base-300 bg-base-200 px-2 py-1.5 font-ed-mono text-xs whitespace-pre-wrap break-all text-base-content'
  const stepNumber =
    'flex size-5 shrink-0 items-center justify-center rounded-full border border-base-300 text-[11px] font-semibold text-base-content/80'
</script>

{#snippet code(id: string, text: string, what: string)}
  <div class="mt-1.5 flex items-start gap-2">
    <pre class={pre} data-testid="agents-code:{id}">{text}</pre>
    <button
      type="button"
      data-testid="agents-copy:{id}"
      aria-label={t.copy_what({ what })}
      onclick={() => void copy(id, text)}
      class="{OUTLINE_BUTTON} shrink-0 px-2 py-1 text-xs font-medium text-base-content/80"
    >
      {copied === id ? t.copied() : t.copy()}
    </button>
  </div>
{/snippet}

{#snippet step(n: number, label: string, body: Snippet)}
  <li class="flex gap-2.5">
    <span class={stepNumber} aria-hidden="true">{n}</span>
    <div class="min-w-0 flex-1">
      <p class="text-sm text-base-content">{label}</p>
      {@render body()}
    </div>
  </li>
{/snippet}

<div data-testid="settings-agents">
  <p class="text-xs text-base-content/70">{t.intro()}</p>

  {#if unreachable}
    <section class="mt-4 rounded-lg border border-base-300 bg-base-200 p-3" data-testid="agents-unreachable">
      <h3 class="text-sm font-semibold text-base-content">{t.browser_title()}</h3>
      <p class="mt-1 text-sm text-base-content/80">{t.browser_body()}</p>
      <ol class="mt-2 list-decimal space-y-1 pl-5 text-sm text-base-content/80">
        <li>{t.browser_desktop()}</li>
        <li>
          {t.browser_link()}
          <button
            type="button"
            data-testid="agents-open-sync"
            onclick={() => env.openSection('sync')}
            class="{OUTLINE_BUTTON} mt-1.5 block px-2.5 py-1 text-xs font-medium text-base-content/80"
          >
            {t.open_sync()}
          </button>
        </li>
      </ol>
    </section>
  {/if}

  <section class="mt-5 border-t border-base-300 pt-4">
    <h3 class={HEADING}>{t.can_do()}</h3>
    <ul class="mt-2 space-y-1.5" data-testid="agents-can-do">
      {#each AGENT_CAPABILITIES as cap (cap.id)}
        <li class="text-sm text-base-content/80">
          {t.cap[cap.id]()}
          <span class="ml-1 font-ed-mono text-xs text-base-content/70">{cap.ops.join(' · ')}</span>
        </li>
      {/each}
    </ul>
    <p class="mt-2 text-xs text-base-content/70">{t.mcp_tools()}</p>
  </section>

  {#if !unreachable}
    <section class="mt-5 border-t border-base-300 pt-4" data-testid="agents-connect">
      <h3 class={HEADING}>{t.connect()}</h3>
      {#if folder === null}
        <p class="mt-1 text-xs text-base-content/70" data-testid="agents-placeholder">
          {t.placeholder()}
          {#if !env.desktop}{t.placeholder_browser()}{/if}
        </p>
      {/if}
      <p class="mt-2 text-sm text-base-content/80" data-testid="agents-get">{t.get_body()}</p>
      <div class="mt-3">
        <Tabs tabs={routes} bind:value={route} label={t.routes()} testid="agents-routes">
          {#snippet panel(value)}
            {#if value === 'claude'}
              <ol class="space-y-3">
                {#snippet install()}
                  {@render code('install-ohhi', INSTALL_OHHI, INSTALL_OHHI)}
                  {@render code('install-skill', INSTALL_SKILL, INSTALL_SKILL)}
                {/snippet}
                {#snippet start()}
                  {@render code('claude-skill', claudeCodeSkillLine(path), t.claude_start())}
                  <p class="mt-1 text-xs text-base-content/70">{t.claude_note()}</p>
                {/snippet}
                {#snippet mcp()}
                  {@render code('claude-mcp', claudeMcpAddLine(path), t.claude_mcp())}
                {/snippet}
                {@render step(1, t.step_install_both(), install)}
                {@render step(2, t.claude_start(), start)}
                {@render step(3, t.claude_mcp(), mcp)}
              </ol>
            {:else if value === 'mcp'}
              <ol class="space-y-3">
                {#snippet install()}
                  {@render code('install-ohhi', INSTALL_OHHI, INSTALL_OHHI)}
                {/snippet}
                {#snippet config()}
                  {@render code('mcp-json', mcpConfigJson(path), t.mcp_config())}
                  <p class="mt-1 text-xs text-base-content/70">{t.mcp_note()}</p>
                {/snippet}
                {@render step(1, t.step_install(), install)}
                {@render step(2, t.mcp_config(), config)}
              </ol>
            {:else}
              <ol class="space-y-3">
                {#snippet install()}
                  {@render code('install-ohhi', INSTALL_OHHI, INSTALL_OHHI)}
                {/snippet}
                {#snippet tryIt()}
                  {@render code('terminal', terminalLines(path).join('\n'), t.terminal_try())}
                {/snippet}
                {@render step(1, t.step_install(), install)}
                {@render step(2, t.terminal_try(), tryIt)}
              </ol>
            {/if}
          {/snippet}
        </Tabs>
      </div>
      <p class="mt-1 sr-only" role="status" data-testid="agents-copy-status">
        {failed ? t.copy_failed() : copied ? t.copied() : ''}
      </p>
      {#if failed}
        <p class="mt-2 text-xs text-error" aria-hidden="true">{t.copy_failed()}</p>
      {/if}
    </section>
  {/if}

  <p class="mt-5 border-t border-base-300 pt-4 text-xs text-base-content/70">{t.guide()}</p>
</div>
