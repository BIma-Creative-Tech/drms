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
  exit 1
done
exit 1
