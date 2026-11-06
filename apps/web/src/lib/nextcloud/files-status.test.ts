/** The `files` readout (decision 8): the custodian's per-guid claims, summed into one honest line. */
import type { CustodianState } from '@ohhi/workspace'
import { describe, expect, it } from 'vitest'
import { enrollingProgress, filesReadout } from './files-status.js'

const rows = [
  { path: 'a.md', guid: 'g-a' },
  { path: 'b.md', guid: 'g-b' },
  { path: 'c.md', guid: 'g-c' },
]

const custodian = (disk: CustodianState['disk'], blocked: CustodianState['blocked'] = {}): CustodianState => ({
  type: 'custodian',
  instance: 'i1',
  disk,
  blocked,
  holds: 0,
})

describe('files status', () => {
  it('is hidden without a custodian', () => {
    expect(filesReadout(null, rows)).toEqual({ kind: 'hidden' })
  })

  it('ignores guids no row has', () => {
    const disk = { 'g-a': 'match', 'g-b': 'match', 'g-c': 'match', 'g-gone': 'blocked' } as const
    expect(filesReadout(custodian(disk, { 'g-gone': 423 }), rows)).toEqual({ kind: 'in-files' })
  })

  it('says In Files when every note is announced as matching', () => {
    expect(filesReadout(custodian({ 'g-a': 'match', 'g-b': 'match', 'g-c': 'match' }), rows)).toEqual({ kind: 'in-files' })
  })

  it('a note the custodian has not announced yet is waiting, never In Files (nextcloud-build R1 #8)', () => {
    expect(filesReadout(custodian({ 'g-a': 'match' }), rows)).toEqual({ kind: 'waiting', count: 2 })
    expect(filesReadout(custodian({}), rows)).toEqual({ kind: 'waiting', count: 3 })
    // Folders and attachments are not announced: they never count.
    const withDir = [...rows.map((r) => ({ ...r, kind: 'text' })), { path: 'd', guid: 'g-d', kind: 'dir' }]
    expect(filesReadout(custodian({ 'g-a': 'match', 'g-b': 'match', 'g-c': 'match' }), withDir)).toEqual({ kind: 'in-files' })
  })

  it('this browser\'s own unsent edits are waiting, whatever the custodian last said (nextcloud-build R1 #8)', () => {
    const all = custodian({ 'g-a': 'match', 'g-b': 'match', 'g-c': 'match' })
    const ok = { pendingLocal: false, synced: true }
    expect(filesReadout(all, rows, { 'g-a': ok, 'g-b': ok, 'g-c': ok })).toEqual({ kind: 'in-files' })
    expect(filesReadout(all, rows, { 'g-a': { pendingLocal: true, synced: true }, 'g-b': ok })).toEqual({
      kind: 'waiting',
      count: 1,
    })
    expect(filesReadout(all, rows, { 'g-a': ok, 'g-b': { pendingLocal: false, synced: false } })).toEqual({
      kind: 'waiting',
      count: 1,
    })
  })

  it('counts pending writes', () => {
    expect(filesReadout(custodian({ 'g-a': 'behind', 'g-b': 'behind', 'g-c': 'match' }), rows)).toEqual({
      kind: 'waiting',
      count: 2,
    })
  })

  it('a refusal outranks a pending write and carries its status', () => {
    const c = custodian({ 'g-a': 'behind', 'g-b': 'blocked', 'g-c': 'blocked' }, { 'g-b': 423 })
    expect(filesReadout(c, rows)).toEqual({ kind: 'blocked', count: 2, status: 423 })
    expect(filesReadout(custodian({ 'g-c': 'blocked' }), rows)).toEqual({ kind: 'blocked', count: 1, status: null })
  })
})

describe('enrollingProgress', () => {
  it('counts match of announced while enrolling, and nothing otherwise', () => {
    expect(enrollingProgress(null)).toBeNull()
    expect(enrollingProgress({ custodian: 'running', files: { a: 'match' } })).toBeNull()
    expect(enrollingProgress({ custodian: 'enrolling', files: {} })).toEqual({ done: 0, total: 0 })
    expect(enrollingProgress({ custodian: 'enrolling', files: { a: 'match', b: 'behind', c: 'match' } })).toEqual({ done: 2, total: 3 })
  })
})
