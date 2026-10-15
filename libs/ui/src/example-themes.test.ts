/**
 * The example custom themes (`examples/themes/<name>/theme.css`), asserted.
 *
 * Nord Light and Dark left the built-ins on 2026-10-15 (v2-shaping Fork 2,
 * Fork 4-A) and ship as files a vault holds — the app's own "Add to this
 * vault" writes them byte for byte. So they are held to the custom-theme
 * format, which is narrower than a built-in's (docs/theming.md, *Custom
 * themes*): ONE `[data-theme="<folder>"]` block, a `color-scheme`, contract
 * tokens only, and nothing the loader's sanitizer would strip — band C is out
 * of a theme's reach, so a file that tried to set it would be lying about
 * what it does.
 *
 * And to the honesty rules every theme shares, against the sync set of the
 * polarity its `color-scheme` picks (sync-tokens.css): no presence colour
 * reads as a sync state or the diverged red, no group colour or unresolved
 * link reads as diverged. The readability floors are asserted too, with the
 * port's documented misses named in `MISSES` — the list docs/theming.md
 * prints — so a miss is a decision written down, never a surprise.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GROUP_SLOTS, PRESENCE_SLOTS } from './tokens.js'

const styles = fileURLToPath(new URL('./styles/', import.meta.url))
const examples = fileURLToPath(new URL('../../../examples/themes/', import.meta.url))
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')
const CONTRACT = strip(readFileSync(`${styles}tokens/_contract.css`, 'utf8'))
const SYNC = strip(readFileSync(`${styles}sync-tokens.css`, 'utf8'))

const NAMES = readdirSync(examples, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()
const RAW: Record<string, string> = Object.fromEntries(
  NAMES.map((n) => [n, readFileSync(`${examples}${n}/theme.css`, 'utf8')])
)
const CSS: Record<string, string> = Object.fromEntries(NAMES.map((n) => [n, strip(RAW[n]!)]))

function block(css: string, selector: string): string {
  const start = css.indexOf(selector)
  if (start === -1) return ''
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}
const value = (body: string, name: string): string | null =>
  body.match(new RegExp(`(?:^|[;{\\s])${name}\\s*:\\s*([^;]+);`))?.[1]?.trim() ?? null
const declared = (css: string): Set<string> =>
  new Set([...css.matchAll(/^\s*(--ed-[a-z0-9-]+)\s*:/gm)].map((m) => m[1]!))

const themeBody = (name: string): string => block(CSS[name]!, `[data-theme="${name}"]`)
const polarity = (name: string): 'light' | 'dark' =>
  value(themeBody(name), 'color-scheme') === 'dark' ? 'dark' : 'light'
const syncSet = (name: string): string => block(SYNC, `[data-polarity='${polarity(name)}']`)
/** A token as the theme resolves it: its own value, else the contract's default. */
const tok = (name: string, token: string): string => value(themeBody(name), token) ?? value(CONTRACT, token)!

function rgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#([0-9a-f]{3,8})$/i)
  if (!m) return null
  let h = m[1]!
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join('')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrast(a: string, b: string): number {
  const ca = rgb(a)
  const cb = rgb(b)
  if (!ca || !cb) return 0
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
function distance(a: string, b: string): number {
  const ca = rgb(a)
  const cb = rgb(b)
  if (!ca || !cb) return Infinity
  return Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2])
}

const SYNC_STATES = ['ok', 'pending', 'diverged', 'offline'] as const
const FENCE_TEXT = ['keyword', 'string', 'number', 'function', 'type'] as const

/**
 * The floors the Nord port misses, by theme — kept as Nord's own values on
 * purpose (docs/theming.md, *The Nord example*, prints this list). Each
 * entry is asserted to STILL miss, so the list cannot go stale: fix a colour
 * and this test asks you to strike it here and in the docs.
 */
const MISSES: Record<string, readonly string[]> = {
  // #81a1c1 3.74:1, #b48ead 3.55:1, #616e88 1.96:1 — on nord1 #3b4252.
  'nord-dark': ['fence keyword', 'fence number', 'fence comment'],
  // 3.50, 3.39, 4.45 and 4.15:1 on its slab.
  'nord-light': ['fence keyword', 'fence string', 'fence number', 'fence type'],
}

