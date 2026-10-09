#!/bin/bash
# Staging load test 2026-10-09 — SINGLE ENTRY POINT (runbook: README.md, plan:
# docs/proyekkas/qa/staging-loadtest-2026-10-09-plan.md). Owner approval 2026-10-09: STAGING ONLY,
# 22:00–24:00 WITA (21:00–23:00 WIB), automatic stop if prod is impacted (watchdog.sh).
#
#   run.sh [--dry-run] <phase>
#     check           local pre-flight (files, images, network, deadline) + ONE watchdog tick (1 prod health probe set)
#     prep            fixture plan → apply (re-activate CS1 + accounts, create CS2 / projects / memberships)
#     zap             ZAP baseline, passive only, staging pages + public /api/v1 (under the watchdog)
#     load-x1         Q-34 × 1 (30 field + 5 office), ramp 1m · steady 10m · down 1m (under the watchdog)
#     load-x3         Q-34 × 3 (90 field + 15 office), ramp 2m · steady 10m · down 1m (under the watchdog)
#     load-x2         optional fallback when ×3 was stopped by the load guard (A3)
#     load-x3-noupload optional control run: ×3 without uploads/attendance (is resize the CPU driver? plan §6)
#     stats           counts of the data the run created (reads only)
#     cleanup-plan    dry run of the cleanup
#     cleanup         cancel leftover drafts, archive projects, deactivate employees/memberships/accounts/PTs, shred secrets
#     report          REPORT.md from the phase outputs (latency, resources, ZAP diff, P-1 helper)
#     all             check → prep → zap → load-x1 → load-x3 (if x1 clean and before X3_LATEST) → load-x3-noupload
#                     (only if ×3 finished but missed targets, before CONTROL_LATEST, LT_CONTROL_RUN=1) → stats → cleanup → report
#   --dry-run         prints every docker command and the schedule; sends NO request anywhere, writes nothing
#
# Required env: LT_OUT (results dir OUTSIDE git, created 700), LT_PW_FILE (CSV "email,password" from the infra
# lead, root-owned, mode 600 — never printed, never copied into the repo).
# Optional env: LT_TARGET staging|local (default staging) · TARGET_MODE edge|public (default edge, plan §5) ·
# STAGING_URL · KC_URL · REALM · EDGE_NET (drms-kas-edge) · LT_DEADLINE_WITA (23:50) · X3_LATEST_WITA (23:20) ·
# LT_SHRED_PW=1 (cleanup also shreds LT_PW_FILE) · LT_CONTROL_RUN=0 (no automatic no-upload control run) ·
# REUSE_X3=3 + LT_FIELD_IDS=1-30 LT_OFFICE_IDS=1-5 (fallback: only the 35 E9 accounts, plan §3.3) ·
# LOCAL_NET (local target) · WD_* (watchdog overrides).
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
LOADDIR=$(cd "$HERE/.." && pwd)
P=pk-lt1009
DRY=0
if [ "${1:-}" = --dry-run ]; then DRY=1; shift; fi
PHASE_ARG=${1:?usage: run.sh [--dry-run] check|prep|zap|load-x1|load-x3|load-x2|load-x3-noupload|stats|cleanup-plan|cleanup|report|all}

