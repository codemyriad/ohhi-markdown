/**
 * @ohhi/editor-lang — markdown language extras for the CM6 surface.
 * V2c ships wikilinks; the Read slice adds the rest of the grammar (tags,
 * highlights, frontmatter) and the live-preview reveal engine.
 *
 * What leaves this package is what libs/editor installs and what the shell
 * configures. The engine's internals — the builder, the widgets, the active
 * region — are imported by path from the test suite and by nothing else.
 */
export { Frontmatter } from './frontmatter-block.js'
export { Highlight, highlightTag } from './highlight.js'
export { Tag, tagTag } from './tag.js'
export { splitWikiLink, WikiLink, wikiLinkMarkTag, wikiLinkTag, type WikiLinkParts } from './wikilink.js'
export { wikiLinkExtensions, wikiLinkHost, type WikiLinkHost } from './wikilink-view.js'
export {
  FALLBACK_LINK_LABELS,
  type LinkContext,
  type LinkPopoverLabels,
} from './link-completion-view.js'
export type { LinkHeading, LinkMount } from './link-completion.js'
export {
  FALLBACK_REMOTE_IMAGE_LABELS,
  type RemoteImageLabels,
} from './read-host.js'
export { imageSource, type ImageSource } from './preview/image.js'
export { fenceLanguageCompletions, fenceLanguages } from './preview/fence-edit.js'
export type { FenceLanguage } from './preview/fence.js'
export { PROSE_BRACKETS, proseEditing, WRAP_CHARS, wrapSelection } from './editing.js'
export {
  previewMode,
  readHost,
  type FrontmatterView,
  type ReadHost,
  type ReadLabels,
  type TableLabels,
  type ViewMode,
} from './read-host.js'
export {
  activeLines,
  indentListItem,
  insertIndent,
  listLinesIn,
  listMarkerBefore,
  outdentListItem,
  livePreview,
  selectListMarker,
  tagCompletions,
  toggleTask,
  inTable,
  runTableCommand,
  TABLE_COMMANDS,
  type TableCommand,
  type TableCommandId,
} from './preview/index.js'
