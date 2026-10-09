# ProyekKas — staging load test + ZAP baseline, 2026-10-09 (plan)

- **Approval:** owner 2026-10-09 — **staging only**, **22:00–24:00 WITA (21:00–23:00 WIB)**, automatic stop if prod
  is impacted. Prepared by the QA agent on `test/staging-loadtest-1009` (from `main` `38d2be8` = v0.6.2).
- **Target:** `https://drms-kas.staging.bimacreative.tech` = `0.6.2-stg-38d2be8` (web `drms-pk-stg` 384 MiB /
  0.75 CPU, worker 192 MiB / 0.25 CPU), realm `drms-staging`. Prod (`drms-pk-web` / `drms-pk-worker` 0.6.2) is only
  **observed** (docker stats + `/api/v1/health`).
- **Purpose:** re-measure after MC4 / v0.6.2 (E9 method, `s3-e9-qa-report.md` §7) and decide **P-1**
  (`mc4-qa-report.md` §5.4: Q-34 × 3 was CPU-bound at 0.75 CPU, locally).
- **Tooling + runbook:** `apps/web/tests/load/staging-1009/` (`run.sh`, `mix.js`, `watchdog.sh`, `fixture.mjs`,
  `README.md`). One command at 22:00 WITA (§8).

## 1. Scope

| In | Out |
|---|---|
| ZAP baseline, **passive only**: `/`, `/admin/login`, `/unduh`, `/privasi`, `/.well-known/assetlinks.json`, public `/api/v1` (`health`, `health/ready`, `app/config`, `privacy-notice`, `openapi.json`) + what the spider finds; compared with E9 | Active scan, authenticated ZAP, brute force, any request to prod other than the watchdog's health GET |
| k6 Q-34 mix (E9 option b) × 1, then × 3, over the fictional PTs CS1 + CS2; optional × 3 control run without uploads | Writing to PT DRMS documents; reading DRMS documents with a fictional account |
| p50/p95/p99 per action, error rate, staging web/worker RAM/CPU + CPU throttling, P-1 conclusion | Changes to staging/prod config, Traefik, CrowdSec, Keycloak by the QA side (all such steps are infra-lead requests, §4) |

## 2. Prerequisites (checklist for the Lead)

| # | Item | Who | When (WITA) |
|---|---|---|---|
| P-a | Owner confirms requests I-1…I-5 **directly in the infra-lead session** (relayed approval does not count) | owner | before 20:00 |
| P-b | I-1 password file `/root/lt1009/pw.csv` (root, 600, 106 lines) handed over | infra | by 21:00 |
| P-c | I-2 read-only SELECT results (decides O-2 path, shows the lt-* DRMS memberships, CS2 code free) | infra | by 21:00 |
| P-d | I-3 generator network OK (edge) — else allowlist for `TARGET_MODE=public` | infra | by 21:00 |
| P-e | O-2 `admin.uji` = active group admin | owner | 21:30–21:55 |
| P-f | I-4 quiet host: CI runner paused, no deploys, no agent test stacks; `run.sh check` baseline load1 < 2.0 | infra + Lead | 21:45 |
| P-g | `run.sh check` green (images k6 2.3.0 + ZAP pre-pulled on 2026-10-09, network, password file, watchdog tick) | Lead | 21:45 |

## 3. Accounts and data

### 3.1 Why not the six `*.uji` accounts

Q-34 means 30 field + 5 office **people**. The app limits per user (`/sync/batch` 12/min, uploads 60/min, devices
10/min) and allows one check-in + one check-out per employee and day, so 6 accounts cannot carry 30 (or 90) field
users without artificial 429s / rejections (E9 BLK-1). The E9 load accounts already exist for exactly this:
**`lt-field-01…30`, `lt-office-01…05`** in Keycloak `drms-staging` (group `loadtest-e9`, disabled since 2026-09-27,
app accounts inactive). Of the `*.uji` accounts only **`admin.uji`** is used (group admin that runs the fixture); the
other five stay disabled.

### 3.2 Roster (106 fictional accounts, e-mail `<name>@proyekkas.test`)

