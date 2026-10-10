/**
 * The theme contract, asserted.
 *
 * These are correctness properties, not style checks. The sync colours are
 * the app's honesty signal (golden rule 4), so "did someone ship a theme
 * where pending and offline are the same grey" has to be a failing test and
 * not a code review.
 *
 * Scope note: this parses the SOURCE css, not Tailwind's output. That is on
 * purpose — every property here is about declarations we write ourselves, and
 * source parsing needs no build step. It does NOT catch a theme that fails to
 * compile; `rushx build` in apps/web is what catches that.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_THEMES,
  AGENT_WORKING_TOKEN,
  COMMENT_TOKENS,
  DARK_THEMES,
  GROUP_SLOTS,
  PRESENCE_SLOTS,
  SUGGEST_TOKENS,
  THEME_LABELS,
} from './tokens.js'

const here = fileURLToPath(new URL('./styles/', import.meta.url))
/** Source, comments stripped: these assertions are about DECLARATIONS, and a
 *  comment that mentions `@layer` is prose, not cascade behaviour. */
const read = (p: string): string =>
  readFileSync(here + p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const CONTRACT = read('tokens/_contract.css')
const BASE = read('base.css')
const SYNC = read('sync-tokens.css')
const TEMPLATE = read('_template.css')
const THEME_CSS: Record<string, string> = Object.fromEntries(
  BUILTIN_THEMES.map((t) => [t, read(`tokens/${t}.css`)])
)

/** Declared `--ed-*` names anywhere in a stylesheet. */
function declaredTokens(css: string): Set<string> {
  return new Set([...css.matchAll(/^\s*(--ed-[a-z0-9-]+)\s*:/gm)].map((m) => m[1]))
}

/** The `[data-theme="name"] { … }` block body, or '' when absent. */
function themeBlock(css: string, name: string): string {
  const start = css.indexOf(`[data-theme="${name}"]`)
  if (start === -1) return ''
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  return ''
}

/** The `@plugin "daisyui/theme" { … }` body — where band A's --color-* live. */
function daisyBlock(css: string): string {
  const start = css.indexOf('@plugin "daisyui/theme"')
  if (start === -1) return ''
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  return ''
}

function tokenValue(block: string, name: string): string | null {
  const m = block.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))
  return m ? m[1].trim() : null
}

// ---- colour maths (sRGB; enough for contrast + separation assertions) ----

/** #rgb / #rrggbb / #rrggbbaa → [r,g,b] 0-255, ignoring alpha. */
function parseHex(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#([0-9a-f]{3,8})$/i)
  if (!m) return null
  let h = m[1]
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join('')
  if (h.length !== 6 && h.length !== 8) return null
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const f = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a)
  const cb = parseHex(b)
  if (!ca || !cb) return 0
  const la = relativeLuminance(ca)
  const lb = relativeLuminance(cb)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Euclidean distance in sRGB — a coarse but adequate "are these the same colour". */
function colorDistance(a: string, b: string): number {
  const ca = parseHex(a)
  const cb = parseHex(b)
  if (!ca || !cb) return Infinity
  return Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2])
}

/**
 * Deuteranopia (red-green) simulation, Brettel/Viénot-style approximation on
 * linear-ish sRGB. Used only to assert that ok/pending stay separable — a
 * green "synced" and an amber "pending" that collapse to the same colour is a
 * dangerous failure, not a cosmetic one.
 */
function simulateDeuteranopia(hex: string): [number, number, number] {
  const c = parseHex(hex) ?? [0, 0, 0]
  const [r, g, b] = c
  return [
    0.625 * r + 0.375 * g + 0.0 * b,
    0.7 * r + 0.3 * g + 0.0 * b,
    0.0 * r + 0.3 * g + 0.7 * b,
  ]
}

function deuteranopiaDistance(a: string, b: string): number {
  const sa = simulateDeuteranopia(a)
  const sb = simulateDeuteranopia(b)
  return Math.hypot(sa[0] - sb[0], sa[1] - sb[1], sa[2] - sb[2])
}

const SYNC_STATES = ['ok', 'pending', 'diverged', 'offline'] as const

