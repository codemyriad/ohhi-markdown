/**
 * Settings' map (settings-shaping Fork 7, QA round 1): the tree, the default,
 * and the names that are no longer sections — a stored `viewArg`, the
 * palette's last section or an old caller still lands somewhere sensible.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SECTION, NEEDS_VAULT, SETTINGS_GROUPS, SETTINGS_SECTIONS, settingsRows, settingsSection } from './settings.js'

describe('the settings map', () => {
  it('is a tree: Customise › Editor · Layout · Appearance · Keys | Sync & devices · AI | Developer · About', () => {
    expect(SETTINGS_GROUPS).toEqual([
      [{ id: 'customise', children: ['editor', 'layout', 'appearance', 'keys'] }],
      [{ id: 'sync' }, { id: 'ai' }],
      [{ id: 'developer' }, { id: 'about' }],
    ])
    // The flat list is the tree read top to bottom: nothing missing, nothing twice.
    expect(settingsRows().map((r) => r.id)).toEqual([...SETTINGS_SECTIONS])
    expect(settingsRows().filter((r) => r.depth === 1).map((r) => r.id)).toEqual(['editor', 'layout', 'appearance', 'keys'])
  })

  it('opens on the hub; Keys and Customise still need a vault', () => {
    expect(DEFAULT_SECTION).toBe('customise')
    expect([...NEEDS_VAULT].sort()).toEqual(['customise', 'keys'])
  })

  it('maps the folded sections and the dialog’s old tabs; anything unknown lands on the default', () => {
    expect(settingsSection('you')).toBe('sync')
    expect(settingsSection('agents')).toBe('ai')
    expect(settingsSection('general')).toBe('sync')
    expect(settingsSection('hotkeys')).toBe('keys')
    expect(settingsSection('vaults')).toBe('sync')
    expect(settingsSection('appearance')).toBe('appearance')
    expect(settingsSection('nope')).toBe(DEFAULT_SECTION)
    expect(settingsSection(undefined)).toBe(DEFAULT_SECTION)
  })
})
