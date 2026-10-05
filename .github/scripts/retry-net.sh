#!/usr/bin/env bash
# Retry a scanner command on transient (network / DNS) failures — CI job `security`.
#
# Usage: retry-net.sh <findings-exit-code> <command...>
#   exit 0                     → done
#   exit == findings-exit-code → real findings: returned at once, never retried
#   any other exit             → retried (3 attempts, back-off 0 / 30 / 90 s)
#
# Why: the nested containers on the self-hosted runner sometimes fail DNS ("Failed to resolve 'semgrep.dev'
# ([Errno -3] Try again)", tag v0.6.1, 2026-10-06) or a rule/DB download; one blip used to fail the whole tag
# pipeline so the release image was never built.
set -uo pipefail

findings=${1:?findings exit code}
shift
delays=(0 30 90)
rc=0
for attempt in 1 2 3; do
  sleep "${delays[$((attempt - 1))]}"
  "$@"
  rc=$?
  if [[ $rc -eq 0 || $rc -eq $findings ]]; then
    exit "$rc"
  fi
  echo "::warning::attempt $attempt failed (exit $rc, not a findings result) — retrying if attempts remain"
done
echo "::error::failed 3 times (last exit $rc)"
exit "$rc"
