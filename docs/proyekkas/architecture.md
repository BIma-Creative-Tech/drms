# ProyekKas — Architecture (Phase 0)

- **Status:** accepted (user, GATE F0 2026-09-23); revised 2026-09-23 after the F1 spike (user-approved) the F1 foundation / staging deploy and F2a; 2026-09-24 after F2b/F2c (see §17 Revision history) · **Date:** 2026-09-23 · **Author:** Analyst/Architect (Phase 0)
- **Inputs:** `f0-brief.md` (binding decisions §2, direction §3; updated 2026-09-23 with the line-total
  decision), `reference/proyekkas-kebutuhan-pengembangan.md` (requirements v1.0), `reference/prompt-lead-proyekkas.md`
  ("Temuan tambahan" 1–10), `reference/contoh-form-pengajuan-biaya-drms.jpg`, `/opt/infra/CLAUDE.md`,
  platform ADRs `/opt/infra/docs/adr/0001, 0004, 0006`, `/opt/src/control-plane/*`, `/opt/infra/{identity/keycloak,traefik,postgres,scripts}` (read-only).
- **Decisions:** ADRs in `adr/0001`–`0008` (this set). Odoo mirror = `adr/0009-*.md`, mobile/offline sync =
  `adr/0010-*.md`, push = `adr/0011-*.md` (written by another agent — referenced, not repeated).
  Requirements v1.1 (Bahasa Indonesia) is written in parallel by another agent.
- **Prototype:** `proyekkas-prototipe.html` was **not provided** → dashboard layouts are "prototype not
  available"; only the card list from requirements US-27 is used.

Legend: **UNVERIFIED** = not confirmed from a source in this session; **ESTIMATE** = sizing assumption.

---

## 0. Sources used (all fetched/read 2026-09-23)

| Id | Source |
|---|---|
| S-NPM | `https://registry.npmjs.org/<pkg>[/<version>]` for payload, @payloadcms/{next,ui,db-postgres,translations,storage-s3,plugin-cloud-storage,richtext-lexical,graphql}, graphql, sharp, @react-pdf/renderer, @react-pdf/{layout,image}, pdfkit, pdf-lib, pdfmake, exceljs, xlsx, playwright-core, puppeteer-core, jose, openid-client, pg-boss, @asteasolutions/zod-to-openapi, payload-oapi, rate-limiter-flexible, pino, @directus/api, @strapi/strapi |
| S-PL | `github.com/payloadcms/payload` tag **v3.90.1** (tag object `30f5388`): `docs/**/*.mdx`, `packages/{payload,next,drizzle,db-postgres,translations,storage-s3,plugin-cloud-storage}/src/**` (tarball from codeload.github.com) |
| S-KC | `https://www.keycloak.org/docs-api/26.7.4/rest-api/index.html`; `raw.githubusercontent.com/keycloak/keycloak/26.7.4/docs/documentation/server_admin/topics/sso-protocols/{con-server-oidc-uri-endpoints,con-oidc-auth-flows}.adoc` |
| S-SH | `raw.githubusercontent.com/lovell/sharp/v0.35.4/docs/src/content/docs/{api-output,api-resize,api-utility,api-constructor,install}.md` |
| S-TR | `raw.githubusercontent.com/traefik/traefik/v3.7/docs/content/reference/routing-configuration/http/middlewares/{buffering,ratelimit}.md`; `/opt/infra/traefik/dynamic/**` |
| S-PG | `postgresql.org/docs/16/{ddl-priv,auth-pg-hba-conf,sql-createtrigger}.html`; `/opt/infra/postgres/{conf/pg_hba.conf,scripts/init-roles.sh,docker-compose.yml}` |
| S-OD | `docker exec odoo-pool-a grep …` in `/usr/lib/python3/dist-packages/odoo/addons/{account,hr_expense,base}` (read-only) |
| S-CS | compose spec `raw.githubusercontent.com/compose-spec/compose-spec/main/05-services.md` |
| S-GH | `api.github.com/repos/<repo>` (license, pushed_at) for payloadcms/payload, directus, strapi, exceljs, pdfkit, react-pdf, gotenberg, pdf-lib; Directus `license`, Strapi `LICENSE` raw files |
| S-HOST | `docker stats --no-stream`, `free -m`, `df -h /`, `docker network ls`, `docker exec control-plane` (musl 1.2.6, Alpine 3.24.2, ICU 78.3), `/usr/local/sbin/infra-deploy`, `/opt/infra/scripts/{backup.sh,lib/restic-common.sh}`, `/opt/infra/identity/keycloak/**` |

---

## 1. Scope, principles, and where this deviates from the Lead's direction

Scope: admin web (Payload admin = CRUD "CMS" + custom views/dashboards) for Admin/Finance/Owner/PM, a
versioned REST API `/api/v1` for the Flutter APK (Staff, PM, Owner quick approval), cash control
(T1–T8), project/progress/attendance (T9–T12), audit log, reports/exports, later one-way Odoo mirror.

Principles: server is the only source of truth and time; business transitions only through the domain
service (never via generic field edits); no hard delete; every tracked change atomic with its audit row;
Odoo-friendly data (integer Rupiah, UoM master, analytic via project/cost center, COA codes);
least privilege at every layer (Traefik → strategy → access function → DB role/trigger).

**Validated** (evidence in ADR 0001): Payload 3.90.1 fits Next 16.3.6 / React 19.3.0 / Node 24; Indonesian
admin locale `id` exists; custom auth strategies + `disableLocalStrategy` + login-view injection make
Keycloak-only login feasible; Where-returning access control covers own/team/assigned/all scopes;
Jobs Queue replaces pg-boss.

**Challenged / refined with evidence:**
1. **DB names** `drms_proyekkas_prod/_staging` match the Odoo pg_hba regexes → rename to `pk_drms` /
   `pk_drms_stg` (ADR 0006 §1).
2. **Remote logout via Keycloak session revocation alone is insufficient**: APK access tokens are
   validated locally (JWKS) and stay valid ≤ 300 s → app-side `devices` revocation check on every request
   (ADR 0003 §5).
3. **Keycloak token endpoint rate limit** (`ratelimit-login` 10/min/IP on `/protocol/openid-connect/token`)
   will throttle APK refreshes behind carrier NAT → infra change needed (ADR 0003 §6).
4. **No OpenAPI in Payload 3** → contract generated from our zod schemas (§6.4).
5. **Payload generic REST exposes every collection** → Traefik strips `Authorization` on non-`/api/v1`
   paths; APK never uses `/api/<slug>` (§6.1).
6. **Backups:** media volumes are not covered by the current `backup.sh` → infra change (ADR 0004 §6).
7. **Payload 4.0.0-canary** exists → major upgrade risk tracked (ADR 0001 §9).
8. **RAM**: ProyekKas would take ≈ 57% of the remaining client budget (steady) — fits, but tight (§13).

---

## 2. Component view

```mermaid
flowchart LR
  subgraph Clients
    APK["Flutter APK<br/>(Staff, PM, Owner)<br/>offline queue - ADR 0010"]
    BR["Browser<br/>(Admin, Finance, Owner, PM)"]
  end
  subgraph Edge["Traefik v3.7.13 + CrowdSec AppSec"]
    R1["router pk-web<br/>/admin, /auth/*, /api/&lt;slug&gt;<br/>(Authorization header stripped)"]
    R2["router pk-api-v1<br/>/api/v1/*"]
  end
  subgraph App["drms-pk-web (Next.js 16.3.6 + Payload 3.90.1)"]
    ADM["Payload Admin UI (id locale)<br/>+ custom views (dashboards, approval inbox,<br/>transfer queue, LPJ verify, audit tab)"]
    AUTHR["/auth/login, /auth/callback, /auth/logout<br/>(openid-client + jose)"]
    STRAT["Auth strategies<br/>oidcSession (cookie) · mobileBearer (JWT+device)"]
    V1["/api/v1 custom endpoints<br/>zod validation · idempotency · rate limit"]
    DOM["Domain services<br/>state machines · guards · numbering ·<br/>ledger · settlement · receipt checks"]
    ACC["Access control (Where)<br/>+ field access"]
    HK["Hooks: audit diff · invariants ·<br/>media fingerprint · outbox enqueue"]
    UP["Uploads + sharp resize"]
    PDF["PDF renderer (@react-pdf)"]
  end
  subgraph Worker["drms-pk-worker"]
    JOBS["Payload Jobs: reminders, notifications,<br/>exports, odoo outbox, sweeps"]
  end
  KC["Keycloak 26.7.4<br/>realm drms / drms-staging"]
  PG[("Postgres 16.15<br/>DB pk_drms / pk_drms_stg")]
  VOL[("Volume drms_pk_media_*")]
  FCM["FCM (ADR 0011)"]
  ODOO["Odoo 19 JSON-2 API<br/>(ADR 0009, F7)"]
  RESTIC["restic backup (host)"]

  APK -->|HTTPS Bearer + X-Device-Id| R2
  BR -->|HTTPS cookie __Host-pk_session| R1
  APK -->|OIDC code+PKCE, refresh| KC
  BR -->|OIDC redirect| KC
  R1 --> ADM & AUTHR
  R2 --> V1
  ADM --> STRAT
  V1 --> STRAT --> ACC
  V1 --> DOM
  ADM --> DOM
  DOM --> ACC
  DOM --> HK
  DOM --> PDF
  UP --> VOL
  PDF --> VOL
  HK --> PG
  DOM --> PG
  AUTHR -->|code exchange, JWKS, admin REST| KC
  JOBS --> PG
  JOBS --> FCM
  JOBS --> ODOO
  KC -. back-channel logout .-> AUTHR
  RESTIC -. pg_dump + volume .-> PG & VOL
```

---

## 3. Deployment topology

### 3.1 Containers (details and limits: ADR 0002)

| Container | Env | Image target / command | Networks | mem_limit | Volumes |
|---|---|---|---|---:|---|
| `drms-pk-web` | prod | runner / `node server.js` | `proxy`, `db` | 640m | `drms_pk_media_prod:/data/media` |
| `drms-pk-worker` | prod | runner / `node dist/worker.mjs` | `db` (+ egress) | 320m | `drms_pk_media_prod:/data/media` |
| `drms-pk-migrate` | prod | migrate / `payload migrate` (one-shot) | `db` | 384m | — |
| `drms-pk-stg` | staging | runner / `node server.js` (no `autoRun`) | `drms-kas-edge`, `db`, `drms-kc-admin-stg` | 640m | `drms_pk_media_stg:/data/media` |
| `drms-pk-stg-worker` | staging | runner / `node apps/web/dist/worker.mjs` | `drms-kas-edge`, `db`, `drms-kc-admin-stg` | 320m | `drms_pk_media_stg:/data/media` |
| `drms-pk-stg-migrate` | staging | migrate (one-shot, owner role) | `db` | 384m | — |
| `drms-pk-stg-seed` | staging | migrate image / `payload run src/seed/index.ts` (profile `seed`, one-shot, app role) | `db` | 384m | `drms_pk_media_stg:/data/media` |

