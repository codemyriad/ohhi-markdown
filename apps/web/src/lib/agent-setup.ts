/**
 * Settings › Agents (settings-shaping ST5, R7): what an agent can do with a
 * vault, and the lines that connect one to it — pure, so the quoting and the
 * snippets are unit-tested rather than eyeballed.
 *
 * Grounded in what exists today (docs/agent-access.md):
 *  - the `ohhi` CLI and `ohhi mcp` (apps/cli), installed from a checkout of
 *    the repo with `scripts/install-ohhi.sh` (Fork 6, the desktop sidecar, is
 *    deferred), and the `ohhi-vault` skill with `scripts/install-skill.sh`;
 *  - the vault named by `--vault <path>` or `OHHI_VAULT` (agent-access §3).
 *
 * The op groups are a hand-written, plain-words view of the contract
 * (`libs/agent/src/contract.ts` `OP_NAMES`). apps/web does not depend on
 * `@ohhi/agent`, so `agent-setup.test.ts` reads the contract's op list and
 * fails when an op is added, dropped or renamed without this list following.
 *
 * Desktop builds are Linux and macOS (docs/desktop-builds.md), so the shell
 * lines are POSIX.
 */

/** The contract's ops, grouped the way a person thinks of them. */
export type AgentCapability = 'find' | 'read' | 'collections' | 'links' | 'changes' | 'write' | 'move' | 'skills'

export const AGENT_CAPABILITIES: readonly { id: AgentCapability; ops: readonly string[] }[] = [
  { id: 'find', ops: ['search', 'ls', 'tags', 'stats'] },
  { id: 'read', ops: ['read', 'fm'] },
  { id: 'collections', ops: ['collections', 'rows'] },
  { id: 'links', ops: ['links', 'backlinks', 'unresolved', 'resolve'] },
  { id: 'changes', ops: ['changes'] },
  { id: 'write', ops: ['write', 'patch', 'append'] },
  { id: 'move', ops: ['mv', 'rm', 'restore'] },
  // The writing harness's skills (B9): read-only, from `.agents/skills/`.
  { id: 'skills', ops: ['skills', 'skill'] },
]

/** Stands in for the vault's folder where none is known (the manager's page, no vault open). */
export const PLACEHOLDER_VAULT_PATH = '/path/to/your/vault'

/**
 * Where `ohhi` comes from today: the Oh hi markdown repository on GitHub. It
 * is PRIVATE — the setup can only be followed with access to it, and every
 * surface that names it says so.
 */
export const REPO_URL = 'https://github.com/codemyriad/ohhi-markdown'

/**
 * Step one on every route: the checkout and its dependencies
 * (docs/running-and-testing.md §1–2 — Node 22, Rush through the repo's own
 * `install-run-rush.js`, so no global Rush is needed). `install-ohhi.sh`
 * builds the CLI and needs these installed first.
 */
export const GET_REPO = [
  'git clone git@github.com:codemyriad/ohhi-markdown.git',
  'cd ohhi-markdown',
  'node common/scripts/install-run-rush.js install',
].join('\n')

/** The repo's install scripts — today's only route to `ohhi` and the skill (Fork 6 deferred). */
export const INSTALL_OHHI = './scripts/install-ohhi.sh'
export const INSTALL_SKILL = './scripts/install-skill.sh'

/**
 * One shell word, safe in sh/bash/zsh. A plain double-quoted form while the
 * text has nothing a double quote would interpret (`"` `\` `$` `` ` `` and
 * `!`, which is history expansion in an interactive bash or zsh); otherwise
 * single quotes, where nothing is special and `'` is written `'\''`.
 */
export function shellQuote(text: string): string {
  if (!/["\\$`!]/.test(text)) return `"${text}"`
  return `'${text.replace(/'/g, `'\\''`)}'`
}

/** Claude Code, the skill route: the skill finds the vault through `OHHI_VAULT`. */
export function claudeCodeSkillLine(path: string): string {
  return `OHHI_VAULT=${shellQuote(path)} claude`
}

/** Claude Code, the MCP route: the vault fixed once, at server start (`ohhi mcp`). */
export function claudeMcpAddLine(path: string): string {
  return `claude mcp add ohhi -- ohhi mcp --vault ${shellQuote(path)}`
}

/** Any other MCP client: the `mcpServers` entry most clients read, JSON-escaped. */
export function mcpConfigJson(path: string): string {
  return JSON.stringify({ mcpServers: { ohhi: { command: 'ohhi', args: ['mcp', '--vault', path] } } }, null, 2)
}

/** The terminal: prove `ohhi` sees the vault, then a search. */
export function terminalLines(path: string): string[] {
  const vault = shellQuote(path)
  return [`ohhi stats --vault ${vault}`, `ohhi search "meeting notes" --vault ${vault}`, 'ohhi help']
}
