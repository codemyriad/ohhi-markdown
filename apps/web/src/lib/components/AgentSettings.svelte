<script lang="ts">
  /**
   * Settings › AI › Outside agents (settings-shaping ST5, R7; folded into AI
   * by QA round 1, Fork 11 — it was Settings › Agents): Claude Code, another
   * MCP client or a terminal working on this vault with the `ohhi` command.
   *
   * The third group on the AI page: an eyebrow row with *What an agent can
   * do* (a popover over `AGENT_CAPABILITIES`, a plain-words view of the
   * contract's ops — a unit test holds it to `OP_NAMES`) and *Read the guide*
   * (`docs/guide/agents.md`); one line of lede; then a segmented route picker
   * (Claude Code · MCP client · Terminal) over three numbered, copyable
   * lines, each with its caption, filled in with this vault's folder. Step 1
   * on every route is the checkout of the repository — private, so its
   * caption says access is needed — with Node 22 and its dependencies; then
   * the repo's install scripts (Fork 6, the desktop sidecar, is deferred — so
   * there is no "is it installed" probe either). Claude Code's MCP line is an
   * unnumbered alternative to its third line, not a fourth step.
   *
   * Where it is drawn decides what it says (`getSettingsEnv()`):
   *  - a folder vault (`tauri`, path known): the routes with its path;
   *  - a vault in browser storage (`opfs`) or memory: Fork 5 — the group
   *    stays, and says honestly that no agent can reach it, with the two ways
   *    to give one a folder on disk (a folder vault in the desktop app; or
   *    linking the desktop app from Sync & devices);
   *  - no vault (the manager's page): the routes with a placeholder path.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import {
    AGENT_CAPABILITIES,
    GET_REPO,
    INSTALL_OHHI,
    INSTALL_SKILL,
    PLACEHOLDER_VAULT_PATH,
    claudeCodeSkillLine,
    claudeMcpAddLine,
    mcpConfigJson,
    terminalLines,
  } from '../agent-setup.js'
  import { openGuide as openGuidePage, type GuidePage } from '../guide.js'
  import { getSettingsEnv } from '../settings-host.js'
  import Popover from '../ui/Popover.svelte'
  import { BUTTON, BUTTON_SM, EYEBROW, GROUP_ROW, LINK, META } from '../ui/styles.js'
  import { Tabs } from '../ui/index.js'

  interface Props {
    /** Injected for the tests; the system clipboard otherwise. */
    writeClipboard?: (text: string) => Promise<void>
    /** Opens a guide page; injected for the tests. */
    openGuide?: (page: GuidePage) => void
  }

  let {
    writeClipboard = (text) => navigator.clipboard.writeText(text),
    openGuide = (page) => void openGuidePage(page),
  }: Props = $props()

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

  /** One numbered line of a route: what it does (its caption), the text to copy, and a note. */
  interface Line {
    id: string
    label: string
    text: string
    note?: string
    noteTestid?: string
  }
  const repoLine = $derived<Line>({
    id: 'get-repo',
    label: t.step_repo(),
    text: GET_REPO,
    note: t.repo_note(),
    noteTestid: 'agents-get',
  })
  const lines = $derived<Record<string, Line[]>>({
    claude: [
      repoLine,
      { id: 'install-both', label: t.step_install_both(), text: `${INSTALL_OHHI} && ${INSTALL_SKILL}`, note: t.install_note() },
      { id: 'claude-skill', label: t.claude_start(), text: claudeCodeSkillLine(path), note: t.claude_note() },
    ],
    mcp: [
      repoLine,
      { id: 'install-ohhi', label: t.step_install(), text: INSTALL_OHHI },
      { id: 'mcp-json', label: t.mcp_config(), text: mcpConfigJson(path), note: t.mcp_note() },
    ],
    terminal: [
      repoLine,
      { id: 'install-ohhi', label: t.step_install(), text: INSTALL_OHHI },
      { id: 'terminal', label: t.terminal_try(), text: terminalLines(path).join('\n') },
    ],
  })

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

  /** *What an agent can do*: the capabilities, in a popover off the eyebrow row. */
  let capsAnchor = $state<HTMLElement | null>(null)
  let capsOpen = $state(false)

  const pre =
    'm-0 min-w-0 flex-1 rounded-md bg-base-200 px-2.5 py-1.5 font-ed-mono text-[11.5px] leading-normal whitespace-pre-wrap break-all text-base-content'
  const stepNumber =
    'mt-1 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-base-200 text-[10.5px] font-semibold text-base-content'
</script>

