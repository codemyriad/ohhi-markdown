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
export type { LinkContext } from './link-completion-view.js'
export { mountOf, shareName, type LinkHeading, type LinkMount } from './link-completion.js'
export { cleanImageSrc, IMAGE_FILE, imageSource, type ImageSource } from './preview/image.js'
export { isCalloutHeader, parseCalloutHeader, stripCalloutHeader } from './preview/callout.js'
export { ancestorNamed, PARSE_BUDGET_MS, treeAt } from './tree.js'
export { fenceLanguageCompletions, fenceLanguages } from './preview/fence-edit.js'
export type { FenceLanguage } from './preview/fence.js'
export { PROSE_BRACKETS, proseEditing, WRAP_CHARS, wrapSelection } from './editing.js'
export {
  FALLBACK_CALLOUT_LABELS,
  FALLBACK_CODE_LABELS,
  FALLBACK_LINK_LABELS,
  FALLBACK_REMOTE_IMAGE_LABELS,
  FALLBACK_TABLE_LABELS,
  previewMode,
  readHost,
  type CalloutLabels,
  type CodeLabels,
  type FrontmatterView,
  type LinkPopoverLabels,
  type ReadHost,
  type ReadLabels,
  type RemoteImageLabels,
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
