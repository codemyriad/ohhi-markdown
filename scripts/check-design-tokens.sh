#!/usr/bin/env bash
# V2a (plans/v2-shaping.md, Fork 2): the UI renders through design tokens, not
# raw palette utilities. A single `bg-white` is enough to make one panel ignore
# the theme, and the failure is invisible until someone switches to dark — so
# this is a build gate, not a review note.
#
# Chrome  → DaisyUI semantics: bg-base-100/200/300, text-base-content[/opacity],
#           border-base-200/300, primary | secondary | accent | neutral,
#           info | success | warning | error, each with its -content pair.
# Editor  → our tokens: bg-ed-surface, text-ed-ink, bg-ed-sync-* (see
#           libs/ui/src/styles/), or var(--ed-*) in a style block.
set -euo pipefail
cd "$(dirname "$0")/.."

pattern='(bg|text|border|ring|divide|from|to|fill|stroke|decoration|outline|shadow|accent|caret|placeholder)-(gray|slate|zinc|stone|neutral-[0-9]|white|black|red-[0-9]|orange-[0-9]|amber-[0-9]|yellow-[0-9]|lime-[0-9]|green-[0-9]|emerald-[0-9]|teal-[0-9]|cyan-[0-9]|sky-[0-9]|blue-[0-9]|indigo-[0-9]|violet-[0-9]|purple-[0-9]|fuchsia-[0-9]|pink-[0-9]|rose-[0-9])'

# Comment lines are prose, not cascade behaviour: a doc comment that NAMES a
# banned class (explaining why it was banned) must not fail the build.
violations=$(grep -rnE "$pattern" apps/web/src libs/editor/src --include='*.svelte' 2>/dev/null \
  | grep -v 'token-exempt' \
  | grep -vE ':[0-9]+: *(\*|//|<!--)' \
  || true)
if [ -n "$violations" ]; then
  echo "Raw palette utilities found — use design tokens (see docs/theming.md):" >&2
  echo "$violations" >&2
  exit 1
fi
# Contrast floor (chrome-shaping R1, the axe gate): `text-base-content` at 60%
# opacity or less measures under 4.5:1 on the light theme (/60 → 4.19:1 on
# white, /40 → 2.41:1), so muted text is /70 at the least. A control that is
# genuinely inactive (WCAG 1.4.3 exempts it) marks its line `contrast-exempt`.
floor=$(grep -rnE 'text-base-content/[1-6]0\b' apps/web/src libs/editor/src --include='*.svelte' 2>/dev/null \
  | grep -v 'contrast-exempt' \
  | grep -vE ':[0-9]+: *(\*|//|<!--)' \
  || true)
if [ -n "$floor" ]; then
  echo "Muted text below the contrast floor — use text-base-content/70 or higher (see .claude/skills/ui-development):" >&2
  echo "$floor" >&2
  exit 1
fi
# Type (foundations round 2, P9): every surface renders in the --ed-font-*
# tokens. A raw `font-sans` / `font-serif` / `font-mono` utility reads
# Tailwind's own family instead — out of reach of a theme and of the person's
# choice in Settings › Appearance — so use `font-ed-ui` / `font-ed-prose` /
# `font-ed-mono`. (`--ed-font-mono` and `font-ed-mono` do not match: the class
# must start the token.)
fonts=$(grep -rnE '(^|[^-a-zA-Z0-9])font-(sans|serif|mono)([^-a-zA-Z0-9]|$)' apps/web/src libs/editor/src \
    --include='*.svelte' --include='*.ts' 2>/dev/null \
  | grep -vE '\.test\.ts:' \
  | grep -v 'token-exempt' \
  | grep -vE ':[0-9]+: *(\*|//|<!--)' \
  || true)
if [ -n "$fonts" ]; then
  echo "Raw font-family utilities found — use font-ed-ui / font-ed-prose / font-ed-mono (see docs/theming.md):" >&2
  echo "$fonts" >&2
  exit 1
fi
# Second gate: the token contract must not accumulate tokens nothing reads.
# `libs/ui/src/styles/tokens/_contract.css` is a PUBLISHED contract — a theme
# author writes against it — so a token in there that no consumer resolves is a
# promise we do not keep. Tokens for constructs a later slice renders carry an
# explicit "(V2e)" marker; everything else must be read by the CM6 theme, the
# wikilink extension, a component, or the @theme inline re-export.
contract=libs/ui/src/styles/tokens/_contract.css
consumers=$(cat libs/editor/src/theme.ts libs/editor-lang/src/wikilink-view.ts \
  libs/ui/src/styles/base.css libs/ui/src/tokens.ts 2>/dev/null; \
  grep -rho --include='*.svelte' -e '--ed-[a-z0-9-]*' apps/web/src 2>/dev/null)
unread=""
while read -r token; do
  # A declaration line carrying "(V2e)" is a forward declaration, not a gap.
  grep -qE "^\s*${token}:.*\(V2e\)" "$contract" && continue
  # Some tokens are read through an interpolated name (--ed-presence-${n}), so
  # a family prefix in a consumer counts for every member of the family.
  family=$(echo "$token" | sed -E 's/-[0-9]+$/-/')
  case "$consumers" in
    *"$token"*) ;;
    *"$family"*) ;;
    *) unread="$unread $token";;
  esac
done < <(grep -oE '^\s*--ed-[a-z0-9-]+' "$contract" | tr -d ' ' | sort -u)
if [ -n "$unread" ]; then
  echo "Contract tokens nothing reads (consume them, or mark the line (V2e)):" >&2
  for t in $unread; do echo "  $t" >&2; done
  exit 1
fi
echo "design tokens: OK"
