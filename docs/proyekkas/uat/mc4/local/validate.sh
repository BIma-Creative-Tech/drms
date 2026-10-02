#!/bin/bash
# MC4 UAT suite — full LOCAL validation on a fresh throwaway stack (never staging/prod):
#   up (pg + Keycloak + app build of this worktree) → emulate staging (owner step B-1 + DRMS history)
#   → fixture plan → fixture apply → API suite (all flags on) → browser checks → cleanup plan → cleanup
#   → fixture apply again (re-activation path) → API suite with the default flags.
# Usage (repo root): UAT_WORK=/scratch/outside/repo docs/proyekkas/uat/mc4/local/validate.sh
# Results: $UAT_WORK/out/{api-results,ui-results}.md (+ .json), screenshots in $UAT_WORK/out/screens.
set -euo pipefail
: "${UAT_WORK:?set UAT_WORK to a scratch dir outside the repo}"
HERE=$(cd "$(dirname "$0")" && pwd)
P=${UAT_PREFIX:-pk-mc4uat2}
"$HERE/up.sh" all
export UAT_TARGET=local UAT_APP_URL=http://$P-web:3000 UAT_KC_URL=http://$P-kc:8080 UAT_REALM=drms-uat
export UAT_PW_DIR=$UAT_WORK/pw UAT_OUT=$UAT_WORK/out UAT_NETWORK=$P-net UAT_PREFIX=$P
RUN="$HERE/../run.sh"
docker run --rm --name "$P-runner" --network "$P-net" --memory 384m --cap-drop ALL --security-opt no-new-privileges:true \
  -e UAT_TARGET -e UAT_APP_URL -e UAT_KC_URL -e UAT_REALM -e UAT_PW_DIR=/uat/pw -e UAT_OUT=/uat/out \
  -v "$HERE/..:/suite:ro" -v "$UAT_PW_DIR:/uat/pw:ro" -v "$UAT_OUT:/uat/out" -w /suite node:24.21.0-bookworm-slim node local/emulate-staging.mjs
"$RUN" fixture-plan
"$RUN" fixture-apply
UAT_DEACTIVATE_PT=1 UAT_DRMS_WRITER=staff.uji@proyekkas.test "$RUN" api || true
cp "$UAT_OUT/api-results.md" "$UAT_OUT/api-results-flags.md"
"$RUN" ui || true
"$RUN" cleanup-plan
"$RUN" cleanup
"$RUN" fixture-apply
"$RUN" api || true
echo "results: $UAT_OUT/api-results-flags.md, $UAT_OUT/api-results.md, $UAT_OUT/ui-results.md"
