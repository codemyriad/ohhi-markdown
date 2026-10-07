import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contrast, DARK_INK, LIGHT_INK, labelInk, parseColor } from '../src/peer-label.js'

describe('peer caret label ink', () => {
  it('parses the colour forms a fill arrives in', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255])
    expect(parseColor('#8A6300')).toEqual([138, 99, 0])
    expect(parseColor('#8a630033')).toEqual([138, 99, 0])
    expect(parseColor('rgb(163, 190, 140)')).toEqual([163, 190, 140])
    expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3])
    expect(parseColor('var(--x)')).toBeNull()
    expect(labelInk('papayawhip')).toBeNull()
  })

  it('puts light ink on a dark fill and dark ink on a light one', () => {
    expect(labelInk('#1f4e8c')).toBe(LIGHT_INK)
    // nord-dark's light slots: white on these was 1.6–4:1 under one token.
    expect(labelInk('#a3be8c')).toBe(DARK_INK)
    expect(labelInk('#ebcb8b')).toBe(DARK_INK)
  })

  it('picks the better of the two inks for any fill', () => {
    for (let r = 0; r <= 255; r += 51)
      for (let g = 0; g <= 255; g += 51)
        for (let b = 0; b <= 255; b += 51) {
          const fill = [r, g, b] as const
          const ink = parseColor(labelInk(`rgb(${r}, ${g}, ${b})`)!)!
          const other = parseColor(ink[0] === 255 ? DARK_INK : LIGHT_INK)!
          expect(contrast(fill, ink)).toBeGreaterThanOrEqual(contrast(fill, other))
        }
  })

  it("clears 4.5:1 on every built-in theme's presence slots, whichever theme sent them", () => {
    const dir = fileURLToPath(new URL('../../ui/src/styles/tokens/', import.meta.url))
    const slots = readdirSync(dir)
      .filter((f) => f.endsWith('.css'))
      .flatMap((f) => [...readFileSync(join(dir, f), 'utf8').matchAll(/--ed-presence-\d+:\s*(#[0-9a-fA-F]{3,8})/g)])
      .map((m) => m[1]!)
    expect(slots.length).toBeGreaterThanOrEqual(8)
    for (const fill of slots) {
      expect(contrast(parseColor(fill)!, parseColor(labelInk(fill)!)!), fill).toBeGreaterThanOrEqual(4.5)
    }
  })
})
