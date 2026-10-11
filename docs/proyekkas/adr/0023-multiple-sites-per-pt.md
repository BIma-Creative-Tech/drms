# ADR 0023 — Multiple sites per PT: a `sites` master (branch offices), not a new company

- **Status:** accepted (owner answers 2026-10-11, see "Decisions"; DRMS 10/10 Phase D, owner point 16 "multi-site per
  PT"). Staging first, no production deploy without separate owner approval.
- **Date:** 2026-10-11
- **Author:** Analyst (branch `docs/d1010-d-adr`, based on `feat/d1010-int` `cb19838`)
- **Related:** ADR 0007 (numbering), ADR 0010 (APK offline sync, attendance), ADR 0016 (multi-company: what is per PT,
  timezone §9, cross-PT triggers, scope), ADR 0021 (approval PM → Direktur), ADR 0022 (inter-project loan; same-PT
  rule); plan `../plans/drms-1010.md` Phase D.

## Context

### Owner request (DRMS 10/10, point 16)

> One PT has more than one site.

The point did not say what a "site" is; the draft listed three readings (work site / area, branch office, warehouse /
workshop). **Owner answer Q-S1 (2026-10-11): a site is a branch office (kantor cabang) of the PT.** One branch handles
several projects; a project belongs to at most one branch. Examples: "Cabang Balikpapan", "Cabang Kendari".

A branch is a **physical location inside the same legal entity**: same NPWP, same books, same approval chain, same
numbering. That is the line between a site and a PT (§"Site vs PT").

### What hangs off the company today (read on `feat/d1010-int` `cb19838`)

| Area | Today | Evidence |
|---|---|---|
| Attendance locations | A check-in targets a **project** or a **cost center** (`Location = project \| cost_center`); each has optional `lat/lng/radiusM`; empty radius → PT default `defaultGeofenceRadiusM` | `domain/attendance/record.ts:40,113-140`; `collections/Projects.ts:116-124`; `collections/CostCenters.ts:14,53-61`; `collections/Companies.ts:92-94` |
| Who may check in where | `team-assignments` (employee → project **or** cost center, start/end date) | `collections/TeamAssignments.ts:56-73`; `record.ts:76-82,174-181` |
| APK sync payload | `attendance.check_in/out/on_behalf` carries `project_id` **xor** `cost_center_id` | `domain/sync/service.ts:169,520-524` |
| Work schedule | employee `workSchedule`, else PT `defaultWorkSchedule` (snapshot on the row) | `collections/Employees.ts:126`; `record.ts:96-104`; `domain/attendance/queries.ts:103-104` |
| Employee | belongs to one PT (ADR 0016 D1); no home location | `collections/Employees.ts:83-127` |
| Project location | `address`, `lat/lng/radiusM`; no grouping above the project | `collections/Projects.ts:116-124` |
| Cost centers | per PT, `type` operational/department, `manager`, optional geofence — an **operational cost center with a point is already used as an office location** | `collections/CostCenters.ts:39-61` |
| Cash accounts | per PT; no location | `collections/CashAccounts.ts:60-82` |
| Numbering | per PT, `{COMPANY}` = PT short code; no location token | `domain/numbering.ts:30-31,106-119` |
| Approvals | project PM → Direktur of the PT (ADR 0021); nothing per location | ADR 0021 §1-3 |
| Timezone | per PT field, but forced = process TZ (`Asia/Makassar`) | ADR 0016 §9 |
| Reports | `ReportScope` per PT (`all/team/own`); filters PT, project, cost center | `domain/reports/scope.ts:34-39`; `domain/reports/kpi.ts:216,280,623` |

So a branch office **can already be approximated** as an operational cost center with a geofence. What is missing:
(a) a branch that **handles several projects**, (b) a **home branch** for employees, (c) a **site filter** across
projects, attendance and cash, (d) per-branch defaults (schedule, radius, cost center).

## Decisions (owner, 2026-10-11)

| # | Decision |
|---|---|
| Q-S1 | A site = a **branch office (cabang)** of the PT. One site handles several projects; a project belongs to **at most one** site. No site kinds (no work-site / warehouse variants). |
| Q-S2 | Sites stay inside one PT (master `sites`); only a separate legal entity becomes a new PT. Operational cost centers that already have an attendance point stay usable; the Admin may create a site from one. |
| Q-S3 | Document numbers stay per PT; no site code in the number. The site is shown on the detail and filterable in reports. |
| Q-S4 | No branch head in the approval chain and no site-scoped access: approvals stay project PM → Direktur, access stays per PT. |
| Q-S5 | Attendance at a site: home site (site penempatan) **or** team assignment. On-behalf: a PM assigned to the site or the PM of a project of that site. |
| Q-S6 | All sites use the PT timezone (WITA); another timezone would be a separate decision. |
| Q-S7 | Petty cash per site = a site flag on cash accounts (filter, per-site balance on the dashboard); cash rules unchanged. |

## Decision

### 1. Master `sites` (table `sites`, per PT — ADR 0016 class "per PT — master")

| Field | Rule |
|---|---|
| `company` | required, immutable |
| `code` | required, unique per PT (`codeField(..., { perCompany: true })`) |
| `name` | required |
| `address` | optional |
| `lat`, `lng`, `radiusM` | optional geofence (same fields and validation as projects / cost centers; empty radius → PT default) |
| `defaultWorkSchedule` | optional `work-schedules` of the same PT |
| `costCenter` | optional default cost center (operational) of the same PT — used as the transfer default for projects of the site that have none |
| `active` | default true; inactive = not selectable, history keeps it |

Admin (and Direktur) maintain it under Master data (D9 landing page). Read: every member of the PT (it carries no money).

### 2. Optional `site` on existing records (all nullable, same-PT trigger)

| Record | Field | Use |
|---|---|---|
| `employees` | `homeSite` ("Site penempatan") | default attendance location, default schedule, report filter |
| `projects` | `site` ("Site") | the branch that handles the project (at most one, Q-S1); report/dashboard filter |
| `cash-accounts` | `site` | petty cash of a branch (Q-S7); filter of the cash book and K-01 balances, per-site balance on the dashboard |
| `team-assignments` | `site` (third option next to project / cost center, exactly one of the three) | assignment of people to a site for a period |
| `attendances` | `site` (system, derived at write) | reporting: the site of the location (the site itself, or the project's site; NULL for a cost-center check-in) |

Cost centers get **no** site column: the branch's own cost center is `sites.costCenter` (§1). Expense requests,
transfers, cash entries, RAP, daily/progress reports get **no** site column either: their site is the site of their
project (or of the cash account) and is derived in SQL. This keeps the change out of the frozen
request content (content hash, `pk_expense_frozen_check`) and avoids a second source of truth.

### 3. Attendance with a geofence per site

- New location type **`site`**: `Location = project | cost_center | site` (`record.ts`), APK/API body `siteId` /
  sync `site_id` (exactly one of `project_id`, `cost_center_id`, `site_id`).
- **Who may check in at a site:** an active team assignment to the site on that date **or** `employees.homeSite` = that
  site (the branch where the person is stationed; no daily assignment rows needed) — Q-S5. Project and cost-center
  rules are unchanged; a project keeps its own point (the branch office point is not a project location).
- **Schedule resolution:** employee `workSchedule` → home site `defaultWorkSchedule` → PT `defaultWorkSchedule`
  (snapshot on the row as today), so a branch can have its own office hours.
- PM on-behalf ("diabsenkan PM") for a site: a PM assigned to the site, or the PM of a project of that site (Q-S5).
- Existing cost-center locations keep working (old APKs never send `site_id`).

### 4. What stays per PT (unchanged)

- **Numbering** stays per PT (`PB/DRMS/2610/0001`); no `{SITE}` token (Q-S3). Should this change later, a `{SITE}`
  token would also need the site in the counter key (`(company_id, site_id, doc_type, period_key)`, ADR 0007).
- **Approvals** stay project PM → Direktur of the PT (ADR 0021). No branch-head approval level (Q-S4).
- **Roles and data scope** stay per PT (ADR 0016 §5). A site does not restrict what an office role sees. A PM still
  sees his team projects. No site-scoped roles (Q-S4).
- **Period closing, cash lock, letterhead, timezone** stay per PT. All sites use the PT timezone (Q-S6; ADR 0016 §9
  forces TZ = process TZ).

### 5. Reports and dashboard

- Filter **Site** (single select, sites of the selected PTs) on: Rekap absensi, attendance report, Monitoring RAP /
  project budgets, spending / cash-flow, cash book and balances (via cash account site), Pinjaman antar project
  (ADR 0022, via the projects). Implemented as an extra predicate built from site ids (bound parameters) next
  to `projectScopeSql` / company helpers — it only **narrows** the existing scope.
- Dashboards (Direktur, Finance, PM): the same site filter in the header next to the PT switcher; cards keep their
  meaning. Optional "per site" breakdown on the Direktur dashboard (projects, attendance today, spending this month).
- Lists (D8): `Site` column + filter on projects, employees, cash accounts, team assignments, attendances.

### 6. API and APK scope

- `/api/v1/sites?q=&active=&company=` (list, like `/cost-centers`); `site` on `GET /projects`, `/projects/{id}`,
  employee and cash account DTOs; `siteId` on attendance check-in/out, sync `site_id`; `GET /attendance/me` and the
  location list include sites the user may check in at (assigned or home site). OpenAPI updated.
- **APK:** attendance location picker shows the user's sites (home site first) next to projects / cost centers; drift
  schema adds `site_id` to the attendance outbox (schema version bump, migration fills NULL); masters cache sites per
  PT; project screens show the site. Reports on the APK: none new. An old APK keeps working with projects / cost
  centers only (server accepts the old payload).

### 7. Migration plan

1. `20261013_200000_d1010_sites` (Payload-generated + `.json` snapshot): table `sites`, nullable `site_id` on
   `employees`, `projects`, `cash_accounts`, `team_assignments`, `attendances`; `attendances` location
   CHECK becomes "exactly one of project / cost center / site"; same for `team_assignments`.
2. `20261013_200100_d1010_sites_guard` (security): `company_id NOT NULL` + immutable on `sites`, unique
   `(company_id, code)`, `pk_same_company` triggers for every new `site_id`, attendance guard accepts `site_id`,
   grants (no DELETE; deactivate instead).
3. **No automatic data move.** Existing operational cost centers with a geofence stay attendance locations. The Admin
   creates sites and links projects / employees / cash accounts (import workbook gets a `Site` column for bulk
   linking). Optional helper: "Buat site dari pusat biaya" (copies name/address/point, links the cost center) — Q-S2.
4. Additive and nullable: a PT that never creates a site behaves exactly as today. `down()` drops the new columns and
   table (pre-production only).

### 8. Tests

- **Unit:** location resolution (site / project / cost center), assignment-or-home-site rule, schedule resolution
  order, report site predicate.
- **Integration:** check-in at a site inside / outside the radius, by home site, by assignment, refused without either;
  old payload without `site_id` unchanged; PM on-behalf at a site (assigned PM, PM of a project of the site, refused
  otherwise);
  cross-PT site references refused (service + DB trigger) — extend `mc-isolation`; site filter narrows and never
  widens the report scope (PM with a site filter still sees only team projects); attendance row `site_id` derived for
  site and project check-ins (NULL for cost center); masters/sites endpoint scoped to the selected PTs; APK sync with `site_id` (and the
  `exactly one` rule → 400 on two locations).
- **APK:** drift migration test, location picker with sites, outbox replay with `site_id`.

## Site vs PT — when to choose which

| Choose **a site** (this ADR) when | Choose **a separate PT** (ADR 0016) when |
|---|---|
| Same legal entity, same NPWP, one set of books | Its own legal entity / NPWP, or its own books and tax reporting |
| Same approval chain (project PM → Direktur of the PT) | Its own Direktur(s) and Finance, own approval rules |
| One numbering series is fine (`PB/DRMS/…`) | Documents must carry another company code and letterhead |
| One period closing for all locations | Closes its month independently |
| People move between locations often (one employee row, one history) | People are employed by that entity (a person in two PTs = two employee rows, ADR 0016 D1) |
| Money between locations is just internal allocation (ADR 0022 loans stay same-PT) | Money between them is inter-company debt (manual KK/KM in each PT) |

Treating every site as its own PT would give the owner per-site numbering and letterheads for free, but at a high
cost: every master (categories, vendors, clients, cash accounts, schedules, approval rules, sequences) duplicated per
site, an employee moving between sites needs a second employee row and loses one attendance history, project loans
between sites become cross-PT, and consolidated views need the PT switcher for daily work. Decided (Q-S2): **sites for
branches of one company, PTs only for legal entities.**

## Alternatives

| Alternative | Why not |
|---|---|
| Each site = its own PT | See the table above; misuses the legal-entity dimension. |
| Reuse operational cost centers as sites (no new master) | Works for a single office (already possible today), but a cost center is a finance concept chosen by Finance at transfer (D2); it cannot hold the projects of a branch, has no home-site meaning for employees and no per-site schedule. Kept as is for the cases it already covers. |
| Site as free text on projects/employees | No geofence, no filter integrity, typos split reports. |
| Site column on every transaction (requests, transfers, cash entries) | Second source of truth next to the project; touches frozen request content and DB guards; derivation through project / cash account is enough for reports. |
| Site-scoped roles | Changes the access model of ADR 0016 (roles per PT); owner declined (Q-S4). |
| Site kinds (work site / office / warehouse) | Owner: a site is a branch office (Q-S1); no kinds. |

## Consequences

- Positive: one employee record and one PT for people who move between branches; attendance per branch with its own
  geofence and office hours; site filter on reports and dashboards; numbering, approvals and closing unchanged; a PT without
  sites is unaffected.
- Negative: one more master to maintain and link; an attendance location has three types (more APK UI states); the
  site of a request/transfer is derived (a project moved to another site moves its history in site reports — by design,
  Q-S1).
- Per-site numbering, per-site approvals, site-scoped roles and per-site timezones are explicitly **not** delivered
  (owner 2026-10-11); each would need a new decision.

## Rollback

Additive and nullable: hide the menu and the filter, revert the code; `down()` before production. After production
use: keep the data, stop using it (sites can be deactivated).

## Pertanyaan untuk owner

All answered on 2026-10-11 (section "Decisions"): Q-S1 = site is a branch office (cabang), one site handles several
projects, a project belongs to at most one site; Q-S2…Q-S7 = the proposed defaults. No open questions.
