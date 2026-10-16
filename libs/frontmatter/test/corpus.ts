/**
 * The corpus every frontmatter test runs on, and the assertion they share.
 *
 * The corpus is the REAL vault's blocks (read-shaping §Evidence — 17
 * blocks over 1,038 notes, measured 2026-09-12), plus the shapes Obsidian
 * 1.4+ writes when its Properties UI rewrites a block. The vault is the
 * evidence that the flat subset covers 17/17 files (Fork 4); the Obsidian
 * shapes are the other writer the patcher has to live beside.
 */

import { expect } from 'vitest'

/** Distinct block shapes in the vault, with how many files carry each. */
export const VAULT_BLOCKS: { name: string; block: string; files: number }[] = [
  {
    name: 'story with dates',
    files: 2,
    block: 'milestone: builder round 2 testing\ntype: story\nstatus: On deck\ndue-date: 2023-09-01\n',
  },
  // `due-date: ` carries a trailing space in three of these files. It is a
  // byte nobody meant to type and nobody may silently remove.
  {
    name: 'empty milestone, trailing space',
    files: 3,
    block: 'milestone:\ntype: story\nstatus: Todo\ndue-date: \n',
  },
  { name: 'no due-date key', files: 1, block: 'milestone:\ntype: story\nstatus: Todo\n' },
  {
    name: 'epic, empty dates',
    files: 1,
    block: 'milestone:\ntype: epic\nstatus: In progress\ndue-date:\n',
  },
  // Obsidian pre-1.4 space-separated flow list: YAML reads ONE string, the
  // vault means two tags.
  { name: 'legacy flow tags', files: 6, block: 'tags: [composition testing]\n' },
  { name: 'single flow tag', files: 3, block: 'tags: [testing]\n' },
  {
    name: 'legacy block tags',
    files: 1,
    block: 'tags:\n  - functional-programming composition\ndue-date:\n',
  },
]

/** What Obsidian 1.4+ writes, and the shapes the vault does not have yet. */
export const OBSIDIAN_BLOCKS: { name: string; block: string }[] = [
  { name: 'block list', block: 'tags:\n  - composition\n  - testing\n' },
  {
    name: 'aliases and cssclasses',
    block: 'aliases:\n  - Alt Name\ntags:\n  - project\ncssclasses: []\n',
  },
  { name: 'comments and blank lines', block: '# why this note exists\n\ntags: [testing]\n\nstatus: Todo\n' },
  { name: 'quoting', block: 'title: "Hello: world"\ncolour: \'#ccc\'\nn: 1.50\n' },
  { name: 'trailing comment', block: 'status: Todo # keep\nmilestone:  # tbd\n' },
  { name: 'empty block', block: '' },
]

/** Blocks outside the flat subset — every one of these is refused, never fixed. */
export const UNSUPPORTED_BLOCKS: { name: string; block: string; reason: string }[] = [
  { name: 'nested map', block: 'meta:\n  owner: chris\n', reason: 'nested' },
  { name: 'nested in a flow list', block: 'k: [a, {x: 1}]\n', reason: 'nested' },
  { name: 'block scalar', block: 'note: |\n  line one\n  line two\n', reason: 'multiline' },
  { name: 'multi-line plain', block: 'note: one\n  two\n', reason: 'multiline' },
  { name: 'anchor and alias', block: 'a: &x 1\nb: *x\n', reason: 'anchor' },
  { name: 'duplicate key', block: 'status: Todo\nstatus: Done\n', reason: 'duplicate-key' },
  { name: 'unclosed quote', block: 'title: "unclosed\n', reason: 'invalid' },
  { name: 'not a mapping', block: 'just prose, not YAML\n', reason: 'invalid' },
]

export const BODIES: string[] = [
  '',
  '\n#edible/roadmap #edible/story\n\n- [ ] a task\n',
  '# Heading\n\nBody text with [[a link]].\n',
  'no trailing newline',
]

export const docOf = (block: string, body = ''): string => `---\n${block}---\n${body}`

/** Apply changes exactly as a caller (or a Y.Text) would: ascending, disjoint. */
export function applyChanges(
  text: string,
  changes: { from: number; to: number; insert: string }[]
): string {
  let out = text
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, change.from) + change.insert + out.slice(change.to)
  }
  return out
}

const lineOfOffset = (text: string, offset: number): number =>
  text.slice(0, offset).split('\n').length - 1

/**
 * Every line the change did not touch is byte-identical, in the same order —
 * and moved only by the change's own line delta. This is golden rule 2 as an
 * assertion, and it is the one both the byte-contract tests and the S3
 * fixture make.
 */
export function expectUntouchedLines(
  before: string,
  after: string,
  change: { from: number; to: number }
): void {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const first = lineOfOffset(before, change.from)
  const last = lineOfOffset(before, Math.max(change.to - 1, change.from))
  const tail = beforeLines.length - (last + 1)
  expect(afterLines.slice(0, first)).toEqual(beforeLines.slice(0, first))
  if (tail > 0) expect(afterLines.slice(-tail)).toEqual(beforeLines.slice(-tail))
}
