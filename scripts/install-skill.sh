#!/bin/sh
# Install the `ohhi-vault` skill for Claude Code, as a SYMLINK into
# ~/.claude/skills (plans/agent-surface-shaping.md A8).
#
# A symlink, not a copy, on purpose: Cassini's one operational gap is a skill
# that reached ~/.claude/skills as a hand copy and is now stale against its
# repo. A symlink cannot go stale.
set -eu

usage() {
  cat <<'USAGE'
usage: scripts/install-skill.sh [--force] [--dry-run] [--skills-dir <dir>]

  --force            replace an existing file or directory at the target
  --dry-run          print what would happen, change nothing
  --skills-dir <dir> where skills live (default: $CLAUDE_SKILLS_DIR, else ~/.claude/skills)
USAGE
}

force=0
dry=0
skills_dir="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"

while [ $# -gt 0 ]; do
  case "$1" in
    --force) force=1 ;;
    --dry-run) dry=1 ;;
    --skills-dir)
      [ $# -ge 2 ] || { echo "install-skill.sh: --skills-dir needs a value" >&2; exit 2; }
      skills_dir="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "install-skill.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_dir="$repo_root/.claude/skills/ohhi-vault"
target="$skills_dir/ohhi-vault"

[ -f "$source_dir/SKILL.md" ] || {
  echo "install-skill.sh: no skill at $source_dir" >&2
  exit 1
}

run() {
  if [ "$dry" -eq 1 ]; then
    echo "would: $*"
  else
    "$@"
  fi
}

# Already pointing where we want it? Nothing to do.
if [ -L "$target" ]; then
  current=$(readlink "$target")
  if [ "$current" = "$source_dir" ]; then
    echo "ohhi-vault: already linked ($target -> $source_dir)"
    exit 0
  fi
  echo "ohhi-vault: relinking $target (was $current)"
  run rm -f "$target"
elif [ -e "$target" ]; then
  # A real file or directory — almost certainly a hand copy someone made.
  # Refuse rather than delete work we did not create.
  if [ "$force" -eq 0 ]; then
    cat >&2 <<MSG
install-skill.sh: $target exists and is not a symlink.

It is probably a hand copy of an older version of this skill — which is the
staleness this script exists to prevent. Inspect it, then re-run with --force
to replace it:

  scripts/install-skill.sh --force
MSG
    exit 1
  fi
  echo "ohhi-vault: replacing $target (--force)"
  run rm -rf "$target"
fi

run mkdir -p "$skills_dir"
run ln -s "$source_dir" "$target"

if [ "$dry" -eq 1 ]; then
  echo "dry run: nothing changed"
else
  echo "ohhi-vault: linked $target -> $source_dir"
  echo "The skill needs the \`ohhi\` binary on PATH: scripts/install-ohhi.sh"
fi
