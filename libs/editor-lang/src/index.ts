/**
 * @editor/editor-lang — markdown language extras for the CM6 surface.
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
  previewMode,
  readHost,
  type FrontmatterView,
  type ReadHost,
  type ReadLabels,
  type ViewMode,
} from './read-host.js'
export { activeLines, livePreview, tagCompletions, toggleTask } from './preview/index.js'