| Accounts | Role · PT | Project (geofence −3.32 / 114.59, r 200 m) | × 1 | × 3 | Keycloak today |
|---|---|---|:-:|:-:|---|
| `lt-field-01…30` | Staff CS1 (employee `LT-CS1-Fnn`) | `PRJ-LT-CS1-01` | ✓ | ✓ | exist, disabled |
| `lt-field-31…45` | Staff CS1 | `PRJ-LT-CS1-02` | | ✓ | **new** |
| `lt-field-46…90` | Staff CS2 (employee `LT-CS2-Fnn`) | `PRJ-LT-CS2-01` | | ✓ | **new** |
| `lt-office-01` / `-02` | Finance CS1 / Finance CS1 + CS2 | — | ✓ | ✓ | exist, disabled |
| `lt-office-03` / `-04` | Direktur CS1 (creates the CS1 projects) / Direktur CS1 + CS2 | CS1-01 | ✓ | ✓ | exist, disabled |
| `lt-office-05` | PM CS1 (employee `LT-CS1-O05`) | PM of CS1-01 | ✓ | ✓ | exist, disabled |
| `lt-office-06`, `-07`, `-08`, `-09` | Finance CS2, CS1, CS2, CS1 + CS2 | — | | ✓ | **new** |
| `lt-office-10`, `-11`, `-12`, `-13` | Direktur CS2 (creates the CS2 project), CS1, CS2, CS1 + CS2 | CS2-01, CS1-02, CS2-01, CS2-01 | | ✓ | **new** |
| `lt-office-14` / `-15` | PM CS2 (`LT-CS2-O14`) / PM CS1 (`LT-CS1-O15`) | PM of CS2-01 / CS1-02 | | ✓ | **new** |
| `admin.uji` | group admin + Admin CS1 + Admin CS2 (fixture only, no load) | — | | | exists (state per I-2) |

× 1 = 30 + 5 VUs (2 of the 5 office accounts map both PTs → consolidated paths as in MC4 R3); × 3 = 90 + 15 VUs
(Finance 6 / Direktur 6 / PM 3 = E9 ratio × 3; 4 cross-PT office accounts). **PT DRMS is never mapped**: active
`lt-*` DRMS memberships (created by the MC1 migration for the E9 accounts) are deactivated by the fixture.

PTs: **CS1** "PT Contoh Sejahtera Uji" (id 2, the MC4 UAT fixture) re-activated; **CS2** "PT Contoh Sejahtera Uji 2"
created with "Salin default" **from CS1** (not from DRMS). For the window both get `syncAttendanceEnabled`,
`syncProgressReportsEnabled`, `syncExpenseDraftsEnabled` = on and `remindersEnabled`, `approvalEmailEnabled`,
`notifyRequesterStatusEnabled` = off (no mail to `.test` addresses); the previous values are restored by cleanup.

### 3.3 Fallback: only the 35 existing accounts

If the 70 new Keycloak users cannot be made in time: `LT_FIELD_IDS=1-30 LT_OFFICE_IDS=1-5 REUSE_X3=3` — × 1 is
unchanged, × 3 drives 105 VUs over 35 accounts (3 VUs per account: per-user limits still hold, 6 sync/min < 12).
Bias: repeated check-ins are rejected `ALREADY_CHECKED_IN` (lighter path) → × 3 slightly optimistic; noted in the result.

## 4. Exact requests

### 4.1 To the infra lead (copy as is)

