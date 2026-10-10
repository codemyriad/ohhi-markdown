/**
 * @ohhi/index — the vault's derived index: full text, links, tags,
 * headings, frontmatter keys. Droppable by construction; never a system of
 * record (parent shaping R7).
 */
export {
  SCHEMA_VERSION,
  type ExplainRow,
  type GrepHit,
  type Heading,
  type IndexDoc,
  type IndexStats,
  type IndexWriter,
  type LinkRef,
  type Page,
  type PageOptions,
  type PathHit,
  type PropScalar,
  type PropValue,
  type Row,
  type RowExpr,
  type RowFilter,
  type RowKey,
  type RowLiteral,
  type RowQuery,
  type RowSort,
  type SearchHit,
  type SearchTier,
  type Snippet,
  type Span,
  type TagCount,
  type ValueCount,
  type VaultIndex,
  type WritableIndex,
} from './types.js'
export { MemoryIndex, parseQuery } from './memory-index.js'
export { fuzzyScore, toSpans, type FuzzyMatch } from './fuzzy.js'
export { lineAt, lineStartsOf } from './lines.js'
export { paginate } from './paginate.js'
export { parseMarkdown, type ParsedDoc, type RawHeading, type RawLink, type RawProperty, type RawTag } from './parse.js'
export { basename, normalizeTarget, PathResolver } from './resolve.js'
export {
  compareRows,
  matchesFilter,
  propText,
  scalarText,
  typeProperty,
  typeScalar,
  type FilterContext,
} from './properties.js'
export { fold, queryTerms, tokenize, type Token } from './tokenize.js'
export { isTagBody, scanTag, scanTags, tagBoundary, tagKey } from './tag-syntax.js'
