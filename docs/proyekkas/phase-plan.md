# ProyekKas — Phase plan F0–F7

- **Status:** accepted (user, GATE F0 2026-09-23); phase **MC (multi-company)** added 2026-09-27 before go-live (ADR 0016, proposed — MC0 gate); F1 status updated 2026-09-23 (spike gate passed; foundation on staging); F2 status updated 2026-09-24 (F2a–F2e done and deployed to staging `e9c07ab`; UAT run 4 56/59 PASS; **F2 ready for gate**) · **Date:** 2026-09-23 · **Author:** Analyst/Architect (Phase 0)
- **Basis:** `architecture.md`, ADR 0001–0008 (this folder), ADR 0009–0011 (other agent), requirements v1.0
  (+ v1.1 in parallel), `/opt/infra/CLAUDE.md` §1 (workflow: stop and report at the end of every phase, wait
  for user approval), §5 (Definition of Done).
- **Estimates** are person-days (pd) of focused agent/developer work incl. tests, as ranges; they are
  ESTIMATES without historical velocity data for this team. Calendar time depends on user review latency
  at each gate and on client answers.

## Agents

| Agent | Role in this project |
|---|---|
| analyst | ADRs, requirements refinements, acceptance criteria, capacity re-measurement, spikes write-up |
| nextjs-developer | `apps/web` (Payload config, collections, domain services, `/api/v1`, admin custom views, PDF, jobs) |
| flutter-developer (**new**, to be defined in `/opt/infra/.claude/agents/`) | `apps/mobile` APK, offline queue, geofence/mock detection, FCM, signing |
| qa-security | test plans, negative authz tests, Semgrep rules (Local API `overrideAccess`), ZAP, load test, restore drill |
| docs-versioning | CHANGELOG, semver/tags, user guides (Bahasa Indonesia), runbooks |
| infra-engineer | Keycloak realms/clients, Traefik routes/middlewares, Postgres DBs/roles/pg_hba, backup script, `infra-deploy` extension — **touches shared infra → coordinate with the infra session; changes via its own plan/ADR revisions** |
| odoo-developer | only F7 (mirror target side, per ADR 0009) |

## Phases

### F0 — Discovery & design (this phase)
- **Scope/deliverables:** requirements v1.1 + open questions + traceability (other agent);
  `architecture.md`, ADR 0001–0008, `phase-plan.md` (this); ADR 0009–0011 (other agent).
- **Estimate:** 3–4 pd (done in parallel).
- **Gate:** user approves ADRs (status → accepted) and answers blocking client questions: hostnames,
  numbering reset policy, approval rules/signature positions, original-receipt retention, volumes.

### F1 — Foundation (incl. go/no-go spikes)

