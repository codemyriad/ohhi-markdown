/**
 * The build flavour (scripts/flavour.mjs): what each flavour derives, what it
 * refuses, and the `_headers` check the build runs after Vite.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { checkHeaders, connectSources, parseHeaders, resolveFlavour } from './flavour.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const COMMITTED = readFileSync(join(here, '../public/_headers'), 'utf8')
const pinned = (host) => COMMITTED.replace(/(connect-src[^;]*?)wss: https:/, `$1wss://${host} https://${host}`)

describe('resolveFlavour', () => {
  it('unset: a local build — nothing derived, nothing refused', () => {
    expect(resolveFlavour({})).toEqual({ flavour: '', env: {}, errors: [] })
    expect(resolveFlavour({ VITE_FLAVOUR: '  ', VITE_TEAM_HOST: 'x.example' }).errors).toEqual([])
  })

  it('refuses a flavour it does not know', () => {
    expect(resolveFlavour({ VITE_FLAVOUR: 'staging' }).errors[0]).toMatch(/must be one of team, public/)
  })

  it('public: the dist and web hosts by default, overridable, and no team setting allowed', () => {
    const f = resolveFlavour({ VITE_FLAVOUR: 'public' })
    expect(f.errors).toEqual([])
    expect(f.env).toEqual({
      VITE_FLAVOUR: 'public',
      VITE_DOWNLOADS_URL: 'https://dist.ohhi.md/stable/downloads.json',
      VITE_WEB_ORIGIN: 'https://hi.ohhi.md',
    })
    expect(f.updaterEndpoint).toBe('https://dist.ohhi.md/stable/latest.json')
    expect(f.distBase).toBe('https://dist.ohhi.md')

    const other = resolveFlavour({ VITE_FLAVOUR: 'public', PUBLIC_WEB_HOST: 'App.ohhi.md', PUBLIC_DIST_HOST: 'dl.example.com' })
    expect(other.webOrigin).toBe('https://app.ohhi.md')
    expect(other.downloadsUrl).toBe('https://dl.example.com/stable/downloads.json')
    expect(other.updaterEndpoint).toBe('https://dl.example.com/stable/latest.json')

    // An explicit value wins over the derived one.
    expect(resolveFlavour({ VITE_FLAVOUR: 'public', VITE_DOWNLOADS_URL: 'https://x.example/d.json' }).env.VITE_DOWNLOADS_URL).toBe(
      'https://x.example/d.json'
    )

    const team = resolveFlavour({
      VITE_FLAVOUR: 'public',
      VITE_TEAM_HOST: 'ohhi.example.ts.net',
      VITE_DEFAULT_RELAY: 'wss://ohhi.example.ts.net/relay',
    })
    expect(team.errors).toHaveLength(2)
    expect(team.errors[0]).toMatch(/VITE_TEAM_HOST is a team setting/)
    expect(team.errors[1]).toMatch(/VITE_DEFAULT_RELAY is a team setting/)

    expect(resolveFlavour({ VITE_FLAVOUR: 'public', PUBLIC_WEB_HOST: 'https://hi.ohhi.md' }).errors[0]).toMatch(
      /PUBLIC_WEB_HOST must be a bare host/
    )
  })

  it('team: needs the team host; downloads and updates come from it', () => {
    expect(resolveFlavour({ VITE_FLAVOUR: 'team' }).errors[0]).toMatch(/needs VITE_TEAM_HOST/)
    const f = resolveFlavour({ VITE_FLAVOUR: 'team', VITE_TEAM_HOST: 'Ohhi.Example.ts.net' })
    expect(f.errors).toEqual([])
    expect(f.env).toEqual({
      VITE_FLAVOUR: 'team',
      VITE_DOWNLOADS_URL: 'https://ohhi.example.ts.net/updates/downloads.json',
    })
    expect(f.updaterEndpoint).toBe('https://ohhi.example.ts.net/updates/latest.json')
    expect(f.teamHost).toBe('ohhi.example.ts.net')
  })

  it('runs as a CLI for the release workflow: key=value lines, exit 1 on a contradiction', () => {
    const script = join(here, 'flavour.mjs')
    const env = { PATH: process.env.PATH }
    const out = execFileSync(process.execPath, [script, 'public'], { env, encoding: 'utf8' })
    expect(out.trim().split('\n')).toEqual([
      'flavour=public',
      'updater_endpoint=https://dist.ohhi.md/stable/latest.json',
      'downloads_url=https://dist.ohhi.md/stable/downloads.json',
      'web_origin=https://hi.ohhi.md',
      'dist_base=https://dist.ohhi.md',
    ])
    expect(() =>
      execFileSync(process.execPath, [script, 'public'], { env: { ...env, VITE_TEAM_HOST: 'x.example' }, stdio: 'pipe' })
    ).toThrow()
  })
})

describe('parseHeaders / connectSources', () => {
  it('reads the committed file the way Pages and ohhi-pull do: one /* rule, comments skipped', () => {
    const rules = parseHeaders(COMMITTED)
    expect(rules[0].pattern).toBe('/*')
    const names = rules[0].headers.map((h) => h.name)
    expect(names).toContain('Content-Security-Policy')
    expect(names).toContain('X-Frame-Options')
    const csp = rules[0].headers.find((h) => h.name === 'Content-Security-Policy').value
    expect(connectSources(csp)).toEqual(expect.arrayContaining(["'self'", 'wss:', 'https:']))
    expect(connectSources("default-src 'self'")).toBeNull()
  })
})

describe('checkHeaders', () => {
  it('no flavour: nothing to check', () => {
    expect(checkHeaders('', { flavour: '' })).toEqual([])
  })

  it('public: the committed (unpinned) policy passes; a pinned one is refused', () => {
    expect(checkHeaders(COMMITTED, { flavour: 'public' })).toEqual([])
    const errors = checkHeaders(pinned('ohhi.example.ts.net'), { flavour: 'public' })
    expect(errors).toHaveLength(2)
    expect(errors[0]).toMatch(/must allow wss:/)
  })

  it('public: Cloudflare Pages limits — line length and rule count', () => {
    const long = COMMITTED.replace('X-Frame-Options: DENY', `X-Long: ${'a'.repeat(2100)}`)
    expect(checkHeaders(long, { flavour: 'public' })[0]).toMatch(/at most 2000/)
    const many = COMMITTED + Array.from({ length: 100 }, (_, i) => `/p${i}\n  X-A: b`).join('\n')
    expect(checkHeaders(many, { flavour: 'public' })[0]).toMatch(/at most 100/)
  })

  it('team: pinned to exactly the team host; the committed policy is refused', () => {
    expect(checkHeaders(pinned('ohhi.example.ts.net'), { flavour: 'team', teamHost: 'ohhi.example.ts.net' })).toEqual([])
    expect(checkHeaders(COMMITTED, { flavour: 'team', teamHost: 'ohhi.example.ts.net' }).join('\n')).toMatch(
      /must name wss:\/\/ohhi.example.ts.net[\s\S]*still allows every wss:/
    )
    expect(checkHeaders(pinned('other.example'), { flavour: 'team', teamHost: 'ohhi.example.ts.net' })).toHaveLength(2)
  })

  it('no CSP at all is refused for either flavour', () => {
    expect(checkHeaders('/*\n  X-Frame-Options: DENY\n', { flavour: 'public' })).toEqual([
      '_headers has no Content-Security-Policy in its /* rule',
    ])
  })
})
