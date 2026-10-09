# Staging load test + ZAP baseline — 2026-10-09 (runbook)

Plan, requests and abort criteria: [`docs/proyekkas/qa/staging-loadtest-2026-10-09-plan.md`](../../../../../docs/proyekkas/qa/staging-loadtest-2026-10-09-plan.md).
Owner approval 2026-10-09: **staging only, 22:00–24:00 WITA (21:00–23:00 WIB), automatic stop if prod is impacted.**
Purpose: re-measure after MC4 / v0.6.2 and decide capacity item **P-1** (staging/prod web `cpus 0.75`).

| File | What |
|---|---|
| `run.sh` | single entry point: `check · prep · zap · load-x1 · load-x3 · (load-x2 · load-x3-noupload) · stats · cleanup-plan · cleanup · report · all`, plus `--dry-run` |
| `mix.js` | k6 scenario: Q-34 mix of E9 (option b) × `MULT`, one VU = one fictional account, privacy ack, `company_id` on sync items, unique synthetic JPEGs |
| `watchdog.sh` | prod safety guard (15 s ticks): stops the load on prod health p95 > 1 s over 1 min, prod web/worker RAM > 85 %, host load1 > 3.5, or the 23:50 WITA deadline; records staging + shared containers and cgroup CPU throttling |
| `fixture.mjs` | fictional fixture through the app API only: re-activates PT CS1 + the `lt-*` accounts, creates PT CS2, memberships, employees, 3 projects with stages and team; `stats`; `cleanup` |
| `zap-hook.py` | seeds the public pages and public `/api/v1` endpoints into the passive ZAP baseline |
| `e9-zap-alerts.txt` | the E9 ZAP alert list for the NEW / unchanged / gone comparison |
| `local/` | throwaway local stack used to validate all of the above (`up.sh`, `kc-realm.sh`, `down.sh`) |

## Before the window (Lead)

1. Prerequisites of plan §4 are confirmed: infra **I-1…I-4** (password file, read-only check, generator network,
   quiet host) and owner **O-1/O-2** (approval in the infra-lead session, `admin.uji` = group admin).
2. The password file from the infra lead is at `/root/lt1009/pw.csv` (`root:root`, mode `600`, lines
   `email,password`, 106 accounts). It is read only inside the containers; nothing prints it.
3. No other agent stacks / builds on the VPS (`run.sh check` lists other `pk-*` containers and warns when the baseline
   load1 > 2.0 — the A3 guard would otherwise stop ×3).
4. `cd /opt/src/proyekkas-wt/loadtest && git pull --ff-only` (branch `test/staging-loadtest-1009`).
5. 21:45 WITA: `LT_OUT=/root/lt1009/out LT_PW_FILE=/root/lt1009/pw.csv apps/web/tests/load/staging-1009/run.sh check`
   (local checks + ONE watchdog tick = 3 prod health GETs; no staging request).

## Start (22:00 WITA / 21:00 WIB) — one command

```bash
tmux new -s lt1009 'LT_OUT=/root/lt1009/out LT_PW_FILE=/root/lt1009/pw.csv LT_SHRED_PW=1 \
  /opt/src/proyekkas-wt/loadtest/apps/web/tests/load/staging-1009/run.sh all 2>&1 | tee -a /root/lt1009/console.log'
```

`all` = check → prep → zap → load-x1 → load-x3 (only if ×1 was not stopped and it is before 23:20 WITA) →
load-x3-noupload (only if ×3 finished but missed targets, before 23:15 WITA) → stats → cleanup → report.
Expected: prep ≈ 12 min, ZAP ≈ 8 min, ×1 ≈ 14 min, ×3 ≈ 15 min, control ≈ 15 min, cleanup ≈ 6 min → done ≈ 23:20 WITA.
Results: `$LT_OUT/REPORT.md` (+ `k6/`, `zap/`, `resources-*.md`, `wd-*.csv`, `watchdog-*.log`, `run.log`).

Single phases (same env): `run.sh prep`, `run.sh zap`, `run.sh load-x1`, `run.sh load-x3`, `run.sh cleanup`,
`run.sh report`. `run.sh --dry-run all` prints every command and the schedule without sending anything.

## Abort