> **Status 2026-09-23**
> - **Item 1 spike gate: PASSED** — Payload 3.90.1 = **GO** (user decision 2026-09-23). Spikes a–h:
>   a/b/c/d/e/g/h GO, f PARTIAL resolved by the user-approved minimal admin CSP (architecture §3.3). Evidence
>   `spikes/f1-spike-report.md`; ADR 0001/0002/0003/0006/0007 + architecture revised the same day.
>   Other user decisions: no `json`/`code` field editors in the admin; offline session max 30 days (+ 14 d idle).
> - **Item 7 infra: DONE** (infra `main` commit `c557c28`, runbook `/opt/infra/docs/runbooks/proyekkas-drms-onboarding.md`;
>   verified by Lead 2026-09-23): network `drms-kas-edge` 10.100.7.0/24; DBs `pk_drms`/`pk_drms_stg` + 6 roles +
>   pg_hba; realms `drms`/`drms-staging` imported (back-channel logout disabled; app → Keycloak via public
>   issuer, hairpin); Traefik `drms-pk-stg-{auth,api-v1,api-rest,web}` + `auth-drms-token`; client secrets at
>   `/opt/infra/identity/keycloak/secrets/drms{,-staging}-<client>.secret`; backup `MEDIA_VOLUMES` loop active.
>   Residual (verify once the app runs): staging app deploy (compose `/opt/infra/staging/drms-proyekkas/` not
>   created yet), backup of real `pk_drms*` dumps + media volume, realm SMTP (for `execute-actions-email`),
>   prod A record + prod routers.
> - **Remaining F1 items:** 2 (scaffold exists from the spike; still `packages/api-contract`, `deploy/`
>   compose prod/staging, CI pipeline; image build with `next build --webpack`, ≥ 2 GiB build env),
>   3 (config hardening: `maxDepth`, upload limits), 4 (all masters, users/role sync via Keycloak Admin API,
>   devices, web-sessions), 5 (migrations/grants/triggers per revised ADR 0006, audit hooks factory,
>   numbering service, media collections + **remote-URL guard factory**, `/api/v1` skeleton, OpenAPI),
>   6 (seed data); remove spike-only code (`spike-parents`, `spike-docs`, `/v1/spike/numbered`,
>   `spikeHeartbeat`/`spikeMidnight`, `apps/web/spike/**`); read-only custom field components replacing
>   `json` editors. Open questions to close in F1: Admin REST reachability through `ipallowlist-admin` from
>   `drms-kas-edge` (ADR 0003 §6); worker egress network; `__Host-` cookie + inactivity logout on staging HTTPS.
>
> **Status 2026-09-23 — F1 foundation (develop `e2bf46b`)**
> - **Items 2–6 implemented** in `apps/web/` (masters, users/role sync via Keycloak Admin API, devices,
>   web-sessions, migrations/grants/triggers, audit hooks, numbering, media collections, `/api/v1` health/me/
>   masters/devices, `packages/api-contract/openapi.json`, idempotent seed with fictional default data);
>   spike-only code removed. ADR 0002/0003/0004/0006/0007 + architecture updated (Revision history).
> - **Staging live:** `https://drms-kas.staging.bimacreative.tech` — separate web + worker + one-shot migrate
>   (ADR 0002 §7), deployed by the infra Lead at `/opt/infra/staging/drms-proyekkas/` (runbook Langkah 5);
>   images built locally on the VPS until GHCR (`TEMPORARY`).
> - **GitHub:** repo `bctech-adm/drms` (public); CI (`.github/workflows/ci.yml`: verify, integration,
>   security, build) **green on the first run** — run 35857158248, commit `e2bf46b`, branch `develop`.
> - Open questions of the previous block closed: Admin REST reachability (internal networks
>   `drms-kc-admin[-stg]`, ADR 0003 §6); worker egress (`drms-kas-edge`).
> - **Remaining for F1:** (1) `HEAD` on `/api/v1/health` (currently 404, GET only) — in progress on another
>   branch; (2) SMTP adapter / onboarding e-mail — pending infra (realm + app SMTP, `no-reply@bimacreative.tech`);
>   (3) **F1 gate review**. Not yet in the repo (for the gate review — whether they block F1 is a Lead decision): prod compose
>   under `deploy/`, GHCR push + deploy jobs in CI, prod A record/routers; `__Host-` cookie + inactivity logout
>   check on staging HTTPS.
- **Scope:**
  1. **Spike week (first 3–4 pd, go/no-go for Payload):** (a) OIDC web login with `disableLocalStrategy` +
     `oidcSession` strategy + SSO button + logout in Payload admin; (b) `mobileBearer` strategy on a
     `/api/v1/me` endpoint with a real Keycloak token (confirm `sid` claim, internal `iss`); (c) append-only
     `audit_logs` written via `payload.create` in the request transaction as `pk_drms_app` with triggers
     active; (d) numbering allocation in-transaction; (e) worker bundling of the Payload config;
     (f) strict CSP vs Payload admin; (g) idle RAM of web/worker (`docker stats`).
  2. Monorepo scaffold (`apps/web`, `packages/api-contract`, `deploy/`), Dockerfile (runner + migrate
     targets), compose (prod/staging), CI pipeline (lint/type/test/Semgrep/gitleaks/Trivy/Hadolint/build/GHCR).
  3. Payload config: i18n `id`, TZ, GraphQL off, `maxDepth`, upload limits, sharp.
  4. All master collections (brief list incl. `uoms`, `vehicles`, `cost-centers`, `document-sequences`,
     `company-settings`), users/role sync with Keycloak Admin API, devices, web-sessions.
  5. DB roles/grants/triggers migrations (ADR 0006), audit hooks factory, numbering service (ADR 0007),
     media collections + resize (ADR 0004), `/api/v1` skeleton (health, me, masters, devices), OpenAPI generation.
  6. Seed data: company DRMS, categories, UoMs, cash accounts, vehicle `DA 1234 XY` (Hilux), cost center
     "Ops Palangka Banjar", employees Budi, Doni, Citra, Budi Hartono, sari, bank Mandiri
     account of Doni Pratama.
  7. **[DONE 2026-09-23, infra `c557c28`]** Infra (coordinated): realms `drms`/`drms-staging` + clients + service account; DBs `pk_drms`/`pk_drms_stg`
     + roles + pg_hba; Traefik routes + new middlewares; token-endpoint rate-limit rule; staging deploy;
     backup `MEDIA_VOLUMES`.
- **Dependencies:** F0 gate; infra session availability.
- **Agents / estimate:** nextjs-developer 18–26 pd · infra-engineer 4–6 pd · qa-security 4–5 pd ·
  analyst 2–3 pd · docs-versioning 1–2 pd → **29–42 pd**.
- **Acceptance gate:** ~~spikes (a)–(g) pass or an ADR revision is approved~~ **passed 2026-09-23** (ADR
  revisions approved); staging reachable over HTTPS with SSO; negative tests: app role cannot UPDATE/DELETE/TRUNCATE
  `audit_logs`; APK-style bearer on `/api/<slug>` → never authenticated (403, or 200 `{user:null}` on
  `/api/users/me`; revised per spike §b); inactive user → 401; every master change produces
  audit rows; numbering concurrency test (50 parallel submits → unique, gapless); measured RAM recorded in
  ADR 0002 (revise if > limits); Trivy no CRITICAL.

