# MC2 — backend ↔ admin UI contract (branch `feat/mc2-backend`)

Owner: MC2 backend agent (domain/**, jobs/**, reports, `/api/v1`). Reader: MC2 admin-UI agent
(`src/admin/**`, `src/import/**`). Everything below is implemented on `feat/mc2-backend`; the UI calls the
domain functions directly (server components) or the `/api/v1` endpoints. ADR 0016 §5/§6, requirements
v1.2 §5/§6.

## 0. Rules the UI must follow

1. **Never build a scope literal from user input.** Build scopes with the domain builders
   (`officeScope`, `attendanceOfficeScope`, `auditScope`, `roleScope`, `teamScope`, `ownScope`,
   `attendanceScope`) and narrow with `narrowScope` / `narrowToCompanies` / `narrowAttScope`.
   A literal `{ kind: 'all' }` (no `companies`) now matches **nothing** (fail closed).
   **Open UI item:** `admin/views/Absensi.tsx` `narrow()` (≈ L653) builds a company-less
   `{ kind: 'team', projects: [id] }` from the query string — for an office user of PT A this matches
   the project id of PT B. Replace it with `narrowAttScope(scope, projectId, costCenterId)`
   (`@/domain/attendance/queries`, also re-exported from `@/domain/attendance/web`).
   `admin/views/Reports.tsx:102` passes `{ kind: 'all' }` to the audit report — harmless now (the audit
   report ignores company-less scopes and uses `auditScope(req)`), but please pass `await auditScope(req)`.
2. **`hasRoleAny` / `req.user.roles` are UI hints only** (union over the selected PTs). For a button on
   a document use `hasRole(req, role, doc.company)`; for a list use the PT sets below.
3. **Mutations name their PT.** `closePeriod` / `reopenPeriod` and `POST /api/v1/period-closings`
   need `company` when the caller holds the role in more than one selected PT (else 400
   "PT wajib dipilih"). Creating masters/requests: the existing MC1 rule (`company` required when > 1
   PT selected).
4. Company labels: `companyRefs(req, ids)` → `{ id, shortCode, name }[]` (`@/domain/companies`).

## 1. Reports (`@/domain/reports/*`, `/api/v1/reports/*`)

- `ReportScope` = `{ kind, …summary, companies: CompanyScope[] }`, `CompanyScope` =
  `{ company, kind: 'all' | 'team' | 'own', … }`. `kind` at the top is the strongest kind (UI hint).
  Helpers: `scopeCompanies(s)`, `ledgerCompanies(s)` (PTs with `all`), `splitScope(s)`,
  `narrowToCompanies(s, ids)`.
- **PT parameter:** query `pt` (repeatable `?pt=1&pt=3` or `?pt=1,3`) narrows every report (never
  widens; foreign ids ignored). `ReportDef.filters()` returns a leading multiselect field
  `{ name: 'pt', label: 'PT', kind: 'multiselect', options: [{ value: '<id>', label: 'CS1 — PT Contoh Satu' }] }`
  when the caller's scope spans > 1 PT — render it like the other multiselects.
- **Result shape:** `TableRow.company?: number | null`. With > 1 PT in the effective scope the tables
  get a leading `pt` column (short code) and `extra` gets a table `key: 'subtotal-pt'`
  ("Subtotal per PT — …", columns `pt`, `nama`, money/int columns; `totals` = Σ of the PTs). Master
  option labels are prefixed `[CS1] ` when > 1 PT. `GET /api/v1/reports/{code}` adds
  `companies: CompanyRef[]`.
- **Exports:** one PT → that PT's letterhead (name, `pdfHeader`, address, phone); > 1 PT → group
  letterhead (`company-settings.groupName` / `groupPdfHeader`; empty → "Laporan gabungan: DRMS, CS1")
  + a line `PT: DRMS (…), CS1 (…)`. PDF metadata: Author = letterhead name, Subject = `PT: DRMS, CS1`.
  XLSX/CSV: title row 2 = letterhead name. `exportLetterhead(req, def, scope, sp)` for the screen header.
- Audit log: `auditScope(req)` = PTs where the caller is Owner/Admin/Finance; rows without PT only for
  Admin/Owner. `AuditRow.companyId`.
- KPI functions (all take a scope now; signature change = scope 2nd argument): `cashBalances(req, scope,
  asOf, accountId?)` (+ `byCompany`), `cashFlowMonthly(req, scope, f, mode)`, `accountMonthFlows(req,
  scope, period, mode)`, `cashBreakdown(req, scope, f)`, `requestMoney(req, scope, id)`,
  `transferQueueSummary(req, scope)` (+ `byCompany`), `masterGaps(req, companyIds)` (+ `byCompany`),
  `lastClosedPeriod(req, companyIds)` → `{ period, byCompany }`. Rows of `projectBudgets`,
  `advancesWithoutLpj`, `requestRows`, `teamWaiting.items`, `ownRequests`, `recentCashEntries`,
  `transferQueueTop`, `costCenterMonth`, `vehicleCosts`, `spending.items`, `projectProgressVsBudget`
  carry `companyId`; `pendingApprovals` / `requestSummary` / `spending` return `byCompany`.
  `perCompany(scope, fn)` runs any KPI per PT; `byCompany(list, value)` sums rows per PT.

## 2. Dashboards (`@/domain/reports/dashboards`, `/api/v1/dashboard/*`)

Each layout reads the PTs where the caller holds THAT role (Owner: `pk-owner` PTs, Finance: `pk-finance`,
PM: `pk-pm` team, Staff: own per PT, Admin: `pk-admin`). New fields (existing fields unchanged = combined
total over those PTs):

| Layout | New fields |
|---|---|
| all | `companies: CompanyRef[]` |
| owner | `cash.byCompany[{companyId,total,monthIn,monthOut}]`, `cash.accounts[].companyId`, `budget.byCompany[{companyId,running,over,warn,ok,none}]`, `completeness.byCompany[…]`, `approvals.byCompany[{companyId,count,sum}]`, `approvals.waitingForMeByCompany`, `transferQueue.byCompany[{companyId,count,sum}]`, `projects[].companyId`, `costCenters[].companyId`, `viz.recentCash[].companyId`, `viz.inbox[].company` |
| finance | `cashByCompany`, `accounts[].companyId`, `transferQueue.byCompany`, `completenessByCompany`, `lastClosedByCompany[{companyId,period}]` (`lastClosedPeriod` = oldest of the PTs' latest), `viz.transferTop[].companyId` |
| pm | `teamMonthByCompany[{companyId,count,sum,waiting}]`, `projects[].companyId`, `teamWaiting.items[].companyId` |
| me (staff) | `actions[].companyId`, `latest[].companyId` |
| admin | `gaps.byCompany[{companyId,usersIncomplete,projectsWithoutPm,costCentersWithoutManager}]`, `gaps.usersWithoutMembership`, `latestAudit[].companyId` |

Invariant (tested): Σ `byCompany` = combined total.

## 3. Queues (`@/domain/expense/queues`)

`approvalInbox(req, { companyIds? })`, `transferQueue(req, { companyIds? })`, `lpjQueue(req, { companyIds? })`
(new), `transferQueueCount` / `lpjQueueCount(req, { companyIds? })`. Items carry
`company: { id, shortCode, name } | null`; `approvalInbox` items' `budget.warnPct` is the item PT's
threshold. `companyIds` = UI PT filter (narrows only). Rows are already limited to the selected PTs
where the caller's role grants read access.

## 4. Kas (`@/domain/cash/*`, `/api/v1` cash)

- `kasAccessIn(req)` → `{ view, write, close, reopen }: number[]` (PT ids) — use it instead of
  `kasAccess(user)` (kept as "any PT" hint).
- `balances(req, asOf?, { companyIds? })` → items `+ companyId`; default = selected PTs where the caller
  is Finance/Direktur. Combined balance = Σ per PT (show both).
- `accountFlows(req, period, companyIds?)`, `periodSummaries(req, periods, companyIds?)` — pass ONE PT
  for the "Tutup buku" screen (closing is per PT).
- `currentLockDate(req, companyId)` (pass the PT!), `lockDates(req, companyIds)` → `[{ companyId, lockDate }]`.
- `closePeriod(req, period, note, companyId)` / `reopenPeriod(req, period, reason, companyId)`.
- `BookQuery.pt` (Kas list PT filter), `BookRow.companyId`, lookup `Option.companyId` (filter the form
  pickers by the chosen PT — the DB rejects cross-PT references anyway).
- API: `GET /cash-accounts/balances?company=`, `GET /period-closings?company=` → `lockDates[]`
  (+ `lockDate` when one PT), `POST /period-closings { period, note?, company? }`,
  `POST /period-closings/{period}/reopen?company=`; `PeriodClosing.companyId`.

## 5. Attendance (`@/domain/attendance/*`)

- `AttScope` = `{ kind, … , parts: AttPart[] }`, `AttPart = { company, all, projects, costCenters }`.
  `attendanceScope(req)`: Admin/Owner/Finance of a PT → that PT in full; PM → team there.
- `narrowAttScope(scope, projectId?, costCenterId?)` (see rule 1), `fullCompanies(scope)`.
- `recapEmployees`, `scopeLocations`, `teamTodayFor` are per PT; `mayCorrect(req, scope, employeeId,
  companyId?)` — pass the employee's PT. `myRecap(req, month, companyId?)` (employee of that PT;
  default: first selected membership with an employee). `employeeRef` returns `companyId`.
- `attendanceContext(req, companyId?)` — settings (TZ/default schedule) of that PT.

## 6. Progress

`projectProgressVsBudget` rows carry `companyId`; colour thresholds per project PT.

## 7. Changelog of this contract

- 2026-09-28: initial (reports, dashboards, queues, kas, attendance).
