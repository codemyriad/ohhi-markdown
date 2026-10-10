/**
 * The handful of lucide icons the CM6 widgets draw (callout titles, the code
 * card's header). The shell draws lucide through `@lucide/svelte`; decoration
 * code runs outside Svelte, so the same geometry is restated here as data —
 * lucide's own node lists (v1.44, ISC licence), never hand-drawn paths.
 *
 * Every icon is decorative: `aria-hidden`, beside a text label or inside a
 * button that carries its own `aria-label`. Colour is `currentColor`, so the
 * theme paints it through the element it sits in (golden rule 7).
 */
import type { CalloutIcon } from './callout.js'

export type IconName = CalloutIcon | 'chevron-down' | 'chevron-right' | 'copy' | 'check'

type IconNode = readonly [tag: 'path' | 'circle' | 'rect', attrs: Readonly<Record<string, string>>]

const CIRCLE: IconNode = ['circle', { cx: '12', cy: '12', r: '10' }]

const ICONS: Readonly<Record<IconName, readonly IconNode[]>> = {
  info: [CIRCLE, ['path', { d: 'M12 16v-4' }], ['path', { d: 'M12 8h.01' }]],
  lightbulb: [
    [
      'path',
      { d: 'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5' },
    ],
    ['path', { d: 'M9 18h6' }],
    ['path', { d: 'M10 22h4' }],
  ],
  'triangle-alert': [
    ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }],
    ['path', { d: 'M12 9v4' }],
    ['path', { d: 'M12 17h.01' }],
  ],
  'octagon-x': [
    ['path', { d: 'm15 9-6 6' }],
    [
      'path',
      {
        d: 'M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z',
      },
    ],
    ['path', { d: 'm9 9 6 6' }],
  ],
  'circle-check': [CIRCLE, ['path', { d: 'm16 9-5.5 5.5L8 12' }]],
  'circle-help': [CIRCLE, ['path', { d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' }], ['path', { d: 'M12 17h.01' }]],
  bug: [
    ['path', { d: 'M12 20v-9' }],
    ['path', { d: 'M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z' }],
    ['path', { d: 'M14.12 3.88 16 2' }],
    ['path', { d: 'M21 21a4 4 0 0 0-3.81-4' }],
    ['path', { d: 'M21 5a4 4 0 0 1-3.55 3.97' }],
    ['path', { d: 'M22 13h-4' }],
    ['path', { d: 'M3 21a4 4 0 0 1 3.81-4' }],
    ['path', { d: 'M3 5a4 4 0 0 0 3.55 3.97' }],
    ['path', { d: 'M6 13H2' }],
    ['path', { d: 'm8 2 1.88 1.88' }],
    ['path', { d: 'M9 7.13V6a3 3 0 1 1 6 0v1.13' }],
  ],
  list: [
    ['path', { d: 'M3 5h.01' }],
    ['path', { d: 'M3 12h.01' }],
    ['path', { d: 'M3 19h.01' }],
    ['path', { d: 'M8 5h13' }],
    ['path', { d: 'M8 12h13' }],
    ['path', { d: 'M8 19h13' }],
  ],
  quote: [
    [
      'path',
      { d: 'M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z' },
    ],
    [
      'path',
      { d: 'M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z' },
    ],
  ],
  clipboard: [
    ['rect', { width: '8', height: '4', x: '8', y: '2', rx: '1', ry: '1' }],
    ['path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' }],
  ],
  'chevron-down': [['path', { d: 'm6 9 6 6 6-6' }]],
  'chevron-right': [['path', { d: 'm9 18 6-6-6-6' }]],
  copy: [
    ['rect', { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' }],
    ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }],
  ],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
}

const SVG = 'http://www.w3.org/2000/svg'

/** A lucide icon as an `<svg>`, sized by the theme (`.cm-icon`). */
export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'cm-icon')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  for (const [tag, attrs] of ICONS[name]) {
    const child = document.createElementNS(SVG, tag)
    for (const [k, v] of Object.entries(attrs)) child.setAttribute(k, v)
    svg.appendChild(child)
  }
  return svg
}
