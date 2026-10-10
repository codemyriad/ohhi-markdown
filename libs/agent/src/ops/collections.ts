import { compileView, isCollectionPath, parseCollection } from '@ohhi/collections'
import { OP_SCHEMAS, schemaName, type OpOutput } from '../contract.js'
import { readNote } from '../backend.js'
import type { OpDef } from '../op.js'
import { paginate } from '../paging.js'
import { isUnder, normalizeDir } from '../paths.js'

type Item = OpOutput<'collections'>['collections'][number]

/**
 * `collections` — every `.base` file, with its views and how many notes
 * each shows right now. The count runs the view's own query, so what this
 * says and what `rows` returns agree by construction.
 */
export const collections: OpDef<'collections'> = {
  ...OP_SCHEMAS.collections,
  async run(backend, input) {
    const dir = normalizeDir(input.dir)
    const [files, index] = await Promise.all([backend.files(), backend.index()])
    const paths = [...files.keys()].filter((p) => isCollectionPath(p) && isUnder(dir, p)).sort()
    const now = backend.clock.now()
    const items: Item[] = []
    for (const path of paths) {
      const note = await readNote(backend, path)
      if (!note) continue
      const spec = parseCollection(note.text)
      const views: Item['views'] = []
      for (const view of spec.views) {
        const compiled = compileView(spec, view, { thisPath: path })
        const page = await index.rows({ ...compiled.query, now }, { limit: 1 })
        const total = page.total ?? page.items.length
        views.push({
          name: view.name,
          type: view.type,
          rows: compiled.limit === null ? total : Math.min(total, compiled.limit),
          supported: compiled.supported,
          reasons: compiled.reasons,
        })
      }
      const slash = path.lastIndexOf('/')
      items.push({
        path,
        name: path.slice(slash + 1).replace(/\.base$/i, ''),
        views,
        issues: spec.issues,
        error: spec.error,
      })
    }
    const page = paginate(items, input)
    return {
      schema: schemaName('collections'),
      collections: page.items,
      returned: page.returned,
      total: page.total,
      nextCursor: page.nextCursor,
      coverage: await backend.coverage(),
    }
  },
}
