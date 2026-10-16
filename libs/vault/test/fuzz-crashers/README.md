# fuzz-crashers — permanent regression corpus

When an L0/L1 property test fails, fast-check prints a seed and a shrunk
minimal counterexample. The rule (shaping D9, docs/architecture/testing.md):

1. Reproduce with the printed seed.
2. Translate the shrunk command script into a directed test in this directory,
   named `NNN-short-description.test.ts`, with a comment carrying the original
   seed and date.
3. The directed test stays forever — crashers never get deleted, only fixed.

Nothing in this directory may be skipped or quarantined to make CI green.
