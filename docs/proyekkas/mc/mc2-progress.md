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
