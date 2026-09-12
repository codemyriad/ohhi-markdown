/**
 * THE AGENT-SURFACE CONTRACT (plans/agent-surface-shaping.md A1, A9).
 *
 * Every operation the `ohhi` CLI and the `ohhi mcp` server expose is declared
 * here ONCE, as a zod input schema + a zod output schema + a name. The CLI's
 * text renderer, its `--json` mode, the MCP tool list, the JSON Schemas in
 * `spec/` and the conformance test are all derived from this file — which is
 * how "one implementation" (shaping R3) is enforced rather than hoped.
 *
 * Rules, each with a reason:
 *
 *  1. Every output document carries `schema: 'ohhi.<op>.v1'`. A reader
 *     written against v1 keeps working while v1 is served, and a change of
 *     shape is a change of name, not a silent drift (Cassini's
 *     `cassini.meetings.context.v1`).
 *  2. Search returns REFERENCES and snippets, never bodies (R4). Reading is
 *     `read`, which is addressable below the note and budgeted.
 *  3. Every list is limited and cursored (R4) and carries honesty counters
 *     (R7): `returned`, `total`, and — for anything that walks the vault —
 *     `coverage`, so "nothing found" is never mistaken for "nothing exists".
 *  4. Nothing here knows about a process, a terminal or a transport. The
 *     core runs the same under vitest, the CLI and the MCP server.
 *
 * Changing this file is allowed but is a contract change: bump the version
 * for the op, regenerate `spec/`, and update the CLI's text renderer and the
 * skill in the same change.
 */
import { z } from 'zod'

export const SCHEMA_PREFIX = 'ohhi'
export const CONTRACT_VERSION = 1
export const schemaName = (op: string): string =>
  `${SCHEMA_PREFIX}.${op}.v${CONTRACT_VERSION}`

// ---- shared pieces --------------------------------------------------------

export const Span = z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() })
export type Span = z.infer<typeof Span>

/** Paging inputs. Backends cap `limit`; they never silently return more. */
export const PageIn = {
  limit: z.number().int().min(1).max(1000).optional(),
  /** Opaque continuation from a previous page's `nextCursor`. Never parse it. */
  cursor: z.string().optional(),
}

/** Paging outputs — on EVERY list (R4/R7). */
export const PageOut = {
  returned: z.number().int().nonnegative(),
  total: z.number().int().nonnegative().nullable(),
  nextCursor: z.string().nullable(),
}

/**
 * What the answer was computed over. `docs` is how many text notes the index
 * holds; `skippedBinary` how many files were seen and not indexed; `ignored`
 * the directory names the adapter never lists (`.git`, `.obsidian`, …).
 */
export const Coverage = z.object({
  docs: z.number().int().nonnegative(),
  skippedBinary: z.number().int().nonnegative(),
  ignored: z.array(z.string()),
})
export type Coverage = z.infer<typeof Coverage>

const VaultPath = z.string().min(1).describe('Vault-relative POSIX path, e.g. `Areas/CS/JSON.md`')

const Kind = z.enum(['text', 'binary', 'dir'])

/** One frontmatter entry as the flat-subset reader sees it (read side only). */
export const FrontmatterEntry = z.object({
  key: z.string(),
  /** Scalars as written; lists as arrays of scalars. */
  value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))]),
  type: z.enum(['string', 'number', 'boolean', 'null', 'list', 'date']),
  /** 1-based line of the `key:` in the note. */
  line: z.number().int().positive(),
})

export const Frontmatter = z.object({
  present: z.boolean(),
  /** The block's raw text, `---` fences included, when present. */
  raw: z.string().optional(),
  /** Flat-subset parse; absent when `supported` is false. */
  entries: z.array(FrontmatterEntry).optional(),
  /** False when the block has nested maps or anything the flat subset refuses. */
  supported: z.boolean(),
})

export const OutlineEntry = z.object({
  level: z.number().int().min(1).max(6),
  text: z.string(),
  /** 1-based line of the heading. */
  line: z.number().int().positive(),
  /** Characters in the section (heading line through the line before the next heading of ≤ level). */
  chars: z.number().int().nonnegative(),
})

