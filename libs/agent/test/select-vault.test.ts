/**
 * Vault selection (shaping R8): three ways to say which vault, and a refusal
 * — never a guess — when the answer is not unambiguous.
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDataDir, resolveVault, vaultId } from '../src/select-vault.js'

let base: string
afterEach(async () => base && rm(base, { recursive: true, force: true }))

/** A tree of directories; each entry names the marker to plant, or nothing. */
async function tree(spec: Record<string, string | null>): Promise<string> {
  base = await realpath(await mkdtemp(join(tmpdir(), 'ohhi-select-')))
  for (const [path, marker] of Object.entries(spec)) {
    await mkdir(join(base, path), { recursive: true })
    if (marker) await mkdir(join(base, path, marker), { recursive: true })
  }
  return base
}

describe('resolveVault', () => {
  it('takes an explicit vault first, realpath.d', async () => {
    const root = await tree({ vault: '.ohhi' })
    const chosen = await resolveVault({ vault: join(root, 'vault'), env: {}, cwd: '/' })
    expect(chosen).toEqual({ root: join(root, 'vault'), source: 'flag' })
  })

  it('falls back to OHHI_VAULT', async () => {
    const root = await tree({ vault: '.obsidian' })
    const chosen = await resolveVault({ env: { OHHI_VAULT: join(root, 'vault') }, cwd: '/' })
    expect(chosen.source).toBe('env')
    expect(chosen.root).toBe(join(root, 'vault'))
  })

  it('walks up from the working directory for a marker', async () => {
    const root = await tree({ vault: '.obsidian', 'vault/Areas/CS': null })
    const chosen = await resolveVault({ env: {}, cwd: join(root, 'vault/Areas/CS') })
    expect(chosen).toEqual({ root: join(root, 'vault'), source: 'marker', marker: '.obsidian' })
  })

  it("finds a vault by Oh hi markdown's own .ohhi/ folder", async () => {
    const root = await tree({ vault: '.ohhi', 'vault/Areas': null })
    const chosen = await resolveVault({ env: {}, cwd: join(root, 'vault/Areas') })
    expect(chosen).toEqual({ root: join(root, 'vault'), source: 'marker', marker: '.ohhi' })
  })

  it('counts .ohhi/ and .obsidian/ in one folder as one vault, not an ambiguity', async () => {
    const root = await tree({ vault: '.ohhi' })
    await mkdir(join(root, 'vault/.obsidian'))
    const chosen = await resolveVault({ env: {}, cwd: join(root, 'vault') })
    expect(chosen).toEqual({ root: join(root, 'vault'), source: 'marker', marker: '.ohhi' })
  })

  it('no longer treats the pre-rename .editor/ folder as a marker', async () => {
    const root = await tree({ vault: '.editor' })
    await expect(resolveVault({ env: {}, cwd: join(root, 'vault') })).rejects.toMatchObject({ code: 'usage' })
  })

  it('refuses two markers on the walk and names both candidates', async () => {
    const root = await tree({ outer: '.ohhi', 'outer/inner': '.obsidian' })
    const failure = await resolveVault({ env: {}, cwd: join(root, 'outer/inner') }).catch((e: unknown) => e)
    expect(failure).toMatchObject({
      code: 'usage',
      details: { candidates: [join(root, 'outer/inner'), join(root, 'outer')] },
    })
    expect((failure as Error).message).toContain('--vault')
  })

  it('refuses when nothing names a vault, and says the three ways', async () => {
    const root = await tree({ plain: null })
    const failure = await resolveVault({ env: {}, cwd: join(root, 'plain') }).catch((e: unknown) => e)
    expect(failure).toMatchObject({ code: 'usage' })
    const message = (failure as Error).message
    expect(message).toContain('--vault')
    expect(message).toContain('OHHI_VAULT')
    expect(message).toContain('.ohhi/')
    expect(message).toContain('.obsidian')
  })

  it('refuses an explicit path that is missing or is a file', async () => {
    const root = await tree({ vault: '.ohhi' })
    await writeFile(join(root, 'note.md'), 'x\n', 'utf8')
    await expect(resolveVault({ vault: join(root, 'nope'), env: {}, cwd: '/' })).rejects.toMatchObject({
      code: 'usage',
    })
    await expect(resolveVault({ vault: join(root, 'note.md'), env: {}, cwd: '/' })).rejects.toMatchObject({
      code: 'usage',
    })
  })

  it('ignores a marker that is a file rather than a directory', async () => {
    const root = await tree({ vault: null })
    await writeFile(join(root, 'vault/.obsidian'), 'not a directory\n', 'utf8')
    await expect(resolveVault({ env: {}, cwd: join(root, 'vault') })).rejects.toMatchObject({ code: 'usage' })
  })
})

describe('resolveDataDir', () => {
  it('prefers OHHI_DATA_DIR, then XDG_DATA_HOME, then ~/.local/share', () => {
    expect(resolveDataDir({ OHHI_DATA_DIR: '/tmp/ohhi-data' }, '/home/x')).toBe('/tmp/ohhi-data')
    expect(resolveDataDir({ XDG_DATA_HOME: '/home/x/.local/share' }, '/home/x')).toBe(
      '/home/x/.local/share/ohhi'
    )
    expect(resolveDataDir({}, '/home/x')).toBe('/home/x/.local/share/ohhi')
    // A relative XDG_DATA_HOME is not a data home; the spec says ignore it.
    expect(resolveDataDir({ XDG_DATA_HOME: 'relative' }, '/home/x')).toBe('/home/x/.local/share/ohhi')
  })
})

describe('vaultId', () => {
  it('is 16 stable hex characters, different per root', () => {
    expect(vaultId('/home/x/notes')).toMatch(/^[0-9a-f]{16}$/)
    expect(vaultId('/home/x/notes')).toBe(vaultId('/home/x/notes'))
    expect(vaultId('/home/x/notes')).not.toBe(vaultId('/home/x/other'))
  })
})
