/**
 * The seams the Read slice meets the shell at (read-shaping.md B2/B3).
 *
 * Both are Facets for the same reason `wikiLinkHost` is one: the value is
 * reconfigured through the host compartment, never passed as a prop, so a
 * change of mode or host never destroys the view (and its Y.Text binding).
 */
import { Facet } from '@codemirror/state'

/** One CM6 view, three ways of looking at the same document. */
export type ViewMode = 'live' | 'source' | 'reading'

/**
 * Which mode the decorations render for. `live` hides markers off the active
 * region; `reading` hides them everywhere; `source` hides nothing.
 */
export const previewMode = Facet.define<ViewMode, ViewMode>({
  combine: (values) => values[values.length - 1] ?? 'live',
})

/**
 * What the collapsed frontmatter strip renders — structurally the subset of
 * @ohhi/frontmatter's `Frontmatter` it needs, so the shell can pass
 * `parseFrontmatter` itself with no adapter.
 */
export interface FrontmatterView {
  /** A `---` block at offset 0 with a closing delimiter. */
  present: boolean
  /** Every entry is in the patchable flat subset; false ⇒ the strip badges. */
  supported: boolean
  entries: readonly { key: string }[]
  /** `tags`/`tag`, all three spellings, `#` stripped. */
  tags: readonly string[]
}

/**
 * Copy a widget cannot reach through $LL: CM6 runs outside Svelte, so the
 * shell hands the rendered strings down with the rest of the host.
 */
export interface ReadLabels {
  /** Placeholder under an embed whose file this device does not hold. */
  missingAttachment: string
  /** Accessible name for a checkbox whose task has no text yet (the a11y gate). */
  task: string
  /** The dim `4 properties` label on the collapsed strip; plural is the host's. */
  properties(count: number): string
  /** Badge in place of chips when the YAML is not in the patchable subset. */
  frontmatterUnsupported: string
  // --- code cards and callouts (editor-usability E3) ---
  /** The code card's copy button. */
  copyCode: string
  /** The copy button's name for a moment after it has copied. */
  codeCopied: string
  /** The language chip's accessible name: it names the language and opens the list. */
  codeLanguage(lang: string): string
  /** The chip's text for a fence with no language. */
  codePlain: string
  /** A foldable callout's chevron (with `aria-expanded` beside it). */
  toggleCallout(title: string): string
  // --- tables (editor-usability E4) ---
  /** The hint toolbar over a table the caret is in; absent ⇒ the English fallback. */
  table?: TableLabels
  // --- images (editor-usability E5) ---
  /** `![alt](https://…)`'s placeholder; absent ⇒ the English fallback. */
  remoteImage?: RemoteImageLabels
}

/** The copy around a remote image that is not loaded until it is asked for (E5). */
export interface RemoteImageLabels {
  /** The placeholder's line: `Image from example.com`. */
  from(host: string): string
  /** Its button. */
  load: string
  /** After a refused load: why there is still no picture. */
  failed(host: string): string
  /** The link-styled form's tooltip, where the host cannot load remote images at all. */
  notLoaded: string
}

/** The developer fallback for a host that passes no image labels. */
export const FALLBACK_REMOTE_IMAGE_LABELS: RemoteImageLabels = {
  from: (host) => `Image from ${host}`,
  load: 'Load image',
  failed: (host) => `${host} did not let the image load here`,
  notLoaded: 'Remote image, not loaded',
}

/** The table hint toolbar's copy (E4): the key hints and its three buttons. */
export interface TableLabels {
  /** The toolbar's accessible name. */
  toolbar: string
  /** `Tab next cell` — a hint, not a button. */
  nextCell: string
  /** `↵ next row` — a hint, not a button. */
  nextRow: string
  /** `↵ on an empty row: done` — Enter on an empty last row leaves the table. */
  leave: string
  /** `+ row` — inserts a row below the caret's. */
  addRow: string
  /** `+ column` — inserts a column right of the caret's. */
  addColumn: string
  /** `Align` — pads the columns. */
  align: string
}

/** The developer fallback for a host that passes no table labels. */
export const FALLBACK_TABLE_LABELS: TableLabels = {
  toolbar: 'Table',
  nextCell: 'Tab next cell',
  nextRow: '↵ next row',
  leave: '↵ on an empty row: done',
  addRow: '+ row',
  addColumn: '+ column',
  align: 'Align',
}

/** What a rendered note can ask its host for. Every method is optional to call from a widget; none may throw. */
export interface ReadHost {
  /**
   * Bytes of an attachment named in `![[name]]` — or, with `form: 'markdown'`,
   * the local `src` of `![alt](src)`, a path relative to the note — or null
   * when this device does not hold it.
   */
  readAttachment(name: string, form?: 'wikilink' | 'markdown'): Promise<Blob | null>
  /** Open an http(s) URL outside the editor (Tauri shell / window.open). */
  openExternal(url: string): void
  /** Run a vault search for `tag:#tag` — what a click on a chip does. */
  searchTag(tag: string): void
  /** Every tag the index knows, `#` included — the `#` completion source. */
  tags(): string[]
  /** User-facing strings for the widgets. */
  labels: ReadLabels
  /**
   * Fetch a REMOTE image's bytes, on a click and never before (E5): a synced,
   * agent-writable note is not a trusted page, so nothing it names is loaded
   * by opening it. Null when the fetch is refused (CORS, the CSP, offline).
   * Optional: a host without it leaves `![alt](https://…)` as a link.
   */
  loadRemoteImage?(url: string): Promise<Blob | null>
  /**
   * Read this note's frontmatter for the collapsed strip — the shell passes
   * @ohhi/frontmatter's `parseFrontmatter` straight in.
   *
   * Optional, and the one host capability that is: this package cannot depend
   * on @ohhi/frontmatter (adding the dependency means a lockfile change, and
   * the wiring costs the shell one line), so without a reader a frontmatter
   * block simply stays visible as YAML rather than collapsing to a strip.
   */
  frontmatter?(text: string): FrontmatterView
}

/**
 * The default host: everything a widget asks for is absent, nothing throws.
 * The labels are the only English in this package — they are a developer
 * fallback for a view mounted before `readHost.of(...)`, never shipped copy.
 */
const NOOP_HOST: ReadHost = {
  readAttachment: async () => null,
  openExternal: () => {},
  searchTag: () => {},
  tags: () => [],
  labels: {
    missingAttachment: 'Not on this device',
    task: 'Task',
    properties: (count) => `${count} properties`,
    frontmatterUnsupported: 'Frontmatter does not parse',
    copyCode: 'Copy code',
    codeCopied: 'Copied',
    codeLanguage: (lang) => `Language: ${lang}`,
    codePlain: 'plain text',
    toggleCallout: (title) => `Fold ${title}`,
  },
}

export const readHost = Facet.define<ReadHost, ReadHost>({
  combine: (values) => values[values.length - 1] ?? NOOP_HOST,
})
