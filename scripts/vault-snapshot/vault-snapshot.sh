#!/usr/bin/env bash
# vault-snapshot.sh — automatic local history for an Oh hi markdown vault.
#
# Each run commits the vault's current files into a git repository kept
# OUTSIDE the vault (a "shadow" git-dir). `snapshot` never writes into the
# vault, and a vault that is already its own git repo is left byte-for-byte
# alone. Portable to macOS's bash 3.2 (no associative arrays, mapfile or
# ${x,,}; an mkdir lock instead of flock). See README.md next to this file.

set -eu
set -o pipefail

PROG='vault-snapshot.sh'
DEFAULT_MINUTES=10
LABEL_PREFIX=md.ohhi.vault-snapshot
TAB=$(printf '\t')

# Never let the caller's git environment or config steer us: no inherited
# repo/index/identity, no global or system config (hooks, signing, filters,
# excludes). The commit identity is passed per command in cmd_snapshot.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_NAMESPACE \
  GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL \
  GIT_AUTHOR_DATE GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL GIT_COMMITTER_DATE
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0

case "$(uname -s)" in
  Darwin) OS=macos; DEFAULT_ROOT="$HOME/Library/Application Support/ohhi-snapshots" ;;
  *) OS=linux; DEFAULT_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/ohhi-snapshots" ;;
esac
DATA_ROOT="${VAULT_SNAPSHOT_HOME:-$DEFAULT_ROOT}"
BIN_DIR="$DATA_ROOT/bin"
BIN="$BIN_DIR/$PROG"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
AGENT_DIR="$HOME/Library/LaunchAgents"
SELF_DIR=$(cd "$(dirname "$0")" && pwd -P)
SELF="$SELF_DIR/${0##*/}"

die() { printf '%s: %s\n' "$PROG" "$*" >&2; exit 1; }
note() { printf '%s\n' "$@"; }

usage() {
  case "${1:-}" in
    snapshot) note "usage: $PROG snapshot <vault>" '' \
      "Commit the vault's current state into its history (kept outside the vault)." \
      'Makes no commit when nothing changed. A run that finds another in progress' \
      'skips, so overlapping timer runs are harmless.' ;;
    log) note "usage: $PROG log <vault> [path]" '' \
      'List snapshots, newest first. With a path (a file or folder, relative to' \
      'the vault root), only the snapshots that changed it, with A/M/D per file.' ;;
    show) note "usage: $PROG show <vault> <rev> [path]" '' \
      'Print a file as it was in snapshot <rev> (a hash from "log", or HEAD~N).' \
      'Without a path, list what that snapshot changed.' ;;
    restore) note "usage: $PROG restore <vault> <path> [rev] [--to <dir>]" '' \
      'Bring back a file or folder (relative to the vault root; "." = everything)' \
      'as it was in snapshot <rev>. Default rev: the latest snapshot that has the' \
      'path, so a deleted file comes back without looking anything up. Nothing is' \
      'deleted, and files that already match are left alone.' '' \
      'In place, a snapshot is taken first (so the restore can itself be undone)' \
      'and each file is written atomically: a temp file in the same folder, then' \
      'a rename over the original.' '' \
      '  --to <dir>  write under <dir>/<path> instead of into the vault' ;;
    install) note "usage: $PROG install <vault> [minutes]" '' \
      "Snapshot every N minutes (default $DEFAULT_MINUTES) with a systemd user timer (Linux) or" \
      "a launchd agent (macOS). Copies this script to $BIN_DIR" \
      'and takes a first snapshot. On Linux, minutes must be under 60 or a whole' \
      'number of hours.' ;;
    uninstall) note "usage: $PROG uninstall <vault>" '' \
      "Remove the vault's timer. Its history is kept ('status' shows where)." ;;
    status) note "usage: $PROG status" '' \
      'List every snapshotted vault: where its history lives, how many snapshots,' \
      'the latest one, its size, its excludes file and its timer.' ;;
    *) note "usage: $PROG <command> [args]      (<command> --help for details)" '' \
      '  snapshot  <vault>                          commit the current state' \
      '  log       <vault> [path]                   list snapshots' \
      '  show      <vault> <rev> [path]             print a file from a snapshot' \
      '  restore   <vault> <path> [rev] [--to dir]  bring a file or folder back' \
      "  install   <vault> [minutes]                snapshot every N minutes ($DEFAULT_MINUTES)" \
      '  uninstall <vault>                          remove the timer, keep history' \
      '  status                                     list vaults and timers' '' \
      "History lives in $DATA_ROOT (override: VAULT_SNAPSHOT_HOME)." ;;
  esac
}