### F2 — Expense request flow end-to-end (T1–T8) — core business
- **Scope:** expense requests (advance + reimburse) with lines (line `total` primary, unit price display-only,
  server grand total), requesters/creator/"diketahui"/approval positions + signatures, approval rules by
  amount (US-34), approval inbox with budget impact, transfers + automatic KK posting, receipts (many per
  request) + validation flags, LPJ submit/revision/verify, settlement (refund KM / shortfall transfer),
  manual cash in/out, void/reversal, period closing lock, PDF "Pengajuan Biaya" (ADR 0008), in-app
  notifications (push arrives in F4), admin custom views (approval inbox, transfer queue, LPJ verification,
  "Riwayat" tab).
- **Status (2026-09-24): READY FOR GATE**
  - **F2a — DONE** (merged to `develop` `c8c1af6`): expense requests (advance + reimburse) with lines,
    requesters, "Diketahui"/approval positions + signatures, approval rules (US-34; default Owner-only,
    Q-31; "Diketahui" required, Q-07), receipts + validation flags, Reimburse receipt verification
    ("Nota Terverifikasi"), transfers with one automatic KK, manual cash in/out, void/reversal (KM/KK),
    period close/re-open, DB guards (ADR 0005/0006), `Idempotency-Key`, `/api/v1` endpoints + OpenAPI, form
    228 fixture in the integration tests. Onboarding prerequisite: PM per project / manager per cost center
    (architecture §5.2). Also fixed the F1 WebP-thumbnail upload defect (architecture §9.1).
  - **F2b — DONE** (merged `4d952ba`): LPJ/settlement (submit/revision/verify; exact amount settles at
    verification, refund KM / shortfall transfer + KK; ADR 0005), Class B `settlements`/`notifications` DB guards
    (ADR 0006), PDF "Pengajuan Biaya" (ADR 0008 "As implemented"), admin custom views (approval inbox, transfer
    queue, LPJ verification, "Riwayat" tab), in-app notifications (`pushStatus`, push gated off — ADR 0011),
    file endpoint `GET /api/v1/media/{collection}/{id}/file` (ADR 0004 §4a), Reimburse auto-close job (01:15 WITA).
  - **F2c — DONE** (merged `59ba0a4`): requester actions in the web panel — `pk-staff` panel access with
    restricted nav, self-service profile signature, submit/withdraw/cancel/resubmit/receipts/LPJ/confirm via
    `/api/v1` + `Idempotency-Key`, status timeline; admin REST create/edit runs `validateContent` (security fix;
    ADR 0003 §3a).
  - **F2d — DONE** (merged `c11907a`, UAT fixes): Finance verifies Reimburse receipts in **Antrian Transfer**
    (per receipt Valid/Tolak, flags reviewed, "Verifikasi semua nota"); "Profil & tanda tangan" linked for every
    panel role incl. Owner; hint above "Baris item" for the Payload 3.90.1 row race.
  - **F2e — DONE** (merged `e9c07ab`, UAT fixes): "Diketahui" **delegated** to an eligible Owner, else Admin, when
    the PM / cost-center manager is a requester/creator or missing (user decision 2026-09-24 option a; Q-07/Q-08
    edge case; architecture §5.2); resubmit shows the old number; office-only fields hidden for Staff/PM;
    operational 4xx logged at warn; Finance self-involvement guard (service + DB triggers, G17); audit actions
    `acknowledge_delegated`, `access_denied` (ADR 0006).
  - **Deployed:** staging runs image `proyekkas-web:0.1.0-stg-e9c07ab` (web + worker). **UAT seed**
    (`apps/web/src/seed/uat.ts`, env `UAT_USERS`, fictional `*.uji@proyekkas.test` accounts, project `UJI-PRJ`)
    run on staging 2026-09-24. **UAT E2E (Playwright) runs 1–4** — run 4: 56 PASS, 2 FAIL (1.3b by design Q-04;
    5.2 409 instead of 403, refused either way), 1 NOT TESTABLE (4.2) — `uat/f2-uat-report.md`.
  - **F2 acceptance gate — evidence** (awaiting user gate approval):

    | Gate item | Evidence |
    |---|---|
    | Seed form reproduces `228/PB-DRMS/20/IX/2026`, Rp 1.447.500, flags (Rp 124, dates, BBM "bulan") | `tests/integration/form-228.int.test.ts`; UAT run 4 scenario 1 (Rp 1.447.500, Rp 124 and "bulan" flags; date flag by design, Q-04) |
    | PDF reviewed by user | layout **approved by the user 2026-09-24** (receipts on separate pages, 2 per page; logo pending Q-32); printed in UAT run 4 (1.10) |
    | Full negative-authz suite (§7.4) green | `tests/integration/{authz,f2-authz-db,f2c-requester-web,f2d-finance-receipts,f2e-uat-fixes}.int.test.ts`; UAT run 4 scenario 5 |
    | Every §8 event in audit with old→new | `tests/integration/audit.int.test.ts` + flow suites; `acknowledge_delegated` / `access_denied` in `f2e-uat-fixes.int`; Riwayat in UAT run 4 (1.11, 4.1) |
    | Closed period rejects postings at DB level | `tests/integration/f2-authz-db.int.test.ts` (raw SQL as the app role; ADR 0005) |
    | PDF render peak RSS measured | ≈ 138 MiB isolated, 149 MiB web cgroup after 3 renders (ADR 0008) |

  - **Carried over (not blocking the gate, proposed):** the F6 backlog below, plus "5.2 409 vs 403 wording"
    (state check answers before the G1 guard) and an "Admin Uji" test account for the delegation UAT (step 4.2).
  - **F2 acceptance gate: READY FOR GATE** (user decision pending).
