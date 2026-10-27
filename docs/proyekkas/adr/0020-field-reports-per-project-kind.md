# ADR 0020 — Field reports per project kind (Laporan lapangan per jenis project)

- **Status:** accepted (owner decisions 2026-10-09: plan "Laporan lapangan per jenis usaha — RR Teams", DRMS first).
- **Date:** 2026-10-09
- **Author:** nextjs developer (branch `feat/field-reports-p1`, based on `main` `31bc98f` = v0.6.4)
- **Related:** ADR 0004 (media, resize), ADR 0006 (audit, append-only), ADR 0007 (numbering), ADR 0010 (offline sync),
  ADR 0016 (multi-PT); requirements v1.1 §4 (role matrix), v1.2 (multi-PT), **v1.3** (this feature); E4 progress
  reports (`domain/progress/*`).

## Context

The group runs one app (RR Teams) for several PTs with different businesses. DRMS rents out heavy equipment
(contract units) and sells after-sales service and spare parts; other PTs build (construction) or trade. Field
reporting so far is the manual progress report (stage %, PM/Direktur only). DRMS needs, per business: a service report
of a mechanic with photos, a daily timesheet per rented unit as the basis of the monthly billing, and a daily log of
the after-sales staff (quotations, incoming POs, deliveries). Construction (daily report on RAP volumes) follows in P3.

## Decision

1. **The project kind decides the reports.** `projects.kind` = `umum | konstruksi | kontrak_unit | aftersales |
   trading` (default `umum`; every existing project stays `umum`). A PT may have projects of any kind (owner
   clarification: the report type follows the PROJECT, not the PT).
   - `kontrak_unit` → Timesheet Unit + Laporan Servis;
   - `aftersales` → Laporan Servis + Log Aktivitas Aftersales;
   - `konstruksi` → Laporan Harian (P3); `trading`, `umum` → none.
   Only the Direktur or the Admin of the PT sets the kind (the Admin can change nothing else on a project); the kind is
   frozen once the project has contract units or field reports (hook 409 + DB trigger). A report on a project of the
   wrong kind → **409 `WRONG_PROJECT_KIND`**.
2. **Who reports.** Staff **assigned** to the project (active `team-assignments`), the PM of the project team and the
   Direktur of the PT may create field reports (`domain/field/access.ts canFieldReportOn`). This **supersedes
   requirements v1.1 §4 "Laporan progress: Staff —" only for these new documents**: the manual progress report keeps
   PM/Direktur only (`canReportOn` unchanged; the E4 negative tests stay green). Finance and Admin read, they do not
   report. Read scope: Admin/Direktur/Finance all of the PT, PM team projects + own, Staff assigned projects + own.
3. **Units = extended vehicles.** The master `vehicles` becomes "Unit & Kendaraan": `kind` kendaraan | alat_berat
   (existing rows = kendaraan), `unitCode` (unique per PT, required for heavy equipment), plate optional for heavy
   equipment (still required for vehicles and globally unique when set), serial no, `owner` sendiri | pelanggan +
   `client` (required for customer units, same PT), and system fields written only by field reports: `status`
   (siap | rusak | menunggu_part, from the latest service report) and `lastHourMeter` / `lastHourMeterAt` (reading of
   the latest timesheet/service report by date). No separate equipment master.
4. **Contract units.** `contract-units` (per PT): an own unit in a `kontrak_unit` project for a period with the rate
   (`per_jam` with a monthly minimum, or `per_bulan`). One unit is never ACTIVE in two contracts on overlapping dates
   (hook + DB trigger under a per-unit advisory lock — no `btree_gist` extension needed on the platform DB). A
   timesheet's unit must be in an active contract unit of the project on that date (409 `NOT_IN_CONTRACT`).