# resolve_vault <path> [strict] — sets VAULT (absolute, symlinks resolved), ID,
# GD (the shadow git-dir), LOCK and USER_EXCLUDE. Without `strict`, a vault
# folder that no longer exists is accepted by its absolute path, so its
# history can still be read and restored elsewhere.
resolve_vault() {
  local p="${1:-}" base hash
  [ -n "$p" ] || die "missing <vault> folder (try --help)"
  if [ -d "$p" ]; then
    VAULT=$(cd "$p" && pwd -P)
  elif [ -n "${2:-}" ]; then
    die "not a folder: $p"
  else
    case "$p" in /*) VAULT="${p%/}" ;; *) die "not a folder: $p (give the absolute path it had)" ;; esac
  fi
  if [ -z "$VAULT" ] || [ "$VAULT" = / ] || [ "$VAULT" = "$(cd "$HOME" && pwd -P)" ]; then
    die "refusing to treat '${VAULT:-/}' as a vault — pass the vault folder itself"
  fi
  base=$(printf '%s' "${VAULT##*/}" | LC_ALL=C tr -c 'A-Za-z0-9._-' '_' | LC_ALL=C cut -c1-40)
  hash=$(printf '%s' "$VAULT" | git hash-object --stdin | cut -c1-8)
  ID="${base:-vault}-$hash"
  GD="$DATA_ROOT/$ID.git"
  LOCK="$DATA_ROOT/$ID.lock"
  USER_EXCLUDE="$DATA_ROOT/$ID.exclude"
}

need_history() {
  [ -d "$GD" ] || die "no history for $VAULT yet — run: $PROG snapshot '$VAULT' (or see: $PROG status)"
}

# rel_path <path> — a path inside the vault, relative to its root ('.' = all).
rel_path() {
  local p="$1"
  case "$p" in
    /*)
      if [ -d "$p" ]; then
        p=$(cd "$p" && pwd -P)
      elif [ -d "$(dirname "$p")" ]; then
        p="$(cd "$(dirname "$p")" && pwd -P)/$(basename "$p")"
      fi
      if [ "$p" = "$VAULT" ]; then
        p=.
      else
        case "$p" in "$VAULT"/*) p="${p#"$VAULT"/}" ;; *) die "not inside $VAULT: $1" ;; esac
      fi ;;
  esac
  while :; do
    case "$p" in ./?*) p="${p#./}" ;; ?*/) p="${p%/}" ;; *) break ;; esac
  done
  printf '%s' "${p:-.}"
}

# git on the shadow repo, with the vault as its work tree when it exists.
g() {
  if [ -d "$VAULT" ]; then set -- -C "$VAULT" --work-tree="$VAULT" "$@"; else set -- -C "$GD" "$@"; fi
  git --git-dir="$GD" --literal-pathspecs -c core.quotepath=off -c core.autocrlf=false \
    -c core.hooksPath=/dev/null -c commit.gpgsign=false -c gc.autoDetach=false "$@"
}

