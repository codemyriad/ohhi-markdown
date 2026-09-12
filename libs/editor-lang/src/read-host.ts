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
}

const NOOP_HOST: ReadHost = {
  readAttachment: async () => null,
  openExternal: () => {},
  searchTag: () => {},
  tags: () => [],
}

export const readHost = Facet.define<ReadHost, ReadHost>({
  combine: (values) => values[values.length - 1] ?? NOOP_HOST,
})
