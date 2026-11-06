/**
 * Review R1 #1 (nextcloud-build decision 12): a key a peer set in the folder
 * map that could escape the vault or land in an ignored directory stays in
 * the CRDT map after the live filter refuses it. A later reboot (reopen) and
 * a third device's first join must not write it either.
 */
import { describe, expect, it } from 'vitest'
import { bootDuo, applyForeignMap, dec } from './fixture.js'

const UNSAFE = ['.obsidian/plugins/x/main.js', '../evil.md'] as const

describe('unsafe folder-map keys at boot', () => {
  it('neither a reopen nor a first join writes an unsafe key', async () => {
    const duo = await bootDuo({ files: { 'a.md': 'hello\n' } })
    applyForeignMap(duo.a, (m) => {
      m.set(UNSAFE[0], { guid: 'g-plugin', kind: 'text' })
      m.set(UNSAFE[1], { guid: 'g-evil', kind: 'text' })
      m.set('.obsidian/plugins', { guid: 'g-dir', kind: 'dir' })
    })
    await duo.deliver()
    // The guids' docs carry content in the room, as a hostile peer's would.
    for (const g of ['g-plugin', 'g-evil']) duo.a.docFor(g)?.transact((t) => t.insert(0, 'payload\n'), 'local')
    await duo.deliver()
    await duo.tick(5_000)

    const rebooted = await duo.reboot('a')
    await duo.deliver()
    await duo.tick(5_000)
    const joined = await duo.link('C')
    await duo.deliver()
    await duo.tick(5_000)

    for (const dev of [rebooted, duo.dev('b'), joined]) {
      for (const p of UNSAFE) expect(await dev.adapter.read(p), `${p} on ${dev === rebooted ? "a" : dev === joined ? "c" : "b"}`).toBeNull()
      expect(await dev.adapter.listDirs()).not.toContain('.obsidian/plugins')
    }
    expect(dec.decode((await joined.adapter.read('a.md'))!)).toBe('hello\n')
    const refusals = joined.events.errors.filter((e) => String(e).includes('refused unsafe folder-map key'))
    expect(refusals.length).toBeGreaterThanOrEqual(2)
    duo.dispose()
  })
})