# mkdir is atomic on every filesystem, so it is the portable lock. A lock is
# stale when its holder is gone or it has been held for over an hour; a lock
# with no pid yet is being taken right now (busy, not stale).
take_lock() {
  local pid
  mkdir -p "$DATA_ROOT"
  if ! mkdir "$LOCK" 2>/dev/null; then
    pid=$(cat "$LOCK/pid" 2>/dev/null || true)
    if [ -z "$(find "$LOCK" -maxdepth 0 -mmin +60 2>/dev/null)" ] &&
      { [ -z "$pid" ] || kill -0 "$pid" 2>/dev/null; }; then
      return 1
    fi
    rm -rf "$LOCK"
    mkdir "$LOCK" 2>/dev/null || return 1
  fi
  echo $$ > "$LOCK/pid"
  trap 'rm -rf "$LOCK"' EXIT
  trap 'exit 130' INT TERM HUP
}

ensure_repo() {
  if [ ! -d "$GD" ]; then
    mkdir -p "$DATA_ROOT"
    git -c init.defaultBranch=main init -q --bare "$GD"
    git --git-dir="$GD" config core.logAllRefUpdates true
    git --git-dir="$GD" config ohhisnapshot.vault "$VAULT"
  fi
  mkdir -p "$GD/info"
  # Store bytes exactly: no line-ending, filter or ident rewriting, whatever
  # .gitattributes the vault carries.
  printf '* -text -filter -ident -working-tree-encoding\n' > "$GD/info/attributes"
  {
    note "# Rewritten by $PROG on every run. Add your own patterns (gitignore" \
      "# syntax) to $USER_EXCLUDE"
    # Editor's atomic writes go through '<file>.editor-tmp-…' temp files
    # (libs/vault node-adapter, apps/web tauri adapters): never capture one.
    # shellcheck disable=SC2016 # '$RECYCLE.BIN/' is a literal folder name
    note .git/ '*.editor-tmp-*' .editor-cache/ .trash/ node_modules/ \
      .obsidian/workspace.json .obsidian/workspace-mobile.json .obsidian/workspace \
      .DS_Store '._*' .Spotlight-V100/ .Trashes/ .fseventsd/ .TemporaryItems/ \
      Thumbs.db desktop.ini '$RECYCLE.BIN/' '*.swp' '.~lock.*#'
    if [ -f "$USER_EXCLUDE" ]; then cat "$USER_EXCLUDE"; fi
  } > "$GD/info/exclude"
}

# Stage the vault into the shadow index. Called inside `if`, where set -e is
# off, so every step returns its own failure.
stage() {
  local list="$GD/snapshot-paths"
  # Tracked files that now match an exclude stop being tracked (their past stays).
  g ls-files -z --cached --ignored --exclude-from="$GD/info/exclude" > "$list" || return 1
  if [ -s "$list" ]; then
    g rm -q --cached --ignore-unmatch --pathspec-from-file="$list" --pathspec-file-nul || return 1
  fi
  g add -u || return 1
  # New files: whatever our excludes don't match. The vault's own .gitignore
  # files are deliberately not honoured — this is a backup, not a project.
  g ls-files -z --others --exclude-from="$GD/info/exclude" > "$list" || return 1
  if [ -s "$list" ]; then
    g add -f --pathspec-from-file="$list" --pathspec-file-nul || return 1
  fi
  rm -f "$list"
}

cmd_snapshot() {
  local n host
  resolve_vault "${1:-}" strict
  if ! take_lock; then
    note "another snapshot of $VAULT is running; skipping"
    return 0
  fi
  ensure_repo
  if ! stage; then sleep 2; stage; fi # a file vanished mid-listing: list again
  if g diff --cached --quiet; then
    note "no changes: $VAULT"
    return 0
  fi
  n=$(g diff --cached --name-only --no-renames -z | tr -cd '\000' | wc -c)
  host=$(uname -n)
  g -c user.name=vault-snapshot -c user.email="vault-snapshot@$host" commit -q --no-verify \
    -m "snapshot $(date '+%Y-%m-%d %H:%M:%S %z') on $host: $((n)) file(s) changed"
  g log -1 --format='%h %s'
}

cmd_log() {
  resolve_vault "${1:-}"
  need_history
  if [ -n "${2:-}" ]; then
    g log --format='%h  %ad  %s' --date='format:%Y-%m-%d %H:%M' --name-status -- "$(rel_path "$2")"
  else
    g log --format='%h  %ad  %s' --date='format:%Y-%m-%d %H:%M'
  fi
}

