---
status: current
date: 2026-06-12
---

# Primer 02 — Why the CRDT runs over the literal markdown bytes

> Part of the [primer series](../README.md). Previous: [CRDTs and Yjs](01-crdts-and-yjs.md). Next: [LCA reconciliation](03-lca-reconciliation.md). Terms: [glossary](../glossary.md).

## The decision in one sentence

The collaborative artifact is a `Y.Text` containing **exactly the characters of the `.md` file** — not a rich-text tree, not a block model. The CRDT merges *the file itself*.

This sounds almost too obvious to state. It isn't: nearly every collaborative editor on the market chose differently, and the choice is the deepest fork in the road for a tool whose hard requirement (R1/R1.1 in [shaping](../../plans/shaping.md)) is that plain files on disk stay canonical and byte-stable under git, Claude Code, and Obsidian.

## The three candidate document models

**1. Plain text (ours).** The document is a string of characters. Markdown structure (headings, bold, wikilinks) exists only in the *reader's parse* of those characters. CRDT ops are character inserts/deletes.

**2. Rich-text CRDT tree.** The document is a tree of nodes (paragraph, heading, list-item) with formatting marks — ProseMirror/Tiptap bound via y-prosemirror to a `Y.XmlFragment`, or Peritext-style marks in Automerge/Loro. Markdown is a *serialization* you export.

**3. Block model.** The document is a database of typed blocks (Notion, AFFiNE): each paragraph/heading/toggle is a record with an ID, type, properties, and children. Markdown, again, is an export format.

## Why models 2 and 3 lose here: round-trip fidelity

With a tree or block model, every open→edit→save cycle is `parse(markdown) → tree → edit → serialize(tree) → markdown`. The serializer must pick *one* spelling for every construct: `*` vs `-` bullets, `_` vs `*` emphasis, escape policies, wrapping, blank-line placement, how unknown syntax is preserved (often: it isn't — Tiptap's markdown support documents dropped comments and constrained table cells). Open a file, fix a typo, save — and the diff touches fifty lines you never edited.

In a vault co-edited by git, Claude Code, and Obsidian, serializer normalization isn't a cosmetic bug, it's structural damage:

- **Spurious git diffs** bury real changes and make PR review of notes useless.
- **Reformatting ping-pong**: Editor normalizes one way, Obsidian another — every alternating save is a churn commit.
- **The reconciler's life depends on byte equality.** [Primer 03](03-lca-reconciliation.md) shows that "did the disk change?" is answered by content hash against a stored base. If our own writes reformat untouched bytes, every save looks like an external edit and the classification machinery drowns in noise.

### Watch it happen

Take a harmless note through a tree-model editor that uses a typical markdown serializer:

```markdown
* milk
* eggs

Remember the [[shopping/stores|usual place]] — and _check the dates_.
```

Open, fix one typo in another paragraph, save. A typical serializer emits:

```markdown
- milk
- eggs

Remember the \[\[shopping/stores|usual place\]\] — and *check the dates*.
```

Three changes you didn't make: bullet markers normalized (`*` → `-`), emphasis style normalized (`_` → `*`), and the wikilink — which isn't standard markdown, so the parser never understood it — escaped into garbage. `git diff` now shows every line of the file changed; Obsidian no longer recognizes the link; the next save from Obsidian flips some of it back. Multiply by every file ever opened.

With plain text, fidelity is not a feature we test for — it's **structurally guaranteed**, because there is no serializer. The string in the editor *is* the file. This is why CodeMirror 6 was the only viable editor component (see [editor-component research](../../plans/research/editor-component.md)): CM6's document model is a plain-text string, and "live preview" — the Obsidian look — is a view-only *decoration layer* over unchanged text. Obsidian itself is CM6 with decorations; so is SilverBullet. We're using the proven pattern, not inventing one.

### The same choice decides how external edits merge

[Primer 03](03-lca-reconciliation.md) describes how a git pull or Claude Code edit gets *ingested* into the CRDT. The document model determines how hard that is:

- **Plain text:** disk holds a string, the CRDT holds a string — same domain. Compute a character diff, apply it as ops. Done; an external edit is indistinguishable from a fast typist.
- **Tree model:** disk holds markdown, the CRDT holds a tree. Every external edit means re-parse → *tree diff* against the CRDT tree — and tree diffing needs node identity matching, which is heuristic. A one-word edit inside a paragraph can look like "paragraph deleted, similar paragraph inserted", which destroys that node's operational history and concurrent edits to it.

