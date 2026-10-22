/** `configForSession`: what a host-booted entry carries reaches the workspace config (the read-only grant). */
import { describe, expect, it } from 'vitest'
import { configForSession } from './boot.js'

describe('configForSession', () => {
  it('threads a read-only grant to the workspace (every editor of the vault opens read-only)', async () => {
    const ro = await configForSession({ vault: { kind: 'memory' }, room: 'r1', readOnly: true }, 'alice')
    expect(ro.readOnly).toBe(true)
    const rw = await configForSession({ vault: { kind: 'memory' }, room: 'r1' }, 'alice')
    expect(rw.readOnly).toBeUndefined()
  })
})
