/**
 * The syntax-tree lookups the editing commands share. A command runs on a
 * keystroke, so it may finish the parse around its position — but only for
 * `PARSE_BUDGET_MS`, never the whole note; past that it answers from the tree
 * CM6 already has.
 */
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode, Tree } from '@lezer/common'

/** How long a command may spend finishing the parse around its position. */
export const PARSE_BUDGET_MS = 50

/** The tree, parsed at least to just past `pos` when the budget allows. */
export function treeAt(state: EditorState, pos: number): Tree {
  return ensureSyntaxTree(state, Math.min(state.doc.length, pos + 1), PARSE_BUDGET_MS) ?? syntaxTree(state)
}

/** The innermost node at `pos`, or an ancestor of it, whose name is in `names`; null when none. */
export function ancestorNamed(
  state: EditorState,
  pos: number,
  names: ReadonlySet<string>,
  side: -1 | 0 | 1 = 1,
  tree: Tree = treeAt(state, pos)
): SyntaxNode | null {
  for (let n: SyntaxNode | null = tree.resolveInner(pos, side); n; n = n.parent) {
    if (names.has(n.name)) return n
  }
  return null
}