> **Staging as deployed (F1 foundation, 2026-09-23):** live at `https://drms-kas.staging.bimacreative.tech`,
> compose `deploy/staging/docker-compose.yml` installed by the infra Lead at `/opt/infra/staging/drms-proyekkas/`.
> Web and worker are separate (like prod); DB pools web 5 + worker 3 + seed 2 ≤ `pk_drms_stg_app` CONNECTION
> LIMIT 10 (pool 1 deadlocks). Images built locally on the VPS until GHCR (`TEMPORARY`). Measured idle: web
> 82 MiB, worker 47 MiB. Upgrade/rollback by image tag in `.env`. Details: ADR 0002 §7. Prod rows above
> are still the plan; prod web/worker will join `drms-kas-edge` + `db` + `drms-kc-admin`.

Shared (existing, not changed by ProyekKas except coordinated config): `traefik`, `crowdsec`, `postgres`,
`keycloak`. Hardening per ADR 0002 §2 (read-only rootfs, tmpfs, uid 1001, cap_drop ALL,
no-new-privileges, healthchecks, json-file 10m×3).

```mermaid
flowchart TB
  Internet((Internet)) -->|443| T["traefik"]
  subgraph proxy["network: proxy (external)"]
    T
    KC["keycloak:8080"]
    W["drms-pk-web:3000"]
    S["drms-pk-stg:3000"]
  end
  subgraph db["network: db (external, 10.100.1.0/24)"]
    PG[("postgres:5432<br/>pk_drms, pk_drms_stg")]
    WK["drms-pk-worker"]
    M1["drms-pk-migrate (one-shot)"]
    M2["drms-pk-stg-migrate (one-shot)"]
  end
  T -->|Host prod, file provider| W
  T -->|Host staging| S
  T --> KC
  W --> PG
  S --> PG
  WK --> PG
  M1 --> PG
  M2 --> PG
  W -->|internal http| KC
  S -->|internal http| KC
  W --- VP[("drms_pk_media_prod")]
  WK --- VP
  S --- VS[("drms_pk_media_stg")]
```
(`drms-pk-web` and `drms-pk-stg` are attached to both `proxy` and `db`.)

> **Revised 2026-09-23 (infra live, F1):** the web containers join **`drms-kas-edge`** (`10.100.7.0/24`,
> gw `10.100.7.1`; members: `traefik` + ProyekKas web only) instead of `proxy`, and they do **not** call
> `keycloak:8080`: all server-side OIDC/JWKS/Admin REST calls go to the public issuer
> `https://auth.bimacreative.tech` (hairpin through Traefik). In the diagram read `proxy` as `drms-kas-edge`
> for `W`/`S`, and the `internal http` edges as `https via traefik`. Source: infra runbook
> `/opt/infra/docs/runbooks/proyekkas-drms-onboarding.md` (infra `main` `c557c28`); ADR 0003 §6.
> **Since infra H5 (F1 foundation):** web and worker also join the `--internal` network
> `drms-kc-admin[-stg]`, where Traefik carries the alias `auth.bimacreative.tech`; the Keycloak Admin API is
> reachable only that way (router `ClientIP(subnet) && PathPrefix(/admin/realms/<realm>/)`); public-hairpin
> `/admin*` is 403 platform-wide. The diagram also omits the staging worker (`drms-pk-stg-worker`).

### 3.2 Hostnames (decided by user 2026-09-23: platform subdomain)
- prod: `drms-kas.bimacreative.tech` — needs ONE new manual A record → `31.97.50.221` at Hostinger (not covered by
  any wildcard; verified `dig` 2026-09-23: `*.erp`, `*.staging` exist, bare/`*.app` do not).
- staging: `drms-kas.staging.bimacreative.tech` — covered by existing `*.staging` wildcard.
- `drms.erp.bimacreative.tech` / `drms.staging.bimacreative.tech` stay reserved for DRMS's future Odoo DBs (F7). DNS pre-check + `le-http-staging`
first, per CLAUDE.md §3.5.1. APK App Link host = prod host (ADR 0003/0010).

### 3.3 Traefik routes (file provider `/opt/infra/traefik/dynamic/clients/drms-proyekkas-{prod,staging}.yml`; pseudo-config, infra-engineer finalises)

**Live state (staging, infra `main` `c557c28`, verified by Lead 2026-09-23)** — supersedes the F0 table below
where they differ (`/opt/infra/traefik/dynamic/clients/drms-proyekkas-{staging,middlewares,kc-token}.yml`):

| Router | Rule (host `drms-kas.staging.bimacreative.tech`) | Middlewares | Priority |
|---|---|---|---|
| `drms-pk-stg-auth` | `PathPrefix(/auth/) \|\| PathPrefix(/api/v1/auth/)` | `crowdsec`, `security-headers`, `ratelimit-login` | 100 |
| `drms-pk-stg-api-v1` | `PathPrefix(/api/v1/)` (Authorization passed through) | `crowdsec`, `security-headers`, `ratelimit-pk-api` (20/s, burst 40), `buffering-pk` | 90 |
| `drms-pk-stg-api-rest` | `PathPrefix(/api/) && !PathPrefix(/api/v1/)` (Payload generic REST, admin uploads) | `crowdsec`, `security-headers`, `ratelimit-default`, `strip-authorization`, `buffering-pk` | 50 |
| `drms-pk-stg-web` | catch-all (`/admin`, Next assets, `/.well-known/assetlinks.json`) | `crowdsec`, `security-headers`, `ratelimit-default`, `strip-authorization` — **no buffering** | 1 |
| `auth-drms-token` (host `auth.bimacreative.tech`) | `Path(/realms/{drms,drms-staging}/protocol/openid-connect/token)` | `crowdsec`, `auth-security-headers`, `ratelimit-drms-kc-token` (60/min, burst 30) | 95 |

`buffering-pk` = `maxRequestBodyBytes` 10 485 760 (10 MiB) and `maxResponseBodyBytes` 16 777 216 (16 MiB), only on
`api-v1` and `api-rest` (a larger response there → 500; the `web` router is not buffered). Certificate
`le-http-staging` until the switch to `le-http`. Prod routers are added once the prod A record exists.

| Router | Rule | Middlewares (existing unless marked NEW) | Priority |
|---|---|---|---|
| `pk-auth` | `Host(<pk-host>) && (PathPrefix(/auth/) \|\| PathPrefix(/api/v1/auth/))` | `crowdsec`, `security-headers`, `ratelimit-login` | 100 |
| `pk-api-v1` | `Host && PathPrefix(/api/v1/)` | `crowdsec`, `security-headers`, **NEW `ratelimit-pk-api`** (avg 20/s, burst 40 per IP — ESTIMATE), **NEW `buffering-pk`** (`maxRequestBodyBytes` 10 485 760; option verified S-TR) | 90 |
| `pk-web` | `Host(<pk-host>)` | `crowdsec`, `security-headers`, `ratelimit-default`, **NEW `strip-authorization`** (`headers.customRequestHeaders: {Authorization: ""}` — "" removes, pattern already used in `strip-odoo-db-headers.yml`), `buffering-pk` | 1 |
| Keycloak (existing `auth.yml`) | — | **NEW router for `/realms/drms/protocol/openid-connect/token`** with a higher limit (ADR 0003 §6) | — |

`security-headers` sets `frameDeny: true`: Payload admin live preview/iframes are not used → OK. CSP is
set by the app (per-request nonce in `apps/web/src/proxy.ts`, builder `src/lib/csp.ts`), not by Traefik.