LT_TARGET=${LT_TARGET:-staging}
TARGET_MODE=${TARGET_MODE:-edge}
STAGING_URL=${STAGING_URL:-https://drms-kas.staging.bimacreative.tech}
KC_URL=${KC_URL:-https://auth.bimacreative.tech}
REALM=${REALM:-drms-staging}
EDGE_NET=${EDGE_NET:-drms-kas-edge}
LOCAL_NET=${LOCAL_NET:-pk-lt1009-net}
PROD_HOST=drms-kas.bimacreative.tech
NODE_IMG=node:24.21.0-bookworm-slim
K6_IMG=grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34
ZAP_IMG=zaproxy/zap-stable@sha256:7aaa659b0d43078febd82e29bad112285c370727e86ab8340444220e17d9f0d2
HARDEN=(--cap-drop ALL --security-opt no-new-privileges:true)

OUT=${LT_OUT:?LT_OUT (results directory outside git) is required}
SECRET=$OUT/.secret
TOKEN_URL="$KC_URL/realms/$REALM/protocol/openid-connect/token"
STG_HOST=$(echo "$STAGING_URL" | sed -E 's#^https?://([^/:]+).*#\1#')
KC_HOST=$(echo "$KC_URL" | sed -E 's#^https?://([^/:]+).*#\1#')

# ---------------------------------------------------------------- schedule (WITA = Asia/Makassar = WIB + 1 h)
wita_epoch() { TZ=Asia/Makassar date -d "$(TZ=Asia/Makassar date +%F) $1" +%s; }
both() { echo "$(TZ=Asia/Makassar date -d "@$1" '+%H:%M WITA') / $(TZ=Asia/Jakarta date -d "@$1" '+%H:%M WIB')"; }
DEADLINE=$(wita_epoch "${LT_DEADLINE_WITA:-23:50}")
X3_LATEST=$(wita_epoch "${X3_LATEST_WITA:-23:20}")
WINDOW_START=$(wita_epoch "${LT_WINDOW_START_WITA:-22:00}")
CONTROL_LATEST=$(wita_epoch "${CONTROL_LATEST_WITA:-23:15}")
K6RC=0

say() { echo "[$(TZ=Asia/Makassar date '+%H:%M:%S WITA')] $*" | { if [ "$DRY" = 1 ]; then cat; else mkdir -p "$OUT" && tee -a "$OUT/run.log"; fi; }; }
die() { say "STOP: $*"; exit 1; }
run() { # prints in dry-run, executes otherwise
  if [ "$DRY" = 1 ]; then printf '  $'; printf ' %q' "$@"; echo; else "$@"; fi
}

# ---------------------------------------------------------------- guards
guard_target() {
  case "$LT_TARGET" in
    staging)
      [[ "$STG_HOST" == *staging* ]] || die "STAGING_URL host $STG_HOST is not a staging host"
      [ "$STG_HOST" != "$PROD_HOST" ] || die "refusing the prod host"
      [[ "$STAGING_URL" == https://* ]] || die "staging must be https"
      [ "$REALM" = drms-staging ] || die "realm must be drms-staging"
      ;;
    local) [[ "$STG_HOST" =~ ^pk-lt1009- ]] || die "local target must be a pk-lt1009-* container" ;;
    *) die "LT_TARGET must be staging or local" ;;
  esac
}
guard_pw() {
  if [ "$DRY" = 1 ]; then
    { [ -n "${LT_PW_FILE:-}" ] && [ "$(stat -c '%a %U' "$LT_PW_FILE" 2>/dev/null)" = "600 root" ]; } || say "dry-run NOTE: LT_PW_FILE missing / not 600 root — required for the real run"
    return 0
  fi
  [ -n "${LT_PW_FILE:-}" ] || die "LT_PW_FILE (password CSV from the infra lead) is required for this phase"
  [ -f "$LT_PW_FILE" ] || die "LT_PW_FILE $LT_PW_FILE does not exist"
  [ "$(stat -c '%a %U' "$LT_PW_FILE")" = "600 root" ] || die "LT_PW_FILE must be root-owned mode 600 (is $(stat -c '%a %U' "$LT_PW_FILE"))"
}
guard_time() { # seconds the phase needs
  [ "$LT_TARGET" = staging ] || return 0
  local now; now=$(date +%s)
  if [ "$DRY" = 1 ]; then
    { [ "$now" -ge "$WINDOW_START" ] && [ $((now + $1)) -le "$DEADLINE" ]; } || say "dry-run NOTE: now is outside the window / too close to the deadline for this phase (~$(( $1 / 60 )) min)"
    return 0
  fi
  [ "$now" -ge "$WINDOW_START" ] || [ "${LT_IGNORE_WINDOW:-0}" = 1 ] || die "before the approved window ($(both "$WINDOW_START")) — staging phases only inside 22:00–24:00 WITA"
  [ $((now + $1)) -le "$DEADLINE" ] || die "not enough time before the deadline $(both "$DEADLINE") for this phase (~$(( $1 / 60 )) min)"
}

# ---------------------------------------------------------------- network of the generator containers
NET_ARGS=()
net_args() {
  case "$LT_TARGET:$TARGET_MODE" in
    local:*) NET_ARGS=(--network "$LOCAL_NET") ;;
    staging:edge)
      local ip
      ip=$(docker inspect traefik -f "{{with index .NetworkSettings.Networks \"$EDGE_NET\"}}{{.IPAddress}}{{end}}" 2>/dev/null || true)
      [ -n "$ip" ] || die "Traefik has no address on $EDGE_NET — use TARGET_MODE=public (needs the CrowdSec allowlist, plan §5)"
      # same Traefik entrypoint/router/middlewares/TLS as the public path; the source is a private 10.100.7.x address
      NET_ARGS=(--network "$EDGE_NET" --add-host "$STG_HOST:$ip" --add-host "$KC_HOST:$ip")
      ;;
    staging:public) NET_ARGS=(--network host) ;;
    *) die "TARGET_MODE must be edge or public" ;;
  esac
}

