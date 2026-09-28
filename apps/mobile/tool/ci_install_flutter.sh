#!/usr/bin/env bash
# CI: install the pinned Flutter SDK from the official tarball into $RUNNER_TEMP/flutter and add it to PATH.
# The tarball is ALWAYS checked against FLUTTER_SHA256 before extraction (cached or not).
#   GitHub-hosted: downloaded into $RUNNER_TEMP every run (as before).
#   Self-hosted (infra plan 12): kept in the runner's persistent cache dir FLUTTER_TARBALL_CACHE
#   (default /cache/flutter, the bind of /srv/ci/cache/flutter). A cached copy with a wrong sha256 is
#   deleted and downloaded again; a new download lands in a temp file and is renamed only after it verified.
#   Cache dir missing / not writable → plain download into $RUNNER_TEMP (never fails because of the cache).
# Env: FLUTTER_VERSION, FLUTTER_SHA256 (workflow env), RUNNER_TEMP, GITHUB_PATH, RUNNER_ENV (runner.environment).
set -euo pipefail
: "${FLUTTER_VERSION:?}" "${FLUTTER_SHA256:?}" "${RUNNER_TEMP:?}" "${GITHUB_PATH:?}"
[[ "$FLUTTER_SHA256" =~ ^[0-9a-f]{64}$ ]] || { echo "::error::FLUTTER_SHA256 is not a sha256"; exit 1; }
name="flutter_linux_${FLUTTER_VERSION}-stable.tar.xz"
url="https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/${name}"

verify() { echo "${FLUTTER_SHA256}  $1" | sha256sum -c --status -; }

tarball="$RUNNER_TEMP/$name"
cache_dir="${FLUTTER_TARBALL_CACHE:-/cache/flutter}"
if [[ "${RUNNER_ENV:-}" == "self-hosted" ]] && mkdir -p "$cache_dir" 2>/dev/null && [[ -w "$cache_dir" ]]; then
  cached="$cache_dir/$name"
  if [[ -f "$cached" ]] && verify "$cached"; then
    echo "Flutter tarball: cache hit, sha256 OK ($cached)"
  else
    if [[ -f "$cached" ]]; then
      echo "::warning::cached $cached has a wrong sha256 — deleting and downloading again"
      rm -f -- "$cached"
    fi
    part="$(mktemp "$cache_dir/.${name}.XXXXXX")"
    trap 'rm -f -- "$part"' EXIT
    curl -fsSL --retry 3 -o "$part" "$url"
    verify "$part" || { echo "::error::downloaded $name: sha256 mismatch"; exit 1; }
    mv -f -- "$part" "$cached"
    trap - EXIT
    echo "Flutter tarball: downloaded, sha256 OK, cached at $cached"
  fi
  tarball="$cached"
else
  curl -fsSL --retry 3 -o "$tarball" "$url"
fi
# Checked again right before use (the cache is shared between jobs; never trusted blindly).
echo "${FLUTTER_SHA256}  $tarball" | sha256sum -c -
tar -xJf "$tarball" -C "$RUNNER_TEMP"
[[ "$tarball" == "$RUNNER_TEMP/$name" ]] && rm -f -- "$tarball"
echo "${RUNNER_TEMP}/flutter/bin" >> "$GITHUB_PATH"
