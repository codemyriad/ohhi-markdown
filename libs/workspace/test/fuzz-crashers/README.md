# fuzz-crashers — permanent regression corpus (workspace)

The sibling of `libs/vault/test/fuzz-crashers/`, for counterexamples found by
the nested-mount property test (`../l1-nested-fuzz.test.ts`) and by the
directed race-table fixtures in `../nested.test.ts`. Same rule
(shaping D9, spike S10 Q5 "Where the fixtures go"):

1. Reproduce with the printed seed (`fc.assert(..., { seed, path })`).
2. Translate the shrunk command script into a directed spec here, named
   `NNNN-short-description.spec.ts`, carrying the original seed and date in a
   comment plus what the failure actually was.
3. The directed spec stays forever — crashers never get deleted, only fixed.

Nothing here may be quarantined to make CI green. The one exception is a
counterexample this slice cannot fix: a **design change** rather than a bug
fix, or a bug that lives in another package. It is checked in `describe.skip`,
with the open question written out in the file and raised in the plan. A
skipped crasher is a tracked debt, not a green light — un-skipping it is the
acceptance test for the decision, and every skip must name the command family
the fuzz turns off because of it.

## The corpus

| # | What it found | State |
|---|---|---|
| 0001 | A cross-boundary move-out resolved on the device whose disk does NOT hold the bytes: the mount's guid stayed live in the parent map over an empty doc | **Fixed** — only the device holding the bytes at the destination performs the move-out; every other device drops its own parent-side stores for the guid and receives the outcome (S10 Q5 row 5) |
| 0002 | A remote rename of a path this device has not materialized threw and aborted the rest of the batch | **Fixed** in `libs/vault/src/session.ts` |
| 0003 | Each peer seeded an adopted mount's folder doc as its OWN history, so the merge was a union and a hard delete on one side had nothing to delete on the other | **Fixed** — the announcement carries the seed (`FileEntry.seed`), so every device applies the same update (S10 Q1) |
| 0004 | Two peers renaming concurrently put one guid at two paths and diverged the disks | **Fixed** in `libs/vault/src/session.ts` |
| 0005 | A resurrected entry never came back on the device that had deleted it | **Fixed** in `libs/vault/src/session.ts` |
| 0006 | A rename interrupted by a crash duplicates the note: the disk move lands before the map transaction, and the folder blob's flush is debounced behind both | **Open**, skipped — `libs/vault`'s rename durability. Keeps tree renames off in the fuzz (`NESTED_FUZZ_RENAMES=1`) |
| 0007 | A carve resurrected a note deleted before it (the orphan-LCA membership term) | **Fixed** — membership is the seeded map; the pre-image keeps tombstones |
| 0008 | After an unshare round trip, edits stopped reaching the peer | **Fixed** — a shut-down session no longer finishes its queued map work (`MountSession.stopped`) |
| 0009 | Two dir renames delivered in one batch leave the file EMPTY on the peer | **Open**, skipped — `libs/vault`'s remote-rename path. Found the moment tree renames were tried again with 0004 fixed; the second reason they stay off |
| 0011 | An edit made ONLINE is lost when the folder is carved before that update reaches the carver: it survives only as a document in the abandoned parent room | **Open**, no spec — a seeded replay in `../l1-nested-fuzz.test.ts` (`CARVE_INFLIGHT`). A design question for the plan, not a patch: spike S10 Q5 row 1 already calls the `<rootRoom>/<guid>` copies left behind "orphans (relay-GC, Later)" — this says one of them can be the newest copy of a note |
| 0010 | A whole-folder delete racing a carve, delivered a frame at a time, leaves the peer with an EMPTY file where the note was | **Open**, no spec — it has resisted shrinking to a hand-written script, so it lives as a seeded replay in `../l1-nested-fuzz.test.ts` (`RESHAPE_BOTH`). Same family as 0002 and 0009: `libs/vault`'s remote-change pass materializing a destination it has no content for |

## What the fuzz turns off, and why

Two exclusions remain, each behind a flag and each naming its open
counterexample:

- **tree renames** (`NESTED_FUZZ_RENAMES=1`) — 0006 and 0009. The rename paths
  this slice owns — the ghost rule's rename branch, S10 Q5 rows 3 and 4 — are
  directed fixtures in `../nested.test.ts`.
- **two devices reshaping trees concurrently** (`NESTED_FUZZ_RESHAPE=1`) —
  0010. Crashers 0004 and 0005, the two it originally stood in for, are fixed;
  lifting it found 0010 at 300 runs, so it went back on, narrower and named.
- **carving while an update is still in flight**
  (`NESTED_FUZZ_CARVE_INFLIGHT=1`) — 0011. Its original reason (0003) is
  fixed; lifting it found a hazard in the product instead.

One exclusion is gone for good, with the crasher it stood in for:
**unshare** (0008).
