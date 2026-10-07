import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  asPeer,
  byPath,
  capped,
  caretOffset,
  everyone,
  initialsOf,
  noteName,
  onlinePeers,
  peersOf,
  peopleByRoom,
  presenceFor,
  slotFor,
  stackFor,
  STACK_CAP,
  whoIsWhere,
  type Peer,
} from './presence.js'

const peer = (name: string, clientId = name.length): Peer => ({ name, color: slotFor(name), clientId })

describe('presence (sharing E1)', () => {
  it('colours are presence slots 1..8, stable per name — never a hex', () => {
    for (const name of ['Cynthia', 'Sam', 'Anonymous', '']) {
      const slot = slotFor(name)
      expect(Number.isInteger(slot)).toBe(true)
      expect(slot).toBeGreaterThanOrEqual(1)
      expect(slot).toBeLessThanOrEqual(8)
      expect(slotFor(name)).toBe(slot)
    }
  })

  it('maps guid-keyed reports onto paths, dropping empty notes and unknown guids', () => {
    const files = [
      { path: 'CS/Paxos.md', guid: 'g1' },
      { path: 'CS/Raft.md', guid: 'g2' },
    ]
    const reports = new Map([
      ['g1', [{ clientId: 7, name: 'Sam', cursor: null }]],
      ['g2', []],
      ['gone', [{ clientId: 9, name: 'Ghost', cursor: null }]],
    ])
    expect(byPath(reports, files)).toEqual({ 'CS/Paxos.md': [{ name: 'Sam', color: slotFor('Sam'), clientId: 7 }] })
  })

  it('is empty when alone — nothing for anything to draw (R6)', () => {
    expect(byPath(new Map(), [{ path: 'a.md', guid: 'g' }])).toEqual({})
    expect(presenceFor({}, 'a.md')).toEqual([])
    expect(presenceFor({}, null)).toEqual([])
    expect(stackFor({}, { path: 'CS' })).toEqual({ shown: [], more: 0, all: [] })
    expect(everyone({}).shown).toEqual([])
    expect(peopleByRoom({}, [], 'root')).toEqual([])
  })

  it('orders by name, then client', () => {
    const peers = peersOf([
      { clientId: 3, name: 'Sam', cursor: null },
      { clientId: 2, name: 'Cynthia', cursor: null },
      { clientId: 1, name: 'Sam', cursor: null },
    ])
    expect(peers.map((p) => [p.name, p.clientId])).toEqual([
      ['Cynthia', 2],
      ['Sam', 1],
      ['Sam', 3],
    ])
  })

  it("a snapshot's name becomes a stack peer in the slot it travelled with, else its own", () => {
    expect(asPeer({ name: 'Bob', color: '5' })).toEqual({ name: 'Bob', color: 5, clientId: 0 })
    expect(asPeer({ name: 'Bob' }).color).toBe(slotFor('Bob'))
    // A missing slot stringified on the way ("undefined") is not a slot.
    expect(asPeer({ name: 'Bob', color: 'undefined' }).color).toBe(slotFor('Bob'))
  })

  it('caps at three initials plus a count, one person per name', () => {
    expect(STACK_CAP).toBe(3)
    const s = capped([peer('Eve'), peer('Ann'), peer('Dan'), peer('Bob'), peer('Ann', 99), peer('Cat')])
    expect(s.shown.map((p) => p.name)).toEqual(['Ann', 'Bob', 'Cat'])
    expect(s.more).toBe(2)
    expect(s.all).toHaveLength(5)
    expect(capped([peer('Ann'), peer('Bob')]).more).toBe(0)
  })

  it("stacks a mount's unique people across its notes, and nobody else's", () => {
    const presence = {
      'CS/Raft.md': [peer('Cynthia')],
      'CS/Paxos.md': [peer('Sam'), peer('Cynthia', 42)],
      'CSV/x.md': [peer('Zed')],
      'Daily/today.md': [peer('Dan')],
    }
    expect(stackFor(presence, { path: 'CS' }).all.map((p) => p.name)).toEqual(['Cynthia', 'Sam'])
    expect(stackFor(presence, { path: '' }).all.map((p) => p.name)).toEqual(['Cynthia', 'Dan', 'Sam', 'Zed'])
    expect(presenceFor(presence, 'CS/Paxos.md').map((p) => p.name)).toEqual(['Sam', 'Cynthia'])
  })

  it('initials: first letters of the first and last word, upper-cased, by code point', () => {
    expect(initialsOf('Cynthia')).toBe('C')
    expect(initialsOf('sam')).toBe('S')
    expect(initialsOf('Cynthia Lee')).toBe('CL')
    expect(initialsOf('  Ana  Maria   Lopes ')).toBe('AL')
    expect(initialsOf('élodie')).toBe('É')
    expect(initialsOf('😀 face')).toBe('😀F')
    expect(initialsOf('')).toBe('?')
  })

  it('groups people by the deepest shared folder, each with the note they are in', () => {
    const presence = {
      'CS/Raft.md': [peer('Cynthia')],
      'CS/deep/Paxos.md': [peer('Sam')],
      'Inbox.md': [peer('Dan')],
    }
    const mounts = [
      { path: 'CS', room: 'cs-room' },
      { path: 'CS/deep', room: 'deep-room' },
    ]
    const groups = peopleByRoom(presence, mounts, 'root')
    expect(groups.map((g) => [g.room, g.people.map((p) => `${p.peer.name}@${p.path}`)])).toEqual([
      ['root', ['Dan@Inbox.md']],
      ['cs-room', ['Cynthia@CS/Raft.md']],
      ['deep-room', ['Sam@CS/deep/Paxos.md']],
    ])
  })

  it('names a note the way a person reads it', () => {
    expect(noteName('CS/Raft, in one page.md')).toBe('Raft, in one page')
    expect(noteName('Inbox.md')).toBe('Inbox')
    expect(noteName('a/b.txt')).toBe('b.txt')
  })

  it("resolves a peer's caret from their awareness cursor, or null without one", () => {
    const doc = new Y.Doc()
    const text = doc.getText('content')
    text.insert(0, 'hello world')
    const head = Y.createRelativePositionFromTypeIndex(text, 6)
    const states = new Map<number, Record<string, unknown>>([
      [5, { cursor: { anchor: Y.relativePositionToJSON(head), head: Y.relativePositionToJSON(head) } }],
      [6, { user: { name: 'x' } }],
    ])
    expect(caretOffset(states, doc, 5)).toBe(6)
    text.insert(0, '>> ')
    expect(caretOffset(states, doc, 5)).toBe(9)
    expect(caretOffset(states, doc, 6)).toBeNull()
    expect(caretOffset(states, doc, 7)).toBeNull()
    expect(caretOffset(null, doc, 5)).toBeNull()
  })
})