# ---------------------------------------------------------------- watchdog
WD_PID=""
wd_start() { # phase, stop-containers
  export WD_OUT="$OUT" WD_PHASE="$1" WD_STOP_CONTAINERS="$2" WD_DEADLINE="$DEADLINE"
  if [ "$DRY" = 1 ]; then echo "  \$ WD_PHASE=$1 WD_STOP_CONTAINERS=\"$2\" WD_DEADLINE=$DEADLINE $HERE/watchdog.sh &   # 15 s ticks, abort A1–A4"; return; fi
  "$HERE/watchdog.sh" >/dev/null 2>&1 &
  WD_PID=$!
}
wd_wait() { # → watchdog exit code
  [ "$DRY" = 1 ] && return 0
  local rc=0
  wait "$WD_PID" || rc=$?
  WD_PID=""
  return "$rc"
}
cleanup_containers() {
  for c in k6 zap fixture; do docker inspect "$P-$c" >/dev/null 2>&1 && docker rm -f "$P-$c" >/dev/null 2>&1 && say "removed container $P-$c"; done
  [ -n "$WD_PID" ] && kill "$WD_PID" 2>/dev/null || true
}
trap 'cleanup_containers; say "interrupted — generator containers removed; run: run.sh cleanup && run.sh report"; exit 130' INT TERM

# ---------------------------------------------------------------- fixture (node container)
fixture() { # args…
  net_args
  run docker run --rm --name "$P-fixture" "${NET_ARGS[@]}" --user 0:0 --memory 256m --cpus 0.5 "${HARDEN[@]}" \
    -e LT_TARGET="$LT_TARGET" -e LT_APP_URL="$STAGING_URL" -e LT_KC_URL="$KC_URL" -e LT_REALM="$REALM" \
    -e LT_OUT=/out -e LT_PW_FILE=/secrets/pw.csv -e LT_FIELD_IDS -e LT_OFFICE_IDS -e LT_TOKEN_PACE_MS -e LT_WEB_PACE_MS -e LT_SINCE \
    -e LT_ADMIN_EMAIL -e LT_CS1_MUST_EXIST -e LT_CS1_NAME -e LT_CS2_NAME \
    -v "$HERE:/suite:ro" -v "$LT_PW_FILE:/secrets/pw.csv:ro" -v "$OUT:/out" -w /suite "$NODE_IMG" node fixture.mjs "$@"
}

