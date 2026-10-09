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
