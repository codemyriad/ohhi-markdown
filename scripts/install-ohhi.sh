#!/bin/sh
# Build the `ohhi` CLI and put it on PATH as a SYMLINK
# (plans/agent-surface-shaping.md A2/A8).
#
# `rushx build` in apps/cli bundles src/main.ts to apps/cli/dist/ohhi.mjs with
# esbuild — cold start has to beat ~500 ms (shaping R6), which it cannot do
# through Rush's TypeScript loader. bin/ohhi.mjs is the stable entry point that
# imports the bundle, so the symlink survives every rebuild.
set -eu

usage() {
  cat <<'USAGE'
usage: scripts/install-ohhi.sh [--force] [--dry-run] [--bin-dir <dir>] [--no-build]

  --force          replace an existing file at the target
  --dry-run        print what would happen, change nothing
  --bin-dir <dir>  where the symlink goes (default: ~/.local/bin)
  --no-build       skip `rushx build` and link whatever is already built
USAGE
}

force=0
dry=0
build=1
bin_dir="$HOME/.local/bin"

while [ $# -gt 0 ]; do
  case "$1" in
    --force) force=1 ;;
    --dry-run) dry=1 ;;
    --no-build) build=0 ;;
    --bin-dir)
      [ $# -ge 2 ] || { echo "install-ohhi.sh: --bin-dir needs a value" >&2; exit 2; }
      bin_dir="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "install-ohhi.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cli_dir="$repo_root/apps/cli"
entry="$cli_dir/bin/ohhi.mjs"
target="$bin_dir/ohhi"

[ -f "$cli_dir/package.json" ] || {
  echo "install-ohhi.sh: no apps/cli in $repo_root" >&2
  exit 1
}

run() {
  if [ "$dry" -eq 1 ]; then
    echo "would: $*"
  else
    "$@"
  fi
}

if [ -L "$target" ]; then
  current=$(readlink "$target")
  if [ "$current" = "$entry" ]; then
    echo "ohhi: already linked ($target -> $entry)"
    dry_note=1
  else
    echo "ohhi: relinking $target (was $current)"
    run rm -f "$target"
    dry_note=0
  fi
elif [ -e "$target" ]; then
  if [ "$force" -eq 0 ]; then
    cat >&2 <<MSG
install-ohhi.sh: $target exists and is not a symlink.

Another ohhi — or something else by that name — is already installed there.
Inspect it, then re-run with --force to replace it, or pick another directory:

  scripts/install-ohhi.sh --force
  scripts/install-ohhi.sh --bin-dir "\$HOME/bin"
MSG
    exit 1
  fi
  echo "ohhi: replacing $target (--force)"
  run rm -f "$target"
  dry_note=0
else
  dry_note=0
fi

if [ "$build" -eq 1 ]; then
  echo "ohhi: building the bundle (apps/cli)…"
  if [ "$dry" -eq 1 ]; then
    echo "would: (cd $cli_dir && rushx build)"
  else
    # install-run-rushx.js is always present in a Rush checkout; a global
    # `rushx` may not be.
    (cd "$cli_dir" && node "$repo_root/common/scripts/install-run-rushx.js" build)
  fi
fi

if [ "$dry" -eq 0 ] && [ ! -f "$cli_dir/dist/ohhi.mjs" ]; then
  echo "install-ohhi.sh: apps/cli/dist/ohhi.mjs is missing — run without --no-build" >&2
  exit 1
fi

run chmod +x "$entry"

if [ "${dry_note:-0}" -eq 0 ]; then
  run mkdir -p "$bin_dir"
  run ln -s "$entry" "$target"
fi

if [ "$dry" -eq 1 ]; then
  echo "dry run: nothing changed"
  exit 0
fi

echo "ohhi: linked $target -> $entry"

case ":${PATH}:" in
  *":$bin_dir:"*) ;;
  *)
    echo "" >&2
    echo "note: $bin_dir is not on PATH. Add it, e.g.:" >&2
    echo "  export PATH=\"$bin_dir:\$PATH\"" >&2
    ;;
esac

echo "Try it:  ohhi stats --vault <your vault>"
echo "Then install the skill:  scripts/install-skill.sh"
