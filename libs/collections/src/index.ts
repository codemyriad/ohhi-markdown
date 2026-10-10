/**
 * @ohhi/collections — a collection is a set of notes with properties, seen
 * through saved views (plans/bases-shaping.md, shape A). On disk it is a
 * `.base` file in Obsidian's format, read as a documented subset; the rows
 * are notes the index already holds; nothing here is a store.
 *
 * Pure and Node-safe: it serves the app's collection tab, the CLI's
 * `collections` / `rows` and the importer alike.
 */
export { compileStatement, UnsupportedFilter, type FilterScope } from './filter.js'
export { parseCollection } from './parse.js'
export { compileView, folderOf, keyFor, labelFor, NOTES_ONLY } from './query.js'
export { addView, patchView, removeView, type NewView, type PatchReason, type PatchResult, type ViewPatch } from './patch.js'
export { COLLECTION_EXTENSION, collectionName, isCollectionPath, newCollectionText, type NewCollection } from './create.js'
export {
  VIEW_TYPES,
  type CollectionSpec,
  type Column,
  type FilterTree,
  type PropertyConfig,
  type SortDirection,
  type ViewQuery,
  type ViewSort,
  type ViewSpec,
  type ViewType,
} from './types.js'
