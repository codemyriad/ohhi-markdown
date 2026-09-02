#!/usr/bin/env bash
# Golden rule 5 (CLAUDE.md / shaping D9): Editor-owned sync/reconciler code
# must use the injected Clock, never ambient timers/time. Lines that need
# wall-clock for non-timing reasons (e.g. unique temp names) carry a
# `clock-exempt` comment.
set -euo pipefail
cd "$(dirname "$0")/.."
violations=$(grep -rnE 'setTimeout|setInterval|Date\.now|performance\.now' libs/sync/src libs/vault/src libs/index/src 2>/dev/null | grep -v 'clock-exempt' || true)
if [ -n "$violations" ]; then
  echo "Ambient time/timer usage in clock-injected packages:" >&2
  echo "$violations" >&2
  exit 1
fi
echo "clock injection: OK"
