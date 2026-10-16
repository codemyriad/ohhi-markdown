/**
 * A SYNTHETIC VAULT SHAPED LIKE THE MEASURED ONE.
 *
 * agent-surface-shaping measured `~/Documents/black book` (1,037
 * live notes, 3.0 MB) for search and found four things that break a single
 * BM25 number. This generator reproduces all four at 1/50th the size, so the
 * ranking has a regression test that runs in CI without a real vault:
 *
 *   1. Single-generic-noun titles (`JSON`, `Docs`, `HTML`, `Svelte`,
 *      `Testing`, `Writing`, `Networking`) whose own word is the corpus's
 *      most frequent body term. Measured: median title 2 words / 14 chars.
 *   2. Tiny notes competing with huge ones. Measured: median 1,016 B, max
 *      83.5 KB — a 23× p99/median spread. `Areas/CS/JSON.md` is 154 B in the
 *      real vault and loses to a 30 KB note with 58 "json" mentions.
 *   3. Link dumps. Measured: 71 notes carry ≥20 URLs. `Areas/Life/Music.md`
 *      is 64 KB and says "html" 39 times, every one inside a URL.
 *   4. A note whose only mention of a term is inside a fenced code block.
 *
 * Every document here is deterministic — no randomness, no clock (golden
 * rule 5) — so a failure is reproducible and a diff is readable.
 */
import type { IndexDoc } from '../../src/types.js'

/** The seven probes from the shaping doc's evidence table, re-shaped. */
export const CORPUS_PROBES: { query: string; expect: string }[] = [
  { query: 'JSON', expect: 'Areas/CS/JSON.md' },
  { query: 'Docs', expect: 'Edible/Docs.md' },
  { query: 'HTML', expect: 'Areas/CS/HTML.md' },
  { query: 'Svelte', expect: 'Areas/CS/Svelte.md' },
  { query: 'Testing', expect: 'Areas/CS/Testing.md' },
  { query: 'Writing', expect: 'TODO/Writing.md' },
  { query: 'networking', expect: 'Areas/CS/Networking.md' },
]

/**
 * Filler that contains no probe term and no PREFIX of one — ranking matches
 * prefixes as you type, so "documentation" in the filler would quietly make
 * the `Docs` probe pass for the wrong reason.
 */
const FILLER = [
  'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
  'india', 'kilo', 'lima', 'mike', 'oscar', 'papa', 'quebec', 'romeo',
  'sierra', 'tango', 'uniform', 'victor',
]

/** A deterministic line of filler — `seed` picks the words, nothing random. */
function filler(seed: number, words = 12): string {
  const out: string[] = []
  for (let i = 0; i < words; i++) out.push(FILLER[(seed * 7 + i * 3) % FILLER.length])
  return out.join(' ')
}

/** Grow `text` with filler lines until it is at least `bytes` long. */
function pad(text: string, bytes: number): string {
  const lines = [text]
  let size = text.length
  for (let i = 0; size < bytes; i++) {
    const line = `- ${filler(i)}`
    lines.push(line)
    size += line.length + 1
  }
  return lines.join('\n')
}

/**
 * `n` markdown links whose URL — and NOTHING else on the line — contains
 * `term`. This is the exact shape that made a 64 KB music list outrank the
 * note called `HTML.md`.
 */
function urlDump(term: string, n: number): string {
  const lines: string[] = []
  for (let i = 0; i < n; i++) {
    lines.push(`- [${filler(i, 3)}](https://example.invalid/${term}/${term}-${i}.${term})`)
  }
  return lines.join('\n')
}

/** `n` occurrences of `term` in ordinary prose, one sentence per line. */
function mentions(term: string, n: number): string {
  const lines: string[] = []
  for (let i = 0; i < n; i++) lines.push(`${filler(i, 6)} ${term} ${filler(i + 1, 6)}.`)
  return lines.join('\n')
}