# accounts.json for k6 = roster.json (non-secret, from fixture apply) + passwords; 600, owned by the k6 uid
accounts_file() {
  if [ "$DRY" = 1 ]; then echo "  (jq: roster.json + LT_PW_FILE → $SECRET/accounts.json, mode 600, uid 12345)"; return; fi
  [ -f "$OUT/roster.json" ] || die "no $OUT/roster.json — run the prep phase first"
  install -d -m 700 "$SECRET"
  ( umask 077
    jq -n --rawfile pw "$LT_PW_FILE" --slurpfile r "$OUT/roster.json" '
      ($pw | split("\n") | map(select(test("^[^#].*,")) | capture("^(?<e>[^,]+),(?<p>.*)$")) | map({key: (.e|ascii_downcase|gsub("^\\s+|\\s+$";"")), value: (.p|gsub("^\\s+|\\s+$";""))}) | from_entries) as $m
      | { lat: $r[0].lat, lng: $r[0].lng, accounts: [ $r[0].accounts[] | . + { p: ($m[.u] // error("no password for \(.u)")) } ] }' \
      > "$SECRET/accounts.json" )
  chown 12345:12345 "$SECRET/accounts.json"
  chmod 600 "$SECRET/accounts.json"
}
shred_secrets() {
  [ -f "$SECRET/accounts.json" ] && run shred -u "$SECRET/accounts.json"
  if [ "${LT_SHRED_PW:-0}" = 1 ] && [ -f "${LT_PW_FILE:-}" ]; then run shred -u "$LT_PW_FILE"; fi
  return 0
}

# ---------------------------------------------------------------- phases
phase_check() {
  guard_target
  say "check: target $LT_TARGET ($STAGING_URL, realm $REALM), generator mode $TARGET_MODE"
  say "window $(both "$WINDOW_START") → hard deadline $(both "$DEADLINE"); ×3 must start before $(both "$X3_LATEST"); host nproc $(nproc), load $(cut -d' ' -f1-3 /proc/loadavg)"
  for f in mix.js fixture.mjs watchdog.sh zap-hook.py; do [ -f "$HERE/$f" ] || die "missing $f"; done
  for i in "$NODE_IMG" "$K6_IMG" "$ZAP_IMG"; do docker image inspect "$i" >/dev/null 2>&1 && say "image ok: ${i%%@*}" || say "image MISSING (pull before the window): $i"; done
  awk --version 2>/dev/null | grep -q 'GNU Awk' || die "watchdog needs GNU awk"
  if awk -v l="$(cut -d' ' -f1 /proc/loadavg)" 'BEGIN{exit !(l>2.0)}'; then
    say "WARNING: baseline load1 $(cut -d' ' -f1 /proc/loadavg) > 2.0 BEFORE the test — the A3 guard (> ${WD_LOAD_MAX:-3.5}) will likely stop ×3. Stop other workloads first (plan §2 L-3):"
    docker stats --no-stream --format '{{.CPUPerc}} {{.Name}}' | sort -rn | head -5 | sed 's/^/    /'
  fi
  local others; others=$(docker ps --format '{{.Names}}' | grep -E '^(pk-[a-z0-9]+-|ci-runner-job)' | grep -v "^$P-" || true)
  [ -z "$others" ] || say "NOTE: other test/CI containers running: $(echo "$others" | tr '\n' ' ')"
  command -v jq >/dev/null || die "jq is required"
  net_args
  say "generator network: ${NET_ARGS[*]}"
  for c in $P-k6 $P-zap $P-fixture; do docker inspect "$c" >/dev/null 2>&1 && die "container $c already exists (another run?)"; done
  [ -n "${LT_PW_FILE:-}" ] && guard_pw && say "password file ok (600 root, $(grep -c ',' "$LT_PW_FILE") lines — content not shown)"
  if [ "$DRY" = 1 ]; then echo "  (dry-run: watchdog self-test skipped — it would probe prod health once)"; return; fi
  WD_OUT="$OUT" WD_PHASE=check WD_SELFTEST=1 "$HERE/watchdog.sh" || die "watchdog self-test failed"
}

phase_prep() {
  guard_target; guard_pw; guard_time 900
  say "prep: fixture plan (reads + logins only)"
  fixture plan || die "fixture plan failed — see output; nothing was written"
  say "prep: fixture apply"
  fixture apply || die "fixture apply failed — run 'run.sh cleanup' to roll back what was created"
  [ "$DRY" = 1 ] || say "prep done: $(jq -r '.accounts|length' "$OUT/roster.json") accounts, PTs $(jq -c .pts "$OUT/roster.json"), projects $(jq -c .projects "$OUT/roster.json")"
}

phase_zap() {
  guard_target; guard_time 1500; net_args
  local seeds="$STAGING_URL/ $STAGING_URL/admin/login $STAGING_URL/unduh $STAGING_URL/privasi $STAGING_URL/api/v1/health $STAGING_URL/api/v1/health/ready $STAGING_URL/api/v1/app/config?version=0.3.4 $STAGING_URL/api/v1/privacy-notice $STAGING_URL/api/v1/openapi.json $STAGING_URL/.well-known/assetlinks.json"
  run install -d -m 755 "$OUT/zap"
  run chown 1000:1000 "$OUT/zap"
  say "zap: baseline (passive) from $STAGING_URL/ + seeds: $seeds"
  wd_start zap "$P-zap"
  run docker run -d --name "$P-zap" "${NET_ARGS[@]}" --memory 2g --cpus 1 --security-opt no-new-privileges:true \
    -e ZAP_SEEDS="$seeds" -v "$OUT/zap:/zap/wrk:rw" -v "$HERE/zap-hook.py:/zap/lt1009_hook.py:ro" "$ZAP_IMG" \
    zap-baseline.py -t "$STAGING_URL/" -m "${ZAP_SPIDER_MIN:-3}" -T 15 -I --hook=/zap/lt1009_hook.py \
    -J zap.json -w zap.md -r zap.html -z "-config spider.postForm=false -config spider.processForm=false -config connection.defaultUserAgent=ZAP-lt1009-baseline"
  if [ "$DRY" = 0 ]; then
    docker wait "$P-zap" >/dev/null || true
    docker logs "$P-zap" > "$OUT/zap/zap-console.log" 2>&1 || true
    docker rm "$P-zap" >/dev/null
  fi
  local rc=0; wd_wait || rc=$?
  [ "$DRY" = 1 ] && return 0
  zap_summary
  [ "$rc" = 0 ] || say "zap: watchdog rc=$rc ($(cat "$OUT/ABORT-zap" 2>/dev/null))"
  return "$rc"
}

zap_summary() {
  local j=$OUT/zap/zap.json md=$OUT/zap-summary.md
  [ -f "$j" ] || { echo "ZAP produced no zap.json — see zap/zap-console.log" > "$md"; return; }
  {
    echo "## ZAP baseline (passive) — $STAGING_URL"
    echo
    echo "$(grep -E '^(FAIL-NEW|WARN-NEW|PASS):|FAIL-NEW: ' "$OUT/zap/zap-console.log" | tail -1)"
    echo
    echo "| Risk | Alert | Plugin | Instances | vs E9 |"
    echo "|---|---|---|---:|---|"
    jq -r '[.site[].alerts[]] | group_by(.name) | map({name: .[0].name, risk: (.[0].riskdesc|split(" ")[0]), rc: (.[0].riskcode|tonumber), id: .[0].pluginid, n: (map(.instances|length)|add)}) | sort_by(-.rc, .name) | .[] | "\(.risk)|\(.name)|\(.id)|\(.n)"' "$j" |
      while IFS='|' read -r risk name id n; do
        if grep -qF "|$name" "$HERE/e9-zap-alerts.txt"; then v=unchanged; else v="**NEW**"; fi
        echo "| $risk | $name | $id | $n | $v |"
      done
    grep -v '^#' "$HERE/e9-zap-alerts.txt" | while IFS='|' read -r risk name; do
      jq -e --arg n "$name" '[.site[].alerts[] | select(.name == $n)] | length > 0' "$j" >/dev/null || echo "| $risk | $name | — | 0 | gone since E9 |"
    done
    echo
    echo "High/Critical: $(jq '[.site[].alerts[] | select(.riskcode == "3")] | length' "$j") (E9: 0)"
  } > "$md"
  say "zap summary → $md"
}

phase_load() { # phase-name mult minutes extra-env…
  local name=$1 mult=$2 mins=$3; shift 3
  guard_target; guard_pw; guard_time $((mins * 60)); net_args
  [ "$DRY" = 1 ] || [ ! -f "$OUT/ABORT-$name" ] || die "$name was already aborted once ($(cat "$OUT/ABORT-$name")) — remove that file to repeat deliberately"
  accounts_file
  run install -d -m 755 "$OUT/k6"
  run chown 12345:12345 "$OUT/k6"
  say "load $name: Q-34 × $mult ($((30 * mult)) field + $((5 * mult)) office VUs), ~$mins min, generator ${NET_ARGS[*]}"
  wd_start "$name" "$P-k6"
  # k6 options as `k6 run -e` flags (never secrets: the accounts come from the mounted 600 file)
  local kargs=(-e "BASE=$STAGING_URL" -e "TOKEN_URL=$TOKEN_URL" -e "MULT=$mult" -e "PHASE=$name" -e OUT_DIR=/out -e ACCOUNTS_FILE=/secrets/accounts.json)
  for kv in "$@"; do kargs+=(-e "$kv"); done
  # fallback plan §3.3: only the 35 E9 accounts exist → ×3 phases share each account between REUSE_X3 VUs
  if [[ "$name" == load-x3* ]] && [ -n "${REUSE_X3:-}" ]; then kargs+=(-e "REUSE=$REUSE_X3"); fi
  [ "$LT_TARGET" = local ] || [ -z "${TARGET_SCALE:-}" ] || die "TARGET_SCALE is for local validation only"
  for v in RAMP STEADY DOWN FIELD_VUS OFFICE_VUS REUSE UNIQUE_IMAGES APP_VERSION LOGIN_JITTER_S TARGET_SCALE; do [ -n "${!v:-}" ] && kargs+=(-e "$v=${!v}"); done
  run docker run -d --name "$P-k6" "${NET_ARGS[@]}" --memory 1g --cpus 1 "${HARDEN[@]}" \
    -v "$LOADDIR:/load:ro" -v "$SECRET/accounts.json:/secrets/accounts.json:ro" -v "$OUT/k6:/out" \
    "$K6_IMG" run --quiet "${kargs[@]}" --out "csv=/out/k6-raw-$name.csv.gz" /load/staging-1009/mix.js
  local k6rc=0 rc=0
  K6RC=0
  if [ "$DRY" = 0 ]; then
    k6rc=$(docker wait "$P-k6" 2>/dev/null || echo 1)
    K6RC=$k6rc
    docker logs "$P-k6" > "$OUT/k6/k6-$name.log" 2>&1 || true
    docker rm "$P-k6" >/dev/null
  fi
  wd_wait || rc=$?
  [ "$DRY" = 1 ] && return 0
  say "load $name: k6 exit $k6rc (0 ok · 99 = a p95 target missed, a result · 105 = stopped by the watchdog), watchdog rc $rc$( [ -f "$OUT/ABORT-$name" ] && echo " — ABORTED: $(cat "$OUT/ABORT-$name")")"
  return "$rc"
}

phase_cleanup() { # --commit or not
  guard_target; guard_pw
  if [ "${1:-}" = --commit ]; then
    say "cleanup: stats first (needs the active fixture), then commit"
    fixture stats || true
    fixture cleanup --commit || say "cleanup reported an error — re-run 'run.sh cleanup' (idempotent)"
    shred_secrets
    say "cleanup done. Left to the OWNER: admin.uji → untick Admin grup + Aktif (plan §4 O-3). INFRA: scramble the 106 passwords (plan §4 I-5)."
  else
    fixture cleanup
  fi
}

phase_report() {
  local r=$OUT/REPORT.md stgimg
  if [ "$DRY" = 1 ]; then echo "  (report: k6-*.md + resources-*.md + zap-summary.md + fixture-stats.json + P-1 helper → $r)"; return; fi
  stgimg=$(docker inspect drms-pk-stg -f '{{index .Config.Labels "org.opencontainers.image.version"}}' 2>/dev/null || echo "?")
  {
    echo "# Staging load test 2026-10-09 — results"
    echo
    echo "Target $STAGING_URL (staging image $stgimg), generator mode $TARGET_MODE, report $(TZ=Asia/Makassar date '+%F %H:%M WITA')."
    echo
    for ph in x1 x3 x2 x3-noupload; do
      [ -f "$OUT/k6/k6-load-$ph.md" ] && { cat "$OUT/k6/k6-load-$ph.md"; echo; }
      [ -f "$OUT/resources-load-$ph.md" ] && { cat "$OUT/resources-load-$ph.md"; echo; }
    done
    [ -f "$OUT/zap-summary.md" ] && { cat "$OUT/zap-summary.md"; echo; }
    [ -f "$OUT/resources-zap.md" ] && { cat "$OUT/resources-zap.md"; echo; }
    [ -f "$OUT/fixture-stats.json" ] && { echo "## Data created in the fictional PTs"; echo; echo '```json'; cat "$OUT/fixture-stats.json"; echo '```'; echo; }
    p1_helper
  } > "$r"
  say "report → $r"
}

p1_helper() { # P-1 conclusion helper (plan §6): numbers + the decision rule, the Lead writes the conclusion
  local j=$OUT/k6/k6-load-x3.json res=$OUT/resources-load-x3.md
  echo "## P-1 helper (web cpus 0.75)"
  echo
  if [ ! -f "$j" ]; then echo "No ×3 result — P-1 stays open (×3 not run or aborted before the summary)."; return; fi
  local fails cpu95 thr err MISSED
  MISSED='[.metrics | to_entries[] | select(.key|test("^act_[a-z_]+$")) | select(.key|test("_e2e$")|not) | select(.value.thresholds != null) | select([.value.thresholds[] | .ok] | all | not) | .key] | join(", ")'
  fails=$(jq -r "$MISSED" "$j")
  err=$(jq -r '(.metrics.act_errors.values.rate // 0) * 100 | . * 100 | round / 100' "$j")
  local web=${LT_WEB_CONTAINER:-drms-pk-stg}
  cpu95=$(awk -F'|' -v c=" $web " '$2 == c {gsub(/ /,"",$9); print $9}' "$res" 2>/dev/null | head -1 || true)
  thr=$(grep -o "CPU throttling $web:.*" "$res" 2>/dev/null | head -1 || true)
  echo "- ×3 targets missed: ${fails:-none} · action error rate ${err} %"
  echo "- staging web CPU p95 ${cpu95:-?} % of one core (limit 75 %) · ${thr:-throttling n/a}"
  if [ -f "$OUT/k6/k6-load-x3-noupload.json" ]; then
    echo "- control run ×3 WITHOUT uploads — targets missed: $(jq -r "$MISSED" "$OUT/k6/k6-load-x3-noupload.json" | sed 's/^$/none/')"
  fi
  echo
  echo "Decision rule (plan §6): (1) all ×3 p95 within target and errors < 1 % → keep cpus 0.75, close P-1. (2) misses with"
  echo "web CPU p95 ≥ 65 % and throttled periods ≥ 25 % → CPU-bound: if the no-upload control meets the targets, the"
  echo "image resize is the driver → move resize to the worker (ADR 0002 §6 b; worker cpus 0.25 → 0.5) or raise web cpus"
  echo "to 1.5; if the control also misses → raise web cpus (1.5) and re-test. (3) misses WITHOUT CPU saturation →"
  echo "not P-1: look at DB / pool (DATABASE_POOL_MAX) / Keycloak; P-1 stays open."
}

phase_all() {
  phase_check
  phase_prep
  local zrc=0 x1rc=0 x3rc=0
  phase_zap || zrc=$?
  if [ "$zrc" = 3 ] || [ "$zrc" = 4 ]; then say "zap stopped by the watchdog → no load test; cleanup"; else
    [ "$DRY" = 1 ] || { say "cool-down ${LT_COOL1_S:-120} s"; sleep "${LT_COOL1_S:-120}"; }
    phase_load load-x1 1 14 || x1rc=$?
    if [ "$x1rc" != 0 ]; then say "×1 stopped by the watchdog (rc $x1rc) → ×3 skipped"
    elif [ "$(date +%s)" -gt "$X3_LATEST" ] && [ "$DRY" = 0 ]; then say "past $(both "$X3_LATEST") → ×3 skipped (not enough window left)"
    else
      [ "$DRY" = 1 ] || { say "cool-down ${LT_COOL3_S:-180} s"; sleep "${LT_COOL3_S:-180}"; }
      phase_load load-x3 3 15 || x3rc=$?
      [ "$x3rc" = 3 ] && grep -q '^A3' "$OUT/ABORT-load-x3" 2>/dev/null && say "×3 stopped by the LOAD guard only — optional: run.sh load-x2 (manual, if ≥ 20 min left, BEFORE cleanup)"
      # P-1 discriminator (plan §6): ×3 finished but missed targets → same load without uploads/attendance
      if [ "${LT_CONTROL_RUN:-1}" = 1 ] && [ "$x3rc" = 0 ] && [ "$K6RC" = 99 ]; then
        if [ "$(date +%s)" -le "$CONTROL_LATEST" ]; then
          say "×3 missed targets → control run ×3 without uploads (cool-down ${LT_COOL3_S:-180} s)"
          sleep "${LT_COOL3_S:-180}"
          phase_load load-x3-noupload 3 15 UPLOADS=0 || true
        else say "×3 missed targets but past $(both "$CONTROL_LATEST") → no control run"; fi
      fi
    fi
  fi
  phase_cleanup --commit
  phase_report
}
phase_cleanup_stats() { guard_target; guard_pw; fixture stats || true; }

say "run.sh $PHASE_ARG (dry-run=$DRY) target=$LT_TARGET mode=$TARGET_MODE out=$OUT"
[ "$DRY" = 1 ] || install -d -m 700 "$OUT"
case "$PHASE_ARG" in
  check) phase_check ;;
  prep) phase_prep ;;
  zap) phase_zap ;;
  load-x1) phase_load load-x1 1 14 ;;
  load-x3) phase_load load-x3 3 15 ;;
  load-x2) phase_load load-x2 2 14 ;;
  load-x3-noupload) phase_load load-x3-noupload 3 15 UPLOADS=0 ;;
  stats) phase_cleanup_stats ;;
  cleanup-plan) phase_cleanup ;;
  cleanup) phase_cleanup --commit ;;
  report) phase_report ;;
  all) phase_all ;;
  *) die "unknown phase $PHASE_ARG" ;;
esac
