#!/usr/bin/env bash
# Run `trivy image` in a throwaway container with retries for transient network errors (CI job `image`).
#
# Usage: trivy-image.sh <trivy image args...>   (env: TRIVY_IMAGE, TRIVY_USERNAME, TRIVY_PASSWORD, tcache)
#
# - Exit code 3 is reserved for "vulnerabilities found" (callers pass `--exit-code 3`) and is returned at once,
#   never retried. Any other non-zero exit (registry/CDN fetch, DB download, ...) is retried 3× with back-off.
# - The container runs with IPv6 disabled: the runner network has no IPv6 route, and Go then skips AAAA records
#   instead of trying them first (2026-10-02: "dial tcp [2606:50c0:…]:443: connect: network is unreachable" while
#   fetching a GHCR blob). If the Docker daemon refuses the sysctl (exit 125), the run continues without it.
set -uo pipefail

: "${TRIVY_IMAGE:?}" "${tcache:?}"
sysctl_opt=(--sysctl net.ipv6.conf.all.disable_ipv6=1)
delays=(0 30 90)

for attempt in 1 2 3; do
  sleep "${delays[$((attempt - 1))]}"
  docker run --rm "${sysctl_opt[@]}" -e TRIVY_USERNAME -e TRIVY_PASSWORD \
    -v /var/run/docker.sock:/var/run/docker.sock:ro -v "$tcache:/root/.cache/trivy" \
    "$TRIVY_IMAGE" "$@"
  rc=$?
  if [[ $rc -eq 125 && ${#sysctl_opt[@]} -gt 0 ]]; then
    echo "::warning::docker refused --sysctl net.ipv6.conf.all.disable_ipv6=1; retrying without it"
    sysctl_opt=()
    docker run --rm -e TRIVY_USERNAME -e TRIVY_PASSWORD \
      -v /var/run/docker.sock:/var/run/docker.sock:ro -v "$tcache:/root/.cache/trivy" \
      "$TRIVY_IMAGE" "$@"
    rc=$?
  fi
  case $rc in
    0 | 3) exit "$rc" ;;
  esac
  echo "::warning::trivy attempt $attempt failed (exit $rc)"
done
echo "::error::trivy failed 3 times (last exit $rc)"
exit "$rc"
