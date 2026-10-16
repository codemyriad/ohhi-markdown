/**
 * downloads.json (scripts/downloads-manifest.mjs): one entry per installer,
 * nothing that is not one, and a refusal for anything ambiguous.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { archOf, buildDownloads } from './downloads-manifest.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const file = (name, size = 10) => ({ name, size, sha256: 'ab'.repeat(32) })
const RELEASE = [
  'ohhi_0.1.42_amd64.AppImage',
  'ohhi_0.1.42_amd64.AppImage.sig',
  'ohhi_0.1.42_amd64.deb',
  'ohhi_0.1.42_universal.dmg',
  'ohhi_0.1.42_universal.app.tar.gz',
  'ohhi_0.1.42_universal.app.tar.gz.sig',
  'web.tar.gz',
  'latest.json',
  'SHA256SUMS.txt',
].map((n) => file(n))

describe('buildDownloads', () => {
  it('lists the installers of a desktop release, in a fixed order, at <base-url>/<name>', () => {
    const m = buildDownloads({
      files: RELEASE,
      version: '0.1.42',
      baseUrl: 'https://dist.ohhi.md/0.1.42/',
      date: '2026-10-16T10:00:00Z',
    })
    expect(m).toEqual({
      schema: 1,
      version: '0.1.42',
      date: '2026-10-16T10:00:00Z',
      files: [
        { os: 'macos', kind: 'dmg', arch: 'universal', name: 'ohhi_0.1.42_universal.dmg', url: 'https://dist.ohhi.md/0.1.42/ohhi_0.1.42_universal.dmg', size: 10, sha256: 'ab'.repeat(32) },
        { os: 'linux', kind: 'appimage', arch: 'x86_64', name: 'ohhi_0.1.42_amd64.AppImage', url: 'https://dist.ohhi.md/0.1.42/ohhi_0.1.42_amd64.AppImage', size: 10, sha256: 'ab'.repeat(32) },
        { os: 'linux', kind: 'deb', arch: 'x86_64', name: 'ohhi_0.1.42_amd64.deb', url: 'https://dist.ohhi.md/0.1.42/ohhi_0.1.42_amd64.deb', size: 10, sha256: 'ab'.repeat(32) },
      ],
    })
  })

  it('takes an Android .apk once the mobile builds attach one', () => {
    const m = buildDownloads({ files: [...RELEASE, file('ohhi_0.1.42_universal.apk')], version: '0.1.42', baseUrl: 'https://x.example/v', date: 'd' })
    expect(m.files.map((f) => `${f.os}/${f.kind}`)).toEqual(['macos/dmg', 'linux/appimage', 'linux/deb', 'android/apk'])
  })

  it('refuses what would be ambiguous or empty, and a bad version or base', () => {
    const base = { version: '0.1.42', baseUrl: 'https://x.example', date: 'd' }
    expect(() => buildDownloads({ ...base, files: [file('a_amd64.deb'), file('b_amd64.deb')] })).toThrow(/two deb files for x86_64/)
    // Two arches of one kind are two entries, not a clash.
    expect(buildDownloads({ ...base, files: [file('a_amd64.deb'), file('a_arm64.deb')] }).files).toHaveLength(2)
    expect(() => buildDownloads({ ...base, files: [file('web.tar.gz')] })).toThrow(/no installer/)
    expect(() => buildDownloads({ ...base, version: 'v0.1.42', files: RELEASE })).toThrow(/not semver/)
    expect(() => buildDownloads({ ...base, baseUrl: 'http://x.example', files: RELEASE })).toThrow(/https/)
    expect(() => buildDownloads({ ...base, files: [file('ohhi 1.dmg')] })).toThrow(/whitespace/)
  })

  it('reads the arch from the name', () => {
    expect(archOf('ohhi_0.1.42_universal.dmg')).toBe('universal')
    expect(archOf('ohhi_0.1.42_amd64.deb')).toBe('x86_64')
    expect(archOf('ohhi_0.1.42_aarch64.AppImage')).toBe('arm64')
    expect(archOf('ohhi.apk')).toBe('universal')
  })
})

describe('the CLI', () => {
  it('hashes and sizes the files in --dir and writes downloads.json beside them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'downloads-'))
    writeFileSync(join(dir, 'ohhi_0.1.42_universal.dmg'), 'mac')
    writeFileSync(join(dir, 'ohhi_0.1.42_amd64.AppImage'), 'linux!')
    writeFileSync(join(dir, 'web.tar.gz'), 'web')
    execFileSync(process.execPath, [
      join(here, 'downloads-manifest.mjs'),
      '--dir', dir, '--version', '0.1.42', '--base-url', 'https://dist.ohhi.md/0.1.42', '--date', '2026-10-16T10:00:00Z',
    ], { stdio: 'pipe' })
    const m = JSON.parse(readFileSync(join(dir, 'downloads.json'), 'utf8'))
    expect(m.files.map((f) => [f.name, f.size])).toEqual([
      ['ohhi_0.1.42_universal.dmg', 3],
      ['ohhi_0.1.42_amd64.AppImage', 6],
    ])
    expect(m.files[0].sha256).toBe(createHash('sha256').update('mac').digest('hex'))
  })

  it('exits non-zero with the reason', () => {
    const dir = mkdtempSync(join(tmpdir(), 'downloads-'))
    expect(() =>
      execFileSync(process.execPath, [join(here, 'downloads-manifest.mjs'), '--dir', dir, '--version', '0.1.42', '--base-url', 'https://x.example'], {
        stdio: 'pipe',
      })
    ).toThrow(/no installer/)
  })
})