describe('token contract', () => {
  it('declares every --ed-* token the themes use', () => {
    const contract = declaredTokens(CONTRACT)
    for (const theme of BUILTIN_THEMES) {
      const used = declaredTokens(themeBlock(THEME_CSS[theme], theme))
      const unknown = [...used].filter((t) => !contract.has(t))
      expect(unknown, `${theme} sets tokens missing from _contract.css`).toEqual([])
    }
  })

  it('the copy-me template only uses contract tokens', () => {
    const contract = declaredTokens(CONTRACT)
    const unknown = [...declaredTokens(TEMPLATE)].filter((t) => !contract.has(t))
    expect(unknown, '_template.css advertises tokens that do not exist').toEqual([])
  })

  it('base.css registers exactly the themes that have token files', () => {
    const plugin = BASE.match(/@plugin\s+"daisyui"\s*\{([^}]*)\}/)
    expect(plugin, 'base.css must configure the daisyui plugin').not.toBeNull()
    const themes = plugin![1].match(/themes:\s*([^;]+);/)?.[1] ?? ''
    // Each entry is `name` optionally followed by --default / --prefersdark.
    const listed = themes
      .split(',')
      .map((entry) => entry.trim().split(/\s+/)[0])
      .filter(Boolean)
    expect(new Set(listed)).toEqual(new Set(BUILTIN_THEMES))
  })

  it('every built-in theme is labelled and its polarity declared', () => {
    for (const theme of BUILTIN_THEMES) {
      expect(THEME_LABELS[theme], `${theme} has no label`).toBeTruthy()
      const scheme = THEME_CSS[theme].match(/color-scheme:\s*(light|dark)/)?.[1]
      expect(scheme, `${theme} must declare color-scheme`).toBeDefined()
      expect(
        scheme === 'dark',
        `${theme}: color-scheme and DARK_THEMES disagree`
      ).toBe(DARK_THEMES.has(theme))
    }
  })

  it('every theme defines all eight presence slots', () => {
    for (const theme of BUILTIN_THEMES) {
      const block = themeBlock(THEME_CSS[theme], theme)
      const source = block.includes('--ed-presence-1') ? block : CONTRACT
      for (let i = 1; i <= PRESENCE_SLOTS; i++) {
        expect(tokenValue(source, `--ed-presence-${i}`), `${theme} slot ${i}`).toBeTruthy()
      }
    }
  })
})