- **Dependencies:** F1 gate.
- **Agents / estimate:** nextjs-developer 26–36 pd · qa-security 7–9 pd · analyst 1–2 pd · docs 1–2 pd →
  **35–49 pd**.
- **Acceptance gate:** seed client form reproduces `228/PB-DRMS/20/IX/2026`, grand total **Rp 1.447.500**,
  flags (hotel diff 124 vs tolerance, receipts dated 21/09 after 20/09, BBM unit "bulan"); PDF reviewed by
  user; full negative-authz suite (§7.4 architecture) green; every §8 event appears in audit with old→new;
  closed period rejects postings at DB level; PDF render peak RSS measured.

### F3 — Web dashboards, reports, exports
- **Scope:** role dashboards (Owner, Finance, PM; Staff optional) as admin custom views — **prototype not
  available**: layouts proposed by analyst from US-27/28/12/13 and approved by user before build; cash
  recap per category/project/period, balances per account, budget disbursed vs realised, requests report,
  global audit log with filters; CSV/XLSX (library decision — architecture §9.4) and PDF exports.
- **Dependencies:** F2 (data), user approval of dashboard wireframes.
- **Agents / estimate:** nextjs-developer 14–20 pd · analyst 2–3 pd (wireframes, KPI definitions) ·
  qa 3–4 pd · docs 1 pd → **20–28 pd**.
- **Acceptance gate:** numbers reconcile with ledger SQL on seed + generated data; exports open in Excel
  (id-ID locale) correctly; PM sees only team projects.

### F4 — Android APK (Flutter)
- **Scope:** login (AppAuth/PKCE, ADR 0003/0010), device registration, role home screens, expense
  requests with lines + camera receipts (device compression), owner approval inbox with signature,
  receipts/LPJ, notifications (FCM, ADR 0011), offline queue for attendance + drafts (ADR 0010), mock
  location & root detection, signed release APK in CI. Backend: `/api/v1/sync/batch`, idempotency,
  files endpoint, min-version check.
- **Dependencies:** F2 API stable (v1 contract frozen for these endpoints); ADR 0010/0011 accepted;
  Firebase project (client/Google account) available.
- **Agents / estimate:** flutter-developer 30–42 pd · nextjs-developer 5–8 pd · qa-security 6–8 pd ·
  docs 1–2 pd → **42–60 pd**.
- **Acceptance gate:** E2E on physical Android device(s) against staging: create → approve (owner on
  phone) → transfer (web) → receipts → LPJ; offline check-in synced with "offline" flag and server time;
  revoked device blocked ≤ 1 request; APK signed; no secrets in APK (static scan).
- **Update 2026-09-25 (Analyst):** F4b is merged to `develop` (`e7e997a`, phone-test fixes `8712964`); the physical-phone
  gate is still pending. Go-live scope, sprints and the approval-flow change are planned in
  `plans/fase1-golive.md` (DRAFT for GATE 1) and ADR 0013 (proposed).
- **Status (2026-09-25, branch `feat/f4b-mobile-completion`, not merged — superseded by the update above):** gap analysis and remaining work in
  `docs/proyekkas/f4/f4-gap-analysis.md`; phone test script `docs/proyekkas/f4/f4-e2e-scenario.md`. Built in F4b:
  explicit 401 `DEVICE_REVOKED` + forced logout, device integrity flags, requester receipts/LPJ and transfer status on
  the phone, in-app notifications, minimal attendance check-in/out (offline, behind a company setting), APK secret
  scan in CI. Blocked: FCM push (Firebase project, Q-44). Gate test on a physical phone pending (needs a staging
  redeploy with 3 additive migrations).

### F5 — Project, progress, attendance, reports
- **Scope:** projects & stages (weights = 100 %, templates, archive), progress reports (≤ 5 photos,
  edit ≤ 24 h), progress vs budget colours, budget addenda (T12), team assignments, attendance (geofence
  server check, selfie, PM on-behalf, corrections T10, monthly recap, work schedules/holidays), late-report
  reminders, vehicle cost report; APK screens for these.
