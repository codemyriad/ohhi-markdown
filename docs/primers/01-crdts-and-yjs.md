---
status: current
date: 2026-06-12
---

# Primer 01 — CRDTs and Yjs

> Part of the [primer series](../README.md). Next: [Plain-text CRDT over markdown](02-plain-text-crdt-over-markdown.md). Terms: [glossary](../glossary.md).

## The merge problem

Two devices edit the same note while disconnected:

```
        "The cat sat."
        /            \
   Laptop          Phone
"The BLACK cat   "The cat sat
     sat."          QUIETLY."
        \            /
         reconnect — now what?
```

A naive syncer (Syncthing, iCloud) has three bad options: pick a winner (lose an edit), write a conflict file (`note.sync-conflict-2026...md` — the exact pain that killed Syncthing for us), or ask the user every time. What we want is the obvious answer — `"The BLACK cat sat QUIETLY."` — computed automatically, with **both devices arriving at the identical result without talking to a referee**.

A **CRDT** (Conflict-free Replicated Data Type) is a data structure designed so that this is always possible. The formal guarantee is *strong eventual consistency*: any two replicas that have seen the same set of operations are in the same state — regardless of the order the operations arrived in. Merging is commutative, associative, and idempotent, so there is no "merge conflict" at the data-structure level, ever. (Whether the merged result matches human *intent* is a different question — see [primer 03](03-lca-reconciliation.md) and the moment.dev discussion in [primer 05](05-sync-and-relay.md).)

## Two intuitions: state-based vs operation-based

- **State-based**: every replica's full state is a value in a lattice, and `merge(a, b)` takes the least upper bound. Toy example: a "grow-only set" merges by set union — union is commutative/associative/idempotent, so replicas can exchange whole states in any order and converge. Simple, but shipping whole states is expensive.
- **Operation-based**: replicas exchange *operations* ("insert 'X' after the character with ID `laptop#41`"). Operations are crafted so that applying the same set in any order yields the same state. This needs every op to be delivered (at least once) to every replica, but ops are tiny.

Text CRDTs are operation-based with a twist: every character gets a **permanent unique ID** (roughly `clientID#counter`), and inserts say "after character *ID*", not "at index 7". Indexes shift under concurrent editing; IDs never do. Deletes mark a character's ID as dead (a *tombstone*) instead of reusing its position. That's the whole trick that makes "insert at the same place concurrently" well-defined.

In practice mature libraries blur the line: Yjs is operation-based but can encode "everything you're missing" as one binary blob, which behaves like a state exchange.

## Yjs, concretely

