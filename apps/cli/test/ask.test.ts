/**
 * `ohhi ask` (writing-harness-build A7): the Node host of the harness, over
 * the fixture vault, against the scripted LLM behind a real socket — the
 * CLI's real `fetch`, nothing stubbed between the flag and the wire.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OP_NAMES } from '@ohhi/agent'
import { hashSkillFolder, type SkillFs } from '@ohhi/agent/skills'
import { startMockLlm, type MockLlmServer } from '../../../libs/testkit/src/node.js'
import type { MockTurn } from '../../../libs/testkit/src/mock-llm.js'
import { AskOut, chooseProvider, parseRef, providersPath, toolLine } from '../src/ask.js'
import { parseCommand } from '../src/grammar.js'
import { fixture, inVault, ohhi } from './helpers.js'

let server: MockLlmServer | undefined
const dirs: string[] = []
afterEach(async () => {
  await server?.close()
  server = undefined
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})

/** An XDG config dir holding a providers.json aimed at a fresh mock LLM. */
async function configured(script: MockTurn[], extra: Record<string, unknown> = {}): Promise<Record<string, string>> {
  server = await startMockLlm({ script })
  const xdg = await mkdtemp(join(tmpdir(), 'ohhi-xdg-'))
  dirs.push(xdg)
  await mkdir(join(xdg, 'ohhi'))
  const providers = {
    providers: [
      { id: 'local', name: 'Local', kind: 'openai-compatible', baseUrl: `${server.url}/v1`, model: 'llama3' },
      { id: 'claude', name: 'Claude', kind: 'anthropic', baseUrl: server.url, apiKey: 'sk-file', model: 'claude-x' },
    ],
    ...extra,
  }
  await writeFile(join(xdg, 'ohhi', 'providers.json'), JSON.stringify(providers))
  return { XDG_CONFIG_HOME: xdg }
}