- **Dependencies:** F4 (APK base), F1 masters.
- **Agents / estimate:** nextjs-developer 14–20 pd · flutter-developer 10–15 pd · qa 5–6 pd · docs 1 pd →
  **30–42 pd**.
- **Acceptance gate:** US-01, 02, 09–16, 18, 29–31 criteria pass; geofence rejects outside radius and
  mock location; progress % only changes via reports (audit shows before→after).

### MC — Multi-company (several PTs in one deployment) — BEFORE go-live

> **Added 2026-09-27 (Analyst, ADR 0016; design approved by the user 2026-09-27).** New requirement: several PTs of the
> client group in one ProyekKas, one login per person, per-PT role matrix, full consolidation of lists/inbox/
> dashboards/reports, mutations always within one PT. Runs **before** the Fase 1 sprint S4 (client UAT, prod import,
> cut-over, `v1.0.0`; `plans/fase1-golive.md` §5) because prod has no data yet. Requirements `requirements-v1.2.md`
> (US-MC-01…19), client questions Q-51…Q-61, wireframes `mc/wireframes.md`, code inventory `mc/impact-inventory.md`.

- **MC0 — Analysis gate:** ADR 0016 + revisions of ADR 0003/0005/0007/0009/0010/0013, requirements v1.2, open
  questions §L, wireframes, impact inventory, traceability rows (this branch `docs/mc0-multi-company`).
  **Gate:** user accepts ADR 0016 (incl. Analyst additions `groupAdmin`, global vehicle plate, TZ = process TZ);
  client answers to Q-51/Q-52/Q-54/Q-59/Q-60 are wanted before MC1 seeds, not before MC1 code.
- **MC1 — Web foundation:** `companies`, `company-memberships`, `company_id` on every per-PT table, backfill of staging
  to company #1 DRMS, composite uniques, per-PT numbering counters and `pk_cash_lock_date(company_id)`, cross-PT
  triggers, access context (cookie/header ∩ memberships, `hasRole(req, role, companyId)`, per-PT `byRole`,
  per-PT `resolveScope`), Keycloak `pk-user` (realm role via infra) + removal of role sync and of token ∩ DB,
  **isolation test suite** (every per-PT collection + every `/api/v1` route with ids, 404 across PTs).
  **Gate:** isolation suite green; existing suites green on a two-PT fixture; migration up/down on a staging copy
  with row counts and balances equal before/after (US-MC-19).
  > **Status 2026-09-28 (branch `feat/mc1-foundation`): MC1 implemented** — progress log `mc/mc1-progress.md`.
  > MC1-1…MC1-6 done: companies, memberships, app-wide global, `groupAdmin`, `pk-user` login (legacy transition),
  > `company_id NOT NULL` + per-PT uniques on 30 tables, per-PT access (`byRole`, scope, decision guards), cross-PT
  > triggers, per-PT lock date and numbering, isolation suite `mc-isolation.int.test.ts`; migrations verified on a
  > develop-head copy (counts/sums identical, down/up). **Infra request open:** realm role `pk-user` in `drms` /
  > `drms-staging` assigned to every ProyekKas user (T-MC1-kc). Deviations: ADR 0016 "Implementation notes (MC1)".
- **MC2 — Domain, reports, admin UI:** approval holders/notifications/queues per PT (ADR 0013 revision), jobs per PT,
  `ReportScope` per company + company predicates in all raw SQL, consolidated dashboards/reports/exports with PT
  breakdown + totals, letterheads per PT / group, admin: company master, role matrix, employee ↔ PT mapping, PT
  switcher in the module bar, `PT` column + filter in list views, import workbook with `kode_pt`.
  **Gate:** KPI reconciliation per PT and Σ PT = total (extends `f3-kpi-reconciliation`); US-MC-06…13, 15, 16, 18
  pass; browser check of switcher/matrix/consolidated screens at 1440 px and 390 px.
  > **Status 2026-09-28 (branch `feat/mc2-integration` = `feat/mc2-backend` + `feat/mc2-admin-ui`): MC2 implemented** —
  > progress log `mc/mc2-progress.md` (§Integration). Domain / reports / jobs / media / sync per PT, admin UI (switcher,
  > company master, role matrix with atomic batch save, PT columns/filters, per-PT Kas + Tutup buku, Absensi PT filter,
  > dashboard per-PT rows) and import `kode_pt`; every `TODO(mc2-contract)` closed. Gate evidence: Σ per PT = total
  > (`mc2-isolation`, `mc2-integration`), isolation suites `mc-isolation` / `mc2-isolation` / `mc2-import` /
  > `mc2-integration` green, visual check 1440 + 390 px light/dark. Moved on: "copy defaults from DRMS" on PT create
  > (MC3/MC4 admin action), media-access performance with 3 PTs (MC4), `/me companies[]` + APK (MC3).