cmd_show() {
  resolve_vault "${1:-}"
  need_history
  [ -n "${2:-}" ] || die "missing <rev> (a hash from: $PROG log <vault>)"
  if [ -n "${3:-}" ]; then
    g show "$2:$(rel_path "$3")"
  else
    g show --format='%h  %ad  %s' --date='format:%Y-%m-%d %H:%M' --name-status "$2"
  fi
}

# default_rev <path> — the latest snapshot that contains <path>.
default_rev() {
  local last
  if [ "$1" = . ] || [ -n "$(g ls-tree --full-tree HEAD -- "$1")" ]; then
    printf HEAD
    return 0
  fi
  last=$(g log -1 --format=%H -- "$1")
  [ -n "$last" ] || die "'$1' is in no snapshot — see: $PROG log '$VAULT'"
  printf '%s^' "$last" # the snapshot before the one that deleted it
}

cmd_restore() {
  local to="" vault="" path="" rev="" n=0 p commit dest list rec meta mode obj file target tmp
  local restored=0 same=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --to) [ $# -ge 2 ] || die "--to needs a folder"; to="$2"; shift ;;
      --to=*) to="${1#--to=}" ;;
      -h | --help) usage restore; return 0 ;;
      -*) die "unknown option: $1" ;;
      *)
        n=$((n + 1))
        case $n in 1) vault="$1" ;; 2) path="$1" ;; 3) rev="$1" ;; *) die "too many arguments" ;; esac ;;
    esac
    shift
  done
  resolve_vault "$vault"
  need_history
  [ -n "$path" ] || die "missing <path> (relative to the vault; '.' for everything)"
  p=$(rel_path "$path")
  [ -n "$rev" ] || rev=$(default_rev "$p")
  # Resolve before the safety snapshot below moves HEAD.
  commit=$(g rev-parse --verify --quiet "$rev^{commit}") || die "no such snapshot: $rev"
  list="$GD/restore-paths.$$"
  if [ "$p" = . ]; then
    g ls-tree -r -z --full-tree "$commit" > "$list"
  else
    g ls-tree -r -z --full-tree "$commit" -- "$p" > "$list"
  fi
  if [ ! -s "$list" ]; then
    rm -f "$list"
    die "'$p' is not in snapshot $rev — see: $PROG log '$VAULT' '$p'"
  fi

  if [ -n "$to" ]; then
    mkdir -p "$to"
    dest=$(cd "$to" && pwd -P)
  else
    dest="$VAULT"
    if [ -d "$VAULT" ]; then
      bash "$SELF" snapshot "$VAULT" > /dev/null || die "could not snapshot before restoring; nothing changed"
    fi
  fi

  CLEANUP="$list"
  trap 'rm -f "$CLEANUP"' EXIT
  while IFS= read -r -d '' rec <&3; do
    meta="${rec%%"$TAB"*}"
    file="${rec#*"$TAB"}"
    mode="${meta%% *}"
    obj="${meta##* }"
    case "$mode" in 100644 | 100755) ;; *) note "skipped (not a regular file): $file"; continue ;; esac
    target="$dest/$file"
    if [ -d "$target" ]; then note "skipped (a folder is in the way): $file"; continue; fi
    if [ -f "$target" ] && [ "$(git hash-object --stdin < "$target")" = "$obj" ]; then
      same=$((same + 1))
      continue
    fi
    mkdir -p "$(dirname "$target")"
    # The '.editor-tmp-' infix is the name Editor's watcher already skips as
    # in-flight, and the snapshot excludes it too.
    tmp="$(dirname "$target")/.${target##*/}.editor-tmp-restore-$$"
    if [ -f "$target" ]; then cp -p "$target" "$tmp"; fi # keep its permissions
    g cat-file blob "$obj" > "$tmp"
    if [ "$mode" = 100755 ]; then chmod +x "$tmp"; fi
    mv -f "$tmp" "$target"
    tmp=""
    restored=$((restored + 1))
  done 3< "$list"
  rm -f "$list"
  note "restored $restored file(s) from snapshot $(g rev-parse --short "$commit") into $dest ($same already identical)"
  if [ -z "$to" ]; then
    note "If Oh hi markdown has this vault open, quit and reopen it so it picks up every restored file (docs/recovery.md)."
  fi
}

