/**
 * The CLI grammar and the human-facing rendering: usage, flag mapping, the
 * stdout/stderr split, and the MCP tool list. Everything runs through
 * `run(argv, io)` — no process is spawned, so these are milliseconds.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OP_NAMES } from '@editor/agent'
import { run, redact } from '../src/run.js'
import { bufferIo } from '../src/io.js'
import { parseCommand, usageLine } from '../src/grammar.js'
import { callTool, mcpTools, toolName } from '../src/mcp.js'
import { createFilesBackend } from '@editor/agent'
import { RealClock } from '../src/clock.js'
import { makeFixtureVault, type FixtureVault } from '../../../libs/agent/test/fixture.js'

const vaults: FixtureVault[] = []
afterEach(async () => {
  while (vaults.length > 0) await vaults.pop()!.cleanup()
})
async function fixture(): Promise<FixtureVault> {
  const v = await makeFixtureVault('ohhi-cli-')
  vaults.push(v)
  return v
}

async function ohhi(argv: string[], stdin?: string): Promise<{ out: string; err: string; code: number }> {
  const io = bufferIo({ cwd: '/nonexistent-cwd', env: {}, stdin: stdin === undefined ? undefined : async () => stdin })
  const code = await run(argv, io)
  return { out: io.out(), err: io.errText(), code }
}
const inVault = (v: FixtureVault, argv: string[]): string[] => [...argv, '--vault', v.root, '--data-dir', v.dataDir]

describe('usage', () => {
  it('`ohhi` alone prints usage on stdout and exits 0', async () => {
    const { out, err, code } = await ohhi([])
    expect(code).toBe(0)
    expect(err).toBe('')
    for (const op of OP_NAMES) expect(out).toContain(`  ohhi ${usageLine(op)}`)
  })

  it('`ohhi help` and `--help` are the same page', async () => {
    const viaWord = await ohhi(['help'])
    const viaFlag = await ohhi(['--help'])
    expect(viaWord.out).toBe(viaFlag.out)
    expect(viaWord.code).toBe(0)
  })

  it('names the three ways to say which vault, and the exit codes', async () => {
    const { out } = await ohhi([])
    expect(out).toContain('--vault <path>')
    expect(out).toContain('$OHHI_VAULT')
    expect(out).toContain('.obsidian/')
    expect(out).toContain('3 --expect-hash mismatch')
    expect(out).toContain('ohhi mcp')
  })

  it('one line per op, taken from the contract description', async () => {
    const { out } = await ohhi([])
    expect(out).toContain('Find notes. Returns references and snippets, never bodies')
  })
})

describe('flag mapping', () => {
  const parse = (argv: string[]): { op: string; input: Record<string, unknown> } => {
    const c = parseCommand(argv)
    if (c.kind !== 'op') throw new Error('expected an op')
    return { op: c.op, input: c.input }
  }

  it('positionals land on the contract key', () => {
    expect(parse(['read', 'A/B.md']).input).toEqual({ path: 'A/B.md' })
    expect(parse(['mv', 'a.md', 'b.md']).input).toEqual({ from: 'a.md', to: 'b.md' })
    expect(parse(['ls']).input).toEqual({})
  })

  it('--lines 12-40 becomes a range object', () => {
    expect(parse(['read', 'a.md', '--lines', '12-40']).input.lines).toEqual({ from: 12, to: 40 })
  })

  it('kebab flags become camelCase contract keys', () => {
    const { input } = parse(['write', 'a.md', '--text', 'x', '--create-only', '--expect-hash', 'abc', '--dry-run'])
    expect(input).toEqual({ path: 'a.md', text: 'x', createOnly: true, expectHash: 'abc', dryRun: true })
  })

  it('--exact and --regex are shorthands for --mode', () => {
    expect(parse(['search', 'q', '--exact']).input.mode).toBe('exact')
    expect(parse(['search', 'q', '--regex']).input.mode).toBe('regex')
    expect(parse(['search', 'q', '--mode', 'ranked']).input.mode).toBe('ranked')
  })

  it('globals are collected separately from the op input', () => {
    const c = parseCommand(['--vault', '/v', '--json', '--app-store', '/a', '--app-store', '/b', 'stats'])
    if (c.kind !== 'op') throw new Error('expected an op')
    expect(c.globals).toEqual({ vault: '/v', json: true, dataDir: undefined, appStore: ['/a', '/b'], help: false })
    expect(c.input).toEqual({})
  })

  it('`mcp` is recognised as its own command', () => {
    expect(parseCommand(['mcp', '--vault', '/v']).kind).toBe('mcp')
  })
})

describe('usage errors exit 2 and print nothing on stdout', () => {
  const cases: [string, string[]][] = [
    ['an unknown command', ['frobnicate']],
    ['an unknown flag', ['stats', '--nope']],
    ['a flag belonging to another op', ['stats', '--outline']],
    ['a missing positional', ['read']],
    ['an extra positional', ['read', 'a.md', 'b.md']],
    ['a non-numeric --limit', ['search', 'q', '--limit', 'lots']],
    ['a malformed --lines', ['read', 'a.md', '--lines', '12..40']],
    ['--limit out of the contract range', ['search', 'q', '--limit', '0']],
    ['a missing required flag', ['changes']],
    ['text needed but no --text and no stdin', ['write', 'a.md']],
  ]
  for (const [what, argv] of cases) {
    it(what, async () => {
      const { out, err, code } = await ohhi([...argv, '--vault', '/tmp'])
      expect(code).toBe(2)
      expect(out).toBe('')
      expect(err.length).toBeGreaterThan(0)
    })
  }

  it('an unknown flag names the op it is not a flag of', async () => {
    const { err } = await ohhi(['stats', '--outline', '--vault', '/tmp'])
    expect(err).toContain('`ohhi stats`')
  })
})

describe('text rendering', () => {
  it('search prints one header per hit with bracketed snippets, and hints on stderr', async () => {
    const v = await fixture()
    const { out, err, code } = await ohhi(inVault(v, ['search', 'JSON', '--limit', '5']))
    expect(code).toBe(0)
    expect(out).toMatch(/tier=\w+ path=\S+/)
    expect(out).toMatch(/\[[Jj][Ss][Oo][Nn]\]/)
    expect(err).toContain('hint=ohhi read --outline')
    expect(err).toContain('returned=')
    expect(err).toContain('coverage:')
  })

  it('read puts the note on stdout and the provenance on stderr', async () => {
    const v = await fixture()
    const { out, err } = await ohhi(inVault(v, ['read', 'Areas/CS/JSON.md']))
    expect(out).toContain('JSON is a data format.')
    expect(out).not.toContain('hash=')
    expect(err).toContain('hash=')
    expect(err).toContain('mode=full')
  })

  it('read --outline lists headings with lines and section sizes, no body', async () => {
    const v = await fixture()
    const { out } = await ohhi(inVault(v, ['read', 'Projects/Editor.md', '--outline']))
    expect(out).toContain('# Editor')
    expect(out).toContain('## Decisions')
    expect(out).toContain('### Open questions')
    expect(out).toContain('chars)')
    expect(out).not.toContain('Files are canonical.')
  })

  it('read --section returns just that section', async () => {
    const v = await fixture()
    const { out } = await ohhi(inVault(v, ['read', 'Projects/Editor.md', '--section', 'Decisions']))
    expect(out).toContain('Files are canonical.')
    expect(out).not.toContain('Open questions')
  })

  it('stats prints the vault root and the coverage counters', async () => {
    const v = await fixture()
    const { out, err } = await ohhi(inVault(v, ['stats']))
    expect(out).toContain('vault=')
    expect(out).toContain('docs=')
    expect(out).toContain('skippedBinary=')
    expect(err).toContain('buildMs=')
  })

  it('a write says how to undo it', async () => {
    const v = await fixture()
    const { out, err, code } = await ohhi(inVault(v, ['append', 'TODO/Writing.md', '--text', 'one more line']))
    expect(code).toBe(0)
    expect(out).toContain('appended to TODO/Writing.md at line')
    expect(err).toContain('ohhi restore TODO/Writing.md --seq')
  })

  it('--dry-run says "would", and changes nothing', async () => {
    const v = await fixture()
    const before = readFileSync(join(v.root, 'TODO/Writing.md'), 'utf8')
    const { out } = await ohhi(inVault(v, ['append', 'TODO/Writing.md', '--text', 'nope', '--dry-run']))
    expect(out).toContain('would append')
    expect(readFileSync(join(v.root, 'TODO/Writing.md'), 'utf8')).toBe(before)
  })

  it('write takes its text from stdin when --text is absent', async () => {
    const v = await fixture()
    const io = bufferIo({ cwd: '/nonexistent-cwd', env: {}, stdin: async () => 'from stdin\n' })
    const code = await run(inVault(v, ['write', 'Inbox/Piped.md']), io)
    expect(code).toBe(0)
    expect(readFileSync(join(v.root, 'Inbox/Piped.md'), 'utf8')).toBe('from stdin\n')
  })

  it('the vault can be named by OHHI_VAULT', async () => {
    const v = await fixture()
    const io = bufferIo({ cwd: '/nonexistent-cwd', env: { OHHI_VAULT: v.root, OHHI_DATA_DIR: v.dataDir } })
    expect(await run(['stats'], io)).toBe(0)
    expect(io.out()).toContain('vault=')
  })
})

describe('never print a path outside the vault (build brief A2.7)', () => {
  it('redacts absolute paths that are not under the vault root', () => {
    expect(redact("ENOENT: no such file or directory, open '/home/someone/secrets/key.pem'", '/vaults/mine')).not.toContain('secrets')
    expect(redact('cannot read /vaults/mine/Areas/CS/JSON.md', '/vaults/mine')).toContain('/vaults/mine/Areas/CS/JSON.md')
  })

  it('redacts everything when no vault was resolved', () => {
    expect(redact('failed at /etc/passwd', undefined)).toBe('failed at <path>')
  })
})

describe('mcp tool list', () => {
  it('is one tool per contract op, generated', () => {
    const tools = mcpTools()
    expect(tools).toHaveLength(OP_NAMES.length)
    expect(tools.map((t) => t.name)).toEqual(OP_NAMES.map(toolName))
  })

  it('each tool carries a JSON Schema object input and the contract description', () => {
    for (const tool of mcpTools()) {
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.description.length).toBeGreaterThan(10)
      expect(tool.inputSchema.$schema).toBeUndefined()
    }
  })

  it('a tool call returns the same document as --json, and an OpError is isError', async () => {
    const v = await fixture()
    const backend = await createFilesBackend({ root: v.root, dataDir: v.dataDir, clock: new RealClock() })

    const ok = await callTool(backend, 'ohhi_stats', {})
    expect(ok.isError).toBeUndefined()
    const viaCli = await ohhi(inVault(v, ['stats', '--json']))
    // `buildMs` is wall clock — everything else must be identical.
    const strip = (doc: string): unknown => ({ ...(JSON.parse(doc) as Record<string, unknown>), buildMs: 0 })
    expect(strip(ok.content[0].text)).toEqual(strip(viaCli.out))

    const missing = await callTool(backend, 'ohhi_read', { path: 'Nope.md' })
    expect(missing.isError).toBe(true)
    expect(JSON.parse(missing.content[0].text)).toMatchObject({ schema: 'ohhi.error.v1', code: 'not_found' })

    const badTool = await callTool(backend, 'ohhi_nope', {})
    expect(badTool.isError).toBe(true)
    expect(JSON.parse(badTool.content[0].text)).toMatchObject({ code: 'usage' })

    const badArgs = await callTool(backend, 'ohhi_search', { query: '' })
    expect(badArgs.isError).toBe(true)
    expect(JSON.parse(badArgs.content[0].text)).toMatchObject({ code: 'usage' })
  })

  it('write tools say they write', () => {
    const write = mcpTools().find((t) => t.name === 'ohhi_write')!
    expect(write.description).toContain('journaled')
    expect((write.inputSchema.properties as Record<string, unknown>).dryRun).toBeDefined()
  })
})