describe('ohhi ask', () => {
  it('streams the answer to stdout and each tool call to stderr', async () => {
    const env = await configured([
      { toolCall: { name: 'ohhi_search', args: { query: 'canonical', limit: 3 } } },
      { text: 'Projects/Editor.md: files are canonical.' },
    ])
    const v = await fixture()
    const r = await ohhi(inVault(v, ['ask', 'where', 'do', 'I', 'say', 'canonical?']), { env })
    expect(r.code).toBe(0)
    expect(r.out).toBe('Projects/Editor.md: files are canonical.\n')
    expect(r.err).toContain('tool=ohhi_search query="canonical" limit=3')
    expect(r.err).toMatch(/provider=local model=llama3 tokens=\d+\/\d+/)
    expect(server!.requests[0].lastUser).toBe('where do I say canonical?')
    expect(server!.requests[1].toolResults[0].output).toContain('Projects/Editor.md')
  })

  it('offers the model read ops only — never a write', async () => {
    const env = await configured([{ text: 'ok' }])
    const v = await fixture()
    await ohhi(inVault(v, ['ask', 'hi']), { env })
    const offered = server!.requests[0].tools
    expect(offered).toContain('ohhi_read')
    for (const w of ['ohhi_write', 'ohhi_patch', 'ohhi_append', 'ohhi_mv', 'ohhi_rm', 'ohhi_restore']) expect(offered).not.toContain(w)
  })

  it('--json prints one ohhi.ask.v1 document and nothing else on stdout', async () => {
    const env = await configured([
      { toolCall: { name: 'ohhi_read', args: { path: 'Areas/CS/JSON.md', outline: true } } },
      { text: 'A tiny note.', usage: { input: 30, output: 4 } },
    ])
    const v = await fixture()
    const r = await ohhi(inVault(v, ['ask', 'what is JSON.md?', '--json']), { env })
    expect(r.code).toBe(0)
    const doc = AskOut.parse(JSON.parse(r.out))
    expect(doc).toEqual({
      schema: 'ohhi.ask.v1',
      text: 'A tiny note.',
      usage: { input: 40, output: 9 },
      tools: [{ name: 'ohhi_read', input: { path: 'Areas/CS/JSON.md', outline: true } }],
    })
  })

  it('--provider, --model and $OHHI_API_KEY choose and override; --ref attaches a section', async () => {
    const env = await configured([{ text: 'Files are canonical.' }])
    const v = await fixture()
    const r = await ohhi(
      inVault(v, ['ask', 'summarise', '--provider', 'claude', '--model', 'claude-y', '--ref', 'Projects/Editor.md#Decisions']),
      { env: { ...env, OHHI_API_KEY: 'sk-env' } },
    )
    expect(r.code).toBe(0)
    const [req] = server!.requests
    expect(req.wire).toBe('anthropic')
    expect(req.model).toBe('claude-y')
    expect(req.headers['x-api-key']).toBe('sk-env')
    expect(req.system).toContain('## References')
    expect(req.system).toContain('### Projects/Editor.md › Decisions · hash ')
    expect(req.system).toContain('- Files are canonical.')
  })

  it('--skill puts the vault skill in the prompt', async () => {
    const env = await configured([{ text: 'ok' }])
    const v = await fixture()
    await mkdir(join(v.root, '.agents/skills/terse'), { recursive: true })
    await writeFile(join(v.root, '.agents/skills/terse/SKILL.md'), '---\nname: terse\ndescription: Answer in one line.\n---\n\nOne line. No preamble.\n')
    const r = await ohhi(inVault(v, ['ask', 'hi', '--skill', 'terse']), { env })
    expect(r.code).toBe(0)
    expect(server!.requests[0].system).toContain('## Active skill: terse')
    expect(server!.requests[0].system).toContain('One line. No preamble.')
  })

  it('honours the app’s .ohhi/skills.json: an untrusted skill is neither cataloged nor runnable', async () => {
    const env = await configured([{ text: 'ok' }])
    const v = await fixture()
    const fs: SkillFs = {
      list: async (dir) => [`${dir}/SKILL.md`],
      read: (path) => readFile(join(v.root, path), 'utf8'),
    }
    for (const name of ['terse', 'wild']) {
      await mkdir(join(v.root, `.agents/skills/${name}`), { recursive: true })
      await writeFile(join(v.root, `.agents/skills/${name}/SKILL.md`), `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\nBody.\n`)
    }
    await mkdir(join(v.root, '.ohhi'), { recursive: true })
    await writeFile(
      join(v.root, '.ohhi/skills.json'),
      JSON.stringify({
        terse: { enabled: true, trusted: true, installedAt: 1, hash: await hashSkillFolder(fs, '.agents/skills/terse') },
        wild: { enabled: true, trusted: false, installedAt: 1 },
      }),
    )
    const ok = await ohhi(inVault(v, ['ask', 'hi']), { env })
    expect(ok.code).toBe(0)
    expect(server!.requests[0].system).toContain('<name>terse</name>')
    expect(server!.requests[0].system).not.toContain('<name>wild</name>')
    const refused = await ohhi(inVault(v, ['ask', 'hi', '--skill', 'wild']), { env })
    expect(refused.code).toBe(1)
    expect(refused.err).toMatch(/not trusted and enabled/)
  })

  it('a provider error is exit 1 with the provider’s message', async () => {
    const env = await configured([{ error: { status: 401, message: 'bad key' } }])
    const v = await fixture()
    const r = await ohhi(inVault(v, ['ask', 'hi']), { env })
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/ohhi: runtime: local: .*bad key/)
  })

  it('no providers file is exit 2, naming the file to create', async () => {
    const v = await fixture()
    const xdg = await mkdtemp(join(tmpdir(), 'ohhi-xdg-'))
    dirs.push(xdg)
    const r = await ohhi(inVault(v, ['ask', 'hi']), { env: { XDG_CONFIG_HOME: xdg } })
    expect(r.code).toBe(2)
    expect(r.err).toContain(join(xdg, 'ohhi', 'providers.json'))
  })

  it('an unknown provider and a bad flag are usage errors', async () => {
    const env = await configured([])
    const v = await fixture()
    const unknown = await ohhi(inVault(v, ['ask', 'hi', '--provider', 'nope']), { env })
    expect(unknown.code).toBe(2)
    expect(unknown.err).toContain('no provider "nope" (known: local, claude)')
    const bad = await ohhi(inVault(v, ['ask', 'hi', '--outline']), { env })
    expect(bad.code).toBe(2)
    expect(bad.err).toContain('--outline is not a flag of `ohhi ask`')
    expect((await ohhi(['ask'], { env })).code).toBe(2)
  })

  it('is not a contract op: absent from OP_NAMES, present in the usage', async () => {
    expect(OP_NAMES as readonly string[]).not.toContain('ask')
    const help = await ohhi(['help'])
    expect(help.out).toContain('ohhi ask "<prompt>"')
    expect(help.out).toContain('ohhi skills export [--dry-run]')
  })
})

