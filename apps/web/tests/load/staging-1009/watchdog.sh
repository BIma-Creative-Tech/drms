#!/bin/bash
# Staging load test 2026-10-09 — PROD SAFETY WATCHDOG (runbook README.md §Watchdog, plan §7).
#
# Every WD_INTERVAL s (15) it samples:
#   - prod web/worker CPU + RAM            docker stats --no-stream <WD_PROD_CONTAINERS>
#   - prod health latency                  WD_PROBES curl GETs of WD_PROD_HEALTH_URL (timeout/non-200 = 5000 ms)
#   - host load average (1 min)            /proc/loadavg
#   - staging + shared containers          docker stats (recorded only: staging web/worker, keycloak, postgres, …)
# and STOPS the load (docker stop -t 30 <WD_STOP_CONTAINERS>, k6 then still writes its summary) when
#   A1  prod health p95 over the last WD_HEALTH_WINDOW_S (60 s) > WD_HEALTH_P95_MS (1000 ms)
#   A2  prod web or worker RAM > WD_RAM_PCT (85 %) of its limit
#   A3  host load1 > WD_LOAD_MAX (3.5 = 0.875 × nproc on this 4-vCPU host) on WD_LOAD_CONSEC consecutive samples (1)
#   A4  the hard deadline WD_DEADLINE (epoch s; run.sh sets 23:50 WITA = 22:50 WIB)
# It ends by itself when every WD_STOP_CONTAINERS container has exited (after WD_GRACE_S of start-up).
# Exit: 0 = load finished normally · 3 = aborted (A1–A3, reason in $WD_OUT/ABORT-<phase>) · 4 = deadline.
#
# Outputs ($WD_OUT, no secrets): wd-<phase>.csv (one row per container per tick), health-<phase>.csv,
# watchdog-<phase>.log, resources-<phase>.md (peaks, CPU p50/p95, health p50/p95/max, load1 max,
# CPU throttling delta of the staging containers from cgroup cpu.stat).
#
# Usage: WD_OUT=<dir> WD_PHASE=x1 watchdog.sh            (run.sh starts it in the background before k6)
#        WD_SELFTEST=1 ... watchdog.sh                    (one tick, no stop — used by run.sh --dry-run / check)
set -uo pipefail

OUT=${WD_OUT:?WD_OUT (output dir) is required}
PHASE=${WD_PHASE:-run}
INTERVAL=${WD_INTERVAL:-15}
PROD_CONTAINERS=${WD_PROD_CONTAINERS:-"drms-pk-web drms-pk-worker"}
PROD_HEALTH_URL=${WD_PROD_HEALTH_URL:-https://drms-kas.bimacreative.tech/api/v1/health}
PROBES=${WD_PROBES:-3}
HEALTH_WINDOW_S=${WD_HEALTH_WINDOW_S:-60}
HEALTH_P95_MS=${WD_HEALTH_P95_MS:-1000}
RAM_PCT=${WD_RAM_PCT:-85}
NPROC=$(nproc)
LOAD_MAX=${WD_LOAD_MAX:-3.5}
LOAD_CONSEC=${WD_LOAD_CONSEC:-1}
WATCH_CONTAINERS=${WD_WATCH_CONTAINERS:-"drms-pk-stg drms-pk-stg-worker keycloak postgres traefik crowdsec"}
STOP_CONTAINERS=${WD_STOP_CONTAINERS:-"pk-lt1009-k6"}
CPUSTAT_CONTAINERS=${WD_CPUSTAT_CONTAINERS:-"drms-pk-stg drms-pk-stg-worker"}
DEADLINE=${WD_DEADLINE:-0}
GRACE_S=${WD_GRACE_S:-90}
SELFTEST=${WD_SELFTEST:-0}

mkdir -p "$OUT"
CSV=$OUT/wd-$PHASE.csv
HCSV=$OUT/health-$PHASE.csv
LOG=$OUT/watchdog-$PHASE.log
MD=$OUT/resources-$PHASE.md
ABORT=$OUT/ABORT-$PHASE
[ -f "$CSV" ] || echo "epoch,container,cpu_pct,mem_mib,mem_pct,limit_mib,load1" > "$CSV"
[ -f "$HCSV" ] || echo "epoch,code,ms" > "$HCSV"
log() { echo "$(date '+%F %T %Z') [$PHASE] $*" | tee -a "$LOG"; }

to_mib() { # "150.5MiB" | "1.2GiB" | "512KiB" | "0B" → MiB (float)
  awk -v v="$1" 'BEGIN{ n=v; sub(/[A-Za-z]+$/,"",n); u=v; sub(/^[0-9.]+/,"",u);
    f=1; if(u=="GiB")f=1024; else if(u=="KiB")f=1/1024; else if(u=="B")f=1/1048576; else if(u=="GB")f=953.67; else if(u=="MB")f=0.9537; else if(u=="kB")f=0.000954;
    printf "%.1f", n*f }'
}

