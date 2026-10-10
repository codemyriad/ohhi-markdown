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
 * shell hands the rendered strings down with the rest of the host. The
 * constructs the editor usability pass added each have a group of their own,
 * optional, with an English `FALLBACK_*` beside its interface — a developer
 * fallback for a host that passes none, never shipped copy.
 */
export interface ReadLabels {
  /** Placeholder under an embed whose file this device does not hold. */
  missingAttachment: string
  /** Placeholder for `![[X.base]]` when no such collection exists in the vault. */
  missingCollection: string
  /** Accessible name for a checkbox whose task has no text yet (the a11y gate). */
  task: string
  /** The dim `4 properties` label on the collapsed strip; plural is the host's. */
  properties(count: number): string
  /** Badge in place of chips when the YAML is not in the patchable subset. */
  frontmatterUnsupported: string
  /** The code card's header (E3). */
  code?: CodeLabels
  /** A callout's title row (E3). */
  callout?: CalloutLabels
  /** The hint toolbar over a table the caret is in (E4). */
  table?: TableLabels
  /** `![alt](https://…)`'s placeholder (E5). */
  remoteImage?: RemoteImageLabels
  /** The `[[` link popover (E1); the shell hands the same group to `wikiLinkHost`. */
  linkPopover?: LinkPopoverLabels
}

/** The code card's copy (E3): its copy button and its language chip. */
export interface CodeLabels {
  /** The copy button. */
  copy: string
  /** The copy button's name for a moment after it has copied. */
  copied: string
  /** The language chip's accessible name: it names the language and opens the list. */
  language(lang: string): string
  /** The chip's text for a fence with no language. */
  plain: string
}

export const FALLBACK_CODE_LABELS: CodeLabels = {
  copy: 'Copy code',
  copied: 'Copied',
  language: (lang) => `Language: ${lang}`,
  plain: 'plain text',
}

/** A callout's copy (E3). */
export interface CalloutLabels {
  /** A foldable callout's chevron (with `aria-expanded` beside it). */
  toggle(title: string): string
}

export const FALLBACK_CALLOUT_LABELS: CalloutLabels = {
  toggle: (title) => `Fold ${title}`,
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

export const FALLBACK_TABLE_LABELS: TableLabels = {
  toolbar: 'Table',
  nextCell: 'Tab next cell',
  nextRow: '↵ next row',
  leave: '↵ on an empty row: done',
  addRow: '+ row',
  addColumn: '+ column',
  align: 'Align',
}

/** The link popover's copy (E1): its group headers, its create row and its footer of key hints. */
export interface LinkPopoverLabels {
  /** The share's own group: `In {mount}`. */
  scope(mount: string): string
  /** The group below the divider, one line: `Only you · not in this share`. */
  others: string
  /** Its tooltip: why those notes are set apart. */
  othersTitle: string
  /** The last row when nothing matches exactly: `Create “{query}”`. */
  create(query: string): string
  /** The folder a note at the vault root is created in (shown dim on the create row). */
  vaultRoot: string
  /** The footer's words, after their keys: `↵ Tab link · # heading · | alias · Esc`. */
  hintLink: string
  hintHeading: string
  hintAlias: string
  keyEnter: string
  keyTab: string
  keyEscape: string
}

export const FALLBACK_LINK_LABELS: LinkPopoverLabels = {
  scope: (mount) => `In ${mount}`,
  others: 'Only you · not in this share',
  othersTitle: "Collaborators can't open these",
  create: (query) => `Create “${query}”`,
  vaultRoot: '/',
  hintLink: 'link',
  hintHeading: 'heading',
  hintAlias: 'alias',
  keyEnter: '↵',
  keyTab: 'Tab',
  keyEscape: 'Esc',
}

/**
 * A widget body the HOST builds and keeps current — the properties form on a
 * row-note and an embedded collection (bases-shaping A6/A7). This package is
 * Svelte-free, so it hands the host an element and the widget's inputs; the
 * host mounts whatever it draws with, pushes new inputs through `update` when
 * the decoration is rebuilt with different ones (CM6's `updateDOM`, so the
 * element — and the focus inside it — survives), and tears down on `destroy`.
 */
export interface Mounted<P> {
  update(props: P): void
  destroy(): void
}

/** One text edit against the document the host computed it from. */
export interface TextChange {
  from: number
  to: number
  insert: string
}

/**
 * What the properties form may do to the editor it sits in. Every edit is a
 * real transaction — the path typing takes — so undo, the peers and the
 * reconciler see it as a keystroke (read-shaping R2.2; bases-shaping A7).
 */
export interface PropertiesEditor {
  /** The document's text right now — what a patch is computed against. */
  text(): string
  /** Apply the patcher's changes as ONE transaction. False when nothing was applied. */
  apply(changes: readonly TextChange[]): boolean
  /** Put the caret on `line` (0-based) of the block — the way back into the YAML (R4.1.1). */
  enter(line: number): void
}

export interface PropertiesProps {
  /** The frontmatter block's own text, `---` to `---`. */
  text: string
  /** Live. Reading has no caret to hand back, so its keys are not doors into the YAML. */
  editable: boolean
}

export interface CollectionEmbedProps {
  /** The collection file's path, resolved by the host. */
  path: string
  /** The view named after `#`, or null for the first. */
  view: string | null
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
  /**
   * Is the open note a row of at least one collection (bases-shaping Fork
   * 3-B)? Synchronous, because decorations are built synchronously; the host
   * computes it off the index on its own clock and asks for a rebuild
   * (`refreshPreview`) when the answer changes. Absent or false: the block
   * collapses to the tag strip, as for every note outside a collection.
   */
  inCollection?(): boolean
  /** The properties form for the collapsed block (A7). Absent: the strip. */
  mountProperties?(dom: HTMLElement, props: PropertiesProps, editor: PropertiesEditor): Mounted<PropertiesProps>
  /** `![[X.base]]` → the collection's vault path, or null when there is none. */
  resolveCollection?(name: string): string | null
  /** An embedded collection view (A6). Absent: a `.base` embed stays as its text. */
  mountCollection?(dom: HTMLElement, props: CollectionEmbedProps): Mounted<CollectionEmbedProps>
}

/**
 * The default host: everything a widget asks for is absent, nothing throws.
 * The labels (and the `FALLBACK_*` groups above) are the only English in
 * this package — a developer fallback for a view mounted before
 * `readHost.of(...)`, never shipped copy.
 */
const NOOP_HOST: ReadHost = {
  readAttachment: async () => null,
  openExternal: () => {},
  searchTag: () => {},
  tags: () => [],
  labels: {
    missingAttachment: 'Not on this device',
    missingCollection: 'No such collection',
    task: 'Task',
    properties: (count) => `${count} properties`,
    frontmatterUnsupported: 'Frontmatter does not parse',
  },
}

export const readHost = Facet.define<ReadHost, ReadHost>({
  combine: (values) => values[values.length - 1] ?? NOOP_HOST,
})
