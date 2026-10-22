/**
 * `scopedAdapter` and `ignoringAdapter` forward `WatchEvent.moves` (for
 * backends that see renames — nextcloud-build decision 11),
 * remapped and filtered like `paths`: a move with one end outside the scope
 * (or inside a hidden subtree) is a create or a vanish on the visible side.
 */
import { describe, expect, it } from 'vitest'
import { ignoringAdapter, scopedAdapter } from '../src/adapter-wrappers.js'
import { MemVaultAdapter } from '../src/mem-adapter.js'
import type { WatchEvent } from '../src/types.js'

class MovingMemAdapter extends MemVaultAdapter {
  private subs = new Set<(ev: WatchEvent) => void>()
  override watch(cb: (ev: WatchEvent) => void): () => void {
    this.subs.add(cb)
    return () => this.subs.delete(cb)
  }
  fire(ev: WatchEvent): void {
    for (const cb of this.subs) cb(ev)
  }
}

describe('watch wrappers forward moves', () => {
  it('scopedAdapter remaps moves inside the scope and degrades half-inside ones', () => {
    const base = new MovingMemAdapter()
    const scoped = scopedAdapter(base, 'team')
    const seen: WatchEvent[] = []
    scoped.watch((ev) => seen.push(ev))
    base.fire({
      paths: ['team/a.md', 'other/x.md'],
      moves: [
        { from: 'team/old.md', to: 'team/new.md' },
        { from: 'elsewhere/in.md', to: 'team/arrived.md' },
        { from: 'team/left.md', to: 'elsewhere/out.md' },
        { from: 'other/p.md', to: 'other/q.md' },
      ],
    })
    expect(seen).toEqual([
      { paths: ['a.md', 'arrived.md', 'left.md'], moves: [{ from: 'old.md', to: 'new.md' }] },
    ])
  })

  it('ignoringAdapter keeps moves between visible paths and degrades the rest', () => {
    const base = new MovingMemAdapter()
    const hidden = new Set(['mount'])
    const wrapped = ignoringAdapter(base, hidden)
    const seen: WatchEvent[] = []
    wrapped.watch((ev) => seen.push(ev))
    base.fire({
      paths: ['a.md', 'mount/x.md'],
      moves: [
        { from: 'old.md', to: 'new.md' },
        { from: 'mount/in.md', to: 'arrived.md' },
        { from: 'left.md', to: 'mount/out.md' },
        { from: 'mount/p.md', to: 'mount/q.md' },
      ],
    })
    expect(seen).toEqual([{ paths: ['a.md', 'arrived.md', 'left.md'], moves: [{ from: 'old.md', to: 'new.md' }] }])
  })

  it('emits nothing when every path and move is outside', () => {
    const base = new MovingMemAdapter()
    const scoped = scopedAdapter(base, 'team')
    const seen: WatchEvent[] = []
    scoped.watch((ev) => seen.push(ev))
    base.fire({ paths: ['other/x.md'], moves: [{ from: 'other/a.md', to: 'other/b.md' }] })
    expect(seen).toEqual([])
  })
})
