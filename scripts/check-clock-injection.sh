#!/usr/bin/env bash
# Golden rule 5 (CLAUDE.md / shaping D9): Editor-owned sync/reconciler/index
# code must use the injected Clock, never ambient timers/time. `libs/workspace`
# (MountSession, the adopt machine, the event log) takes a Clock too. `libs/agent` is
# in scope too: it stamps the pre-image journal, so an ambient clock there is a
# journal an agent-surface test cannot order (agent-surface-shaping R1). Lines
# that need wall-clock for non-timing reasons (e.g. unique temp names) carry a
# `clock-exempt` comment.
set -euo pipefail
cd "$(dirname "$0")/.."
violations=$(grep -rnE 'setTimeout|setInterval|Date\.now|performance\.now' libs/sync/src libs/vault/src libs/index/src libs/agent/src libs/workspace/src 2>/dev/null | grep -v 'clock-exempt' || true)
if [ -n "$violations" ]; then
  echo "Ambient time/timer usage in clock-injected packages:" >&2
  echo "$violations" >&2
  exit 1
fi
echo "clock injection: OK"