[Yjs](https://github.com/yjs/yjs) is the engine we pinned (v13.6.x, behind the [engine seam](04-engine-seam.md) — see the `crdt-engine` research note and the Decision log in `shaping` for why: ~5M downloads/week, pure JS ~18 KB, the richest provider ecosystem, and relay.md proving our exact use case in production).

### Y.Doc and Y.Text

A `Y.Doc` is one collaborative document — the unit of sync. Inside it live shared types; we use exactly one: `Y.Text` under the key `"contents"`, holding the markdown of one file. (Why plain text and not a rich-text tree: [primer 02](02-plain-text-crdt-over-markdown.md).)

```ts
import * as Y from 'yjs'

const docA = new Y.Doc()
const docB = new Y.Doc()

docA.getText('contents').insert(0, 'The cat sat.')

// Sync A's state to B as one binary update:
Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA))

// Now edit concurrently:
docA.getText('contents').insert(4, 'BLACK ')     // "The BLACK cat sat."
docB.getText('contents').insert(11, ' QUIETLY')  // "The cat sat QUIETLY."

// Exchange both ways — order doesn't matter:
Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA))
Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB))

docA.getText('contents').toString() // "The BLACK cat sat QUIETLY."
docB.getText('contents').toString() // identical — guaranteed
```

### Updates

An **update** is a binary blob of operations. `Y.applyUpdate` is idempotent and order-tolerant (ops with unmet dependencies are held until their dependencies arrive). Updates can be merged offline without a live doc (`Y.mergeUpdates`) — that's what a relay does with them.

### State vectors: "what have you seen?"

Sending the full state every time would be wasteful. A **state vector** is a tiny summary: a map of `clientID → highest operation counter seen`. Think of it as a version cursor per device:

```ts
const whatBHas = Y.encodeStateVector(docB)
const onlyTheMissingOps = Y.encodeStateAsUpdate(docA, whatBHas)
Y.applyUpdate(docB, onlyTheMissingOps)
```

This two-step exchange ("here's my state vector" → "here's your diff") is the heart of the sync protocol every provider speaks, and it's why offline reconnection needs no special machinery: reconnect, exchange state vectors, apply diffs, converged ([primer 05](05-sync-and-relay.md)).

### Delete sets — and the bug class `heads = SV + DS` prevents

Deletes don't create new operations with new IDs; they flip existing characters into tombstones. The record of *which* IDs are dead is kept separately, in the **delete set**. This has a sharp consequence:

```ts
const a = new Y.Doc()
a.getText('contents').insert(0, 'hello')
const before = Y.encodeStateVector(a)

a.getText('contents').delete(0, 5)        // a delete-only change
const after = Y.encodeStateVector(a)
// before and after are IDENTICAL — deletes don't advance the state vector
```

So **a state vector alone cannot tell you whether two docs are in the same state**. Two replicas with equal SVs can differ by any number of deletions. Yjs's own sync protocol survives this (update diffs always carry the full delete set), but *our bookkeeping* would not: if the [LCA record](03-lca-reconciliation.md), the [sync pill](05-sync-and-relay.md), or the test harness's convergence assertion compared SVs only, a delete-only update would be classified as "nothing changed" — stale green pills, LCA records that lie, fuzz tests that pass while replicas disagree.

That's why shape D1 in `shaping` defines **heads = state vector + delete-set digest** — equivalent to a Yjs `Y.Snapshot`, which is literally the pair `{sv, ds}`. Anywhere this repo says "heads" or "snapshot", read: *both* halves, never the SV alone. The harness asserts convergence on **encoded state**, not rendered text, for the same reason (cosmetically equal output can hide internal divergence). This fix came out of the distsys attack on the shapes — see the Decision log, "CRDT engine" row.

### Transactions and origins

Every mutation happens inside a transaction; bundling related edits makes them atomic for observers and remote peers. Each transaction carries an **origin** — an arbitrary tag identifying *who is writing and why*:

```ts
doc.transact(() => {
  ytext.delete(4, 6)
  ytext.insert(4, 'replacement')
}, 'disk')  // reconciler ingesting an external file edit

doc.on('update', (update, origin) => {
  if (origin === 'disk') return  // our own ingestion — don't echo it back to disk
  scheduleMaterialization()      // a real remote/editor edit — disk may need updating
})
```

Origins are how the [reconciler](03-lca-reconciliation.md) avoids feedback loops (disk → CRDT → disk → ...), and how the editor binding ignores its own keystrokes coming back around. They're load-bearing here, not a nicety.

### Awareness: presence is not history

Cursors, selections, "Maria is in this note" — none of that belongs in the document. Yjs's **awareness** protocol is a separate, ephemeral channel: each peer broadcasts a small state object that vanishes when they disconnect. Nothing is persisted, nothing enters the update log. Remote cursors in CM6 ride awareness; later, agents appear as named awareness peers too.

## What Yjs deliberately doesn't give us

No full edit history by default (tombstones are garbage-collected; snapshots require `gc: false`), no native time-travel or attribution — v14's AttributionManagers will narrow this, which is one reason the v14 migration is planned (gated behind the seam + full harness pass). Until then, history needs come from our own update log on the relay (D4a). And convergence ≠ intent: Yjs guarantees everyone sees the *same* merged text, not that the merge is what the humans *meant* — that gap is exactly what [LCA reconciliation](03-lca-reconciliation.md) and divergence review exist to manage.

## Further reading

- the `crdt-engine` research note — Yjs vs Automerge vs Loro, verified June 2026
- `shaping` D1 + Decision log — the pin, the seam, the SV+DS fix
- Next primer: [why CRDT over the literal markdown bytes](02-plain-text-crdt-over-markdown.md)