describe('the sync icon\'s people (foundations-plan P5)', () => {
  const mounts = [{ path: 'CS', room: 'cs' }]
  it('onlinePeers: everyone online in your rooms, one per name, never you', () => {
    expect(onlinePeers({ root: ['Me', 'Sam'], cs: ['Cynthia', 'Me', 'Sam'] }, 'Me').map((p) => p.name)).toEqual(['Cynthia', 'Sam'])
    expect(onlinePeers({ root: ['Me'] }, 'Me')).toEqual([])
    expect(onlinePeers({}, 'Me')).toEqual([])
  })

  it('whoIsWhere: by room, people in a note first, then whoever is online in no note', () => {
    const groups = whoIsWhere(
      { 'CS/Raft.md': [peer('Cynthia')] },
      { root: ['Me', 'Ann'], cs: ['Cynthia', 'Me', 'Sam'], gone: ['Zed'] },
      mounts,
      'root',
      'Me'
    )
    expect(groups.map((g) => [g.mountPath, g.people.map((p) => `${p.peer.name}@${p.path ?? '-'}`)])).toEqual([
      ['', ['Ann@-']],
      ['CS', ['Cynthia@CS/Raft.md', 'Sam@-']],
    ])
    // Alone: nothing (R6).
    expect(whoIsWhere({}, { root: ['Me'] }, mounts, 'root', 'Me')).toEqual([])
  })
})