export const Snippet = z.object({
  /** 1-based line the snippet starts on. */
  line: z.number().int().positive(),
  text: z.string(),
  /** Match spans relative to `text`. */
  spans: z.array(Span),
})

// ---- read side ------------------------------------------------------------

export const LsIn = z.object({
  dir: z.string().optional().describe('Vault-relative directory; omit for the root'),
  /** 1 = direct children (default); 0 = the whole subtree. */
  depth: z.number().int().min(0).optional(),
  kind: z.enum(['text', 'binary', 'dir', 'all']).optional(),
  ...PageIn,
})
export const LsOut = z.object({
  schema: z.literal(schemaName('ls')),
  dir: z.string(),
  items: z.array(
    z.object({
      path: VaultPath,
      kind: Kind,
      size: z.number().int().nonnegative().optional(),
      /** ISO-8601, when the adapter knows it. */
      mtime: z.string().optional(),
    })
  ),
  ...PageOut,
  coverage: Coverage,
})

export const ReadIn = z.object({
  path: VaultPath,
  /** Headings only — no body text. Use first on any note you have not seen. */
  outline: z.boolean().optional(),
  /** A heading path like `Decisions` or `Notes/Open questions`, matched case-insensitively. */
  section: z.string().optional(),
  /** 1-based inclusive line range. */
  lines: z.object({ from: z.number().int().positive(), to: z.number().int().positive() }).optional(),
  /** The frontmatter block only. */
  frontmatter: z.boolean().optional(),
  /** Character budget for `text` (default 20 000). Truncation is explicit in the output. */
  maxChars: z.number().int().min(100).optional(),
})
export const ReadOut = z.object({
  schema: z.literal(schemaName('read')),
  path: VaultPath,
  mode: z.enum(['full', 'outline', 'section', 'lines', 'frontmatter']),
  /** Whole-file byte length and content hash (sha-256 hex) — the `expectHash` for a later write. */
  size: z.number().int().nonnegative(),
  hash: z.string(),
  /** Absent in `outline` and `frontmatter` modes. */
  text: z.string().optional(),
  /** 1-based inclusive line range `text` covers, when it is a slice. */
  from: z.number().int().positive().optional(),
  to: z.number().int().positive().optional(),
  truncated: z.boolean(),
  /** First line NOT included, when truncated — pass it back as `lines.from`. */
  nextLine: z.number().int().positive().optional(),
  outline: z.array(OutlineEntry).optional(),
  frontmatter: Frontmatter.optional(),
})

export const SearchIn = z.object({
  query: z.string().min(1),
  /** Restrict to a subtree (directory prefix). */
  path: z.string().optional(),
  /** Restrict to notes carrying this tag (with or without `#`). */
  tag: z.string().optional(),
  /**
   * `ranked` (default): the index's tiered BM25F ranking, folded and
   * case-insensitive. `exact`: literal substring over the raw text, unranked.
   * `regex`: a JavaScript regular expression over the raw text, unranked.
   */
  mode: z.enum(['ranked', 'exact', 'regex']).optional(),
  caseSensitive: z.boolean().optional(),
  /** Per-hit ranking contributions (ranked mode). */
  explain: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
})
export const SearchHit = z.object({
  path: VaultPath,
  /**
   * `title`: the note's basename IS the query. `path`: every query term is in
   * the path. `body`: ranked on content. `grep`: exact/regex mode, unranked.
   */
  tier: z.enum(['title', 'path', 'body', 'grep']),
  score: z.number(),
  /** 1-based line of the first match, for `read --lines`. */
  line: z.number().int().positive().nullable(),
  snippets: z.array(Snippet),
  explain: z.array(z.object({ term: z.string(), field: z.string(), contribution: z.number() })).optional(),
})
export const SearchOut = z.object({
  schema: z.literal(schemaName('search')),
  query: z.string(),
  mode: z.enum(['ranked', 'exact', 'regex']),
  hits: z.array(SearchHit),
  ...PageOut,
  coverage: Coverage,
})