- **MC3 — API + APK:** `X-Company-Ids`, `/me` `companies[]`, OpenAPI regenerated (`packages/api-contract`), APK PT
  switcher, per-PT capabilities, drift schema v3 (`companyId` on drafts/outbox/progress), per-PT master caches, sync per
  PT (`COMPANY_MISMATCH`). **Gate:** Flutter unit/widget tests + mock-backend flow with two PTs; phone test on staging
  (create in CS1, approve in DRMS, offline draft in each PT synced to its own PT).
- **MC4 — QA + staging UAT:** security review (IDOR, header spoofing, raw SQL, SYSTEM-READ inventory), ZAP rerun, load
  test with 3 PTs (E9 targets), restore drill unchanged, staging UAT with a fictional second PT (`CS1`), user guides
  (Admin: PT + role matrix; all roles: PT switcher), runbook import updated, CHANGELOG/version.
  **Gate:** 0 HIGH/CRITICAL; UAT MC scripts pass; user approves → Fase 1 S4 continues.
- **Dependencies:** develop `74cf7f2` (Fase 1 S0–S3 merged); infra-engineer for the `pk-user` realm role
  (`drms`, `drms-staging`); client answers §L for seeds/import (not for code).
- **Agents / estimate (ESTIMATE, pd):**

  | Work package | Agent | pd | Sub-phase |
  |---|---|---|---|
  | Analysis, ADRs, requirements, wireframes, inventory, gate follow-up | analyst | 3–5 | MC0 |
  | Data model + migration/backfill (collections, `company_id`, composite uniques, counters, lock date, cross-PT triggers) | nextjs-developer | 7–10 | MC1 |
  | Access layer (context, `hasRole`/`byRole`/`resolveScope` per PT, SYSTEM-READ review, create/update company checks) | nextjs-developer | 7–10 | MC1 |
  | Auth / Keycloak (`pk-user`, callback + bearer strategy, users-sync) | nextjs-developer + infra-engineer | 2–3 | MC1 |
  | Domain (approval holders, notifications, queues, numbering/closing callers, jobs per PT, attendance/progress/addendum) | nextjs-developer | 6–9 | MC2 |
  | Reports/KPI + consolidation + exports/PDF letterheads | nextjs-developer | 8–12 | MC2 |
  | Admin UI (company master, role matrix, employee ↔ PT, PT switcher, PT columns/filters, import workbook) | nextjs-developer | 7–10 | MC2 |
  | API + OpenAPI (`X-Company-Ids`, `/me`, sync, period-closing params) | nextjs-developer | 2–3 | MC3 |
  | Mobile (switcher, capabilities per PT, drift v3, caches, sync per PT, tests) | flutter-developer | 8–12 | MC3 |
  | QA-security (isolation suite MC1 3–4, domain/report tests MC2 2–3, APK/API MC3 1–2, review + UAT MC4 2) | qa-security | 8–11 | MC1–MC4 |
  | Deploy (staging migration, Keycloak role rollout) + docs (guides, runbooks, CHANGELOG) | infra-engineer + docs-versioning | 2–3 | MC4 |

  → nextjs-developer 37–54 · flutter-developer 8–12 · qa-security 8–11 · analyst 3–5 · infra/auth + deploy/docs 4–6
  (auth/Keycloak 2–3 shared with nextjs, deploy+docs 2–3) → **60–88 pd**
  (per sub-phase: MC0 3–5 · MC1 19–27 · MC2 23–34 · MC3 11–17 · MC4 4–5).
- **Calendar / go-live shift:** with two web tracks (data+access, then domain/reports and admin UI), one APK track
  (starts once `/me` and the header are fixed in MC1) and QA in parallel, **≈ 4–6 calendar weeks** (ESTIMATE) are
  added before Fase 1 S4 → go-live moves by the same amount (plus client latency on §L answers for the import).
- **Acceptance gate (MC overall):** US-MC-01…19 criteria pass; isolation suite in CI; no cross-PT row possible at DB
  level (trigger tests); per-PT numbering concurrency test (2 PTs × 50 parallel); consolidated numbers reconcile;
  APK two-PT phone test; user approval.

### F6 — Hardening & release
- **Scope:** security review (OWASP ASVS L1 basics), ZAP baseline on staging, load test (≈ 30 concurrent
  field users + 5 office users, ESTIMATE target) with RAM re-measurement, backup + restore drill (DB +
  media), hash-chain decision (ADR 0006 §5), user guides per role (Bahasa Indonesia), deploy & ops
  runbooks, UAT checklist per user story, go-live data migration (opening balances, sequence start values),
  OCR receipts (nice-to-have, only if time allows).
