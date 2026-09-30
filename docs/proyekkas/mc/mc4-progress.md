# MC4 — progress log (multi-company: code gaps before MC4 QA)

- **Design:** `../adr/0016-multi-company.md` (+ "Implementation notes (MC4 code gaps)"); requirements
  `../requirements-v1.2.md` US-MC-01…19; open items carried from `mc2-progress.md` §Remaining and `mc3-progress.md`
  §Residual / §API gaps.
- **Branch:** `feat/mc4-code-gaps` (worktree `/opt/src/proyekkas-wt/mc4-code`, based on `develop` `5415f45`). Web/API
  only — `apps/mobile` untouched (released APK 0.2.x / 0.3.0 stay compatible, see §Released APK).
- **Purpose of this file:** resume point for another agent + evidence for MC4 QA.

## How to run (host has no node)

Containers of this branch (remove by exact name only, never `docker … prune`): `pk-mc4code-net`, `pk-mc4code-node`
(node:24.21.0-bookworm-slim, `--memory 3g`, worktree at `/w`), `pk-mc4code-pg` (postgres:16.15-bookworm, bootstrap
`apps/web/test-env/ci-bootstrap.mjs`), `pk-mc4code-mailpit` (CI replica: STARTTLS + AUTH, throwaway CA, certificate
SAN = `pk-mc4code-mailpit` = the host name the tests use). Throwaway passwords / certs in the agent scratchpad only.
Semgrep = CI `security` job command (semgrep/semgrep:1.177.0, `p/owasp-top-ten`, `p/typescript`,
`.semgrep/proyekkas.yml`).

## Status

