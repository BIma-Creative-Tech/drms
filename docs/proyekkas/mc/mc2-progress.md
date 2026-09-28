# MC2 — progress log (multi-company: domain, reports, jobs, admin UI, import)

- **Design:** `../adr/0016-multi-company.md` (+ "Implementation notes (MC2)"); work list `impact-inventory.md`
  §MC2-1…MC2-5; consolidation rules `../requirements-v1.2.md` §5/§6.
- **Two parallel branches** (both from `179be5a` = develop + MC1 + 2FA):
  - backend (this section): `feat/mc2-backend`, worktree `/opt/src/proyekkas-wt/mc2-backend` — `domain/**`,
    `jobs/**`, reports, `/api/v1`, collections access, tests;
  - admin UI + import: `feat/mc2-admin-ui` (`src/admin/**`, `src/import/**`) — own section, maintained there.
- **Contract backend → UI:** `mc2-contract.md` (read it before touching a view that calls a domain function).
- **Purpose of this file:** resume point for another agent; updated with every work package.

## Backend (`feat/mc2-backend`)

### How to run (host has no node)

Containers of this phase (remove by exact name only, never `docker … prune`): `pk-mc2b-net`, `pk-mc2b-pg`
(postgres:16.15-bookworm), `pk-mc2b-node` (node:24.21.0-bookworm-slim, worktree at `/w`), `pk-mc2b-mailpit`
(CI replica, throwaway certs in the agent scratchpad), `pk-mc2b-base` (baseline run of `179be5a`, DB
`pk_test_base`). Unit = `npm -w apps/web run lint && … typecheck && … test:coverage && … check:openapi`;
integration = `vitest -c vitest.integration.config.ts` with `PK_TEST_DATABASE_URL{,_OWNER,_RO}` → `pk_test`,
`TZ=Asia/Makassar`.

### Baseline (`179be5a`)

- unit: 36 files / 532 tests; integration: 35 files / 459 passed + 1 skipped (≈ 18 min).

### Result (last commit of the series)

- unit: 37 files / 535 tests (+ `mc2-sql-lint`), lint + typecheck + coverage + OpenAPI drift green;
  integration: 36 files / 483 passed + 1 skipped (+ `mc2-isolation`: 25 tests); `npm run build` green.

### Work packages

| WP | Status | Notes |
|---|---|---|
| MC2-2 reports / KPI / exports | done | per-PT `ReportScope`, company predicate in every raw SQL, `pt` parameter, PT column + subtotal per PT, per-PT / group letterhead, audit log per PT, dashboards `byCompany` |
| MC2-1 domain services | done | queues with PT refs + filter, Kas per PT (`kasAccessIn`, `lockDates`, closing `company`), attendance scope per PT, progress thresholds per PT, `hasRoleAny` review (below), per-PT fixes of MC1 leftovers (addendum decision roles, manual cash posting/edit/void, internal PDF, DTO bank number, history cash rows, device revoke, attendance correction, PM on-behalf) |
| MC2-3 jobs | done | reminders / auto-close / selfie retention loop over active PTs with that PT's settings; `reminder_runs (company_id, run_date)`; audit anchor + sendEmail stay global |
| media / sync | done | media office access per PT (id lists only when the role is not held in every active PT); sync `COMPANY_MISMATCH` + per-item PT flags/employee |
| lead follow-ups | done | `narrowAttScope`, `auditScope`, `kasAccessIn`/`lockDates`/closing `company`, PT ids on Kas book / attendance recap / K-09 rows, dashboard `byCompany` fields (contract §2); NEW `POST /api/v1/company-memberships/batch` (atomic role matrix, contract §8) |
| tests | done | `mc2-isolation.int.test.ts` (3 PTs), `mc2-sql-lint.test.ts`; f3/e6 tests adapted to per-PT scopes |

Commits: see `git log 179be5a..feat/mc2-backend` (Conventional Commits `feat(mc2): …` per WP). The full suite
(lint, typecheck, unit + coverage, OpenAPI drift, integration, build) was run on the tree of the last commit;
intermediate commits of the series were type-checked.

### `// MC2:` leak points of MC1 — status