5. **Documents.** `service-reports` (SV/YYMM/####, ≤ 10 photos, spare parts as validated text lines), `unit-timesheets`
   (one per unit and date, HM start/end, work/standby/breakdown hours Σ ≤ 24, fuel, operator name as text, exactly one
   HM photo; HM_GAP flag when the start ≠ the previous HM end), `aftersales-activities` (penawaran / po_masuk /
   pengiriman / penagihan / kunjungan / lainnya per customer; a delivery refers to an incoming PO of the same customer
   and sets its status sebagian/terkirim; follow-up date of a quotation → daily reminder to the reporter + PM).
   Photos reuse `media-progress-photos` with owner types `service_report` / `unit_timesheet` / `aftersales_activity`
   (owner PT derived by the DB). Staff may upload there only in a PT with field reports on.
6. **Immutability (same pattern as E4 progress reports).** Written only by the domain services (HTTP create/update/delete
   on the collections closed). DB: `received_at` = DB clock, `editable_until` = +24 h, no DELETE/TRUNCATE, identity
   columns immutable, every reference in the row's PT, the reporter an active member. The reporter edits inside the
   24 h window (reason optional, audited). After it, only the **PM of the project team or the Direktur** corrects, any
   time, with a **reason** (POST `…/corrections`; flag `CORRECTED`, `correctedAt/By`, audit reason `Koreksi: …`); the DB
   accepts these UPDATEs only under the transaction-local `pk.field_override = 'correction'`. System side effects after
   the window (a delivery closing an old PO) use `'system'`, which lets only `po_status`, `flags`, `sync_rev` change.
   Service HM below the unit's latest reading on/before the date → 409 `HM_DECREASED` (a correction may fix a typo;
   the unit's last HM is recalculated from its documents).
7. **Money is hidden from the field.** Contract rates / minimum hours, billing estimates and aftersales values are
   readable only by **Direktur, Finance and Admin** of the PT (field access + DTOs + reports); an aftersales value also
   by the reporter who entered it. Staff/PM APIs return `null` (`ratesVisible` / `valueVisible` false).
8. **Billing = estimate, not invoice.** `rekap-timesheet-kontrak` (registry report, screen/CSV/XLSX/PDF): per contract
   unit and month — HM, hours, availability = (work + standby) / (work + standby + breakdown), days without timesheet,
   and the ESTIMATE: per_jam = rate × max(work hours, minimum; prorated by contract days for a partial month); per_bulan
   = rate × contract days / days of the month. Marked "estimasi, bukan invoice"; the invoice is made outside the app.
   `rekap-aftersales`: per customer PO masuk / terkirim / belum kirim, open POs with age, due follow-ups.
9. **No spare-part stock.** Spare parts are only recorded on the service report / activity items (text, quantity, UoM).
10. **Feature flag per PT.** `companies.fieldReportsEnabled` (default **false**, not copied to new PTs). Off → every
    create (web, API, sync) answers 403 `FEATURE_DISABLED`; data stays readable. `/me` exposes per PT
    `capabilities.serviceReportCreate / unitTimesheetCreate / aftersalesActivityCreate` and `settings.fieldReportsEnabled`.
11. **Offline.** Sync items `service_report.upsert`, `unit_timesheet.upsert`, `aftersales_activity.upsert` use the same
    rules as `progress_report.draft_upsert` (client_uuid replay → duplicate, `base_rev` conflict + server copy, reporter
    + 24 h window for edits).

## Consequences

- Staff gain a create right for the first time outside expenses/attendance; scoped by assignment and per-PT flag.
- New tables are per PT (`FR1_PER_PT_TABLES`), audited (`withAudit`), and covered by the raw-SQL company lint.
- A mechanic of a customer-owned unit needs the customer as `clients` row; Staff assigned to an aftersales project
  read the PT's clients (picker).
- Construction (P3) plugs into the same foundation (kind `konstruksi`, `canFieldReportOn`, overrides, photos).

## Alternatives

| Alternative | Why not |
|---|---|
| Report type per PT | Owner: a PT may run projects of several kinds (Teams: construction + trading). |
| Separate equipment master | Duplicates plates/cost centers; vehicles already per PT with expense links. |
| Exclusion constraint (`btree_gist`) for contract overlap | Needs an extension on the shared platform Postgres; trigger + advisory lock gives the same guarantee. |
| Staff may also create manual progress reports | Owner kept v1.1 §4 for progress % (E4 tests); field reports are separate documents. |
| Spare-part stock | Out of scope (owner): no inventory module; text lines only. |

## Amendment 2026-10-11 — RAP for every project with a RAB (DRMS 10/10 D4)

- **Status:** accepted (owner decision 2026-10-11: "RAP wajib untuk semua proyek yang punya RAB"; "Melebihi RAP" stays
  a warning, never blocking). Branch `feat/d1010-f-rap-all`. Supersedes the "RAP exists for konstruksi only" part of
  P3 and Phase C D4 ("other kinds without RAP stay unconstrained", plan `drms-1010.md` open question 1).

**Decision.**

1. **The RAP is a cost plan of any project, not a konstruksi feature.** RAP items, the Excel import / export and the
   templates work for every project kind (`umum`, `trading`, `kontrak_unit`, `aftersales`, `konstruksi`). Editors stay
   the same: the Direktur/Admin of the PT and the PM of the project's team; locking (daily-report realisation) unchanged.
2. **Rule (`rapRequiredFor`).** A project **with a RAB** (`projects.budget > 0`) of ANY kind, and every konstruksi
   project (P3, unchanged), needs ≥ 1 active RAP item before an expense request can be **submitted**; otherwise 400
   `projectId` "Project belum punya RAP — hubungi PM" (one text for server, web and APK). Every line of a project with a
   RAP names a RAP item (Phase C, unchanged). Drafts can be saved; requests submitted before stay valid. A project
   without RAB (not konstruksi) may have a RAP but is not forced to.
3. **Field reports stay per kind (this ADR §1).** Only konstruksi RAPs drive the stage progress from the daily
   reports (`rapDrivesProgress`) and require a stage per item. Other kinds: the stage is optional (an existing stage as
   grouping; an import never creates stages there), the progress stays manual (E4 progress reports), no daily-report
   quantities. DB: `rap_items.stage_id` nullable, `pk_rap_item_guard` refuses a stage-less item of a konstruksi
   project (migration `20261013_400100_d1010_rap_all_guard`). The project kind stays frozen once RAP items exist
   (P3 trigger; hook now answers 409 "sudah punya RAP").
4. **Templates per project kind.** `rap_templates.project_kind` (NULL = any kind); a template saved from a project
   carries its kind and is offered only to projects of that kind; existing templates became `konstruksi`.
5. **Existing data.** No RAP is created automatically. The migration logs every non-archived / unfinished project with a
   RAB (or konstruksi) without RAP; the Direktur dashboard lists them ("Project ber-RAB belum punya RAP") and the PM
   dashboard nudges the team's ones; the go-live import warns per imported project with a RAB.

**Consequences.** Projects with a RAB but no RAP (e.g. imported go-live projects, the UAT seed project) cannot send
requests until a PM fills the RAP — intended. The APK learns the rule from `GET /projects/{id}/rap` `rapRequired` and
`GET /projects` `rapMissing`; older APKs still get the server's 400 with the same message under the project field.

## Amendment 2026-10-17 — Jenis servis as a per-PT master (multi-select), 25 photos, no "No. part" (DRMS owner 2026-10-17)

- **Status:** accepted (owner request 2026-10-17, menu Proyek › Laporan Servis). Branch `feat/d1710-service-jenis`.
  Supersedes the fixed four-value "jenis servis" enum of §5 and the "≤ 10 photos" of the service report.

**Decision.**

1. **"Jenis servis" is master data per PT** (`service-types`: code, name, active; Master Data group). Managed by the
   Admin and the Direktur of the PT (Owner implies Direktur), read by every member. Every PT is seeded with the four
   former values (codes `servis_berkala` / `perbaikan` / `inspeksi` / `pemasangan`) — existing PTs by migration
   `20261017_100000_d1710_service_types`, new PTs by `ensureDefaultServiceTypes`. The code is fixed once created (field
   access + DB trigger): it is how APK 0.7.0 still names a type. No hard delete: "Hapus" (ADR 0030 soft delete) only
   while no report uses the type (FK usage check via `service_reports_rels`), otherwise "Nonaktifkan" with a reason.
2. **A service report has ONE OR MORE types** (`serviceTypes`, hasMany, selection order; REST `serviceTypeIds`, sync
   `service_type_ids`, 1–20 unique ids of the report's PT; create: active only; edit / correction: a type already on
   the report may stay although deactivated, a newly added one must be active). Web: checkbox pills on create, in
   "Ubah (24 jam)" and "Koreksi"; lists / detail / timelines show the names joined with ", ". `GET /api/v1/service-types`
   serves the picker. **Legacy single code** (`serviceType` / `service_type`, the only form of APK 0.7.0) still works
   when no id list is sent: create → the PT's row with that code; edit → unchanged when that code is already on the
   report (APK 0.7.0 resends it on every edit and must not collapse a multi-selection made on the web), else the
   selection becomes that one type. The DTO keeps `serviceType` and the sync server copy `service_type` = the code of
   the first selected type whose code is one of the four legacy codes, else of the first selected type (APK 0.7.0
   can show / pre-select only the legacy ones; its edit then resends a code that is on the report) and adds
   `service_type_ids`. DB: `service_reports.service_type` became a nullable varchar written with that same code.
   Urutan (`sortOrder`): lists sort by it, then name; seeded 1–4, a type created without one gets the PT's highest + 1.
3. **DB guard of the types** (`service_reports_rels_guard`): the same 24 h window / PM-Direktur correction override as
   the report row, the type must be of the report's PT, the rows are `serviceTypes` only; deferred constraint triggers
   keep ≥ 1 type per report at commit. Payload rewrites the rows on update → DELETE granted on that table only.
4. **Photos per service report: 25** (was 10) — API, sync, DB CHECK and the photo-limit trigger. The web edit and
   correction dialogs may now ADD photos (never remove) up to that total (`addPhotoIds`).
5. **No "No. part" input for service-report spare parts** (web create / edit / correction). A part number already
   stored on a line is kept (sent back unchanged) and shown in the detail only when some line has one. Aftersales
   items (activity log / PO lines) keep their No. part.

**Consequences.** Reports created before the migration carry exactly their old type. APK 0.7.0 keeps working (single
type, ≤ 10 photos locally); a newer APK reads `GET /service-types` and sends `service_type_ids`. Down migration is
refused once a report has more than 10 photos or a type outside the old four / several types (restore the dump).

## Amendment 2026-10-24 — Timesheet: backdate for PM / Direktur, HM weekly (optional) (client feedback 24/10)

- **Status:** accepted (user decisions 2026-10-24). Branch `feat/d2410-timesheet`, migration
  `20261024_100000_d2410_timesheet_hm_optional`. Amends §5 (unit timesheet: "HM start/end, exactly one HM photo") and the
  report-date rule (BACKDATE_MAX_DAYS = 14 for every field report) for **unit timesheets only**.

**Context.** The matrix "+" on `/admin/unit-kontrak/kontrak/:id` linked every past missing day of a contract, but the
form silently replaced a date older than 14 days with today (wrong date, empty or wrong unit) and the API refused it.
Operators read the hour meter about once a week, not daily, yet HM start/end and the HM photo were required daily.

**Decision.**

1. **Backdate of a timesheet.** The field reporter (assigned Staff, team PM who is not the project's PM) keeps
   **14 days**. The **PM of the project (`projects.pm`)** and the **Direktur (pk-owner) of the project's PT** may file a
   timesheet for **any past date inside the contract unit's period** (never the future; the active-contract check of §4
   and its DB trigger still apply). Enforced by the service (`mayBackdateTimesheet` → `reportDateError(…,
   { unlimitedBackdate })`) for REST and sync alike; the flag `BACKDATED` is set as before. Other field report types are
   unchanged.
   - `GET /projects/{id}/contract-units` returns the caller's **`timesheetMinDate`** (today − 14, or the earliest
     active contract-unit start for the PM of the project / Direktur) — the APK date picker uses it (fallback today −
     14 against an older server).
   - Web matrix: "+" only on missing days the caller may file (`MatrixCell.fillable`); older missing days stay red with
     "!" and a title naming the limit. The input form honours `?tanggal=`; a date the caller may not file stays visible
     with a notice (never silently swapped), the unit of `?unit=` is preselected when active on that date.
