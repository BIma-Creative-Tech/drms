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
# - Each attempt's stdout is buffered and only the final attempt's is printed: callers redirect stdout to a JSON file,
#   and a failed attempt's partial output (plus the retry warning, now on stderr) in front of the successful one made
#   `jq` fail (exit 5) in the report step (2026-10-10, v0.7.0 tag image job).
set -uo pipefail

: "${TRIVY_IMAGE:?}" "${tcache:?}"
sysctl_opt=(--sysctl net.ipv6.conf.all.disable_ipv6=1)
delays=(0 30 90)
out="$(mktemp)"
trap 'rm -f "$out"' EXIT

for attempt in 1 2 3; do
  sleep "${delays[$((attempt - 1))]}"
  docker run --rm "${sysctl_opt[@]}" -e TRIVY_USERNAME -e TRIVY_PASSWORD \
    -v /var/run/docker.sock:/var/run/docker.sock:ro -v "$tcache:/root/.cache/trivy" \
    "$TRIVY_IMAGE" "$@" > "$out"
  rc=$?
  if [[ $rc -eq 125 && ${#sysctl_opt[@]} -gt 0 ]]; then
    echo "::warning::docker refused --sysctl net.ipv6.conf.all.disable_ipv6=1; retrying without it" >&2
    sysctl_opt=()
    docker run --rm -e TRIVY_USERNAME -e TRIVY_PASSWORD \
      -v /var/run/docker.sock:/var/run/docker.sock:ro -v "$tcache:/root/.cache/trivy" \
      "$TRIVY_IMAGE" "$@" > "$out"
    rc=$?
  fi
  case $rc in
    0 | 3) cat "$out"; exit "$rc" ;;
  esac
  echo "::warning::trivy attempt $attempt failed (exit $rc)" >&2
done
cat "$out" >&2
echo "::error::trivy failed 3 times (last exit $rc)" >&2
exit "$rc"
