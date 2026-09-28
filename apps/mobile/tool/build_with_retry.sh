#!/usr/bin/env bash
# Runs a build command; retries (max 3 attempts, 60 s apart) ONLY when the log shows a dependency-download
# failure (e.g. HTTP 403/429/5xx from Maven Central / plugins.gradle.org seen on GitHub runners). Any other
# failure (compile error, manifest error, test failure) fails immediately. Official repositories only.
set -uo pipefail
attempts=3
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
pattern='Could not (resolve|GET|HEAD|download)|Received status code (403|429|5[0-9][0-9])|403 Forbidden|Read timed out|Connection reset|Connect timed out|Could not transfer artifact'
for i in $(seq 1 "$attempts"); do
  if "$@" 2>&1 | tee "$log"; then
    exit 0
  fi
  if [ "$i" -lt "$attempts" ] && grep -Eq "$pattern" "$log"; then
    echo "::warning::Dependency download failed (attempt $i/$attempts); retrying in 60 s"
    sleep 60
    continue
  fi
  # Failure diagnostics: Flutter often hides the Gradle cause ("Gradle task … failed with exit code 1").
  # Print the usual cause lines and, when BUILD_LOG_KEEP is set, keep the full log for an artifact upload.
  echo "::group::Build failure excerpt (FAILURE / What went wrong / OutOfMemoryError / error:)"
  grep -nE -A12 'FAILURE:|What went wrong|OutOfMemoryError|GC overhead|Daemon disappeared|daemon.*(crash|stopped)|Killed|R8:|ERROR:|error:' "$log" | tail -200 || true
  echo "::endgroup::"
  if [ -n "${BUILD_LOG_KEEP:-}" ]; then cp "$log" "$BUILD_LOG_KEEP" || true; fi
  exit 1
done
exit 1