> **ProyekKas staging load test 2026-10-09, 22:00–24:00 WITA (21:00–23:00 WIB) — owner-approved; please act only
> after the owner confirms it in your session.** Staging only. Nothing here touches prod config.
>
> **I-1 Keycloak accounts, realm `drms-staging`, with your automation client** (no other realm):
> 1. Existing 35 users `lt-field-01…lt-field-30`, `lt-office-01…lt-office-05` (group `loadtest-e9`): set a new random
>    password each (realm policy, ≥ 24 chars), **`temporary=false`**, no required actions, no OTP. **Leave them
>    disabled** — the app re-enables them at 22:00 WITA through its users-sync.
> 2. Create 70 users `lt-field-31…lt-field-90` and `lt-office-06…lt-office-15`: username = that name, email
>    `<name>@proyekkas.test`, `emailVerified=true`, firstName `Uji Beban`, lastName `<name>`, **`enabled=false`**,
>    group `loadtest-e9`, random password `temporary=false`, no required actions, no OTP, no legacy `pk-*` roles (the
>    app adds `pk-user`).
> 3. `admin.uji@proyekkas.test`: if it exists, new random password (`temporary=false`, no required action); leave the
>    enabled flag as it is. If it no longer exists: create `admin2.uji@proyekkas.test` the same way (`enabled=true`)
>    and send me its user id (needed for the seed bootstrap, owner path O-2b).
> 4. Hand-over: **`/root/lt1009/pw.csv`, `root:root`, mode 600**, one line per account `email,password` (106 lines; a
>    header line `email,password` is fine). Never in chat. I never print it; `run.sh` shreds it after the cleanup.
>
> **I-2 Read-only check on `pk_drms_stg` (SELECT only), results to me:**
> ```sql
> SELECT id, email, active, group_admin, keycloak_sub IS NOT NULL AS linked FROM users WHERE email IN ('admin.uji@proyekkas.test','admin2.uji@proyekkas.test');
> SELECT c.short_code, count(*) FILTER (WHERE m.active) AS active, count(*) AS total
>   FROM company_memberships m JOIN users u ON u.id = m.user_id JOIN companies c ON c.id = m.company_id
>  WHERE u.email LIKE 'lt-%@proyekkas.test' OR u.email = 'admin.uji@proyekkas.test' GROUP BY 1;
> SELECT id, short_code, name, active FROM companies ORDER BY id;
> ```
>
> **I-3 Load-generator path (21:00–23:00 WIB).** Preferred: allow three throwaway containers `pk-lt1009-k6`,
> `pk-lt1009-zap`, `pk-lt1009-fixture` to join the docker network **`drms-kas-edge`** and connect to Traefik's
> address on it (today `10.100.7.3:443`) with SNI/Host `drms-kas.staging.bimacreative.tech` and
> `auth.bimacreative.tech` (`--add-host`). Same entrypoint, routers, middlewares and TLS as the public path; the source
> is a private `10.100.7.x` address, so the host's public IP can never be banned and no shared per-IP bucket of the
> host is used. Please confirm: (a) `crowdsecurity/whitelists` still covers `10.100.7.0/24`; (b) the bouncer/AppSec
> still inspects these requests (E9 saw AppSec alerts without decisions for `10.100.0.1`); (c) the staging per-IP
> limits — `ratelimit-pk-api` 20/s burst 40 and the Keycloak token limit 60/min burst 30. × 3 averages about 11 req/s
> with peaks near 20/s; optional for the window: raise `ratelimit-pk-api` on the **staging** router only (or a
> time-boxed higher-priority staging router for `ClientIP(10.100.7.0/24)` with the same middlewares minus the rate
> limit). Without it we report Traefik 429s separately. **Fallback if the edge attachment is refused:** a time-boxed
> CrowdSec allowlist (21:00–23:15 WIB, removed afterwards) for the source address that hairpin traffic from this host
> arrives with at Traefik — please tell me which it is today (host public IP or `10.100.0.1`).
>
> **I-4 Quiet host 20:50–23:15 WIB:** pause `ci-runner-supervisor` (no CI jobs), no staging/prod deploy or
> maintenance. The watchdog stops the test at host load1 > 3.5 (4 vCPU); this morning the baseline was 4–6 from agent
> test stacks.
>
> **I-5 After the run (≈ 22:20 WIB, I will ping):** set the 106 passwords to unknown random values (the app has already
> disabled the accounts), confirm `pw.csv` is gone, and check `cscli decisions list` has nothing from the run.
>
> **I-6 FYI:** during the window the watchdog sends 3 GETs every 15 s to `https://drms-kas.bimacreative.tech/api/v1/health`
> from this host (≈ 12 req/min), plus `docker stats` of `drms-pk-web`, `drms-pk-worker`, `drms-pk-stg`,
> `drms-pk-stg-worker`, `keycloak`, `postgres`, `traefik`, `crowdsec`.