cpustat() { # container → "usage_usec nr_periods nr_throttled throttled_usec" (cgroup v2, systemd driver)
  local id f
  id=$(docker inspect -f '{{.Id}}' "$1" 2>/dev/null) || { echo "NA NA NA NA"; return; }
  for f in /sys/fs/cgroup/system.slice/docker-"$id".scope/cpu.stat /sys/fs/cgroup/docker/"$id"/cpu.stat; do
    if [ -r "$f" ]; then awk '{v[$1]=$2} END{print v["usage_usec"]+0, v["nr_periods"]+0, v["nr_throttled"]+0, v["throttled_usec"]+0}' "$f"; return; fi
  done
  echo "NA NA NA NA"
}

declare -A CPU0
for c in $CPUSTAT_CONTAINERS; do CPU0[$c]=$(cpustat "$c"); done
START=$(date +%s)
log "start: interval ${INTERVAL}s, nproc $NPROC, abort if prod health p95(${HEALTH_WINDOW_S}s) > ${HEALTH_P95_MS} ms | prod RAM > ${RAM_PCT}% | load1 > $LOAD_MAX (${LOAD_CONSEC}×) | deadline $([ "$DEADLINE" -gt 0 ] && date -d "@$DEADLINE" '+%F %T %Z' || echo none)"
log "prod: $PROD_CONTAINERS + $PROD_HEALTH_URL · stop on abort: $STOP_CONTAINERS"

stop_load() { # reason
  echo "$1" > "$ABORT"
  log "ABORT: $1 → docker stop -t 30 $STOP_CONTAINERS"
  for c in $STOP_CONTAINERS; do
    if [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ]; then docker stop -t 30 "$c" >/dev/null 2>&1 & fi
  done
  wait
}

summarize() {
  local end; end=$(date +%s)
  {
    echo "## Resources ${PHASE} ($(date -d "@$START" '+%F %T') – $(date -d "@$end" '+%T %Z'), $(( (end - START) / 60 )) min, ${INTERVAL}s samples)"
    echo
    echo "| Container | samples | RAM start MiB | RAM peak MiB | limit MiB | peak % limit | CPU p50 % | CPU p95 % | CPU max % |"
    echo "|---|---:|---:|---:|---:|---:|---:|---:|---:|"
    for c in $PROD_CONTAINERS $WATCH_CONTAINERS $STOP_CONTAINERS; do
      awk -F, -v c="$c" -v t0="$START" '$2==c && $1>=t0 {n++; cpu[n]=$3; if(n==1)m0=$4; if($4>mm)mm=$4; if($5>mp)mp=$5; lim=$6}
        END{ if(!n) exit; asort(cpu); p50=cpu[int((n-1)*0.5)+1]; p95=cpu[int((n-1)*0.95)+1];
             printf "| %s | %d | %.1f | %.1f | %.0f | %.1f | %.0f | %.0f | %.0f |\n", c, n, m0, mm, lim, mp, p50, p95, cpu[n] }' "$CSV"
    done
    echo
    awk -F, -v t0="$START" 'NR>1 && $1>=t0 {n++; ms[n]=$3; if($2!="200")bad++} END{ if(!n){print "Prod health: no samples"; exit}
      asort(ms); printf "Prod health (%s): %d probes, non-200 %d, p50 %d ms, p95 %d ms, max %d ms\n", "'"$PROD_HEALTH_URL"'", n, bad, ms[int((n-1)*0.5)+1], ms[int((n-1)*0.95)+1], ms[n] }' "$HCSV"
    echo
    awk -F, -v t0="$START" 'NR>1 && $1>=t0 && $7!="" {if($7>m)m=$7} END{printf "Host load1 max %.2f (nproc '"$NPROC"', abort threshold '"$LOAD_MAX"')\n", m}' "$CSV"
    echo
    for c in $CPUSTAT_CONTAINERS; do
      read -r u0 p0 t0 tu0 <<<"${CPU0[$c]}"
      read -r u1 p1 t1 tu1 <<<"$(cpustat "$c")"
      if [ "$u0" = NA ] || [ "$u1" = NA ]; then echo "CPU throttling $c: cgroup cpu.stat not readable"; continue; fi
      awk -v c="$c" -v du=$((u1 - u0)) -v dp=$((p1 - p0)) -v dt=$((t1 - t0)) -v dtu=$((tu1 - tu0)) -v s=$((end - START)) \
        'BEGIN{ printf "CPU throttling %s: usage %.1f s (avg %.2f core), periods %d, throttled %d (%.1f %%), throttled time %.1f s\n", c, du/1e6, (s>0?du/1e6/s:0), dp, dt, (dp>0?100*dt/dp:0), dtu/1e6 }'
    done
    [ -f "$ABORT" ] && { echo; echo "**ABORTED:** $(cat "$ABORT")"; }
  } > "$MD"
  log "summary → $MD"
}

