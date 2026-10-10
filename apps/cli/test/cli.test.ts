/**
 * The CLI grammar and the human-facing rendering: usage, flag mapping, the
 * stdout/stderr split, and the MCP tool list. Everything runs through
 * `run(argv, io)` — no process is spawned, so these are milliseconds.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createFilesBackend, OP_NAMES } from '@ohhi/agent'
import { run, redact } from '../src/run.js'
import { bufferIo } from '../src/io.js'
import { parseCommand, usageLine } from '../src/grammar.js'
import { callTool, mcpTools, toolName } from '../src/mcp.js'
import { RealClock } from '../src/clock.js'
import { fixture, inVault, ohhi } from './helpers.js'

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

  it('fm collects repeatable key=value flags into typed records', () => {
    const { input } = parse(['fm', 'a.md', '--set', 'status=done', '--set', 'score= 8', '--set', 'ok=true', '--set', 'note=1e3', '--set-list', 'tags=a, "b, c"', '--unset', 'x', '--unset', 'y', '--rename', 'old=new', '--dry-run'])
    expect(input).toEqual({
      path: 'a.md',
      set: { status: 'done', score: 8, ok: true, note: '1e3', tags: ['a', 'b, c'] },
      unset: ['x', 'y'],
      rename: { old: 'new' },
      dryRun: true,
    })
    expect(() => parse(['fm', 'a.md', '--set', 'novalue'])).toThrow(/KEY=VALUE/)
  })

  it('restore --source names which journal --seq belongs to', () => {
    // The CLI and app journals number independently (S11-Q4), so `--seq 1`
    // without `--source` is genuinely ambiguous once an --app-store is given.
    expect(parse(['restore', 'a.md', '--seq', '3', '--source', 'app']).input).toEqual({
      path: 'a.md',
      seq: 3,
      source: 'app',
    })
    expect(parse(['restore', 'a.md', '--list']).input).toEqual({ path: 'a.md', list: true })
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

  it('collections prints each file with its views and counts; rows prints the path first, then the columns', async () => {
    const v = await fixture()
    const list = await ohhi(inVault(v, ['collections']))
    expect(list.out).toContain('Competitors.base')
    expect(list.out).toMatch(/All\s+table\s+3 rows/)
    expect(list.err).toContain('returned=1')
    const rows = await ohhi(inVault(v, ['rows', 'Competitors.base', '--view', 'Direct', '--columns', 'threat,verified']))
    const lines = rows.out.trimEnd().split('\n')
    expect(lines[0]).toMatch(/^path\s+threat\s+verified$/)
    expect(lines[1]).toMatch(/^Competitors\/Ingredifind\.md\s+direct\s+2026-06-02$/)
    expect(lines).toHaveLength(3)
    expect(rows.err).toContain('view=Direct')
  })

  it('fm --set prints the block after the write and how to undo it', async () => {
    const v = await fixture()
    const { out, err, code } = await ohhi(inVault(v, ['fm', 'Projects/Editor.md', '--set', 'status=done', '--set', 'retries=4']))
    expect(code).toBe(0)
    expect(out).toMatch(/^changed Projects\/Editor\.md \(2 keys\)/)
    expect(out).toMatch(/status:\s+done\s+\(string\)/)
    expect(out).toMatch(/retries:\s+4\s+\(number\)/)
    expect(err).toMatch(/undo with: ohhi restore Projects\/Editor\.md --seq \d+/)
    const again = await ohhi(inVault(v, ['fm', 'Projects/Editor.md', '--set', 'status=done']))
    expect(again.out).toMatch(/already said so/)
    const dry = await ohhi(inVault(v, ['fm', 'Projects/Editor.md', '--set', 'status=open', '--dry-run']))
    expect(dry.out).toMatch(/^would change Projects\/Editor\.md \(1 key\)/)
  })

  it('fm over MCP takes the records as JSON', async () => {
    const v = await fixture()
    const backend = await createFilesBackend({ root: v.root, dataDir: v.dataDir, clock: new RealClock() })
    const ok = await callTool(backend, 'ohhi_fm', { path: 'Projects/Editor.md', set: { score: 7, tags: ['a', 'b'] }, unset: ['draft'] })
    expect(ok.isError).toBeUndefined()
    const doc = JSON.parse(ok.content[0].text) as { changed: boolean; ops: number; frontmatter: { entries: { key: string; value: unknown }[] } }
    expect(doc).toMatchObject({ changed: true, ops: 3 })
    expect(doc.frontmatter.entries.find((e) => e.key === 'score')?.value).toBe(7)
    expect(doc.frontmatter.entries.find((e) => e.key === 'draft')).toBeUndefined()
    const bad = await callTool(backend, 'ohhi_fm', { path: 'Projects/Editor.md', set: { '': 'x' } })
    expect(bad.isError).toBe(true)
    expect(JSON.parse(bad.content[0].text)).toMatchObject({ code: 'usage' })
  })

  it('rows --json notes a partly computed view on stderr', async () => {
    const v = await fixture()
    const { err } = await ohhi(inVault(v, ['rows', 'Competitors.base', '--columns', 'formula.age', '--json']))
    expect(err).toContain('partly computed')
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

  it('restore --list on a note with no pre-images is an empty list, exit 0', async () => {
    const v = await fixture()
    const { out, err, code } = await ohhi(inVault(v, ['restore', 'TODO/Writing.md', '--list']))
    // An empty list means an empty list: the question "what can I put back?"
    // has the answer "nothing", and that is a success, not a not_found.
    expect(code).toBe(0)
    expect(out).toBe('')
    expect(err).toContain('entries=0')
    expect(err).toContain('note: no pre-images')

    const asJson = await ohhi(inVault(v, ['restore', 'TODO/Writing.md', '--list', '--json']))
    expect(asJson.code).toBe(0)
    expect(JSON.parse(asJson.out)).toMatchObject({ schema: 'ohhi.restore.v1', entries: [] })

    // Asking for a version BACK when there is none is still exit 1.
    const restore = await ohhi(inVault(v, ['restore', 'TODO/Writing.md']))
    expect(restore.code).toBe(1)
    expect(restore.err).toContain('not_found')
  })

  it('mv prints one line per note whose links it rewrote, each with its undo handle, and how to reverse the move', async () => {
    const v = await fixture()
    const dry = await ohhi(inVault(v, ['mv', 'Areas/CS/JSON.md', 'Areas/CS/Data Format.md', '--dry-run']))
    expect(dry.code).toBe(0)
    expect(dry.out).toContain('would move Areas/CS/JSON.md -> Areas/CS/Data Format.md')
    expect(dry.out).toContain('would update 1 link in Areas/CS/HTML.md')
    expect(dry.out).toContain('would update 1 link in Projects/Editor.md')
    expect(dry.err).toContain('files=1 rewrote=4 dryRun=true')
    expect(dry.err).not.toContain('plan:')
    expect(dry.err).not.toContain('ohhi restore')
    expect(readFileSync(join(v.root, 'Areas/CS/HTML.md'), 'utf8')).toContain('[[JSON]]')

    const { out, err, code } = await ohhi(inVault(v, ['mv', 'Areas/CS/JSON.md', 'Areas/CS/Data Format.md']))
    expect(code).toBe(0)
    const lines = out.trimEnd().split('\n')
    expect(lines[0]).toBe('moved Areas/CS/JSON.md -> Areas/CS/Data Format.md')
    expect(lines.slice(1)).toEqual([
      'updated 1 link in Areas/CS/HTML.md',
      'updated 1 link in Daily/02-5-2024.md',
      'updated 1 link in Edible/Docs.md',
      'updated 1 link in Projects/Editor.md',
    ])
    // The plan went to stderr BEFORE the move; the handles after it.
    expect(err.indexOf('plan: move Areas/CS/JSON.md')).toBeLessThan(err.indexOf('undo with:'))
    expect(err).toContain('plan: 1 link in Edible/Docs.md')
    expect(err).toContain('undo with: ohhi restore Areas/CS/HTML.md --seq ')
    expect(err).toContain('undo with: ohhi restore Projects/Editor.md --seq ')
    expect(err).toContain('files=1 rewrote=4')
    expect(err).toContain('reverse the move with: ohhi mv Areas/CS/Data Format.md Areas/CS/JSON.md')
    expect(readFileSync(join(v.root, 'Areas/CS/HTML.md'), 'utf8')).toContain('[[Data Format]]')
  })

  it('mv of the folder a collection reads updates the collection\'s filter, with its undo handle', async () => {
    const v = await fixture()
    const { out, err, code } = await ohhi(inVault(v, ['mv', 'Competitors', 'Rivals']))
    expect(code).toBe(0)
    expect(out).toContain('updated 1 filter in Competitors.base')
    expect(err).toContain('plan: 1 filter in Competitors.base')
    expect(err).toContain('undo with: ohhi restore Competitors.base --seq ')
    expect(readFileSync(join(v.root, 'Competitors.base'), 'utf8')).toContain('file.inFolder("Rivals")')
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