- Automatic: `watchdog.sh` (A1 prod health p95 > 1 s over 60 s · A2 prod web/worker RAM > 85 % · A3 host load1 > 3.5
  · A4 23:50 WITA). It runs `docker stop -t 30` on the generator (k6 still writes its summary), writes
  `$LT_OUT/ABORT-<phase>` and `all` skips the remaining load phases and goes to cleanup.
- Manual: `docker stop pk-lt1009-k6` (or `pk-lt1009-zap`), or Ctrl-C in the tmux window (the trap removes the
  `pk-lt1009-*` containers). Then `run.sh cleanup` and `run.sh report`.
- A phase that was aborted is refused on a re-run until its `ABORT-<phase>` file is removed (deliberate repeat only).

## After the run

- `run.sh cleanup` (done by `all`): stats first, cancels leftover drafts (via the owner's own sync), archives the 3
  projects, deactivates the LT employees, all memberships of the `lt-*` accounts in CS1/CS2, the 105 app accounts
  (→ the app disables their Keycloak accounts and revokes sessions/devices), restores the PT flags, deactivates CS2 and
  CS1 and finally `admin.uji`'s CS1/CS2 memberships. Nothing is deleted (no API for it; media and audit rows stay).
- `LT_SHRED_PW=1` shreds `LT_PW_FILE`; the k6 accounts file (`$LT_OUT/.secret/accounts.json`) is always shredded.
- Owner **O-3**: untick "Admin grup" + "Aktif" of `admin.uji`. Infra **I-5**: scramble the 106 passwords.
- Lead: write the results into `docs/proyekkas/qa/` (template: plan §9) from `$LT_OUT/REPORT.md`.

## Fallbacks

| Situation | Do |
|---|---|
| Infra refuses the `drms-kas-edge` attachment | `TARGET_MODE=public` (host network → public URL) — only with the CrowdSec allowlist of plan §5 |
| Only the 35 E9 accounts available (no 70 new ones) | `LT_FIELD_IDS=1-30 LT_OFFICE_IDS=1-5 REUSE_X3=3` — ×3 drives 105 VUs over 35 accounts (3 VUs/account; plan §3.3) |
| `admin.uji` cannot be re-activated (Keycloak user gone) | owner path O-2b (seed bootstrap of `admin2.uji`), then `LT_ADMIN_EMAIL=admin2.uji@proyekkas.test` |
| ×3 stopped by A3 only and ≥ 20 min left | `run.sh load-x2` BEFORE `run.sh cleanup` |
| Prep failed half-way | `run.sh cleanup` (idempotent), fix, `run.sh prep` again (idempotent: find-or-create by natural keys) |

## Validation done (2026-10-09, no request to staging or prod)

On a local throwaway stack (`local/up.sh`: postgres 16.15, Keycloak 26.7.4 realm with the drms-staging clients, the
**staging image `0.6.2-stg-38d2be8`** with staging limits 384 MiB / 0.75 CPU, migrate + base seed with `admin.uji` as
bootstrap group admin + UAT seed = E9-like `lt-*` accounts with DRMS memberships, 15 of the accounts disabled):
`bash -n` + shellcheck (warnings: 0), `node --check fixture.mjs`, `k6 inspect` (×1: 35 VUs 12m30s, ×3: 105 VUs
13m30s, REUSE fallback, prod-host refusal), `run.sh --dry-run all` for staging, then for real on the local stack:
`check`, `prep` (plan → apply; re-activation path after a cleanup), a 30-second k6 smoke with every action (token,
device, privacy ack, `/me`, masters, selfie + check-in, receipt + draft + cancel, lists, dashboards, inbox, transfer
queue, report, stages, progress photos + report: 0 % errors), the watchdog triggers A1/A2/A3/A4 (k6 stopped, summary
written, exit 105), `zap` (10 seeds, 0 High), `stats`, `cleanup-plan`, `cleanup`, `report`, and `all` end to end
(including the automatic control run). Containers `pk-lt1009-*` and the network were removed afterwards.

Not provable locally: the real Traefik / CrowdSec path (TLS, SNI via `--add-host`, rate limits, AppSec), the real
Keycloak, staging data volume, and the hairpin source address — see plan §5 and §10.