{#snippet code(id: string, text: string, what: string)}
  <div class="flex items-start gap-2">
    <pre class={pre} data-testid="agents-code:{id}">{text}</pre>
    <button
      type="button"
      data-testid="agents-copy:{id}"
      aria-label={t.copy_what({ what })}
      onclick={() => void copy(id, text)}
      class="{BUTTON_SM} mt-1"
    >
      {copied === id ? t.copied() : t.copy()}
    </button>
  </div>
{/snippet}

<section data-testid="settings-agents" aria-labelledby="agents-title">
  <div class={GROUP_ROW}>
    <h3 id="agents-title" class="m-0 {EYEBROW}">{t.title()}</h3>
    <span class="ms-auto flex items-center gap-3">
      <button
        type="button"
        bind:this={capsAnchor}
        class={LINK}
        aria-expanded={capsOpen}
        data-testid="agents-can-do-open"
        onclick={() => (capsOpen = !capsOpen)}>{t.can_do()}</button
      >
      <button
        type="button"
        data-testid="agents-guide"
        aria-label={t.read_guide_label()}
        onclick={() => openGuide('agents')}
        class={LINK}
      >
        {t.read_guide()}
      </button>
    </span>
  </div>
  {#if capsOpen}
    <Popover anchor={capsAnchor} placement="bottom-end" title={t.can_do()} testid="agents-can-do-popover" onClose={() => (capsOpen = false)}>
      <div class="max-w-sm p-3">
        <ul class="m-0 list-none space-y-1.5 p-0" data-testid="agents-can-do">
          {#each AGENT_CAPABILITIES as cap (cap.id)}
            <li class="text-xs leading-[1.45] text-base-content">
              {t.cap[cap.id]()}
              <span class="ml-1 font-ed-mono text-[11px] text-base-content/70">{cap.ops.join(' · ')}</span>
            </li>
          {/each}
        </ul>
        <p class="m-0 mt-2 {META}">{t.mcp_tools()}</p>
      </div>
    </Popover>
  {/if}
  <p class="m-0 mb-3 {META}">{t.intro()}</p>

  {#if unreachable}
    <div class="rounded-lg border border-dashed border-base-300 px-3 py-2.5" data-testid="agents-unreachable">
      <p class="m-0 text-[13px] font-medium text-base-content">{t.browser_title()}</p>
      <p class="m-0 mt-1 {META}">{t.browser_body()}</p>
      <ol class="m-0 mt-1.5 list-decimal space-y-1 pl-5 text-xs leading-[1.45] text-base-content">
        <li>{t.browser_desktop()}</li>
        <li>{t.browser_link()}</li>
      </ol>
      <button type="button" data-testid="agents-open-sync" onclick={() => env.openSection('sync')} class="{BUTTON} mt-2">
        {t.open_sync()}
      </button>
    </div>
  {:else}
    <div data-testid="agents-connect">
      {#if folder === null}
        <p class="m-0 mb-2 {META}" data-testid="agents-placeholder">
          {t.placeholder()}
          {#if !env.desktop}{t.placeholder_browser()}{/if}
        </p>
      {/if}
      <Tabs tabs={routes} bind:value={route} label={t.routes()} testid="agents-routes" size="segmented">
        {#snippet panel(value)}
          <ol class="m-0 list-none space-y-2.5 p-0">
            {#each lines[value] ?? [] as line, i (line.id)}
              <li class="flex gap-2.5">
                <span class={stepNumber} aria-hidden="true">{i + 1}</span>
                <div class="min-w-0 flex-1">
                  {@render code(line.id, line.text, line.label)}
                  <p class="m-0 mt-1 {META}" data-testid={line.noteTestid}>
                    <span class="text-base-content">{line.label}.</span>
                    {#if line.note}{line.note}{/if}
                  </p>
                </div>
              </li>
            {/each}
          </ol>
          {#if value === 'claude'}
            <div class="mt-2.5 pl-7" data-testid="agents-claude-instead">
              {@render code('claude-mcp', claudeMcpAddLine(path), t.claude_mcp())}
              <p class="m-0 mt-1 {META}"><span class="text-base-content">{t.claude_mcp_instead()}.</span></p>
            </div>
          {/if}
        {/snippet}
      </Tabs>
      <p class="sr-only" role="status" data-testid="agents-copy-status">
        {failed ? t.copy_failed() : copied ? t.copied() : ''}
      </p>
      {#if failed}
        <p class="m-0 mt-2 text-xs text-error" aria-hidden="true">{t.copy_failed()}</p>
      {/if}
    </div>
  {/if}
</section>
