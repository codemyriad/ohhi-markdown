import { describe, expect, it } from 'vitest'
import { NOTICE_LIMIT, appendNotice, formatTime, unreadCount, type Notice } from './notices.js'

describe('notice log', () => {
  it('prepends, ids uniquely, and caps the list', () => {
    let list: Notice[] = []
    list = appendNotice(list, { level: 'error', text: 'a' }, 1)
    list = appendNotice(list, { level: 'warn', text: 'b', path: 'notes/x.md' }, 2)
    expect(list.map((n) => n.text)).toEqual(['b', 'a'])
    expect(new Set(list.map((n) => n.id)).size).toBe(2)
    for (let i = 0; i < NOTICE_LIMIT + 5; i++) list = appendNotice(list, { level: 'info', text: `i${i}` }, 10 + i)
    expect(list).toHaveLength(NOTICE_LIMIT)
    expect(list[0].text).toBe(`i${NOTICE_LIMIT + 4}`)
  })

  it('collapses an immediate repeat into a fresher copy instead of stacking it', () => {
    let list = appendNotice([], { level: 'error', text: 'relay rejected this token' }, 1)
    list = appendNotice(list, { level: 'error', text: 'relay rejected this token' }, 5)
    expect(list).toHaveLength(1)
    expect(list[0].at).toBe(5)
    list = appendNotice(list, { level: 'error', text: 'something else' }, 6)
    list = appendNotice(list, { level: 'error', text: 'relay rejected this token' }, 7)
    expect(list.map((n) => n.text)).toEqual(['relay rejected this token', 'something else', 'relay rejected this token'])
  })

  it('counts what arrived since the log was last seen', () => {
    let list = appendNotice([], { level: 'info', text: 'old' }, 100)
    list = appendNotice(list, { level: 'info', text: 'new' }, 200)
    list = appendNotice(list, { level: 'info', text: 'newer' }, 300)
    expect(unreadCount(list, 150)).toBe(2)
    expect(unreadCount(list, 300)).toBe(0)
    expect(unreadCount(list, 0)).toBe(3)
  })

  it('formats a clock time', () => {
    const at = new Date(2026, 8, 10, 9, 5, 7).getTime()
    expect(formatTime(at)).toBe('09:05:07')
  })
})