# render <template> <out> KEY=value... — replace @KEY@ placeholders.
render() {
  local src="$1" out="$2" script="" kv val
  shift 2
  for kv in "$@"; do
    val=$(printf '%s' "${kv#*=}" | sed -e 's/[\\|&]/\\&/g')
    script="${script}s|@${kv%%=*}@|${val}|g
"
  done
  sed "$script" "$src" > "$out.tmp"
  mv -f "$out.tmp" "$out"
}

xml_esc() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

# systemd OnCalendar for "every N minutes".
calendar_spec() {
  if [ "$1" -lt 60 ]; then
    printf '*:0/%s' "$1"
  elif [ $(($1 % 60)) -eq 0 ] && [ "$1" -le 1440 ]; then
    printf '0/%s:00' $(($1 / 60))
  else
    die "on Linux, minutes must be under 60 or a whole number of hours (got $1)"
  fi
}

# Copy the script and its templates to a stable place for the timer to run.
install_bin() {
  [ -f "$SELF_DIR/systemd/vault-snapshot@.timer" ] ||
    die "timer templates not found next to $SELF — run install from scripts/vault-snapshot/"
  mkdir -p "$BIN_DIR"
  if [ "$SELF_DIR" != "$(cd "$BIN_DIR" && pwd -P)" ]; then
    cp "$SELF" "$BIN.new"
    chmod +x "$BIN.new"
    mv -f "$BIN.new" "$BIN" # a rename: a run in progress keeps reading the old file
    rm -rf "$BIN_DIR/systemd" "$BIN_DIR/launchd"
    cp -R "$SELF_DIR/systemd" "$SELF_DIR/launchd" "$BIN_DIR/"
  fi
}

cmd_install() {
  local minutes="${2:-$DEFAULT_MINUTES}" spec="" inst label plist log uid
  resolve_vault "${1:-}" strict
  case "$minutes" in '' | *[!0-9]*) die "minutes must be a whole number" ;; esac
  [ "$minutes" -ge 1 ] || die "minutes must be at least 1"
  if [ "$OS" = linux ]; then
    command -v systemctl > /dev/null 2>&1 || die "no systemctl — run '$BIN snapshot \"$VAULT\"' from cron instead"
    spec=$(calendar_spec "$minutes")
  fi
  install_bin
  bash "$BIN" snapshot "$VAULT"
  if [ "$OS" = linux ]; then
    inst=$(systemd-escape --path "$VAULT")
    mkdir -p "$UNIT_DIR/vault-snapshot@$inst.timer.d"
    render "$BIN_DIR/systemd/vault-snapshot@.service" "$UNIT_DIR/vault-snapshot@.service" \
      "SCRIPT=$BIN" "DATA=$DATA_ROOT"
    cp "$BIN_DIR/systemd/vault-snapshot@.timer" "$UNIT_DIR/vault-snapshot@.timer"
    printf '[Timer]\nOnCalendar=\nOnCalendar=%s\n' "$spec" > "$UNIT_DIR/vault-snapshot@$inst.timer.d/interval.conf"
    systemctl --user daemon-reload
    systemctl --user enable --now "vault-snapshot@$inst.timer"
    note "snapshots every $minutes min: vault-snapshot@$inst.timer" \
      "logs: journalctl --user -u 'vault-snapshot@$inst.service'"
  else
    label="$LABEL_PREFIX.$ID"
    plist="$AGENT_DIR/$label.plist"
    log="$HOME/Library/Logs/vault-snapshot-$ID.log"
    uid=$(id -u)
    mkdir -p "$AGENT_DIR" "$HOME/Library/Logs"
    render "$BIN_DIR/launchd/vault-snapshot.plist" "$plist" "LABEL=$label" \
      "SCRIPT=$(xml_esc "$BIN")" "VAULT=$(xml_esc "$VAULT")" "DATA=$(xml_esc "$DATA_ROOT")" \
      "INTERVAL=$((minutes * 60))" "LOG=$(xml_esc "$log")"
    launchctl bootout "gui/$uid/$label" 2> /dev/null || true # replace an earlier install
    launchctl bootstrap "gui/$uid" "$plist" 2> /dev/null || launchctl load -w "$plist"
    note "snapshots every $minutes min: $label" "log: $log"
  fi
}

