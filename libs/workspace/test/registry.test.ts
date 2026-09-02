import { describe, expect, it } from 'vitest'
import { MountRegistry } from '../src/registry.js'
import type { MountSession } from '../src/mount-session.js'

// The registry only routes; a token object stands in for a real session.
function fakeSession(tag: string): MountSession {
  return { tag } as unknown as MountSession
}

describe('MountRegistry.resolve', () => {
  it('routes everything to the root mount when it is alone', () => {
    const reg = new MountRegistry()
    const root = fakeSession('root')
    reg.add('', root)
    expect(reg.resolve('notes/welcome.md')).toEqual({ mountPath: '', session: root, rel: 'notes/welcome.md' })
    expect(reg.resolve('deep/a/b/c.md')?.rel).toBe('deep/a/b/c.md')
  })

  it('prefers the longest matching mount prefix and rebases rel', () => {
    const reg = new MountRegistry()
    const root = fakeSession('root')
    const team = fakeSession('team')
    reg.add('', root)
    reg.add('areas/team', team)
    expect(reg.resolve('areas/team/plan.md')).toMatchObject({ mountPath: 'areas/team', rel: 'plan.md' })
    // A sibling that merely shares the string prefix is NOT inside the mount.
    expect(reg.resolve('areas/teammates.md')).toMatchObject({ mountPath: '', rel: 'areas/teammates.md' })
    expect(reg.resolve('other.md')).toMatchObject({ mountPath: '' })
  })

  it('returns null with no owning mount', () => {
    const reg = new MountRegistry()
    reg.add('shared', fakeSession('s'))
    expect(reg.resolve('elsewhere/f.md')).toBeNull()
  })

  it('rejects nested and duplicate mounts (root exempt)', () => {
    const reg = new MountRegistry()
    reg.add('', fakeSession('root'))
    reg.add('a/b', fakeSession('ab'))
    expect(() => reg.add('a/b', fakeSession('dup'))).toThrow(/already registered/)
    expect(() => reg.add('a/b/c', fakeSession('nested'))).toThrow(/may not nest/)
    expect(() => reg.add('a', fakeSession('parent'))).toThrow(/may not nest/)
    // Non-overlapping sibling is fine.
    reg.add('a/c', fakeSession('ac'))
  })
})
