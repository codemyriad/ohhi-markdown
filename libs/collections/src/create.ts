/**
 * A new collection's file. One table view over one folder: what "New
 * collection" writes and what the Notion importer writes per database.
 */

export interface NewCollection {
  /** The folder whose notes are the rows (`''` for the whole vault). */
  folder: string
  /** Property keys to show as columns after the name. */
  columns?: string[]
  viewName?: string
}

/** The `.base` text, Obsidian's key order, plain statements. */
export function newCollectionText(opts: NewCollection): string {
  const lines: string[] = []
  if (opts.folder) {
    lines.push('filters:', '  and:', `    - file.inFolder("${opts.folder.replace(/"/g, '\\"')}")`)
  }
  lines.push('views:', '  - type: table', `    name: ${opts.viewName ?? 'All'}`, '    order:', '      - file.name')
  for (const c of opts.columns ?? []) lines.push(`      - ${c}`)
  return lines.join('\n') + '\n'
}

/** `Competitors.base` → `Competitors`; the tab title and the "+ New" note's folder hint. */
export function collectionName(path: string): string {
  const slash = path.lastIndexOf('/')
  return (slash === -1 ? path : path.slice(slash + 1)).replace(/\.base$/i, '')
}

export const COLLECTION_EXTENSION = '.base'

export const isCollectionPath = (path: string): boolean => path.toLowerCase().endsWith(COLLECTION_EXTENSION)