| # | Item | Status | Design choice | Where |
|---|---|---|---|---|
| 1 | "Copy defaults from DRMS" on PT create (US-MC-01) | done | afterChange on `companies` create, same transaction (a PT never exists without numbering); virtual create-only fields "Salin default saat dibuat" (default on) + "Salin dari PT" (default #1 DRMS); idempotent; audited; seed/import keep their built-in defaults (`SKIP_COMPANY_DEFAULTS`) | `domain/company-defaults.ts`, `collections/Companies.ts`, `seed/seed.ts`, `import/run.ts` |
| 2 | Optional body `company` on `/api/v1` creates | done | `ExpenseRequestCreate`, `ProgressReportCreate`, `BudgetAddendumCreate` + `CashEntryCreate` (the other create that inferred its PT); membership + role IN that PT else 403 `COMPANY_NOT_ALLOWED` (audited); references of another PT → 400 `COMPANY_MISMATCH`; handler + response under that PT; absent = unchanged | `api/v1/named-company.ts`, `access/company-context.ts` (`runUnderCompany`, now shared with sync), endpoints `expense-requests`, `progress`, `addenda`, `cash`, schemas |
| 3 | `GET /app/config` flags per PT | done | public flags = OR over ACTIVE PTs (no PT id/name/count leaves the endpoint), `timezone` = server TZ; per-PT truth = `/me companies[].settings`; server enforces the item PT's flag | `api/v1/endpoints/app.ts` (`publicFlags`), `schemas-sync.ts` (`AppConfig` descriptions) |
| 4 | Group logo in report PDFs | done | PT logo / `groupLogo` left of the kop; image loader shared with the document PDF (`pdf/images.ts`: JPEG/PNG ≤ 3 MiB, else text only) | `pdf/ReportPdf.tsx`, `pdf/images.ts`, `domain/reports/export.ts` |
| 5 | Notification-template ownership | done | create/update = group admin; PT Admin / Direktur read; recorded as "default, owner may override" | `collections/NotificationTemplates.ts` |
| 6 | Media-access performance with 3 PTs | **not done → MC4 QA** | see §Open | — |
| a | Dashboard per-PT fields for the APK | done | payloads already carried them; now in OpenAPI (+ `viz.warnPctByCompany`), responses validated against the schemas in the integration test | `api/v1/schemas-reports.ts`, `domain/reports/dashboards.ts` |
| b | company #1 fallbacks (inbox `budgetWarnPct`, K-09 thresholds) | done | `contextCompanyId` = only / LOWEST selected PT of the caller (never a PT without membership); items carry `budget.warnPct`, K-09 rows `warnGapPct` / `badGapPct` | `domain/companies.ts`, `domain/reports/progress.ts`, `schemas-flow.ts`, `schemas-progress.ts` |
| c | Legacy scope literals | done (removed) | a `ReportScope` without `companies` / `AttScope` without `parts` matches nothing for EVERY kind; `mayCorrect` → false | `domain/reports/scope.ts`, `registry.ts`, `attendance-report.ts`, `attendance/queries.ts`, `attendance/web.ts` |
| d | PT column hidden by saved list columns | done (cheap) | data migration `20260930_120000_mc4_list_company_column`: prepends `company` (active) to saved list columns that never named it; a deliberately hidden PT column stays hidden | `migrations/20260930_120000_mc4_list_company_column.ts` |

### 1 — copy defaults: what exactly is copied

| Part | Rule |
|---|---|
| Document sequences | every doc type of the source PT (+ ADR 0007 defaults for a missing one): code, pattern, reset, padding, active; `startAt` = 1, timezone = the new PT's. DRMS PB 229 is DRMS's paper series; Q-54 decides other start values — the Admin sets "Nomor awal" before the first document |
| Approval rules | rules of the source WITHOUT per-PT references (project, category, cost center, named "Diketahui"/approver user) that today's rule checks accept (no retired `scope_manager`, decision roles only, levels 1..n); skipped rules are listed in the audit summary; a doc type without a copied rule gets the ADR 0013 defaults |
| Work schedule | the source's `defaultWorkSchedule`, copied by name into the new PT and set as its default |
| Settings | every `COMPANY_SETTING_FIELDS` value of the new PT that still equals the field default takes the source's value (a value typed in the create form is kept) |
| Not copied | expense categories, cash accounts, projects, vendors … (client data per PT: import sheet / masters) |

## Released APK (mobile-v0.2.x / 0.3.0) compatibility

| Change | Effect on the released APK |
|---|---|
| body `company` (optional) | none — absent = the pre-MC4 derivation (asserted: single-PT bearer create, multi-PT create with a project) |
| `/app/config` OR flags | one PT = identical answer; several PTs = a feature on in any PT is advertised, the server still refuses items of a PT that has it off (`FEATURE_DISABLED`, final rejection as before) |
| dashboards / inbox / K-09 new keys | additive; parsers ignore unknown keys |
| inbox `budgetWarnPct` / K-09 top-level / dashboard `warnPct` | one PT = identical; several PTs = the lowest selected PT instead of #1 (items / rows unchanged) |
| notification templates, list columns, legacy scopes | web only |

## Checks

Run on the tree of commit `0c62e8f` (code identical to the pushed head; the docs commit only adds this file + docs):

- Baseline (develop `5415f45`, MC3 end): unit 43 files / 593 tests; integration 39 files / 512 + 1 skipped.
- `npm run lint` 0 warnings · `npm run typecheck` clean · `npm run test:coverage` **45 files / 647 tests** green
  (gate met: statements 37.89 %, lines 39.32 %) · `npm run check:openapi` up to date (regenerated) ·
  `npm audit --omit=dev --audit-level=high` exit 0 (6 moderate + 1 low, unchanged, Payload-pinned).
- `TZ=Asia/Makassar npm run test:int` (CI replica: throwaway pg 16.15, ci-bootstrap, Mailpit STARTTLS+AUTH):
  **40 files / 528 passed + 1 skipped** (incl. `mc4-code` 15 tests; isolation suites `mc-isolation`,
  `mc2-isolation`, `mc2-integration`, `mc3-api` green).
- Found on the way: the first full run failed `audit.int` only because `mc4-code` had written `groupName` to the
  shared global before it (order dependency, the audit test reads the FIRST `groupName` row) — the PDF test no
  longer touches `groupName`; re-run green.
- semgrep 1.177.0 (CI `security` rules incl. `payload-local-api-implicit-override-access`): 0 findings.
- `payload generate:types` → `payload-types.ts` (virtual company fields); no new admin components (import map
  unchanged). `apps/mobile` untouched (no dart format needed). No new dependency.

## Evidence

- Unit: `tests/unit/mc4-code.test.ts` (public flags, create schemas + OpenAPI, dashboard/threshold fields,
  legacy-scope SQL = `FALSE`, template access matrix, setting fields, migration slug list = PT collections, virtual
  fields, ReportPdf logo embedded / absent); updated `f3-reports`, `e6-attendance`, `mc2-integration`,
  `e4-progress-ui` for the removed legacy literals / new K-09 fields.
- Integration: `tests/integration/mc4-code.int.test.ts` (PTs DRMS + fictional CS8 / CS9 + created MC4X / MC4Y /
  MC4Z, all but DRMS deactivated in `afterAll`):
  - MC4-1 copy defaults (sequences start 1 + same doc types as the source, rules minus skipped, schedule, settings at
    default copied / chosen kept, audit summary in the create transaction, 1/PB-MC4X numbering at once), idempotent
    re-run, "Salin dari PT" + opt-out, PT Admin → 403 (Local API + REST, nothing written);
  - MC4-2 body company (header A + body B → B; Finance-only PT; same-PT 201 / other-PT 400 `COMPANY_MISMATCH` with
    nothing stored; 403 `COMPANY_NOT_ALLOWED` without membership / role for all 4 creates, audited; progress /
    addendum / cash created in the named PT; released-APK bearer create);
  - MC4-3 `/app/config` (A off + B on → on; no PT names; `/me` per-PT values; back to off);
  - MC4-4 PDF (PT logo embedded; group letterhead without / with `groupLogo`);
  - MC4-5 templates (PT Admin read 200 / create + update 403; group admin create + update; Finance no access);
  - extra: dashboards validated against the OpenAPI zod schemas, Σ `byCompany` = totals, `warnPctByCompany`,
    top-level = lowest selected PT; inbox `items[].budget.warnPct`; K-09 per-row thresholds; list-column migration
    (missing → prepended, hidden → kept, shared master untouched, idempotent).
- Isolation suites (`mc-isolation`, `mc2-isolation`, `mc2-integration`, `mc3-api`) green in the full run; the MC2
  Absensi "regression witness" now asserts that the company-blind literal matches nothing.

## Open → MC4 QA

- **Media-access performance with 3 PTs** (MC2 note 4, not measured here): office users holding a role in a SUBSET of
  the active PTs get id-list rules on the media collections. Measure with the Q-34 k6 mix (`tests/load/q34-mix.js`)
  against staging data with 3 active PTs and a Finance user of 2 of them (E9 p95 target); if p95 misses, add a
  `company_id` column to the media tables (migration + backfill from the owner document).
- Visual check of the company form ("Salin default saat dibuat" / "Salin dari PT" in the sidebar, create only) and of
  a report PDF with a real PT / group logo — not screenshotted in this session.
- Owner decisions: notification-template ownership (default: group admin), `startAt` 1 for copied sequences (Q-54),
  OR semantics of the public feature flags.