export function rankingCorpus(): IndexDoc[] {
  const docs: IndexDoc[] = []
  const add = (path: string, text: string): void => {
    docs.push({ guid: path, path, text })
  }

  // ---- the notes the probes mean: short, generic, one word ---------------
  // 154 B in the real vault. It must beat a 30 KB note that says "json" 58
  // times, and a weight can never guarantee that — the tier does.
  add('Areas/CS/JSON.md', '# JSON\n\nParsing and schemas. See [[HTML]].\n')
  // Measured: `Edible/Docs.md` mentions "docs" ZERO times and 296 other notes
  // do. Nothing but the filename can find it.
  add('Edible/Docs.md', '# Product writing\n\nWhere the handbook and the guides live.\n')
  add('Areas/CS/HTML.md', '# HTML\n\nElements, forms, and the parser.\n')
  add('Areas/CS/Svelte.md', pad('# Svelte\n\nRunes, stores, and the compiler.', 8_000))
  add('Areas/CS/Testing.md', '# Testing\n\nWhat to assert and what to leave alone.\n')
  add('TODO/Writing.md', '# Writing\n\n- finish the essay\n')
  add('Areas/CS/Networking.md', pad('# Networking\n\nSockets, TCP, and the DNS path.', 2_000))

  // ---- the competitors that beat them before tiers existed ---------------
  // 60 KB, 40 "html" mentions, every one inside a URL. After noise exclusion
  // it contains the term zero times and leaves the result set entirely; `grep`
  // still finds all 40.
  add(
    'Areas/Life/Music.md',
    pad(`# Music\n\n${urlDump('html', 40)}\n`, 60_000)
  )
  // 30 KB, 58 "json" mentions in prose — legitimately about JSON, and still
  // not the note someone typing "JSON" is looking for.
  add(
    'Edible/Dev Notes/SnapMenu - Restaurant JSON Import.md',
    pad(
      `# Restaurant JSON import\n\n## JSON schema\n\n${mentions('json', 58)}\n`,
      30_000
    )
  )
  add('Edible/Dev Notes/LLM-assisted Restaurant JSON Import.md', mentions('json', 24))
  add('Areas/CS/HTML Security.md', pad(`# HTML Security\n\n${mentions('html', 30)}`, 12_000))
  add('Areas/CS/Svelte Libs.md', pad(`# Svelte Libs\n\n${mentions('svelte', 45)}`, 20_000))
  add('Areas/CS/Firebase Testing.md', pad(`# Firebase Testing\n\n${mentions('testing', 28)}`, 9_000))
  add('Areas/Writing/__Index.md', pad(`# Writing index\n\n${mentions('writing', 20)}`, 6_000))
  add('Areas/Writing/Berlin Itinerary.md', pad(`# Berlin\n\n${mentions('writing', 12)}`, 5_000))
  add(
    'Areas/CS/FM Networking Basics & Streams Intro.md',
    pad(`# FM Networking Basics\n\n${mentions('networking', 16)}`, 3_000)
  )
  add(
    'Areas/CS/Coordinating Containers - Docker Compose.md',
    pad(`# Compose\n\n${mentions('networking', 9)}`, 7_000)
  )
  // The measured top competitors for `Docs`: a FOLDER called Docs (so every
  // note under it carries the term in its path) and a note whose title merely
  // contains the word. Both outscore `Edible/Docs.md` on every signal a single
  // BM25 number can see — `Docs.md` says "docs" zero times.
  add('Docs/Immich Setup.md', pad(`# Immich\n\n${mentions('docs', 14)}`, 8_000))
  add(
    'Edible/Customer comms & support - docs, forum.md',
    pad(`# Customer comms\n\n## docs and forum\n\n${mentions('docs', 22)}`, 10_000)
  )
  // The whole point of the daily notes: 20 more notes saying "docs", none of
  // them the one called Docs.
  for (let i = 1; i <= 20; i++) {
    add(`Daily/${i}-5-2025.md`, `# ${i} May\n\n${mentions('docs', 3)}\n`)
  }

  // A note whose ONLY mentions of "testing" are inside a fenced code block —
  // a listing, not a claim about the note's subject. Ranking must not see it;
  // `grep` must.
  const fence = ['```ts', ...Array.from({ length: 60 }, (_, i) => `it('testing ${i}', () => {})`), '```']
  add('Areas/CS/Vitest Fixtures.md', `# Fixtures\n\n${fence.join('\n')}\n`)

  // ---- the phrase pair ---------------------------------------------------
  // Both body tier, so the ONLY signal that can separate them is adjacency.
  // "Apart" has strictly more mentions of each term, so it wins without the
  // phrase bonus and loses with it.
  add(
    'Notes/Phrase Adjacent.md',
    `# Adjacent\n\nThe kernel memory layout is fixed.\nA second look at the memory layout.\n`
  )
  add(
    'Notes/Phrase Apart.md',
    [
      '# Apart',
      '',
      'memory is cheap and the budget is not.',
      'the layout of the page is fixed.',
      'more memory than anyone needs.',
      'the layout again, unrelated.',
      'memory once more.',
      'layout once more.',
    ].join('\n')
  )

  return docs
}