export const LinksIn = z.object({ path: VaultPath, ...PageIn })
export const LinkRef = z.object({
  target: z.string(),
  alias: z.string().nullable(),
  anchor: z.string().nullable(),
  embed: z.boolean(),
  /** Resolved vault path, or null when nothing matches (an unresolved link). */
  resolved: VaultPath.nullable(),
  line: z.number().int().positive(),
  context: z.string(),
})
export const LinksOut = z.object({
  schema: z.literal(schemaName('links')),
  path: VaultPath,
  links: z.array(LinkRef),
  ...PageOut,
})

export const BacklinksIn = z.object({
  /** A vault path or a bare note name, as a wikilink would write it. */
  target: z.string().min(1),
  ...PageIn,
})
export const BacklinksOut = z.object({
  schema: z.literal(schemaName('backlinks')),
  target: z.string(),
  backlinks: z.array(
    z.object({
      path: VaultPath,
      line: z.number().int().positive(),
      context: z.string(),
      alias: z.string().nullable(),
      anchor: z.string().nullable(),
    })
  ),
  ...PageOut,
})

export const UnresolvedIn = z.object({ ...PageIn })
export const UnresolvedOut = z.object({
  schema: z.literal(schemaName('unresolved')),
  links: z.array(
    z.object({
      path: VaultPath,
      target: z.string(),
      line: z.number().int().positive(),
      context: z.string(),
      /** An unresolved EMBED is a missing attachment, not a note to create. */
      embed: z.boolean(),
    })
  ),
  ...PageOut,
})

export const TagsIn = z.object({ ...PageIn })
export const TagsOut = z.object({
  schema: z.literal(schemaName('tags')),
  tags: z.array(z.object({ tag: z.string(), notes: z.number().int().nonnegative() })),
  ...PageOut,
})

export const ResolveIn = z.object({
  target: z.string().min(1),
  /** The note the link is written in, for proximity tie-breaks. */
  from: VaultPath.optional(),
})
export const ResolveOut = z.object({
  schema: z.literal(schemaName('resolve')),
  target: z.string(),
  path: VaultPath.nullable(),
})

export const StatsIn = z.object({})
export const StatsOut = z.object({
  schema: z.literal(schemaName('stats')),
  /** Absolute path of the vault root. */
  vault: z.string(),
  docs: z.number().int().nonnegative(),
  terms: z.number().int().nonnegative(),
  links: z.number().int().nonnegative(),
  unresolved: z.number().int().nonnegative(),
  tags: z.number().int().nonnegative(),
  skippedBinary: z.number().int().nonnegative(),
  ignored: z.array(z.string()),
  /** Milliseconds to build the index in this process. */
  buildMs: z.number().nonnegative(),
  indexSchemaVersion: z.number().int(),
})

export const ChangesIn = z.object({
  /** ISO-8601 instant, or a journal sequence as `j<n>` (from a previous answer). */
  since: z.string().min(1),
  ...PageIn,
})
export const ChangesOut = z.object({
  schema: z.literal(schemaName('changes')),
  since: z.string(),
  changes: z.array(
    z.object({
      path: VaultPath,
      /** `modified`/`created` from disk mtimes; `journaled` from a pre-image record (a write we made). */
      kind: z.enum(['modified', 'created', 'journaled']),
      /** ISO-8601. */
      at: z.string(),
      /** Journal sequence, for `journaled` rows and for the next `since`. */
      seq: z.number().int().nonnegative().optional(),
    })
  ),
  /** Pass back as `since` to continue from here. */
  cursorSince: z.string(),
  ...PageOut,
})

// ---- write side -----------------------------------------------------------

const WriteCommon = {
  /** Refuse unless the note's current content hash (from `read`) is this. Exit 3 on mismatch. */
  expectHash: z.string().optional(),
  /** Compute and report, write nothing. */
  dryRun: z.boolean().optional(),
}