- **Backlog carried in (2026-09-24):** server-side 302 to `/admin/login` for unauthenticated admin routes
  (today Payload renders a 200 shell that leaks only page titles, no data); settlement reversal (void of
  refund KM / shortfall transfer currently 409); signed/time-limited media URLs (ADR 0004 §4); prod compose
  + GHCR push/deploy jobs; container uid not mapped to a host user for prod secrets; `PUSH_FCM_ENABLED` in
  the env schema (F4) (**done in F4b**: refused while `true` until the FCM dispatcher exists); ~~self-involvement guard for Finance receipt verification~~ (**done in F2e**, architecture
  §5.5 G17); Payload 3.90.1
  admin form-state race (adding an array row while a form-state request is pending leaves a skeleton row —
  file upstream issue; UI hint added in F2d); **5.2 409 vs 403 wording** (a requester's `approve` on a request in
  "Menunggu Diketahui" answers 409 from the state check before the G1 403 — refused either way, UAT run 4);
  **"Admin Uji" test account** for the delegated-acknowledge UAT step 4.2 (the only staging Admin is the user's).
- **Backlog carried in (2026-09-25):** **decide prod mobile login mode** — staging uses the in-app password
  login (`PK_LOGIN_MODE=password`, Keycloak Direct Access Grants, ADR 0012, user decision 2026-09-25); prod
  (`config/prod.json`, realm `drms`) stays `browser` (Custom Tab, ADR 0003) until this is decided with the user,
  taking the staging field results and the Custom Tab process-death loop into account.
- **Dependencies:** F2–F5.
- **Agents / estimate:** qa-security 6–9 pd · nextjs-developer 4–6 pd · flutter-developer 2–3 pd ·
  docs-versioning 4–6 pd · infra-engineer 1–2 pd · analyst 1–2 pd → **18–28 pd**.
- **Acceptance gate:** no open HIGH/CRITICAL; restore drill within RTO (platform ADR 0006: ≤ 4 h per
  client); RAM within ADR 0002 limits under load or approved revision; UAT signed by client.

### F7 — Odoo mirror (after go-live)
- **Scope:** per ADR 0009 (outbox → worker → Odoo 19 JSON-2 API), mapping of masters, ledger rows
  (ADR 0005 hints), expenses, projects/analytics, attendance; reconciliation report; cut-over plan.
- **Dependencies:** F6; Odoo DB for DRMS provisioned (`drms_prod` in pool — infra); ADR 0009 accepted.
- **Agents / estimate:** nextjs-developer 8–12 pd · odoo-developer 6–10 pd · qa 3–4 pd · analyst 2 pd ·
  docs 1 pd → **20–29 pd**.
- **Acceptance gate:** idempotent re-sync; mirrored balances equal ProyekKas balances per period;
  no writes from Odoo back (one-way).

## Totals (ESTIMATE)

| Phase | pd (range) |
|---|---|
| F0 | 3–4 |
| F1 | 29–42 |
| F2 | 35–49 |
| F3 | 20–28 |
| F4 | 42–60 |
| F5 | 30–42 |
| **MC** (multi-company, added 2026-09-27, before go-live) | **60–88** |
| F6 | 18–28 |
| F7 | 20–29 |
| **Total** | **257–370** (was 197–282 before MC) |

Parallelism: F3 (web) and F4 (APK) can overlap once F2's API is frozen; F5 backend can start during F4.
MC: the APK track (MC3) can start once the MC1 access contract (`X-Company-Ids`, `/me` `companies[]`) is fixed; MC2
reports and admin UI run in parallel on two web tracks after the MC1 data model is merged.

## Task dependency graph (for parallel delegation)

| Task | Agent | depends_on | Files/dirs touched |
|---|---|---|---|
| T-F1-infra-realm | infra-engineer | F0 gate | `/opt/infra/identity/keycloak/realm-export/drms*.json` |
| T-F1-infra-db | infra-engineer | F0 gate | `/opt/infra/postgres/{conf/pg_hba.conf,scripts/*}` |
| T-F1-infra-traefik | infra-engineer | F0 gate, hostnames | `/opt/infra/traefik/dynamic/{clients,middlewares,platform/auth.yml}` |
| T-F1-infra-backup | infra-engineer | T-F1-infra-db | `/opt/infra/scripts/{backup.sh,lib/restic-common.sh}` |
| T-F1-spikes | nextjs-developer | T-F1-infra-realm, T-F1-infra-db | `apps/web/**` |
| T-F1-foundation | nextjs-developer | T-F1-spikes | `apps/web/**`, `deploy/**`, `.github/**` |
| T-F1-qa | qa-security | T-F1-foundation | `apps/web/tests/**`, Semgrep rules |
| T-F2-flow | nextjs-developer | F1 gate | `apps/web/src/{collections,domain,api}/**` |
| T-F2-pdf | nextjs-developer | T-F2-flow (data model) | `apps/web/src/pdf/**` |
| T-F3-dash | nextjs-developer | F2 gate, wireframes | `apps/web/src/admin/**` |
| T-F4-apk | flutter-developer | F2 API freeze, ADR 0010/0011 | `apps/mobile/**` |
| T-F4-sync-api | nextjs-developer | ADR 0010 | `apps/web/src/api/v1/sync/**` |
| T-F5-* | nextjs + flutter | F4 base | both apps |
| T-MC1-model | nextjs-developer | MC0 gate | `apps/web/src/{collections,globals,migrations,domain/numbering*,seed}/**` |
| T-MC1-access | nextjs-developer | T-MC1-model | `apps/web/src/{access,auth}/**`, `app/(auth)/**`, `domain/users-sync.ts` |
| T-MC1-kc | infra-engineer | MC0 gate | `/opt/infra/identity/keycloak/realm-export/drms*.json` (realm role `pk-user`) |
| T-MC1-qa | qa-security | T-MC1-access | `apps/web/tests/integration/mc-*.int.test.ts`, `.semgrep/proyekkas.yml` |
| T-MC2-domain | nextjs-developer | T-MC1-access | `apps/web/src/{domain,jobs}/**` |
| T-MC2-reports | nextjs-developer | T-MC1-access | `apps/web/src/{domain/reports,pdf}/**`, `admin/views/{Dashboard,Reports}.tsx` |
| T-MC2-admin | nextjs-developer | T-MC1-model | `apps/web/src/admin/**`, `apps/web/src/import/**` |
| T-MC3-api | nextjs-developer | T-MC1-access | `apps/web/src/api/v1/**`, `packages/api-contract/**` |
| T-MC3-apk | flutter-developer | T-MC3-api (contract) | `apps/mobile/**` |
| T-MC4-qa-uat | qa-security + docs-versioning | T-MC2-*, T-MC3-* | `docs/proyekkas/{qa,uat,guides,runbooks}/**`, `CHANGELOG.md` |
| T-F7-mirror | nextjs + odoo-developer | F6, ADR 0009 | `apps/web/src/jobs/odoo/**`, odoo addon repo (if any) |

## Top risks (overall)

| # | Risk | Likelihood / impact | Mitigation | Owner |
|---|---|---|---|---|
| 1 | **Payload OIDC-only auth / admin integration** or append-only writes behave differently than read in source (e.g. hidden UPDATE/DELETE, admin needs local strategy) | M / H | F1 spike week as go/no-go; fallback custom Next.js admin (ADR 0001 Rollback) decided before F2 | nextjs-dev + analyst |
| 2 | **RAM budget**: ProyekKas ≈ 57 % of the platform's remaining 2.5 GiB (steady, ESTIMATE); real Payload footprint unknown | M / H | measure in F1 and F6; ordered reduction steps (ADR 0002 §6); escalate to user per platform ADR 0004 | analyst + infra |
| 3 | **Scope & ambiguity**: prototype missing, many open client questions (approval rules, reset policy, retention, dashboards), 197–282 pd | H / M | gate-by-gate delivery; wireframe approval before F3; defer OCR and optional roles | Lead |
| 4 | **Offline sync & trust** (APK): conflicts, replay, clock/GPS spoofing | M / H | server-side state machine on replay, idempotency keys, device time only as comparison, mock detection (ADR 0010) | flutter + nextjs + qa |
| 5 | **Shared-infra changes** (Keycloak realm + token rate limit, Traefik middlewares, pg_hba, backup script, `infra-deploy`) can collide with the platform session or other clients | M / M | changes as separate infra tasks with their own review, staging first, coordination note to infra session; ProyekKas never edits `/opt/infra` directly | infra-engineer |
| 6 | Payload 4 major (canary exists) shortens 3.x support | L–M / M | pin 3.90.1, monthly minors via staging; evaluate 4.x only after GA + guide (new ADR) | nextjs-dev |
| 7 | Excel export library lacks a maintained MIT/Apache option on npm | M / L | CSV baseline; fresh evaluation in F3 | nextjs-dev |
| 8 | **Multi-company isolation (ADR 0016)**: a missed company predicate (233 raw `sql` fragments, 199 `overrideAccess: true` SYSTEM-READs) or a role check against the wrong PT leaks or changes another PT's data; migration/backfill errors on staging; go-live shifts ≈ 4–6 weeks | M / H | DB `company_id NOT NULL` + cross-PT triggers + composite uniques; isolation test suite per collection/route in CI; Semgrep rule for raw SQL without company helper; SYSTEM-READ inventory reviewed by qa-security (MC4); migration rehearsed on a staging copy with row-count/balance reconciliation; done before go-live (no prod data) | nextjs-dev + qa-security |

## Items requiring user/Lead decision before F1
1. ~~DB rename~~ — **accepted by user 2026-09-23:** `pk_drms` / `pk_drms_stg`.
2. ~~Hostnames~~ — **user 2026-09-23: platform subdomain** → `drms-kas.bimacreative.tech` (new manual A record) / `drms-kas.staging.bimacreative.tech`.
3. ~~Numbering~~ — user 2026-09-23: PB never resets, go-live `startAt` 229.
4. ~~Receipt originals~~ — user 2026-09-23: discard after resize (2000 px), keep sha256 fingerprint.
5. ~~APK offline session~~ — user 2026-09-23: 14 days. Reimburse auto-close days: still default per ADR.
7. Shared-infra coordination with the infra session — **approved by user 2026-09-23**.
6. ~~flutter-developer agent definition~~ — done: `.claude/agents/flutter-developer.md` in this repo (ADR 0010).
