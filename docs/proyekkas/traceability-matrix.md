# ProyekKas — Traceability Matrix (US → module → collections → API → screen → phase → test)

Date: 2026-09-23 (F2 implementation status added 2026-09-24; multi-company rows US-MC-01…19 added 2026-09-27, see last section) · Source: `requirements-v1.1.md` (US-01..US-59), collection slugs from `f0-brief.md` §3.

Conventions:
- **Collections**: Payload collection slugs as proposed in `f0-brief.md` §3 (ADR may refine). `media-*` = upload collections split by resize policy.
- **API**: `/api/v1/...` = custom domain-action endpoint. Paths listed in `f0-brief.md` §3 are marked (brief); all others are **proposed** by the Analyst and must be confirmed by the API ADR. "Payload REST" = Payload's generated `/api/<slug>` CRUD; whether the APK may call it is undecided (brief §3) → such rows carry **TBD-architecture**.
- **Screen**: `web admin` = Payload admin panel (CRUD); `web dashboard` = custom Next.js pages/views; `APK` = Flutter app.
- **Phase** (assumed, pending Lead's phase plan): F1 foundation (auth, users/roles, masters, audit log, numbering, media) · F2 core request flow (T1–T8, approvals/signatures, PDF, receipt validation, period closing) · F3 web dashboards/reports/export · F4 APK · F5 project/progress/attendance/vehicle reports (T9–T12) · F6 hardening/UAT/release · F7 post-release (Odoo mirror, OCR). A story whose server logic lands in F2 but whose APK screen lands in F4 is listed as "F2 (API) / F4 (APK)".
- **Test type**: unit (service/hook logic), API (HTTP-level incl. negative authz tests), e2e (Playwright web / Flutter integration), manual (UAT/visual).
- Any mapping marked **TBD-architecture** depends on a decision the architecture/ADR agent owns.

**MC4 code gaps (2026-09-30, branch `feat/mc4-code-gaps`):**

| US | MC4 status | Evidence |
|---|---|---|
| US-MC-01 | "copy defaults from DRMS" on PT create done: sequences (start 1), copyable approval rules, default work schedule, settings still at default; source selectable ("Salin dari PT"), opt-out; idempotent; audited in the create transaction; PT Admin cannot create a PT | `mc4-code.int.test.ts` (MC4-1), `mc4-code.test.ts` (setting fields, virtual fields) |
| US-MC-05 | `GET /app/config` flags = OR over active PTs (no PT data on the public endpoint); per-PT truth `GET /me companies[].settings` | `mc4-code.int.test.ts` (MC4-3), `mc4-code.test.ts` (`publicFlags`) |
| US-MC-07 | optional body `company` on the 4 `/api/v1` creates: role IN that PT (403 `COMPANY_NOT_ALLOWED`, audited), references of another PT → 400 `COMPANY_MISMATCH`; released APK bodies unchanged | `mc4-code.int.test.ts` (MC4-2), `mc4-code.test.ts` (schemas) |
| US-MC-10 | dashboards: per-PT fields documented for the APK (`companies`, `byCompany`, `companyId`, `viz.warnPctByCompany`), responses validated against the schemas | `mc4-code.int.test.ts` (extra), `mc4-code.test.ts` (OpenAPI) |
| US-MC-11 | report PDF letterhead logo (PT logo; group logo on consolidated reports) | `mc4-code.int.test.ts` (MC4-4), `mc4-code.test.ts` (ReportPdf image) |
| US-MC-12 | inbox / K-09 thresholds per item/row; no company #1 fallback for non-members | `mc4-code.int.test.ts` (extra) |
| US-MC-13 | PT column shown to users with saved list columns (migration `20260930_120000_mc4_list_company_column`) | `mc4-code.int.test.ts` (extra d), `mc4-code.test.ts` (slug list = PT collections) |
| US-MC-14 | company-blind scope literals match nothing for every kind (reports + attendance) | `mc4-code.test.ts` (SQL FALSE), updated `mc2-integration`, `s2b`, `f3-kpi-reconciliation`, `f3-reports`, `e6-attendance` tests |
| US-MC-18 | notification templates (app-wide): create/update group admin only, PT Admin / Direktur read — default decision, owner may override | `mc4-code.int.test.ts` (MC4-5), `mc4-code.test.ts`, `authz.int.test.ts` (matrix unchanged: test Admins are group admins) |

| US | Module | Roles | Payload collections | API | Screen | Phase | Test type |
|---|---|---|---|---|---|---|---|
| US-01 | M11 | Staff | `attendances`, `projects`, `cost-centers` (geofence Q-40), `work-schedules`, `media-selfies`, `devices`, `audit-logs` | `POST /api/v1/sync/batch` items `attendance.check_in` / `attendance.check_out` (payload `project_id` XOR `cost_center_id`); `POST /api/v1/media/selfies` — **E6 backend done** (`domain/attendance/record.ts`) | APK | F4b slice + E6 (API) / E6-APK S2 | unit `e6-attendance.test.ts`, `f4b-mobile.test.ts`; API `f4b-attendance.int.test.ts`, `e6-attendance.int.test.ts` (cost-center geofence, distance in rejection); e2e APK; manual (mock location) |
| US-02 | M11 | Staff | `attendances`, `devices` | `POST /api/v1/sync/batch` (brief) — offline flag, server-estimated time (F4b) | APK | F4 | unit (offline merge), API `f4b-attendance.int.test.ts`, e2e (airplane-mode) |
| US-03 | M03 | Staff, PM, Admin | `expense-requests` (+`lines`), `projects`, `cost-centers`, `employee-bank-accounts`, `expense-categories`, `uoms` | Payload REST `POST /api/expense-requests` (draft) **TBD-architecture**; `POST /api/v1/expense-requests/{id}/submit` (brief) | APK, web dashboard | F2 (API) / F4 (APK) | unit (grand total, project XOR cost center), API (validation errors), e2e |
| US-04 | M03 | Staff, Admin (creator) | `expense-requests`, `approvals`, `audit-logs` | `POST /api/v1/expense-requests/{id}/withdraw`, `/cancel` (proposed); draft edit via Payload REST **TBD-architecture** | APK, web dashboard | F2 / F4 | unit (state guard), API (edit after decision → rejected) |
| US-05 | M03, M12 | Staff | `expense-requests`, `notifications`, `devices` | `GET /api/v1/expense-requests/{id}` (proposed, includes timeline) | APK, web dashboard | F2 / F4 | API, e2e, manual (push) |
| US-06 | M03 | Staff | `expense-requests` | `POST /api/v1/expense-requests/{id}/resubmit` (proposed; clones into new draft) | APK, web dashboard | F2 / F4 | unit (clone incl. lines/requesters), API |
| US-07 | M06 | Staff | `receipts`, `media-receipts`, `expense-requests` | `POST /api/v1/expense-requests/{id}/receipts` (proposed) or Payload upload REST **TBD-architecture** | APK, web dashboard | F2 / F4 | unit (resize, totals), API, e2e |
| US-08 | M06 | Staff | `settlements`, `receipts` | `POST /api/v1/expense-requests/{id}/lpj/submit` (brief `/lpj/submit`) | APK, web dashboard | F2 / F4 | unit (Uang Muka only), API |
| US-09 | M11 | Staff | `attendances`, `attendance-corrections`, `work-schedules`, `holidays` | `GET /api/v1/attendance/me?month=YYYY-MM` — **E6 backend done** (days, duration, late/early minutes, holiday/off-day flags, on-behalf, corrections); `GET /api/v1/attendance/recap?employee_id=&month=` (PM team / office) | APK, web `/admin/absensi/rekap` (**S2 web done**: calendar, day detail, team grid, Staff own recap) | E6 (API) / S2 (APK + web) | unit (lateness table, recap numbers, calendar classes `s2b-attendance-web.test.ts`); API `e6-attendance.int.test.ts` (recap = SQL reconciliation, scope) |
| US-10 | M09 | PM | `progress-reports`, `project-stages`, `media-progress-photos` | `POST /api/v1/progress-reports` (proposed) | APK, web dashboard | F5 | unit (weight × % recompute, ≤5 photos), API, e2e |
| US-11 | M09, M12 | PM | `progress-reports`, `notifications`, `company-settings`, `reminder_deliveries` | Payload job `dailyReminders` (hourly tick, one run/day at `reminderHour`) — **E7 done (S2)**: late progress, LPJ overdue, revision pending, budget threshold; one notification per recipient/rule/day | in-app (+ email when enabled) | E7 / S2 | unit (schedule, fake clock); API `s2b-attendance-web-reminders.int.test.ts` (fake clock, idempotent, inactive/archived excluded) |
| US-12 | M02, M08 | PM, Owner | `projects`, `project-stages`, `cash-entries`, `expense-requests` | `GET /api/v1/dashboard/pm` (proposed) | web dashboard, APK | F3 / F4 | unit (colour thresholds), e2e |
| US-13 | M11 | PM | `attendances`, `team-assignments` | `GET /api/v1/attendance/team-today?date=&project_id=&cost_center_id=` — **E6 backend done** (belum absen / hadir / selesai; PM team, office all) | APK, web `/admin/absensi` + Beranda PM widget (**S2 web done**) | E6 (API) / S2 | unit (status/counts); API (team scope, filters outside team → empty, staff 403) |
| US-14 | M11 | PM | `attendances` (`source = pm`, `recordedBy`, `onBehalfReason`), `media-selfies` | `POST /api/v1/sync/batch` item `attendance.on_behalf` (payload `SyncOnBehalfPayload`; replaces the proposed `POST /attendance/on-behalf` — one offline-capable write path) — **E6 backend done** | APK (S2) | E6 (API) / S2 (APK) | unit (payload); API (staff / other-team PM / own / unassigned / foreign selfie / mock / no reason → rejected; DB CHECK) |
| US-15 | M11 | PM, Admin | `attendance-corrections` (append-only), `attendances`, `audit-logs` | `POST /api/v1/attendance/{id}/correct` `{new_time, reason}` (Idempotency-Key) — **E6 backend done**; direct correction by the team PM or Admin, no approval step (requirements §4/§7 T10) | web `/admin/absensi/rekap` correction dialog + history (**S2 web done**), APK (S2) | E6 (API) / S2 | unit (reason required); API (400 without reason / other date / order, 403 Finance/Direktur/own, 404 other PM, audit old → new, append-only DB) |
| US-16 | M10 | PM, Owner, Admin | `team-assignments`, `employees` | Payload REST `/api/team-assignments` (web admin) | web admin, web dashboard | F5 | API (PM scope), e2e |
| US-17 | M03 | PM | `expense-requests` | `GET /api/v1/expense-requests?scope=team` (proposed) | APK, web dashboard | F2 / F4 | API (other PM's project → 403/empty; approve → rejected) |
| US-18 | M08 | PM | `budget-addenda`, `approvals` | `POST /api/v1/budget-addenda` (proposed), `/submit` | web dashboard | F5 | unit, API |
| US-19 | M05 | Finance | `expense-requests` | `GET /api/v1/transfer-queue` (proposed) | web dashboard | F2 / F3 | API (both request types), e2e |
| US-20 | M05, M07 | Finance | `transfers`, `cash-entries`, `media-transfer-proofs`, `cash-accounts` | `POST /api/v1/expense-requests/{id}/transfer` (brief) | web dashboard | F2 | unit (auto cash-out, no delete), API (amount ≠ approved → rejected) |
| US-21 | M06 | Finance | `settlements`, `receipts` | `POST /api/v1/settlements/{id}/verify`, `/request-revision` (proposed) | web dashboard | F2 | unit, API |
| US-22 | M06, M07 | Finance | `settlements`, `cash-entries`, `transfers` | `POST /api/v1/expense-requests/{id}/settle` (brief `/settle`) | web dashboard | F2 | unit (surplus → cash-in, deficit → reimburse transfer), API |
| US-23 | M07 | Finance | `cash-entries`, `cash-accounts`, `cash-in-sources`, `expense-categories` | `POST /api/v1/cash-entries` (proposed) | web dashboard | F2 | unit, API (closed period → rejected) |
| US-24 | M07 | Finance | `cash-reversals`, `cash-entries`, `audit-logs` | `POST /api/v1/cash-entries/{id}/void` (brief) | web dashboard | F2 | unit (reversal entry), API (hard delete → rejected) |
| US-25 | M13 | Finance, Owner | `cash-entries`, `expense-requests` (lines), `cost-centers` | `GET /api/v1/reports/cash-summary` + export (proposed) | web dashboard | F3 | unit (aggregation by line category), e2e (Excel download) |
| US-26 | M04 | Direktur (acknowledge) / Finance (approve), ADR 0013 | `approvals`, `expense-requests`, `receipts`, `media-signatures` | `POST /api/v1/expense-requests/{id}/approve`, `/reject` (brief) | APK, web dashboard | F2 / F4 | unit (budget impact), API (requester approves own → rejected), e2e |
| US-27 | M02 | Owner | `cash-entries`, `cash-accounts`, `expense-requests`, `settlements` | `GET /api/v1/dashboard/owner` (proposed) | web dashboard, APK | F3 / F4 | API, e2e; layout: prototype not available → manual |
| US-28 | M02, M13 | Owner | `cash-entries` | `GET /api/v1/reports/cash-monthly` (proposed) | web dashboard | F3 | unit, e2e |
| US-29 | M08 | Owner | `projects`, `project-stages`, `stage-templates` | Payload REST `/api/projects` (web admin) + archive action `POST /api/v1/projects/{id}/archive` (proposed) | web admin | F1 (masters) / F5 (stages) | unit (weights = 100%), API (delete with transactions → rejected) |
| US-30 | M08 | Owner | `budget-addenda`, `approvals`, `projects` | `POST /api/v1/budget-addenda/{id}/approve` (proposed) | web dashboard, APK | F5 | unit, API |
| US-31 | M09 | Owner | `progress-reports`, `media-progress-photos` | `GET /api/v1/progress-reports` (proposed) | web dashboard, APK | F5 | API, e2e |
| US-32 | M01, M14 | Admin | `users`, `employees`, `devices` + Keycloak realm `drms` | Payload REST `/api/users` (web admin); Keycloak Admin API for disable/revoke **TBD-architecture** | web admin | F1 | API (inactive user → login rejected), e2e |
| US-33 | M14 | Admin, Finance | all master collections | Payload REST `/api/<slug>` (web admin) | web admin | F1 | unit (in-use → delete rejected), API |
| US-34 | M14, M04 | Admin | `approval-rules` | Payload REST `/api/approval-rules` (web admin) | web admin | F1 (master) / F2 (engine) | unit (rule resolution, snapshot), API |
| US-35 | M15 | All | `audit-logs` | `GET /api/v1/audit-logs?doc_type=&doc_id=` (proposed) | web dashboard, APK | F1 (writer) / F3 (UI) | unit (append-only, DB-level update/delete rejected), API |
| US-36 | M03 | Staff, PM, Admin | `expense-requests` | `POST /api/v1/expense-requests/{id}/submit` (brief) | APK, web dashboard | F2 / F4 | unit (type-specific state machine), API (type change after submit → rejected) |
| US-37 | M03 | Staff, PM, Admin | `expense-requests` (`lines`), `uoms`, `expense-categories`, `vehicles` | draft save via Payload REST **TBD-architecture** / `/api/v1` | APK, web dashboard | F2 / F4 | unit (seed grand total 1.447.500; line total user-entered, unit price informational — Q-05 answered), API |
| US-38 | M03, M06 | Staff | `receipts`, `media-receipts`, `expense-requests` | `POST /api/v1/expense-requests/{id}/submit` (brief) | APK, web dashboard | F2 / F4 | API (Reimburse line without receipt → rejected), e2e |
| US-39 | M06 | Finance | `receipts`, `expense-requests` | `POST /api/v1/expense-requests/{id}/receipts/verify`, `/request-receipt-revision` (proposed) | web dashboard | F2 | unit (open flags block "Nota Terverifikasi"), API |
| US-40 | M03 | Staff, Admin | `expense-requests`, `employees` | submit (brief) | APK, web dashboard | F2 / F4 | unit (requester set), API (any requester approves → rejected) |
| US-41 | M03 | Admin, Finance (per Q-09) | `expense-requests`, `users` | Payload REST create **TBD-architecture**; submit (brief) | web admin or web dashboard **TBD-architecture** | F2 | API (client-supplied creator ignored), unit |
| US-42 | M04 | Direktur (`pk-owner`, ADR 0013; was PM / cost-center head per Q-07) | `approvals`, `approval-rules`, `media-signatures` | `POST /api/v1/expense-requests/{id}/acknowledge` (proposed) | APK, web dashboard | F2 / F4 | unit (step ordering), API (non-designated user → rejected) |
| US-43 | M04, M01 | All signers | `approvals`, `media-signatures`, `users` | multipart on approve/acknowledge (proposed) | APK, web dashboard | F2 / F4 | unit (snapshot immutability), API, manual (draw on screen) |
| US-44 | M03 | Staff, Admin | `employee-bank-accounts`, `banks`, `expense-requests` | submit (brief) | APK, web dashboard | F2 / F4 | API (non-requester account → rejected), unit (snapshot) |
| US-45 | M14 | Admin | `document-sequences` | Payload REST `/api/document-sequences` (web admin); number issued inside submit | web admin | F1 | unit (token rendering → `228/PB-DRMS/20/IX/2026`), API (50 parallel submits → unique numbers) |
| US-46 | M16 | Finance, Owner, Admin, PM, Staff | `expense-requests`, `approvals`, `receipts`, `media-receipts`, `company-settings` | `GET /api/v1/expense-requests/{id}/pdf` (proposed); PDF engine **TBD-architecture** | web dashboard (+ APK per Q-16) | F2 | unit (content/totals), manual (visual vs client form), API (authz) |
| US-47 | M06 | Finance | `receipts`, `expense-requests`, `company-settings` | computed on submit/receipt upload (proposed service) | web dashboard, APK | F2 | unit (seed: Rp 124 → info at tolerance 1.000) |
| US-48 | M06 | Finance | `receipts`, `expense-requests` | same service as US-47 | web dashboard | F2 | unit (seed: 21/09 receipts flagged, 20/09 hotel not) |
| US-49 | M06, M14 | Finance, Admin | `uoms`, `expense-categories`, `expense-requests` | same service; `uoms` via Payload REST (web admin) | web admin, web dashboard | F1 (master) / F2 (flag) | unit (seed: BBM "bulan" flagged) |
| US-50 | M06 | Finance | `receipts`, `media-receipts` | same service | web dashboard | F2 | unit + API (re-upload Soto TX0101.0001.000123 → flag) |
| US-51 | M17 | Admin | `vehicles`, `expense-requests` (`lines`) | Payload REST `/api/vehicles` (web admin) | web admin, APK (picker) | F1 | unit (plate normalisation, uniqueness), API |
| US-52 | M17, M13 | Owner, Finance | `expense-requests` (`lines`), `cash-entries`, `vehicles` | `GET /api/v1/reports/vehicle-costs` (proposed) | web dashboard | F5 | unit (seed DA1234XY = Rp 600.000), e2e (export) |
| US-53 | M03, M14 | Staff, PM, Admin | `cost-centers`, `expense-requests`, `team-assignments` | Payload REST `/api/cost-centers` (web admin); submit (brief) | web admin, APK, web dashboard | F1 (master) / F2 (link) | API (both/neither set → rejected), unit |
| US-54 | M19 | Staff, Finance | `receipts`, `media-receipts` | `POST /api/v1/receipts/ocr` (proposed); OCR engine **TBD-architecture** | APK, web dashboard | F7 | manual (accuracy report on 3 seed receipts) |
| US-55 | M14 | Admin | all master collections, `users` | Payload REST `/api/<slug>` | web admin | F1 | API (negative authz per role), e2e |
| US-56 | M01 | All | `users`, `devices` + Keycloak realm `drms` | OIDC Auth Code + PKCE; revocation mechanism **TBD-architecture** | web admin, web dashboard, APK | F1 (web) / F4 (APK) | e2e (login), API (revoked session → rejected), manual |
| US-57 | M06, M09, M11 | All uploaders | `media-receipts`, `media-selfies`, `media-transfer-proofs`, `media-progress-photos`, `media-signatures`, `media-company` | upload endpoints (above) | APK, web admin | F1 (server resize) / F4 (device resize) | unit (4000×3000 → ≤ target, EXIF GPS stripped), manual (legibility) |
| US-58 | M18 | Admin, Owner, Finance | `odoo-outbox` + all mapped collections | worker → Odoo 19 JSON-2 `POST /json/2/<model>/<method>` (brief); Odoo model mapping **TBD-architecture** | web admin (sync status) | F1 (outbox schema) / F7 (worker) | unit (outbox in same tx), API/integration (idempotent resend) against Odoo staging |
| US-59 | M04 | Owner, approvers | `approvals`, `receipts`, `expense-requests` | `GET /api/v1/expense-requests/{id}` (proposed) | APK, web dashboard | F2 / F4 | API (flag count stored on decision), e2e |

Coverage check: US-01..US-35 (v1.0) and US-36..US-59 (v1.1) each appear exactly once above.

## F2 implementation status (2026-09-24, `develop` `59ba0a4`, deployed to staging)

The table above is the F0 plan and is kept unchanged; this section records what F2a/F2b/F2c actually built.
"Web" = Payload admin panel incl. the F2b custom views (`/admin/persetujuan`, `/admin/antrian-transfer`,
`/admin/verifikasi-lpj`, "Riwayat" tab) and the F2c requester actions/timeline. APK screens remain **F4** for
every row. Test files are under `apps/web/tests/` (`int` = `integration/*.int.test.ts`, `unit` = `unit/*.test.ts`).
Implemented paths replace the "proposed"/**TBD-architecture** entries above where they differ (e.g. drafts are
created via `POST /api/v1/expense-requests` or the admin form, not the APK on generic REST).
Manual UAT by the user is in progress for all rows (F2 gate pending).

| US | Status | Implemented as | Test type (files) |
|---|---|---|---|
| US-03 | implemented (API + web) | `POST/PATCH /api/v1/expense-requests`; admin form runs the same `validateContent` (F2c) | unit + API (`expense-flow`, `f2c-requester-web`) |
| US-04 | implemented (API + web) | `…/{id}/withdraw`, `/cancel` (reason); draft edit via PATCH / admin form | unit + API (`expense-flow`, `f2c-requester-web`) |
| US-05 | implemented (API + web); push F4 | `GET …/{id}` + `/history`, in-app `GET /api/v1/notifications`; web timeline (F2c) | API (`lpj`, `expense-flow`), unit (`f2c-panel`) |
| US-06 | implemented (API + web) | `…/{id}/resubmit` → new Draft with `resubmitOf`, new number | API (`expense-flow`, `f2c-requester-web`) |
| US-07 | implemented (API + web) | `POST /api/v1/media/receipts` + `POST …/{id}/receipts`; receipts `PATCH`/`remove` | API (`expense-flow`, `f2c-requester-web`, `media`) |
| US-08 | implemented (API + web) | `…/{id}/receipts-complete`, `…/lpj/submit` (Uang Muka only) | API (`lpj`, `f2c-requester-web`) |
| US-17 | implemented (API) | `GET /api/v1/expense-requests?scope=team`; ADR 0021 (2026-10-10): the PM of the request (`projects.pm` / cost-center manager, snapshot acknowledger) approves/rejects as "Persetujuan PM"; any other PM → 403 + `access_denied` (ADR 0013 snapshots: PM never decides) | API (`expense-flow`, `f2-authz-db`, `e1-approval-direktur`) |
| US-19 | implemented (API + web) | `GET /api/v1/transfer-queue`, `/admin/antrian-transfer` | API (`expense-flow`) |
| US-20 | implemented (API + web) | `POST …/{id}/transfer` (amount = approved, one KK), `…/transfers/{tid}/void` | unit + API + DB (`expense-flow`, `f2-authz-db`) |
| US-21 | implemented (API + web) | `…/lpj/request-revision`, `…/lpj/verify`, `/admin/verifikasi-lpj` | API + DB (`lpj`) |
| US-22 | implemented (API + web) | `POST …/{id}/settle` (refund KM / shortfall transfer + KK; exact amount settles at verify) | unit + API + DB (`lpj`) |
| US-23 | implemented (API) | `POST/PATCH /api/v1/cash-entries`, `GET /api/v1/cash-accounts/balances` | API + DB (`f2-authz-db`) |
| US-24 | implemented (API) | `POST /api/v1/cash-entries/{id}/void` (reversal row in the KM/KK series; no `cash-reversals` collection) | API + DB (`f2-authz-db`, `lpj`) |
| US-26 | implemented (API + web) | `…/{id}/approve`, `/reject`, `GET /api/v1/approvals/inbox`, `/admin/persetujuan` (budget impact) | unit + API + DB (`expense-flow`, `f2-authz-db`) |
| US-34 | implemented (engine) | approval rules by amount/priority, snapshot at submit | unit + API (`expense-flow`) |
| US-36 | implemented (API) | type-specific state machines (`domain/expense/state.ts`) | unit + API (`expense-flow`) |
| US-37 | implemented (API + web) | line `total` primary, unit price informational, server grand total | unit (`expense-flow`), API (`form-228`) |
| US-38 | implemented (API) | Reimburse submit without a receipt per line → 409 | API (`expense-flow`, `form-228`) |
| US-39 | implemented (API + web) | `…/receipts/{rid}/verify`, `/reject`, `…/verify-receipts`, `…/flags/{fid}/review` | unit + API (`expense-flow`, `form-228`) |
| US-40 | implemented (API) | several requesters; no requester/creator may decide (G1, DB) | unit + API + DB (`expense-flow`, `f2-authz-db`) |
| US-41 | implemented (API + web) | on-behalf create by Admin/Finance (Q-09), also in the admin form (F2c) | API (`expense-flow`, `f2c-requester-web`, `form-228`) |
| US-42 | implemented (API) | `…/{id}/acknowledge` = PM project approval (ADR 0021); Direktur approval on ADR 0013 snapshots; PM on pre-E1 snapshots | unit + API (`expense-flow`, `form-228`, `e1-approval-direktur`) |
| US-43 | implemented (API + web) | signature on submit/acknowledge/approve; self-service profile signature (F2c) | unit + API (`expense-flow`, `f2c-requester-web`, `files`) |
| US-44 | implemented (API) | bank account must belong to a requester (G9), snapshot | API (`expense-flow`, `f2c-requester-web`) |
| US-46 | implemented (web) | `GET …/{id}/pdf[?variant=internal]` (ADR 0008); layout approved by the user 2026-09-24, logo pending (Q-32) | unit (`pdf`), API golden + RSS (`form-228`), manual (layout approved) |
| US-47 | implemented | `amount_diff` flag (tolerance, Q-14) | unit (`expense-flow`), API (`form-228`) |
| US-48 | implemented | `date_after_request` flag | unit (`expense-flow`), API (`form-228`) |
| US-49 | implemented | `uom_suspicious` flag | unit (`expense-flow`), API (`form-228`) |
| US-50 | implemented | `duplicate` flag | unit (`expense-flow`), API (`form-228`) |
| US-53 | implemented (API + web) | project XOR cost center (400 when both/neither), scope G10 | API (`expense-flow`, `f2c-requester-web`) |
| US-59 | implemented (API) | open-flag count stored on the decision row | API (`form-228`) |

Not in F2 scope and not implemented: batch/period PDF (worker), signed media URLs (ADR 0004 §4, F6), FCM push (F4),
settlement reversal (F6 backlog).

## E6 backend status (plan `plans/fase1-golive.md` §E6, sprint S1)

- **M13 laporan absensi**: report `absensi` (`GET /api/v1/reports/absensi?bulan=YYYY-MM&project=&pusat=`, CSV/XLSX;
  Finance/Direktur all, PM team) — same aggregation as the recap; test `e6-attendance.int.test.ts` reconciles recap and
  report with an independent SQL query.
- **Jadwal/libur/terlambat (Q-30)**: `work-schedules.workDays`, `employees.workSchedule`,
  `company-settings.defaultWorkSchedule`; snapshot on the check-in row (`attendances.schedule`).
- **Retensi selfie (Q-33)**: `company-settings.selfieRetentionMonths` (default 12) + job `selfieRetention` (dry run:
  counts candidates, face reference photos excluded); deleting files = S2. Selfie viewer
  `GET /api/v1/attendance/{id}/selfie` (audited `view_sensitive`).
- Web views (rekap, tim hari ini, laporan UI beyond the generic report page) and APK screens: sprint S2.

### E4 backend status (fase1-golive §E4, Sprint S1 — branch `feat/e4-progress-backend`)

Backend only; web views (report list/viewer, stage editor screen, dashboard US-12 widget) are Sprint S2 and the APK
screens are E4-APK. Admin panel: `progress-reports` (read-only list/detail), `project-stages` (+ `active`),
`projects.progressPct` (read-only). Tests: `unit/e4-progress.test.ts`, `integration/e4-progress.int.test.ts`.

| US | Status | Implemented as | Test type (files) |
|---|---|---|---|
| US-10 | implemented (API + sync) | `POST/PATCH /api/v1/progress-reports`, `POST /api/v1/media/progress-photos` (≤ 5, 1600 px JPEG, EXIF stripped), sync `progress_report.draft_upsert`; stage % before → after and project % = Σ(weight × %) in the same transaction; PM (team) / Direktur only | unit + API + DB + sync (`e4-progress`) |
| US-11 | hook points (E7 schedules) | `domain/progress/reminders.ts`: `lateProgressProjects()` + `notifyLateProgressReport()` (event `progress.late_report`); no job yet | API/domain (`e4-progress`) |
| US-12 | data (API) | K-09 `GET /api/v1/projects/progress` (`domain/reports/progress.ts`): K-08 − progress, colours from `progressWarnGapPct`/`progressBadGapPct`; widget in S2 | unit (colours) + API SQL reconciliation (`e4-progress`) |
| US-29 | implemented (API; admin partial) | `GET/PUT /api/v1/projects/{id}/stages` (whole set = 100 %, reason for re-weighting, template apply); admin single-stage writes cannot break a complete set; no delete (deactivate) | unit + API + DB (`e4-progress`) |
| US-31 | implemented (API) | `GET /api/v1/progress-reports[?project=&stage=&from=&to=&mine=]` newest first + `GET …/{id}` with photos (`/api/v1/media/progress-photos/{id}/file`) | API (`e4-progress`) |

### S2 web A status (fase1-golive §E4 web + §E5, branch `feat/s2a-progress-web-addendum`)

E5 approval flow: rule engine of ADR 0013 with `approval-rules.docType = budget_addendum`; default rule seeded by the
migration = Direktur ("Diketahui" = approval) → Finance level 1 (Sprint S2 decision on ADR 0013 O-3; configurable).

| US | Status | Implemented as | Test type (files) |
|---|---|---|---|
| US-12 | implemented (web) | Beranda Direktur/Finance/PM card "Progress fisik vs anggaran" (K-09, paired bars on one axis + status pill), "Progress fisik" column in the budget table and in report `anggaran-project` (replaces "F5"), page `/admin/progress` | unit (`e4-progress-ui`) + API (`e4-web`) |
| US-29 | implemented (web) | `/admin/progress/project/{id}`: stage bars, stage editor (live total = 100 %, reason on re-weight/deactivate; Direktur add/deactivate, PM rename/reorder/re-weight) → `PUT /api/v1/projects/{id}/stages` | API (`e4-progress`), UI screenshot/interaction |
| US-31 | implemented (web) | `/admin/progress/laporan` (filters project/stage/date, newest first, cursor), `/admin/progress/laporan/{id}` (photo gallery via `/api/v1/media/progress-photos/{id}/file?variant=thumb`), timeline per stage on the project page | API (`e4-web`) |
| US-18 | implemented (API + web) | `budget-addenda` (`ADD/YYMM/####`); `POST /api/v1/budget-addenda` (PM of the team only, nominal > 0 + reason), `PATCH`, `/submit`, `/cancel`; web `/admin/addendum`, `/admin/addendum/baru` | unit + API + DB (`e5-addendum`) |
| US-30 | implemented (API + web; APK screens = E5 APK) | `/acknowledge` (Direktur), `/approve` (Finance; last level: `projects.budget` = current RAB + addition in the same transaction, audited), `/reject` (reason); `GET /api/v1/budget-addenda/inbox`; web inbox section in `/admin/persetujuan` + detail `/admin/addendum/detail/{id}` | unit + API + DB + atomicity (`e5-addendum`) |

## MC — Multi-company (ADR 0016, `requirements-v1.2.md`, added 2026-09-27)

Status (updated 2026-10-02): **MC1 + MC2 + MC3 implemented** (MC1 `feat/mc1-foundation`; MC2 `feat/mc2-integration`, 2026-09-28; MC3 API `6f6f8cf` + APK `00014a1` on `develop`; released in web v0.5.0; progress `mc/mc1-progress.md`, `mc/mc2-progress.md`, `mc/mc3-progress.md`); **MC4 code gaps** on `develop` (PR #9, `mc/mc4-progress.md`), **MC4 QA** (`qa/mc4-qa-report.md`, 4 HIGH fixed) and the **PT scope rule** (owner decision 2026-10-02) on `feat/mc4-pt-scope-rule` — MC4 staging UAT pending (blocked: group-admin test account, Keycloak `pk-user` scope MC4-01).
Phase = MC sub-phase of `phase-plan.md`. "Isolation" = a user of PT A only gets 404 for PT B ids; "cross-PT" = DB
trigger rejects the row.

**MC1 coverage (2026-09-28):**

| US | MC1 status | Evidence |
|---|---|---|
| US-MC-01 | model done (collection `companies`, shortCode format + immutable after a numbered doc, group-admin create); UI + copy-defaults = MC2 | `collections/Companies.ts`, migration `*_mc1_companies` |
| US-MC-02 | model + access done (memberships per PT, Admin of PT A cannot write PT B → 403, `role_change` audit, no Keycloak role sync, new account → `pk-user`); matrix UI = MC2 | `tests/integration/mc-isolation.int.test.ts` (users / memberships), `users-keycloak.int.test.ts`, `authz.int.test.ts` |
| US-MC-03 | done at model level (employee `company`, membership employee same PT — hook + DB) | `mc-isolation` (DB guards) |
| US-MC-04 | context done (cookie ∩ memberships, stale cookie → all); switcher UI = MC2 | `mc-isolation` (selection), `tests/unit/mc1-access.test.ts` |
| US-MC-05 | header `X-Company-Ids` + 403 `COMPANY_NOT_ALLOWED` done; `/me companies[]` = MC3 | `mc-isolation` (selection) |
| US-MC-07 | done (role in the document PT, DB `cross-company reference`, immutable `company_id`) | `mc-isolation` (mutations, DB guards) |
| US-MC-08 | done (counters per PT, `{COMPANY}` = document PT, DRMS continues 229…) | `numbering.int.test.ts`, `mc-isolation` (PB-CS1) |
| US-MC-09 | done in DB + domain (`closePeriod`/`reopenPeriod` per PT); `company` API parameter = MC3 | `mc-isolation` (closing DRMS never locks CS1) |
| US-MC-12 | approver pools / recipients / G1 per document PT done; UI chips = MC2 | `mc-isolation` (approval holders), E1 suites green |
| US-MC-13 | per-PT uniques done (same code in two PTs, duplicate in one PT → 23505); picker filters = MC2 | `mc-isolation` (DB guards) |
| US-MC-14 | REST sweep over the 30 per-PT collections + id 404 + forged header/cookie done; `/api/v1` route generator, media, PDF, export = MC2/MC3 | `mc-isolation` |
| US-MC-18 | audit rows carry `company` (+ actor roles of that PT); filters = MC2 | `mc-isolation` (audit) |
| US-MC-19 | done: migration on a develop-head copy (269 users, 637 requests, 475 cash entries): row counts + money sums identical before/after, down → up identical, next PB number unchanged | `mc/mc1-progress.md` §Migration check |

**MC2 coverage (2026-09-28, branch `feat/mc2-integration`):**

| US | MC2 status | Evidence |
|---|---|---|
| US-MC-01 | company master UI done (tabs, member count, group-admin create/deactivate); "copy defaults from DRMS" on create = MC3/MC4 (seed + import already give a new PT the default sequences + approval rules) | `tests/unit/mc2-admin-ui.test.ts`, `mc2-import.int.test.ts` |
| US-MC-02 | role matrix `/admin/akses-pt` done; atomic `POST /api/v1/company-memberships/batch` (all-or-nothing, per-cell error path, `role_change` + reason) | `mc2-role-matrix.test.ts`, `mc2-isolation` (batch), `mc2-integration` (Admin of A: mixed batch 403 `items.1`, nothing saved) |
| US-MC-03 | employee ↔ PT: PT on top of master forms, pickers per PT, PT required when ambiguous | `mc2-admin-ui.test.ts` |
| US-MC-04 | PT switcher + `POST /api/v1/me/companies` done | `mc2-switcher.test.ts`, `mc2-integration` (cookie gates finance/PM dashboards; foreign PT → 403) |
| US-MC-06 | queues per PT with `company` ref + PT column; Finance queues limited to Finance/Direktur PTs | `mc2-isolation` (queues), `mc2-integration` (PM PT never in the transfer queue) |
| US-MC-09 | Tutup buku one PT per screen, `company` on close/reopen, lock date per PT | `mc2-isolation`, `mc2-integration` (Finance of 2 PTs: 400 without PT, closing B keeps A's lock date) |
| US-MC-10 | dashboards per role PTs with typed `byCompany` rows (Σ = total) | `mc2-isolation` (dashboards), `mc2-integration` (switcher × dashboards), `mc2-integration.test.ts` |
| US-MC-11 | reports: `pt` parameter, PT column, subtotal per PT, per-PT / group letterhead (screen + exports) | `mc2-isolation` (reports, exports) |
| US-MC-12 | approval holders per PT (MC1) + inbox PT chips + warn % of the item's PT | `mc2-isolation`, E1 suites |
| US-MC-13 | pickers per PT (forms, Kas, attendance filters with `[PT]` labels) | `mc2-admin-ui.test.ts`, `mc2-integration` (Absensi) |
| US-MC-14 | attendance filters bound to the PT (`narrowAttScope`); media per PT; sync `COMPANY_MISMATCH` | `mc2-integration` (office user of A + project of B → nothing), `mc2-isolation` (media, sync) |
| US-MC-15 | jobs loop over active PTs with that PT's settings | `mc2-isolation` (reminders, retention) |
| US-MC-16 | import `kode_pt`, sheets Perusahaan + AksesPT | `mc2-import.test.ts`, `mc2-import.int.test.ts` |
| US-MC-18 | audit log per PT (`auditScope`), rows without PT: Admin/Direktur only | `mc2-isolation` (audit) |

| US | Module | Roles | Payload collections | API | Screen | Phase | Test type |
|---|---|---|---|---|---|---|---|
| US-MC-01 | M14 | Admin grup (`users.groupAdmin`), Admin/Direktur (own PT, R/U) | `companies` (new), `company-settings` (slimmed), `media-company`, `document-sequences`, `approval-rules`, `work-schedules` (defaults copied on create), `audit-logs` | Payload REST `/api/companies` (admin) | web admin (collection "Perusahaan") | MC1 (model) / MC2 (UI) / MC4 (copy defaults) | unit (shortCode format, immutable after numbered docs); API (non-group-admin create → 403); integration (new PT gets 7 sequences + default rule) |
| US-MC-02 | M01, M14 | Admin (per PT), Admin grup | `company-memberships` (new), `users` (`roles` removed, `groupAdmin`), `audit-logs` | Payload REST `/api/company-memberships`; `GET/PUT /api/v1/admin/memberships?company=` (proposed, matrix save) | web custom view `/admin/akses-pt` (matrix) | MC1 (model/access) / MC2 (UI) | API (Admin of PT A edits PT B → 403 + `access_denied`); integration (role removed → next request denied); Keycloak mock (only `pk-user` assigned) |
| US-MC-03 | M14, M01 | Admin (per PT) | `employees` (`company` required), `company-memberships.employee`, `employee-bank-accounts` | Payload REST | web admin (Karyawan form, membership form) | MC1 | DB (membership employee of other PT → cross-PT error); API (one employee → two users → unique violation 409) |
| US-MC-04 | M01 | all panel roles | `company-memberships`, `web-sessions` | `POST /api/v1/me/companies` (proposed; sets `__Host-pk-companies`) | web module bar switcher | MC1 (context) / MC2 (UI) | API (cookie with foreign id → 403; no cookie → all memberships); e2e (switch → lists change) |
| US-MC-05 | M01, M02 | all APK roles | `company-memberships`, `devices` | `GET /api/v1/me` (`companies[]`), header `X-Company-Ids` on all `/api/v1` | APK PT switcher | MC3 | API (`/me` shape, foreign header → 403); Flutter widget (menu per PT capabilities) |
| US-MC-06 | M03, M04 | Direktur, Finance, PM | `expense-requests`, `approvals`, `budget-addenda` | `GET /api/v1/approvals/inbox`, `/budget-addenda/inbox`, `/expense-requests`, `/transfer-queue` (items carry `company`) | web `/admin/persetujuan`, lists (PT column), APK inbox | MC2 / MC3 | integration (Rina: Direktur DRMS + Finance CS1 sees the right steps only); e2e |
| US-MC-07 | M03–M07 | all | all per-PT collections | all mutating `/api/v1` routes (company from document; create body `company`) | web + APK forms | MC1 (DB) / MC2 (domain) | API (role only in other PT → 403); DB (`cross-company reference` for every FK pair of `mc/impact-inventory.md` §MC1-4); immutable `company_id` |
| US-MC-08 | M14, M16 | Admin (per PT) | `document-sequences`, `document_sequence_counters` (table) | — (allocation inside submit/post) | web admin (Penomoran per PT) | MC1 | integration (2 PTs × 50 parallel submits → per-PT unique, gapless, other counter unchanged); unit (`{COMPANY}` = document PT) |
| US-MC-09 | M07 | Finance (close), Direktur (re-open) per PT | `period-closings`, `cash-entries`, `transfers`, `settlements` | `POST /api/v1/period-closings` + `/period-closings/:period/reopen` (with `company`) | web `/admin/tutup-buku` (per PT) | MC1 (DB) / MC2 | DB (posting in closed period of PT A rejected, PT B accepted); API (Finance of PT B closes PT A → 403) |
| US-MC-10 | M02 | Direktur, Finance, PM | `cash-entries`, `expense-requests`, `projects`, `cost-centers`, `transfers` | `GET /api/v1/dashboard/{owner,finance,pm,me}` (per-PT breakdown + total) | web `/admin/dashboard`, APK KPI home | MC2 / MC3 | integration (extends `f3-kpi-reconciliation`: per-PT SQL = breakdown, Σ = total); visual check |
| US-MC-11 | M13, M16 | Finance, Direktur, PM (team) | report sources (`domain/reports/*`), `companies`, `company-settings` (group letterhead) | `GET /api/v1/reports/:code[/:format]?company=` | web `/admin/laporan/<kode>` | MC2 | integration (filters per PT, PT column in CSV/XLSX); PDF text check (PT vs group letterhead) |
| US-MC-12 | M04, M12 | Direktur, Finance, requesters | `approval-rules`, `approvals`, `notifications`, `company-memberships` | submit/acknowledge/approve routes (unchanged paths) | web + APK | MC2 | integration (holders per PT, skip rule per PT, notifications only to PT members; ADR 0013 suites on a 2-PT fixture) |
| US-MC-13 | M14 | Admin, Finance, Direktur per PT | all per-PT masters + `banks`, `uoms`, `holidays` | Payload REST; `GET /api/v1/masters` (per PT + shared) | web admin, APK pickers | MC1 / MC2 (copy action) | API (composite uniques: same code in two PTs OK, twice in one PT 409; picker lists only PT + shared) |
| US-MC-14 | all | all | every per-PT collection, media collections | every `/api/v1` route with an id, Payload REST `/api/<slug>/:id`, media file/signed URL, PDF, export | — | MC1 (suite) / MC4 (review) | integration `mc-isolation.int.test.ts` (generated per collection/route); Semgrep rule (raw SQL without company helper); ZAP rerun |
| US-MC-15 | M12 | — (worker) | `companies`, `reminder_runs`, `reminder_deliveries`, `expense-requests`, `media-selfies` | Payload jobs `dailyReminders`, `reimburseAutoClose`, `selfieRetention` | — | MC2 | integration (fake clock, 2 PTs with different `reminderHour`/days; one PT failing does not stop the other) |
| US-MC-16 | M14 | Admin grup | all imported collections + `companies`, `company-memberships` | CLI `import` (dry-run/commit) | workbook `drms-impor-golive-template.xlsx` (sheet Perusahaan, AksesPT, `kode_pt`) | MC2 | integration (extends `s3b-import`: two PTs, cross-PT reference rejected, `nomor_pb_mulai` per PT) |
| US-MC-17 | M03, M09, M11 | Staff, PM (APK) | `expense-requests`, `progress-reports`, `attendances`, `sync_receipts` (table) | `POST /api/v1/sync/batch` per PT (`COMPANY_MISMATCH`) | APK (drafts, queue screen) | MC3 | Flutter unit (drift v2 → v3 migration keeps rows), mock-backend flow with 2 PTs; API (item referencing other PT → rejected) |
| US-MC-18 | M15 | Admin, Direktur, Finance | `audit-logs` (`company_id` nullable), `notifications` | `GET /api/v1/expense-requests/:id/history`; report `audit-log` (`company` filter) | web `/admin/audit-log`, tab Riwayat | MC2 | integration (per-PT rows filtered; shared-master rows visible to Admin only) |
| US-MC-19 | — | — (migration) | all per-PT tables, `company_memberships`, `document_sequence_counters` | — | — | MC1 | migration test on a staging copy (row counts, balances, next PB number 229… unchanged; down migration) |

## FR1 — Laporan lapangan per jenis project (requirements v1.3, ADR 0020) — P1 backend 2026-10-09

Branch `feat/field-reports-p1`. Web views / PDF berita acara / APK screens follow (P1 web, P2 APK); this table maps the backend.

| US | Module | Roles | Payload collections | API | Screen | Phase | Test type |
|---|---|---|---|---|---|---|---|
| US-60 | M02 | Direktur, Admin (kind only) | `projects.kind` | Payload REST `PATCH /api/projects/:id`; 409 `WRONG_PROJECT_KIND` on reports | web admin (Project form, sidebar) | P1 | unit `fr1-rules.test.ts`, `qa-rbac-ux.test.ts`; API `fr1-db.int.test.ts` (Admin kind only, frozen kind) |
| US-61 | M14 | Admin (C/U), Direktur (U), all R | `vehicles` (Unit & Kendaraan) | Payload REST; `GET /api/v1/units` | web admin (Master Data) | P1 | unit `fr1-rules.test.ts`; API/DB `fr1-db.int.test.ts` |
| US-62 | M02 | Admin, Direktur (C/U); rates Finance/Direktur/Admin | `contract-units` | Payload REST; `GET /api/v1/projects/:id/contract-units` | web admin (Proyek › Laporan lapangan) | P1 | API/DB `fr1-db.int.test.ts` (overlap), `fr1-api.int.test.ts` (rates hidden) |
| US-63 | M09 | Staff (assigned), PM (team), Direktur | `service-reports`, `media-progress-photos`, `vehicles`, `notifications` | `GET/POST /api/v1/service-reports`, `GET/PATCH …/:id`, `POST …/:id/corrections`; sync `service_report.upsert` | APK (P2), web (P1 views) | P1 (API) / P2 (APK) | API `fr1-api.int.test.ts` (number, HM_DECREASED, status, PM notification, 403 not assigned) |
| US-64 | M09 | Staff (assigned), PM, Direktur | `unit-timesheets`, `contract-units`, `vehicles` | `/api/v1/unit-timesheets` (+ corrections); sync `unit_timesheet.upsert` | APK (P2), web matrix (P1 views) | P1 / P2 | API `fr1-api.int.test.ts` (DUPLICATE_DATE, NOT_IN_CONTRACT, HM_GAP, sync replay/conflict); DB `fr1-db.int.test.ts` |
| US-65 | M09 | Staff (assigned), PM, Direktur; value Finance/Direktur/Admin + reporter | `aftersales-activities`, `clients`, `reminder_deliveries` | `/api/v1/aftersales-activities` (+ corrections), `GET /api/v1/aftersales/open-pos`; sync `aftersales_activity.upsert`; job `dailyReminders` rule `aftersales_followup` | APK (P2), web (P1 views) | P1 / P2 | API `fr1-api.int.test.ts` (value hidden, PO status, PO_CLOSED, follow-up reminder) |
| US-66 | M09, M15 | reporter (≤ 24 h), PM team / Direktur (corrections) | the three report collections, `audit-logs` | `PATCH …/:id`, `POST …/:id/corrections` | web + APK | P1 | API `fr1-api.int.test.ts` (NOT_EDITABLE, correction audited); DB `fr1-db.int.test.ts` (window, override, no delete) |
| US-67 | M13 | Finance, Direktur, Admin (estimate); PM (hours) | report `rekap-timesheet-kontrak` | `GET /api/v1/reports/rekap-timesheet-kontrak[/csv|xlsx|pdf]` | web `/admin/laporan/rekap-timesheet-kontrak` | P1 | unit `fr1-rules.test.ts` (billing, availability); API `fr1-api.int.test.ts` |
| US-68 | M13 | Finance, Direktur, Admin (values); PM | report `rekap-aftersales` | `GET /api/v1/reports/rekap-aftersales[/…]` | web `/admin/laporan/rekap-aftersales` | P1 | API `fr1-api.int.test.ts` |

## Approval PM project → Direktur (ADR 0021, requirements v1.3 §9) — 2026-10-10

Branch `feat/approval-pm-direktur`. Migration `20261010_130000_approval_pm_direktur`.

| US | Module | Roles | Payload collections | API | Screen | Phase | Test type |
|---|---|---|---|---|---|---|---|
| US-69 | M04 | PM project (snapshot acknowledger), Direktur, Finance (transfer only) | `approval-rules`, `expense-requests`, `approvals`, `notifications`, `settlements` | `POST /api/v1/expense-requests/{id}/acknowledge` (PM), `/approve` (Direktur), `/reject`; `GET /api/v1/approvals/inbox`; `GET /api/v1/me` (`capabilities.approvalInbox` for PM); LPJ shortfall `…/lpj/shortfall-approval/*` | web Persetujuan, PM dashboard, APK 0.4.1 | approval-pm | integration `approval-pm-direktur.int.test.ts` (scenarios 1–9), updated ADR 0013 suites (old snapshot still finishes) |
| US-70 | M04, M15 | PM (creator), Direktur (requester) | `expense-requests.g1_exception`, `approvals`, `audit-logs` | submit / acknowledge / approve (unchanged paths) | web panel + PDF note | approval-pm | integration (exception recorded in audit/PDF; Direktur alone → 409; DB trigger refuses actor = creator without the exception) |

## D1610 — Hapus per baris (soft delete) / Batalkan proyek (ADR 0030, owner 2026-10-16)

| Requirement | Collections | API | Screen | Test |
|---|---|---|---|---|
| Hapus (soft delete) of an unused row: `isDeleted` + who / when / reason, audit `soft_delete`; hard delete stays denied | 18 masters, `projects`, `expense-requests` (registry `domain/soft-delete/registry.ts`) | `GET /api/v1/records/{collection}/{id}/delete-check`, `POST …/delete` | list "Aksi" → Hapus (RowRecordAction) | unit `d1610-soft-delete.test.ts`; int `d1610-soft-delete.int.test.ts` (usage check, permissions, audit) |
| Deleted rows hidden from lists, pickers, API, masters, reports; labels of old documents kept | same | central `hideDeleted` read rule; `GET /api/v1/masters` (tombstones on `since`) | every list / picker; Admin filter "Data dihapus" | int (REST list, v1 list, masters, PkListView, reports scope) |
| Pulihkan (Admin), audit `restore` | same | `POST /api/v1/records/{collection}/{id}/restore` | list "Aksi" → Pulihkan | int (restore, permissions) |
| Used row: master → Nonaktifkan, request → Batalkan, project → Batalkan proyek (status `dibatalkan`, cascade, refused while money moved) | `projects`, `expense-requests`, `budget-addenda`, `project-loans` | `GET /api/v1/projects/{id}/cancel-plan`, `POST /api/v1/projects/{id}/cancel` | list "Aksi" → Batalkan (dry-run dialog) | int (cascade, refusal with `blocking`, permissions, closed project) |