/** Every readability floor the docs give, measured: label → [ratio, floor]. */
function floors(name: string): Record<string, [number, number]> {
  const surface = tok(name, '--ed-surface')
  const slab = tok(name, '--ed-code-block-bg')
  const out: Record<string, [number, number]> = {
    'body ink': [contrast(surface, tok(name, '--ed-ink')), 7],
  }
  for (let h = 1; h <= 6; h++) {
    const v = value(themeBody(name), `--ed-h${h}`)
    if (v?.startsWith('#')) out[`h${h}`] = [contrast(surface, v), 3]
  }
  for (const slot of FENCE_TEXT) out[`fence ${slot}`] = [contrast(slab, tok(name, `--ed-syn-${slot}`)), 4.5]
  // Strictly above 3:1 for the comment (the "2.98 rounded to 3.0" lesson).
  out['fence comment'] = [contrast(slab, tok(name, '--ed-syn-comment')) - 0.001, 3]
  for (const s of ['--ed-suggest-del', '--ed-suggest-add', '--ed-suggest-stale']) {
    out[s.slice(5)] = [contrast(surface, tok(name, s)), 4.5]
  }
  return out
}

describe('the example custom themes', () => {
  it('ships the two Nord examples', () => {
    expect(NAMES).toEqual(['nord-dark', 'nord-light'])
  })

  for (const name of NAMES) {
    describe(name, () => {
      it('is one [data-theme] block named after its folder, with a color-scheme', () => {
        const blocks = CSS[name]!.match(/\{/g) ?? []
        expect(blocks, 'one block, nothing nested').toHaveLength(1)
        expect(CSS[name]!.trim().startsWith(`[data-theme="${name}"]`)).toBe(true)
        expect(value(themeBody(name), 'color-scheme')).toMatch(/^(light|dark)$/)
        expect(name).toMatch(/^[\w -]{1,64}$/)
      })

      it('carries nothing the loader strips: no @-rule, url(), !important, sync token or pill rule', () => {
        const css = CSS[name]!
        expect(css).not.toMatch(/@(import|plugin|layer|charset|namespace|font-face)/i)
        expect(css).not.toMatch(/url\(|image-set|cross-fade|!\s*important/i)
        expect(css).not.toMatch(/--ed-sync-|data-status|data-testid|pill|sync|:has\(/i)
      })

      it('sets only contract tokens', () => {
        const contract = declared(CONTRACT)
        expect([...declared(themeBody(name))].filter((t) => !contract.has(t))).toEqual([])
      })

      it('restates its own people and group colours, none of which reads as a sync state', () => {
        const sync = syncSet(name)
        const diverged = value(sync, '--ed-sync-diverged')!
        for (let i = 1; i <= PRESENCE_SLOTS; i++) {
          const slot = value(themeBody(name), `--ed-presence-${i}`)
          const ink = value(themeBody(name), `--ed-presence-fg-${i}`)
          expect(slot, `presence ${i}`).toMatch(/^#/)
          expect(contrast(slot!, ink ?? tok(name, `--ed-presence-fg-${i}`)), `presence ${i} initials`).toBeGreaterThanOrEqual(4.5)
          expect(distance(slot!, diverged), `presence ${i} vs diverged`).toBeGreaterThan(60)
          for (const state of SYNC_STATES) {
            expect(distance(slot!, value(sync, `--ed-sync-${state}`)!), `presence ${i} vs ${state}`).toBeGreaterThan(30)
          }
        }
        const base = value(themeBody(name), '--color-base-100')!
        for (let i = 1; i <= GROUP_SLOTS; i++) {
          const group = value(themeBody(name), `--ed-group-${i}`)
          expect(group, `group ${i}`).toMatch(/^#/)
          expect(distance(group!, diverged), `group ${i} vs diverged`).toBeGreaterThan(35)
          expect(contrast(group!, base), `group ${i} on base-100`).toBeGreaterThanOrEqual(3)
        }
        const unresolved = tok(name, '--ed-wikilink-unresolved')
        expect(distance(unresolved, diverged)).toBeGreaterThan(60)
        expect(distance(unresolved, tok(name, '--ed-wikilink'))).toBeGreaterThan(40)
        expect(distance(tok(name, '--ed-agent-working-bg').slice(0, 7), diverged)).toBeGreaterThan(60)
      })

      it('meets the readability floors, but for the misses docs/theming.md lists', () => {
        const measured = floors(name)
        const missed = Object.entries(measured)
          .filter(([, [ratio, floor]]) => ratio < floor)
          .map(([label, [ratio]]) => `${label} ${ratio.toFixed(2)}`)
        expect(
          missed.map((m) => m.replace(/ [\d.]+$/, '')),
          `${name} misses: ${missed.join(', ')}`
        ).toEqual(MISSES[name] ?? [])
      })
    })
  }
})
