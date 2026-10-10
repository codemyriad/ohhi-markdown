/**
 * Test fixtures for the Read slice: a real EditorState, a real lezer tree, no
 * browser. The engine is pure by design — `buildPreview` is a function of the
 * state — so everything below the widget's `toDOM` is testable in node.
 */
import { ensureSyntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { buildPreview } from '../src/preview/build.js'
import {
  Frontmatter,
  Highlight,
  livePreview,
  previewMode,
  readHost,
  Tag,
  WikiLink,
  type FrontmatterView,
  type ReadHost,
  type ViewMode,
  type WikiLinkHost,
  wikiLinkHost,
} from '../src/index.js'

/**
 * A stand-in for @ohhi/frontmatter's `parseFrontmatter` (A3's contract).
 * Deliberately minimal and deliberately test-only: the engine reads the real
 * parser through the host facet, so a double here is enough to drive the strip.
 */
export function fakeFrontmatter(text: string): FrontmatterView {
  const lines = text.split('\n')
  if (lines[0]?.trim() !== '---') return { present: false, supported: true, entries: [], tags: [] }
  const end = lines.findIndex((l, i) => i > 0 && (l.trimEnd() === '---' || l.trimEnd() === '...'))
  if (end === -1) return { present: false, supported: true, entries: [], tags: [] }
  const entries: { key: string }[] = []
  const tags: string[] = []
  let supported = true
  for (const raw of lines.slice(1, end)) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue
    const m = /^([A-Za-z_][\w.-]*):\s*(.*)$/.exec(raw)
    if (!m) {
      supported = false
      continue
    }
    entries.push({ key: m[1] })
    if (m[1] === 'tags' || m[1] === 'tag') {
      const inner = m[2].replace(/^\[|\]$/g, '')
      for (const t of inner.split(/[,\s]+/)) if (t) tags.push(t.replace(/^#/, ''))
    }
  }
  return { present: true, supported, entries, tags }
}

export function testHost(over: Partial<ReadHost> = {}): ReadHost {
  return {
    readAttachment: async () => null,
    openExternal: () => {},
    searchTag: () => {},
    tags: () => [],
    labels: {
      missingAttachment: 'missing',
      task: 'Task',
      properties: (n) => `${n} properties`,
      frontmatterUnsupported: 'unsupported',
      copyCode: 'Copy code',
      codeCopied: 'Copied',
      codeLanguage: (lang) => `Language: ${lang}`,
      codePlain: 'plain text',
      toggleCallout: (title) => `Fold ${title}`,
    },
    frontmatter: fakeFrontmatter,
    ...over,
  }
}

/** The mode compartment of every test state — reconfigure it to change mode. */
export const modeCompartment = new Compartment()

export interface StateOptions {
  /** Caret offset (clamped to the document), or a range; default 0. */
  at?: number | { anchor: number; head: number }
  mode?: ViewMode
  host?: ReadHost
  /** Only the tests that care about resolved-vs-unresolved links pass one. */
  linkHost?: WikiLinkHost
  /** Anything else libs/editor installs that a test needs (e.g. `indentUnit`). */
  extensions?: Extension[]
}

export function makeState(doc: string, opts: StateOptions = {}): EditorState {
  const at = opts.at ?? 0
  const state = EditorState.create({
    doc,
    selection:
      typeof at === 'number' ? { anchor: Math.min(at, doc.length) } : at,
    extensions: [
      // Same grammar libs/editor installs, minus `codeLanguages`: nested
      // language highlighting is the language-data package's job, not a
      // decoration, and editor-lang does not depend on it.
      markdown({ base: markdownLanguage, extensions: [WikiLink, Tag, Highlight, Frontmatter] }),
      // The engine itself, so the field and plugin are testable too.
      livePreview(),
      // In a compartment, as libs/editor holds it: a mode change is a
      // reconfigure, and a test can make one.
      modeCompartment.of(previewMode.of(opts.mode ?? 'live')),
      readHost.of(opts.host ?? testHost()),
      opts.linkHost ? wikiLinkHost.of(opts.linkHost) : [],
      opts.extensions ?? [],
    ],
  })
  // Node has no idle time, so make the parse complete before anything reads the
  // tree; in the app CM6 does this in the background, around the viewport.
  // `ensureSyntaxTree` advances the parse context, but the language field's
  // tree is the snapshot taken when the state was built — one empty
  // transaction publishes it (which is exactly how the app gets it too).
  ensureSyntaxTree(state, state.doc.length, 10_000)
  return state.update({}).state
}

export type DecoKind = 'line' | 'mark' | 'hide' | 'widget' | 'block-widget'

export interface FlatDeco {
  from: number
  to: number
  kind: DecoKind
  /** The class for a line/mark, the widget's constructor name for a widget. */
  value: string
  text: string
  /** The widget instance, for tests that assert what it was built from. */
  widget?: unknown
}

export function decorations(state: EditorState): FlatDeco[] {
  const { decorations: set } = buildPreview(state)
  const out: FlatDeco[] = []
  set.between(0, state.doc.length, (from, to, deco) => {
    const spec = deco.spec as { class?: string; widget?: object; block?: boolean }
    const kind: DecoKind = spec.widget
      ? spec.block
        ? 'block-widget'
        : 'widget'
      : spec.class
        ? from === to
          ? 'line'
          : 'mark'
        : 'hide'
    out.push({
      from,
      to,
      kind,
      value: spec.widget ? spec.widget.constructor.name : (spec.class ?? ''),
      text: state.doc.sliceString(from, to),
      widget: spec.widget,
    })
  })
  return out
}

/** Every range live preview hides — what `EditorView.atomicRanges` is given. */
export function hidden(state: EditorState): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  buildPreview(state).hidden.between(0, state.doc.length, (from, to) => {
    out.push({ from, to })
  })
  return out
}