describe('sync honesty (band C)', () => {
  it('is unlayered — a user theme must not be able to reach it', () => {
    expect(
      SYNC.includes('@layer'),
      'sync-tokens.css must contain no @layer: unlayered rules beat every layer, ' +
        'which is what stops an injected user theme from repainting the pill'
    ).toBe(false)
  })

  it('is imported last, after every layered token file', () => {
    const syncAt = BASE.indexOf('./sync-tokens.css')
    const lastTheme = Math.max(...BUILTIN_THEMES.map((t) => BASE.indexOf(`./tokens/${t}.css`)))
    expect(syncAt).toBeGreaterThan(lastTheme)
  })

  it('paints the pill by longhand on its own element, not by an inherited var', () => {
    // Cascade layers only settle conflicts on the SAME element, and custom
    // properties inherit — a theme's `body { --ed-sync-ok: green }` would be
    // the only declaration on <body> and the pill would inherit it. A longhand
    // on the dot's own element closes that vector. (The `!important` vector is
    // closed one step earlier, in sanitizeThemeCss.)
    for (const status of ['green', 'yellow', 'red', 'offline']) {
      const rule = new RegExp(
        `\\[data-status='${status}'\\] > \\.ed-sync-dot \\{[^}]*background-color:`
      )
      expect(SYNC, `no unlayered dot rule for ${status}`).toMatch(rule)
    }
    // The dot's GEOMETRY is unlayered too — otherwise a layered
    // `display: none` hides the signal rather than recolouring it.
    expect(SYNC).toMatch(/\.ed-sync-dot \{[^}]*display:\s*inline-block/)
    // …and the host's, so hiding the pill's own element fails as well.
    expect(SYNC).toMatch(/\.ed-sync-host \{[^}]*display:\s*inline-flex/)
    // Exactly one unscoped rule per status (the editor-light defaults).
    for (const status of ['green', 'yellow', 'red', 'offline']) {
      const unscoped = SYNC.match(new RegExp(`(^|\\})\\s*\\[data-status='${status}'\\] > \\.ed-sync-dot`, 'g')) ?? []
      expect(unscoped.length, `unscoped ${status} dot rules`).toBe(1)
    }
    // ...and it must all stay unlayered: `@layer` anywhere in this file would
    // put it behind a user theme's normal rules.
    expect(SYNC.includes('@layer')).toBe(false)
    // ...and a theme override for every non-default theme.
    for (const theme of BUILTIN_THEMES) {
      if (theme === 'editor-light') continue // the defaults above ARE its palette
      // Every status, scoped: an unscoped override would repaint every theme's dot.
      for (const status of ['green', 'yellow', 'red', 'offline']) {
        expect(SYNC, `${theme} has no scoped ${status} dot rule`).toContain(
          `[data-theme='${theme}'] [data-status='${status}'] > .ed-sync-dot {`
        )
      }
    }
  })

  it('paints the sync ICON the same way: its stroke, per status and theme, the dot\'s colour', () => {
    // foundations-plan P5: the toolbar's sync readout is a glyph whose STROKE
    // is the state. Longhands on the svg AND on every shape inside it — a
    // layered `path { stroke: … }` lands on the child, past an inherited one.
    expect(SYNC).toMatch(/\.ed-sync-icon \{[^}]*display:\s*inline-block[^}]*fill:\s*none[^}]*stroke:/)
    expect(SYNC).toMatch(/\.ed-sync-icon \* \{[^}]*fill:\s*none[^}]*stroke:\s*inherit/)
    const colour = (selector: string, prop: string): string | undefined =>
      SYNC.match(new RegExp(`${selector.replace(/[[\]().*>]/g, '\\$&')} \\{\\s*${prop}:\\s*(#[0-9a-f]+)`))?.[1]
    for (const theme of [null, ...BUILTIN_THEMES.filter((t) => t !== 'editor-light')]) {
      for (const status of ['green', 'yellow', 'red', 'offline']) {
        const scope = theme ? `[data-theme='${theme}'] ` : ''
        const dot = colour(`${scope}[data-status='${status}'] > .ed-sync-dot`, 'background-color')
        const icon = colour(`${scope}[data-status='${status}'] > .ed-sync-icon`, 'stroke')
        expect(icon, `${theme ?? 'default'} ${status} icon`).toBeTruthy()
        expect(icon, `${theme ?? 'default'} ${status}: icon and dot must say the same`).toBe(dot)
      }
    }
  })

  it('never uses a DaisyUI brand colour as a sync colour', () => {
    // Brand colours are a marketing decision; the honesty signal must not be
    // downstream of one.
    expect(SYNC).not.toMatch(/--ed-sync-[a-z-]+:\s*var\(--color-(success|warning|error|neutral)\)/)
  })

  it('defines all four state/foreground pairs for :root and every theme', () => {
    for (const scope of [':root', ...BUILTIN_THEMES]) {
      const block = scope === ':root' ? themeRoot(SYNC) : themeBlock(SYNC, scope)
      expect(block, `${scope} has no sync block`).not.toBe('')
      for (const state of SYNC_STATES) {
        expect(tokenValue(block, `--ed-sync-${state}`), `${scope} ${state}`).toBeTruthy()
        expect(tokenValue(block, `--ed-sync-${state}-fg`), `${scope} ${state} fg`).toBeTruthy()
      }
    }
  })

  it('keeps the four states visually distinct', () => {
    for (const theme of BUILTIN_THEMES) {
      const block = themeBlock(SYNC, theme)
      const values = SYNC_STATES.map((s) => tokenValue(block, `--ed-sync-${s}`)!)
      for (let i = 0; i < values.length; i++) {
        for (let j = i + 1; j < values.length; j++) {
          expect(
            colorDistance(values[i], values[j]),
            `${theme}: ${SYNC_STATES[i]} and ${SYNC_STATES[j]} are too close`
          ).toBeGreaterThan(40)
        }
      }
    }
  })

  it('keeps ok and pending separable under deuteranopia', () => {
    for (const theme of BUILTIN_THEMES) {
      const block = themeBlock(SYNC, theme)
      expect(
        deuteranopiaDistance(
          tokenValue(block, '--ed-sync-ok')!,
          tokenValue(block, '--ed-sync-pending')!
        ),
        `${theme}: "synced" and "pending" collapse for a red-green colourblind reader`
      ).toBeGreaterThan(30)
    }
  })

  it('clears 4.5:1 for every state foreground', () => {
    for (const theme of BUILTIN_THEMES) {
      const block = themeBlock(SYNC, theme)
      for (const state of SYNC_STATES) {
        const bg = tokenValue(block, `--ed-sync-${state}`)!
        const fg = tokenValue(block, `--ed-sync-${state}-fg`)!
        expect(contrastRatio(bg, fg), `${theme} ${state}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('never puts a presence colour near the diverged colour', () => {
    // A peer's caret must never be mistakable for a conflict marker.
    for (const theme of BUILTIN_THEMES) {
      const diverged = tokenValue(themeBlock(SYNC, theme), '--ed-sync-diverged')!
      const block = themeBlock(THEME_CSS[theme], theme)
      const source = block.includes('--ed-presence-1') ? block : CONTRACT
      for (let i = 1; i <= PRESENCE_SLOTS; i++) {
        const peer = tokenValue(source, `--ed-presence-${i}`)!
        expect(
          colorDistance(peer, diverged),
          `${theme}: presence slot ${i} (${peer}) is too close to diverged (${diverged})`
        ).toBeGreaterThan(60)
      }
    }
  })
})

/**
 * Presence avatars and sync dots share rows (tabs, the tree, the toolbar), so
 * a peer must never read as a STATE (sharing R5) — not only the diverged red
 * above, but every one of the four. And an avatar's initials sit on its slot
 * colour, so each slot's ink must clear WCAG 1.4.3's 4.5:1 on it, per theme
 * (white on a dark theme's light slots reached 1.6:1).
 */
describe('presence colours (band B)', () => {
  const presenceSource = (theme: string, name: string): string | null => {
    const block = themeBlock(THEME_CSS[theme], theme)
    return tokenValue(block, name) ?? tokenValue(CONTRACT, name)
  }

  it('declares an ink per presence slot in the contract', () => {
    const contract = declaredTokens(CONTRACT)
    for (let i = 1; i <= PRESENCE_SLOTS; i++) expect(contract.has(`--ed-presence-fg-${i}`), `slot ${i} fg`).toBe(true)
  })

  for (const theme of BUILTIN_THEMES) {
    for (let i = 1; i <= PRESENCE_SLOTS; i++) {
      it(`${theme} slot ${i}: initials clear 4.5:1, and the colour is no sync state`, () => {
        const slot = presenceSource(theme, `--ed-presence-${i}`)!
        const ink = presenceSource(theme, `--ed-presence-fg-${i}`)!
        expect(slot, `${theme} slot ${i}`).toMatch(/^#/)
        expect(ink, `${theme} slot ${i} fg`).toMatch(/^#/)
        expect(contrastRatio(slot, ink), `${theme} slot ${i} (${slot}) with ink ${ink}`).toBeGreaterThanOrEqual(4.5)
        const sync = themeBlock(SYNC, theme)
        for (const state of SYNC_STATES) {
          const value = tokenValue(sync, `--ed-sync-${state}`)!
          // 30: "not the same colour" — catches a slot that IS a state
          // (#8a6300 was presence and pending) or a near-copy of one.
          expect(
            colorDistance(slot, value),
            `${theme}: presence slot ${i} (${slot}) reads as sync ${state} (${value})`
          ).toBeGreaterThan(30)
        }
      })
    }
  }
})

/**
 * Tab-group colours (W2, tab-groups-shaping Fork 5-B).
 *
 * A group colour is TASTE — a user theme may retint the whole band, and two
 * people's "CS reading" groups being different colours costs nothing. Three
 * things are not taste, and they are what this asserts:
 *
 *  - the band exists in every theme, so a chip is never `background: ""`;
 *  - the eight are telling apart, or the colour carries no information;
 *  - none of them is the diverged red. Red means "your document diverged" in
 *    every Editor theme (the same reservation the presence band carries).
 *
 * NOT asserted: separation from ok / pending / offline. In nord-* the theme's
 * own green and yellow ARE its sync ok and pending, and a named chip that
 * carries its name is not the pill in the status bar. (Presence, an unlabelled
 * avatar beside the dots, does assert it — above.) Red is the reservation that matters, and it is checked here.
 */
describe('tab-group colours (band B)', () => {
  /** Where a theme's group slots are declared: its own block, else the contract. */
  const groupSource = (theme: string): string => {
    const block = themeBlock(THEME_CSS[theme], theme)
    return block.includes('--ed-group-1') ? block : CONTRACT
  }
  const slots = (theme: string): string[] =>
    Array.from({ length: GROUP_SLOTS }, (_, i) => tokenValue(groupSource(theme), `--ed-group-${i + 1}`)!)

  it('every theme defines all eight group slots', () => {
    for (const theme of BUILTIN_THEMES) {
      for (let i = 1; i <= GROUP_SLOTS; i++) {
        expect(tokenValue(groupSource(theme), `--ed-group-${i}`), `${theme} group ${i}`).toBeTruthy()
      }
    }
  })

  it('keeps the eight slots distinguishable from each other', () => {
    // 20 is a "not the same colour" floor, not a design target: nord-dark's
    // tightest pair is Nord's own two frost blues (#88c0d0 / #8fbcbb, 22
    // units), and a faithful port is worth more than a rounder number.
    for (const theme of BUILTIN_THEMES) {
      const values = slots(theme)
      for (let i = 0; i < values.length; i++) {
        for (let j = i + 1; j < values.length; j++) {
          expect(
            colorDistance(values[i], values[j]),
            `${theme}: group ${i + 1} (${values[i]}) and ${j + 1} (${values[j]}) are too close`
          ).toBeGreaterThan(20)
        }
      }
    }
  })

  it('never puts a group colour near the diverged colour', () => {
    // Looser than presence's 60 on purpose: a peer's caret is an unlabelled
    // 2px bar that can appear anywhere in the text, while a group chip always
    // carries the name you gave it. nord-dark's Nord orange (#d08770) sits 42
    // units from Nord's aurora red and is the closest any theme comes.
    for (const theme of BUILTIN_THEMES) {
      const diverged = tokenValue(themeBlock(SYNC, theme), '--ed-sync-diverged')!
      slots(theme).forEach((value, i) => {
        expect(
          colorDistance(value, diverged),
          `${theme}: group ${i + 1} (${value}) reads as the diverged colour (${diverged})`
        ).toBeGreaterThan(35)
      })
    }
  })

  it('clears 3:1 against the chrome surface it is painted on', () => {
    // The chip's swatch is a 9px dot on --color-base-100 and its tab cap a
    // 2px rule: a non-text graphic, so WCAG 1.4.11's 3:1 is the bar.
    for (const theme of BUILTIN_THEMES) {
      const base = tokenValue(daisyBlock(THEME_CSS[theme]), '--color-base-100')!
      expect(base, `${theme} declares no --color-base-100`).toBeTruthy()
      slots(theme).forEach((value, i) => {
        expect(contrastRatio(value, base), `${theme} group ${i + 1} (${value}) on ${base}`)
          .toBeGreaterThanOrEqual(3)
      })
    }
  })
})

/**
 * The pane focus mark (spike S21 Q3): with two panes and no strip, a 2 px edge
 * in --ed-pane-focus is the only thing that says where the keyboard is. A
 * state indicator, so WCAG 1.4.11's 3:1 against the chrome surface is the bar
 * — in every built-in theme, whether it states the token or inherits the
 * contract's `var(--color-primary)`.
 */
describe('pane focus mark (band B)', () => {
  /** A token's value in a theme: its own block, else the contract; `var(--color-*)` resolved through band A. */
  const resolve = (theme: string, name: string): string | null => {
    const block = themeBlock(THEME_CSS[theme], theme)
    let value = tokenValue(block, name) ?? tokenValue(CONTRACT, name)
    for (let depth = 0; value?.startsWith('var(') && depth < 4; depth++) {
      const inner = value.slice(4, -1).trim()
      value = inner.startsWith('--color-')
        ? tokenValue(daisyBlock(THEME_CSS[theme]), inner)
        : (tokenValue(block, inner) ?? tokenValue(CONTRACT, inner))
    }
    return value
  }

  it('declares the eight pane tokens in the contract', () => {
    const contract = declaredTokens(CONTRACT)
    for (const name of [
      '--ed-pane-divider',
      '--ed-pane-focus',
      '--ed-pane-focus-width',
      '--ed-pane-mode',
      '--ed-group-cap',
      '--ed-strip-bg',
      '--ed-tab-active-bg',
      '--ed-tab-live',
    ]) {
      expect(contract.has(name), name).toBe(true)
    }
  })

  it('clears 3:1 against --color-base-100 in every built-in theme', () => {
    for (const theme of BUILTIN_THEMES) {
      const base = tokenValue(daisyBlock(THEME_CSS[theme]), '--color-base-100')!
      const focus = resolve(theme, '--ed-pane-focus')
      expect(focus, `${theme} resolves no --ed-pane-focus`).toMatch(/^#/)
      expect(contrastRatio(focus!, base), `${theme} pane focus (${focus}) on ${base}`).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('editor readability', () => {
  it('keeps body ink readable on the editing surface', () => {
    for (const theme of BUILTIN_THEMES) {
      const block = themeBlock(THEME_CSS[theme], theme)
      const surface = tokenValue(block, '--ed-surface') ?? tokenValue(CONTRACT, '--ed-surface')!
      const ink = tokenValue(block, '--ed-ink') ?? tokenValue(CONTRACT, '--ed-ink')!
      expect(contrastRatio(surface, ink), `${theme} body text`).toBeGreaterThanOrEqual(7)
    }
  })

  it('keeps every heading level at AA-large or better', () => {
    // Headings are large text, so 3:1 is the bar — but nord-light's faithful
    // port would land at 1.6:1, which is why it carries corrections.
    for (const theme of BUILTIN_THEMES) {
      const block = themeBlock(THEME_CSS[theme], theme)
      const surface = tokenValue(block, '--ed-surface') ?? tokenValue(CONTRACT, '--ed-surface')!
      for (let h = 1; h <= 6; h++) {
        const value = tokenValue(block, `--ed-h${h}`)
        if (!value || value.startsWith('var(')) continue // inherits --ed-ink
        expect(contrastRatio(surface, value), `${theme} h${h} (${value})`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('never paints an unresolved wikilink in the diverged colour', () => {
    // Aurora red is reserved for divergence in EVERY theme. An unresolved
    // link is a note you have not written yet — not a conflict — and the two
    // must never look the same. (nord-light shipped this bug once.)
    for (const theme of BUILTIN_THEMES) {
      const diverged = tokenValue(themeBlock(SYNC, theme), '--ed-sync-diverged')!
      const block = themeBlock(THEME_CSS[theme], theme)
      const unresolved =
        tokenValue(block, '--ed-wikilink-unresolved') ??
        tokenValue(CONTRACT, '--ed-wikilink-unresolved')!
      expect(
        colorDistance(unresolved, diverged),
        `${theme}: unresolved wikilink (${unresolved}) reads as the diverged colour (${diverged})`
      ).toBeGreaterThan(60)
    }
  })

  it('keeps an unresolved wikilink distinguishable from a resolved one', () => {
    // 12% of this vault's links are unresolved and they read as intent, not
    // typos — rendering them identically hides an eighth of the link graph.
    for (const theme of BUILTIN_THEMES) {
      const block = themeBlock(THEME_CSS[theme], theme)
      const link = tokenValue(block, '--ed-wikilink') ?? tokenValue(CONTRACT, '--ed-wikilink')!
      const unresolved =
        tokenValue(block, '--ed-wikilink-unresolved') ??
        tokenValue(CONTRACT, '--ed-wikilink-unresolved')!
      expect(colorDistance(link, unresolved), `${theme} wikilink states`).toBeGreaterThan(40)
    }
  })
})

/**
 * Suggestions in the document (writing-harness B7). They are TEXT colours —
 * the struck base and the inserted proposal are words a writer reads — so
 * each clears 4.5:1 on the editing surface; and a proposal is not a
 * conflict, so neither colour may read as the diverged red.
 */
describe('suggestion colours (band B)', () => {
  const value = (theme: string, name: string): string =>
    tokenValue(themeBlock(THEME_CSS[theme], theme), name) ?? tokenValue(CONTRACT, name)!

  it('declares the three tokens in the contract', () => {
    for (const name of SUGGEST_TOKENS) expect(declaredTokens(CONTRACT).has(name), name).toBe(true)
  })

  it('clears 4.5:1 on --ed-surface in every built-in theme, and keeps add and del apart', () => {
    for (const theme of BUILTIN_THEMES) {
      const surface = value(theme, '--ed-surface')
      for (const name of SUGGEST_TOKENS) {
        expect(contrastRatio(surface, value(theme, name)), `${theme} ${name}`).toBeGreaterThanOrEqual(4.5)
      }
      expect(colorDistance(value(theme, '--ed-suggest-add'), value(theme, '--ed-suggest-del')), `${theme} add/del`).toBeGreaterThan(60)
    }
  })

  it('never paints a suggestion in the diverged colour', () => {
    for (const theme of BUILTIN_THEMES) {
      const diverged = tokenValue(themeBlock(SYNC, theme), '--ed-sync-diverged')!
      for (const name of SUGGEST_TOKENS) {
        expect(colorDistance(value(theme, name), diverged), `${theme} ${name}`).toBeGreaterThan(60)
      }
    }
  })
})

/**
 * List depth guides (Chris, 2026-10-06). The guide is a structural hairline,
 * so it takes the rule's treatment rather than a contrast floor of its own: in
 * every built-in theme `--ed-list-guide` resolves to exactly `--ed-hr` — a
 * theme that wants a different guide states it, and this test is where that
 * decision gets made on purpose.
 */
describe('list guides and indent (band B)', () => {
  const resolve = (theme: string, name: string): string | null => {
    const block = themeBlock(THEME_CSS[theme], theme)
    let value = tokenValue(block, name) ?? tokenValue(CONTRACT, name)
    for (let depth = 0; value?.startsWith('var(--ed-') && depth < 4; depth++) {
      const inner = value.slice(4, -1).trim()
      value = tokenValue(block, inner) ?? tokenValue(CONTRACT, inner)
    }
    return value
  }

  it('declares the two list tokens in the contract, read now (no (V2e) marker)', () => {
    for (const name of ['--ed-list-indent', '--ed-list-guide']) {
      expect(declaredTokens(CONTRACT).has(name), name).toBe(true)
      expect(CONTRACT).not.toMatch(new RegExp(`${name}:[^\\n]*\\(V2e\\)`))
    }
  })

  it('paints the guide as the rule in every built-in theme', () => {
    for (const theme of BUILTIN_THEMES) {
      const guide = resolve(theme, '--ed-list-guide')
      expect(guide, `${theme} resolves no --ed-list-guide`).toMatch(/^#/)
      expect(guide, `${theme} list guide`).toBe(resolve(theme, '--ed-hr'))
    }
  })
})

/** The bare `:root { … }` block of a stylesheet (first occurrence). */
function themeRoot(css: string): string {
  const start = css.search(/^:root\s*\{/m)
  if (start === -1) return ''
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  return ''
}

/**
 * Comment-thread tints (writing-harness B8). A tint over text, so the rule is
 * not contrast but identity: a commented passage must never read as a search
 * match (the yellow) — the two can sit on one screen at once.
 */
describe('comment tints (band B)', () => {
  const value = (theme: string, name: string): string =>
    tokenValue(themeBlock(THEME_CSS[theme], theme), name) ?? tokenValue(CONTRACT, name)!

  it('declares both tokens in the contract', () => {
    for (const name of COMMENT_TOKENS) expect(declaredTokens(CONTRACT).has(name), name).toBe(true)
  })

  it('keeps an open thread apart from a search match in every built-in theme', () => {
    for (const theme of BUILTIN_THEMES) {
      expect(
        colorDistance(value(theme, '--ed-comment-bg'), value(theme, '--ed-search-match-bg')),
        theme
      ).toBeGreaterThan(60)
    }
  })
})

/**
 * The agent's working tint (writing-harness B10). Presence, so it must never
 * read as a sync state (golden rule 4 / sharing R5), and it can share a
 * screen with a comment and a search match, so it is neither of those either.
 */
describe('agent working tint (band B)', () => {
  const value = (theme: string, name: string): string =>
    tokenValue(themeBlock(THEME_CSS[theme], theme), name) ?? tokenValue(CONTRACT, name)!

  it('is declared in the contract', () => {
    expect(declaredTokens(CONTRACT).has(AGENT_WORKING_TOKEN)).toBe(true)
  })

  it('is no sync colour, no comment and no search match in any built-in theme', () => {
    for (const theme of BUILTIN_THEMES) {
      const tint = value(theme, AGENT_WORKING_TOKEN)
      const sync = themeBlock(SYNC, theme)
      for (const state of SYNC_STATES) {
        expect(colorDistance(tint, tokenValue(sync, `--ed-sync-${state}`)!), `${theme} vs sync ${state}`).toBeGreaterThan(60)
      }
      expect(colorDistance(tint, value(theme, '--ed-comment-bg')), `${theme} vs comment`).toBeGreaterThan(60)
      expect(colorDistance(tint, value(theme, '--ed-search-match-bg')), `${theme} vs search`).toBeGreaterThan(60)
    }
  })
})
