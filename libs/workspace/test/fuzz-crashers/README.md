# fuzz-crashers — permanent regression corpus (workspace)

The sibling of `libs/vault/test/fuzz-crashers/`, for counterexamples found by
the nested-mount property test (`../l1-nested-fuzz.test.ts`) and by the
directed race-table fixtures in `../nested.test.ts`. Same rule
(plans/shaping.md D9, spike S10 Q5 "Where the fixtures go"):

1. Reproduce with the printed seed (`fc.assert(..., { seed, path })`).
2. Translate the shrunk command script into a directed spec here, named
   `NNNN-short-description.spec.ts`, carrying the original seed and date in a
   comment plus what the failure actually was.
3. The directed spec stays forever — crashers never get deleted, only fixed.

Nothing here may be quarantined to make CI green. The one exception is a
counterexample whose fix is a **design change** rather than a bug fix: it is
checked in `describe.skip`, with the open question written out in the file and
raised in the plan. A skipped crasher is a tracked debt, not a green light —
un-skipping it is the acceptance test for the design decision.