export const WriteIn = z.object({
  path: VaultPath,
  text: z.string(),
  /** Refuse when the note already exists. */
  createOnly: z.boolean().optional(),
  ...WriteCommon,
})
export const WriteOut = z.object({
  schema: z.literal(schemaName('write')),
  path: VaultPath,
  created: z.boolean(),
  bytes: z.number().int().nonnegative(),
  hash: z.string(),
  /** Journal sequence of the pre-image taken before the write; null when the note was new or on a dry run. */
  journalSeq: z.number().int().nonnegative().nullable(),
  dryRun: z.boolean(),
})

export const PatchIn = z.object({
  path: VaultPath,
  /** Must occur exactly once unless `all` — refused otherwise, nothing written. */
  old: z.string().min(1),
  new: z.string(),
  all: z.boolean().optional(),
  ...WriteCommon,
})
export const PatchOut = z.object({
  schema: z.literal(schemaName('patch')),
  path: VaultPath,
  replaced: z.number().int().nonnegative(),
  hash: z.string(),
  journalSeq: z.number().int().nonnegative().nullable(),
  dryRun: z.boolean(),
})

export const AppendIn = z.object({
  path: VaultPath,
  text: z.string(),
  /** Append at the end of this section (heading path) instead of the end of the note. */
  section: z.string().optional(),
  ...WriteCommon,
})
export const AppendOut = z.object({
  schema: z.literal(schemaName('append')),
  path: VaultPath,
  /** 1-based line the appended text starts on. */
  line: z.number().int().positive(),
  hash: z.string(),
  journalSeq: z.number().int().nonnegative().nullable(),
  dryRun: z.boolean(),
})

/** Read side only until `libs/frontmatter` (read-shaping X3) lands `set`/`unset`. */
export const FmIn = z.object({ path: VaultPath })
export const FmOut = z.object({
  schema: z.literal(schemaName('fm')),
  path: VaultPath,
  frontmatter: Frontmatter,
})

export const MvIn = z.object({
  from: VaultPath,
  to: VaultPath,
  /** Required when `from` is a directory holding more than 20 files. */
  yes: z.boolean().optional(),
  dryRun: z.boolean().optional(),
})
export const MvOut = z.object({
  schema: z.literal(schemaName('mv')),
  from: VaultPath,
  to: VaultPath,
  /** Files moved (1 for a note). */
  files: z.number().int().nonnegative(),
  dryRun: z.boolean(),
})

export const RmIn = z.object({
  path: VaultPath,
  yes: z.boolean().optional(),
  dryRun: z.boolean().optional(),
})
export const RmOut = z.object({
  schema: z.literal(schemaName('rm')),
  path: VaultPath,
  /** Where it went: `.trash/<path>` (Obsidian's convention), never deleted outright. */
  trashedTo: z.string(),
  files: z.number().int().nonnegative(),
  dryRun: z.boolean(),
})

export const RestoreIn = z.object({
  path: VaultPath,
  /** List available pre-images instead of restoring. */
  list: z.boolean().optional(),
  /** Which pre-image to restore; default the latest. */
  seq: z.number().int().nonnegative().optional(),
  dryRun: z.boolean().optional(),
})
export const RestoreOut = z.object({
  schema: z.literal(schemaName('restore')),
  path: VaultPath,
  entries: z
    .array(
      z.object({
        seq: z.number().int().nonnegative(),
        at: z.string(),
        size: z.number().int().nonnegative(),
        /** `cli`: this tool's journal. `app`: the desktop app's, when it was given. */
        source: z.enum(['cli', 'app']),
      })
    )
    .optional(),
  restored: z
    .object({ seq: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(), hash: z.string() })
    .optional(),
  dryRun: z.boolean(),
})

// ---- errors -----------------------------------------------------------------

/**
 * `usage` → exit 2 (bad args, no vault, ambiguous vault). `conflict` → exit 3
 * (`expectHash` mismatch). Everything else → exit 1. `refused` is a write the
 * core declined on its own rules (patch not unique, createOnly on an existing
 * note, > 20 files without `yes`, binary or non-`.md` target).
 */