any_timer_left() {
  local f
  for f in "$UNIT_DIR"/timers.target.wants/vault-snapshot@*.timer; do
    if [ -e "$f" ] || [ -L "$f" ]; then return 0; fi
  done
  return 1
}

cmd_uninstall() {
  local inst label
  resolve_vault "${1:-}"
  if [ "$OS" = linux ]; then
    inst=$(systemd-escape --path "$VAULT")
    systemctl --user disable --now "vault-snapshot@$inst.timer" 2> /dev/null || true
    systemctl --user reset-failed "vault-snapshot@$inst.service" 2> /dev/null || true
    rm -rf "$UNIT_DIR/vault-snapshot@$inst.timer.d"
    if ! any_timer_left; then
      rm -f "$UNIT_DIR/vault-snapshot@.service" "$UNIT_DIR/vault-snapshot@.timer"
    fi
    systemctl --user daemon-reload 2> /dev/null || true
  else
    label="$LABEL_PREFIX.$ID"
    launchctl bootout "gui/$(id -u)/$label" 2> /dev/null ||
      launchctl unload "$AGENT_DIR/$label.plist" 2> /dev/null || true
    rm -f "$AGENT_DIR/$label.plist"
  fi
  note "timer removed for $VAULT" "history kept in $GD — delete that folder to drop it"
}

timer_state() {
  if [ "$OS" = linux ]; then
    systemctl --user is-active "vault-snapshot@$(systemd-escape --path "$1").timer" 2> /dev/null || true
  elif launchctl print "gui/$(id -u)/$LABEL_PREFIX.$2" > /dev/null 2>&1; then
    echo loaded
  else
    echo "not installed"
  fi
}

cmd_status() {
  local gd id vault last found=0
  note "history folder: $DATA_ROOT"
  for gd in "$DATA_ROOT"/*.git; do
    [ -d "$gd" ] || continue
    found=1
    id="${gd##*/}"
    id="${id%.git}"
    vault=$(git --git-dir="$gd" config ohhisnapshot.vault 2> /dev/null || echo '?')
    last=$(git --git-dir="$gd" log -1 --format='%cd (%cr)' --date='format:%Y-%m-%d %H:%M' 2> /dev/null || true)
    note '' "$vault$([ -d "$vault" ] || printf ' (folder missing)')" \
      "  history:   $gd ($(du -sh "$gd" | cut -f1))" \
      "  snapshots: $(git --git-dir="$gd" rev-list --count HEAD 2> /dev/null || echo 0), latest ${last:-never}" \
      "  excludes:  $DATA_ROOT/$id.exclude$([ -f "$DATA_ROOT/$id.exclude" ] || printf ' (none)')" \
      "  timer:     $(timer_state "$vault" "$id")"
  done
  if [ "$found" = 0 ]; then note "no vault has been snapshotted yet"; fi
}

main() {
  local cmd="${1:-}"
  if [ $# -gt 0 ]; then shift; fi
  case "$cmd" in
    snapshot | log | show | restore | install | uninstall | status)
      case "${1:-}" in -h | --help) usage "$cmd"; return 0 ;; esac
      "cmd_$cmd" "$@" ;;
    '' | -h | --help | help) usage "${1:-}" ;;
    *) usage >&2; exit 2 ;;
  esac
}

main "$@"