**Admin CSP (verified F1 spike §f; user decision 2026-09-23)** — `PK_CSP_MODE=payload`, `PK_CSP_STRICT_DYNAMIC=false` (defaults):
```
default-src 'self'; script-src 'self' 'nonce-{n}'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:;
font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self';
form-action 'self' https://auth.bimacreative.tech; frame-ancestors 'none'
```
- **Scripts stay nonce-strict**, **no `'strict-dynamic'`** (it would let Monaco's JS from `cdn.jsdelivr.net` run).
  The strict variant produced 0 `script-src` violations.
- **`style-src 'unsafe-inline'` accepted** (styles only, no script execution): Payload/react-select inject
  runtime `<style>` and `style=` attributes (123–135 `style-src-attr` + 47 `style-src-elem` violations under a
  nonce-only style policy → visibly broken admin). No nonce in `style-src` (it would disable `'unsafe-inline'`).
- **`form-action` includes the Keycloak origin** `https://auth.bimacreative.tech`; without it the logout
  303 to Keycloak is blocked.
- Required alongside: **no `json`/`code` field editors** in the admin (Monaco loads from jsdelivr; user
  decision) and `admin.avatar: 'default'` (no gravatar) — ADR 0001 §8.

### 3.4 Volumes & data
Named volumes `drms_pk_media_prod`, `drms_pk_media_stg` (ADR 0004). DBs in shared cluster (ADR 0006 §1).
Backups: DB via existing dynamic dump; media via NEW `MEDIA_VOLUMES` entry in `backup.sh` (§15).

**Seed data (F1 foundation, `apps/web/src/seed/`):** the repo ships only a **fictional default dataset**
(`DEFAULT_SEED_DATA` in `data.ts`). Real client master data is loaded **at deploy time** from an untracked
JSON file named by `SEED_DATA_FILE` (same shape, strict schema validation; never committed — on staging it
would be a Compose secret file, see the compose comments). The seed is idempotent: each record is looked up
by its natural key and only created when missing — **existing rows are never overwritten** (company settings:
only empty fields are filled). It runs as the app role through the Local API (audit `source=system`).
Optional first admin link: `SEED_ADMIN_EMAIL` + `SEED_ADMIN_KEYCLOAK_SUB` (ADR 0003 §2).

---

## 4. Data model

### 4.1 Conventions
- **Money = integer Rupiah** in Payload `number` fields (→ Postgres `numeric`, JS double; S-PL
  `traverseFields.ts` L744–751), validated `Number.isSafeInteger(v) && v >= 0` (negative only where
  semantically signed, e.g. `difference`). Odoo IDR rounding 0.01 (S-OD) → lossless mapping. Display
  `Rp 1.447.500`.
- **Quantities** `number` with ≤ 3 decimals (e.g. 24,80 L) validated; unit from **`uoms`** master (no free text).
- **Line totals (user decision 2026-09-23):** on expense-request lines **`total` is the primary, user-entered
  value** (may be user-rounded from the receipt, e.g. hotel 676.876 → 677.000 for 2 rooms). `unitPrice` is
  **informational/display only** (nullable; if empty the UI shows `total ÷ qty`). The server **must not
  enforce** `qty × unitPrice = total`. `grandTotal` = Σ line `total`, **server-computed** (client value
  ignored). Seed: 600.000 + 677.000 + 170.500 = **Rp 1.447.500**. Receipt-vs-line differences
  (677.000 − 676.876 = 124) are **flags** evaluated against `company-settings.receiptRoundingTolerance`,
  never blockers.
- **Analytic dimension**: every cost document references **`project` XOR `costCenter`** (form item 9:
  "Ops Palangka Banjar" is not a project). Both carry `odooAnalyticRef` for ADR 0009.
- **COA mapping**: `expense-categories.coaCode`, `cash-in-sources.coaCode`, `cash-accounts.odooJournalCode`.
- IDs: `idType: 'serial'` (explicit) as internal PK/FK. **Every mirrored collection also has `uuid`**
  (UUID, unique, immutable, server-generated at create) — the stable identity for the Odoo external ID
  required by ADR 0009 (`pk_<slug>_<uuid_hex>`), plus `odooId`/`odooXmlid` columns owned by ADR 0009.
  APK-created records additionally carry `clientUuid` (unique, nullable) = offline idempotency key (ADR 0010
  `client_uuid`). ERD below omits `uuid`/`odoo*` columns for readability.
- Timestamps: server `timestamptz` (UTC); business dates `date` in company TZ (`Asia/Makassar`); device
  times stored only as comparison fields (`deviceTime*`).
- Status fields: `select` (Postgres enum); `update` field-access = false — changed only by the domain
  service (`context.transition` + `overrideAccess: true`, see §7.4).
- No `delete` on business collections; masters have `active` (US-33: used data cannot be deleted).

### 4.2 ERD — masters

```mermaid
erDiagram
  users ||--o| employees : "linked to"
  users ||--o| media_signatures : "signature image"
  employees ||--o{ employee_bank_accounts : owns
  banks ||--o{ employee_bank_accounts : "bank of"
  clients ||--o{ projects : "client of"
  users ||--o{ projects : "PM of"
  projects ||--o{ project_stages : has
  stage_templates ||--o{ stage_template_items : contains
  projects ||--o{ budget_lines : "RAB per category"
  expense_categories ||--o{ budget_lines : category
  employees ||--o{ team_assignments : assigned
  projects ||--o{ team_assignments : staffed
  cost_centers ||--o{ vehicles : "home cost center"
  approval_rules ||--o{ approval_rule_steps : steps
  expense_categories }o--|| uoms : "default uom"

  users {
    int id PK
    string email
    string keycloakSub UK "OIDC sub"
    string rolesCache "pk-staff|pk-pm|pk-finance|pk-owner|pk-admin (mirror of token)"
    bool active
    int employee_id FK
    int signature_id FK
  }
  employees {
    int id PK
    string code UK
    string name
    string position
    string phone
    int faceRefPhoto_id FK
    bool active
  }
  employee_bank_accounts {
    int id PK
    int employee_id FK
    int bank_id FK
    string accountNo
    string accountHolder
    bool isDefault
    string verificationStatus "unverified|verified"
    bool active
  }
  banks {
    int id PK
    string code UK
    string name
  }
  clients {
    int id PK
    string name
    string contact
    string address
  }
  vendors {
    int id PK
    string name
    string contact
    string npwp
  }
  projects {
    int id PK
    string code UK
    string name
    int client_id FK
    string address
    numeric lat
    numeric lng
    int radiusM
    int pm_id FK
    int budget "RAB, integer Rupiah"
    date startDate
    date targetDate
    string status "perencanaan|berjalan|ditunda|selesai|arsip"
    string odooAnalyticRef
  }
  project_stages {
    int id PK
    int project_id FK
    string name
    numeric weightPct "sum = 100"
    int sequence
    numeric progressPct "only via progress_reports"
  }
  stage_templates {
    int id PK
    string name
  }
  stage_template_items {
    int id PK
    int template_id FK
    string name
    numeric weightPct
    int sequence
  }
  budget_lines {
    int id PK
    int project_id FK
    int category_id FK
    int amount
  }
  expense_categories {
    int id PK
    string code UK
    string name "Material|Upah|Alat|Transport|Operasional"
    string coaCode "Odoo account code"
    int defaultUom_id FK
    bool requiresVehicle
    bool active
  }
  cash_in_sources {
    int id PK
    string code
    string name "Termin|DP klien|Modal owner|Pengembalian LPJ|Lainnya"
    string coaCode
  }
  cash_accounts {
    int id PK
    string name "BCA Operasional, Kas Kecil"
    string accountNo
    string odooJournalCode
    bool active
  }
  team_assignments {
    int id PK
    int employee_id FK
    int project_id FK
    string roleInProject "pm|staff|mandor"
    date startDate
    date endDate
  }
  work_schedules {
    int id PK
    string name
    string startTime
    string endTime
    int lateToleranceMin
  }
  holidays {
    int id PK
    date date
    string name
  }
  approval_rules {
    int id PK
    string docType "expense_request|budget_addendum"
    int minAmount
    int maxAmount
    int category_id FK "optional"
    int project_id FK "optional"
    string signaturePositions "diajukan|dibuat|diketahui|approval config"
  }
  approval_rule_steps {
    int id PK
    int rule_id FK
    int level
    string position
    string approverRole
    int approverUser_id FK
  }
  notification_templates {
    int id PK
    string event
    string title
    string body
    string channel "push|inapp"
  }
  uoms {
    int id PK
    string code UK
    string name "liter|kamar|malam|porsi|bulan|pcs|trip"
    string category
    string odooUomRef
  }
  vehicles {
    int id PK
    string plateNo UK "normalised DA1234XY"
    string type "Hilux|Tronton"
    string status
    int costCenter_id FK
    string odooFleetRef
  }
  cost_centers {
    int id PK
    string code UK
    string name "Ops Palangka Banjar"
    string type "operational|department"
    bool active
    string odooAnalyticRef
  }
  document_sequences {
    int id PK
    string docType UK
    string pattern
    string resetPolicy
    int padding
    string timezone
  }
```
Global `company-settings`: name, shortCode `DRMS`, logo, timezone, default geofence radius, late-report
days (3), budget thresholds (85/100 %), progress-vs-budget colour thresholds (0/8 %), receipt rounding
tolerance (Rp), min APK version, offline max age, reimburse auto-close days.

### 4.3 ERD — transactions

```mermaid
erDiagram
  expense_requests ||--|{ expense_request_lines : "lines (array)"
  expense_requests }o--o{ employees : "requesters (Diajukan Oleh)"
  expense_requests }o--|| users : "createdBy (Dibuat Oleh)"
  expense_requests }o--o| projects : "project XOR"
  expense_requests }o--o| cost_centers : "cost center"
  expense_requests }o--|| employee_bank_accounts : "transfer to"
  expense_requests |o--o| expense_requests : "resubmitOf"
  expense_request_lines }o--|| expense_categories : category
  expense_request_lines }o--|| uoms : unit
  expense_request_lines }o--o| vehicles : vehicle
  expense_requests ||--o{ expense_line_snapshots : "frozen at submit/approve"
  expense_requests ||--o{ approvals : "sign-offs & decisions"
  budget_addenda ||--o{ approvals : decisions
  expense_requests ||--o{ transfers : "advance / reimburse / shortfall"
  expense_requests ||--o{ receipts : "nota"
  expense_requests ||--o| settlements : "LPJ (advance only)"
  transfers ||--|| cash_entries : "posts KK"
  settlements ||--o| cash_entries : "refund KM"
  settlements ||--o| transfers : "shortfall"
  cash_entries |o--o| cash_entries : "reversalOf"
  cash_accounts ||--o{ cash_entries : account
  projects ||--o{ progress_reports : reports
  project_stages ||--o{ progress_reports : stage
  projects ||--o{ budget_addenda : addenda
  employees ||--o{ attendances : attends
  projects ||--o{ attendances : at
  attendances ||--o{ attendance_corrections : corrected

  expense_requests {
    int id PK
    string docNo UK "allocated at submit (ADR 0007)"
    string type "advance|reimburse"
    string title "subject line"
    date requestDate "company TZ"
    date neededDate
    int project_id FK
    int costCenter_id FK
    int createdBy_id FK
    int bankAccount_id FK
    int grandTotal "server = sum(lines.total)"
    int approvedAmount "frozen at approval"
    int transferredTotal
    int verifiedReceiptsTotal
    string status
    int approvalRule_id FK
    int currentLevel
    int resubmitOf_id FK
    string cancelReason
    uuid clientUuid UK
    string source "web|apk"
  }
  expense_request_lines {
    string id PK "array row"
    int lineNo
    string description "Uraian"
    numeric qty
    int uom_id FK
    int unitPrice "nullable, display only"
    int total "PRIMARY user-entered"
    int category_id FK
    int vehicle_id FK
    string notes "Keterangan"
  }
  expense_line_snapshots {
    int id PK
    int expenseRequest_id FK
    string reason "submit|approve"
    jsonb lines
    int grandTotal
    timestamptz takenAt
  }
  approvals {
    int id PK
    string docType "expense_request|budget_addendum"
    int expenseRequest_id FK
    int budgetAddendum_id FK
    int level
    string position "diajukan|dibuat|diketahui|approval"
    int actor_id FK
    string decision "signed|acknowledged|approved|rejected"
    string reason
    timestamptz decidedAt "server"
    numeric budgetPctBefore
    numeric budgetPctAfter
    int signature_id FK
    string signatureSha256
    string source
  }
  transfers {
    int id PK
    string docNo UK
    int expenseRequest_id FK
    string kind "advance|reimburse|lpj_shortfall"
    int cashAccount_id FK
    int amount "copied server-side"
    string bankRef
    int proof_id FK
    date transferDate
    int postedBy_id FK
    string status "posted|void"
    int cashEntry_id FK
  }
  receipts {
    int id PK
    int expenseRequest_id FK
    int lineNo
    string receiptNo
    int vendor_id FK
    string vendorName
    date receiptDate
    int amount
    int taxAmount "informational"
    int image_id FK
    string status "pending|valid|rejected"
    string rejectReason
    jsonb flags "amount_diff|date_after_request|duplicate|uom_suspicious"
  }
  settlements {
    int id PK
    string docNo UK
    int expenseRequest_id FK
    string usageNotes
    int receiptsTotal
    int transferredTotal
    int difference "transferred - verified"
    string status "draft|submitted|revision|verified|settled"
    string financeNotes
    int verifiedBy_id FK
    string settlementType "none|refund|shortfall"
    int refundCashEntry_id FK
    int shortfallTransfer_id FK
  }
  cash_entries {
    bigint id PK
    string entryNo UK "KM/KK"
    date entryDate
    string period "YYYY-MM"
    string direction "in|out"
    int amount "positive"
    int cashAccount_id FK
    int category_id FK
    int cashInSource_id FK
    int project_id FK
    int costCenter_id FK
    string sourceType "transfer|settlement_refund|manual|reversal|opening"
    int sourceId
    string status "posted|void"
    bigint reversalOf_id FK
    string voidReason
    timestamptz postedAt
  }
  period_closings {
    int id PK
    string period UK
    timestamptz closedAt
    int closedBy_id FK
    timestamptz reopenedAt
    string reason
  }
  attendances {
    bigint id PK
    int employee_id FK
    int project_id FK
    date workDate
    timestamptz checkInAt "server"
    timestamptz checkOutAt "server"
    numeric inLat
    numeric inLng
    int inDistanceM
    int inAccuracyM
    int selfieIn_id FK
    int selfieOut_id FK
    string source "apk|offline|pm"
    int recordedBy_id FK
    timestamptz deviceTimeIn "offline comparison"
    bool mockLocationDetected
    string status
    uuid clientUuid UK
  }
  attendance_corrections {
    int id PK
    bigint attendance_id FK
    string field
    string oldValue
    string newValue
    string reason
    int correctedBy_id FK
  }
  progress_reports {
    int id PK
    string docNo UK
    int project_id FK
    int stage_id FK
    numeric pctBefore
    numeric pctAfter
    date reportDate
    string work
    string issues
    int reporter_id FK
    timestamptz editableUntil "+24h"
  }
  budget_addenda {
    int id PK
    string docNo UK
    int project_id FK
    int oldBudget
    int addition
    int newBudget
    string reason
    string status
  }
```
Progress photos (≤ 5) are `media-progress-photos` docs with an FK `progressReport` (keeps
`progress_reports` flat, ADR 0006 §2). Receipt images likewise reference their owner.

### 4.4 ERD — system

```mermaid
erDiagram
  users ||--o{ devices : registers
  users ||--o{ web_sessions : "browser sessions"
  users ||--o{ notifications : receives
  document_sequences ||--o{ document_sequence_counters : "per period"
  audit_logs {
    bigint id PK
    timestamptz server_time "trigger clock_timestamp()"
    uuid event_id
    bigint tx_id
    string doc_type
    string doc_id
    string doc_no
    string action
    string field
    jsonb old_value
    jsonb new_value
    string status_from
    string status_to
    string reason
    bigint user_id "no FK"
    string user_roles
    string source "web|apk|system|job"
    string app_version
    string ip
    string device_id
    numeric lat
    numeric lng
    timestamptz device_time
  }
  devices {
    int id PK
    uuid deviceId UK
    int user_id FK
    string model
    string appVersion
    string fcmToken
    string keycloakSid
    string status "active|revoked|lost"
    timestamptz lastSeenAt
    timestamptz revokedAt
  }
  web_sessions {
    int id PK
    string idHash UK
    int user_id FK
    string keycloakSid
    timestamptz expiresAt
    timestamptz revokedAt
    string ip
    string userAgent
  }
  notifications {
    int id PK
    int user_id FK
    string event
    string title
    string body
    string docType
    string docId
    timestamptz readAt
    string pushStatus
  }
  document_sequence_counters {
    string doc_type PK
    string period_key PK
    int next_value
  }
  idempotency_keys {
    string key PK
    int user_id
    string requestHash
    jsonb response
    timestamptz expiresAt
  }
  odoo_outbox {
    bigint id PK
    string aggregate
    string aggregateId
    string eventType
    jsonb payload
    timestamptz createdAt
  }
  media_files {
    int id PK
    string collection "media-receipts|selfies|transfer-proofs|progress-photos|signatures|company|attachments"
    string filename
    string mimeType
    int filesize
    string sha256Original
    string ownerDocType
    string ownerDocId
    int uploadedBy_id FK
    timestamptz receivedAt
  }
```
`media_files` is a notation for the 7 `media-*` upload collections (same field set, separate tables).
`odoo_outbox` (collection `odoo-outbox`) shape is owned by ADR 0009 — columns shown are indicative only.

---

## 5. State machines

### 5.1 T1 — Uang Muka (advance)

```mermaid
stateDiagram-v2
  [*] --> Draft
  state "Menunggu Approval" as MA
  state "Disetujui (Antri Transfer)" as DS
  state "Ditransfer" as DT
  state "Nota Lengkap" as NL
  state "LPJ Diajukan" as LD
  state "LPJ Revisi" as LR
  state "LPJ Terverifikasi" as LV
  state "Selesai" as SE
  state "Ditolak" as TO
  state "Dibatalkan" as BA
  state settle <<choice>>

  Draft --> MA : submit [lines min 1, total gt 0, bankAccount, project XOR costCenter] / allocate docNo, snapshot, sign Diajukan+Dibuat
  Draft --> BA : discard (reason)
  MA --> MA : approve level n, not last / approvals row
  MA --> MA : edit by requester [no decision yet] / re-snapshot
  MA --> DS : approve last level [approver not requester or creator] / approvedAmount := grandTotal
  MA --> TO : reject (reason required)
  MA --> BA : cancel by requester [no decision yet] (reason)
  DS --> DT : transfer [amount = approvedAmount, proof, bankRef] / T3 + T7 KK posted
  DS --> BA : cancel by Finance/Owner (reason)
  DT --> DS : transfer voided (T8 reversal, reason)
  DT --> NL : receipts complete (requester) [min 1 receipt]
  NL --> DT : add/remove receipt before LPJ
  NL --> LD : submit LPJ / docNo LPJ
  LD --> LR : Finance requests revision (note required)
  LR --> LD : resubmit LPJ
  LD --> LV : Finance verifies [all receipts valid or rejected] / verifiedReceiptsTotal
  LV --> settle
  settle --> SE : difference = 0
  settle --> SE : difference positive / refund T6 KM Pengembalian LPJ recorded
  settle --> SE : difference negative / shortfall T3 transfer + T7 KK
  SE --> LV : settlement reversal by Finance (reason) [refund or shortfall, period open] / void KM or transfer + KK
  TO --> [*] : resubmit = NEW request (resubmitOf)
  SE --> [*]
  BA --> [*]
```
`difference = transferredTotal − verifiedReceiptsTotal`. Refund cash-in requires proof of the staff's
return transfer (proof optional per US-23 — client question).

**As implemented (F2b, `develop` `59ba0a4`;** `domain/expense/{state.ts,lpj.ts}`**):**
- **Exact amount auto-settles:** when `difference = 0` the `lpj_verify` transition goes straight to "Selesai"
  (LPJ `verified` → `settled` in the same call, no cash posting); `settle` is only needed for a refund or a
  shortfall (ADR 0005 "As implemented (F2b)").
- **Settlement reversal (E9, `feat/s3a-e9-hardening`):** `POST /api/v1/expense-requests/{id}/settle/reverse {reason}`
  (Finance, never on its own request; action `settle_reverse`): the refund KM is voided (reversal row) or the
  shortfall transfer voided with its KK reversed (`transferredTotal` −= shortfall); LPJ `settled` → `verified`
  (links cleared, `reversalCount`/`lastReversal*` recorded), request "Selesai" → "LPJ Terverifikasi", then `settle`
  can run again. Transaction in a closed period → 409 (Direktur re-opens first). Exact LPJ (difference 0) → 409.
  DB guard `pk_settlements_guard` (migration `20260926_131136_s3a_e9_hardening`).
- **403 before 409 (E9, UAT 5.2):** the service answers an authorization failure (role/ownership, G1/G17,
  ADR 0013 monitor-only PM) with 403 **before** looking at the status; only an authorized caller gets 409 for a
  status that does not allow the action (`state.ts` `mayPerform`, `common.ts` `requireAction`; same order in the
  addendum service).
- The **`NL --> DT` arrow ("add/remove receipt before LPJ") is not implemented**: there is no transition from
  "Nota Lengkap" back to "Ditransfer".
- **Settlement reversal is not implemented:** voiding the refund KM or the shortfall transfer of a settled LPJ
  returns 409 (F6 backlog, `phase-plan.md`).

### 5.2 T1 — Reimburse

As implemented in F2a (`apps/web/src/domain/expense/state.ts`, table `TRANSITIONS`; labels `types.ts`
`STATUS_LABELS`). Revised 2026-09-23: the F0 draft went `Disetujui → Ditransfer` directly; F2a adds the
explicit status **"Nota Terverifikasi (Antri Transfer)"** (`receipts_verified`) between Finance's receipt
verification and the transfer, plus "Menunggu Diketahui" and withdraw (shared with §5.1).

```mermaid
stateDiagram-v2
  [*] --> Draft
  state "Menunggu Diketahui" as MK
  state "Menunggu Approval" as MA
  state "Disetujui" as DS
  state "Revisi Nota" as RN
  state "Nota Terverifikasi (Antri Transfer)" as NV
  state "Ditransfer" as DT
  state "Selesai" as SE
  state "Ditolak" as TO
  state "Dibatalkan" as BA

  Draft --> MK : submit [every line has a receipt, rule requires Diketahui] / docNo, snapshot, sign
  Draft --> MA : submit [rule without Diketahui] / docNo, snapshot, sign
  Draft --> BA : cancel (reason)
  MK --> MA : acknowledge = Direktur approval (Diketahui Oleh, ADR 0013)
  MK --> DS : acknowledge when the only approval level was skipped (G1-2) / via MA, approvedAmount := grandTotal
  MK --> TO : reject by the Direktur (reason)
  MK --> Draft : withdraw [no decision] (reason)
  MA --> Draft : withdraw [no decision] (reason)
  MA --> MA : approve level n, not last
  MA --> DS : approve last level [approver not requester or creator] / approvedAmount := grandTotal
  MA --> TO : reject (reason)
  MK --> BA : cancel [no decision] (reason)
  MA --> BA : cancel [no decision] (reason)
  DS --> NV : Finance verifies receipts (verify_receipts)
  DS --> RN : Finance rejects a receipt (reason)
  NV --> RN : Finance rejects a receipt (reason)
  RN --> DS : requester resubmits receipts [grandTotal unchanged]
  RN --> MK : requester resubmits with changed amounts / re-approval (new cycle, Direktur first — E1)
  RN --> MA : same, when the new snapshot has no Diketahui (skipped / rule without it)
  NV --> DT : transfer [amount = approvedAmount] / T3 + one KK (ADR 0005)
  DT --> NV : transfer voided (T8 reversal, reason)
  DT --> SE : complete (requester or Finance)
  DS --> BA : cancel by Finance/Owner (reason)
  NV --> BA : cancel by Finance/Owner (reason)
  RN --> BA : cancel by Finance/Owner (reason)
  TO --> [*]
  SE --> [*]
  BA --> [*]
```
Finance receipt verification happens **before** transfer (lead prompt #1); receipt flags (§5.6) are shown
but do not block. Finance cannot change `approvedAmount` (G3). The "auto-complete after N days" setting of
the F0 draft was not in F2a; **F2b adds it**: worker job `reimburseAutoClose` runs daily at **01:15 WITA**
(cron `15 1 * * *`, worker TZ Asia/Makassar) and closes "Ditransfer" Reimburse requests whose latest posted
transfer is ≥ `company-settings.reimburseAutoCloseDays` (default 30) days old — idempotent, one transaction
per request, audit source `job` (`domain/expense/auto-close.ts`). `complete` stays available manually. For Uang Muka (§5.1) F2a
implements the same submit / acknowledge / withdraw / approve / reject / cancel front part and
`Disetujui (Antri Transfer) → Ditransfer` with void back; the receipt/LPJ part is F2b.

**Decision flow Direktur → Finance (E1, ADR 0013, user decision 2026-09-25, GATE 1 G1-1/G1-2 2026-09-26).**
The role `pk-owner` is labelled **"Direktur"** (`access/roles.ts` `ROLE_LABELS`; no new Keycloak role). The seeded
default rule "Default — Direktur lalu Finance (semua nominal)" (`seed/data.ts`, existing databases: data migration
`20260926_022918_e1_approval_direktur_finance`) has `acknowledge: required`, `acknowledgeBy: role`,
`acknowledgeRole: pk-owner`, `steps: [{ level 1, pk-finance }]` for every amount. "Diketahui" is the **Direktur's
approval** (inbox "Persetujuan Direktur (Diketahui)", button "Setujui", audit action stays `acknowledge`, Riwayat label
"disetujui Direktur (Diketahui)"); Finance approves next. The state table is unchanged except `receipts_resubmit` may
now go to `pending_ack`.
- **Rule validation** (`domain/expense/decision.ts` `ruleDecisionError`, `approval-rules` hook → 400; at submit → 409
  for rules saved before E1): decision roles only `pk-owner`/`pk-finance` (named users must hold one of them);
  `acknowledgeBy: scope_manager` (PM / cost-center manager) is retired (kept in the enum for old rows/snapshots); an
  `optional` Direktur "Diketahui" is refused. The admin selects only offer Direktur/Finance (`filterOptions`).
- **Service guard** (`common.ts` `requireActionAudited`): on a snapshot with `decisionRoles` (every snapshot taken
  since E1) acknowledge/approve/reject need `pk-owner` or `pk-finance`; PM/Staff/Admin → **403** + `access_denied`
  audit (own transaction), whatever the status. `allowedActions` hides the actions (`ActorContext.lacksDecisionRole`).
- **Positions at submit** (`snapshot.ts` → `decision.ts` `planPositions`, replaces the F2e delegation for new
  requests): holders of a position = active role holders (or the named user); eligible = holders − requesters/creator.
  No holder at all → 409. Eligible empty → the position is **skipped** (G1-2): snapshot `skipped[]` (a skipped
  "Diketahui" sets `acknowledge: none`; skipped levels are removed and the rest renumbered), one **`approval_skipped`**
  audit row each (reason "pemohon/pembuat adalah satu-satunya Direktur|Finance"), PDF box "(tidak berlaku — pemohon)".
  The remaining positions must be fillable by **different** people (`distinctAssignable`, one position per person) and
  at least one must remain — else **409**. When the only approval level was skipped, the Direktur's "Setujui" is final:
  `acknowledge` moves the request through "Menunggu Approval" to "Disetujui" in the same transaction (the DB allows
  `approved_amount` only on `pending_approval → approved`).
- **Notifications:** `expense.pending_ack` → active Direktur minus requester/creator ("… menunggu persetujuan Anda
  sebagai Direktur"); `expense.pending_approval` → active Finance minus requester/creator; the PM gets none. The
  "Persetujuan" nav link is shown to Direktur/Finance only; `/api/v1/me` returns `capabilities.approvalInbox`.
- **Re-approval** (Reimburse receipt revision with a changed total, `receipts.ts`): new snapshot + cycle, back to
  "Menunggu Diketahui (Direktur)" when the new snapshot requires it.
- **Legacy snapshots** (submitted before E1, no `decisionRoles`): finish on their old flow — PM "Diketahui", F2e
  delegation (`acknowledgeDelegatedTo`, `matchesAcknowledger`, "(dilimpahkan)" on the PDF), Owner approval — with the
  old guards (US-34, E1 AC-8). `resolveAckDelegation` is no longer called at submit; remove it after the last legacy
  request is closed (F7 cleanup).

**Finance receipt verification in the panel (F2d).** Reimburse requests in "Disetujui" (to verify) and
"Revisi Nota" (waiting for the requester) are listed at the top of **Antrian Transfer**
(`admin/components/ReimburseReceiptReview.tsx`): per receipt Valid / Tolak (reason), open flags "sudah
diperiksa", then "Verifikasi semua nota" → "Nota Terverifikasi (Antri Transfer)"; the transfer table below
lists only transfer-ready requests. Buttons follow the DTO `allowedActions`; the service guard is authoritative.
The nav badge counts both. "Pengajuan ulang dari" shows the previous request's **number** and title (F2e,
`admin/components/ResubmitOfField.tsx`, read with the viewer's own access).

**Business dates** (`requestDate`, `neededDate`, `periodFrom/To`, `transferDate`, receipt dates,
`entryDate`, …) are stored as **text `YYYY-MM-DD`** in the company TZ (`collections/fields-f2.ts`
`businessDateField`, + DB CHECK), not as `timestamptz`, so period-lock and flag comparisons are TZ-free.

**Where transitions are enforced.** Status transitions are enforced in the **domain service**
(`TRANSITIONS` + `allowedActions`) and the `expense-requests` `beforeChange` **hook** (status diff without
the transition context → 403). The **DB does not encode the transition graph**; it enforces content
freeze (`content_hash` + deferred checks), amounts (`approved_amount = grand_total` only on approval,
transfer amount = approved amount, `grand_total = Σ lines`), append-only/Class B rules and the period lock
(ADR 0005, ADR 0006 §2).

### 5.3 T5 — LPJ (settlement document)

```mermaid
stateDiagram-v2
  [*] --> Draft : created when advance reaches Nota Lengkap
  state "Diajukan" as SUB
  state "Revisi" as REV
  state "Terverifikasi" as VER
  state "Disettle" as SET
  Draft --> SUB : submit [usageNotes, receipts min 1] / LPJ docNo
  SUB --> REV : request revision (financeNotes required)
  REV --> SUB : resubmit
  SUB --> VER : verify / receiptsTotal, difference computed
  VER --> SET : settle (none | refund KM | shortfall transfer)
  SET --> [*]
```

### 5.4 T12 — Budget addendum (Addendum RAB)

```mermaid
stateDiagram-v2
  [*] --> Draft : PM creates (team projects only)
  state "Menunggu Approval" as MA
  state "Disetujui" as DS
  state "Ditolak" as TO
  state "Dibatalkan" as BA
  Draft --> MA : submit [addition gt 0, reason] / ADD docNo, oldBudget snapshot
  MA --> DS : Owner approves / project.budget += addition, newBudget stored, history
  MA --> TO : Owner rejects (reason)
  Draft --> BA : cancel (reason)
  MA --> BA : cancel by PM [no decision] (reason)
  DS --> [*]
  TO --> [*]
  BA --> [*]
```
Concurrent addenda: `oldBudget` is re-read under row lock of the project at approval; `newBudget =
current budget + addition` (not the snapshot).

### 5.5 Server-side guards (enforced in domain service; critical ones duplicated in hooks/DB)

| # | Guard | Where enforced |
|---|---|---|
| G1 | Requester (any listed requester employee's user) and creator **cannot acknowledge, approve or reject** their own request; no user may hold two decision positions on one document (DB unique index `approvals_one_position_per_person`). F2e: denied attempts → 403 + `access_denied` audit row written in its own transaction (`requireActionAudited`) | service + `approvals` hook/DB trigger + audit |
| G2 | Approver must match the rule step (role/user) for the current level; rule chosen by amount/category/project at submit and snapshotted | service |
| G3 | **Finance cannot change the approved amount**: transfer amount is copied from `approvedAmount` server-side; any change to lines/total after approval returns the request to Menunggu Approval (reimburse) or is rejected (advance) | service + field access (`approvedAmount`, `lines` update=false after approval) |
| G4 | **No hard delete**: `access.delete = () => false` on all business collections; DB role has no DELETE on Class A/B tables; `beforeDelete` logs `delete_attempt` | Payload + DB (ADR 0006) |
| G5 | **Period lock**: no insert/update of cash entries dated ≤ lock date; transfers/settlements dated in a closed period are refused | service + DB trigger (ADR 0005) |
| G6 | Status only changes through listed transitions (table-driven state machine); `status` field access update=false; hook rejects status diff without the transition context (F2a: `context.pkTransition`) | service + hook (not DB, see §5.2) |
| G7 | Reason mandatory for: cancel, reject, void, LPJ revision, receipt reject, attendance correction, stage weight change, project archive, user deactivation, period reopen | service + audit hook |
| G8 | Edit/cancel by requester only while Draft or Menunggu Approval with no decision rows (US-04) | service |
| G9 | Bank account must belong to one of the requesters and be `active` (verified status shown; blocking = client question) | service |
| G10 | Project scope: Staff may create requests only for projects they are assigned to (or cost centers allowed to them); PM only for team projects | service + access |
| G11 | Stage weights of a project sum to 100 % (US-29); `progressPct` only changes via progress reports (requirements §1 #7) | hook + field access |
| G12 | Project with transactions cannot be deleted — only archived (US-29) | G4 + service |
| G13 | Attendance: server time only; one check-in per employee/project/day; within geofence radius; selfie required; mock-location flag rejects (US-01) | service |
| G14 | Progress report editable ≤ 24 h by its reporter, reason required (§8 T11) | service + trigger |
| G15 | Idempotency: every mutating `/api/v1` call with `Idempotency-Key` returns the first result on retry | API layer |
| G16 | Inactive user / revoked device / revoked web session → 401 on every request | auth strategies |
| G17 | **Finance self-involvement (F2e):** a Finance user who is requester or creator of a request cannot verify/reject its receipts, review its flags, verify all receipts, request LPJ revision, verify the LPJ or settle (`state.ts` `FINANCE_SELF_GUARDED`) → 403 + `access_denied` audit; another Finance user must act | service + DB triggers `receipts_self_verify_guard`, `receipt_flags_self_review_guard` (function `pk_request_involves`, SQLSTATE 42501; LPJ/settle: service only) |

**Guard order (UAT run 4, F2e):** the state check runs before G1 — e.g. `approve` on a request still in
"Menunggu Diketahui" returns **409** (wrong state) even when the caller is also a requester; the action is
refused either way. Returning 403 first is a wording item in the F6 backlog.

**Logging of refusals (F2e):** operational 4xx (403/404/409 from `APIError`/domain `fail()`) are logged at
**warn**, real 5xx stay **error** (`lib/logger.ts` pino `hooks.logMethod`), so guard refusals do not raise
error alerts.

**Field visibility (F2e, UI only; access control unchanged):** `expense-requests.approvalRule` and
`approvalSnapshot` are rendered only for Admin/Owner/Finance (roles that can read `approval-rules`);
`receipts.vendor` (master relationship) is hidden for staff-only users — the inputs otherwise queried
collections those users cannot read (403 noise).

### 5.6 Receipt validation flags (lead prompt #7 — flag, never block)
`amount_diff` (|receipt − line total| > tolerance; per-line sum of receipts), `date_after_request` /
`date_out_of_period`, `uom_suspicious` (category default UoM ≠ line UoM, e.g. BBM with "bulan"),
`duplicate` (same receiptNo + vendor + amount, or same `sha256Original`, in any other request),
`vehicle_missing` (category requires vehicle). Computed on receipt save and on LPJ submit; shown to
Finance (list badges, PDF internal variant). OCR pre-fill = nice-to-have (F6+).

---

## 6. API design

### 6.1 Surfaces
| Surface | Consumers | Auth | Notes |
|---|---|---|---|
| Payload admin `/admin/**` | browsers | `oidcSession` cookie | Payload UI + custom views |
| Payload REST `/api/<slug>` | **admin UI only** | cookie; `Authorization` stripped at Traefik | not part of the public contract, not versioned, may change on Payload upgrades |
| `/auth/*` | browsers | — | OIDC login/callback/logout (ADR 0003) |
| **`/api/v1/*`** | APK, admin custom views, future integrations | `mobileBearer` (+ `X-Device-Id`) or cookie | versioned contract, OpenAPI |
| GraphQL | — | — | disabled (`graphQL.disable: true`) |

`/api/v1` is implemented as Payload root custom endpoints (`endpoints: [{ path: '/v1/…', method, handler }]`,
handler gets `req.user` from strategies — S-PL `docs/rest-api/overview.mdx` §Custom Endpoints), each
handler = zod parse → domain service → response DTO. Root-level `endpoints` are "accessed respective of
the api and slugs you have configured" → served at `/api/v1/...` with default `routes.api = '/api'`
(docs §Custom Endpoints; source `packages/payload/src/utilities/handleEndpoints.ts` L184 uses
`config.endpoints` when no collection matches). Docs warning: **"Custom endpoints are not authenticated by
default"** → every handler starts with `requireUser(req)` + role/scope check (wrapper enforced by lint).

### 6.2 Conventions
- Versioning: URL major (`/api/v1`); additive changes only within v1; breaking → `/api/v2` served in
  parallel for ≥ 1 APK release cycle. APK sends `X-App-Version`; below `company-settings.minAppVersion`
  → `426 Upgrade Required`.
- Errors: RFC 9457 `application/problem+json` (`type`, `title`, `status`, `detail`, `code`, `errors[]`).
- Pagination: `?limit` (≤ 100) + opaque `cursor`; filters whitelisted per endpoint.
- Idempotency: `Idempotency-Key` (UUID) required on POST mutations from APK; stored 72 h with request hash.
- Time: server returns ISO-8601 UTC + `serverTime` header; clients never send authoritative timestamps
  (device times only in `deviceTime*` fields).
- Money as integers; quantities as decimal strings or numbers ≤ 3 dp.

### 6.3 Endpoint catalogue (v1, initial)
```
GET  /api/v1/health | /api/v1/health/ready
GET  /api/v1/me                              profile, roles, scopes, settings subset
POST /api/v1/devices/register | POST /api/v1/devices/{id}/revoke
GET  /api/v1/masters?types=projects,categories,uoms,vehicles,cost-centers,bank-accounts&since=
GET  /api/v1/expense-requests?scope=mine|team|inbox  |  GET /api/v1/expense-requests/{id}
POST /api/v1/expense-requests                         (draft; clientUuid)
PATCH /api/v1/expense-requests/{id}                   (draft/pending edit, G8)
POST /api/v1/expense-requests/{id}/submit | /approve | /reject | /cancel | /resubmit
POST /api/v1/expense-requests/{id}/transfer           (Finance; multipart proof)
POST /api/v1/expense-requests/{id}/transfers/{tid}/void   (path as implemented, F2a)
POST /api/v1/expense-requests/{id}/receipts           (multipart image + fields)
POST /api/v1/expense-requests/{id}/receipts/{rid}/verify | /reject
POST /api/v1/expense-requests/{id}/receipts-complete
POST /api/v1/expense-requests/{id}/lpj/submit | /lpj/request-revision | /lpj/verify | /settle
GET  /api/v1/expense-requests/{id}/pdf[?variant=internal]
GET  /api/v1/expense-requests/{id}/history            (audit tab, US-35)
GET  /api/v1/approvals/inbox                          (Owner; budget impact % before→after, US-26)
POST /api/v1/cash-entries | POST /api/v1/cash-entries/{id}/void | GET /api/v1/cash-accounts/balances
POST /api/v1/period-closings | POST /api/v1/period-closings/{period}/reopen
POST /api/v1/attendance/check-in | /check-out | /on-behalf (PM) | POST /api/v1/attendance/{id}/correct
GET  /api/v1/attendance/today?project= | GET /api/v1/attendance/me?month=
POST /api/v1/progress-reports (multipart ≤5 photos) | PATCH /api/v1/progress-reports/{id}
POST /api/v1/budget-addenda | /{id}/submit | /approve | /reject
POST /api/v1/sync/batch                               (offline queue replay — contract in ADR 0010; implemented F4: drafts + receipts)
GET  /api/v1/app/config                               (PUBLIC app gate: versions, download URL, TZ, feature flags — F4)
GET  /api/v1/notifications | GET /api/v1/notifications/{id|uuid} | POST /api/v1/notifications/{id}/read | POST /api/v1/notifications/read-all
GET  /api/v1/media/{collection}/{id}/file[?variant=thumb]   (as implemented F2b; signed exp/sig NOT implemented — F6)
GET  /api/v1/dashboard/{owner|finance|pm|admin|me}      (as implemented F3; me = own requests / Staff home)
GET  /api/v1/reports/{code}[/{csv|xlsx|pdf}]           (as implemented F3; code = rekap-kas | buku-kas | pengeluaran-kategori |
                                                        anggaran-project | rekap-pengajuan | kelengkapan | biaya-kendaraan | audit-log;
                                                        attendance report → F5)
POST /api/v1/auth/backchannel-logout                  (NOT USED: back-channel logout disabled, ADR 0003 §1 rev. 2026-09-23)
GET  /api/v1/openapi.json                             (auth required outside dev)
```
**File endpoint (F2b, `api/v1/endpoints/media.ts`):** `{collection}` ∈ `receipts | transfer-proofs | signatures |
attachments | company`; read = the media collection's access (`overrideAccess: false`) — **other users' files →
404** (also unknown collection / bad id / missing file); a signature referenced by an approval of a readable
request is also visible; `private, no-store`, `nosniff`, sandbox CSP; **transfer-proof reads audited
`view_sensitive`** (≤ 1 row per user/file/10 min). Details ADR 0004 §4a.

### 6.4 OpenAPI
Payload 3 has no OpenAPI generator (S-PL grep; `@payloadcms/plugin-openapi` 404 on npm). Third-party
`payload-oapi@0.3.0` (MIT, 0.x) documents Payload's generic REST — not needed since `/api/<slug>` is not a
public contract. Decision: zod schemas per endpoint → **`@asteasolutions/zod-to-openapi@9.1.0`** (MIT,
peer `zod ^4.0.0`, published 2026-07-19) → `openapi.json` (OpenAPI 3.x) generated at build, committed in
`packages/api-contract/`, CI drift check, Dart client generation for the APK (generator choice =
flutter-developer; UNVERIFIED). zod version: pin `4.6.5` like control-plane.

### 6.5 Rate limiting
Edge (Traefik, per source IP): `ratelimit-pk-api` 20/s burst 40 (ESTIMATE; carrier-NAT aware), login
paths `ratelimit-login`. App (per user/device, in-process token bucket — single web instance): submit/
approve 30/min, uploads 60/min, PDF 10/min, exports 5/min, `sync/batch` 12/min. `rate-limiter-flexible@11.2.1`
(ISC) is an option; in-memory is sufficient for one instance (state lost on restart — acceptable).

---

## 7. Authorization model

### 7.1 Roles × scope (requirements v1.0 §4, extended)
Roles come from Keycloak realm roles (`pk-staff`, `pk-pm`, `pk-finance`, `pk-owner`, `pk-admin`); a user
may hold several → permissions are the **union**. Scopes resolved once per request and cached in
`req.context.scope`:
- `own` = records where `requesters ∋ user.employee` or `createdBy = user` (or `employee = user.employee`)
- `team` = records whose `project ∈ teamProjects(user)` where `teamProjects` = projects with `pm = user`
  or active `team_assignments(roleInProject='pm')` for `user.employee`
- `assigned` = `project ∈ assignedProjects(user)` = active `team_assignments` of `user.employee`
- `all` = no constraint

### 7.2 Mapping to Payload access functions (pseudo-code, not final)
```ts
// expense-requests.access.read
read: ({ req }) => {
  const r = req.user?.roles ?? []
  if (r.some(x => ['pk-finance','pk-owner','pk-admin'].includes(x))) return true            // all
  const or: Where[] = []
  if (r.includes('pk-staff') || r.includes('pk-pm')) or.push(
    { requesters: { contains: req.user.employee } }, { createdBy: { equals: req.user.id } })  // own
  if (r.includes('pk-pm')) or.push({ project: { in: req.context.scope.teamProjects } })       // team
  return or.length ? { or } : false
}
```
| Collection (key ops) | Staff | PM | Finance | Owner | Admin |
|---|---|---|---|---|---|
| expense-requests R | own | own + team | all | all | all |
| expense-requests C/U | own (G8) | own | — (transitions only) | — | — |
| approve (service) | — | level-1 optional (rule) | — | all | — |
| transfers C | — | — | all | — | — |
| receipts C/U | own (before LPJ) | R team | R/V all | R all | — |
| cash-entries C/X | — | R summary team (dashboard endpoint, not collection) | all | R all (+X optional) | — |
| projects/stages | R assigned | R/U team | R | C/R/U/archive | R |
| budget-addenda | — | C team | R | A | — |
| progress-reports | — | C/R team | R | C/R all | — |
| team-assignments | — | C/R/U team | — | R/U | C/R/U |
| attendances | C/R own | C on-behalf, U via correction, team | R all | R all | R/U |
| masters (categories, cash accounts, banks) | R (needed lists) | R | C/R/U | R/U | C/R/U |
| users & roles | — | — | — | R | C/R/U |
| audit-logs | R own docs | R team docs | R all | R all | R all |
Field-level: `approvedAmount`, `docNo`, `status`, `grandTotal`, `transferredTotal`, `postedAt`,
`progressPct` have `update: () => false` for everyone; `employee-bank-accounts.accountNo` read limited to
own + Finance/Owner/Admin and reads audited (`view_sensitive`).
`access.admin` (panel entry): Admin, Finance, Owner, PM (PM sees only custom views + permitted
collections); Staff uses the APK (optional web access = client question).
**F2c (`develop` `59ba0a4`, ADR 0003 §3a):** `pk-staff` is now in `PANEL_ROLES`. Staff-only users get a
**restricted nav** — only expense requests, receipts, notifications and their own profile; all other collections
and globals are `admin.hidden` (UI only; the access functions above still decide the data). Every user may update
their **own** `users` row, limited to the `signature` field (self-service signature). Requester actions in the
admin call the `/api/v1` endpoints with an `Idempotency-Key`. The admin form (generic REST create/edit of
expense requests) runs the **same `validateContent`** as `/api/v1` (G9, G10, Q-09, project XOR cost center) —
security fix; before F2c that path skipped these rules.

### 7.3 Enforcement layers
Traefik (header strip, rate limit) → strategy (session/device/active) → collection/field access (Where)
→ domain guards (G1–G16) → DB role/triggers (ADR 0006). Every `/api/v1` read uses Local API with
`overrideAccess: false, user`; writes of system fields use `overrideAccess: true` **only inside the
domain service** after guards, tagged `// SYSTEM-WRITE` (Semgrep rule in CI).

### 7.4 Negative test set (must exist before F2 exit)
PM reads another PM's project request → 404/empty; requester approves own → 403; Finance PATCHes amount
after approval → 403; any DELETE on cash entry → 403 + `delete_attempt` row; Staff uses APK token on
`/api/expense-requests` (generic REST) → never authenticated: 403, or 200 `{user:null}` on `/api/users/me`
(header stripped by Traefik; strategy scoped to `/api/v1`, verified F1); revoked device with valid token → 401;
insert cash entry in closed period → rejected by DB even via raw SQL as app role.

---

## 8. Audit log
Design, capture mechanism, DB enforcement and migration interplay: **ADR 0006**. Summary: one flat
`audit_logs` table (fields of requirements §8 + event_id, tx_id, device_time, request_id), written in the
same transaction by `afterChange` diff hooks (per-field rows), with DB trigger + privilege revocation
making UPDATE/DELETE/TRUNCATE impossible for the app role and `server_time` forced by trigger. UI: "Riwayat"
tab = custom document view (`admin.components.views` document view — S-PL `custom-components/document-views.mdx`)
and global "Audit Log" list (filters date/user/doc type/action) for Owner/Admin.

---

## 9. Files, images, PDF

### 9.1 Image pipeline
APK compresses first (ADR 0010: target ≤ 2000 px, JPEG) → upload multipart ≤ 10 MiB → Payload
`beforeOperation`: rename to UUID, SHA-256 of received bytes → sharp: auto-orient, resize `inside`,
re-encode (JPEG/WebP/PNG per collection), strip metadata → `/data/media/<collection>/` → thumbnail size.
Targets per collection: ADR 0004 §2. Original discarded (flagged to client).
**Fixed in F2a** (`apps/web/src/collections/media/index.ts`): Payload validates every generated image size
against the collection's `mimeTypes`, so the shared WebP thumbnail was rejected (`sizes.thumb.mimeType:
Invalid file type 'image/webp'`) on collections that do not accept `image/webp` — every image upload to
`media-transfer-proofs`, `media-attachments` and `media-progress-photos` failed (F1 defect). These use a JPEG
thumbnail (`thumbJpeg`); `media-receipts` (accepts WebP) keeps the WebP thumbnail.

### 9.2 Access
Via collection `read` access derived from owner document; APK via `/api/v1/media/{collection}/{id}/file`
(F2b, §6.3); HMAC signed URLs (5 min) for deep links — **not implemented yet (F6)**. ADR 0004 §4/§4a.

### 9.3 PDF
`@react-pdf/renderer@4.9.0` in web (single doc, semaphore 2 / 10 s → 503, each download audited `export`).
The worker bundle stubs the renderer out (no batch PDF yet). Built-in Helvetica; receipt JPEGs embedded as
stored. Layout replicates the client form; receipts on separate pages, 2 per page; internal variant shows
validation flags. Layout approved by the user 2026-09-24; logo pending (Q-32). ADR 0008 "As implemented".

### 9.4 Excel export (M13) — As decided (user 2026-09-24, Q-F3-3) and implemented (F3)
Decision record: `f3/export-library-decision.md` (registry facts + RAM measurements of the analyst).
- **CSV always** (no library): streamed, keyset pages of 1 000 rows each in its own short transaction, UTF-8 BOM,
  separator `;`, CRLF, RFC 4180 quoting, formula-injection guard (`'` prefix), ≤ 100 000 rows (`lib/csv.ts`).
- **XLSX = `write-excel-file@4.1.1`** (MIT, one dependency `fflate` 0.8.3; npm release 2026-06-08, i.e. past the
  `.npmrc` `min-release-age=7`), server side only, imported lazily (0 idle RAM). In-memory workbook → **≤ 10 000 data
  rows per file**, else 413 "Persempit filter atau pakai CSV". Amounts are numbers with `#,##0`, dates real Excel
  dates (`Date.UTC`, no TZ shift), text always `type: String` (never formula cells). Rollback switch
  `EXPORT_XLSX_ENABLED=false` (button hidden, endpoint 404) — `lib/xlsx.ts`.
- **PDF** for Rekap Kas, Pengeluaran per Kategori, Anggaran Project only (≤ 500 rows, A4 landscape) with the existing
  `@react-pdf/renderer` 4.9.0 (ADR 0008).
- XLSX and PDF (incl. the F2 document PDF) share one in-process semaphore: **2 concurrent, 10 s wait → 503**
  (`lib/heavy-gate.ts`). CSV takes no slot. Every download writes one audit row `export` (report, format, filters,
  row count); exports are rate limited 10/min per user; PM exports are team-scoped exactly like the screen.
- Measured RAM in the production image under `--memory 384m`: see ADR 0008 revision 2026-09-24 (F3).

---

## 10. Numbering
ADR 0007: `document-sequences` master + counters table, tokens incl. `{MM_ROMAN}`, default expense request
`{seq}/PB-{COMPANY}/{DD}/{MM_ROMAN}/{YYYY}` → `228/PB-DRMS/20/IX/2026`, allocation at submit inside the
transaction via row-locking `UPDATE … RETURNING`, unique backstop, TZ Asia/Makassar; expense-request
reset policy `never` (user 2026-09-23, ADR 0007 §3). F1: counter trigger allows `next_value` only to
increase; every allocation writes a `number_issued` audit row.

---

## 11. Jobs & cron
Payload Jobs Queue (ADR 0002 §4). Worker loop: `handleSchedules()` + `run({ queue })` every 30 s (prod
and staging — staging no longer uses `autoRun`, ADR 0002 §7). Tasks: reminders (late progress report N days, missing receipts after transfer +N days,
budget ≥ 85 %/100 %), attendance auto-close at midnight WITA, notifications fan-out (in-app + FCM),
report exports, Odoo outbox dispatch (F7), media orphan sweep, idempotency/web-session purge, daily
audit hash anchor (optional). **Implemented so far:** `auditDailyAnchor` (00:05 WITA), `sendEmail` (queued)
and `reimburseAutoClose` (01:15 WITA, F2b, §5.2). Jobs are idempotent (dedupe key per business event, Payload task
`concurrency` keys — S-PL `queues/localAPI.ts`). Failures after retries → admin notification + log alert.

---

## 12. Observability
- Logs: pino JSON (Payload `logger` option; `pino@10.3.1` as control-plane) to stdout → Docker json-file →
  Alloy/Loki (platform). Fields: `requestId` (from `X-Request-Id`, generated in `proxy.ts` like
  control-plane), `userId`, `deviceId`, `route`, `status`, `durationMs`; no PII bodies, no tokens,
  bank numbers masked.
- Health: `/api/v1/health` (liveness, no DB), `/api/v1/health/ready` (DB `SELECT 1`, media dir writable,
  JWKS cache age); worker heartbeat file (control-plane pattern). Uptime Kuma HTTP monitor on
  `/api/v1/health/ready` (platform).
- Metrics (lightweight): jobs queued/failed counts and last success per task exposed on an admin-only
  view + `/api/v1/health/ready` payload; Prometheus scraping optional later.
- Alerts: job failure > N, backup of `pk_drms` missing (platform restic check), disk media growth > plan,
  HTTP 5xx rate (Loki query), login failures spike (Keycloak).

---

## 13. Capacity (details ADR 0002 §6; all app numbers ESTIMATE)

| Component | mem_limit MiB | cpus | Status |
|---|---:|---:|---|
| drms-pk-web (prod) | 640 | 0.75 | ESTIMATE |
| drms-pk-worker (prod) | 320 | 0.25 | ESTIMATE |
| ~~drms-pk-stg (web+jobs)~~ | ~~512~~ | ~~0.5~~ | superseded F1: staging web 640 / 0.75 + worker 320 / 0.25 (ADR 0002 §7); steady total with prod ≈ 1 920 MiB (≈ 75 %), measured idle web 82 / worker 47 MiB |
| **Steady total** | **1 472** | 1.5 | of ≈ 2 568 MiB client budget (platform ADR 0004) → **57 %**, fits |
| migrate one-shot (deploy only) | +384 | 0.5 | transient peak 1 856 MiB (72 %) |
| Postgres / Keycloak / Traefik | 0 new | — | load inside existing limits |

Disk (ESTIMATE, assumptions ADR 0004 §5): media ≈ 485 MB/month ≈ **5.8 GB/year** after resize; DB ≈
0.5–1 GB/year; restic repo ≈ 1–1.5× (dedup). Host free: 167 G (S-HOST). No overrun flagged; the
measurement gate is F1 (idle) and F6 (load).

---

## 14. Security / threat model (STRIDE-lite)

| Asset / entry | Threat (STRIDE) | Mitigation | Verified by |
|---|---|---|---|
| APK tokens | S: stolen refresh token on lost phone | Keystore storage, refresh rotation, device revoke → immediate 401 (G16), Keycloak offline-session delete | QA F4 |
| Web session cookie | S/T: CSRF, fixation | `__Host-` cookie, SameSite=Lax, Origin check on unsafe methods, new session id per login, back-channel logout | QA F1 |
| `/api/<slug>` generic REST | E: APK token or bug exposes collections | Traefik strips `Authorization`; Where-based access; negative tests §7.4 | QA F1/F2 |
| Local API `overrideAccess` default true | E: privilege escalation in custom code | `overrideAccess:false` rule + Semgrep custom rule + review | QA F1 |
| Approvals | R/E: self-approval, forged approver | G1/G2, approvals Class A append-only, signature hash | QA F2 |
| Cash ledger | T/R: edit/delete history, back-dated entries | Class B triggers, period lock trigger, void with reason, audit | QA F2 |
| Audit log | T/R: tampering | Class A (revoke + trigger + server time), optional hash chain | QA F1 |
| Attendance | S: fake GPS/time, proxy check-in | server time, mock-location flag (APK), geofence server check, selfie, device binding; offline records flagged | QA F5 |
| Uploads | T/E/D: malicious files, SSRF, huge files | MIME allow-list, sharp re-encode, `pasteURL:false` **+ remote-URL guard hook on every upload collection** (F1: `pasteURL:false` alone still fetches `{filename,url}`), 10 MiB cap (Traefik buffering + Payload limits + AppSec), UUID names | QA F2 |
| Files | I: IDOR on receipts/selfies/bank proofs | owner-derived read access, signed URLs with user binding, `Cache-Control: private, no-store` | QA F2 |
| Bank account numbers | I: leakage | masked in lists/logs, reads audited, PDF export audited | QA F2 |
| Keycloak service account | E: `manage-users` abuse | secret only in env, scoped to realm `drms`, calls audited | QA F1 |
| API | D: flooding, heavy PDF/export | Traefik rate limits, app token buckets, PDF semaphore, jobs for batch | QA F6 load test |
| DB | I/E: other tenants' roles | DB rename off Odoo regex, REVOKE CONNECT FROM PUBLIC, per-role pg_hba | infra + QA F1 |
| Supply chain | T: compromised npm deps | exact pins, lockfile, Trivy/npm audit/Semgrep, Renovate PRs via staging | CI |
| Offline sync | T/R: replayed or reordered actions | idempotency keys, server-side state machine validation on replay, device time only as comparison (ADR 0010) | QA F4 |

---

## 15. Backup integration (platform ADR 0006)
- DB `pk_drms` (+ `pk_drms_stg` optional) → covered automatically by `backup.sh` dynamic DB list (S-HOST,
  `backup.sh` L44).
- Media → **infra change**: add generic `MEDIA_VOLUMES=(drms_pk_media_prod)` (volume root, no `filestore/`
  subdir) to `restic-common.sh`/`backup.sh`; order DB first, files second (already the script's design).
- Keycloak realm `drms` → covered by the existing Keycloak DB dump + realm export files.
- Restore test (monthly, platform): restore `pk_drms` into `restoretest_pk_drms` + media into a temp dir,
  run `payload migrate:status` + `/api/v1/health/ready` against it, report RTO.
- Pre-deploy (prod): ad-hoc `backup.sh` DB-only run before migrations (infra-deploy extension — coordination).

---

## 16. Consolidated UNVERIFIED items (to close in F1 spikes unless noted)

> **F1 spike status (2026-09-23, `spikes/f1-spike-report.md`):** closed — 1 (Next route handlers `/auth/*`
> alongside the `(payload)` route group, spike §a), 2 (except `__Host-` cookie over HTTPS and the
> `/api/users/logout` inactivity path, verify on staging), 3, 4, 5 (no TZ option → process `TZ`), 6, 7,
> 8 (minimal CSP §3.3), 10 (ADR 0002 §6). Partly open — 9 (resize verified; HEIC decode and legibility at
> 2000 px still UNVERIFIED). Still open — 11–14. ~~New — Admin REST reachability from `drms-kas-edge` through `ipallowlist-admin`~~ — closed in F1 foundation
> (internal networks `drms-kc-admin[-stg]`, ADR 0003 §6).
1. ~~Root custom endpoints path~~ — resolved (docs + source, §6.1); remaining: Next.js route handlers `/auth/*` coexisting with Payload's `(payload)` route group (F1 smoke).
2. Payload admin works fully with `disableLocalStrategy` + custom cookie strategy (logout, account view, `me`) (ADR 0003).
3. Keycloak 26.7.4 access tokens contain `sid`; minimal realm-management roles to delete sessions; internal `http://keycloak:8080` requests yield public `iss` (ADR 0003).
4. Worker bundling of the Payload config outside Next (ADR 0002).
5. Payload cron schedule timezone support (ADR 0002 §4).
6. Drizzle transaction handle for raw SQL inside Payload request transaction (ADR 0007).
7. Payload `create` on a flat collection issues no hidden UPDATE/DELETE (needed for Class A tables) (ADR 0006).
8. Strict CSP compatibility of the Payload admin (§3.3).
9. HEIC input support in prebuilt sharp; receipt legibility at 2000 px (ADR 0004).
10. Real RAM of Payload web/worker (ADR 0002 — measurement gate).
11. `Intl` currency-style separator (ADR 0008; we avoid it).
12. Excel library choice (§9.4); Dart OpenAPI client generator (§6.4).
13. CrowdSec AppSec behaviour for bodies > 10 MiB (ADR 0004).
14. Keycloak admin events endpoint for importing login failures (ADR 0003 §7).

## 17. Revision history

- **2026-09-23 (F0 gate):** accepted by user.
- **2026-09-23 (F1 spike, user-approved):** Payload 3.90.1 = GO (user). §3.1 network `drms-kas-edge` and
  Keycloak via public issuer (hairpin); §3.3 live staging routers `drms-pk-stg-{auth,api-v1,api-rest,web}` +
  `auth-drms-token`, buffering only on api-v1/api-rest (request 10 MiB, response 16 MiB); "CSP compatibility
  UNVERIFIED" replaced by the minimal admin CSP (user decision: `style-src 'self' 'unsafe-inline'`, scripts
  nonce-strict without `'strict-dynamic'`, `form-action 'self' https://auth.bimacreative.tech`; no
  `json`/`code` editors); §6.3 back-channel logout endpoint unused; §7.4 generic-REST expectation 403 /
  `{user:null}`; §14 upload guard hook; §16 spike status.
- **2026-09-23 (F1 foundation, staging deployed):** §3.1 staging as deployed (separate web + worker, migrate,
  seed; networks incl. `drms-kc-admin-stg`; pools 5+3+2 ≤ 10; local images `TEMPORARY` until GHCR; measured
  idle 82/47 MiB) and Admin API via internal networks (infra H5); §3.4 seed policy (fictional default,
  `SEED_DATA_FILE` at deploy time, never overwrites); §10 reset `never` + counter/audit guards; §11 worker in
  staging; §13 staging capacity superseded; §16 Admin REST item closed.
- **2026-09-23 (F2a):** verified against `develop` `c8c1af6`. §5.2 Reimburse redrawn as implemented: new status
  "Nota Terverifikasi (Antri Transfer)" (`receipts_verified`), "Menunggu Diketahui", withdraw; auto-complete
  not implemented. Business dates stored as text `YYYY-MM-DD`. Status transitions enforced in service + hook;
  the DB enforces content/amounts/locks, not transitions (G6 row updated). Onboarding prerequisite: default
  rule requires "Diketahui" (Q-07) → submit 409 until the project PM / cost-center manager is set. §9.1 webp
  thumbnail fix recorded.
- **2026-09-24 (F2b/F2c):** verified against `develop` `59ba0a4`. §5.1: exact-amount LPJ settles at
  verification; `NL → DT` arrow not implemented; settlement reversal not implemented (void of refund KM /
  shortfall transfer → 409, F6 backlog). §5.2/§11: Reimburse auto-close job 01:15 WITA. §6.3: file endpoint
  `GET /api/v1/media/{collection}/{id}/file[?variant=thumb]` (other users' files → 404, transfer proofs audited
  `view_sensitive`), notifications endpoints, transfer-void path as implemented. §7.2: `pk-staff` panel access with
  restricted nav, self-service signature, admin requester actions via `/api/v1` + `Idempotency-Key`, admin REST
  create runs `validateContent` (security fix). §9.2 signed URLs still open; §9.3 PDF as implemented (ADR 0008).
- **2026-09-24 (F2d/F2e, UAT fixes):** verified against `develop` `e9c07ab`. §5.2: acknowledger delegation to
  Owner/Admin (user decision 2026-09-24, option a; replaces the "submit 409 until PM is set" prerequisite except
  when nobody qualifies), snapshot fields, `acknowledge_delegated` audit, PDF "(dilimpahkan)"; Finance Reimburse
  receipt verification in Antrian Transfer (F2d); resubmit shows the old number. §5.5: G1 extended to
  acknowledge/reject with `access_denied` audit; new G17 Finance self-involvement (DB triggers
  `pk_request_involves`); guard order 409-before-403 noted; operational 4xx logged at warn; office-only fields
  hidden for Staff/PM. UAT evidence: `uat/f2-uat-report.md`.
- **2026-09-24 (F3):** §6.3 dashboard/report endpoints as implemented; §9.4 Excel export "As decided" (user
  2026-09-24: `write-excel-file` 4.1.1, 10 000-row XLSX cap, CSV always, shared render semaphore with PDF, report PDFs
  for 3 reports). Admin: `admin.components.views.dashboard` replaced by the role home pages; custom views
  `/laporan`, `/laporan/:kode`, `/audit-log`. Company setting `lpjDueDays` (Q-F3-1).
