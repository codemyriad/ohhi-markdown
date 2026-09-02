/**
 * @editor/index — the vault's derived index: full text, links, tags,
 * headings, frontmatter keys. Droppable by construction; never a system of
 * record (parent shaping R7).
 */
export {
  SCHEMA_VERSION,
  type Heading,
  type IndexDoc,
  type IndexStats,
  type IndexWriter,
  type LinkRef,
  type Page,
  type PageOptions,
  type PathHit,
  type SearchHit,
  type Snippet,
  type Span,
  type TagCount,
  type VaultIndex,
  type WritableIndex,
} from './types.js'
export { MemoryIndex, parseQuery } from './memory-index.js'
export { fuzzyScore, toSpans, type FuzzyMatch } from './fuzzy.js'
export { parseMarkdown, type ParsedDoc, type RawHeading, type RawLink, type RawTag } from './parse.js'
export { basename, normalizeTarget, PathResolver } from './resolve.js'
export { fold, queryTerms, tokenize, type Token } from './tokenize.js'