health_tick() { # probes prod health WD_PROBES times, appends to HCSV
  local i out code ms now
  for ((i = 0; i < PROBES; i++)); do
    out=$(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 5 -H 'User-Agent: lt1009-watchdog' "$PROD_HEALTH_URL" 2>/dev/null) || out="000 5"
    code=${out% *}
    ms=$(awk -v t="${out#* }" 'BEGIN{printf "%d", t*1000}')
    [ "$code" = 200 ] || ms=5000
    now=$(date +%s)
    echo "$now,$code,$ms" >> "$HCSV"
    [ "$i" -lt $((PROBES - 1)) ] && sleep 1
  done
}

health_p95() { # p95 of the probes in the trailing window; prints "p95 n"
  awk -F, -v since=$(( $(date +%s) - HEALTH_WINDOW_S )) 'NR>1 && $1>=since {n++; ms[n]=$3} END{ if(!n){print "0 0"; exit} asort(ms); print ms[int((n-1)*0.95)+1], n }' "$HCSV"
}

load_high=0
seen_running=0
while true; do
  now=$(date +%s)
  load1=$(cut -d' ' -f1 /proc/loadavg)
  # shellcheck disable=SC2086,SC2046
  docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}}' $PROD_CONTAINERS $WATCH_CONTAINERS $(for c in $STOP_CONTAINERS; do docker inspect "$c" >/dev/null 2>&1 && echo "$c"; done) 2>/dev/null |
    while IFS=, read -r name cpu mem mpct; do
      used=$(to_mib "$(echo "${mem% / *}" | tr -d ' ')"); lim=$(to_mib "$(echo "${mem#* / }" | tr -d ' ')")
      echo "$now,$name,${cpu%\%},$used,${mpct%\%},$lim,$load1" >> "$CSV"
    done
  health_tick
  read -r p95 n <<<"$(health_p95)"
  ram_hit=$(awk -F, -v t="$now" -v lim="$RAM_PCT" -v names=" $PROD_CONTAINERS " '$1==t && index(names, " "$2" ") && $5+0>lim {printf "%s %s%% ", $2, $5}' "$CSV")
  prod_line=$(awk -F, -v t="$now" -v names=" $PROD_CONTAINERS " '$1==t && index(names, " "$2" ") {printf "%s cpu %s%% ram %s%% · ", $2, $3, $5}' "$CSV")
  log "${prod_line}health p95 ${p95} ms (n=$n) · load1 $load1"
  if awk -v l="$load1" -v m="$LOAD_MAX" 'BEGIN{exit !(l>m)}'; then load_high=$((load_high + 1)); else load_high=0; fi
  [ "$SELFTEST" = 1 ] && { log "selftest: one tick done, no action"; summarize; exit 0; }

  reason=""
  elapsed=$((now - START))
  if [ "$elapsed" -ge "$HEALTH_WINDOW_S" ] && [ "$p95" -gt "$HEALTH_P95_MS" ]; then reason="A1 prod health p95 ${p95} ms > ${HEALTH_P95_MS} ms over ${HEALTH_WINDOW_S}s ($n probes)"; fi
  [ -z "$reason" ] && [ -n "$ram_hit" ] && reason="A2 prod RAM > ${RAM_PCT}%: $ram_hit"
  [ -z "$reason" ] && [ "$load_high" -ge "$LOAD_CONSEC" ] && reason="A3 host load1 $load1 > $LOAD_MAX ($load_high consecutive samples)"
  if [ -n "$reason" ]; then stop_load "$reason"; summarize; exit 3; fi
  if [ "$DEADLINE" -gt 0 ] && [ "$now" -ge "$DEADLINE" ]; then stop_load "A4 deadline $(date -d "@$DEADLINE" '+%T %Z') reached"; summarize; exit 4; fi

  running=0
  for c in $STOP_CONTAINERS; do [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ] && running=1; done
  [ "$running" = 1 ] && seen_running=1
  if [ "$running" = 0 ] && { [ "$seen_running" = 1 ] || [ "$elapsed" -ge "$GRACE_S" ]; }; then
    log "load containers finished — watchdog ends"
    summarize
    exit 0
  fi
  sleep $(( INTERVAL - ( $(date +%s) - now ) > 1 ? INTERVAL - ( $(date +%s) - now ) : 1 ))
done