2. **HM weekly = optional on the daily timesheet.** `hmStart`, `hmEnd` and the HM photo are optional:
   - both values or none (400 VALIDATION; DB CHECK `unit_timesheets_hm_pair`), HM end ≥ start, ≥ 0, 2 decimals;
     **work hours stay required**;
   - the HM photo is required **only when HM is filled**; a photo without HM is accepted;
   - **HM_GAP** compares with the previous timesheet of the unit **that has HM** (days without HM are skipped — note: with
     weekly readings the usage between two readings now shows as a gap for the PM to review);
   - the unit's `lastHourMeter` (and the service-report HM_DECREASED reference) ignore timesheets without HM;
   - edits / corrections: `hmStart`/`hmEnd` null clears the HM; `hmPhotoId` (REST) / `hm_photo_media_id` (sync) adds
     the photo of a timesheet that has none — a stored photo is never replaced (REST 400 `PHOTO_LIMIT`, sync: ignored,
     so an older APK resending the stored id keeps working);
   - forms (web + APK): HM awal is prefilled from the last **recorded** HM end (else the unit's last HM); an untouched
     prefill with an empty HM akhir means "no HM today" and is not sent.
3. **Recap.** `rekap-timesheet-kontrak` and the web Rekap tab: monthly **Total HM** = Σ (end − start) over timesheets
   with HM (empty, not 0, when none); "HM awal → akhir" = first / last **recorded** reading; new **weekly HM per unit**
   (weeks Monday–Sunday overlapping the month, labelled with their dates): HM awal = first recorded HM start of the
   week, HM akhir = last recorded HM end, total = HM akhir − HM awal, days with HM. Billing (work hours) unchanged.
4. **Contract.** REST `UnitTimesheet.hmStart/hmEnd/hmUsed`, sync copy `hm_start/hm_end` are nullable; create/sync
   payloads accept them null or absent. **Old APKs always send HM + photo → unchanged behaviour.**

**Consequences.** Migration drops NOT NULL on `hm_start` / `hm_end` (additive for the 0.19 image, which always writes
both); its down step is refused once a timesheet without HM exists. An older APK reading a timesheet without HM from
`GET /unit-timesheets` stores 0 (no crash; its HM prefill may be off until updated). A new APK against a pre-0.20 server
cannot save a timesheet without HM (server refuses, the draft stays for correction).