describe('ask parts', () => {
  it('parses --ref forms', () => {
    expect(parseRef('a.md')).toEqual({ kind: 'file', path: 'a.md' })
    expect(parseRef('Areas/CS/')).toEqual({ kind: 'folder', path: 'Areas/CS/' })
    expect(parseRef('a.md#Notes/Open questions')).toEqual({ kind: 'section', path: 'a.md', section: 'Notes/Open questions' })
    expect(parseRef('a.md:12-20')).toEqual({ kind: 'lines', path: 'a.md', lines: { from: 12, to: 20 } })
    expect(() => parseRef('a.md:20-12')).toThrow(/ascending/)
  })

  it('collects repeated --ref in order', () => {
    const c = parseCommand(['ask', 'q', '--ref', 'a.md', '--ref', 'b.md:1-2'])
    expect(c).toMatchObject({ kind: 'ask', prompt: 'q', refs: ['a.md', 'b.md:1-2'] })
  })

  it('resolves the providers file from XDG, else HOME', () => {
    expect(providersPath({ XDG_CONFIG_HOME: '/x' })).toBe('/x/ohhi/providers.json')
    expect(providersPath({ HOME: '/home/u' })).toBe('/home/u/.config/ohhi/providers.json')
  })

  it('chooses the default provider, else the first', () => {
    const cfg = {
      providers: [
        { id: 'a', name: 'A', kind: 'openai' as const, baseUrl: '', model: 'm' },
        { id: 'b', name: 'B', kind: 'openai' as const, baseUrl: '', model: 'n', apiKey: 'k' },
      ],
    }
    expect(chooseProvider(cfg, {}, {}).id).toBe('a')
    expect(chooseProvider({ ...cfg, defaultProvider: 'b' }, {}, {}).apiKey).toBe('k')
  })

  it('$OHHI_API_KEY reaches a kind that takes a key, never a keyless local server', () => {
    const cfg = {
      providers: [
        { id: 'cloud', name: 'C', kind: 'anthropic' as const, baseUrl: '', model: 'm' },
        { id: 'local', name: 'L', kind: 'openai-compatible' as const, baseUrl: 'http://localhost:11434/v1', model: 'llama' },
      ],
    }
    const env = { OHHI_API_KEY: 'sk-cloud-secret' }
    expect(chooseProvider(cfg, { provider: 'cloud' }, env).apiKey).toBe('sk-cloud-secret')
    expect(chooseProvider(cfg, { provider: 'local' }, env).apiKey).toBeUndefined()
  })

  it('prints a tool call as one line', () => {
    expect(toolLine('ohhi_read', { path: 'a b.md', lines: { from: 1, to: 2 } })).toBe('tool=ohhi_read path="a b.md" lines={"from":1,"to":2}')
  })
})
