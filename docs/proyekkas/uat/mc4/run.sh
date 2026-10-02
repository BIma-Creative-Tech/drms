#!/bin/bash
# MC4 UAT suite — runs each step in a THROWAWAY container (node is not installed on the host). Runbook: README.md.
#   docs/proyekkas/uat/mc4/run.sh <step>
#   steps: fixture-plan | fixture-apply | api | ui | cleanup-plan | cleanup | all (= fixture-apply api ui)
# Required env:
#   UAT_TARGET    local | staging (lib.mjs refuses anything else, and any non-staging host for "staging")
#   UAT_APP_URL   e.g. https://drms-kas.staging.bimacreative.tech
#   UAT_KC_URL    e.g. https://auth.bimacreative.tech
#   UAT_REALM     e.g. drms-staging
#   UAT_PW_DIR    host dir, one file per e-mail (mode 600), e.g. <scratch>/mc4-uat/pw
#   UAT_OUT       host dir for results / screenshots / state.json (outside git)
# Optional: UAT_NETWORK (docker network, default: bridge), UAT_PREFIX (container names, default pk-mc4uat),
#   UAT_LOGIN_PAUSE_MS (default 10000 on https), UAT_APP_VERSION, UAT_DEACTIVATE_PT=1, UAT_DUP_FROM_DRMS=0,
#   UAT_DRMS_WRITER (local only), UAT_KEEP_USERS=1 (cleanup keeps the app accounts).
set -euo pipefail
: "${UAT_TARGET:?}" "${UAT_APP_URL:?}" "${UAT_KC_URL:?}" "${UAT_REALM:?}" "${UAT_PW_DIR:?}" "${UAT_OUT:?}"
HERE=$(cd "$(dirname "$0")" && pwd)
P=${UAT_PREFIX:-pk-mc4uat}
NET=${UAT_NETWORK:-bridge}
NODE_IMG=node:24.21.0-bookworm-slim
PW_IMG=mcr.microsoft.com/playwright:v1.55.0-noble
mkdir -p "$UAT_OUT"
ENVS=(-e UAT_TARGET -e UAT_APP_URL -e UAT_KC_URL -e UAT_REALM -e UAT_PW_DIR=/uat/pw -e UAT_OUT=/uat/out)
for v in UAT_LOGIN_PAUSE_MS UAT_APP_VERSION UAT_DEACTIVATE_PT UAT_DUP_FROM_DRMS UAT_DRMS_WRITER UAT_ALLOW_LEGACY_MARKER UAT_PT_CODE UAT_PT_NAME; do
  [ -n "${!v:-}" ] && ENVS+=(-e "$v")
done
MOUNTS=(-v "$HERE:/suite:ro" -v "$UAT_PW_DIR:/uat/pw:ro" -v "$UAT_OUT:/uat/out")
node_run() { # name, args...
  local name=$1; shift
  docker run --rm --name "$P-$name" --network "$NET" --memory 384m --cpus 1 --cap-drop ALL --security-opt no-new-privileges:true \
    "${ENVS[@]}" "${MOUNTS[@]}" -w /suite "$NODE_IMG" node "$@"
}
ui_run() {
  docker run --rm --name "$P-pw" --network "$NET" --memory 2g --cpus 2 --security-opt no-new-privileges:true \
    "${ENVS[@]}" -e UAT_PLAYWRIGHT=/tmp/pw/node_modules/playwright/index.mjs "${MOUNTS[@]}" -w /suite "$PW_IMG" \
    bash -c 'mkdir -p /tmp/pw && cd /tmp/pw && npm init -y >/dev/null && npm i --no-audit --no-fund --loglevel=error playwright@1.55.0 >/dev/null && cd /suite && node ui-checks.mjs'
}
step() {
  case "$1" in
    fixture-plan) node_run fixture fixture.mjs plan ;;
    fixture-apply) node_run fixture fixture.mjs apply ;;
    api) node_run api --test-reporter=spec api-suite.mjs ;;
    ui) ui_run ;;
    cleanup-plan) node_run fixture fixture.mjs cleanup ;;
    cleanup) if [ "${UAT_KEEP_USERS:-0}" = 1 ]; then node_run fixture fixture.mjs cleanup --commit --keep-users; else node_run fixture fixture.mjs cleanup --commit; fi ;;
    all) step fixture-apply; step api || true; step ui || true ;;
    *) echo "unknown step $1"; exit 2 ;;
  esac
}
step "${1:?step}"