export const ErrorCode = z.enum(['usage', 'not_found', 'conflict', 'refused', 'runtime'])
export type ErrorCode = z.infer<typeof ErrorCode>

export const ErrorOut = z.object({
  schema: z.literal(schemaName('error')),
  code: ErrorCode,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
})

export class OpError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'OpError'
  }
  toJSON(): z.infer<typeof ErrorOut> {
    return { schema: schemaName('error') as z.infer<typeof ErrorOut>['schema'], code: this.code, message: this.message, details: this.details }
  }
}

export function exitCodeFor(code: ErrorCode): number {
  switch (code) {
    case 'usage':
      return 2
    case 'conflict':
      return 3
    default:
      return 1
  }
}

// ---- the registry -----------------------------------------------------------

/** Every op, in the order the CLI usage and the MCP tool list present them. */
export const OP_NAMES = [
  'ls',
  'read',
  'search',
  'links',
  'backlinks',
  'unresolved',
  'tags',
  'resolve',
  'stats',
  'changes',
  'write',
  'patch',
  'append',
  'fm',
  'mv',
  'rm',
  'restore',
] as const
export type OpName = (typeof OP_NAMES)[number]

export const OP_SCHEMAS = {
  ls: { input: LsIn, output: LsOut, mutates: false, description: 'List notes, binaries and folders under a directory.' },
  read: { input: ReadIn, output: ReadOut, mutates: false, description: 'Read a note — whole, its outline, one section, a line range, or its frontmatter — within a character budget.' },
  search: { input: SearchIn, output: SearchOut, mutates: false, description: 'Find notes. Returns references and snippets, never bodies; ranked, exact or regex.' },
  links: { input: LinksIn, output: LinksOut, mutates: false, description: 'Wikilinks written in a note, with their resolution.' },
  backlinks: { input: BacklinksIn, output: BacklinksOut, mutates: false, description: 'Notes that link to a target, with the line around each link.' },
  unresolved: { input: UnresolvedIn, output: UnresolvedOut, mutates: false, description: 'Wikilinks whose target does not exist — the note-creation queue.' },
  tags: { input: TagsIn, output: TagsOut, mutates: false, description: 'Tags in the vault with note counts.' },
  resolve: { input: ResolveIn, output: ResolveOut, mutates: false, description: 'Resolve a wikilink target to a vault path the way the editor does.' },
  stats: { input: StatsIn, output: StatsOut, mutates: false, description: 'What the index covers: notes, links, tags, binaries skipped, folders ignored.' },
  changes: { input: ChangesIn, output: ChangesOut, mutates: false, description: 'Paths changed since an instant or since a journal sequence.' },
  write: { input: WriteIn, output: WriteOut, mutates: true, description: 'Create or replace a note (journaled, atomic).' },
  patch: { input: PatchIn, output: PatchOut, mutates: true, description: 'Replace one exact string in a note (journaled, atomic). Refused when the string is not unique.' },
  append: { input: AppendIn, output: AppendOut, mutates: true, description: 'Append text to a note or to one of its sections (journaled, atomic).' },
  fm: { input: FmIn, output: FmOut, mutates: false, description: 'Read a note’s frontmatter (flat subset). Writing frontmatter is not available yet.' },
  mv: { input: MvIn, output: MvOut, mutates: true, description: 'Move or rename a note or folder.' },
  rm: { input: RmIn, output: RmOut, mutates: true, description: 'Move a note or folder to .trash/ (never deletes outright).' },
  restore: { input: RestoreIn, output: RestoreOut, mutates: true, description: 'List or restore pre-images the journal kept before earlier writes.' },
} as const satisfies Record<OpName, { input: z.ZodType; output: z.ZodType; mutates: boolean; description: string }>

export type OpInput<N extends OpName> = z.infer<(typeof OP_SCHEMAS)[N]['input']>
export type OpOutput<N extends OpName> = z.infer<(typeof OP_SCHEMAS)[N]['output']>
