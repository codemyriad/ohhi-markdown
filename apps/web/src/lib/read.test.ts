/**
 * The Read slice's shell rules (read-shaping.md X2/X4), none of which needs a
 * browser: which mode `Mod+E` lands in, what the command table advertises,
 * which URLs a note may send you to, and where an embed's bytes are looked
 * for. The two that carry a security argument — the scheme allow-list and the
 * refusal to climb out of the vault — are the reason this file exists.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18nObject } from '@ohhi/i18n/i18n-util'
import {
  afterToggleReading,
  afterToggleSource,
  attachmentCandidates,
  attachmentType,
  openExternal,
  readCommands,
  readLabels,
  readState,
  setDefaultMode,
  tagQuery,
  type ReadActions,
} from './read.svelte.js'
import { dropStorage, useMemStorage } from './storage.fixture.js'
import type { ViewMode } from './panes.js'

const LL = i18nObject('en')

function actions(over: Partial<ReadActions> = {}): ReadActions {
  return {
    hasNote: () => true,
    mode: () => 'live',
    setMode: vi.fn(),
    toggleReading: vi.fn(),
    toggleSource: vi.fn(),
    toggleCheckbox: vi.fn(),
    ...over,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  dropStorage()
})

describe('what Mod+E toggles (Fork 2-A)', () => {
  it('goes to Reading from either editing mode', () => {
    expect(afterToggleReading('live')).toBe('reading')
    expect(afterToggleReading('source')).toBe('reading')
  })

  it('comes back to the mode the tab was last EDITED in', () => {
    expect(afterToggleReading('reading', 'source')).toBe('source')
    expect(afterToggleReading('reading', 'live')).toBe('live')
  })

  it('comes back to Live when there is nothing remembered', () => {
    expect(afterToggleReading('reading')).toBe('live')
    // A remembered "reading" is not an editing mode and must not trap the tab.
    expect(afterToggleReading('reading', 'reading')).toBe('live')
  })

  it('Source is its own two-way switch, reachable from Reading too', () => {
    expect(afterToggleSource('live')).toBe('source')
    expect(afterToggleSource('source')).toBe('live')
    expect(afterToggleSource('reading')).toBe('source')
  })
})

describe('the command table', () => {
  it('binds the two keys Obsidian binds, and nothing else', () => {
    const bound = readCommands(actions())
      .filter((c) => c.keys)
      .map((c) => [c.id, c.keys])
    expect(bound).toEqual([
      ['view.toggle-reading', 'Mod+e'],
      ['edit.toggle-checkbox', 'Mod+l'],
    ])
  })

  it('offers a row per mode, titled from the dictionary', () => {
    const rows = readCommands(actions())
    expect(rows.map((c) => c.id)).toEqual([
      'view.toggle-reading',
      'view.toggle-source',
      'view.mode-live',
      'view.mode-source',
      'view.mode-reading',
      'edit.toggle-checkbox',
    ])
    expect(rows[2].title).toBe(LL.web.read.commands.mode({ mode: LL.web.read.modes.live() }))
    expect(new Set(rows.map((c) => c.group))).toEqual(new Set([LL.web.commands.groups.view()]))
  })

  it('every row is hidden with no note open', () => {
    const rows = readCommands(actions({ hasNote: () => false }))
    expect(rows.every((c) => c.when?.() === false)).toBe(true)
  })

  it('the checkbox row is hidden in Reading — the mode has no commands', () => {
    const reading = readCommands(actions({ mode: () => 'reading' }))
    const row = reading.find((c) => c.id === 'edit.toggle-checkbox')!
    expect(row.when?.()).toBe(false)
    const live = readCommands(actions({ mode: () => 'live' }))
    expect(live.find((c) => c.id === 'edit.toggle-checkbox')!.when?.()).toBe(true)
  })

  it('a mode row asks the shell for exactly its own mode', () => {
    const setMode = vi.fn()
    for (const row of readCommands(actions({ setMode }))) {
      if (row.id.startsWith('view.mode-')) void row.run()
    }
    expect(setMode.mock.calls.flat()).toEqual<ViewMode[]>(['live', 'source', 'reading'])
  })
})

describe('the default mode is a device preference', () => {
  it('writes through to config and to everything reading the mirror', () => {
    useMemStorage()
    const before = readState.defaultMode
    setDefaultMode('reading')
    expect(readState.defaultMode).toBe('reading')
    setDefaultMode(before)
  })
})

describe('openExternal (R2.4, the allow-list)', () => {
  function spy(): ReturnType<typeof vi.fn> {
    const open = vi.fn()
    vi.stubGlobal('window', { open })
    return open
  }

  it('opens http and https in a new, opener-less tab', () => {
    const open = spy()
    openExternal('https://example.com/a?b=c')
    openExternal('http://example.com/')
    expect(open.mock.calls).toEqual([
      ['https://example.com/a?b=c', '_blank', 'noopener'],
      ['http://example.com/', '_blank', 'noopener'],
    ])
  })

  it('refuses every other scheme — a note is untrusted content', () => {
    const open = spy()
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'vbscript:x',
      'not a url at all',
      '',
    ]) {
      openExternal(url)
    }
    expect(open).not.toHaveBeenCalled()
  })

  it('is case-insensitive about the scheme, as the URL parser is', () => {
    const open = spy()
    openExternal('JavaScript:alert(1)')
    expect(open).not.toHaveBeenCalled()
    openExternal('HTTPS://example.com/')
    expect(open).toHaveBeenCalledTimes(1)
  })
})

describe('attachmentCandidates (B2.3)', () => {
  it('looks beside the note first, then at the vault root', () => {
    expect(attachmentCandidates('shot.png', 'Areas/Data Vis/Marks.md')).toEqual([
      'Areas/Data Vis/shot.png',
      'shot.png',
    ])
  })

  it('asks once for a note at the root — the two places are the same place', () => {
    expect(attachmentCandidates('shot.png', 'Marks.md')).toEqual(['shot.png'])
    expect(attachmentCandidates('shot.png', null)).toEqual(['shot.png'])
  })

  it('keeps a folder written into the name', () => {
    expect(attachmentCandidates('Attachments/shot.png', 'Areas/Marks.md')).toEqual([
      'Areas/Attachments/shot.png',
      'Attachments/shot.png',
    ])
  })

  it("drops Obsidian's size and heading suffixes", () => {
    expect(attachmentCandidates('shot.png|300', null)).toEqual(['shot.png'])
    expect(attachmentCandidates('./shot.png', null)).toEqual(['shot.png'])
  })

  it('refuses to leave the vault, whoever wrote the name', () => {
    for (const name of [
      '../../etc/passwd',
      'a/../../b.png',
      '/etc/passwd',
      'C:\\Windows\\x.png',
      '..',
      '   ',
      '',
    ]) {
      expect(attachmentCandidates(name, 'Areas/Marks.md')).toEqual([])
    }
  })
})

describe('readLabels (what CM6 prints)', () => {
  it('is the dictionary, not English in the decoration code', () => {
    const labels = readLabels()
    expect(labels.missingAttachment).toBe(LL.web.read.missing_attachment())
    expect(labels.task).toBe(LL.web.read.task())
    expect(labels.frontmatterUnsupported).toBe(LL.web.read.frontmatter_unsupported())
    // The plural is the host's, because CM6 cannot reach a formatter.
    expect(labels.properties(1)).toBe(LL.web.read.properties({ count: 1 }))
    expect(labels.properties(4)).toBe(LL.web.read.properties({ count: 4 }))
  })
})

describe('tagQuery (B5)', () => {
  it('is the query `parseQuery` already understands, with or without the hash', () => {
    expect(tagQuery('edible/roadmap')).toBe('tag:#edible/roadmap')
    expect(tagQuery('#edible/roadmap')).toBe('tag:#edible/roadmap')
  })
})

describe('attachmentType', () => {
  it('names the image types the vault actually holds', () => {
    expect(attachmentType('a/b/shot.PNG')).toBe('image/png')
    expect(attachmentType('shot.jpeg')).toBe('image/jpeg')
  })

  it("says nothing rather than guessing for what it doesn't know", () => {
    expect(attachmentType('notes.md')).toBe('')
    expect(attachmentType('noext')).toBe('')
  })
})
