import { SimClock } from '@ohhi/testkit'
import { WebDavPathError } from '@ohhi/vault'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { accessFromPermissions, createPermissions, encodePath, NcDav } from '../src/permissions.js'
import { SECRET, startFakeNextcloud, type FakeNextcloud } from './fixtures.js'

const env = (url: string) => ({ nextcloudUrl: url, appSecret: SECRET, appId: 'ohhi', appVersion: '0.1.0', aaVersion: '5' })

describe('accessFromPermissions (decision 5)', () => {
  it('read needs G; write needs every one of C K N V D', () => {
    expect(accessFromPermissions('RGDNVCK', 'Notes')).toEqual({ read: true, write: true, path: 'Notes' })
    expect(accessFromPermissions('SRGDNVCK', 'Notes')).toMatchObject({ read: true, write: true })
    for (const missing of ['C', 'K', 'N', 'V', 'D']) {
      expect(accessFromPermissions('RGDNVCK'.replace(missing, ''), 'Notes')).toMatchObject({ read: true, write: false })
    }
    expect(accessFromPermissions('SG', 'Notes')).toEqual({ read: true, write: false, path: 'Notes' })
    expect(accessFromPermissions('RDNVCK', 'Notes')).toEqual({ read: false, write: false, path: null })
    expect(accessFromPermissions(null, null)).toEqual({ read: false, write: false, path: null })
  })
})

describe('NcDav + createPermissions against a fake Nextcloud', () => {
  let nc: FakeNextcloud
  beforeEach(async () => {
    nc = await startFakeNextcloud()
    nc.trees.set('alice', [
      { path: '', fileId: 1, dir: true, owner: 'alice', permissions: 'RGDNVCK' },
      { path: 'My Notes', fileId: 10, dir: true, owner: 'alice', permissions: 'RGDNVCK' },
    ])
    nc.trees.set('bob', [
      { path: '', fileId: 2, dir: true, owner: 'bob', permissions: 'RGDNVCK' },
      { path: 'My Notes', fileId: 10, dir: true, owner: 'alice', permissions: 'SGD', mountType: 'shared' },
    ])
  })
  afterEach(async () => {
    await nc.close()
  })

  it('finds a folder by file id with SEARCH, as the caller, and maps the letters', async () => {
    const clock = new SimClock()
    const perms = createPermissions({ dav: new NcDav({ env: env(nc.url), clock }), clock })
    expect(await perms.accessFor('alice', 10)).toEqual({ read: true, write: true, path: 'My Notes' })
    expect(await perms.accessFor('bob', 10)).toEqual({ read: true, write: false, path: 'My Notes' })
    expect(await perms.accessFor('bob', 999)).toEqual({ read: false, write: false, path: null })
    expect(nc.requests.filter((r) => r.method === 'SEARCH').map((r) => r.uid)).toEqual(['alice', 'bob', 'bob'])
  })

  it('a 401 (AppAPI refusing the app) throws — it is never read as no access (nextcloud-build R1 #7)', async () => {
    const clock = new SimClock()
    const perms = createPermissions({ dav: new NcDav({ env: env(nc.url), clock }), clock })
    expect((await perms.accessFor('bob', 10)).read).toBe(true)
    nc.searchStatus = 401
    await expect(perms.accessFor('bob', 10, { fresh: true })).rejects.toMatchObject({ name: 'NcHttpError', status: 401 })
    // The failed read did not overwrite the cached answer.
    expect((await perms.accessFor('bob', 10)).read).toBe(true)
  })

  it('caches per (uid, fileId) for 60 s on the injected clock; fresh bypasses', async () => {
    const clock = new SimClock()
    const perms = createPermissions({ dav: new NcDav({ env: env(nc.url), clock }), clock })
    await perms.accessFor('bob', 10)
    nc.trees.get('bob')![1]!.permissions = '' // unshared → no G
    expect((await perms.accessFor('bob', 10)).read).toBe(true)
    clock.advance(59_999)
    expect((await perms.accessFor('bob', 10)).read).toBe(true)
    clock.advance(1)
    nc.trees.set('bob', nc.trees.get('bob')!.slice(0, 1))
    expect((await perms.accessFor('bob', 10)).read).toBe(false)
    nc.trees.get('bob')!.push({ path: 'My Notes', fileId: 10, dir: true, owner: 'alice', permissions: 'SGDNVCK' })
    expect((await perms.accessFor('bob', 10, { fresh: true })).write).toBe(true)
  })

  it('falls back to the /index.php/f/<id> redirect when SEARCH is refused, never following it', async () => {
    nc.searchStatus = 501
    const dav = new NcDav({ env: env(nc.url), clock: new SimClock() })
    const hit = await dav.findById('alice', 10)
    expect(hit).toMatchObject({ path: 'My Notes', fileId: 10, isDir: true, permissions: 'RGDNVCK' })
    // GET /f/ answered 303; the PROPFIND that followed is ours, not a redirect follow.
    expect(nc.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      'SEARCH /remote.php/dav/',
      'GET /index.php/f/10',
      'PROPFIND /remote.php/dav/files/alice/My%20Notes/',
    ])
  })

  it('walks with Depth: infinity, or Depth: 1 when the server refuses it', async () => {
    nc.trees.get('alice')!.push(
      { path: 'My Notes/a.md', fileId: 11, dir: false, owner: 'alice', permissions: 'RGDNVW' },
      { path: 'My Notes/sub', fileId: 12, dir: true, owner: 'alice', permissions: 'RGDNVCK' },
      { path: 'My Notes/sub/b.md', fileId: 13, dir: false, owner: 'alice', permissions: 'RGDNVW' }
    )
    const dav = new NcDav({ env: env(nc.url), clock: new SimClock() })
    const all = (await dav.walk('alice', 'My Notes')).map((e) => e.path).sort()
    expect(all).toEqual(['My Notes', 'My Notes/a.md', 'My Notes/sub', 'My Notes/sub/b.md'])
    nc.infinityStatus = 403
    const walked = (await dav.walk('alice', 'My Notes')).map((e) => e.path).sort()
    expect(walked).toEqual(all)
  })

  it('refuses to send the AppAPI header anywhere but NEXTCLOUD_URL', async () => {
    const dav = new NcDav({ env: env(nc.url), clock: new SimClock() })
    await expect(dav.call('alice', 'GET', 'http://elsewhere.invalid/x')).rejects.toThrow(/outside NEXTCLOUD_URL/)
    expect(nc.requests).toEqual([])
  })

  it('encodes each path segment and refuses one that would climb out of the home', () => {
    expect(encodePath('/My Notes/a#b/')).toBe('My%20Notes/a%23b')
    expect(encodePath('')).toBe('')
    for (const bad of ['My Notes/../../bob', '..', 'a/./b', 'a//b']) expect(() => encodePath(bad)).toThrow(WebDavPathError)
  })
})
