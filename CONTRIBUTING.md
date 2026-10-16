# Contributing

Thank you for looking. Oh Hi markdown is an early, fast-moving project built
by a small team that uses it daily, so a few things are worth knowing before
you start.

## Before a big change, open an issue

Bug reports and small fixes: go straight to a pull request. Anything larger
— a feature, a new package, a change to how sync, the reconciler or the agent
surface behaves — deserves an issue first. The design is shaped in notes the
team keeps outside this repository, and your idea may already have a decision
behind it. A short issue saves everyone a rewrite.

## Set up

Node 22 (`.nvmrc`), Rush and pnpm; Rush manages pnpm for you.

```sh
rush install                     # or: node common/scripts/install-run-rush.js install
cd apps/web && rushx dev         # the web app; Vite prints the URL
```

The [runbook](docs/running-and-testing.md) has the rest: the relay, the
two-tab collaboration demo, the desktop shell, the `ohhi` CLI.

## Test what you change

CI (`.github/workflows/ci.yml`) runs, per package, `rushx check` (types) and
`rushx test` (unit and property tests), the repo-wide guards, then the
browser smoke. The same commands work locally:

```sh
cd libs/vault && rushx test                 # one package
cd apps/web && rushx check                  # svelte-check
./scripts/check-clock-injection.sh          # no ambient timers in sync code
./scripts/check-design-tokens.sh            # no raw palette utilities in the UI
node apps/desktop/scripts/check-csp.mjs     # the content security policy is current
cd apps/web && rushx e2e                    # Playwright, two browser contexts
```

Collaboration correctness is tested, never hoped: model tests, reconciler
fuzzing with a checked-in `fuzz-crashers/` corpus, and a two-context browser
smoke. `.claude/skills/testing/SKILL.md` explains the tiers; a change to
sync, the vault or the reconciler needs a test at the right tier.

## The rules the code follows

[`CLAUDE.md`](CLAUDE.md) is written for coding agents, and it is also the
shortest statement of the project's rules: files are canonical, nothing is
reserialised that was not changed, sync state never lies, clocks are
injected, the index is derived, the UI renders through design tokens, and
the agent surface and the resource formats are generated from one contract.
A pull request that breaks one of them will be asked to keep it.

Generated files (`spec/`, the id lists in `docs/customising.md`, the landing
page's tokens) are regenerated, never edited by hand; the tests fail on
drift, and the runbook names each generator.

## Commits and pull requests

- Conventional Commits: `type(scope): subject`, for example
  `fix(relay): …` or `docs(guide): …`.
- A user-facing change gets a Rush change file (`rush change`), which feeds
  the package changelogs.
- Keep a pull request to one thing. Say what it does and how you tested it,
  in your own words.
- Agents are welcome here, in the loop and as authors of code. Whatever you
  used to write a change, you are its author: understand it, test it, and be
  able to discuss it.

## Licence of contributions

Oh Hi markdown is licensed under the GNU Affero General Public License,
version 3 (`AGPL-3.0-only`). By submitting a contribution you agree that it
is licensed under the same terms, as the rest of the project is. There is no
contributor licence agreement to sign and no sign-off line to add.

## Security

Vulnerabilities go through [SECURITY.md](SECURITY.md), not the issue tracker.
