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
 * @editor/frontmatter's `Frontmatter` it needs, so the shell can pass
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
}

/** What a rendered note can ask its host for. Every method is optional to call from a widget; none may throw. */
export interface ReadHost {
  /** Bytes of an attachment named in `![[name]]`, or null when this device does not hold it. */
  readAttachment(name: string): Promise<Blob | null>
  /** Open an http(s) URL outside the editor (Tauri shell / window.open). */
  openExternal(url: string): void
  /** Run a vault search for `tag:#tag` — what a click on a chip does. */
  searchTag(tag: string): void
  /** Every tag the index knows, `#` included — the `#` completion source. */
  tags(): string[]
  /** User-facing strings for the widgets. */
  labels: ReadLabels
  /**
   * Read this note's frontmatter for the collapsed strip — the shell passes
   * @editor/frontmatter's `parseFrontmatter` straight in.
   *
   * Optional, and the one host capability that is: this package cannot depend
   * on @editor/frontmatter (adding the dependency means a lockfile change, and
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
  },
}

export const readHost = Facet.define<ReadHost, ReadHost>({
  combine: (values) => values[values.length - 1] ?? NOOP_HOST,
})
