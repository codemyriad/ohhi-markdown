/**
 * Template rendering (quiet-shell F11; the Stage 6 gate: a template with
 * `{{date}}` inserts the PINNED clock's date). Every case runs on a fixed
 * instant — local 3 October 2026, 09:05 — so nothing reads the wall clock.
 */
import { describe, expect, it } from 'vitest'
import { BUILTIN_TEMPLATES, parseTemplate, render, splitArgs } from './template.js'

const now = new Date(2026, 9, 3, 9, 5).getTime()

describe('render — over an injected clock', () => {
  it('{{date}} is the pinned day, in the vault’s daily-note format (YYYY-MM-DD with none)', () => {
    expect(render('# {{date}}', { now })).toBe('# 2026-10-03')
    // Chris's own daily format, so a template and the daily note name the same day.
    expect(render('# {{date}}', { now, dateFormat: 'DD-M-Y' })).toBe('# 03-10-2026')
    expect(render('{{date:dddd D MMMM YYYY}}', { now })).toBe('Saturday 3 October 2026')
  })
  it('{{time}} and {{title}}', () => {
    expect(render('{{time}} · {{ title }}', { now, title: 'Standup' })).toBe('09:05 · Standup')
    expect(render('{{title}}', { now })).toBe('')
  })
  it('positional arguments, defaults, $@ and $$', () => {
    const t = '$1 with $2 (${3:-nobody}) — all: $@ — costs $$5'
    expect(render(t, { now, args: ['Sync', 'Ana'] })).toBe('Sync with Ana (nobody) — all: Sync Ana — costs $5')
    expect(render('${1:-Meeting}', { now })).toBe('Meeting')
    expect(render('${1:-Meeting}', { now, args: ['Retro'] })).toBe('Retro')
    expect(render('[$1]', { now })).toBe('[]')
  })
  it('one pass: an argument holding a placeholder is inserted as written', () => {
    expect(render('$1', { now, args: ['{{date}} $2'] })).toBe('{{date}} $2')
  })
})

describe('parseTemplate', () => {
  it('reads description and argument-hint, and drops a block that held only them', () => {
    const p = parseTemplate('---\ndescription: Meeting notes\nargument-hint: "[topic]"\n---\n# $1\n')
    expect(p).toEqual({ description: 'Meeting notes', argumentHint: '[topic]', body: '# $1\n' })
  })
  it('keeps any other frontmatter, line for line', () => {
    const p = parseTemplate('---\ntags: [meeting]\ndescription: x\nstatus: draft\n---\nbody\n')
    expect(p.body).toBe('---\ntags: [meeting]\nstatus: draft\n---\nbody\n')
  })
  it('a file without frontmatter is all body', () => {
    expect(parseTemplate('just text')).toEqual({ description: '', argumentHint: '', body: 'just text' })
  })
})

describe('the shipped example templates', () => {
  it('meeting.md and daily.md describe themselves and render over the pinned clock', () => {
    expect(Object.keys(BUILTIN_TEMPLATES).sort()).toEqual(['daily', 'meeting'])
    const meeting = parseTemplate(BUILTIN_TEMPLATES.meeting!)
    expect(meeting.description).not.toBe('')
    expect(meeting.argumentHint).not.toBe('')
    expect(render(meeting.body, { now, args: ['Retro', 'Ana', 'Bo'] })).toContain('## Retro — 2026-10-03 09:05')
    const daily = parseTemplate(BUILTIN_TEMPLATES.daily!)
    expect(render(daily.body, { now })).toContain('# Saturday 3 October 2026')
  })
})

describe('splitArgs — the picker’s argument syntax', () => {
  it('words, and a quoted phrase as one', () => {
    expect(splitArgs('meeting Retro "Ana Bo"')).toEqual(['meeting', 'Retro', 'Ana Bo'])
    expect(splitArgs('   ')).toEqual([])
  })
})