| MC1 leak point | Status |
|---|---|
| `domain/reports/scope.ts` `officeScope` `all` = SQL `TRUE`, role "any PT" | **closed** — per-PT scopes, `all` = PTs of the role, legacy literal fail-closed |
| `domain/reports/kpi.ts` 8 unscoped functions | **closed** — all take a scope / company list |
| `domain/reports/registry.ts`, `audit-log.ts`, `attendance-report.ts`, `export.ts` | **closed** |
| `domain/attendance/queries.ts` / `web.ts` `AttScope all` | **closed** — `AttScope.parts` per PT |
| `domain/attendance/retention.ts` company #1 | **closed** — per PT loop |
| `domain/cash/book.ts` SQL without company; Kas lock date = context PT | **closed** (domain); the Kas VIEW must pass the PT (`lockDates`, `periodSummaries(…, [pt])`) — UI branch |
| `domain/reminders/service.ts` `roleHolders` any PT, settings/run company #1 | **closed** |
| `jobs` reimburse auto-close / selfie retention company #1 | **closed** |
| `domain/sync/service.ts` flags of the context PT, no `COMPANY_MISMATCH` | **closed** |
| `domain/sync/attendance.ts` `employeeOfUser` first membership | **closed** (employee of the location's PT) |
| `collections/media/index.ts` office roles read every PT | **closed** |
| `api/v1/endpoints/media.ts` owner check without company | **closed** (collection access per PT + owner fallbacks) |
| `domain/expense/queues.ts` no PT label / context-PT warn % | **closed** |
| `domain/companies.ts` `contextCompanyId` callers | reviewed: domain callers pass the document PT; remaining = `today()` (same TZ for all PTs, Q-59) and the MC3 endpoints below |
| display names / PDF "Dibuat Oleh" first membership | **closed** (`displayNames(…, { companyId })`) |
| `api/v1/endpoints/me.ts` `// MC3:` settings of the context PT | **moved to MC3** — `/me` `companies[]` is the APK contract (MC3-1) |
| `api/v1/endpoints/masters.ts` `// MC3:` default radius | **moved to MC3** — masters per selected PT for the APK (MC3-1) |
| Notification templates editable by an Admin of any PT | **kept** (app-wide texts; inventory proposes group admin — decide with the UI / MC4 review, no data leak) |

### `hasRoleAny` call sites outside `src/admin` after the review

Kept as harmless gates / hints (rows are filtered per PT afterwards): `api/v1/http.ts` endpoint `roles` gate,
`endpoints/reports.ts` report role gate, `addendum/access.ts mayReadAddenda`, `addendum/service.ts` inbox gate,
`progress/access.ts mayCreateReports`, `progress/dto.ts listReports` gate, `attendance/web.ts mayCorrect` (legacy
literal hint only), `domain/users-sync.ts` (Keycloak sync of an update already authorised per PT),
`collections/WebSessions.ts` hidden flag, shared masters (banks, UoM, holidays: ADR 0016 §2 "any PT"),
`collections/Users.ts`/`Devices.ts` (combined with `usersOfMyCompanies`), `collections/AuditLogs.ts` (gate; rows
per PT via `byRole`, untagged rows now Admin/Owner/group admin only). Replaced with per-PT checks: `expense-requests.ts` list scope `team` + PDF
internal, `expense/dto.ts` full bank number, `history.ts`, `devices.ts canRevoke`, `attendance/corrections.ts`,
`sync/service.ts` on-behalf, `attendance/record.ts` PM team check, `addendum/service.ts` decision roles + project
options, `domain/cash/ledger.ts` manual posting / edit / void, media collections, `collections/WebSessions.ts` read
(`usersOfMyCompanies`).

### Open / next

- UI branch: adopt `narrowAttScope` in `Absensi.tsx` (company-less `narrow()` there), pass `auditScope` in
  `Reports.tsx`, per-PT Kas / Tutup buku screens (`kasAccessIn`, `lockDates`, `company` on close), PT chips from
  `company` / `companyId` fields, dashboard breakdown rows (`byCompany`). See `mc2-contract.md` §0.
- **MC3/MC4 item (lead ask 6b, not built):** optional "copy defaults from DRMS" when a PT is created (numbering
  sequences, approval rules, work schedules, categories). Today the seed (`SEED_DATA_FILE` `companies[]` shape) gives
  every seeded PT the default sequences + approval rules; an admin action on `companies` create is open.
- Attendance "Tim hari ini" rows (`TeamTodayRow`) carry no PT id yet (team members do: `TeamMember.companyId`).
- MC3: `/me companies[]`, masters per PT, OpenAPI `X-Company-Ids` header component, APK per-PT sync batches.
- Performance: media office rules build id lists only for callers with the role in a SUBSET of the active PTs;
  measure with Q-34 × 3 PTs in MC4 (E9 p95 target).

---

<!-- UI branch log (feat/mc2-admin-ui), merged 2026-09-28 -->

- **Design:** `../adr/0016-multi-company.md`; work list `impact-inventory.md` §MC2-1…MC2-5; wireframes `wireframes.md`.
- **Two parallel branches:** backend (MC2-1…MC2-3, `feat/mc2-backend`, contract `mc2-contract.md`) and admin UI +
  import (MC2-4/MC2-5, `feat/mc2-admin-ui`). Each branch owns its section below; merge keeps both.
- **Purpose of this file:** resume point for another agent. Updated + committed with every work package.

## UI (MC2-4 admin UI, MC2-5 import) — branch `feat/mc2-admin-ui`

Worktree `/opt/src/proyekkas-wt/mc2-ui`, based on `179be5a` (develop + MC1 + 2FA). Containers of this branch (remove
by exact name only, never `docker … prune`): `pk-mc2u-net`, `pk-mc2u-node` (node:24.21.0-bookworm-slim, worktree at
`/w`), `pk-mc2u-pg` (postgres:16.15-bookworm), `pk-mc2u-mailpit`, `pk-mc2u-pw` (playwright v1.55.0-noble).

| WP | Status | Notes |
|---|---|---|
| UI-1 PT switcher | done | `admin/shell/CompanySwitcher.tsx` + pure state `company-switcher.ts`, `POST /api/v1/me/companies` (cookie), `tests/unit/mc2-switcher.test.ts` |
| UI-2 Master Perusahaan | done | tabs + list columns (member count), group-admin create/deactivate (existing access) |
| UI-3 Matriks role `/admin/akses-pt` | done | `views/AksesPt.tsx` + `components/access/{RoleMatrix.tsx,role-matrix.ts}`, `tests/unit/mc2-role-matrix.test.ts`; atomic batch save = contract TODO |
| UI-4 Employee ↔ PT, pickers per PT | done | PT at the top of master forms, required on employee create when ambiguous, 7 pickers filtered per PT |
| UI-5 PT column + filter (lists, custom views) | done (Payload lists; inbox, transfer queue, LPJ, addendum); Kas/Absensi/Progress rows = backend TODO | `admin/company-list.ts` wrapper (33 collections), `views/pt.tsx` |
| UI-6 Dashboards per PT | layout done, data from backend | `views/pt-breakdown.tsx`; Owner (cash, waiting, budget, completeness) + Finance (cash, verification) tiles read `byCompany` rows defensively |
| UI-7 Import `kode_pt` (MC2-5) | done | sheets Perusahaan + AksesPT, `kode_pt` on 11 sheets, per-PT resolve + cut-over; `tests/unit/mc2-import.test.ts`, `tests/integration/mc2-import.int.test.ts`; templates regenerated (+ 2-PT sample) |

### UI-1 PT switcher (done)

- Server: `admin/shell/modules-server.ts` `loadSwitcher` (active memberships from the request's company context +
  code/name, roles per PT), passed by `ModuleNav` to `ModuleBar`.
- Client: one membership → static code; several → dialog (native checkboxes, "Semua PT saya" tri-state, ≥ 1 PT,
  ↑/↓/Home/End between boxes, Esc = cancel + focus back, focus leaving = cancel), ≤ 768 px bottom sheet portalled to
  `<body>` (the bar's `backdrop-filter` would contain a fixed panel). Terapkan → `POST /api/v1/me/companies` →
  `location.reload()`.
- Endpoint (ADR 0016 §5 "set only by the server"): `{ companyIds: number[] | null }`; null / all memberships → cookie
  cleared (new memberships are then included automatically); foreign PT → 403 `COMPANY_NOT_ALLOWED` + audit
  `access_denied`; cookie `HttpOnly; SameSite=Lax; Secure` (`__Host-` unless `AUTH_COOKIE_INSECURE`), 1 year.
  Documented in OpenAPI (`openapi-companies.ts`, `schemas-companies.ts`) — MC3 may move it next to `/me`.

### UI-2 Master Perusahaan (done)

- `collections/Companies.ts` admin only (no schema change): unnamed tabs Identitas / Operasional / Absensi & retensi /
  Pengingat & notifikasi (every `COMPANY_SETTING_FIELDS` entry in exactly one tab — unit test), list columns
  Kode · Nama · Zona waktu · Anggota (`ui` field + server cell `MemberCountCell`, active memberships) · Aktif · Dibuat,
  search on code/name/legal name. Create + `active` stay group-admin only (MC1 access), shortCode lock unchanged.
- Not built (needs backend): "Saat dibuat: salin penomoran / aturan approval / kategori & jadwal dari DRMS"
  (wireframe §3) → contract TODO.

### UI-4 Employee ↔ PT (done)

- `fields/company.ts`: a CHOSEN PT (`companyField()`) now sits at the top of the form (derived stays read-only in the
  sidebar); `requireCompanyWhenAmbiguous` (Employees: field error "PT wajib dipilih" on create when > 1 PT selected
  — same condition as `defaultCompanyForWrite`); `pickerSameCompany()` = `filterOptions` by the document PT for the
  admin dropdown with the save-time re-read switched off (pattern of `expense-requests.bankAccount`; DB trigger stays
  the guard). Applied: employees.workSchedule, team-assignments.employee/project/costCenter,
  employee-bank-accounts.employee, expense-requests.project/costCenter/requesters. Membership employee picker was
  already per PT (MC1).

### UI-5 PT column + filter (Payload lists done)

- `admin/company-list.ts` `withCompanyListUi` (payload.config.ts): every collection with a top-level `company`
  relationship (30 per-PT + memberships + notifications + audit logs; unit test pins the set) → `company` first in
  `defaultColumns`, cell `CompanyCell` (short-code chip, name in tooltip), `beforeListTable` `CompanyListFilter`
  (only with > 1 PT selected: "Semua pilihan · DRMS · CS1" chips = `where[or][0][and][0][company][equals]`, keeps
  sort/limit/search, "Menampilkan DRMS, CS1 · 42 data"). Users with saved column preferences keep their columns
  (Payload list preferences) until they reset them.

### UI-3 Matriks role (done)

- `/admin/akses-pt` (module Pengguna & Akses, "Akses PT (matriks)", Admin only in the menu; the view itself admits
  Admins of ≥ 1 PT and group admins). Columns = PTs the viewer administers (group admin: all active PTs), narrowed by
  the PT switcher; "Kolom PT" toggles; rows = accounts readable by the viewer (search `q`, `nonaktif=1`, 40 per page).
- Cell = membership: 5 role checkboxes (Staff/PM/Fin/Dir/Adm), employee select (active employees of THAT PT not linked
  to another account there; the current one stays; ↗ opens the employee), "bukan anggota + Tambah". No role left =
  membership inactive (never deleted). Warnings: PT without active Direktur / Finance (wireframe §2, not blocking);
  duplicate employee link blocks saving.
- Save bar: pending count, reason (≥ 3 chars, `changeReason` → audit `role_change` via `withAudit`), Simpan /
  Batalkan. One REST call per changed cell (`POST`/`PATCH /api/company-memberships`); ops in PTs outside the
  viewer's rights are refused client-side before anything is sent; the server re-checks (MC1 access + hooks).
- ≤ 768 px: one card per user, one labelled section per PT.

### UI-5b PT column in custom views (done)

- `views/pt.tsx`: `ptView(req)` (selection + labels), `PtChip`, `PtScopeNote` ("Menampilkan PT: …"), `itemCompany`
  (backend `company` ref when the queue item has it — MC2-1 adds `company { id, shortCode, name }` — else a
  caller-access lookup of the request's `company`), `accountsOf`.
- Approval inbox, transfer queue (+ voidable transfers), LPJ verification: PT column / chip with > 1 PT selected.
  Transfer + settlement forms now offer ONLY cash accounts of the request's PT (before: every readable account → a
  cross-PT choice the DB trigger would reject).
- Addendum list: PT column (PT of the project).

### UI-6 Dashboards (layout done)

- `views/pt-breakdown.tsx` `PerPt`: rows per PT under a combined KPI (only > 1 PT and > 1 row). Owner: cash
  (`cash.byCompany`), waiting (`approvals.byCompany`), running projects per PT (`budget.byCompany`, colour counts,
  never a combined %), completeness (`completeness.byCompany`); Finance: cash (`cashByCompany`), verification
  (`completenessByCompany`). Field names match `mc2-contract.md` §2 (feat/mc2-backend `a15270f`) and are read as
  `unknown` — the single-PT layout renders until the merged payload carries them.

### UI-7 Import per PT (MC2-5, done)

- `import/spec.ts`: sheet `Perusahaan` (kode_pt, nama, nama_legal, alamat, telepon, nomor_pb_mulai), sheet `AksesPT`
  (username × kode_pt → peran, kode_karyawan, aktif), `kode_pt` (type `ptcode`, upper-cased, = `companies.shortCode`
  rule) as FIRST column of Kategori, Karyawan, Pengguna, Rekening, PusatBiaya, Project, Tahapan, RAB, Kendaraan,
  Penugasan, AkunKas; natural keys include the PT; `Pengguna.peran` optional (no role = no membership from that row).
- `parse.ts`: duplicates checked inside a PT; stage weight sums per (PT, project). `resolve.ts`: `defaultPtOf` (only
  PT of the sheet, else only active PT of the DB, else none → `kode_pt` required), unknown / inactive PT errors,
  per-PT reference pools (workbook rows of that PT + DB keys of that PT), cross-PT references named ("ada di PT …"),
  PM / manager must have access in the row's PT, AksesPT checks (unknown user, duplicate of the Pengguna PT,
  employee already linked). `DbKeys` per PT (`PtKeys`) + companies + memberships per user.
- `run.ts`: `Exec.use(row)` switches the per-PT scope (lookups, creates, cache keys per PT); master `perusahaan`
  first (existing PT untouched, new PT + default sequences + approval rules); `aksesPt` after `pengguna`;
  cut-over per PT (`cutovers[]`, PB start per PT); report one cut-over line per PT.
- Template `MC2-5` regenerated (+ `drms-impor-golive-contoh-fiktif-2pt.xlsx`, fictional DRMS + CS1); the default
  sample stays single-PT (DRMS rows with `kode_pt`) so the shared integration DB keeps one active PT.
- Runbook `import-data-golive.md` §4.1.

## Checks (UI branch, containers `pk-mc2u-*`)

- lint, typecheck, `test:coverage` (40 files / 576 tests, lines 40.4 %), `check:openapi`, `check:import-template`,
  `generate:importmap` (no diff), `npm run build` (web + worker) — green.
- Integration (throwaway `pk_test`, Mailpit STARTTLS+AUTH sink as in CI): 36 files / 463 passed + 1 skipped
  (incl. new `mc2-import.int.test.ts`).
- Visual (Playwright v1.55.0 against `next start` of the production build, DB `pk_vis` with fictional PTs DRMS /
  CS1 / CS2 and users Andi (group admin), Rina (Direktur DRMS, Finance CS1/CS2), Budi, Dewi, Sari, Tono, Admin CS1):
  switcher, role matrix, company master, consolidated expense-request list, company form, single-PT switcher,
  employee create error — light + dark, 390 + 1440 px, no horizontal page scroll. Flows verified: switcher
  keyboard + apply (cookie `pk-company-ids=2`, list narrowed), "Semua PT" clears the cookie, PT chip filter, foreign
  PT → 403; matrix add/deactivate/reactivate with reason → audit `create` / `role_change` rows, Admin CS1 sees only
  the CS1 column, non-admin gets the notice.

## Open TODOs / notes (UI)

- **After merging feat/mc2-backend (`mc2-contract.md`):** `Absensi.tsx` `narrow()` → `narrowAttScope` (§0.1,
  cross-PT leak for office users until then); audit-log view → `auditScope(req)`; Tutup buku per PT (`kasAccessIn`,
  `lockDates`, close/reopen with `company`, §4); PT column in the Kas book (`BookRow.companyId`), attendance and
  K-09 progress (`companyId` on rows); switch `itemCompany` fallback lookups to the queue `company` refs (§3);
  report filter `pt` is rendered by the generic multiselect. TODO markers `TODO(mc2-contract …)` in code.
- **Backend asks (not in the contract):** atomic batch endpoint for the role matrix (wireframe "tidak ada simpan
  sebagian"); copy-from-DRMS actions on PT create (the import already seeds numbering + approval rules for new PTs).