### 4.2 Owner steps

- **O-1 (before 20:00 WITA):** in the infra-lead session: *"Saya setujui permintaan uji beban staging I-1 sampai I-5
  untuk malam ini 22:00–24:00 WITA."*
- **O-2a (21:30–21:55 WITA, ≈ 2 min), if I-2 shows `admin.uji` linked:** staging admin (own account) → **Pengguna &
  Akses → Pengguna → `admin.uji@proyekkas.test`** → tick **Aktif** and **Admin grup (semua PT)** → *Alasan perubahan*:
  `Uji beban staging 2026-10-09 (fiktif)` → **Simpan**. (The app re-enables the Keycloak account.)
- **O-2b (only if O-2a fails because the Keycloak user is gone):** tell the infra lead to run the seed bootstrap for
  the new fictional admin from I-1.3:
  `docker compose --profile seed run --rm -e SEED_ADMIN_EMAIL=admin2.uji@proyekkas.test -e SEED_ADMIN_KEYCLOAK_SUB=<id from I-1.3> drms-pk-stg-seed`
  (`seed.ts`: group admin + Admin membership of PT #1; the base seed part is idempotent and overwrites nothing). The
  fixture deactivates that DRMS Admin membership as its first write (owner condition of 2026-10-02); the Lead then
  sets `LT_ADMIN_EMAIL=admin2.uji@proyekkas.test`.
- **O-3 (after the run):** same screen → untick **Admin grup** and **Aktif** → reason `Uji beban selesai` → **Simpan**.

## 5. Load-generator path

| Option | Measures | Safety | Choice |
|---|---|---|---|
| **edge** (default): k6/ZAP on `drms-kas-edge` → Traefik `10.100.7.3:443`, SNI/Host = staging / auth hostnames | the same Traefik entrypoint, routers, middlewares (buffering, rate limits, CrowdSec bouncer + AppSec, headers), TLS and Keycloak as users; only the host NAT hop is skipped | source = private container IP: cannot ban the host's public IP; own per-IP buckets; no config change | **chosen** (needs I-3 OK) |
| **public**: `--network host` → public URL (hairpin) | fully the public path incl. NAT | source = host public IP (per Lead) or `10.100.0.1` (E9): a CrowdSec ban or a full per-IP bucket would also hit other hairpin traffic of the host (prod probes, other services) | fallback, only with the allowlist of I-3 |

Real users come from many mobile IPs, so per-source-IP limits never see 105 users as one client; Traefik 429s
(`http_429{src=edge}`) are therefore reported as a test artefact, app 429s (`src=app`) as a finding.

## 6. Scenarios, targets, P-1 decision

- **Mix** (`mix.js`, E9 option b; one VU = one account): field — `/me` (+ `/masters` every 3rd), 45 % selfie 720 px +
  check-in/out sync, 55 % receipt 1600 px + Reimburse draft + `draft_delete` in one batch, own list + `/dashboard/me`,
  think 20–40 s; office — dashboard, inbox, Finance transfer queue + report, Direktur/PM projects progress + 60 % a
  progress report with 1–3 photos, think 15–30 s. Per VU once: token, device register, privacy-notice ack (ADR 0018),
  `/me` PT check. Sync items carry `company_id`. Images: synthetic JPEGs **without EXIF** (`photo.jpg` 1600×1200
  295 KB, `selfie.jpg` 720×960 84 KB) with a random COM segment → unique sha256 (E9/MC4 re-used identical bytes,
  which made every receipt an image-duplicate of every other).
- **Profiles:** × 1 ramp 1 min → **steady 10 min** → down 1 min; × 3 ramp 2 min (Keycloak token limit) → steady
  10 min → down 1 min; cool-down 2–3 min between phases. **Control** (automatic only if × 3 finished but missed
  targets): × 3 with `UPLOADS=0` (no uploads, no attendance — drafts without receipt).
- **Targets** (E9 AC + owner decisions 2026-09-27): uploads and `/sync/batch` p95 < 5 s, every other action p95 < 2 s,
  action errors < 1 %, staging web/worker RAM < 80 % of limits (307 / 154 MiB).
- **P-1 decision rule** (`run.sh report` prints the numbers):
  1. × 3 within all targets, errors < 1 % → keep `cpus 0.75`, close P-1.
  2. Misses **and** web CPU p95 ≥ 65 % of a core (limit 75 %) **and** throttled periods ≥ 25 % → CPU-bound. If the
     no-upload control meets the targets → image resize is the driver → **move resize to the worker** (ADR 0002 §6 b;
     worker cpus 0.25 → 0.5) or raise web `cpus` to 1.5; if the control also misses → **raise web `cpus` to 1.5**
     (RAM unchanged) and re-test.
  3. Misses without CPU saturation → not P-1 (look at DB / `DATABASE_POOL_MAX` / Keycloak); P-1 stays open.

## 7. Prod safety guard and abort criteria

`watchdog.sh` runs during every staging phase (ZAP and load), samples every 15 s and stops the generator
(`docker stop -t 30`, k6 still writes its summary) on:

| ID | Condition | Source |
|---|---|---|
| A1 | prod `/api/v1/health` p95 over the trailing 60 s > 1 s (3 probes per tick; timeout or non-200 counts as 5 s) | curl from the host |
| A2 | prod `drms-pk-web` or `drms-pk-worker` RAM > 85 % of its limit | `docker stats --no-stream` |
| A3 | host load1 > 3.5 (`nproc` = 4 → 0.875 per core) | `/proc/loadavg` |
| A4 | 23:50 WITA (22:50 WIB) | clock |
| manual | Lead: `docker stop pk-lt1009-k6` / Ctrl-C | — |

After A1–A3 no further load phase starts; cleanup still runs. Staging is not a stop criterion (it may saturate — that
is the measurement), but its RAM, CPU, cgroup throttling and the generator's own CPU are recorded.

## 8. Timeline

| WITA | WIB | Step |
|---|---|---|
| before 20:00 | before 19:00 | O-1 owner confirmation in the infra-lead session |
| by 22:00 | by 21:00 | I-1…I-3 done (results to the Lead); I-4 CI runner paused from 21:50 WITA / 20:50 WIB |
| 21:30–21:55 | 20:30–20:55 | O-2 admin.uji; Lead: no other workloads |
| 21:45 | 20:45 | `run.sh check` |
| **22:00** | **21:00** | **start:** `tmux new -s lt1009 'LT_OUT=/root/lt1009/out LT_PW_FILE=/root/lt1009/pw.csv LT_SHRED_PW=1 /opt/src/proyekkas-wt/loadtest/apps/web/tests/load/staging-1009/run.sh all 2>&1 \| tee -a /root/lt1009/console.log'` |
| 22:00–22:12 | 21:00–21:12 | prep (fixture plan → apply, ≈ 320 paced Keycloak logins in total) |
| 22:12–22:21 | 21:12–21:21 | ZAP baseline |
| 22:23–22:37 | 21:23–21:37 | load × 1 |
| 22:40–22:55 | 21:40–21:55 | load × 3 (latest start 23:20 WITA) |
| 22:58–23:13 | 21:58–22:13 | control × 3 without uploads (only if × 3 missed targets; latest start 23:15 WITA) |
| ≈ 23:13–23:20 | ≈ 22:13–22:20 | stats, cleanup, report |
| 23:50 | 22:50 | watchdog hard stop (A4) |
| after | after | O-3 owner, I-5 infra, results doc (§9) |

## 9. Results (to write after the run, from `$LT_OUT/REPORT.md`)

`docs/proyekkas/qa/staging-loadtest-2026-10-09-results.md`: per phase the k6 table (n, p50, p95, p99, max, target,
result), error rate, 429 by source, 503 `UPLOAD_BUSY`, sync applied/rejected (codes), progress reports; resources
(staging web/worker RAM peak and % of limit, CPU p50/p95/max, throttled periods and time; prod web/worker; Keycloak,
postgres, traefik, crowdsec; host load1 max; prod health p50/p95/max); any abort; ZAP table vs E9 (NEW / unchanged /
gone, High/Critical count); data created (stats); **P-1 conclusion** by the rule of §6; comparison with E9 §7.7 and
MC4 R1/R3.

## 10. Data touched, cleanup, limitations, findings

**Writes (staging, fictional only, all through the app API, all audited):**
- PT CS1 re-activated + window flags; PT CS2 created (defaults copied from CS1: sequences, approval rules, work
  schedules). After: flags restored, both PTs inactive.
- 105 `lt-*` app accounts re-activated (35) or created (70) → the app enables their Keycloak accounts; privacy ack
  (`users.privacyAckVersion`) of these accounts; devices registered (≈ 110 + fixture logins). After: accounts inactive
  (Keycloak disabled, sessions + devices revoked).
- Memberships: lt accounts in CS1/CS2 (+ cross-PT), `admin.uji` Admin CS1/CS2. Active `lt-*` **DRMS** memberships →
  inactive, and their link to the fictional E9 employee is removed (`employee: null`, finding LT-F1). After: all inactive.
- 93 employees `LT-CS1-F01…F45`, `LT-CS2-F46…F90`, `LT-CS1-O05`, `LT-CS1-O15`, `LT-CS2-O14` → inactive after.
- Projects `PRJ-LT-CS1-01`, `PRJ-LT-CS1-02`, `PRJ-LT-CS2-01` (3 stages 20/30/50 %, 93 team assignments) → archived.
- Load data (estimate from E9 §7.7 × 4–5): ≈ 1 000–1 200 receipt photos, 800–900 selfies, 200–250 progress photos,
  ≈ 120 progress reports, ≈ 1 000 drafts (all cancelled at once), attendance ≤ 2 per account and day; media volume
  `drms_pk_media_stg` + **≈ 250–350 MB** (disk 56 GB free). Media, attendance and progress reports cannot be removed
  through the API (by design; orphan purge is a dry run) — they stay in the inactive fictional PTs.

**Reads of PT DRMS:** the company row (group-admin check) and the membership rows of the `lt-*` accounts. No DRMS
document is read by any fictional account (none has an active DRMS membership). `admin.uji` is a group admin and could
read DRMS, but the scripts never request DRMS documents.

**Cleanup (`run.sh cleanup`, also at the end of `all`):** stats → cancel leftover drafts (owner's own sync,
`draft_delete`) → archive projects → deactivate employees, memberships, the 105 accounts, PT flags restored, CS2 + CS1
inactive, `admin.uji` CS1/CS2 memberships inactive → shred secrets. Owner O-3, infra I-5. Void/cancel only via the
API, never raw SQL.

**Limitations:** single generator on the same 4-vCPU host as staging, prod and Keycloak (generator CPU recorded);
staging fictional PTs hold little history, so inbox/dashboard queries are lighter than MC4's one-year data (P-2 is not
re-measured); × 1 accounts are reused in × 3 on the same WITA day → their repeated check-ins are rejected
(`ALREADY_CHECKED_IN`, lighter path); with the fallback `REUSE_X3=3` this applies to all × 3 field VUs.

**Findings from the preparation:**

| ID | Severity | Component | Finding | Recommendation |
|---|---|---|---|---|
| LT-F1 | Low | `api/v1/endpoints/memberships.ts` + `CompanyMemberships.employee` filterOptions | `POST /api/v1/company-memberships/batch` cannot update (e.g. deactivate) an existing membership that links an employee of a PT where the caller — even a group admin — has no active membership: 400 "Isian ini memiliki pilihan tidak valid berikut: <employee id>", also when the body omits `employee` (the existing link is re-validated — apparently under the caller's PT scope / `filterOptions` on `data.company`). Reproduced locally on the 0.6.2-stg image; the same update succeeds once the caller is an active member of that PT. Impact: a group admin cannot switch off such memberships in `/admin/akses-pt` without first becoming a member of that PT. | nextjs: validate `employee` only when it is in the body, and with the membership's own `company`; add an integration test (group admin deactivates a membership with employee in a PT it is not a member of) |
| LT-O1 | Info | host | Baseline load1 was 4–6 on the morning of 2026-10-09 from agent test stacks (`pk-adminui-*`, dbt) → would trip the A3 guard | keep the host quiet in the window (I-4, P-f) |
