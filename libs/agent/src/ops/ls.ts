import { OP_SCHEMAS, OpError, schemaName } from '../contract.js'
import type { OpDef } from '../op.js'
import { isUnder, normalizeDir } from '../paths.js'
import { paginate } from '../paging.js'

/** Relative depth of `path` below `dir` — a direct child is 1. */
const depthUnder = (dir: string, path: string): number =>
  (dir ? path.slice(dir.length + 1) : path).split('/').length

/**
 * `ls` — the vault's shape, not its contents.
 *
 * Default depth 1 (direct children), because a depth-0 listing of a 1,037-note
 * vault is 1,037 lines of context spent on a question nobody asked. Folders
 * sort first so "what is in here" reads as a tree, not an alphabet.
 */
export const ls: OpDef<'ls'> = {
  ...OP_SCHEMAS.ls,
  async run(backend, input) {
    const dir = normalizeDir(input.dir)
    const depth = input.depth ?? 1
    const kind = input.kind ?? 'all'
    const [files, dirs, coverage] = await Promise.all([
      backend.files(),
      backend.dirs(),
      backend.coverage(),
    ])
    if (dir !== '' && !dirs.includes(dir)) {
      throw new OpError('not_found', `no such directory: ${dir}`, { dir })
    }

    const wanted = (itemKind: 'text' | 'binary' | 'dir'): boolean => kind === 'all' || kind === itemKind
    const inScope = (path: string): boolean =>
      path !== dir && isUnder(dir, path) && (depth === 0 || depthUnder(dir, path) <= depth)

    const items = [
      ...(wanted('dir')
        ? dirs.filter(inScope).map((path) => ({ path, kind: 'dir' as const }))
        : []),
      ...[...files.values()]
        .filter((file) => wanted(file.kind) && inScope(file.path))
        .map((file) => ({
          path: file.path,
          kind: file.kind,
          size: file.size,
          ...(file.mtime === null ? {} : { mtime: new Date(file.mtime).toISOString() }),
        })),
    ].sort((a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || a.path.localeCompare(b.path))

    const page = paginate(items, input)
    return { schema: schemaName('ls'), dir, items: page.items, returned: page.returned, total: page.total, nextCursor: page.nextCursor, coverage }
  },
}