For a vault where external writers are constant (git, agents, Obsidian), the second model puts a research problem on the hot path. The first puts `diff` there.

The only byte-level wrinkles plain text doesn't cover for free are line endings and byte-order marks — handled explicitly: per-file EOL/BOM flags recorded at enrollment, normalized to LF inside the CRDT, restored on every write (D2 in shaping; details in [primer 03](03-lca-reconciliation.md)).

## The moment.dev critique (part 2): rich-text bindings are the weak joint

The ["Lies I was told" series](../../plans/research/moment-dev-lies.md) (moment.dev, Dec 2024 / Mar 2026) is part of this project's origin story, and part 2 — "Why we don't use Yjs" — reads at first like an argument against our entire stack. Read closely, almost every criticism targets the **y-prosemirror rich-text binding**, not text CRDTs:

- The binding can destroy and recreate the document representation on each keystroke, breaking position mapping, comments, presence, and undo.
- Schema validation failures **silently delete nodes — and propagate the deletion to every peer**. (Marijn Haverbeke, ProseMirror's author, sided with the article on this.)
- Round-tripping editor transactions through an XML tree and back fights the editor's own model.
- And the underlying honest point: representing *rich text* in a CRDT — where "bold this range" must merge sensibly with concurrent splits and joins — is an acknowledged open research problem.

None of this applies to a `Y.Text` holding markdown characters bound to CM6, where editor model and CRDT model are the *same thing*: a string. Sequence CRDTs over plain text are the mature, boring, well-trodden part of the field. The article is, if anything, a strong argument for our model: it documents what happens when the CRDT lives over a tree the editor doesn't really own. (Part 1's lesson — merged ≠ acceptable, divergence needs review UX — we take fully on board; see [primer 03](03-lca-reconciliation.md) and the R3 requirement.)

## What we give up, eyes open

Plain-text CRDT means **merges are character-level, with no knowledge of markdown semantics**:

- Two people concurrently bolding the same word can produce `****word****` or interleaved markers — syntactically odd, but visible, plain, and trivially fixable text. Never silent node loss.
- A concurrent edit inside a table row or YAML frontmatter can converge to text that no longer *parses* as a table or as valid YAML. The structure breaks visibly rather than the content disappearing invisibly — we consider that the right failure direction, but it is a real cost. (Frontmatter gets extra care: surgical byte-preserving patches only, and Spike S3 investigates whether concurrent YAML edits need an atomic-region rule.)
- No semantic formatting operations: "make this a heading" is the insertion of `## `, and merges treat it as such.
- No block identity: we can't say "Maria moved block X" — a moved paragraph merges as delete-here + insert-there. (Stable GUIDs exist per *file*, not per block; block IDs were explicitly deferred — see the Views row of the Decision log.)

The harness keeps us honest about the remaining risk: L1 fuzz invariants include *valid frontmatter* and *checkbox count/order* after merges, and the merge-acceptability corpus (V4) reviews real divergences offline.

## Why not "best of both" — block model with markdown export?

AFFiNE and Notion get genuinely nice things from blocks: drag-to-reorder, per-block comments, databases. But a block store makes the on-disk markdown a **projection of a database** — the moment two tools disagree about the projection, the file is no longer the source of truth, and R1 is dead. Our equivalent affordances come the other way around: widgets *over* plain text (a checkbox widget that edits `[ ]` → `[x]` as a text op git can see), and later "views over notes" as plain `.canvas`/YAML vault files (D8). The text stays the truth; everything richer is a lens.

## Summary

| | Plain text + CM6 (ours) | Rich-text tree (PM/Tiptap) | Block model (Notion/AFFiNE) |
|---|---|---|---|
| Disk round-trip | byte-identical *by construction* | serializer-normalized | file is an export |
| moment.dev pt 2 critique | doesn't apply | direct hit | n/a (DB-canonical) |
| Merge granularity | characters | nodes/marks (open problem) | blocks (LWW-ish) |
| git/Claude/Obsidian co-editing | native | churn diffs | excluded |
| Formatting-aware merges | no — accepted cost | partially | per-block |

## Further reading

- [editor-component research](../../plans/research/editor-component.md) — the CM6 decision in full
- [moment-dev-lies research](../../plans/research/moment-dev-lies.md) — what the articles actually claim
- [shaping](../../plans/shaping.md) Decision log, "Editor" row
- Next primer: [LCA reconciliation](03-lca-reconciliation.md) — how disk and CRDT stay honest with each other
