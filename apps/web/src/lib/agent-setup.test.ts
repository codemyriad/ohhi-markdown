/**
 * Settings › Agents' lines (settings-shaping ST5): every copyable line must
 * work when pasted — paths with spaces, quotes, `$` and `!` stay one shell
 * word, the MCP config is valid JSON naming the exact path — and the op
 * groups can't drift from the agent contract.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  AGENT_CAPABILITIES,
  claudeCodeSkillLine,
  claudeMcpAddLine,
  mcpConfigJson,
  shellQuote,
  terminalLines,
} from './agent-setup.js'

/** `OP_NAMES` from libs/agent's contract (apps/web doesn't depend on `@ohhi/agent`, so read the source). */
function contractOpNames(): string[] {
  const src = readFileSync(fileURLToPath(new URL('../../../../libs/agent/src/contract.ts', import.meta.url)), 'utf8')
  const block = /export const OP_NAMES = \[([\s\S]*?)\] as const/.exec(src)
  if (!block) throw new Error('OP_NAMES not found in libs/agent/src/contract.ts')
  return [...block[1]!.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!)
}

/** What `sh` hands a program for `words` — the real parser, not a model of it. */
function shWords(words: string): string[] {
  const out = execFileSync('sh', ['-c', `for a in ${words}; do printf '%s\\0' "$a"; done`], { encoding: 'utf8' })
  return out.split('\0').slice(0, -1)
}

const AWKWARD = [
  '/home/me/black book',
  "/home/me/it's mine",
  '/home/me/"quoted"',
  '/home/me/$HOME and `date`',
  '/home/me/wow!',
  '/home/me/back\\slash',
  "/a/'\"$`!\\ all of it",
  '/plain/path',
]

describe('the op groups', () => {
  it('cover every contract op exactly once', () => {
    const grouped = AGENT_CAPABILITIES.flatMap((c) => c.ops)
    expect(new Set(grouped).size).toBe(grouped.length)
    expect([...grouped].sort()).toEqual(contractOpNames().sort())
  })
})

describe('shellQuote', () => {
  it('uses plain double quotes when nothing in the path is special', () => {
    expect(shellQuote('/home/me/black book')).toBe('"/home/me/black book"')
    expect(shellQuote("/home/me/it's mine")).toBe(`"/home/me/it's mine"`)
  })

  it('falls back to single quotes, escaping a quote as \'\\\'\'', () => {
    expect(shellQuote('/a/$x')).toBe("'/a/$x'")
    expect(shellQuote("/a/it's $x")).toBe(`'/a/it'\\''s $x'`)
  })

  it.each(AWKWARD)('is one word that sh reads back unchanged: %s', (path) => {
    expect(shWords(shellQuote(path))).toEqual([path])
  })
})

describe('the lines', () => {
  const path = '/home/me/black book'

  it('name the vault the way the CLI reads it', () => {
    expect(claudeCodeSkillLine(path)).toBe('OHHI_VAULT="/home/me/black book" claude')
    expect(claudeMcpAddLine(path)).toBe('claude mcp add ohhi -- ohhi mcp --vault "/home/me/black book"')
    expect(terminalLines(path)).toEqual([
      'ohhi stats --vault "/home/me/black book"',
      'ohhi search "meeting notes" --vault "/home/me/black book"',
      'ohhi help',
    ])
  })

  it.each(AWKWARD)('keep the path one argument after `--vault`: %s', (p) => {
    const words = shWords(claudeMcpAddLine(p))
    expect(words).toEqual(['claude', 'mcp', 'add', 'ohhi', '--', 'ohhi', 'mcp', '--vault', p])
  })

  it.each(AWKWARD)('give an MCP client valid JSON with the exact path: %s', (p) => {
    expect(JSON.parse(mcpConfigJson(p))).toEqual({
      mcpServers: { ohhi: { command: 'ohhi', args: ['mcp', '--vault', p] } },
    })
  })
})
