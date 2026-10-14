# Changelog

All notable changes to ProyekKas are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added (DRMS 13/10 Phase B — transfer antar-PT)

- **Pembayaran antar-PT** (owner 2026-10-13: "kas keluar dari DRMS ke LAS → kas masuk ke LAS setelah ditransfer
  finance"), [ADR 0028](docs/proyekkas/adr/0028-intercompany.md) — accepted with the owner decisions of 2026-10-14.
  New **Jenis penerima "PT grup"** (`payeeType: pt_grup`): another active PT of the group, paid to its designated
  **Rekening penerimaan antar-PT** (new checkbox on cash accounts: one active bank account per PT, reason on change,
  audited). Filed by **Finance, PM or Direktur** of the paying PT (Staff / Admin / Owner-only → 403); always Pengajuan
  Baru, Pemohon = the filer, project **or** cost center. The receiving PT's **document (tagihan / memo) is mandatory**:
  number, date and file; the number is unique per receiving PT among live requests (409 field error + DB index).
- **Approval** through the rule engine: seeded per PT "Pembayaran antar-PT oleh Finance — Direktur lalu Owner" (Jenis
  penerima = PT grup, Peran pemohon = Finance); a Direktur's own payment follows "Pengajuan Direktur" (→ Owner), a PM's
  the default rule with the PM step skipped.
- **Transfer** (Finance of the paying PT): KK in the paying PT and — a system write inside the same transaction — the
  **Kas Masuk in the receiving PT** (source "Antar PT", system cash-in source `ANTAR-PT`, its own KM number), paired in
  the new two-PT table `intercompany_links` (DB-guarded: sides, immutability, deferred status consistency). The
  receiving PT's closed period refuses the transfer (409 `INTERCOMPANY_PERIOD_CLOSED`), a changed receiving account too
  (409 `INTERCOMPANY_ACCOUNT_CHANGED`); the payment completes with the transfer (no LPJ). **Void** of the transfer
  reverses the KM as well (the receiving PT cannot void it alone). Finance and Direktur of the receiving PT are notified
  (`cash.intercompany_received` / `cash.intercompany_reversed`).
- Web: form ("PT grup", PT penerima picker from the payee directory, masked account preview, document fields), read-only
  summary + stepper, transfer-queue badge "Antar PT: <PT>", PDF box "Pembayaran Antar-PT" with the receiving PT's KM
  number, Kas: filter "Sumber" and per-row counterpart ("Dari PT … · PB/… · TRF/… · KK/…", "Ke PT … · KM/…"), Buku Kas
  "Antar PT" + column "Lawan PT", Rekap Kas lines "Antar PT (masuk)" / "Transfer antar PT (keluar)" + filter "Tanpa
  antar-PT", Direktur cash-flow card toggle "tanpa antar-PT" (count + label, no elimination).
- API / OpenAPI: `payeeType` `pt_grup`, `payeeCompanyId` (drafts, sync `payee_company_id`; an older app that omits the
  payee type keeps the stored one), detail `payeeCompany` / `intercompany`, transfer queue `payeeCompany`, transfer
  result `intercompany`, cash entries `sourceType` `intercompany` + `intercompany` counterpart + list filter
  `sourceType`, `GET /api/v1/intercompany/payees?company=`, masters type `intercompany-payees`, bank preview
  `payeeCompany`, dashboard cash flow `masukAntarPt` / `keluarAntarPt`. Migrations `20261014_100000`–`100300`
  (`d1310_intercompany_*`). APK: follow-up release.

### Fixed

- A voided transfer of a vendor (and PT grup) payment notified the requester "Disetujui"; it now tells Finance that the
  request is back in the transfer queue (`expense.transfer_queue`).

### Added (DRMS 13/10 Wave 4 — pembayaran vendor)

- **Pembayaran vendor** (client: "kelola vendor dan rekening vendor; finance memilih vendor dan upload invoice"),
  [ADR 0027](docs/proyekkas/adr/0027-vendor-payments.md). New per-PT master **Rekening vendor**
  (`vendor-bank-accounts`: vendor, bank, number, holder, default, verification by Admin / Finance, reason on change,
  audited, no delete) and a **Rekening** tab on the vendor form. Expense requests get **Jenis penerima**
  (`payeeType`: `karyawan` default — unchanged — / `vendor`): vendor, vendor account (of that vendor, same PT), invoice
  number / date / due date / file (required to submit). Vendor payments are filed by **Finance or PM only** (Staff 403),
  always type Pengajuan Baru, Pemohon = the filer. **Project or cost center** (client 2026-10-14): without a project a
  vendor payment names a cost center (pusat biaya, e.g. office bills) — vendor payee only; employee requests keep D2
  (DB rule `pk_expense_requests_project_rules` widened for the vendor payee only).
- **Approval through the generic rule engine**: new rule condition "Jenis penerima"; seeded per PT "Pembayaran vendor
  oleh Finance — Direktur lalu Owner" (Finance → Direktur → Owner, ADR 0026); a PM's vendor payment takes the default
  rule (PM project → Direktur → Owner) with the PM step skipped. **Duplicate invoice** (same vendor + normalized number on a request not cancelled / rejected) → 409 field
  error, DB unique index.
- **Transfer = snapshot of the vendor account**, unverified account → same confirmation as employee accounts; the
  transfer **completes** the vendor payment (no receipts / LPJ / selisih; void → back to the queue). DB guards: payee
  consistency CHECK, no receipt / LPJ status, no settlement for a vendor payment.
- Web: form fields (label-left grid), read-only summary, stepper without LPJ steps, PDF box "Pembayaran Vendor" + invoice
  as first Lampiran, transfer-queue badge, list filter "Jenis penerima". API / OpenAPI: `payeeType`, `vendorId`,
  `vendorBankAccountId`, `invoice*` on drafts, list filter `payeeType`, detail `vendor` / `invoice`, transfer queue
  `vendorName`, masters type `vendor-bank-accounts`, bank preview `vendorAccount`. Migrations
  `20261013_700000_d1310_vendor_payments` (+ `_guard`, `_data`). Guides: finance, pm, admin.

### Added (DRMS — Owner approval level)

- **Role "Owner" (`pk-principal`) one approval level above the Direktur** (owner decision 2026-10-13, ADR 0026):
  expense requests go **Staff → PM project → Direktur → Owner → Finance (transfer queue)**. The Owner has the same view
  and permissions as the Direktur in every PT where he holds the role (effective roles: `pk-principal` implies
  `pk-owner` for every access check); the approval engine matches the **stored** role, so the Owner never decides the
  Direktur level and vice versa (distinct persons, step holders and step notifications by exact role). Assigned per PT
  in Pengguna / Akses PT (label "Owner").
- **Rules:** every active expense rule gets an Owner level placed **Direktur → Owner → Finance** — directly after the
  last Direktur level, else before the first Finance level (ADR 0013 shape: Owner becomes level 1), else at the end;
  following levels renumbered (data migration `20261013_630200`, idempotent, audited; names kept, inactive rules
  untouched); "Pengajuan Direktur" → approved by the Owner; new **"Pengajuan Owner"** (Peran pemohon = Owner, no level,
  priority 5): the Owner's own request goes straight to Finance (`principal_no_approval`, audited, DB-checked). Zero-step
  rules are now allowed for requester role **Owner only** (hook + DB trigger); an Owner level is never skipped silently
  (409). Addendum RAB and inter-project loans stay Direktur-only. LPJ shortfall re-approval uses the same rule (→
  Owner). Requests submitted before keep their snapshot (Direktur = last level). SLA still starts at the final approval.
- **Labels (web + APK):** "Persetujuan Owner", "Menunggu persetujuan Owner", decision texts, PDF Approval box with every
  level and its role, PM KPI `teamWaiting.owner`, transfer queue `noApprovalBy`, notifications / email "Persetujuan
  Owner". APK: `Role.principal` ("Owner", Direktur home + inbox), stepper and decision sheet with the Owner level.
- **Migrations:** `20261013_630000_d1310_owner_role` (enum values), `…630100_…_guard` (zero-step = Owner only,
  `g1_exception` += `principal_no_approval`, approval guard), `…630200_…_data`. OpenAPI: `Role`, `OnboardingRole`,
  membership batch roles, `decisionBy`, `selfApproval`, `TransferQueueItem.noApprovalBy`, PM dashboard `teamWaiting`.
- **Owner role = group admins only** (owner decision 2026-10-14): only a group admin grants or removes `pk-principal`
  — `company-memberships` hook (403 "Peran Owner hanya dapat diberikan atau dicabut oleh Admin grup."), so REST, the
  Akses PT matrix and the Pengguna form are all covered; PT admins don't get the option (shown locked where held).
- **With ADR 0025 (definitive Direktur per PT):** the Owner level is never a Direktur step — the Owner always signs with
  his own profile / drawn signature, never the PT's Direktur signature; the PDF Approval box prints a representative's
  decision as "Nama (Jabatan)" of the definitive Direktur and the other levels with their role ("… (Owner)").
- **Deploy step:** after migrating, a **group admin** ticks **Owner** for the Owner in every PT — until then submissions under a rule with
  an Owner level answer 409 ("Tidak ada pengguna aktif … (peran Owner)").

### Added (DRMS — tipe absensi OnSite / Non-OnSite)

- **Tipe absensi per karyawan** (ADR 0023 amendment 2026-10-13, owner DRMS 13/10 A2): `employees.attendanceType`
  **Karyawan OnSite** / **Karyawan Non-OnSite** on the Karyawan form, the Pengguna form (tab Data Karyawan,
  `user-onboarding` `employee.attendanceType`) and as a list filter. **OnSite** may check in at every registered
  location of its PT that has a point (sites incl. the head office, projects, cost centers) **without a team
  assignment** (outside the radius refused); **Non-OnSite** (office staff, owner 2026-10-14) has **no location
  restriction**: inside a registered location → recorded there, else recorded **"Di luar area"** referenced to the
  home site (else the head office) with the distance (`attendances.outside_area`); a check-out closes the day's open
  check-in. GPS, mock refusal, selfie and privacy rules unchanged; own PT only. Existing and new employees default to
  **OnSite** (nothing that worked before is refused).
- **"Di luar area" everywhere it is read**: recap / API stamps `outsideArea` + day flag `OUTSIDE_AREA`, Laporan
  Absensi (Lokasi `Di luar area (ref. …)`, Keterangan), web recap chip, Absensi list column / filter, APK recap and
  history; web check-in result `{location, outsideArea, distanceM}`.
- **"Kantor pusat" on sites** (`sites.isHeadOffice`, at most one per PT: field error + DB unique index), list
  column / filter, `isHeadOffice` in the `sites` masters.
- **`GET /api/v1/attendance/locations`**: the registered check-in locations of the caller's PT(s) (id, kind, code,
  name, point, effective radius, head office / home flags) per own employee in the selected PTs, plus the "Di luar
  area" `referenceSite` of a Non-OnSite employee — no money / budgets. OpenAPI `AttendanceLocations`.
- **Automatic area detection** — APK: the Absen tab selects the location whose geofence contains the GPS fix (nearest
  when several overlap, chips to pick another; none → OnSite: manual picker with the nearest as a hint, Non-OnSite:
  the "Di luar area" entry), button "Deteksi lokasi otomatis", "Pusat" badge, type hint; the list is cached for
  offline check-ins (server re-validates at sync). Web "Absensi · Absen": same list, detection and "Di luar area".
- Migrations `20261013_620000_d1310_onsite`, `20261013_620100_d1310_onsite_guard`. **Deploy:** Admin flags the head
  office of each PT (with point + radius) and sets office staff to Non-OnSite.

### Added (DRMS — tanda tangan Direktur definitif per PT)

- **Per-PT definitive Direktur** (ADR 0025, owner requirement DRMS 13/10 A3). Perusahaan (PT) → new tab **"Direktur
  definitif"**: name, title (jabatan), signature PNG and the designated representatives ("wakil penanda tangan" —
  users with the Direktur role in that PT). Changed by the Admin of the PT / group admins only; read by the PT's
  Admin / Direktur / Finance. A configuration is complete (name + signature) or empty; the signature must be a new
  upload (never a user's profile signature); representatives must hold the Direktur role in the PT.
- **Representative signs as the PT's Direktur on the Direktur step.** When a representative decides a Direktur step
  (ADR 0021 Persetujuan Direktur, ADR 0013 / Addendum "Diketahui" by the Direktur role or delegated to the Direktur
  tier, LPJ shortfall re-approval, inter-project loan decision — approve and reject) the approval row stores the PT's
  signature (`signatureSource = company`), `actorName` = the definitive Direktur and a name/title snapshot
  (`representedDirektur`); `actor` stays the real user (G1, one position per person, forensics). A drawn signature
  sent by the representative is ignored. PTs without the configuration, non-representative Direktur and every
  non-Direktur step (PM, Finance, named user, Diajukan / Dibuat) are unchanged.
- **Display:** PDF "Pengajuan Biaya" prints the PT Direktur's signature and "Nama (Jabatan)" with no "via app" note;
  approval timeline / stepper, decision lists, API `approvals[].actorName`, loans `decidedBy`, Log perubahan / Riwayat
  (`GET …/history` → APK) and the audit-log report show the definitive Direktur (`audit_logs.actor_display_name`;
  `user_id` stays the real user). `GET /expense-requests/{id}` gains `direkturSignature {name, title, signatureId}`
  (OpenAPI updated); the APK decision sheet then shows "Tanda tangan Direktur PT" read-only, the web decision bar names
  it. The admin "Approval & tanda tangan" form hides the user of company-signed rows.
- **Security:** the PT signature file is readable only by the office roles of that PT (owner link `company_direktur`,
  immutable), never through the "uploads of members" rule nor the request-signature fallback of
  `GET /api/v1/media/signatures/{id}/file` (Staff / PM: 404). DB guard: company-signed approval rows only from a
  designated representative holding the Direktur role in the row's PT, with the PT's current signature / name / title;
  CHECK signature source ⇔ snapshot. Migrations `20261013_910000_d1310_direktur_ttd` +
  `20261013_910100_d1310_direktur_ttd_guard` (additive).

### Added (DRMS 13/10 Wave 4 — one-time document renumbering)

- **One-time controlled renumbering** (client Umum #1: "Reset penomoran dari 1 dan bentuk ulang nomor yang sudah ada
  berdasarkan tanggal dibuat. Kas Masuk belum ada kode singkat PT."; owner decision D1). CLI
  `apps/web/src/renumber/cli.ts` (migrate image, OWNER DSN; runbook `docs/proyekkas/runbooks/penomoran-ulang.md`):
  `--dry-run` (read-only: full old → new mapping as JSON + CSV, derived-text changes, counters, pattern fixes, plan
  sha256) → `--apply --expect-sha256 <reviewed>` (ONE transaction, refuses a changed plan / a second run / any plan
  error) → `--verify`. Per PT × doc type × month of the document, ordered by `created_at` (tie: id), numbered 1..n with
  the PT's current pattern; a pattern without `{COMPANY}` (the custom KM `KM/{YY}{MM}/{seq}`) moves to the D5 default
  `KM/{COMPANY}/{YY}{MM}/{seq}` first. Numbers copied elsewhere are rewritten in the same transaction (cash-entry
  descriptions, notification number/title/body, duplicate-receipt flags); counters = last number + 1, so the next new
  document continues at n + 1. NOT run on deploy — the infra Lead runs it staging → prod with the owner's go.
- **Audit**: new action `renumbered` — one row per renumbered document (field `docNo` / `entryNo`, old → new, same
  `tx_id`) and per rewritten cash-entry description; "Log perubahan" / "Riwayat" show **"Nomor diubah: lama → baru"**.
  Old audit rows are not rewritten (append-only).
- **DB (migration `20261013_610000_d1310_renumber`, changes no document)**: `document_renumber_runs` (one row per PT,
  UNIQUE → a second run is refused; owner-only writes), `pk_renumber_bypass()` and a guard prelude in
  `pk_protect_columns`, `pk_counter_monotonic` and the expense-request / transfer / LPJ / ledger / progress /
  field-report / addendum / loan / receipt-flag guards: a number / derived-text change passes ONLY with the session
  flag `pk.renumber = 'on'` AND a running run row of the current transaction AND no other column changed — every
  ordinary write stays blocked. ADR 0007 "Amendment 2026-10-13" records the one-time exception; the never-rewrite rule
  stays in force afterwards.

### Changed (DRMS 13/10 Wave 3 — dashboard parity APK)

- **One source for the web dashboard and the APK home.** `GET /api/v1/dashboard/{owner,finance,pm}` now carries the
  cards the web view used to load on its own: `sla` ("SLA transfer": this month's transfers within the PT SLA, average,
  late), `loans` ("Pinjaman antar project": totals, top 5 projects, `waitingForMe`), `rapMonitoring` ("Monitoring RAP")
  and `rapMissing` ("Project ber-RAB belum punya RAP"; `team` on the PM layout). Built once in
  `domain/reports/dashboards.ts` (`slaBlock`, `loanBlock`, `rapMonitoringBlock`, `rapMissingBlock`); the web cards
  (`dashboard-sla/-loans/-rap.tsx`) render the same payload, so web and APK cannot drift. Scopes unchanged: SLA = PTs
  where the caller is Direktur/Finance, loans = office roles their PTs / PM the team projects, RAP = the caller's
  project read scope (PM layout: team only). Visibility as on the web: Direktur all four, Finance SLA + loans, PM loans +
  its team's projects without RAP, Staff/Admin none. OpenAPI (`OwnerDashboard`, `FinanceDashboard`, `PmDashboard`)
  updated. Fix: "Project ber-RAB belum punya RAP" no longer fails (400 "path cannot be queried: budget") for a caller
  who is Staff in another selected PT — the RAB filter now runs on the budget the caller may read.
- **APK home = web dashboard per role, in the web's order** (client: "Dashboard di APK belum ada: SLA transfer,
  Pinjaman antar project, Project ber-RAB tanpa RAP, Tren pengajuan, Saldo per akun, Kelengkapan nota/LPJ"). Direktur:
  Status pengajuan, Komposisi biaya per kategori, SLA transfer, Monitoring RAP, Pinjaman antar project, Project ber-RAB
  belum punya RAP, Tren pengajuan (tap a month), Saldo per akun, Kelengkapan nota/LPJ, Transaksi kas terbaru, Pusat
  biaya bulan ini. Finance: Saldo per akun (masuk/keluar bulan ini), Status pengajuan, Pengajuan baru belum LPJ,
  Transaksi kas terbaru, Komposisi biaya, SLA transfer, Pinjaman antar project, Tutup buku. PM: Project Anda belum
  punya RAP, Status pengajuan tim, Tren pengajuan tim, Komposisi biaya, Pinjaman antar project, Pusat biaya saya. New
  Staff summary from `/dashboard/me` (own requests; amounts: see below) and Admin summary from `/dashboard/admin` (master-data
  gaps). Rows open the project's RAP / Pinjaman tab or the request. KPI cards show **full Rupiah** values (Umum #10);
  new CustomPainter charts: request-trend columns and a horizontal bar list.
- **APK Staff home shows the amounts of the user's OWN requests** (owner 2026-10-13), the same figures as the web
  Staff home: KPI "Pengajuan <bulan>" with its Σ, **Status pengajuan saya** with count · Σ grand total per stage,
  new card **Pengajuan terbaru saya** (10 latest own requests: number or `Draft "judul"`, status, Nominal; tap opens
  the request) and **Pengajuan saya per bulan** with the Σ in the readout — full Rupiah. `/dashboard/me` already
  carried exactly these own-scoped figures (`ownScope`: `latest[].grandTotal`, `viz.pipeline` sums,
  `viz.requestTrend` sums), so no API change. No other money on the Staff home (no project budgets, cash or other
  people's requests); the web Staff project pages stay money-free.

### Added (DRMS 13/10 Wave 3 — Pengguna tabbed onboarding)

- **One tabbed "Pengguna" form** (`/admin/pengguna/baru`, `/admin/pengguna/<id>`; client: "Satu UI ber-tab: Detail
  Pengguna, Permissions, Detail Karyawan, Rekening Karyawan"): tabs **Detail Pengguna** (email, nama, No. HP,
  status), **Akses & Peran** (per PT the roles as ONE checklist dropdown — "multiple dropdown, bukan checkbox"),
  **Data Karyawan** (per PT: create, pick an unlinked employee of that PT, edit the linked one, unlink),
  **Rekening Karyawan** (list + "+ Tambah rekening") and **Penugasan Proyek** (read-only). Label left of the input
  (D4 grid, now shared as `.pk-fgrid`), stacked below 640 px. One **Simpan**; a refused save marks the fields and
  opens the first tab with an error. Admin of a PT / group admin only; the PTs shown = the caller's Admin PTs within
  the PT selection. The users list ("+ Buat baru", row click; "Aksi" column dropped there), the menu ("+ Pengguna
  baru") and the Akses PT matrix ("+ Pengguna baru", user name) open it; others keep Payload's user form.
- **`POST /api/v1/user-onboarding`, `PATCH|GET /api/v1/user-onboarding/{userId}`:** account + memberships +
  employees + bank accounts in ONE DB transaction, every write through the existing collections with the caller's
  access (same rules, hooks and audit rows as the separate pages: Admin of THAT PT, Users update access for the
  identity, bank-account reason / verification rules, same-PT employee, one employee per account and PT). Keycloak
  first (Users hook); on any failure the transaction rolls back and the endpoint compensates Keycloak (new user
  deleted, enabled flag / login role reverted). Errors as problem+json with `errors[].path` = body paths
  (`user.*`, `companies.<i>.…`, `reason`); Keycloak refusing → 502 `KEYCLOAK_FAILED`. Own account: no
  self-deactivation, no removal of the own Admin role. OpenAPI: `UserOnboardingCreate` / `UserOnboardingUpdate` /
  `UserOnboardingResult` / `UserOnboardingDetail`.
- **Temporary password for new accounts:** a NEW Keycloak user created here gets a generated temporary password
  (`reset-password`, `temporary: true` → Keycloak requires a new password at the first login, `UPDATE_PASSWORD`),
  shown ONCE to the Admin (never stored, logged or audited — the audit row records only the fact). An existing
  Keycloak account with the email is linked, password untouched. Keycloak admin client: `resetPassword` (same
  signature as the APK initial-password branch). ADR 0003 "Revisi 2026-10-13".
- **Akses PT matrix:** the role checkboxes of a cell are the same checklist dropdown (`MultiSelect` form mode:
  applies on tick, "Kosongkan" / "Selesai", floats above the scrolling table); rules unchanged.

### Added (DRMS 13/10 Wave 3 — Proyek › RAP)

- **Own sub-menu "Proyek › RAP"** (client: "Form RAP + upload, submenu sendiri di bawah Proyek"): section **RAP** in the
  Proyek module (launcher / landing tiles) with **RAP proyek** (`/admin/rap`) for Direktur, Admin, Finance and PM; the
  raw lists **Data item RAP** and **RAP templates** moved there from "Laporan lapangan". The Staff menu is unchanged
  (project list only); Staff may still open the pages read-only, without money, like the project's RAP tab.
- **RAP index** `/admin/rap`: every project the caller may read with its RAP state (**Ada · n item**, **Belum ada
  (wajib)** for projects with a RAB or konstruksi, **Belum ada**), Wave 2 toolbar (search, multi-select PT / status
  project / RAP, archived only on request), numbered pages, clickable rows and a **totals row** at the bottom (projects,
  items, Σ RAP, Σ RAB over every filtered row). **Total RAP** (Σ volume × harga satuan of the active items) only for the
  RAP price roles of the project (Direktur / Admin / Finance of the PT, PM of the project team), **RAB** only where the
  RAB field is readable, **RAP / RAB** % with a "Melebihi RAB" warning; Staff sees no money column at all.
- **RAP page per project** `/admin/rap/:id`: items table (kode, uraian, jenis, tahapan, volume; harga satuan / jumlah /
  realisasi for the price roles) with a **Grand total** row, **+ Tambah item** and **Ubah** in one dialog (label left of
  the input, D4; same limits as the API; jumlah computed live), deactivation instead of delete (items are never
  deleted), a "Sudah terpakai" chip on items with realisation. It calls the existing `POST /api/v1/projects/{id}/rap/items`
  and `PATCH /api/v1/rap-items/{id}` (no API change). Lock unchanged: once a daily report realised anything the PM sees
  the buttons disabled (409 `RAP_LOCKED` server-side), Direktur / Admin edit with a reason. **Upload Excel & template**
  (RapImport, template, RAP download, RAP templates) stay on the page for the RAP editors. The project's RAP tab links
  to it ("Ubah item RAP").
- **Used RAP item: editable, reason required and audited** (owner 2026-10-13). An item that is already used — the
  "Sudah terpakai" definition, now one pure rule `rapItemUsed` (`domain/rap/rules.ts`): expense lines charged to it
  from the final approval onward or daily-report quantities — stays editable by the roles that may edit, but **any
  change needs a reason** (min. 3 characters, the repo's reason rule) for **every** role, enforced server-side:
  `PATCH /api/v1/rap-items/{id}` → 400 `VALIDATION` with field error `reason` ("Item RAP sudah terpakai: isi alasan
  perubahan (min. 3 karakter)."); the reason goes to the audit row of the change (`auditReason`, like the locked-RAP
  reason). The dialog shows a required **Alasan perubahan** for used items. The Excel import follows the same rule:
  the preview lists `usedChanged` (used items the file changes or deactivates) and the commit then needs `reason`.
  The RAP lock after daily-report realisation is unchanged (PM 409 `RAP_LOCKED`, Direktur/Admin with reason).
  OpenAPI: `RapItemUpdate.reason` / `RapImportCommit.reason` descriptions, `RapPreview.usedChanged`. The APK does not
  edit RAP items (no change there).
- Shared `FORM_GRID_STYLE` (`admin/components/form-grid.ts`): the label-left grid of the Wave 2 request form for custom
  `.pk-fld` forms and dialogs.

### Changed (DRMS 13/10 Wave 2 — generic list view, Umum #3–#8, Persetujuan #2)

- **One list view for every collection** (`PkListView`, `src/admin/pk-list/`, wired centrally in `payload.config.ts`
  via `withPkListView`; media libraries keep Payload's list): title + **Buat baru** (create permission only), the same
  filter bar as the custom views (search, **checklist dropdown** filters per collection — select values, booleans,
  relationships to master data, PT when 2+ PTs are selected — date ranges on the key date), **Kolom ▾** (checkbox
  list, saved per user and collection in Payload's `collection-<slug>` preference), sortable headers, the shared pager
  (20/50/100), **every row opens the record** (click / Enter). Payload's pill controls (Kolom / Filter / WhereBuilder),
  the selection checkboxes and bulk edit/delete ("pilih isian untuk diedit") are gone; editing goes through the
  document form (the **Ubah** button of the Aksi column). Rows are read with `overrideAccess: false` as the user; the
  PT filter is intersected with the PT switcher selection (the URL can only narrow). URL state: `q`, `hal`, `per`,
  `urut`, `f.<field>=a,b`, `f.<date>.dari/.sampai`; old `where[…]` deep links still work (dashboard KPI tiles now use
  `f.status` / `f.requestDate`). The single-choice PT chips (`CompanyListFilter`) are replaced by the PT multi-select.
- **Multi-select filters on the custom views** (Umum #4, Persetujuan #2): Persetujuan (PT, jenis, langkah), Antrian
  Transfer (PT, jenis), Verifikasi LPJ (PT, tahap), Pinjaman (status, project, peran), Kas (akun, project, pusat
  biaya, arah, status), project tabs RAP / Pengajuan, Progress and Notifikasi use the same checklist dropdown
  (`MultiSelect`; values as `?key=a,b`). `listLoans` and the Kas book query accept several values (`in`).
- **Clickable rows / pagination** (Umum #3, #7): Antrian Transfer (queue item + recorded transfers), Verifikasi LPJ
  receipts, Kas book, Pinjaman and project Pengajuan rows open their record; dashboard / report tables (`DataTable`)
  with more than 20 rows are paged in the browser (tables paged in the database keep the URL pager).

### Changed (DRMS 13/10 Wave 2 — expense-request (Persetujuan) detail page)

- **Persetujuan #3 — one stepper:** the status chips and the "Alur persetujuan" timeline are merged into one vertical
  stepper "Alur pengajuan" in the right column (sticky; after the summary on screens ≤ 1024 px): Diajukan → the
  positions of the request's approval snapshot (PM, Direktur, Finance level …; skipped / no-approval positions shown as
  such) → Verifikasi nota (Reimburse) → Transfer → Nota & LPJ → Persetujuan kekurangan (when asked) → Penyelesaian LPJ
  (Pengajuan Baru) → Selesai, or Ditolak / Dibatalkan with the reason. Per step who, when, decision and note; the
  waiting step is highlighted as "Tahapan saat ini", a step sent back (Revisi Nota, LPJ Revisi, a withdrawn request)
  as "Dikembalikan". Derived from existing data only (`domain/expense/request-stepper.ts`, pure, reusable by the API).
- **Persetujuan #5 — action bar:** the right sidebar no longer holds "Cetak PDF", "Total ditransfer" and "Aturan
  approval". One row in the document controls holds the decision (Tolak / Setujui with "Menunggu keputusan Anda"),
  Finance's "Catat transfer" / "Verifikasi nota" link, **Cetak** (a menu when the internal PDF copy is available),
  **Duplikat** and **Edit** / **Batal** + **Simpan**. The fixed bottom decision bar is gone from this page. "Nominal
  disetujui", "Total ditransfer" and "Total nota terverifikasi LPJ" are rows of the "Rincian pengajuan" summary (two
  columns on wide screens); the approval rule's name is shown in the stepper for Finance / Admin.
- **Persetujuan #6 — Log perubahan:** "Snapshot aturan approval" (raw JSON, Admin) removed from the page. A collapsible,
  paged (20 rows) "Log perubahan" at the end of the main column lists the request's history (request, receipts,
  transfers, LPJ; cash entries for the office roles): time, who, action, field old → new (status as its label), reason,
  headed by the created / last-changed times. The "Riwayat" tab is unchanged (same labels, `domain/history-format.ts`).
- **Persetujuan #7 — Edit → Simpan:** the page opens read-only (summary + "Rincian item"), Drafts included. **Edit**
  (only when the request may be changed: Draft / Revisi Nota and the update access) shows the same Payload form with
  the loaded data; **Simpan** is Payload's save (validation, "Alasan perubahan" in Revisi Nota unchanged) and returns
  to read mode; **Batal** discards the changes. A new request opens in edit mode. Kirim pengajuan / nota / LPJ actions
  stay in read mode.
- **Persetujuan #12 — Duplikat:** Payload's ⋯ menu ("Buat Baru") is hidden and Payload's duplicate is off for expense
  requests (it copied number, status, snapshot, totals and attachments). New `POST /api/v1/expense-requests/{id}/duplicate`
  creates a clean Draft with the same PT, project, title, urgency, notes, requesters, account (if still valid) and lines —
  no number, approvals, transfers, receipts, flags, attachments, "Nominal sesuai nota" or needed date — as the caller,
  with the normal draft rules (read access to the source + a create role in its PT; Staff only for themselves),
  audited on the new draft (`create`, field `duplicated_from`), then opens it.
- **D4 (form grid, this form only):** in edit mode the expense-request inputs sit in a two-column grid with the label
  left of the input (~35 %); long fields (Keterangan, Lampiran, Rincian item) span the row; below 640 px the label is
  on top again. Other forms follow in a later wave.

### Changed (DRMS 13/10 Wave 1 — expense-request form and approval page)

- **Pengajuan #1/#2:** the PT picker of a new expense request offers only the PTs selected in the PT switcher (top
  right) where the user may create requests. Exactly one such PT (one membership, or the switcher on one PT) → it is
  prefilled and shown read-only as the PT badge. Server rules unchanged: the role in the chosen PT is still checked on
  save (a PT outside the switcher selection is not rejected by the picker filter; one without the create role is).
- **Pengajuan #3/#5:** Project, Tingkat urgensi, Pemohon and Rekening tujuan stay disabled ("Pilih PT terlebih
  dahulu") until the PT is known, then list only that PT's rows (no more Low/Medium/High of three PTs listed three
  times). Opt-in (`pickerSameCompany({ createRoles })`); other forms keep their pickers. List-view filters unchanged.
- **Persetujuan #1:** the approval inbox no longer has the expandable "Rincian baris, nota & flag" row; the whole row
  opens the request (click or Enter; the Setujui / Tolak buttons and links in the row work as before).
- **Persetujuan #4/#9/#10/#11/#13 (request detail):** "Keputusan siklus sebelumnya" removed (earlier cycles stay in the
  Riwayat tab); "Giliran:" → "Tahapan saat ini:", "Giliran Anda:" → "Menunggu keputusan Anda:" (timeline state
  "Saat ini"); the grand total moved from the header to the footer row of "Rincian item" (read-only table and the
  draft lines table, which replaces the separate "Total (pratinjau)" box); the summary line "Flag terbuka … · Nota
  menyusul …" removed (flags stay per line); Payload's "Terakhir Diubah / Dibuat" hidden on the expense-request page.
- **Persetujuan #8:** the PT of a document is a small badge (code + name) without the "PT:" label.

### Changed (DRMS 13/10 Wave 1 — Umum #9 / #10)

- **Top bar without the module menu** (Umum #9, owner decision D2): the links / ▾ dropdowns of the current module and the
  ☰ sheet on mobile are gone from the bar. Launcher, module name, PT switcher, bell, avatar menu and breadcrumbs stay.
  The module name (and the breadcrumb home) opens the module landing page, whose tiles are exactly the former menu
  entries (same visibility rules, badges kept; single-item modules link straight to their page) — no page became
  unreachable. The module's pending-count badge (transfers / LPJ) now sits next to the module name.
- **One number format everywhere** (Umum #10, id-ID: thousands `.`, decimals `,`): new `formatNumber` next to
  `formatRupiah` (`src/lib/money.ts`), reused by the dashboard, custom views, list cells and messages (no more ad-hoc
  `Intl` / `toLocaleString`). KPI tiles show the **full Rupiah value** (`Rp 12.500.000`, size follows the tile width)
  instead of `Rp 12,5 jt`; tables and text too (Dashboard, Kas, Pinjaman, Addendum, Aftersales, RAP/loan cards). The
  compact form stays only on chart axes and bar labels (exact value in the tooltip and number table). Counts use
  thousands separators.
- **Payload lists:** Rupiah fields are recognised by a marker set by `rupiahField()` (server-only `custom`, no schema
  change) instead of the "(Rp)" label — `ApprovalRules.maxAmount`, `ExpenseLineSnapshots.grandTotal` and
  `Receipts.taxAmount` now show "Rp 1.250.000"; every other number column (counts, quantities, hours) shows `12.000` /
  `7,5` (coordinates stay raw).

### Changed (APK, DRMS 13/10 Wave 2 — form grid and Persetujuan)

- **Umum #2 / D4 — shared `FormGrid` / `FormGridCell`** (`lib/shared/widgets/form_grid.dart`): "label | input" cells,
  label ≈35% left of the input and top-aligned from 600dp, two columns of cells from 900dp (full-width cells for notes,
  line lists and photo pickers span both), label on top and one column on phones (< 600dp; the input keeps its own
  floating label there). Source order = focus order. `MasterPickerField`, `RapItemPickerField` and `FieldDateField`
  drop their own label while a cell shows it. Applied to the expense request form (Pengajuan), the line editor, the
  Finance transfer form, "Kirim LPJ", the loan form (Pinjaman) and the service report (Laporan Servis Unit: unit and
  work sections). Keys, validation and field order unchanged; on phones the Qty / Satuan, Tanggal / HM and Mulai /
  Selesai pairs now stack (single column); the "Tanggal dibutuhkan" and loan dates are date inputs instead of list
  tiles (same picker).
- **Persetujuan #3 — one stepper on the request detail**: the overall flow and the approval steps merged into one
  vertical stepper (Diajukan → Persetujuan PM / Diketahui → Persetujuan Direktur / Approval → Verifikasi nota Finance
  (Reimburse) → Transfer Finance → LPJ (Pengajuan Baru) → Selesai, or Ditolak / Dibatalkan), each step with actor,
  time, decision (Disetujui / Ditolak / Diketahui) and note; exactly one step is labelled "Tahapan saat ini". Phones:
  after the summary; tablets (≥ 900dp): right-hand column. Built only from `GET /expense-requests/{id}` (approvals,
  rule snapshot, transfers, settlement, status) — no API change.
- **Persetujuan #8–#11 on the APK detail**: the PT is a badge in the header (no "PT" row); "Giliran" → "Tahapan saat
  ini" / "Menunggu keputusan Anda" (when the server allows this user a decision); the grand total is the footer row of
  "Rincian item" (removed from the summary); the header summary chips "Selisih nota" / "Melebihi RAP" are gone (the
  chips stay on the lines) and a line's other flags are shown on its card ("Flag validasi" lists request-level flags
  only). The APK had no "Keputusan siklus sebelumnya" block. The expense form shows the PT badge without "PT:".

### Changed (APK, DRMS 13/10 Wave 1 — Umum #10)

- `formatDecimal` / `formatPercent` (id_ID, `core/format/rupiah.dart`) replace the `toStringAsFixed` percentages of the
  project detail (progress, RAP summary and items), project list and RAP item picker, and the queue size in MB.

## [0.9.1] - 2026-10-12

**0.9.0 plus the "Lampiran umum" fix** found on production 2026-10-12 (PB 230/PB-DRMS). Production goes 0.6.4 → 0.9.1:
the notes of **0.9.0 and 0.8.0 below apply to this deploy as well** (their migrations and deploy checklists run first).
0.9.0 was tagged without this fix and is not meant to be deployed.

**Database migrations** (after those of 0.9.0): `20261013_500000_attachments_owner_link` (data, idempotent, audited).
**Take the pre-deploy dump.**

**Deploy checklist (in addition to 0.9.0's):** read the migrate log of `…_attachments_owner_link` (`linked`) and of
`…_approval_config_data` (a PT listed in `customisedKept` did not get the "Pengajuan Direktur" rule — the Admin creates
it, ADR 0024 Rollout 2); rules are data: the 0.6.x rule "Direktur lalu Finance" keeps Finance as an approver until it is
changed. New requests always need a project (D2): spending that used a pusat biaya needs a project per kind of spending
(e.g. an office / payroll project) and, where wanted, a rule scoped to it.

### Fixed (Lampiran umum, production 2026-10-12, PB 230/PB-DRMS)

- "Lampiran umum" of an expense request were stored on the draft but never linked to it, so only the uploader (and office
  roles of EVERY PT) could open them: the PM / Direktur / Finance deciding saw no image. They are now linked at **submit**
  (every path — web form, APK, submit again after withdraw; idempotent), and only uploads of the people on the request
  (creator, requester accounts, the person submitting) are accepted (else 409 "Lampiran bukan unggahan pembuat/pemohon
  pengajuan ini"). A file copied by "Ajukan ulang" keeps the link to its original request.
- Migration `20261013_500000_attachments_owner_link` (data, idempotent, audited): links the files of requests already
  submitted before the fix (referenced by exactly one request, uploaded by its creator or "Diajukan Oleh" signer); drafts
  are linked at their submit.
- **PDF Pengajuan Biaya** prints the "Lampiran umum" after the receipt pages ("Lampiran Umum — <nomor> (1–2 dari n)"):
  images embedded (sharing the 12-image budget of ADR 0008 §2), PDF files listed.

## [0.9.0] - 2026-10-12

**DRMS 10/10 Phases D–G on top of 0.8.0** (owner decisions 2026-10-11): Staff see their projects without money,
Pinjaman antar project (ADR 0022), sites / kantor cabang (ADR 0023), configurable approval rules + Direktur's own
request without approval (ADR 0024), RAP for every project with a RAB (D4 amendment). Production goes 0.6.4 → 0.9.0, so
**the 0.8.0 notes below apply to this deploy as well** (its 11 migrations and deploy checklist run first). The APK
features of these phases need the next APK build (drift schema **9**); APK 0.5.0 keeps working against 0.9.0 (all API
changes are additive).

**Database migrations** (after those of 0.8.0, in this order; details in the sections below):
`20261013_100000_d1010_project_loans`, `20261013_100100_d1010_project_loans_guard`, `20261013_200000_d1010_sites`,
`20261013_200100_d1010_sites_guard`, `20261013_300000_d1010_approval_config`, `20261013_300000_d1010_approval_config_guard`,
`20261013_300000_d1010_approval_config_data` (rule "Pengajuan Direktur" per PT that still has the default rules),
`20261013_400000_d1010_rap_all`, `20261013_400100_d1010_rap_all_guard` (logs every project with a RAB but no RAP). Each
has a `down()`; **take the pre-deploy dump**.

**Deploy checklist (in addition to 0.8.0):** check the approval rules of every PT, incl. the new "Peran pemohon" and the
"Pengajuan Direktur" rule; **every project with a RAB (any kind) needs a RAP** before its requests can be sent — the
migration log and the dashboard card "Project ber-RAB belum punya RAP" list them; sites are optional (a PT without sites
behaves as before); the overdue-loan reminder is a per-PT switch.

**CI / release:** integration tests split into three jobs (halves a / b + the F3 KPI data set); images are published to
`ghcr.io/bima-creative-tech/proyekkas-{web,migrate}` after the repository moved to `BIma-Creative-Tech/drms` (older
images stay under `ghcr.io/bctech-adm`).

### Changed (DRMS 10/10 follow-up — Staff see projects without money, owner 2026-10-11)

- Web: Staff get the "Proyek" module — the list of their assigned projects (search / filter) and the project page
  read-only (no Simpan): tab Proyek without RAB, tab RAP with codes, volumes and realised volume only, tab Pengajuan with
  their own requests only; no tab Pinjaman for Staff (shown to Direktur, Admin, Finance and PM only).
- Project money is now hidden from Staff at the API level (field read access, `access/money.ts`): `projects.budget`
  (RAB / contract value), `rap-items.unitPrice` and the RAB % of approval rows (`approvals.budgetPctBefore/After`) are
  readable only with a money role (Direktur, Admin, Finance, PM) in the row's PT — also through `?select=` and `depth`
  population; a `where` / `sort` on those fields is refused. `/api/v1/projects` returns `contractValue: null` for
  Staff; `GET /api/v1/expense-requests/{id}` returns `budget: {basis: "none", pctBefore: null, pctAfter: null}` and
  null `approvals[].budgetPct*` for callers without a money role (the % with the request total revealed the RAB).
- APK: "Proyek" menu for Staff (tabs Proyek / RAP / Pengajuan — own requests only, no Pinjaman); no contract value row
  for Staff; the request detail drops the "Dampak anggaran" row for Staff instead of showing "Tanpa anggaran".

**DRMS 10/10 Phase D — Pinjaman antar project (ADR 0022, owner D6 + Q-L1…Q-L7 2026-10-11).** The PM of the borrower
project submits a loan from another project of the SAME PT (Dana or Barang/material, value in Rp, no interest, due date
required); one Direktur decides (G1: another Direktur when the PM is a Direktur; the PT's only Direktur may approve his
own loan, recorded as `direktur_self`); the lender PM is notified. Repayments are recorded by the borrower PM or Finance
without approval (append-only, void with reason) → Sebagian kembali → Lunas; "Terlambat" is derived from the due date.
Notional allocation: **no cash entry is created** for a loan or a repayment; RAB / RAP / realisation unchanged.

**Database migrations:** `20261013_100000_d1010_project_loans` (tables `project_loans`, `project_loan_repayments`,
`approvals.loan_id`, enum values `project_loan`, `companies.reminder_loan_overdue_enabled`) and
`20261013_100100_d1010_project_loans_guard` (same-PT triggers, transitions + frozen content, repaid = Σ posted repayments,
append-only repayments, approvals owner CHECK + G1 branch, reminder rule `loan_overdue`, sequence
`PJ/{COMPANY}/{YY}{MM}/{seq}` seeded per PT). Additive; `down()` drops the new objects (pre-production).

### Added (DRMS 10/10 Phase D — loans)

- API `/api/v1/project-loans`: list (D8 pages, search, filters project/role/status/overdue), `inbox`, `options`, detail,
  create / edit Draft / submit / cancel / approve / reject, `repayments` add and `repayments/:rid/void`; OpenAPI updated.
- Web: Keuangan → Pinjaman (list, form, detail with the fixed decision bar for the Direktur, repayment dialog, void),
  project tab "Pinjaman" (diterima / diberikan / terlambat), section in Persetujuan, dashboard card (Direktur, Finance,
  PM), report "Pinjaman antar project" (per-loan + per-project summary, CSV / Excel / PDF).
- Daily reminder for overdue loans to the borrower PM + Direktur (per-PT switch "Pinjaman antar project terlambat").
- APK: project tab "Pinjaman", loan form (create / edit Draft, submit), detail, Direktur decision from the inbox (online
  only; repayments stay on the web in v1).

**DRMS 10/10 Phase D — multiple sites (kantor cabang) per PT** (ADR 0023, owner decisions 2026-10-11 Q-S1…Q-S7; server
+ web + APK). A site is a branch office of the PT (same legal entity, numbering, approvals and access per PT); one site
handles several projects, a project belongs to at most one site. A PT without sites behaves exactly as before.

**Database migrations:** `20261013_200000_d1010_sites` (schema: table `sites`; nullable `employees.home_site_id`,
`projects.site_id`, `cash_accounts.site_id`, `team_assignments.site_id`, `attendances.site_id`) and
`20261013_200100_d1010_sites_guard` (company NOT NULL + immutable, code unique per PT, no delete, operational default cost
center, same-PT triggers for every site reference, team assignment = exactly one of project / cost center / site,
attendance location = project | cost center | site with the site filled by the DB, one check-in/out per site and day).
No data is moved. **APK drift schema 9** (nullable `site_id` on the outbox).

### Added (ADR 0023)

- **Master "Site (kantor cabang)"** under Master Data (kode, nama, alamat, titik + radius absen, jadwal kerja default,
  pusat biaya default, aktif); every member of the PT reads it, Admin / Direktur maintain it. **"Buat site dari pusat
  biaya"** on the cost-center form pre-fills a new site from that cost center.
- **Optional site links:** "Site penempatan" on employees, "Site" on projects, cash accounts (petty cash of a branch) and
  team assignments (third option next to project / cost center); Site column + filter in those lists and on attendances.
- **Attendance at a site** (web Absen, APK, PM "diabsenkan"): allowed at the employee's home site or with an active site
  assignment; on-behalf for a PM assigned (role PM) to the site or the PM of a project of the site. Geofence of the site
  (empty radius = PT default). Schedule resolution employee → home site → PT default. Old APKs keep working.
- **Site filter** (only narrows the scope) on Rekap Kas, Buku Kas, Pengeluaran per kategori, Anggaran project, Rekap
  pengajuan, Kelengkapan, Laporan absensi, the attendance views (Tim hari ini, Rekap bulanan), the Kas book and the
  Direktur / Finance / PM dashboards; **saldo kas per site** on the Direktur and Finance dashboards, **ringkasan per site**
  (project berjalan, hadir hari ini, pencairan bulan ini) on the Direktur dashboard.
- **Transfer default cost center:** a project without its own default proposes the default cost center of its site.
- **Import workbook:** sheet **Site** + optional `kode_site` on Karyawan, Project, Penugasan and AkunKas.
- **API:** `GET /api/v1/sites` (caller flags `home` / `assigned` / `team`), masters type `sites` (+ `site` on projects /
  team assignments, `homeSite` on employees), `site_id` on attendance check-in/out (web + sync, exactly one location),
  `site_id` on team-today, `site` on `GET /projects(/{id})` and `?site=` on the list, `homeSite` on `/me` employees,
  `?site=` on dashboards and `/cash-accounts/balances` (`siteId` per account), report parameter `site`.
- **APK:** sites in the attendance location picker (home site first) and in "Diabsenkan PM", masters cache per PT, site on
  the project detail and "Site penempatan" on the profile.

**DRMS 10/10 Phase E — configurable approval rules + Direktur no-approval** (owner decision 2026-10-11, ADR 0024;
supersedes parts of ADR 0021). **Database migrations:** `20261013_300000_d1010_approval_config` (schema:
`approval_rules_requester_roles`), `20261013_300000_d1010_approval_config_guard` (zero-step rule guard, `g1_exception`
`direktur_no_approval` check, "Disetujui" needs a decision row unless that exception), `20261013_300000_d1010_approval_config_data`
(rule "Pengajuan Direktur" per PT that still has the default rules).

### Added (Phase E)

- **Aturan approval → "Peran pemohon"** (Direktur / PM / Staff / Finance / Admin; empty = any) used in rule selection with
  the priority; rules **without approval level** ("Tanpa persetujuan — langsung ke antrian transfer Finance") allowed
  only for Peran pemohon = Direktur (form + database); explanation and live preview in the rule form.
- **A Direktur's own request goes straight to the Finance transfer queue** without approval: status "Tanpa persetujuan
  (Antri Transfer)" / "(Verifikasi Nota)", timeline step "Persetujuan — Tanpa persetujuan — pengajuan Direktur (kebijakan
  PT)" (web + APK), transfer queue badge, PDF note, Rekap Pengajuan column "Persetujuan", audit
  `approval_policy_exception`; the LPJ shortfall and the receipt re-approval of such a request need no approval either.
- API (additive): `approvalRule.selfApproval` `direktur_no_approval`, transfer queue `noApproval`, `/me`
  `companies[].ownRequestNoApproval`, masters employees `direktur`, shortfall `noApproval`.
- APK: info "Pengajuan Anda langsung ke antrian transfer Finance" for a Direktur, no Direktur offered as requester to
  others, timeline / status / queue badge identical to the web.

### Changed (Phase E)

- The PM no longer files a request on a Direktur's behalf (ADR 0021 `direktur_via_pm` withdrawn for new requests: 403 at
  the draft; Admin/Finance for a Direktur → 409 at submit). Requests already submitted under it keep working.

**DRMS 10/10 D4 amendment — RAP for every project with a RAB** (owner decision 2026-10-11: "RAP wajib untuk semua
proyek yang punya RAB"; "Melebihi RAP" stays a warning). ADR 0020 amendment, plan `drms-1010.md` ("D4 amendment").

**Database migrations:** `20261013_400000_d1010_rap_all` (schema: `rap_items.stage_id` nullable,
`rap_templates.project_kind`, template item `stage_name` optional) and `20261013_400100_d1010_rap_all_guard` (a RAP
item without stage only outside konstruksi; existing templates → kind konstruksi; logs every project with a RAB but no
RAP — no RAP is created automatically, submitted requests stay valid).

### Changed (D4 amendment)

- **Submit rule:** a project of ANY kind with a RAB (and every konstruksi project, as before) needs ≥ 1 active RAP item
  before an expense request can be submitted → 400 `projectId` **"Project belum punya RAP — hubungi PM"** (same text on
  the web form, the APK draft editor / line editor / project RAP tab). Drafts can still be saved; every line of a project
  with a RAP picks a RAP item. A project without RAB and without RAP stays unconstrained (the APK no longer asks for a RAP
  item there).
- **RAP for every project kind:** the project's **RAP tab** now also manages the RAP (Excel import / export, "Pakai
  template", "Simpan sebagai template") for the PM and the Direktur/Admin — no longer only under Laporan harian
  (konstruksi). Outside konstruksi the stage ("tahapan") is optional (an existing stage only, never created by an import)
  and the RAP never drives the stage progress (manual progress reports unchanged); daily reports stay konstruksi-only.
- **RAP templates per project kind** (`Jenis project` on the template; saved from a project = its kind; a template of
  another kind → 400 `templateId`; outside konstruksi an unknown template stage is dropped).
- The project kind is frozen once the project has RAP items (409 "sudah punya RAP" instead of a DB error).

### Added (D4 amendment)

- **Dashboard nudge:** "Project Anda belum punya RAP" (PM, team projects) and "Project ber-RAB belum punya RAP"
  (Direktur, every project of the selected PTs) with a link to the project's RAP tab.
- **API (APK):** `GET /projects` / `GET /projects/{id}` `rapRequired`, `rapMissing`; `GET /projects/{id}/rap`
  `rapRequired`, `drivesProgress`, item `stage` nullable; `POST /projects/{id}/rap/items` `stageId` optional outside
  konstruksi.
- **Go-live import:** a warning per imported project with a RAB but no RAP; `rab` column hint mentions the RAP rule.

## [0.8.0] - 2026-10-12

**Approval PM → Direktur (ADR 0021), RAP + Laporan harian (P3), DRMS 10/10 Phases A–C** (owner feedback 2026-10-10 /
2026-10-11; web ↔ APK consistency). APK **mobile-v0.5.0** (pubspec `0.5.0+1`, notes `docs/release-notes/apk/0.5.0.md`;
includes the never-tagged 0.4.1; drift schema **v8**). **Staging first** — production only after the owner approves
the UAT.

**Database migrations** (run by `migrate`, in this order; details in the sections below):
`20261010_130000_approval_pm_direktur`, `20261011_100000_p3_rap`, `20261011_110000_p3_security`,
`20261012_100000_d1010_project_pm` (conditional NOT NULL), `20261012_200000_d1010_schema`, `20261012_200100_d1010_data`
(sequences on the default pattern → `<DOC>/{COMPANY}/{YY}{MM}/{seq}`), `20261012_300000_d1010_lines_lpj_photos`,
`20261012_300100_d1010_lines_guard`, `20261012_300200_d1010_pb_monthly` (PB monthly), `20261012_400000_d1010_rap_cost_center`,
`20261012_400100_d1010_rap_guard`. Each has a `down()`; still **take the pre-deploy dump** (data migrations renumber
sequences and normalise editable lines). Older migrations only gained `IF EXISTS` in `down()`.

**Deploy checklist:** the **worker must run** (selfie stamps); after `migrate` the Admin sets the approval rules of every
PT (see "Approval pengajuan biaya" below); fill PMs via "Project tanpa PM"; **every project with a RAB needs a RAP**
before its requests can be sent (D4) — create the RAP of active konstruksi projects first; set "Pusat biaya (default
transfer)" per project (Finance picks the cost center at transfer, D2).

**CI:** integration job timeout 40 → 70 min (the suite outgrew 40 min on the self-hosted runner).

**DRMS 10/10 Phase C — server + web** (owner decisions D2 / D4, points 2–4, 7, 10; web ↔ APK consistency). API contract
for the APK in `docs/proyekkas/plans/drms-1010.md` ("Phase C API contract").

**Database migrations:** `20261012_400000_d1010_rap_cost_center` (schema: `expense_requests_lines.rap_item_id`,
`transfers.cost_center_id`, `projects.cost_center_id`, flag kind `rap_over_budget`) and `20261012_400100_d1010_rap_guard`
(content hash incl. the line RAP item — existing hashes unchanged; line RAP item of the request's project; no cost center
on new requests, project required to send (legacy rows keep working); transfers need a cost center of their PT; manual
cash entries stay "project OR cost center").

### Added (DRMS 10/10 Phase C)

- **D4 RAP realisation:** every request line names an **Item RAP** of the request's project (line dialog picker, "RAP …"
  under the line / on the card). Required to send when the project has a RAP; a konstruksi project without RAP cannot send
  requests. Plan (volume × harga satuan) vs realisation (approved line totals), plus transferred and verified amounts,
  remaining and % per item and per project. Over plan → warning flag **"Melebihi RAP"** for PM / Direktur / Finance (not
  blocking; never shown to Staff).
- **Project detail tabs** Proyek / **RAP** / **Pengajuan** (`/admin/collections/projects/:id`, `/rap`, `/pengajuan`) with
  search, filters and pages; RAP items as cards at phone width.
- **Direktur dashboard: "Monitoring RAP"** — projects with RAP, % realisation, items over plan, link to the RAP tab.
- **API (APK):** `GET /api/v1/projects`, `GET /api/v1/projects/{id}`, `GET /api/v1/cost-centers`; `GET /expense-requests`
  filters `project`, `q`, numbered `page`; `GET /transfer-queue` with project, suggested cost center, bank, flags, SLA.

### Changed (DRMS 10/10 Phase C)

- **D2 no non-project requests:** the project is required to send a request; the requester no longer picks a cost center
  (a `costCenterId` from old apps is ignored). **Finance chooses the cost center when recording the transfer** (required;
  pre-selected from the project's new "Pusat biaya (default transfer)"); the KK carries project + cost center, so the
  dashboard "Pusat biaya bulan ini" and the report filter `pusat` follow Finance's choice. Approval routing: project PM.
- **Request detail sidebar** no longer repeats the header (Nomor, Status, Dibuat oleh, Grand total, dates); "Aturan
  approval" for Finance / Admin only; "Alasan perubahan" only in Revisi Nota (a Draft at phone width ends with the lines).
- **Verifikasi LPJ** receipts as cards at ≤ 640 px; the image lightbox skips the hidden duplicate of a thumbnail.

### Added (APK, DRMS 10/10 Phase C)

- APK (DRMS 10/10 Phase C): **"Proyek"** menu with tabs Proyek / RAP / Pengajuan, search, status filter and infinite
  scroll (point 6/7, D8). Expense lines need an **"Item RAP"** with remaining budget and a **"Melebihi RAP"** warning (D4,
  drift v8 `local_lines.rap_item_id`; roles without RAP prices see the items without amounts). Requests are project-only;
  the requester no longer picks a cost center (D2). New **"Finance"** menu (point 10): Antrian Transfer with SLA badge and
  "Selisih nota (n)", **"Catat transfer"** with Akun kas (active accounts only) / Tanggal & jam transfer / Pusat biaya /
  No. referensi bank / Bukti and the overdraft / unverified-account confirmation, and a read-only Verifikasi LPJ list.

### Fixed (DRMS 10/10 Phase C integration)

- `GET /api/v1/cash-accounts/balances` items carry `active`; the APK transfer form no longer offers an inactive cash
  account (or cost center), which the server refused with 400 `cashAccountId`.
- Request detail **"Rincian item"** table (reviewers): at 1280 px the "Nota & flag" column was clipped inside a horizontal
  scroll — fixed column widths with wrapping text, every column readable without scrolling; cards at < 640 px unchanged.
- APK contract tests on responses captured from the Phase C server (projects, RAP with `realisedAmount`, Staff without
  RAP money, `rapOverBudget` / `rap_over_budget`, transfer queue, transfer form pickers, `POST …/transfer`).

**DRMS 10/10 Phase B-2 integration + polish** (web ↔ APK consistency; owner prefers the APK layout). No new migration;
`migrate:create` → no changes; generated files (importMap, payload-types, OpenAPI, Flutter codegen) unchanged.

### Fixed (DRMS 10/10 B-2 integration)

- A request locked before D3 and later sent back to an editable status (Finance rejects a receipt → **Revisi Nota**, or
  withdraw → Draft) was refused by the new DB rule total = qty × unit price, blocking the requester. On unlock a line whose
  unit price does not reproduce its total now gets `total ÷ qty` when exact, otherwise no unit price (keeps its total); the
  DB rule still applies to every line with a unit price. Such a line shows **"Lengkapi Qty & Harga satuan"** (web table,
  card and dialog; APK detail) and **Kirim pengajuan / Kirim ulang nota** stay disabled until it is completed (the server
  also refuses `receipts-resubmit` with the line numbers).
- Full migration rollback on a fresh DB works again: the generated `down()` of `20261011_100000_p3_rap` (and 8 older
  migrations) dropped `payload_locked_documents_rels` FKs already removed by `DROP TABLE … CASCADE` → `IF EXISTS`.
  (Use `payload migrate:down`; Payload 3.90 `migrate:reset` runs the downs in ascending order.)

### Changed (DRMS 10/10 B-2 integration)

- **Web lines at ≤ 640 px** (Draft / Revisi Nota editor and the read-only lines of the detail): one card per line like the
  APK — "1. Uraian" + total, "Qty Satuan × Harga satuan · Kategori", "Nominal sesuai nota" + "Selisih nota" chip, receipts
  and flags, Ubah / Hapus. Desktop keeps the table.
- **One wording:** the lines section is **"Rincian item"** on the web form, web detail, APK draft editor and APK detail;
  the approval step is **"Persetujuan PM"** on both.
- **APK timeline** for the current approval snapshot (ADR 0021) reads like the web: Diajukan → Persetujuan PM →
  Persetujuan Direktur → **Transfer Finance**; older snapshots keep their wording. Preview fixtures use the current snapshot.
- **APK approval inbox:** badge **"Selisih nota (n)"** (`flags.receiptMismatch`), as in the web Antrian Transfer.
- **Antrian Transfer / LPJ money form:** admin field look (labels with required marks, date-time picker with the
  DateInput helper text, help texts, primary button) instead of unstyled native controls.

**DRMS 10/10 Phase B-2 — web + server** (owner decisions D1 / D3, points 8f–8h, 13, read-only request header; PB numbering
monthly). API contract for the APK in `docs/proyekkas/plans/drms-1010.md` ("Phase B-2 contract").

**Database migrations:** `20261012_300000_d1010_lines_lpj_photos` (schema: `expense_requests_lines.receipt_amount`, flag kind
`receipt_amount_mismatch`, `settlements_rels` for LPJ photos, `settlements.photos_hash`), `20261012_300100_d1010_lines_guard`
(DB guards + data: total = qty × unit price on editable requests, receipt amount in the frozen content hash — existing hashes
unchanged —, LPJ photo set frozen at submit; editable lines without a reproducible unit price get `total ÷ qty` or stay
"legacy" — count in the migrate log), `20261012_300200_d1010_pb_monthly` (PB sequences on the default pattern → monthly from
1; the current month continues after its highest issued PB, audited, Admin-customised patterns untouched and logged).
Rollback: each `down()` (guard bodies restored, PB sequences moved by this migration back to never / 229).

### Changed (DRMS 10/10 B-2)

- **D1:** request type `advance` is shown as **"Pengajuan Baru"** (was "Uang Muka") everywhere — forms, lists, filters,
  Antrian Transfer, dashboard, reports and exports, PDF, notifications / reminders, approval rules, user guides; the
  internal value `advance` and "Reimburse" are unchanged.
- **D3 (8f–8h):** the line total is **qty × harga satuan**, computed by the server on every write (a client total is
  ignored; qty empty = 1) and enforced by the DB on editable requests; approval / transfer use it. New per-line
  **"Nominal sesuai nota"**: when it differs from the total, Finance sees the flag **"Selisih nota"** (info within the
  rounding tolerance, otherwise a warning to mark "sudah diperiksa") on the request detail lines table, the Antrian Transfer
  (badge) and Verifikasi LPJ. Old clients that send only `total` get `unit price = total ÷ qty` when exact.
- **Web request form:** lines as a table (No, Uraian, Kategori, Qty, Satuan, Harga satuan, Total, Nominal sesuai nota,
  Ubah / Hapus) with a "Tambah baris" dialog (live read-only total + grand total preview, Rupiah inputs); stacked cards at
  390 px. "Harga satuan" drops "(informatif)".
- **Submitted request (read-only):** the header shows a compact "Rincian pengajuan" summary (label: value — PT, project,
  urgensi, tanggal, pemohon, rekening with masked number + eye toggle, keterangan, lampiran) instead of disabled inputs,
  empty "Pilih …" placeholders and a stuck "memuat…" account preview.
- **Point 13:** LPJ photos (max 10, images, same resize / privacy pipeline as receipts): the requester adds / removes them
  while the LPJ is Draft / Revisi (`PUT /api/v1/expense-requests/{id}/lpj/photos`, or `photos` with Kirim LPJ); read-only
  afterwards; shown with the lightbox on the request, the LPJ document and Verifikasi LPJ.
- **PB numbering** (owner 2026-10-11): `PB/<kode PT>/<YYMM>/0001` resets **monthly from 1 per PT** (was one running series
  from 229). The import's `nomor_pb_mulai` now only sets the first number of the go-live month (default 1). No PT code is
  built in: `{COMPANY}` is always the PT's short code (an empty one blocks numbering).

**DRMS 10/10 Phase B-2 — APK** (`docs/proyekkas/plans/drms-1010.md` D1, D3, point 13). **Drift schema v7** (APK local DB):
`local_lines.receipt_amount` (nullable, additive) — existing offline drafts and queued items are kept.

### Changed (APK, DRMS 10/10 B-2)

- **D1:** request type `advance` is shown as **"Pengajuan Baru"** (was "Uang Muka"): type switch, home tile, transfer kind,
  dashboard KPI texts; "Reimburse" unchanged. The server's `typeLabel` still wins when sent.
- **D3 line editor:** Qty, Satuan and Harga satuan are required (Rupiah input); **Total = Qty × Harga satuan** is shown live
  and is read-only (rounded half up to whole rupiah, same rule as the server). New optional **"Nominal sesuai nota"** with
  the hint that approval and transfer use the Total; a **"Selisih nota"** chip when it differs. Labels follow the web lines
  table (Uraian, Kategori, Qty, Satuan, Harga satuan, Total, Nominal sesuai nota); the lines list shows
  "Qty Satuan × Harga satuan · Kategori · n nota" and the computed total.
- Request detail: "Nominal sesuai nota" per line and the "Selisih nota" chip (server `receiptMismatch`, a
  `receipt_amount_mismatch` flag, or receiptAmount ≠ total), plus one chip in the header when any line differs.
- Offline drafts: `receipt_amount` in `draft_upsert` lines and `receiptAmount` in the create body; `total` sent as
  qty × unit price. A draft line saved before D3 (typed total, no unit price) still opens, keeps its old total, and asks
  "Lengkapi Qty & Harga satuan" before it can be submitted.

### Added (APK, DRMS 10/10 B-2)

- **LPJ photos (point 13):** "Kirim LPJ" / "Kirim ulang LPJ" opens a screen with the usage notes and up to **10 photos**
  (camera or gallery), compressed on the phone like receipts, uploaded via `POST /media/receipts` and sent as `photos`
  (the whole set) with `lpj/submit`. The LPJ section of the detail shows the photos read-only; a tap opens the shared
  photo viewer.

**DRMS 10/10 integration + Lead screenshot review** (branches a-apk, a-web-shell, a-web-form, b-server merged). No new
migration; the latest schema snapshot now matches the final schema (`migrate:create` → no changes).

### Changed (DRMS 10/10 integration)

- **One status wording** (`domain/expense/types.ts`): "Menunggu persetujuan PM" / "Menunggu persetujuan Direktur" (ADR 0021)
  in the sidebar, list column, filter options, chips, dashboard pipeline, PDF, notifications and the APK fallback labels;
  requests submitted under an older approval snapshot keep "Menunggu Diketahui (Direktur)" / "Menunggu Approval".
- **User names everywhere**: read-only user fields and list columns ("Dibuat oleh", "Dicatat oleh", "Pelapor",
  "Diverifikasi oleh" …, 30 fields) show the person's name (users.name → employee in the document's PT → email local
  part) instead of "Tanpa Judul - ID: 1".
- Expense request detail: no "Level approval berjalan", "Sumber" or "Alasan perubahan" after submit; "Simpan" only while
  the request is editable (new / Draft / Revisi Nota); the decision bar no longer covers the end of the page (1280 / 390 px).
- Reports: every document number is a link (SLA Transfer: request + TRF; Buku kas: KK + request; Rekap pengajuan,
  Kelengkapan, Audit log, aftersales PO/penawaran). Exports unchanged.
- Module landing pages: a specific icon per sub-menu (Iconsax Bulk) instead of one generic glyph.
- Date fields: a helper text under every native date / date-time input ("Selasa, 20 Oktober 2026") — the browser shows its
  own locale format in the picker.

### Fixed (DRMS 10/10 integration)

- React hydration error on the request detail (Finance, transferred request): the "Void transfer" reason dialog rendered a
  `<form>` inside Payload's document form.
- Schema drift: `expense_requests.status` showed as nullable to the Postgres adapter (admin condition on a required field).

**DRMS 10/10 Phase A — web shell, project form, tables** (owner feedback batch 2026-10-11,
`docs/proyekkas/plans/drms-1010.md` items 1, 5, D8, D9).

**Database migration:** `20261012_100000_d1010_project_pm` (conditional): when NO project lacks a PM →
`projects.pm_id` NOT NULL and its FK `ON DELETE RESTRICT` (was SET NULL); otherwise nothing changes and the migration
logs the number of projects without a PM (the deploy never fails; fill them via the dashboard tile "Project tanpa PM",
a later migration can tighten the column). Rollback: `down()` drops NOT NULL and restores SET NULL.

### Added (DRMS 10/10)

- **Module landing pages (D9)**: a module with two or more visible sub-menus opens `/admin/modul/<id>` — tiles in the
  launcher style grouped by menu section (permissions, hidden entities, role rules and PT features exactly as the top
  bar) instead of jumping into the first sub-menu (Master Data no longer opens "Bank"). Custom views show the
  breadcrumb "module › menu item" back to the landing page.
- **Search, filters and pagination on the work tables (D8)**: shared toolbar (search with debounce, filters, page size
  20/50/100, pager; the URL holds the state) on Persetujuan, Antrian Transfer (+ transfer tercatat), Verifikasi LPJ
  (paged in the DB, was capped at 100), Buku kas (search + page size), Absensi tim hari ini (name search), Laporan
  harian / servis / aktivitas aftersales, Progress project, Unit & kontrak, Notifikasi, Addendum RAB, Laporan progress.
  `GET /api/v1/service-reports`, `/aftersales-activities`, `/daily-reports` accept `q` (text search). Every Payload
  list without its own `listSearchableFields` now searches its stored text fields (code, name, number, …).
- `GET /api/v1/me` → `displayName` (additive): the label to greet the caller with.
- Project form: sidebar link "Buka halaman project" (tahapan/progress); the project page links back ("Data project").

### Changed (DRMS 10/10)

- **Greeting by name, never email (WA-14)**: launcher, avatar menu and dashboard use users.name → employee name of the
  membership in a selected PT → email local part → "Pengguna".
- **Project Manager mandatory**: "Project Manager wajib diisi" on create and whenever a write sends `pm` (admin form,
  REST, Local API); updates that do not touch `pm` stay valid for legacy rows. The import (`runImport`) reports a
  missing or Keycloak-pending project PM as an error.
- Payload edit forms: the "Edit"/"API" document tabs are gone (API tab disabled via `hideAPIURL`, a lone tab row is
  hidden) — one primary action "Simpan"; uniform field spacing (20 px, 16 px on phones) for every collection form.
**DRMS 10/10 Phase A — web expense request screens** (owner feedback 2026-10-11, `docs/proyekkas/plans/drms-1010.md`
items 8c–8e, 8i, 9a–9d, 12b, 12c; findings WA-01…WA-12, WA-15). No migration.

### Changed (DRMS 10/10 Phase A, web)

- **Expense request form** (create / draft): only the inputs, in the APK draft-editor order (Jenis, Judul, Project,
  Pusat biaya, Tanggal dibutuhkan, Tingkat urgensi, Pemohon, Rekening tujuan, Keterangan, Lampiran, baris item +
  "Total (pratinjau)"); level approval, aturan/snapshot approval, pengecualian G1, nomor/status, diajukan, alasan,
  sumber and the money totals appear only after submit. Short panel help on create. Labels as in the APK ("Pemohon",
  "Judul", "Lampiran", "Dibuat oleh").
- **Date picker** for every business date (`YYYY-MM-DD` text columns, no migration): Tanggal dibutuhkan, Tanggal nota,
  Tanggal transfer/laporan, Mulai/Selesai kontrak unit, Tanggal saldo awal, Hari libur; read-only dates as
  "12 Oktober 2026". Line "Harga satuan" and "Total" use the shared Rupiah input (`Rp 1.250.000`, lib/rupiah-input);
  Jumlah keeps decimals.
- **Placeholders:** field-specific hints on the request selects ("Pilih project…", "Pilih tingkat urgensi…",
  "Pilih pemohon…", "Pilih rekening tujuan…", "Pilih satuan…", "Pilih kategori…", "Pilih kendaraan…", PT picker
  "Pilih PT…"); Payload's global "Pilih nilai" → "Pilih…".
- **Rekening tujuan:** the chosen account right under the picker (bank · atas nama · `••••1234`) with an eye button;
  after submit the same card shows the snapshot taken at submit (raw snapshot fields hidden). New
  `GET /api/v1/bank-account-preview?request=&account=&reveal=1` — the full number only for creator/requesters and
  Finance/Direktur/Admin of the PT (same rule as the detail DTO); foreign accounts / requests / PTs → 404.
- **Request detail:** one lines table "Rincian pengajuan" (also for the requester; the line cards only in Draft /
  Revisi Nota); PT on one line ("PT: DRMS — …", every document with a PT); readable vertical **Alur persetujuan**
  (Diajukan → Persetujuan PM project / Diketahui → Persetujuan Direktur / Approval → Transfer Finance: role, planned
  approver, Selesai / Giliran / Menunggu / Dilewati / Ditolak, actor, time, note; G1 exception as text) instead of the
  raw JSON (raw snapshot only for Admin, folded); **Setujui / Tolak / Diketahui bar** at the bottom of the detail
  when the server allows the decision (same endpoints, Idempotency-Key and confirmation texts as Persetujuan).
- **Clickable numbers:** LPJ (Verifikasi LPJ), transfer (Antrian Transfer, request detail incl. KK + proof), cash /
  request numbers in the dashboard, document numbers in the admin audit card and Riwayat.
- **Image lightbox** for every thumbnail (receipts, progress and field-report photos, transfer and cash proofs,
  selfie): modal, fit ↔ 100 %, previous/next in the group (keys, buttons, swipe), Esc, works at 390 px; PDFs and
  non-images keep "Buka di tab baru".
**DRMS 10/10 Phase B (server): numbering with the PT code (D5), transfer date-time + SLA (item 11), selfie timestamp +
camera-only web check-in (D7 / item 14).** Database migrations `20261012_200000_d1010_schema` (additive: `transfers.transfer_at`,
`expense_requests.approved_at`, `companies.transfer_sla_hours` default 24, `media_selfies.stamped_at` write-once, job slug
`stampSelfie`, request guard accepts `approved_at` only on the final approval) and `20261012_200100_d1010_data`
(document sequences still on the OLD default pattern move to `<DOC>/{COMPANY}/{YY}{MM}/{seq}`, audited; customised
patterns kept and logged; `approved_at` backfilled from the last decision of the current cycle). The **worker must run**
(selfie stamps are applied by the job queue).

### Added

- **D5 numbering:** every default document number carries the PT short code, 4 digits — `PB/DRMS/2610/0229`,
  `TRF/LLAS/2610/0001`, `LPJ/…`, `KM/…`, `KK/…`, `LP/…`, `ADD/…`, `SV/…`, `LH/…` (reset policies unchanged: PB never,
  continuing from 229; others monthly). Issued numbers stay; a mid-month switch continues the same counter. Allocation
  refuses a `{COMPANY}` pattern without a short code (409) before taking a number (ADR 0007 revision 2026-10-12).
- **Item 11 transfer date-time:** `POST /expense-requests/{id}/transfer` accepts `transferAt` (date + time of the bank
  proof; ISO with offset, or wall clock in the PT zone); not in the future; `transferDate` = its date in the PT zone
  (period lock). Old clients sending only `transferDate` still work (`transferAt` null = time unknown). The web form
  "Catat transfer" asks **Tanggal & jam transfer (sesuai bukti)** (required). Detail/API expose `transferAt` and
  `approvedAt`.
- **Item 11 SLA:** `expense_requests.approvedAt` set at the final approval; per-PT setting **SLA transfer (jam sejak
  disetujui)** (default 24); Antrian Transfer badge **Umur sejak disetujui** (red when over SLA); report
  **SLA Transfer** (`/admin/laporan/sla-transfer`, Finance/Direktur: per PT per month count, average, P90, % within SLA,
  late transfers with links; CSV/XLSX); KPI card **SLA transfer** on the Direktur and Finance dashboards.
- **D7 selfie timestamp:** after an attendance is recorded (APK sync, PM on-behalf, web self check-in) the worker job
  `stampSelfie` burns a band into the stored selfie — server-accepted date + time in the PT zone (WITA/WIB/WIT), GPS
  (5 decimals) + accuracy, project / cost center, employee, "RR Teams" — once (idempotent, `stamped_at`), same size,
  JPEG ≤ 150 KB (ADR 0010 addendum 2026-10-12).

### Changed

- **Web self check-in:** the selfie comes from the live front camera only (getUserMedia → canvas; no file input /
  gallery); without a camera or permission: "Kamera tidak tersedia — gunakan aplikasi Android".
  `Permissions-Policy` now allows `camera=(self)` and `geolocation=(self)` (geolocation was blocked by `()`).

**Approval pengajuan biaya: Staff → PM project → Direktur → Finance transfer** (owner decisions 2026-10-10, ADR 0021,
requirements v1.3 §9; supersedes the decision part of ADR 0013 for expense requests). **Staging first** — production
only after the owner approves the UAT (`docs/proyekkas/uat/approval-pm/README.md`).

**Database migration:** `20261010_130000_approval_pm_direktur` (additive): column `expense_requests.g1_exception`
(varchar, CHECK `NULL | 'direktur_via_pm' | 'direktur_via_pm_self'`), audit action `approval_policy_exception`, guard trigger
`expense_requests_g1_exception` (no value on insert; changes only at the submit freeze point), and
`pk_approvals_before_insert` replaced (G1 unchanged except the recorded exception). Rollback: `down()` restores the
previous trigger body and drops the guard/CHECK/column.

**After the deploy the Admin must change the approval rules of every PT** (Pengaturan → Aturan approval; nothing
changes until then): the default rule → "Default — PM project lalu Direktur (semua nominal)", Diketahui Oleh = Wajib,
Pengisi = PM project, Level 1 = Direktur (remove the Finance level), reason "Kebijakan owner 2026-10-10: Staff → PM →
Direktur → Finance transfer"; the inactive "> Rp 10 juta" example the same; the Addendum RAB rule unchanged. First
check that every active project has a PM and every cost center a manager. **Requests already submitted keep their
snapshot** and finish Direktur → Finance.

### Added

- **PM project approval step** (`acknowledgeBy: scope_manager`, expense requests only): the acknowledger is resolved at
  submit from `projects.pm` (cost-center requests: `cost-centers.manager`), an active member of the PT, and stored in
  the snapshot; only that PM may approve/reject ("Persetujuan PM"); other PMs → 403 + `access_denied`. Missing PM →
  409 "Project ini belum punya PM. Hubungi Admin untuk mengisi PM project." Rule option "PM project (manajer pusat
  biaya bila tanpa project)" in Aturan approval (refused for Addendum RAB and for an optional "Diketahui").
- **Narrow G1 exception `direktur_via_pm` / `direktur_via_pm_self`:** a Direktur's request filed by the request's PM
  (creator = PM, every requester holds Direktur in the PT) → PM approves, then a Direktur. "Utamakan Direktur lain"
  (owner 2026-10-11): with another active Direktur only that Direktur decides (`direktur_via_pm`; the requester → 403,
  refused by the DB); the requester approves himself only as the PT's only Direktur (`direktur_via_pm_self`). Server-set at
  submit, recorded in the snapshot (`selfApproval`), `expense_requests.g1_exception`, audit
  `approval_policy_exception`, web panel and PDF ("Pengajuan Direktur — diajukan oleh PM (kebijakan owner
  2026-10-10)"); the DB trigger allows exactly the creator PM's "Diketahui" and — only for `_self` — the requester's
  approval level.
- PM: web **Persetujuan** menu, `/me` `capabilities.approvalInbox`, dashboard card "Menunggu tindakan saya"; LPJ
  shortfall approvals (ADR 0019) where the PM is the acknowledger.
- API (additive, APK): inbox items `decisionBy` (`pm | direktur | finance | other`) and `finalStep`; request detail
  `approvalRule.selfApproval`; KPI `teamWaiting.waitingFor` `pm | direktur | finance`. OpenAPI regenerated.
- APK **mobile-v0.4.1** (0.4.0 is not published yet and ships with web 0.7.0): PM labels ("Setujui sebagai PM
  project" → "diteruskan ke Direktur"; Direktur final step → "diteruskan ke Finance untuk transfer"), approval inbox
  for PM. Older APKs already show the server-driven buttons to the PM, with Direktur wording.
- **Public home page `/`** (owner 2026-10-10: `/` answered 404 and nothing linked to the APK page): app name and two
  plain links, "Masuk" → `/admin/login` and "Unduh aplikasi Android" → `/unduh`, plus the privacy notice. No form and no
  server action (CrowdSec CRS 920420). Not indexed (robots meta + `X-Robots-Tag` on `/`).
- **Web login:** a "Unduh aplikasi RR Teams" link → `/unduh` next to "Pemberitahuan privasi".

### Changed

- Under a PM-project rule **Finance no longer approves**: after the Direktur the request is approved (Uang Muka →
  transfer queue; Reimburse → Finance receipt verification, then transfer). G1 unchanged: a PM who is requester/creator
  is skipped ("(tidak berlaku — pemohon)") and the Direktur decides; the Direktur step is never skipped silently (only
  Direktur is requester/creator → 409 "Pengajuan untuk Direktur dibuat oleh PM project. …").
- LPJ shortfall re-approval follows the rule in force (PM → Direktur); Addendum RAB stays Direktur → Finance.
- Labels per snapshot: "Menunggu persetujuan PM" / "Menunggu persetujuan Direktur", inbox "Persetujuan PM" /
  "Persetujuan Direktur"; generic `pending_ack` label "Menunggu Diketahui" (ADR 0013 snapshots keep "Menunggu Diketahui
  (Direktur)").
- Notifications: "Persetujuan PM: {docNo}" to the PM (approval email likewise); the Direktur is notified after the PM,
  Finance after the Direktur; `expense.team_submitted` is not sent to the PM who must approve.
- Seed: default rule "Default — PM project lalu Direktur (semua nominal)" for fresh installs.

### Fixed
- **Field reports (web): HM values with a thousands dot were misread** (UAT FR T-01). The forms show "1.023"
  (Indonesian thousands), but the parser read a single dot as a decimal point. As a result:
  - the timesheet form rejected its own prefilled HM awal;
  - "5.000" was saved as 5;
  - the correction dialog quietly re-sent an untouched HM "1.030" as 1.03.
  A single dot that groups exactly three digits now means thousands. Values that were valid before (at most two
  decimals) are read the same as before. The APK was not affected.
- **CI image job:** `trivy-image.sh` retries no longer leave a failed attempt's output or the retry warning in the scan
  JSON. That output made the report step's `jq` exit 5 and blocked the v0.7.0 tag images.

- **"Akun pengguna" on the employee form** (owner decision 2026-10-10, after APK attendance in a PT was refused with
  "Akun Anda belum terhubung ke data karyawan"): picks the login account of the employee in its PT. Not a new
  column — the link stays `company-memberships.employee` (one account ↔ one employee per PT; unique index and
  same-PT trigger unchanged). Saving sets / clears that membership in the same transaction through the membership
  collection (its access rule and audit `company_membership`, reason "Akun pengguna diatur dari data karyawan …"
  unless one is given). Picker: active accounts with active access to the employee's PT and no employee yet, plus
  the linked one. Field errors: no access in the PT ("tambahkan aksesnya di Akses PT dulu"), inactive access,
  account already linked to another employee (named), and **403** when the caller may not change the PT's
  memberships (only the PT Admin or a group admin may link; a Direktur still edits the other fields). Shown only to
  memberships readers (PT Admin, group admin, the linked person). Duplicates start without an account.
- **"Karyawan per PT"** panel on the user form (read-only): every PT access of the account the viewer may see, with
  the linked employee ("Buka") or "Belum tertaut" + "Buat karyawan", which opens the employee create form with that
  PT and account prefilled (`/admin/collections/employees/create?company=…&user=…`).
- No schema change, no migration. Go-live import, `/api/v1` masters/me (whitelisted employee fields) unchanged.
### Changed (APK — DRMS 10/10 Phase A, web/APK parity; ships with the next APK build, version not bumped)

- **Greeting by name (WA-14):** the home greeting / profile never shows the full e-mail address any more:
  `/me` `displayName` (optional, parsed when the server sends it) → user name → employee name → e-mail local part →
  "Pengguna".
- **Request detail (WA-08/09/12):** sections "Rincian pengajuan" (now with the **PT** as "kode — nama" and
  Keterangan), "Pemohon", "Rekening tujuan" (Bank / Atas nama / Nomor rekening, masked as the server sends it) and
  "Riwayat approval" (was "Posisi tanda tangan"). The request number is a chip that copies the number; the TRF card
  and the LPJ number copy theirs (there is no separate transfer / LPJ screen on the APK).
- **Fullscreen image viewer (12c / WA-11):** one shared viewer (zoom, double-tap, swipe within the group) for
  receipt thumbnails (request detail, across all lines; draft line receipts), progress photos, field-report and
  daily-report photos, and — new — the check-in / check-out **selfies** in the attendance day sheet
  (`GET /attendance/{id}/selfie`, server-side access + audit unchanged).
- **Bank account on a new request (8e / WA-04):** after choosing the account a card shows bank · holder · masked
  number; the eye toggle reveals the full number only when the masters delivered it to this user
  (`employee-bank-accounts` read access); a number that arrives masked keeps the toggle hidden.
- **Field components (8c/8d, WA-01/02/15):** Rupiah inputs group thousands while typing (`1.447.500`) on line unit
  price / total, receipt amount, addendum amount and the aftersales "Nilai" (Rp value of the offer / PO); the line quantity accepts digits and `,`/`.` only; the
  field-report date (service, timesheet, aftersales, daily report) is a date picker limited to the allowed dates;
  every select shows a field-specific placeholder ("Pilih project", "Pilih rekening tujuan", …) instead of "Pilih…"
  or an empty field.

### Added (konstruksi: RAP + Laporan harian — P3)

Owner decisions 2026-10-10. Migrations `20261011_100000_p3_rap` (new tables + enum value `daily_report`, additive)
and `20261011_110000_p3_security` (triggers, CHECKs, grants; default resource types + `LH` sequence per PT). Behind
the same per-PT flag `fieldReportsEnabled`.

APK **mobile-v0.5.0** (pubspec `0.5.0+1`, notes `docs/release-notes/apk/0.5.0.md`; needs this server): "Laporan
Harian" for konstruksi projects in Laporan Lapangan — offline draft + `daily_report.upsert`, RAP items (no prices)
and resource types cached from `GET /projects/{id}/rap` (`resourceTypes` added there), over-RAP warning with
required notes, drift schema **v6** (`field_rap_items`, `field_resource_types`; additive, every v5 row kept).

- **RAP per konstruksi project** (`rap-items`): item code (unique per project), uraian, tahapan, jenis
  **pekerjaan** (counts toward the stage %) or **material** (masuk / terpakai / stok only), satuan, volume, harga
  satuan (visible only to Direktur / Admin / Finance / PM of the project), optional bobot. Edited by the Direktur /
  Admin or the PM of the project; **locked once a daily report realised anything** — then only Direktur / Admin with
  a reason (409 `RAP_LOCKED`). Items are deactivated, never deleted.
  - **Excel import** (sheet RAP: kode, uraian, tahapan, jenis, satuan, volume, harga_satuan, bobot + Petunjuk, with
    dropdowns): preview → commit of the same file (sha256, 409 `FILE_CHANGED`), idempotent by code, items missing
    from the file deactivated, new stages (Direktur / Admin only) with weights proposed from the value share. Template
    download and "unduh RAP project". **RAP templates** per PT (`rap-templates`: save a project's RAP, apply to an
    empty project).
  - **Stage progress from the RAP**: a stage with active work items is RAP-driven (`project_stages.progress_mode =
    rap`): item % = min(realised / volume, 1); stage % weighted by value (volume × price) when every item is priced,
    otherwise equal; project % = Σ weight × stage % as before. Manual progress reports on such a stage → 409
    `STAGE_RAP_DRIVEN`.
- **Laporan harian** (`daily-reports`, numbering `LH/YYMM/####`): one per project, reporter and date (409
  `DAILY_EXISTS`); weather morning / noon / afternoon, rain and stop hours, manpower and equipment per **resource
  type** (`resource-types` per PT; defaults Mandor, tukang, kenek, operator, excavator, molen, vibrator, dump truck),
  volume per work item, material in / used per material item, issues, notes, ≤ 10 photos. Created by Staff assigned
  to the project, the team PM or the Direktur (Finance / Admin read only); reporter edits ≤ 24 h, then PM / Direktur
  corrections with a reason. Volumes are an **append-only ledger** (`daily-report-lines`, origin report / edit /
  correction) — the DB moves the RAP realisation from it and refuses every other change. Above the RAP volume:
  allowed with a note (400 `OVER_RAP_NOTE_REQUIRED`), flag `MELEBIHI_RAP`, in-app notification to the project PM; the
  same item booked by another reporter that day → flag `POSSIBLE_DUPLICATE`.
- **Weekly recap "Minggu ke-N"** (Mon–Sun from the project start): reports, worker-days, rain / stop hours per week,
  volume per work item per week and cumulative %.
- Web: *Proyek → Laporan lapangan → Laporan harian* (list, input, detail with volume history, edit / correction),
  *RAP & rekap* per project (stage %, items, material stock, weekly recap, Excel import); daily reports in the project
  timeline.
- API v1: `GET /projects/{id}/rap`, `GET /rap/template.xlsx`, `GET /projects/{id}/rap.xlsx`,
  `POST /projects/{id}/rap/items`, `PATCH /rap-items/{id}`, `POST /projects/{id}/rap/import/{preview,commit}`
  (multipart), `POST /projects/{id}/rap/{apply-template,save-template}`; `/daily-reports` (list, detail incl. ledger,
  create, edit, `/{id}/corrections`), `GET /projects/{id}/daily-recap`; `GET /me` capability `dailyReportCreate`;
  sync item `daily_report.upsert` (`server_daily_report`).

### Changed (Admin = Direktur parity, progress reports)

- `/me` capability `progressReportCreate` is now true for Admin and Admin may upload progress photos (Admin may create
  progress reports since the owner decision of 2026-10-09). Field reports stay read-only for Finance / Admin (owner
  decision 2026-10-10).

## [0.7.0] - 2026-10-10

**Field reports per project kind** (ADR 0020, requirements v1.3; DRMS first: service reports, unit timesheets with a
billing estimate, aftersales activity log; web admin views + APK **mobile-v0.4.0**), plus the owner decisions of
2026-10-09 (role Operator/Anggota, Admin = Direktur write rights on projects, PM creates projects, web self check-in,
LPJ for Staff, "Tingkat urgensi" replacing "Periode kegiatan"). Field reports stay **OFF per PT** until
`companies.fieldReportsEnabled` is switched on.

**Database migrations** (run by `migrate`, in this order): `20261010_080000_p2s_operator_role` (enum value
`pk-operator`; additive), `20261010_090000_p2s_urgency_level` (**drops `expense_requests.period_from/period_to` —
the values are not kept; take the pre-deploy dump; rollback = restore it**), `20261010_100000_fr1_foundation`,
`20261010_110000_fr1_field_reports`, `20261010_120000_fr1_security` (additive). The 0.6.4 web image does not run on
this schema (period columns gone) — rollback is the dump, not an image swap.

APK **mobile-v0.4.0** (pubspec `0.4.0+1`, notes `docs/release-notes/apk/0.4.0.md`; includes the never-tagged 0.3.6):
Laporan Lapangan (Servis Unit, Timesheet Unit, Aktivitas Aftersales; offline, drift schema **v5**), role
Operator/Anggota (home = Absensi only), own attendance for every role, "Tingkat urgensi" on drafts (drift **v4**).
Needs this server (masters `urgency-levels`, `clients`; field-report sync types). Older APKs keep working (sync still
accepts `period_from/period_to` and ignores them).

### Removed

- **"Periode kegiatan"** (periodFrom/periodTo) on expense requests and the receipt flag "di luar periode kegiatan"
  (historic flags stay readable). Older apps may still send `periodFrom/periodTo` (REST) or `period_from/period_to`
  (sync) — accepted and ignored.

### Added (urgency)

- **"Tingkat urgensi"** on expense requests: per-PT master *Master Data → Tingkat urgensi* (`urgency-levels`;
  code, name, rank 1 = lowest, active), configurable by Admin/Direktur/Finance; every PT starts with Low / Medium /
  High / Super (existing PTs by the migration, new PTs on creation). API: `urgencyLevelId` (REST draft),
  `urgency_level_id` (sync draft + server copy), `urgencyLevel {id, code, name, rank}` in the request detail,
  master type `urgency-levels` for the APK. Same-PT reference enforced by the DB trigger.

### Added

- **Field reports per project kind — P1 backend + admin web views** (ADR 0020, requirements v1.3 US-60…US-68; DRMS
  first, behind the per-PT flag **`companies.fieldReportsEnabled`, default OFF**). The service PDF and the APK screens
  follow (P2 APK).
  - **Project kind** `projects.kind` (`umum` default for every existing project, `konstruksi`, `kontrak_unit`,
    `aftersales`, `trading`): decides the available reports (kontrak_unit → timesheet + service report; aftersales →
    service report + aftersales log); set by the Direktur or the Admin of the PT, frozen once
    the project has field data; wrong kind → 409 `WRONG_PROJECT_KIND`.
  - **Unit & Kendaraan** (`vehicles` extended): heavy equipment with a unit code (unique per PT), plate optional for
    heavy equipment, serial no., owner own fleet / customer (+ client of the same PT), system fields status (from the
    latest service report) and last hour meter.
  - **Contract units** (`contract-units`): own unit in a kontrak_unit project for a period with rate per hour (+ monthly
    minimum) or per month; never active in two overlapping contracts (hook + DB trigger); rates readable only by
    Direktur / Finance / Admin.
  - **Service reports** (`service-reports`, numbering `SV/YYMM/####`), **unit timesheets** (`unit-timesheets`, one per
    unit and date, HM_GAP flag, HM photo) and **aftersales activity log** (`aftersales-activities`: quotation /
    incoming PO / delivery / invoicing / visit; deliveries move the PO status; values hidden from Staff/PM). Created by
    **Staff assigned to the project**, the PM of the team or the Direktur (manual progress reports stay PM/Direktur);
    reporter edits ≤ 24 h, then PM/Direktur corrections with a reason (audited); no delete; immutability, cross-PT and
    photo-limit guards in the DB. Side effects: unit status / last HM, in-app notification to the PM on "menunggu
    part", daily reminder for due quotation follow-ups (rule `aftersales_followup`).
  - API v1: `/service-reports`, `/unit-timesheets`, `/aftersales-activities` (list, detail, create, edit,
    `/{id}/corrections`), `GET /aftersales/open-pos`, `GET /units`, `GET /projects/{id}/contract-units`; reports
    `rekap-timesheet-kontrak` (hours, availability, **billing estimate — not an invoice**) and `rekap-aftersales`
    (registry: screen, CSV, XLSX, PDF); `GET /me` capabilities `serviceReportCreate`, `unitTimesheetCreate`,
    `aftersalesActivityCreate` + `settings.fieldReportsEnabled`; sync items `service_report.upsert`,
    `unit_timesheet.upsert`, `aftersales_activity.upsert` (`server_service_report` / `server_unit_timesheet` /
    `server_aftersales_activity`). Masters: `projects.kind`, unit fields on `vehicles`.
  - `GET /masters?types=clients` (customer picker of the APK aftersales log; Staff only when assigned to an aftersales
    project of the PT, else an empty list).
  - Shared UoMs M, M1, M2, M3, KG, TON, SAK, ZAK, BTG, LBR, TITIK, BH, SET, ROLL, KALENG, BKS, OH, JAM, LTR, HM (only codes
    that do not exist yet).
  - Admin: collections under Proyek › "Laporan lapangan" (list views, now "Data …"); Staff may upload photos to
    `media-progress-photos` only in a PT with field reports on.
  - **Admin web views** (Proyek › "Laporan lapangan", shown only when a selected PT has the flag on and the role may
    use them; otherwise the uniform no-access page with a "belum diaktifkan" hint):
    - **Unit & kontrak** (`/admin/unit-kontrak`): contracts (kontrak_unit projects) with today's fill status and the
      heavy-equipment units; contract detail with tabs **Timesheet** (matrix unit × day per month: work hours,
      red = not filled, orange = breakdown, ⚠ = HM gap; a cell opens the timesheet or the prefilled input form),
      **Rekap** (office/PM: HM start → end, work/standby/breakdown, availability, days not filled and — Direktur /
      Finance / Admin only — rate and **billing estimate, labelled "Estimasi — bukan invoice"**; Excel/PDF/CSV via the
      `rekap-timesheet-kontrak` report), **Unit** (contract units; add/edit for Direktur/Admin) and **Timeline**;
      unit detail (identity, owner, status, last HM, service + timesheet history); timesheet detail and **web input**
      (units active in the contract on the date, HM start prefilled from the previous HM end via the API with a live
      HM-gap hint, Σ hours ≤ 24 live check, breakdown reason, "Salin dari kemarin", required HM photo).
    - **Laporan servis** (`/admin/laporan-servis`): list (project, unit, mechanic, unit status, dates), detail (spare
      parts, photos, history incl. corrections) and web input (APK field set, ≤ 10 photos).
    - **Aftersales** (`/admin/aftersales`): weekly recap (PO in / delivered / open POs / PO value for the rate roles,
      per customer, "Perlu ditindaklanjuti" = open POs with age + due quotation follow-ups, the week's activities,
      exports via `rekap-aftersales`), activity list with filters, detail (deliveries of a PO, "Catat pengiriman") and
      quick input (customer, kind chips, open-PO picker, items, optional value, follow-up, receiver, ≤ 5 photos).
    - Corrections: PM of the team / Direktur with a required reason (`…/corrections`); the reporter's own edit within
      24 h. Photos on the web go through `POST /api/v1/media/progress-photos` (non-JPEG converted in the browser).
    - **Project timeline**: tab "Timeline" in the project detail (`/admin/progress/project/{id}?tab=timeline`) and the
      contract detail — every field report of the project per date (service reports, timesheet day summaries "2 dari 3
      unit diisi", activities; hook for the P3 daily reports) with type chips and "Buka" buttons.
    - Staff and PM never see rates, estimates or aftersales values (no empty "Rp" columns); a reporter sees the value
      they entered only on that activity's detail. Notifications and report rows link to these views.
  - Migrations (run as `<prefix>_owner`): `20261010_100000_fr1_foundation` (kind, unit fields, contract units, flag,
    numbering enum value, UoMs), `20261010_110000_fr1_field_reports` (three tables, SV sequence for every PT),
    `20261010_120000_fr1_security` (triggers: window/override, no delete, identity, cross-PT, project kind, contract
    overlap, photo limits, media owner PT, reminder rule). Additive; existing rows keep their behaviour.
  - Docs: ADR 0020, requirements v1.3 (open client questions Q-FR-1…6), traceability rows US-60…US-68.

- **Role "Operator/Anggota" (`pk-operator`)**, attendance only (web + APK): own check-in/out and own recap, own
  profile; no access to projects, requests, masters or reports. Assigned per PT in "Pengguna & akses PT" like any role.
- **Web self check-in/out for every role**: *Absensi → Absen* (`/admin/absensi/absen`) — pick an assigned location,
  take a selfie, the browser sends GPS. API `POST /api/v1/attendance/check-in` and `/check-out`; same server rules
  as the APK (team assignment, geofence radius, `syncAttendanceEnabled`, privacy acknowledgement ADR 0018; codes
  FEATURE_DISABLED, NOT_ASSIGNED, OUTSIDE_GEOFENCE, ALREADY_CHECKED_IN, …). Every role may now upload a selfie.

### Changed

- Report cells of type `int` show up to 2 decimals when the value is not whole (hours / HM; CSV text `1.234,5`, XLSX
  `#,##0.00`); whole numbers unchanged.

- **Admin has the same write rights as Direktur** on projects, project stages and progress reports (reverses
  QA-20(b)/(d) of 2026-10-08).
- **PM may create projects** and stages; PM edits stay limited to the PM's team projects. Finance/Staff remain
  read-only (403 naming the fields).
- Web *Absensi → Absen* is an APK-style field screen: one card per assigned location with today's state, large tap
  targets, one wide "Absen Masuk / Absen Pulang" button.
- **LPJ visible for Staff** in the web panel (`settlements` added to the Staff menu; read access was already there).

## [0.6.4] - 2026-10-09

App renamed to **RR Teams** (web + Android, display name only) and the admin CMS follow-up (PR #32): the remaining
text links in the custom views become buttons. No database migration. APK **mobile-v0.3.5** (pubspec `0.3.5+1`, notes
`docs/release-notes/apk/0.3.5.md`) — rename only; it works with server ≥ 0.6.2.

### Changed

- **App renamed to "RR Teams"** (owner 2026-10-09; display name only). Web: admin bar, login logo, browser title
  suffix " — RR Teams", /unduh page and APK download name `RR-Teams-<v>.apk`, e-mail subjects/texts, PDF metadata,
  API title, error messages, import template/report. The "DRMS" sub-label next to the name is dropped. Android
  (**APK 0.3.5**, notes `docs/release-notes/apk/0.3.5.md`): launcher label "RR Teams" / "RR Teams STG", app title,
  login title, messages. Employee privacy notice: name changed editorially, **stays version 1** (no re-acknowledgement).
  Unchanged on purpose: Android `applicationId`, package/class names, database, domains, `/unduh/proyekkas.apk` URL
  (installed apps keep updating). Keycloak login page title (realm display name) is infra-managed — separate request.
- Admin custom views: the remaining text links become buttons — card header actions ("Jadwal baru", "Lihat semua",
  "Rekap Kas", …) and empty-state actions are small outlined buttons with an icon (pencil for Ubah/Atur, plus for
  Buat/…baru, arrow for navigation); the hint of clickable stat tiles ("Ubah", "Atur titik", "Daftar", "Lihat
  rincian") reads as a button and fills on hover/focus of the tile; "← Absensi", "Progress project →" and
  "Audit Log →" links → buttons. No arrow characters in link text any more.

## [0.6.3] - 2026-10-09

Admin CMS usability (PR #30): explicit row action buttons on every list, Rupiah amounts and "—" for empty cells in
lists, one button system in the custom views. Web only; APK unchanged (mobile-v0.3.4 works with it).

### Changed

- Admin lists: every Payload list view gets an **"Aksi"** column with a labelled button per row — **Ubah** (pencil,
  tinted) when the user may edit that row (per PT / own draft), **Buka** for workflow documents (requests, cash entries, transfers,
  settlements, receipts, addenda, progress reports, attendance), otherwise **Lihat**. Before, the linked first column
  (plain text) was the only way to open a record. The column stays pinned to the right edge while a wide table
  scrolls sideways (390 px); 32 px targets (44 px on touch), theme focus ring, contrast ≥ 4.5:1 text / ≥ 3:1 border in
  light and dark. Accessible name = action + row title ("Ubah Proyek Jembatan").
- Custom views: "Ubah" text links → the same button (Absensi › Jadwal: hari libur and, new, jadwal kerja); report
  "Daftar laporan" / paging links → buttons. One button system: `.pk-btn` (reports, Akses PT, Keamanan akun) now has
  the `.pk-kbtn` box (38 px, `.sm` 32 px, 44 px on touch, focus ring) and both get a ≥ 3:1 border.

**Database migrations**: `20261009_120000_list_row_actions_column` (data only, idempotent: appends the "Aksi"
column to saved list-column preferences that never named it; no schema change).

## [0.6.2] - 2026-10-09

Fixes from the QA report 2026-10-08 (staging, tested 6–7 Oct; 31 tickets — status per ticket in
`docs/proyekkas/qa/qa-report-2026-10-08-status.md`): finance integrity (QA-03/04/05/06/12/14/17/30), workflow &
receipts (QA-07/08/09/11/15/18/19/27, QA-10/26 documented as an upstream limitation), access & UX
(QA-16/20–25/28/29/31); QA-01 (CrowdSec ban by the test pattern) and QA-02 (WAF, infra) are not app changes, QA-13 is
by design (Q-05). Plus the dependency security bump (`next` 16.3.8, `sharp` 0.35.5, `source-map-js` 1.2.2) and
APK **mobile-v0.3.4** (pubspec `0.3.4+1`, notes `docs/release-notes/apk/0.3.4.md`). Owner decisions 2026-10-08:
overdraft and unverified destination account = warning + confirmation; LPJ shortfall = tolerance then re-approval
(ADR 0019); Staff request for themselves only; PM notifications; valid receipts locked; Direktur read-only on users;
PM read-only on projects (403 naming the fields); unusable modules hidden; Admin reads addenda / progress.

**Database migrations** (run by `migrate`, in this order; additive — the 0.6.1 web image and every released APK keep
working; rollback = restore the pre-deploy dump): `20261008_090000_qa_finance_integrity`,
`20261008_120000_qa_flow_lpj_totals`, `20261008_120100_qa_flow_lpj_source`, `20261008_120200_qa_flow_orphan_job`,
`20261009_090000_qa_settlements_guard_merge`.

### Release merge (0.6.2)
- `20261009_090000_qa_settlements_guard_merge` (snapshot `.json` = the merged schema): both QA branches replace
  `pk_settlements_guard`; `…120000_qa_flow_lpj_totals` (QA-09) ran after `…090000_qa_finance_integrity` (QA-06) and
  dropped its shortfall re-approval rules. This migration installs the union (090000 body + the QA-09 provisional
  totals rule); down restores the 120000 body. Integration test `qa-settlements-guard-merge.int.test.ts` proves both.
- `CashEntry` (`/api/v1/cash-entries` responses) gains `proofId` (additive, QA-31: the current proof, replaceable via
  `PATCH … proofId`); OpenAPI regenerated.
- Persetujuan: the LPJ shortfall decisions (Setujui / Tolak) use the same app dialog as the request decisions
  (`ActionButton` → `ActionDialog`, QA-22/QA-23).

### Security — npm audit (high), 2026-10-09
- `next` 16.3.6 → **16.3.8** (GHSA-3w37-wq28-93x7, -4jqv-mc3x-m676, -39w2-rjm5-chcv, -f87g-xv8r-7p7x, -mcj8-r9mp-w47p,
  -cjq9-62q9-8jv4: cache poisoning, info disclosure, image-optimizer SSRF), `eslint-config-next` aligned; `sharp`
  0.35.4 → **0.35.5** (GHSA-wq5f-xc86-pv6w, librsvg); transitive `source-map-js` → 1.2.2 (GHSA-68fv-2mgg-jv7q). Patch
  releases older than `min-release-age=7` (16.4.0 is not). ADR 0001 pins Payload 3.90.1, not Next's patch level.
  Verified: audit high passes, lint / typecheck / 719 unit / openapi / `next build` green.

### QA report 2026-10-08 — keuangan (QA-03, QA-04, QA-05, QA-06, QA-12, QA-14, QA-17, QA-30)

Status per ticket: `docs/proyekkas/qa/qa-report-2026-10-08-status.md`. Owner decisions 2026-10-08: overdraft and
unverified destination account = warning + explicit confirmation (audited); LPJ shortfall = tolerance, then
re-approval (ADR 0019).

**Database migration** (run by `migrate`; additive — the previous web image and every released APK keep working):
`20261008_090000_qa_finance_integrity` (schema, snapshot `.json`: audit actions `overdraft_confirmed` /
`bank_unverified_confirmed`; `companies.shortfall_tolerance_pct` DEFAULT 10, CHECK 0–100; `settlements.shortfall_approval_*`
+ `pk_settlements_guard` extended; `approvals.doc_type` += `expense_shortfall`, `approvals.settlement_id`, owner CHECK,
G1 trigger, unique indexes and PT check extended; trigger `transfers_shortfall_tolerance`). Rollback refused once a
shortfall re-approval or a new audit action exists — restore the dump.

#### Fixed
- QA-03 / QA-12: every typed Rupiah amount in the admin (Kas masuk/keluar, Addendum RAB, receipt amount) goes through
  one parser (`lib/rupiah-input.ts`, field `RupiahInput`): "." thousands separator; "1.000,50" → "Rupiah tanpa
  desimal", "-5000" → "Gunakan jenis Kas keluar, bukan tanda minus", other characters refused inline; submit blocked
  (was: silently 100050 / +5000).
- QA-05: a cash entry / transfer / LPJ settlement dated before the account opening-balance date → 400 "Tanggal sebelum
  tanggal saldo awal akun (dd/mm/yyyy)" on the date field (was 500); DB guard errors wrapped by drizzle (`cause`) are
  mapped to 409 in `/api/v1`, the sync batch and the role-matrix save (`lib/pg-error.ts`); the cash form `min` date
  follows the picked account's opening date.
- QA-14: the opening balance counts only from its `openingBalanceDate` (K-01 balances, `GET /cash-accounts/balances`,
  K-02 running balance; Rekap Kas column "Saldo awal akun baru" in the go-live month); months before go-live show 0 and
  the dashboard "vs akhir <bulan>" compares with the right balance.
- QA-30: Tutup buku lists and offers months only from the PT books start (earliest opening date of its cash accounts);
  `POST /period-closings` before it → 400; the month summary shows Masuk/Keluar without void pairs, Bersih and a
  separate "Koreksi (void)" column.

#### Added
- QA-04: cash-out (manual, transfer, LPJ shortfall transfer) that would make the account balance < 0 → 409
  `CASH_OVERDRAFT_CONFIRM_REQUIRED` {cashAccountId, balance, after}; `confirmOverdraft: true` posts it and writes audit
  `overdraft_confirmed` (balance before → after). App dialog "Tetap simpan" in the cash form and the transfer/settle
  forms. Reversals (void) are never asked.
- QA-17: Antrian Transfer shows "Terverifikasi / Belum diverifikasi" of the destination account; transfer / LPJ
  shortfall transfer to an unverified account → 409 `BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED` (destination in the
  body); `confirmUnverifiedAccount: true` → audit `bank_unverified_confirmed`.
- QA-06 / ADR 0019: PT setting "Toleransi kekurangan LPJ" (default 10 %). Above approved + tolerance, settle → 409
  `SHORTFALL_REAPPROVAL_REQUIRED`; Finance asks `POST /expense-requests/{id}/lpj/shortfall-approval {note}`, the
  request's approval rule for the new total decides (Direktur `…/acknowledge` → Finance `…/approve`, `…/reject
  {reason}`), web inbox section in Persetujuan (`GET /lpj-shortfall-approvals/inbox`), `settlement.shortfallApproval`
  in the request detail (Finance/Direktur). Web only; the APK is unchanged (ADR 0019 §APK).
- OpenAPI: new codes / flags / paths above; `packages/api-contract/openapi.json` regenerated.
- Guides: Finance (Rupiah input, go-live date, overdraft / unverified account dialogs, shortfall approval, tutup buku,
  Rekap Kas), Direktur (shortfall approval on the web).

### QA report 2026-10-08 — alur & nota (QA-07, QA-08, QA-09, QA-10/26, QA-11, QA-15, QA-18, QA-19, QA-27) — web + APK mobile-v0.3.4

Branch `fix/qa-workflow-receipts`. Owner decisions 2026-10-08: valid receipts are locked (QA-27), Staff requests for
themselves only (QA-15), the team PM is notified (QA-18). Status per ticket: `docs/proyekkas/qa/qa-report-2026-10-08-status.md`.

**Database migrations** (run by `migrate`; additive): `20261008_120000_qa_flow_lpj_totals` (`pk_settlements_guard`:
an open LPJ may change only `receipts_total` + `difference`, consistent with Σ active receipts),
`20261008_120100_qa_flow_lpj_source` (data: cash-in source `LPJ` "Pengembalian LPJ" for every PT without it,
audited, idempotent), `20261008_120200_qa_flow_orphan_job` (job slug `mediaOrphanCleanup`, snapshot `.json`).

#### Added
- API: `GET /api/v1/expense-requests/{id}/settle/precheck` (Finance, read-only) — 409 when the PT has no
  "Pengembalian LPJ" source or the request no bank snapshot; the LPJ refund form calls it BEFORE uploading the proof.
- Worker job `mediaOrphanCleanup` (daily 03:10): unclaimed `media-attachments` older than
  `MEDIA_ORPHAN_MIN_AGE_DAYS` (7) that no document references; dry run unless `MEDIA_ORPHAN_PURGE_ENABLED=true`
  (then tombstone + file delete, ≤ `MEDIA_ORPHAN_BATCH` per run, one `retention_purge` audit row). A tombstone
  can never be claimed (409).
- In-app notifications for the team PM of the request's project (PM role in that PT): `expense.team_submitted`,
  `expense.rejected`, `expense.transferred`, `expense.lpj_revision`, `expense.completed` (QA-18).
- Web: Finance sees **Konfirmasi selesai** on a transferred Reimburse (QA-19).

#### Changed
- Receipts: a receipt date after today (PT timezone) → 400 "Tanggal nota tidak boleh di masa depan" (QA-07); the
  web form caps the date and checks before the upload.
- Duplicate flags also inside the same request (same photo, or same receipt no. + vendor; one flag per pair on the
  later receipt) — cross-request rule and PT scope rule unchanged (QA-08).
- Flags and the open LPJ's receipts total / difference are recomputed after every receipt add / edit / remove /
  valid / reject (QA-09; were refreshed only at LPJ submit). OpenAPI `Settlement.receiptsTotal` description updated.
- A receipt Finance marked **valid** is locked: requester remove / edit → 409 "Nota sudah divalidasi Finance"; the
  web hides the remove button (QA-27).
- Staff-only users: "Diajukan Oleh" = own employee only (403 on create / update / admin form / APK sync, and on
  submit of an older draft); admin picker filtered. PM keeps co-requesters (Q-09), Admin/Finance represent others (QA-15).
- New PTs (also without "Salin default") get the system cash-in source `LPJ` (QA-11).

#### Known limitation
- QA-10 / QA-26 "Tambah Baris" race in the Payload 3.90.1 array field: the pending form-state request is not
  exposed by Payload, so the button cannot be disabled cleanly; the hint stays and the Staff guide explains recovery.

#### APK 0.3.4
- Requester picker shows only the user for Staff-only users, submit validation with the server wording (QA-15);
  no remove icon on valid receipts (QA-27); server refusal sentences (problem `title`) shown instead of the generic
  409/403 text. Receipt date picker already capped at today (QA-07).

### QA report 2026-10-08 — hak akses & UX (branch `fix/qa-rbac-ux`)

Owner decisions 2026-10-08 on the role matrix (QA-20) plus the UX tickets QA-16, QA-21–QA-25, QA-28, QA-29, QA-31.
No database migration; the REST/`/api/v1` contracts only gain `CashEntryUpdate.proofId` (additive, OpenAPI regenerated).

#### Changed — access (QA-20, QA-28)
- **PM is read-only on projects** (`collections/Projects.ts`): update access = Direktur of the project's PT only. A
  PATCH that CHANGES a field by anyone else who can read the project (PM, Finance, Admin) → **403 naming the fields**
  ("Anda tidak berhak mengubah: Nama project, Alamat. Hanya Direktur …", `errors[].path` per field) instead of a
  silent 200 (`access/field-guard.ts` `readOnlyFieldsGuard`, beforeOperation). Callers who cannot read the project get
  the normal 403/404 (no field names, no existence leak). The admin form is read-only for the PM (no Save).
- **Direktur is read-only on users**: verified (integration test) — only an Admin of the user's PTs or a group admin
  edits accounts; the Direktur keeps editing only the own signature (profile).
- **Admin reads `budget-addenda` and `progress-reports`** (was 403); create/update stay closed (domain service only).
- **Empty scope = empty list, not 403** (`access/scope.ts`): `inIds` / `ownEmployee` return a no-row `Where`
  (`NO_ROWS`) instead of `false`. Staff without assignments opening the request form no longer gets 403 on
  `/api/cost-centers` (QA-28); a PM without a team sees an empty project list. Roles WITHOUT a rule are still refused.
  `companies` update access returns `false` (not an empty `IN`) for callers without an Admin/Direktur PT.

#### Changed — navigation and "no access" (QA-20(c), QA-24)
- Module launcher/bar show only modules a role can **use**, derived from Payload permissions: a module of only
  personal shortcuts (own profile, own notifications — both already in the top bar) is hidden (Staff: Pengguna & Akses,
  Sistem; PM: Sistem); **Master Data** and **Pengaturan** need create/update on at least one of their entities (PM:
  hidden; Finance: Pengaturan hidden).
- One **"Anda tidak memiliki akses ke halaman ini."** page with a back link for every custom view (Kas, Tutup buku,
  Antrian Transfer, Verifikasi LPJ, Laporan, Audit Log, Addendum, Progress, Absensi, Akses PT) — no role codes.
- Payload's unauthorized view replaced (`admin.components.views.unauthorized`); a logged-in caller without create
  access on `/admin/collections/<slug>/create` is redirected there instead of Payload's hard-coded "Tidak sah, Anda
  harus masuk…" (`src/admin/denied-create.ts`, called from the admin page). The REST 401 text is unchanged.

#### Changed — pickers and messages (QA-16, QA-21, QA-22, QA-23)
- User pickers show **"Nama · email"** (virtual `users.displayName` = `useAsTitle`; picker select/search mapped to
  `name`/`email`). `projects.pm` lists only **active PMs of the project's PT**; `cost-centers.manager` active members of
  the PT; approval-rule users active Direktur/Finance of the PT.
- Error texts: field paths shown as form labels ("Uraian penggunaan dana: Wajib diisi") or dropped; no `HTTP 403`;
  no `US-xx` / `ADR` / `G-x` / `Q-x` codes in user-facing domain messages (signature: no more `signatureMediaId`);
  every `ValidationError` passes `req.t` + field labels ("Isian berikut tidak valid: Alasan perubahan" instead of
  "The following field is invalid: changeReason"); duplicate per-PT `code` checked before the insert ("Kode … sudah
  dipakai di PT ini", path `code`, not "company_id code").
- `window.prompt/confirm/alert` replaced by the app dialog (`ActionDialog`, same look as Void/Addendum): approval
  inbox, LPJ verification, reimburse receipt review, requester actions (submit, withdraw, cancel, resubmit, receipts,
  complete, delete receipt). A reason shorter than 3 characters shows "… wajib diisi (minimal 3 karakter)." and the
  dialog stays open; server errors stay in the dialog.

#### Fixed — display (QA-25, QA-29, QA-31)
- React hydration #418 on the expense-request detail: read-only server timestamps (`submittedAt`, `decidedAt`, …)
  render as fixed company-TZ text ("8 Okt 2026 14:30 WITA") in form and list; requester panel Rupiah via
  `formatRupiah` (no locale-dependent `toLocaleString`).
- Admin date format `d MMM yyyy HH:mm`; boolean list cells "Aktif/Nonaktif" / "Ya/Tidak" (was "benar/salah");
  technical media fields (SHA-256, original width/height/size, uploader, owner) hidden while uploading, read-only in
  the sidebar of a saved file; requester/workflow panel controls never exceed the column at 390 px.
- Kas edit (ADR 0005 §5): same layout as "Catat kas" — date, account and amount shown **locked**; the **proof can be
  added or replaced** (`PATCH /api/v1/cash-entries/{id}` `proofId`, own unclaimed upload, audited with the reason).
- Employee create form shows **No. HP** for Admin/Direktur/Finance/PM.

## [0.6.1] - 2026-10-05

Employee privacy notice (UU PDP; Q-46, ADR 0018) with a versioned acknowledgement on the web and in APK 0.3.3,
server-side attendance enforcement once "Versi APK minimum" ≥ 0.3.3, selfie retention 6 months (Q-33), and the CI fix
for the full GitHub Actions artifact quota (APK 0.3.2). Notice v1 effective 5 Oct 2026, contact PIC Rivaldo AK.

**Database migrations** (run by `migrate`; rollback = restore the pre-deploy dump): `20261005_090000_privacy_notice`
(users `privacy_ack_version` / `privacy_ack_at` + guard, audit action `privacy_ack`, retention default 6),
`20261005_090100_selfie_retention_6m` (12 → 6 only for PTs whose value was never changed; audited).
**After the deploy (owner):** every user sees the notice once; raise "Versi APK minimum" to 0.3.3 only after the
APK 0.3.3 is on `/unduh` and the field phones are updated; switch on "Hapus otomatis selfie" when ready.

### Employee privacy notice (Q-46, ASVS 8.3.3 / G-06, ADR 0018) + selfie retention 6 months (Q-33) — web + APK mobile-v0.3.3

Owner decisions 2026-10-05: collecting selfie + location at attendance is approved and employees must be shown the
notice (Q-46); attendance selfies are kept 6 months (Q-33). The notice text is draft v1
(`docs/proyekkas/legal/pemberitahuan-privasi.md`, wording + contact still awaiting DRMS HR/legal) and is the single
source: nothing else carries its wording.

**Database migrations** (run by `migrate`; additive — APK 0.3.2 and the previous web image keep working):
`20261005_090000_privacy_notice` (schema, snapshot `.json`: `users.privacy_ack_version` / `privacy_ack_at` + CHECK
`users_privacy_ack_pair` + trigger `users_privacy_ack_guard` (no withdraw / lower / re-date), audit action
`privacy_ack`, `companies.selfie_retention_months` DEFAULT 6, Users list column added to saved list preferences),
`20261005_090100_selfie_retention_6m` (data only: PTs still at the untouched old default 12 → 6, one `update` audit
row per PT, idempotent; values an Admin/Direktur set deliberately — audit trail — are kept; the delete switch is not
touched).

#### Added
- Web/API: the notice is bundled at build time (`scripts/gen-privacy-notice.mjs` → `src/legal/privacy-notice.generated.ts`,
  `npm run gen:privacy-notice`; CI step `check:privacy-notice` fails on drift) and rendered by a minimal safe markdown
  renderer (`src/legal/markdown.ts`: escaped text, attribute-less tags only; React renders the AST, no
  `dangerouslySetInnerHTML`; no new dependency). Version = the integer of the "Versi" line (`PRIVACY_NOTICE_VERSION`).
- Public page `/privasi` (noindex like `/unduh`), linked from the web login page and `/unduh`.
- `GET /api/v1/privacy-notice` (public): `{ version, title, html, markdown }`; `GET /api/v1/me` → `privacy:
  { currentVersion, ackVersion, ackAt }`; `POST /api/v1/me/privacy-ack { version }` (own account, Idempotency-Key
  required from the APK, 409 `PRIVACY_VERSION_MISMATCH` unless `version` = current, audited `privacy_ack`, re-ack =
  `alreadyAcknowledged` without a new row). OpenAPI regenerated; route table: `GET /privacy-notice` public,
  `POST /me/privacy-ack` own.
- Admin: non-dismissable interstitial over every admin page until the current version is acknowledged ("Saya
  mengerti"); Users list column "Privasi dibaca (versi/tanggal)"; fields read-only in the user form.
- APK 0.3.3 (pubspec `0.3.3+1`, release notes `docs/release-notes/apk/0.3.3.md`): full-screen notice after login / at
  every start while not acknowledged ("Saya mengerti" / "Nanti" = this app run only), rendered from the API markdown
  and cached in the encrypted DB for offline reading; attendance (own check-in/out, on-behalf, selfie capture,
  distance check) blocked with an Indonesian message until the server has the acknowledgement; offline the
  acknowledgement is retried with the same Idempotency-Key when the server is reachable again (never assumed
  locally); Profile → "Pemberitahuan privasi". A server without the feature (no `privacy` in `/me`, 404) blocks
  nothing.
- Server-side enforcement (owner decision 2026-10-05, ADR 0018 implementation note): while the app setting "Versi APK
  minimum" is ≥ 0.3.3 (strict `x.y.z`, numeric compare; unset/unreadable = off), attendance captures of a user without
  an acknowledgement of the current notice are refused `PRIVACY_ACK_REQUIRED` — sync items `attendance.check_in` /
  `check_out` / `on_behalf` (acting PM) as a final per-item rejection, `POST /api/v1/media/selfies` and the Payload
  REST create of `media-selfies` as 403 — each audited `access_denied` (reason `PRIVACY_ACK_REQUIRED`). Below 0.3.3
  nothing changes (APK 0.3.2 keeps working); corrections by PM/Admin are not affected. OpenAPI documents the code.
  APK 0.3.3 maps the code to a clear Indonesian message, never retries it and reloads `/me` (notice screen).

#### Changed
- `companies.selfieRetentionMonths` default 12 → **6** (field description names Q-33 / owner decision 2026-10-05); the
  retention job fallback follows (`SELFIE_RETENTION_DEFAULT_MONTHS`). A unit test keeps the notice §4 and the default
  equal. `selfieRetentionDeleteEnabled` stays off by default (owner switch).
- Docs: Q-33 / Q-46 answered (`open-questions-client.md`), ASVS 8.3.3 Celah → Terpenuhi, G-06 narrowed to 8.3.2 /
  8.3.4 + final wording, guides (README, staff, PM, admin), ADR 0018.

### APK mobile-v0.3.2 (tag `mobile-v0.3.2`, pubspec `0.3.2+1`)

Republish of 0.3.1 with identical app code: the `mobile-v0.3.1` `release-prod` job stopped at `upload-artifact`
(GitHub Free plan Actions storage quota hit, 2026-10-04) before it created the GitHub Release, so 0.3.1 was never
published. Release notes `docs/release-notes/apk/0.3.2.md` (= 0.3.1 items).

#### Changed
- CI (`mobile.yml`): every `actions/upload-artifact` step is `continue-on-error` — a full artifact quota no longer fails a
  build or a release; the production APKs are published as GitHub Release assets, which do not count against the
  Actions storage quota.
- `release-prod` on the self-hosted runner also copies the obfuscation symbols to the runner cache
  (`/cache/release-symbols/<tag>`, host `/srv/ci/cache/release-symbols`) so they survive when the artifact upload fails.

## [0.6.0] - 2026-10-04

MC4 — multi-company hardening and the owner's PT scope rule (2026-10-02: read/search scope = the PTs a user is mapped
to), verified by the automated staging UAT (`docs/proyekkas/uat/mc4-uat-report.md`: API 68/68, browser 19/19 on
`5fe21fa`). Includes the MC4 code gaps (copy defaults on PT create, optional body `company`, per-PT flags and
thresholds), the MC4 QA security fixes (4 HIGH + open items), the historic audit PT backfill (MC4-04), npm audit
overrides (`undici`, `nodemailer`, `sass`) and CI hardening. Also carries the APK `mobile-v0.3.1` release files.

**Database migrations** (run by `migrate`, not backward compatible → rollback = restore the pre-deploy dump):
`20260930_120000_mc4_list_company_column` (data only), `20261002_080000_mc4_scope_rule` (media `ownerCompany` +
triggers + backfill), `20261003_090000_mc4_audit_company_backfill` (historic audit rows tagged with their PT).
**Keycloak prerequisite:** realm role `pk-user` in the scope mappings of `proyekkas-web` / `proyekkas-mobile`
(done in `drms` and `drms-staging` 2026-10-02, infra `fe01694`); every prod user needs `pk-user`.

### CI — unit test hook timeout
- `apps/web/vitest.config.ts`: `hookTimeout` 60 s (was the 10 s default). Suites that import the full Payload config in
  `beforeAll` (e.g. `admin-modules`) failed as a whole file under load on the 2-vCPU runner (develop `5fe21fa`
  verify, 2026-10-03; passes alone in 5 s). Test timeouts unchanged.

### Security — npm audit (high): `braces` via `sass`
- New advisory GHSA-vfj7-8cjw-p6xm (`braces` ≤ 3.0.3, stack-exhaustion DoS; **no patched release**) reached the prod
  tree through `@payloadcms/next` 3.90.1 → `sass` 1.77.4 → `chokidar` 3 → `braces`, failing CI `npm audit` on develop
  `e49e533` (2026-10-03). Root override `sass` 1.105.0 (released 2026-09-22, respects `min-release-age=7`; uses
  `chokidar` 5 without `braces`). `npm audit --omit=dev --audit-level=high` passes (7 moderate remain); `next build`
  compiles the Payload admin SCSS unchanged (no deprecation output). Remove the override when Payload bumps `sass`.

### MC4 — UAT defect MC4-04: PT tag for historic audit rows (branch `fix/mc4-audit-backfill`; report `docs/proyekkas/qa/mc4-qa-report.md` §11.2)

Found by the staging UAT, case AUD-02. Migration `20261003_090000_mc4_audit_company_backfill` (idempotent, down =
no-op; 1.5 s for ~10 000 rows locally). APK unaffected.

#### Fixed
- **Audit trail of older documents (MC4-04):** audit rows written before the QA-MC4-03 fix had no PT, so once a
  second PT existed a Direktur / Admin of DRMS without a role in that PT no longer saw them (audit-log list, report,
  REST). The migration gives every such row the PT of its document: requests, receipts, transfers, LPJ, cash
  entries, addenda, progress reports, attendance, masters, sequences, approval rules, memberships, the PT itself and
  owner-linked media; old number rows without a document id by their unique number. Rows of deleted documents,
  app-wide rows (logins, users, devices, reports, import) and cross-PT duplicate flags stay without PT.
- The audit writer derives the PT for the same doc types, so new rows of masters, sequences (import cut-over) and
  media are tagged too.

#### Changed
- Append-only rule: the migration disables `audit_logs_no_update` for its own UPDATEs only (owner, one transaction,
  ADR 0006 §6) and records one `schema_maintenance` audit row with the counts.

### MC4 — staging UAT fixes (2026-10-02, `docs/proyekkas/uat/mc4/` run on staging `3dd8a96`)
- **UI-CO (copy defaults in the company form):** after the MC4-02 read fix the two fields were visible but
  **disabled** — Payload makes `virtual` fields `admin.readOnly` by default (`fields/config/sanitize.js`); both now set
  `admin.readOnly: false` (unit test). The API path was already fine (the UAT fixture created PT CS1 with copied
  defaults).

### MC4 — QA open items (branch `fix/mc4-qa-open-items`; report `docs/proyekkas/qa/mc4-qa-report.md` §11)

Closes QA-MC4-09, QA-MC4-13 and the read-rule parts of QA-MC4-14 under the PT scope rule. Web/API only, no
migration. The APK 0.3.x keeps working: no error code was added, removed or renamed.

#### Security
- **On-behalf drafts (QA-MC4-09):** "Admin/Finance may create a request for others" (Q-09) now needs that role in
  the PT of the request. That PT comes from the project or cost center and from every requester. A role in another
  PT no longer counts: for example, Admin of PT A + Staff of PT B → 403 for a draft for PT B employees.
- **Existence oracles (QA-MC4-14):** a reference in a PT the caller is not mapped to now gets the same answer as a
  missing one:
  - sync items: no `COMPANY_MISMATCH`; attendance locations and on-behalf employees → `NOT_FOUND`; drafts → the
    usual validation error;
  - a create with a body `company`;
  - a new addendum: 404 instead of 403;
  - manual cash entries: a missing project / cost center / category / source / vehicle is now a 400 (was a 500).

  `COMPANY_MISMATCH` stays for a mismatch between two PTs the caller is mapped to.
- **`?pt=` (QA-MC4-14):** a PT outside the caller's selection now gets 403 `COMPANY_NOT_ALLOWED` in the
  `/api/v1/reports` JSON and downloads (it used to narrow silently to an empty report). The panel views Laporan,
  Audit Log, Kas, Catat kas, Tutup buku, Absensi and Rekap absensi show a denial instead.
- **Display names (QA-MC4-14):** names in Riwayat, request DTOs, PDFs and the audit-log report and its filter come
  from the document's PT or from a PT the viewer is mapped to, else the account name. They never show an employee
  name from another PT.
- **Face reference photo (QA-MC4-14):** `employees.faceRefPhoto` takes only a selfie of the employee's PT, or the
  caller's own upload that is not linked yet. Any other selfie, or a missing id, gets the same 400.

#### Changed
- `mc2-sql-lint` (QA-MC4-13) now:
  - scans all of `domain/expense|progress|addendum|sync`;
  - knows 7 more per-PT tables;
  - accepts a company predicate only when it is a helper call or a bound parameter (`company_id = ${…}`,
    `IN (${…})`, `= ANY(${…})`), not a join condition.

  Its allow-list has 17 entries, each with a reason, and the test fails on an entry that is no longer needed.
- OpenAPI: the report query parameter `pt` is documented; the descriptions of `COMPANY_MISMATCH` and the body
  `company` were updated (no shape change).

#### Fixed (found by the MC4 UAT suite, local run 2026-10-02)
- **MC4-02:** "Salin default saat dibuat" / "Salin dari PT" were never shown on the company create form (field
  `read: () => false` → Payload hides the field); now readable by the group admin only.
- **MC4-03:** 2 px horizontal page overflow at 390 px on `/admin/persetujuan`: the table wrapper `.pk-tw` bleeds to
  the card edge only inside a `.pk-card` (`--pk-tw-bleed`), no negative margin elsewhere.

### CI — Trivy image scan: retry, IPv4 only
- `ci.yml` job `image`: the Trivy report and gate run through `.github/scripts/trivy-image.sh` — 3 attempts with
  back-off (0 / 30 / 90 s) for network errors, the container started with IPv6 disabled (Go then skips AAAA records;
  falls back to a normal run if the daemon refuses the sysctl). The gate now uses `--exit-code 3` for "fixable
  CRITICAL found", which is never retried, and `set -euo pipefail` (a failing first image used to be masked by the
  second). Cause: develop `3dd8a96` (2026-10-02) failed in the gate fetching a GHCR blob from
  `pkg-containers.githubusercontent.com` ("dial tcp [2606:50c0:…]:443: connect: network is unreachable").

### CI — image build retry
- `ci.yml` job `image`: each buildx step (web/migrate, local and push-by-digest) runs once with
  `continue-on-error`, then after a 45 s back-off one retry; later steps take the digest of whichever attempt
  succeeded. Cause: develop `bff95ac` (2026-10-02) failed resolving `docker.io/docker/dockerfile:1` during a transient
  Docker Hub outage on the self-hosted runner (IPv4 blip; the runner network has no IPv6). The BuildKit cache makes
  the retry cheap; a second failure still fails the job.

### MC4 — PT scope rule (owner decision 2026-10-02; branch `feat/mc4-pt-scope-rule`, ADR 0016 "Implementation notes — Scope rule")

Read and search scope = the PTs a user is mapped to (active memberships): one PT → that PT only; several → the
consolidated data of those PTs, never another PT. Group admin unchanged; mutations stay single-PT. Web/API only.
Migration: `20261002_080000_mc4_scope_rule` (schema + backfill, idempotent, down migration; ~12 s for 74 400 media
rows locally).

#### Security
- **Duplicate receipts (QA-MC4-06):** the check compares a receipt only with requests in the request's PT and the
  PTs its uploader is mapped to. A hit in another PT is shown (with its number and link) only to users mapped to that
  PT; everyone else sees nothing of it — counts, the "Verifikasi semua nota" gate, the internal PDF, reports, REST,
  Riwayat and the audit log follow the same rule (audit rows of such a flag carry no PT).
- **Deactivated PT (QA-MC4-05):** files of a deactivated PT are no longer readable by the office users of the other
  PTs; the "office in every PT" shortcut (media) and the "rows without PT" audit rule count inactive PTs too (with a
  deactivated PT, only group admins read audit rows without PT).
- **Oracles (QA-MC4-08/10):** a stage template, project, cost center, bank account, category, cash account or
  `progressPct` of a PT the caller is not mapped to is answered like a missing one (no lock date, no state, no
  template copy).
- PT logos only for members of that PT (+ group logo); signatures and device revoke count active memberships only;
  notifications about a PT the user left are hidden; `/me` without membership no longer shows PT #1.

#### Changed
- **Media lists (QA-MC4-07):** new derived column `ownerCompany` on receipt / transfer-proof / attachment /
  progress-photo / selfie media (set by DB triggers, backfilled); office access is `ownerCompany IN (…)` instead of id
  lists (65 535 bind-parameter cap). Cash-entry attachments are now readable by the office roles of that PT.
- Receipt flags carry `relatedCompany` (PT of the related request when it is another PT).

### MC4 — QA security fixes (branch `docs/mc4-qa`; report `docs/proyekkas/qa/mc4-qa-report.md`)

#### Security
- **QA-MC4-01 (HIGH):** REST creates that name a `company` in the body re-check the create role in the derived PT
  (Finance/Admin of PT A could create bank accounts, team assignments or budget lines in PT B).
- **QA-MC4-02 (HIGH):** a PT Admin may only change accounts that belong solely to PTs where they are Admin (no
  rename / deactivate / e-mail change of users of other PTs or of group admins).
- **QA-MC4-03 (HIGH):** per-PT document audit rows are tagged with their PT; rows without PT only for users with an
  office role in every PT (Admin/Direktur of PT A no longer read PT B's audit rows).
- **QA-MC4-04 (HIGH):** single media file access is decided on the row's own owner document and office id lists load
  via SQL (opening one selfie no longer exhausts the web heap for a multi-PT Finance user).

### APK mobile-v0.3.1 (tag `mobile-v0.3.1`, pubspec `0.3.1+1`)

APK-only UX fixes from the module check; no server change needed (web ≥ 0.5.1 / MC4 API). Release notes
`docs/release-notes/apk/0.3.1.md`.

#### Added
- **Notification tap routing** for every document type the server writes (`AppNotification.route`, same mapping as
  the web `notificationHref`): `budget_addendum` (addendum.*) → `/addenda/:id`; `project` +
  `progress.late_report` → `/progress?project=:id` (reports filtered to that project); other `project` events
  (`reminder.budget_threshold`) → `/progress?tab=projects`; `progress_report` → `/progress/report/:id`;
  `attendance` → `/attendance` (team tab without own attendance); `expense_request` unchanged. Progress targets
  only for PM / Direktur / Finance; unknown types or non-numeric ids stay non-tappable (read rows without a target
  have no tap action; routable rows show a chevron).
- **Edit an addendum draft** (`PATCH /api/v1/budget-addenda/{id}`, `BudgetAddendumUpdate`: `addition`, `reason`; the
  project stays fixed): "Ubah draft" on the detail only when `allowedActions` contains `edit`; route
  `/addenda/:id/edit` reuses the create form prefilled, "Simpan perubahan" and — when `submit` is also allowed —
  "Simpan & ajukan" (PATCH then submit). One Idempotency-Key per PATCH body (the server answers 422 to a reused key
  with another body). A non-editable addendum shows a notice instead of the form.
- **Finance home: US-12 "Progress fisik vs anggaran"** card (`ProjectProgressSummary`, `GET /projects/progress`
  allows `pk-finance`), as on the web Finance Beranda; shown for every role with `canReadProgress`.
- **Per-PT dashboard breakdown** ("Per PT" card under the KPI totals) when `/dashboard/*` `companies[]` has ≥ 2 PTs:
  Direktur `cash.byCompany` + `approvals.byCompany`, Finance `cashByCompany` + `transferQueue.byCompany`, PM
  `teamMonthByCompany`.

#### Changed
- PM "Absenkan anggota tim" stays visible but disabled with the line "Absen atas nama belum bisa: absensi dari
  aplikasi belum diaktifkan Admin (Setting perusahaan)." when `syncAttendanceEnabled` is off for every PT in scope
  (was: hidden silently).

### MC4 — code gaps (branch `feat/mc4-code-gaps`; ADR 0016 "Implementation notes (MC4)", `docs/proyekkas/mc/mc4-progress.md`)

Web/API only (no APK change). Migration: `20260930_120000_mc4_list_company_column` (data only, preferences).

#### Added
- **Copy defaults on PT create (US-MC-01):** a PT created by the group admin gets, in the same transaction, the
  document sequences (every doc type of the source PT, `startAt` 1), the approval rules without per-PT references
  (rules naming a project / category / cost center / user, or refused by today's rule checks, are skipped and
  reported), the default work schedule and the per-PT settings still at their default — from PT #1 (DRMS) or the
  PT chosen in "Salin dari PT"; "Salin default saat dibuat" off = bare PT. Idempotent (create-only by natural key),
  audited (rows + one summary `defaultsCopied` row). Seed and go-live import keep their built-in defaults.
- **Optional body `company`** on `POST /api/v1/expense-requests`, `/progress-reports`, `/budget-addenda`,
  `/cash-entries`: must be a membership with the role the create needs IN that PT (else 403
  `COMPANY_NOT_ALLOWED`, audited) and the PT of the referenced project / cost center / cash account (else 400
  `COMPANY_MISMATCH`); the create runs under that PT. Absent = unchanged (APK 0.2.x / 0.3.0).
- **Report PDF logo:** the letterhead logo (PT logo; group logo on a consolidated report) is drawn left of the kop
  (JPEG/PNG ≤ 3 MiB, same image guard as the document PDF, ADR 0008).
- **Per-PT fields documented for the APK** (`/dashboard/*`: `companies`, every `byCompany` row, `companyId` on
  embedded rows, `viz.warnPctByCompany`; approval inbox `items[].budget.warnPct`; K-09 rows `companyId`,
  `warnGapPct`, `badGapPct`) — additive; OpenAPI regenerated.

#### Changed
- `GET /api/v1/app/config` (public): the three sync feature flags are the OR over the ACTIVE PTs (was company #1);
  `timezone` = the server timezone every PT uses. One PT = identical answer. Per-PT truth: `GET /me`
  `companies[].settings`; the server keeps enforcing the item's PT flag (`FEATURE_DISABLED`).
- Notification templates are app-wide: create/update = group admin only (was: Admin of any PT); PT Admin /
  Direktur keep read access (default decision, the owner may override).
- Settings without a document (inbox `budgetWarnPct`, K-09 top-level thresholds, dashboard `viz.warnPct`, lock date
  / today fallbacks) use the caller's only / LOWEST selected PT instead of company #1 (which could be a PT the caller
  is not a member of); every item / row carries its own PT's value.
- Scope literals without PT parts (`{ kind: 'team', projects }`, `{ kind: 'own' }`, `{ kind: 'all' }`) now match
  nothing in every report / attendance query (was: `all` only).
- Saved list-column preferences that never named the PT column get it prepended once (migration above).

## [0.5.1] - 2026-09-30

Security patch on top of 0.5.0 (no migrations, no API change): npm audit high findings in `undici` and `nodemailer`
fixed with root `overrides`. Deploy this instead of 0.5.0 (same database migrations as 0.5.0; rollback = restore the
pre-deploy dump). Also carries the APK `mobile-v0.3.0` release files (pubspec, notes, runbook).

### Security
- **npm audit (high) fixed with root `overrides`** — `payload` 3.90.1/3.90.2 pins `undici` 7.29.0 (GHSA-rfgv-xxqx-mfg5,
  GHSA-w293-vg96-wgc3 high + 8 moderate/low, patched in 7.29.1) and `@payloadcms/email-nodemailer` takes
  `nodemailer` ^9.1.1 (GHSA-v53p-9fqp-m79j high, GHSA-g57g-f23g-4646; patched in 10.0.9). Overrides: `undici` 7.29.1,
  `nodemailer` 10.0.10 (10.x only drops Node < 20; newest versions respecting `.npmrc` `min-release-age=7`). Remove
  the overrides once Payload ships the patched versions. Remaining audit: 6 moderate + 1 low, all needing a Payload
  downgrade (`npm audit fix --force` → 3.85.1) — not applied.

### APK mobile-v0.3.0 (tag `mobile-v0.3.0`, pubspec `0.3.0`)

First APK release since `mobile-v0.2.0`; ships the APK parts of 0.5.0 that were never released: multi-company
(MC3-2: PT switcher, per-PT masters/capabilities, drift schema v3 with `company_id` on the offline queue), the optional
authenticator code on password login (ADR 0017) and the release-notes sheet on the update banner/screen. Release notes
`docs/release-notes/apk/0.3.0.md` replace the never-tagged `0.2.1.md`. **Requires web ≥ v0.5.0** (`/me`
`companies[]`) — publish on `/unduh` only after that deploy (runbook `rilis-apk.md` Prasyarat); do not raise the
minimum APK version yet (0.2.x keeps working for single-PT accounts).

## [0.5.0] - 2026-09-29

Multi-company (MC1–MC3, ADR 0016), optional self-service 2FA (ADR 0017), admin loading dots (0.4.2) and the
self-hosted CI runner support. Database migrations are NOT backward compatible (rollback = restore the pre-deploy dump).

### MC3 — APK (MC3-2, branch `feat/mc3-mobile`; ADR 0016 §8, ADR 0010 MC note, `docs/proyekkas/mc/mc3-progress.md` §APK)

#### Added
- **Profile per PT:** `GET /me` `companies[]` parsed (roles, employee, capabilities, settings incl. sync flags per PT);
  menus and home tiles follow the union over the selected PTs, document actions the roles IN the document's PT.
- **PT switcher** (home app bar + Profil "PT aktif"): "Semua PT" or any subset, stored per user, sent as
  `X-Company-Ids`; one PT = static code. 403 `COMPANY_NOT_ALLOWED` resets the selection and reloads `/me`.
- **Create in one PT:** new request asks the PT first when several are possible; progress reports and check-ins take
  the PT of their project / location; pickers show that PT's masters only; check-in / progress queue flags per PT.
- **PT chips** on requests, drafts, inbox, LPJ queue, notifications, addenda, progress reports, team attendance and
  the send queue when more than one PT is shown; **LPJ queue** (`GET /lpj-queue`) in the Persetujuan inbox; own
  attendance recap per PT (`/attendance/me?company=`).
- **"Pilih PT untuk data offline"**: offline data from before the update, when the account has several PTs.

#### Changed
- drift schema **v3**: `company_id` on local drafts, progress reports and outbox; migration keeps every v2 row
  (one PT → assigned, several PTs → held until chosen, never guessed).
- Sync: every item sends its own row's `company_id`, one batch per PT, no `X-Company-Ids`; `COMPANY_MISMATCH` /
  `COMPANY_NOT_ALLOWED` = final rejection with a clear Indonesian text; batch 409 `COMPANY_REQUIRED` holds PT-less
  items without losing them.
- Masters cache per user **and** PT with `ETag` / `If-None-Match` (304 keeps the cache).

### MC3 — API (MC3-1, branch `feat/mc3-api`; ADR 0016 §5/§8, `docs/proyekkas/mc/mc3-progress.md`)

#### Added
- **`GET /api/v1/me` company context:** `companies[]` (every active membership: `code`, `name`, `timezone`,
  `selected`, roles, `employeeId`/`employee`, capabilities and APK settings per PT), `activeCompanyIds`,
  `legacyCompanyId`, app-wide `appSettings`.
- **Masters per PT:** `company` + `shared` on every item (banks, UoM, holidays shared), default geofence radius of the
  item's PT, `companies[].version` + `sharedVersion`, weak `ETag` with `If-None-Match` → 304, `?company=`; new types
  `vendors`, `cash-in-sources`.
- **`sync/batch` per-item `company_id`:** processed under that PT whatever `X-Company-Ids` says (flags, TZ, own
  employee of that PT); codes `COMPANY_NOT_ALLOWED` / `COMPANY_MISMATCH` per item, `company_id` in results; items of
  the released APK (no `company_id`) accepted for one-PT accounts, otherwise 409 `COMPANY_REQUIRED` for the batch.
- **`?company=` PT filter** (subset of the selection, else 403 `COMPANY_NOT_ALLOWED`) on the approval inbox,
  transfer queue, new `GET /api/v1/lpj-queue`, expense list, addenda list/inbox, progress reports, cash entries,
  balances, period closings, notifications, attendance (`/attendance/me` per PT, team today).
- `companyId` on expense list/detail, cash entries, notifications, addenda and progress reports; `company` ref on
  approval inbox rows.
- OpenAPI: reusable header parameter `X-Company-Ids` (`components.parameters.CompanyIds`) on every authenticated
  path; contract regenerated (`packages/api-contract/openapi.json`).
- Route table of all 91 `/api/v1` routes with a completeness test (`tests/integration/mc3-api.int.test.ts`,
  `tests/unit/mc3-api.test.ts`).

#### Deprecated
- Top-level `roles`, `capabilities`, `employee`, `settings` of `GET /me` (kept for mobile-v0.2.0; one PT → unchanged
  values; several PTs → union roles, employee/settings of `legacyCompanyId`).

#### Security
- `GET /api/v1/cash-accounts/balances?company=` returned the balances of any PT; `GET /api/v1/period-closings?company=`
  the lock date of any PT — both now limited to the caller's selection (403 + audit otherwise).
- `GET /me` `settings` no longer falls back to company #1 for a user who is not a member there.

### Added
- **MC1-1 — companies + per-PT memberships** (`apps/web`, branch `feat/mc1-foundation`, ADR 0016 §1–§2):
  collections `companies` (identity + per-PT operational settings moved from the `company-settings` global; company
  #1 = DRMS) and `company-memberships` (user × PT: roles, employee link, active; unique (user, PT) and (PT, employee));
  `users.groupAdmin` (DB-only flag: companies, app-wide settings). Access context per request = active memberships
  ∩ selection (`X-Company-Ids` header / `pk-company-ids` cookie); `hasRole(req, role, companyId)` requires the PT,
  legacy "any selected PT" checks are `hasRoleAny` (MC2 review points). Approver pools, recipients, G1 requester
  accounts and display names resolve through memberships. Migration `20260927_230033_mc1_companies` (backfill:
  company #1 from the global, one membership per user from its former roles/employee, Admins → group admins;
  down migration restores the single-company shape).

- **MC1-2/MC1-3 — company column + access per PT** (ADR 0016 §4–§5): `company` on the 30 per-PT collections
  (masters chosen on create — default = the caller's only PT; transactions derived from their parent by
  `fields/company.ts` `companyHook` and, for raw inserts, the DB trigger `pk_company_from_parent`), nullable PT tag on
  `notifications` / `audit-logs`. `byRole` is evaluated PER PT ("see all" = all rows of the PTs where the role is held;
  scope rules AND-ed with their PT; `resolveScope` per PT), shared masters / per-user rows use `byRoleAny`; creates
  are re-checked against the role in the resolved PT. Decision guards (approve, acknowledge, transfer, LPJ …) use
  the caller's roles and employee IN THE DOCUMENT's PT; `X-Company-Ids` naming a foreign PT → 403
  `COMPANY_NOT_ALLOWED` (audited `access_denied`). Codes/names/document numbers unique per PT. Migration
  `20260927_234849_mc1_company_columns` (backfill → company #1, NOT NULL, per-PT unique indexes).
- **MC1-4 — DB guards per PT** (migration `20260928_000100_mc1_security`): `company_id` immutable, cross-PT
  references rejected by triggers (SQLSTATE 23514 `cross-company reference`: every per-PT FK pair, requester/line
  child rows, PM / cost-center manager / named approvers need an active membership in the row's PT),
  `pk_cash_lock_date(company_id)` in the transfer / cash-entry / opening-balance guards (closing PT A never locks
  PT B), `closePeriod` / `reopenPeriod` per PT, `reminder_runs` keyed `(company_id, run_date)`.
- **MC1-5 — numbering per PT** (migration `20260928_000200_mc1_numbering`): counters `(company_id, doc_type,
  period_key)`, `{COMPANY}` = short code of the document's PT, DRMS counters continue (PB 229…), `shortCode`
  immutable once a PT has numbered documents.
- **Go-live import / LPJ refund per PT:** the import matches and creates per-PT masters inside its PT (MC1: first
  active PT; `kode_pt` = MC2); the LPJ refund cash entry uses the "Pengembalian LPJ" source of the request's PT.
- **MC1-6 — isolation suite** `tests/integration/mc-isolation.int.test.ts` (two PTs, per-PT reads/writes/approvals,
  forged header/cookie, DB cross-PT guards, per-PT numbering and period lock) + unit tests `mc1-access.test.ts`.
- **MC2 — multi-company domain, reports, jobs, admin UI and import** (branch `feat/mc2-integration` =
  `feat/mc2-backend` + `feat/mc2-admin-ui`, ADR 0016 §5–§11, requirements v1.2 §5/§6; progress `mc/mc2-progress.md`):
  - **Reports / KPI / exports per PT (MC2-2)** (ADR 0016 §6, requirements v1.2 §5/§6):
    `ReportScope` = list of per-PT scopes built from the role IN each selected PT (`officeScope`, `roleScope`,
    `auditScope`, `teamScope`, `ownScope`); every raw SQL carries a company predicate (`companyScopeSql`,
    `ledgerScopeSql`, …; "all" = the caller's PTs for that role, a company-blind `{ kind: 'all' }` matches nothing);
    the 8 formerly unscoped KPI functions take a scope. Reports: parameter `pt` (narrows only), PT column + "Subtotal
    per PT" table when > 1 PT, master labels prefixed `[CS1]`, categories never merged across PTs. Dashboards: per-PT
    breakdown (`byCompany`) next to every combined total. Exports/PDF: one PT → that PT's letterhead, several → the
    group letterhead (`groupName`/`groupPdfHeader`, else "Laporan gabungan: …") + PT list; PDF Author/Subject
    metadata. Audit-log report per PT (rows without PT: Admin/Owner only).
  - **Domain services per PT (MC2-1):** approval inbox / transfer queue / LPJ queue (`lpjQueue`) consolidated with a
    PT ref per item + optional PT filter; Kas balances / flows / period summaries limited to the Kas PTs of the
    caller (`kasAccessIn`, `lockDates`), `POST /period-closings` `company` + `?company=` on reopen / list / balances
    (400 "PT wajib dipilih" when ambiguous); attendance scope per PT (`AttScope.parts`, `narrowAttScope`), recap /
    team today / corrections per employee PT, default schedule of the employee's PT; progress thresholds per project
    PT; display names / PDF "Dibuat Oleh" = employee of the document's PT.
  - **Jobs per active PT (MC2-3):** daily reminders (own hour/toggles, recipients holding the role IN that PT,
    notifications tagged with the PT, `reminder_runs (company_id, run_date)`, one PT's failure logged), reimburse
    auto-close (that PT's days), selfie retention (months/switch per PT, app-wide batch per run).
  - **Media / sync:** office roles read media of their PTs only (all rows only when they hold the role in
    every active PT); sync items are processed under the PT derived from their references — outside the
    `X-Company-Ids` selection → rejected `COMPANY_MISMATCH`; feature flags / own employee of the item's PT.
  - **Role matrix batch save:** `POST /api/v1/company-memberships/batch` — all-or-nothing, Admin of each item's PT
    or group admin, reason → `role_change` audit rows; errors name the item (`errors[].path = items.<i>`).
  - **PT switcher (MC2-4)** (ADR 0016 §5, wireframe `mc/wireframes.md` §1a):
    module-bar control left of the bell (`admin/shell/CompanySwitcher.tsx`): one membership → the PT code as text;
    several → dialog with "Semua PT saya" (tri-state) + one checkbox per PT (code, name, the user's roles there),
    Terapkan / Batal, ≥ 1 PT, ↑/↓/Space/Esc, bottom sheet ≤ 768 px. New `POST /api/v1/me/companies` sets the HttpOnly
    cookie `pk-company-ids` (`__Host-` on https; "Semua PT" = cookie cleared); a PT without membership → 403
    `COMPANY_NOT_ALLOWED` (audited). OpenAPI regenerated.
  - **Master Perusahaan + PT column/filter + employee ↔ PT (MC2-4)** (ADR 0016 §11, wireframes §3–§4): companies form
    in tabs (Identitas / Operasional / Absensi & retensi / Pengingat & notifikasi), list Kode · Nama · Zona waktu ·
    Anggota · Aktif · Dibuat; every list with a PT column (30 per-PT collections, memberships, notifications, audit
    logs) shows the PT short-code chip first and, with more than one PT selected, PT filter chips above the table
    (`admin/company-list.ts`). A chosen PT sits at the top of master forms; employee create requires the PT when
    several PTs are selected; employee / project / cost-center / work-schedule pickers list only the document's PT.
  - **Role matrix "Pengguna & akses PT" (MC2-4)** (`/admin/akses-pt`, wireframe §2): users × PTs, cell = membership
    (role checkboxes, employee of that PT, add / deactivate), Admin of the PT or group admin, reason required, saved
    in ONE atomic batch (a refused batch saves nothing and marks the failing cell), audit `role_change`, warnings for
    a PT without active Direktur / Finance, mobile cards.
  - **PT in custom views + dashboards (MC2-4):** approval inbox, transfer queue, LPJ verification and addendum list
    show a PT column when more than one PT is selected; transfer / settlement forms offer only cash accounts of the
    request's PT (transfer / void actions only for Finance OF that PT); Direktur / Finance / PM dashboard tiles show
    per-PT rows under the combined totals (cash, waiting approvals, budget colours, completeness, transfer queue,
    last closed period); K-09 progress rows carry a PT chip.
  - **Kas + Tutup buku per PT:** balances with per-PT subtotal next to the combined total, PT filter + PT chip in the
    book, edit / void and lock date per row PT; "Kas masuk/keluar" and "Tutup buku" act on ONE PT (PT chooser / tabs
    when the caller holds the role in several), close / reopen always send `company` (a 400 "PT wajib dipilih" is
    explained instead of echoed).
  - **Absensi per PT:** PT filter on "Tim hari ini" and the monthly recap, project / cost-center filters bound to their
    PT (`narrowAttScope`), PT chips on the grid and board (`TeamToday.members[].companyId`), option labels `[PT]`.
  - **Reports view:** audit log uses `auditScope`; letterhead line of the effective PTs above the tables.
  - **Go-live import per PT (MC2-5)** (`apps/web/src/import`, runbook §4.1): sheet `Perusahaan` (target PTs; existing
    ones untouched, new ones created with default numbering + approval rules), `kode_pt` as first column of every
    per-PT sheet (codes unique per PT; empty = the only PT), sheet `AksesPT` (roles per user per PT), validation of
    unknown / inactive PTs and cross-PT references, cut-over per PT (PB start per PT). Template `MC2-5` regenerated,
    new fictional two-PT sample `drms-impor-golive-contoh-fiktif-2pt.xlsx`.
  - **Tests:** `tests/integration/mc2-isolation.int.test.ts` (3 PTs, users with different roles per PT: reports,
    KPI, dashboards, exports/letterhead, queues, Kas, attendance, reminders, retention, media, sync) and the raw-SQL
    company lint `tests/unit/mc2-sql-lint.test.ts`; `tests/integration/mc2-integration.int.test.ts` (2 PTs, different
    roles per PT: switcher cookie × dashboards × queue × closing × role-matrix batch, Absensi filter regression),
    `mc2-import`, unit `mc2-{admin-ui,switcher,role-matrix,import,integration}`. Contract backend ↔ UI:
    `docs/proyekkas/mc/mc2-contract.md`.

- **Seed:** `SEED_DATA_FILE` accepts the old single-company shape (→ company #1 DRMS) and a new
  `{ uoms, banks, companies: [...] }` shape; every PT gets the default sequences and approval rules.

- **Optional self-service 2FA (TOTP)** (branch `feat/2fa-self-service`, ADR 0017, user decision 2026-09-28): each
  user turns 2FA on/off for their OWN account; nobody is forced.
  - Web: page **"Keamanan akun"** (`/admin/keamanan-akun`, avatar menu) with status *2FA aktif / nonaktif / tidak
    diketahui* + authenticator label/date, **Aktifkan 2FA** (Keycloak AIA `kc_action=CONFIGURE_TOTP`) and
    **Nonaktifkan 2FA** with confirmation (AIA `delete_credential:<own id>`), both with `prompt=login`
    (fresh password + code). `POST /auth/account-action` (same-origin, web session only, own credential only,
    6 / 10 min / user); return leg in `/auth/callback` via its own `pk_aia_tx` cookie + state — no second web
    session / `login` row; outcome verified via the Admin API (`listUserCredentials`, OTP metadata only); audit
    `2fa_enabled` / `2fa_disabled` (migration `20260928_090000_two_factor_audit`: two enum values).
  - APK (password mode): after a failed login the optional field **"Kode autentikator (bila 2FA aktif)"** appears
    (6 digits, numeric keyboard, one-time-code autofill); the retry sends `totp`; empty → not sent; never logged.
  - Tests: web unit + integration (Keycloak mocked), `tests/kc/two-factor.kc.test.ts` against a real throwaway
    Keycloak 26.7.4 (`test-env/kc-setup.sh` gains a TEST-ONLY `proyekkas-web` client + user); mobile unit + widget.
  - Docs: ADR 0017; revisions in ADR 0012, `plans/fase1-golive.md` G1-3, ASVS checklist 4.3.1 / G-01 (decided).
- **Public APK download on the DRMS server** (`apps/web`, branch `feat/apk-download-page`; user decision 2026-09-27
  "host on the DRMS server"): `GET /unduh` — a public page in Indonesian (web-starter tokens/fonts, light/dark, 390 px,
  server component, `noindex`): version, size, publish date (WITA), big **Unduh APK** button, install/update steps,
  SHA-256 of the file and of the signing certificate, "Hanya untuk karyawan PT DRMS". `GET|HEAD /unduh/proyekkas.apk`
  — stable URL for Pengaturan → "URL unduh APK": streams the current release with
  `application/vnd.android.package-archive`, `attachment; filename="ProyekKas-<version>.apk"`, `Content-Length`,
  `Cache-Control: no-cache` + `ETag` (= SHA-256, 304 on match), `nosniff`, `X-Robots-Tag`; 404 with an Indonesian
  message while nothing is published. No login; the `/admin` gate and CSP nonce proxy are unchanged (own root layout
  in route group `(public)`, no Payload, no client components).
  - Files live in the existing media volume under `${MEDIA_DIR}/app-release/` with a manifest `latest.json`
    validated strictly by zod (`src/lib/app-release.ts`: fixed file-name pattern, path kept inside the directory,
    size must match → a partial copy is never served).
  - `apps/web/scripts/publish-apk.mjs` (Node built-ins only, shipped in the runner image): copies an APK, computes
    SHA-256, writes `latest.json` atomically, keeps the current + 2 previous versions; refuses a different file under
    an already published version. Runbook `docs/proyekkas/runbooks/rilis-apk.md` (one-shot `docker run --rm` with the
    running web image + media volume; no running container is touched).
  - Tests: `tests/unit/apk-download.test.ts` (manifest schema incl. traversal, route 404/200/HEAD/304, publish
    retention, page markup). No new dependency.
- **Release notes per version ("deskripsi rilis") in three places** (web + APK 0.2.1; user decision 2026-09-28):
  - Source of truth for the APK: `docs/release-notes/apk/<X.Y.Z>.md` — short Indonesian bullets for field employees
    (0.2.0 and 0.2.1 written; format rules in `docs/release-notes/README.md`). Must exist before the tag is pushed.
  - **`/unduh`**: `scripts/publish-apk.mjs --notes <file.md>` stores the bullets as plain text `notes: string[]` in
    `latest.json` (markdown bullets, continuation lines, title/blank lines ignored, inline markup reduced to text;
    1–15 bullets × ≤ 300 chars, no control characters; a bad file fails before anything is copied). The zod manifest
    schema accepts the optional field (older manifests stay valid); the page shows "Yang baru di versi X" as escaped
    text. Retention unchanged. Runbook `rilis-apk.md` passes `--notes /in/notes.md`.
  - **In the APK**: `GET /api/v1/app/config` gains optional `releaseNotes: string[]` — the manifest notes when the
    published APK's version equals "Versi APK terbaru" (else omitted; cached with the settings for 60 s). OpenAPI
    regenerated. APK: tolerant parsing (`AppConfig.releaseNotes`, ≤ 15 × ≤ 300), the home line "Versi baru tersedia"
    became a tappable banner → sheet with "Yang baru di versi X", install hint and the download link (copy button as
    before); the blocking "Perbarui aplikasi" screen shows the same list and scrolls when long. New ARB strings only.
  - **GitHub Releases**: `mobile.yml` job `release-prod` fails before building when the notes file for the tag version
    is missing, and after the APKs are verified creates/updates the Release of `mobile-vX.Y.Z` (body = notes file +
    certificate SHA-256 + CHANGELOG link; assets = the three ABI APKs + `SHA256SUMS.txt`; job-level
    `contents: write`, workflow default stays read). New workflow `release-notes.yml`: tag `vX.Y.Z` → Release with the
    `## [X.Y.Z]` section of this file (fails when the section is missing).
  - Tests: `tests/unit/apk-download.test.ts` (schema limits, markdown parsing, publish with/without notes,
    `releaseNotesFor`, page escaping), `tests/integration/f4-mobile.int.test.ts` (app config `releaseNotes`),
    APK `test/unit/misc_test.dart` + `test/widget/release_notes_test.dart`. No new dependency.

### Changed
- **Release APK on self-hosted**: release builds (R8 + obfuscation) get Gradle heap 2.5 GiB / metaspace 512 MiB
  (`GRADLE_OPTS_RELEASE`; debug keeps 1.5 GiB) — `assembleStagingRelease` died after ~8 min with exit 1 and no kernel
  OOM at 1.5–2 GiB. `tool/build_with_retry.sh` now prints a failure excerpt (FAILURE / What went wrong /
  OutOfMemoryError / error:) and can keep the full log (`BUILD_LOG_KEEP`); the staging release log is uploaded on
  failure (3 days).
- **Trivy cache on self-hosted** uses the runner's persistent `TRIVY_CACHE_DIR` instead of `_temp` (root-owned files
  there could not be cleaned by the runner); GitHub-hosted unchanged.
- **Self-hosted image publish hang (plan 12 R10)**: buildkitd (docker-container) now runs with
  `--oci-worker-no-process-sandbox` on self-hosted — RUN steps in a nested pid namespace hung forever under
  sysbox-fs 0.7.1 (leaked unreaped helper). GitHub-hosted keeps the default buildkitd flags.
- **Self-hosted runner fixes (infra plan 12 R10)**: APK jobs on self-hosted use Gradle heap 1.5 GiB, metaspace 384 MiB,
  1 worker (F1: the 4 GiB cgroup OOM-killed Gradle during the staging APK build); publishing image builds always use
  buildx `docker-container` because the `docker` driver cannot push-by-digest (F2); local-only builds keep `docker`.
- **CI runner switchable + fewer runs** (GitHub Free minutes exhausted 2026-09-28; owner chose a self-hosted runner,
  infra plan 12): every job's `runs-on` reads repo variable `CI_RUNS_ON` (deploy-prod: `DEPLOY_RUNS_ON`) as JSON, e.g.
  `["self-hosted","linux","x64","drms"]`; unset = `ubuntu-24.04` as before, so switching back needs no code change.
  `ci` / `mobile` no longer run on pushes to `feat/**`, `fix/**` (they run on the pull request; a push + PR used to
  run everything twice). Staging APK artifacts kept 7 days (was 30), coverage 3 days (was 14) to stay under 500 MB.
  **Self-hosted-ready (plan 12 R8):** on `runner.environment == 'self-hosted'` no GitHub cache (`actions/cache`,
  `setup-node` npm cache) — the runner image's persistent `npm_config_cache` / `PUB_CACHE` / `GRADLE_USER_HOME` are
  used; the Flutter tarball is kept in `/cache/flutter` (`FLUTTER_TARBALL_CACHE`) and sha256-checked on every use
  (`apps/mobile/tool/ci_install_flutter.sh`); buildx `docker` driver without `type=gha` (GitHub-hosted keeps
  `type=gha`); release tags `v*` build images with `no-cache`, `release-prod` APK with job-local pub/Gradle dirs;
  APK jobs get `GRADLE_OPTS` for 4 GiB (no daemon, 2 workers, `-Xmx2g`, Kotlin in-process); mobile coverage
  artifact on GitHub-hosted only (job summary line everywhere); staging release APK kept 3 days; timeouts raised
  for 2 vCPU (verify/security 30, integration 40, mobile verify 45, image/APK 75 min); `ci` image job reads the
  version with `jq` (no `node` on the runner PATH).
- **`company-settings` global = app-wide only** (APK gate, device image targets, offline max age, selfie batch
  size, new group letterhead `groupName`/`groupLogo`/`groupPdfHeader`); editable by the group admin only. Per-PT
  settings (thresholds, reminders, sync flags, default schedule, retention) live on the company record.
- **Login / Keycloak (ADR 0016 §2):** per-PT roles are DB-only; the web callback no longer syncs realm roles into
  `users.roles` (removed), the APK bearer no longer intersects token roles; a login needs the realm role `pk-user` —
  **MC1 transition:** any legacy `pk-*` realm role is accepted as the same login marker until the infra change
  assigns `pk-user`. User create in the admin assigns only `pk-user` in Keycloak (fallback `pk-staff` marker while
  the realm lacks `pk-user`); role edits never call Keycloak.

### Security
- **MC2 per-PT fixes of MC1 leftovers:** addendum decisions used the union of the caller's roles over the selected
  PTs (Finance of PT A + PM of PT B could decide a PT B addendum) → roles IN the addendum's PT; manual cash
  posting / edit / void checked only "Finance in any PT" → Finance of the account's / entry's PT (else 400/404);
  internal PDF copy, full bank number in the request DTO, cash rows in the request history, device revoke,
  attendance correction and PM on-behalf check-in now check the role in the document's PT.
- **MC2 integration:** the Absensi recap built a company-less team scope from the query string — an office user of
  PT A filtering by a project id of PT B saw B's attendance → `narrowAttScope` (filters stay inside each PT). The
  Finance queues (transfer queue, LPJ verification, `GET /api/v1/transfer-queue`) listed the team requests of a PT
  where the caller is only PM (with the bank snapshot) → limited to the PTs where the caller is Finance / Direktur.

### Removed
- `users.roles` and `users.employee` (replaced by `company-memberships`).

### Fixed
- **Mobile token parity** (`apps/mobile/lib/app/theme/tokens.dart`): the web token `primarySoft` added in 0.4.2
  (loader dots) was missing on the Flutter side, so `test/unit/theme_tokens_test.dart` failed (22 ≠ 23 keys) and
  the mobile workflow was red on develop. `PkTokens.primarySoft` added (light `#BFDBFE`, dark `#1E40AF`).
- **CI semgrep red on develop** (`admin/views/AksesPt.tsx`, MC2 role matrix): five Local API reads passed their
  access arguments through a spread (`...read`), which rule `payload-local-api-implicit-override-access` cannot see.
  The arguments `user, overrideAccess: false, req, depth: 0` are now written literally in each call (same behaviour).

## [0.4.2] - 2026-09-28

### Added
- **Admin loader** (`apps/web`, branch `feat/admin-loading-dots`): five pulsing dots (Uiverse.io
  "thin-lionfish-5" by adamgiebl, MIT © 2023 Uiverse.io — provenance + licence in ADR 0014 addendum and
  `src/admin/loading/_loading-dots.scss`) on every **module navigation** (launcher, module menu, breadcrumbs, links
  inside views, filter forms, Payload redirects) and during every **create / update / delete** (Payload Save /
  Publish / Delete / bulk actions / Duplicate and every custom-view `/api/v1` POST/PATCH/DELETE). One client
  provider (`admin.components.providers` → `src/admin/loading/LoadingProvider.tsx`): same-origin link clicks +
  `useRouteTransition` for navigation, a single `window.fetch` wrapper counting unsafe `/api/` requests for
  mutations (exclusions: autosave, preferences, document locks, access probes, auth/session, notification
  read-marks, POST-as-GET queries, server actions). Shown after 180 ms, ≥ 300 ms, never > 15 s; navigation overlay
  keeps the module bar visible, the save overlay blocks pointer input (no double submit). Colours follow the admin
  theme (light pale primary → primary, dark primary → primaryHover; new token `primarySoft`); reduced motion =
  static dots; `role="status"` "Memuat…" / "Menyimpan…". Unit tests `tests/unit/admin-loading.test.ts` + theme
  contrast checks.

### Fixed
- **Flaky F3 KPI integration test across midnight** (`tests/integration/f3-kpi-reconciliation.int.test.ts`): the
  suite runs ~10 min and captured "today" once in `beforeAll`; a CI run started 23:57 WITA crossed midnight, so the
  code's today (company TZ) moved on while the expectations did not (K-01, K-02, K-11, K-12 off by one day). "today"
  and the current month are now re-read before every test. Test-only change, no app code touched.

## [0.4.1] - 2026-09-27

### Added
- **MC0 — multi-company analysis (docs only, branch `docs/mc0-multi-company`; user decision 2026-09-27):** several PTs
  of the client group in one ProyekKas, one login per person, per-PT role matrix, full consolidation, mutations always
  within one PT, before go-live.
  - ADR 0016 `docs/proyekkas/adr/0016-multi-company.md` (proposed; design approved by the user): `companies` master
    (identity + operational settings; `company-settings` keeps app-wide values), `company-memberships` as the source of
    per-PT roles (Keycloak keeps identity + realm role `pk-user`), `company_id NOT NULL` + composite uniques + per-PT
    numbering counters and period lock + cross-PT DB triggers, access context = selected PTs ∩ memberships
    (`X-Company-Ids`, cookie), per-PT reports/jobs/APK; alternatives (deployment per PT, Keycloak Organizations, RLS),
    security model, staging backfill to company #1 DRMS.
  - Dated "Revisi 2026-09-27 (ADR 0016)" sections in ADR 0003, 0005, 0007, 0009, 0010, 0013.
  - `requirements-v1.2.md` (delta on v1.1: shared vs per-PT data, per-PT role matrix, consolidation rules per screen,
    letterheads, numbering examples, US-MC-01…19); client questions Q-51…Q-61 (`open-questions-client.md` §L);
    phase **MC** (MC0–MC4, 60–88 pd, go-live ≈ 4–6 weeks later) and risk #8 in `phase-plan.md`; traceability rows;
    wireframes `docs/proyekkas/mc/wireframes.md`; code change inventory `docs/proyekkas/mc/impact-inventory.md`.

### Changed
- **Admin breadcrumbs** (`apps/web`): Payload's AppHeader row under the module bar (a lone graphics-Icon "D" home
  crumb, and an empty row on pages without crumbs) is replaced by a slim **breadcrumb line** under the bar
  (`ModuleBar` → `PageCrumbs`, pure derivation in `src/admin/shell/crumbs.ts`): home = the current module (icon +
  name → its first menu item; "Semua modul" outside every module), then Payload's steps, e.g. **Keuangan › Pengajuan
  biaya › PB-2026-0001**; last crumb `aria-current="page"`. Shown on collection list/edit, globals and account; custom
  views and the launcher have no crumbs → no row, no gap. Steps left over from the previous page (custom views set
  none) are ignored; before Payload sets them, the module menu labels are used (no jump after hydration).
- **APK 0.2.0 — tampilan selaras web admin** (`apps/mobile`, branch `feat/mobile-ui-refresh`; ADR 0015 accepted,
  plan `docs/proyekkas/plans/mobile-ui-refresh.md`). Look only — behaviour, API, sync and DB unchanged:
  - Theme built from the web tokens (`apps/web/src/theme/tokens.ts` → `lib/app/theme/tokens.dart`): primary #2563EB,
    accent #EA580C, slate surfaces, radius 14, surface-style app bar, **light and dark**; field sizes kept (52 dp
    buttons, ≥ 48 dp targets). `StatusColors` replaced by the `PkColors` theme extension (`context.pk`, ok/warn/bad +
    dark-mode text variants). New **Profil → Tampilan** (Sistem / Terang / Gelap), stored on the phone.
  - Space Grotesk + DM Sans bundled as assets (SIL OFL 1.1, from google/fonts, licence texts in the licence page).
  - Iconsax glyphs identical to the web (path data from `icons.ts`, drawn by an in-house SVG path parser; no icon
    package).
  - Home = module launcher: greeting + role, gradient tiles (web module gradients, count badges, staggered entrance,
    off with reduced motion) replacing the big-button list, shown above the KPI section so no role has to scroll to
    its menu; all visibility rules, routes and test keys kept. Bottom
    navigation with Iconsax Linear/Bulk icons on a primary-tint pill. Login/splash in the new palette.
  - Hard-coded colours on the other screens moved to theme tokens (status chips, timeline, attendance distance/recap/
    team, tab bars made for the old solid app bar).
  - Request detail: the "Dampak anggaran > 85%" warning uses a warning icon instead of a ⚠ text glyph (not in DM Sans).
  - Tests: token drift + WCAG contrast (`theme_tokens_test.dart`), glyph drift + parser (`iconsax_test.dart`),
    Tampilan/launcher (`ui_refresh_test.dart`); widget tests now run with the real theme. Preview screenshots without
    a device: `test_preview/screens_preview_test.dart` (manual, not in CI). No new package.

### Fixed
- **No horizontal page scroll at 390 px** (audit of every custom view, launcher, collection list/edit, globals and
  account × 5 roles): Antrian Transfer (−253 px) becomes stacked cards per request on screens ≤ 640 px (the transfer
  form stays inside its card); the other custom-view tables (Verifikasi LPJ −28 px, Persetujuan, Notifikasi, transfer
  void list, Riwayat, nota tables in the edit view) scroll inside their own focusable box with edge shadows
  (`TableScroll`); the account view (−60 px, Payload's settings divider wider than the page) is contained.

## [0.4.0] - 2026-09-27

### Changed
- **Admin navigation "gaya Odoo"** (`apps/web`, ADR 0014 accepted):
  - `/admin` is now a **module launcher**: greeting (name + role) and a tile per visible module — Iconsax Bulk glyph
    in white on a module gradient, badge = summed pending counts, staggered entrance / hover lift (motion), off with
    `prefers-reduced-motion`. 11 modules: Dashboard, Persetujuan, Proyek, Keuangan, Absensi, Laporan, Pengguna & Akses,
    Master Data, Media, Pengaturan, Sistem (`src/admin/modules/registry.ts`, single source of truth).
  - The left sidebar is replaced by a **sticky top module bar** (`admin.components.Nav` →
    `src/admin/shell/ModuleNav.tsx` + `ModuleBar.tsx`): ⊞ launcher, current module, horizontal menu with ▾ dropdowns
    and an animated active pill, notification bell (moved from `beforeNavLinks`) and an avatar menu (Profil & tanda
    tangan, light/dark theme, logout). Narrow screens (≤ 768 px or a menu that does not fit) get a ☰ sheet; keyboard:
    ←/→/Home/End, ↓ opens, Esc closes, focus rings, `aria-current`.
  - The role dashboard ("Beranda") moved to its own module at **`/admin/dashboard`** (same tabs `?peran=`/`bulan=`).
  - Visibility unchanged in substance: Payload read permission ∧ `visibleEntities` (F2c staff whitelist) ∧ the role
    rules formerly in `F2NavLinks.tsx` (retired; `beforeNavLinks`/`afterNavLinks` removed). Badge counts unchanged
    (S3e S-07 transfer queue definition).

### Added
- Module gradient tokens (light + dark) in `src/theme/tokens.ts`; white glyph ≥ 3:1 on every stop (theme test).
- Dependency `motion` 13.4.0 (MIT, exact pin). Iconsax glyphs are inline SVG (`src/admin/modules/icons.ts`) — the
  `iconsax-reactjs`/`iconsax-react` packages were rejected (last release 2025-04 / 2022-05, §0.10 maintenance rule).
- Tests: `tests/unit/admin-modules.test.ts` (every collection/global in exactly one module, per-role tiles with the
  real config, active-module resolution, bar SSR); nav tests (f2d, e2, s3e) target the registry; launcher
  integration test with the real access layer.

## [0.3.0] - 2026-09-27

Fase 1 go-live build (web + API; images `ghcr.io/bctech-adm/proyekkas-{web,migrate}:0.3.0`). Covers F3 dashboards,
reports and exports, the F4 APK backend (`/api/v1/sync/batch`, devices, masters) and fase1-golive epics E1–E11:
approval flow Direktur → Finance (ADR 0013), Finance cash UI (E2), project stages/progress + Addendum RAB (E4/E5),
attendance + selfie retention (E6), scheduled reminders (E7), E9 hardening (signed media URLs, settlement reversal,
coverage gate, upload resize queue), E10 GHCR images + prod compose, E11 Excel import/cut-over, and the S3 Fase 1 UAT
gap fixes. The APK (`apps/mobile`) changes listed here ship on their own `mobile-vX.Y.Z` tags (pubspec version),
not with this web release.

### Added
- **E9 follow-ups — upload resize queue, B-1, B-2** (`apps/web`, branch `fix/e9-upload-resize-queue`; QA report
  `docs/proyekkas/qa/s3-e9-qa-report.md` §7, user decision 2026-09-27):
  - P-1: process-wide FIFO image queue (`src/lib/image-queue.ts`): at most `IMAGE_RESIZE_CONCURRENCY` (default 2)
    sharp jobs at once, `IMAGE_RESIZE_MAX_QUEUE` (default 20) waiting, 30 s max wait; `POST /api/v1/media/{kind}`
    queues the whole upload (DB transaction opened only after the slot is granted) and answers 503 + `Retry-After: 5`
    (`code: UPLOAD_BUSY`) when full; generic REST uploads are gated per sharp pipeline and refused (503) while the
    queue is saturated. `sharp.cache(false)`, `sharp.concurrency(1)` kept. Outputs unchanged. Queue wait logged at
    debug (`image queue slot`). AC E9: uploads p95 < 5 s, everything else < 2 s.
  - B-1 (ASVS G-21): generic REST create/update with a non-object body (form/text, multipart without `_payload`, JSON
    array/null) → 400 with a clear message instead of a 500 from the collection hooks (`src/lib/body-guard.ts`, first
    `beforeOperation` hook of every collection and the `company-settings` global).
  - B-2 (ASVS G-22): the E11 import no longer tries Keycloak per revoked device (audit `keycloak_skipped`); the report
    prints ONE `PERINGATAN KEYCLOAK` block listing users to disable + log out (or re-enable) and the CLI writes
    `…-keycloak-tindak-lanjut.csv`; Keycloak step (`kc_*`, realm drms) added to the import and cabut-perangkat runbooks.
- **S3 track E — Fase 1 UAT gap fixes** (`apps/web`, branch `feat/s3e-uat-gap-fixes`; S-ids of
  `docs/proyekkas/uat/fase1/README.md`):
  - S-01 PM home: "Pengajuan tim menunggu keputusan" (Direktur / Finance) instead of the empty "Diketahui saya" card;
    `GET /api/v1/dashboard/pm` adds `teamWaiting`.
  - S-03 web bank account picker filtered to the requesters' active accounts; empty = first requester's default.
  - S-04 in-app notifications on submit / withdraw / created on behalf; optional approval email to the deciding
    Direktur/Finance (sendEmail queue); web notification bell + `/admin/notifikasi`. Settings
    `notifyRequesterStatusEnabled` (on), `approvalEmailEnabled` (off, upgrade copies `reminderEmailEnabled`).
  - S-05 Persetujuan + request panel show lines, receipt photos and per-line flags to deciders; `approvals.openFlags`
    = open flags of both levels.
  - S-06 reject/revision reason: client min length, server detail "Alasan wajib diisi, minimal 3 karakter.".
  - S-07 Antrian Transfer badge = page count. S-08 LPJ "Tandai flag diperiksa". S-29 "Anda juga yang menyetujui".
  - S-19 default geofence radius for points without radius (server + masters). S-23 Admin attendance report export.
  - S-24 receipts ≤ 1600 px, logo ≤ 1024 px, 50 MP / 2 MB caps. S-26 resubmit copies receipts.
  - Migration `20260926_141606_s3e_uat_gap_fixes` (additive, `company_settings`).
- **S3 web A — E9 hardening F6** (`apps/web`, fase1-golive §E9; branch `feat/s3a-e9-hardening`):
  - Signed, time-limited media URLs (ADR 0004 §4b): `GET /api/v1/media/{collection}/{id}/signed-url` mints a 5-minute
    HMAC-SHA256 URL of the file endpoint (keys `MEDIA_URL_KEYS[_FILE]` with rotation, default derived from
    `PAYLOAD_SECRET`); expired/invalid → 403, valid signature but the user may not read the file → 403 +
    `access_denied`. Bearer/cookie downloads unchanged (APK compatible). Selfies are served by the media file
    endpoint too (`selfies`), with `view_sensitive` for other people's selfies.
  - `/admin/*` without a session cookie → real **302** to `/admin/login?redirect=…` (Next proxy) instead of the 200 shell.
  - Settlement reversal: `POST /api/v1/expense-requests/{id}/settle/reverse {reason}` (Finance) voids the refund KM /
    shortfall transfer + KK, LPJ back to "Terverifikasi", request "LPJ Terverifikasi", balances restored, audited;
    closed period → 409; button "Batalkan penyelesaian LPJ" on the request detail. Migration
    `20260926_131136_s3a_e9_hardening` (4 additive columns on `settlements`, guard update).
  - 403 before 409 (UAT 5.2): authorization failures are answered before state conflicts (expense flow, addendum).
  - `login_failed` audit for logins refused on the ProyekKas side (OIDC callback failure, unknown/inactive account);
    Keycloak event log = source of truth for wrong passwords (ADR 0003 §7). Hash chain deferred (ADR 0006 §5).
  - CI: unit-test coverage gate (`npm run test:coverage`, thresholds in `apps/web/vitest.config.ts`).
  - Docs: ASVS L1 self-checklist `docs/proyekkas/security/asvs-l1-checklist.md`.
- **S3 track C — E10 images on GHCR + prod compose** (branch `feat/s3c-e10-ghcr-ci`): `ci.yml` job `image` builds web +
  migrate on GitHub runners (buildx, GHA cache), Trivy gate (fail on fixable CRITICAL, HIGH/CRITICAL reported in the job
  summary), pushes `ghcr.io/bctech-adm/proyekkas-{web,migrate}` with OCI labels, SBOM and provenance (`develop` →
  `sha-<sha7>` + `<ver>-stg-<sha7>`, tag `vX.Y.Z` → `X.Y.Z`, `ci/ghcr-*` → `test-<sha7>`); `deploy/prod/docker-compose.yml`
  (identical to the infra prep except comments); inert, approval-gated `deploy-prod.yml` (environment `infra-deploy`);
  runbook `docs/proyekkas/runbooks/ci-ghcr.md`.
- **S3 web B — E11 data go-live: template Excel + impor idempoten + cut-over** (`apps/web`, fase1-golive §E11,
  Q-17/19/20/22/23/36/37/40; branch `feat/s3b-e11-data-import`):
  - Workbook `docs/proyekkas/templates/drms-impor-golive-template.xlsx` (sheet Petunjuk + Pengaturan, Bank, Satuan,
    Kategori, Karyawan, Pengguna, Rekening, PusatBiaya, Project, Tahapan, RAB, Kendaraan, Penugasan, AkunKas; header
    check, dropdowns, number ranges, input hints) and a FICTIONAL sample, both generated reproducibly by
    `npm run gen:import-template` (`check:import-template` guards drift).
  - Import CLI `payload run src/import/cli.ts -- (--dry-run|--commit) --file … [--kc-map …] [--out …]` (migrate image,
    APP role): errors per sheet/row/column; dry-run executes every write in one transaction that is always rolled
    back; commit = one transaction per master, upsert on natural keys (second run = no-op), audit action `import`.
    Keycloak is not called: users without a `username → id` mapping are skipped and exported
    (`…-keycloak-users.json/csv`, no passwords) for the infra Lead.
  - Cut-over: opening balance + `openingBalanceDate` = go-live date, month before go-live closed, PB `startAt` from the
    workbook (229, Q-17; counter raised upward only, audited).
  - Opening balance lock after the first close on/after the opening month (hook 409 + DB trigger); no cash entry
    before an account's opening date (ADR 0005 "As implemented (S3b)"). Runbook `docs/proyekkas/runbooks/import-data-golive.md`.
  - Migration `20260926_133934_s3b_data_import` (additive: enum value `import`, `cash_accounts.opening_balance_date`,
    CHECK + two triggers).
- **APK S2 — laporan progress (E4) + absensi lengkap (E6)** (`apps/mobile`, branch
  `feat/mobile-s2-progress-attendance`). Progress: offline-first reports (project/stage, % never below the stage %,
  ≤ 5 rear-camera photos compressed on the phone, `progress_report.draft_upsert` or online POST/PATCH when
  `syncProgressReports` is off), list/detail with photo thumbs, edit ≤ 24 h with reason, conflict screen (server vs
  phone), K-09 "progress fisik vs anggaran" cards (PM/Direktur home + tab). Absensi: check-in/out at a project or a
  pusat biaya with distance feedback, monthly recap calendar, "Tim hari ini", PM on-behalf (reason, front/back
  camera, offline), corrections (online). Local DB schema v2 (`local_progress_reports`, additive). Fix: saving an
  expense draft no longer deletes queued selfies/progress photos. E5 Addendum RAB on the APK: section in the
  Direktur/Finance inbox, detail with RAB impact + timeline + server `allowedActions` (Setujui Direktur / Finance,
  Tolak with reason), PM create/submit/cancel (online, Idempotency-Key).
- **S2 web A — E4 progress web + E5 Addendum RAB** (`apps/web`, fase1-golive §E4/§E5, US-12/18/29/30/31; branch
  `feat/s2a-progress-web-addendum`):
  - Admin views `/admin/progress` (K-09 progress fisik vs % anggaran per project, KPI tiles, table view),
    `/admin/progress/project/{id}` (stage bars, stage editor with live 100 % validation — Direktur add/deactivate,
    PM rename/reorder/re-weight, reason on re-weight — timeline per stage, addenda of the project),
    `/admin/progress/laporan` (filters project/stage/date) and `/admin/progress/laporan/{id}` (photo gallery). Beranda
    Direktur/Finance/PM: card "Progress fisik vs anggaran" (US-12) and "Progress fisik" column; PM "Lapangan" card shows
    the latest progress reports. Report `anggaran-project`: "Progress fisik" + K-09 status columns (was "F5").
  - Addendum RAB (T12): collection `budget-addenda` (`ADD/YYMM/####`), `/api/v1/budget-addenda` (list, inbox, detail,
    create/patch/submit/cancel for the PM of the team, acknowledge = Direktur, approve = Finance, reject with reason;
    Idempotency-Key, APK-ready). Approval through `approval-rules` docType `budget_addendum` (ADR 0013 engine);
    decisions are `approvals` rows (docType `budget_addendum`); final approval raises `projects.budget` = current RAB +
    addition in the same transaction (audit before → after); in-app notifications. Web `/admin/addendum`,
    `/admin/addendum/baru`, `/admin/addendum/detail/{id}`; "Persetujuan" lists addenda too. Nav: Progress project,
    Laporan progress, Addendum RAB.
  - Migration `20260926_114555_e5_budget_addenda` (additive: new table + guards, `approvals.addendum_id`,
    `approvals.request_id` nullable with an owner CHECK per docType, G1 trigger for addenda, default rule
    "Default Addendum RAB — Direktur lalu Finance").
- **S2 web B — E6 absensi web + retensi selfie + E7 pengingat terjadwal** (`apps/web`, fase1-golive §E6/§E7, US-09/11/13/14/15,
  M12/M13, Q-30/33/40; branch `feat/s2b-attendance-web-reminders`):
  - Admin views `/admin/absensi` "Tim hari ini" (belum absen / hadir / selesai board, times, project/pusat biaya, late,
    diabsenkan PM, filters date/project/cost center), `/admin/absensi/rekap` (per employee: month calendar with
    status legend, KPI tiles, day detail, T10 correction dialog before → after with mandatory reason, correction history,
    audited selfie viewer; without employee: team grid employees × days + totals; Staff: own recap), `/admin/absensi/jadwal`
    (company default schedule, schedule list, employee schedule assignment, holidays per year + add, cost-center geofence
    lat/lng/radius editor with an OpenStreetMap link — no embedded map). Nav "Absensi" (PM/Finance/Direktur/Admin),
    "Rekap absensi saya" (Staff). Beranda PM: widget "Kehadiran tim hari ini" replaces the F5 placeholder. Laporan
    absensi rows link to the employee recap; stale "Rekap absensi (F5)" row removed from `/admin/laporan`.
  - Retensi selfie (Q-33): job `selfieRetention` deletes selfie FILES older than `selfieRetentionMonths` when
    `company-settings.selfieRetentionDeleteEnabled` is on (**default OFF** = dry run), at most `selfieRetentionBatch`
    (default 200) per night, oldest first, face reference photos never; media row kept as tombstone
    (`media_selfies.removed_at`, immutable once set) because attendances are append-only; one `retention_purge` audit row
    per run (counts only). Attendance rows untouched; selfie endpoint answers 404.
  - Pengingat terjadwal (E7, M12/US-11): job `dailyReminders` (hourly tick, one run per business day at/after
    `reminderHour`, company TZ) — laporan progress terlambat → PM + Direktur; uang muka tanpa nota/LPJ > `lpjDueDays` →
    pemohon + Finance; revisi nota/LPJ menggantung ≥ `reminderRevisionDays` → pemohon; komitmen anggaran ≥ ambang
    kuning/merah → Direktur + Finance + PM (once per threshold per project). Exactly one notification per recipient,
    rule, subject and day (`reminder_deliveries`, append-only); inactive users and archived projects excluded; in-app
    always, email via the `sendEmail` queue when `reminderEmailEnabled` (**default OFF**). Settings per rule in
    company-settings ("Pengingat terjadwal (E7)").
  - Migration `20260926_104606_s2b_attendance_reminders` (additive: nullable/defaulted columns, 2 new tables, enum values).
- **E6 backend — absensi lengkap** (`apps/web`, fase1-golive §E6, US-01/02/09/13/14/15, Q-30/33/40; branch
  `feat/e6-attendance-backend`). Web/APK screens follow in S2; `syncAttendanceEnabled` stays **off** by default.
  - Cost-center geofence (Q-40): `cost-centers` lat/lng/radius (optional); sync check-in/out takes `project_id` XOR
    `cost_center_id`; one check-in/out per employee/location/day (DB unique index for both).
  - "Diabsenkan oleh PM" (US-14): sync item `attendance.on_behalf` (was `unsupported`) — PM only, team location,
    employee assigned that day, not the PM themself, reason required, GPS + photo from the PM phone; stored with
    `source = pm`, `recordedBy`, `onBehalfReason` (DB CHECK); employees without an account supported (`user` empty).
  - Koreksi absensi T10 (US-15): `POST /api/v1/attendance/{id}/correct` (team PM or Admin, never own attendance,
    reason ≥ 3, same local date, order check-in ≤ check-out, not in the future, Idempotency-Key). New append-only
    collection `attendance-corrections` (DB triggers + no UPDATE/DELETE for the app role); the newest correction is
    the effective time everywhere; audit `update attendanceTime` old → new with the reason; denied attempts audited.
  - Jadwal/libur/terlambat (Q-30): `work-schedules.workDays` (Mon–Sat default), `employees.workSchedule`,
    `company-settings.defaultWorkSchedule`; schedule snapshot on each attendance; late = minutes after start when
    above the tolerance, early leave, work minutes, holiday/off-day attendance flagged (never late).
  - Rekap bulanan (US-09) `GET /api/v1/attendance/me?month=`, recap of an employee `GET /api/v1/attendance/recap`
    (PM team / Direktur / Finance / Admin), tim hari ini (US-13) `GET /api/v1/attendance/team-today`, selfie viewer
    `GET /api/v1/attendance/{id}/selfie` (Q-33 roles, audited `view_sensitive`).
  - Laporan absensi (M13): report `absensi` (CSV/XLSX) on `/admin/laporan` and `/api/v1/reports/absensi`.
  - Retensi selfie (Q-33): `company-settings.selfieRetentionMonths` (default 12) + daily job `selfieRetention`
    (**dry run**: counts candidates, never face reference photos; file deletion = S2).
  - Masters for the APK: cost centers with lat/lng/radius, work schedules with `workDays`.
  - Migration `20260926_091848_e6_attendance` (additive; staging-safe: no existing row rewritten).
- **E4 backend — project stages + progress reports** (`apps/web`, fase1-golive §E4, T11, US-10/11/12/29/31; branch
  `feat/e4-progress-backend`; web views = Sprint S2, APK screens = E4-APK):
  - Collection `progress-reports` (`LP/YYMM/####`; project, stage, % before → after, project % before → after, pekerjaan,
    kendala, pelapor, ≤ 5 photos in `media-progress-photos`, offline/time-trust flags). Written only by the domain
    service; HTTP collection writes closed. Read: PM team, Direktur/Finance all (Staff/Admin none).
  - API: `POST/GET /api/v1/progress-reports`, `GET/PATCH /api/v1/progress-reports/{id}` (edit ≤ 24 h by the reporter,
    reason required), `GET/PUT /api/v1/projects/{id}/stages` (stage editor: whole set = 100 %, G11), `GET
    /api/v1/projects/progress` (K-09 progress fisik vs anggaran), media kind/file collection `progress-photos`,
    `/me` capability `progressReportCreate`, masters `projects.progressPct`, `project-stages.active`. Problem responses
    of E4 carry a `code` (e.g. `WEIGHTS_INCOMPLETE`, `PROGRESS_DECREASED`, `PHOTO_LIMIT`). OpenAPI regenerated.
  - Project physical progress `projects.progressPct` = Σ(weight × stage %) / 100, recalculated in the same transaction
    as the report / stage edit, audited before → after; stage/project % cannot be written directly (403 + DB guard).
  - Sync: `progress_report.draft_upsert` is processed (was `unsupported`): create or edit (base_rev, conflict +
    `server_report`), idempotent by `client_uuid`; `GET /app/config` `features.syncProgressReports` from the new
    company setting `syncProgressReportsEnabled` (default on).
  - E7 hook points: `lateProgressProjects()` / `notifyLateProgressReport()` (no schedule).
  - Migration `20260926_095319_e4_progress_reports` (additive: new table + 4 defaulted/nullable columns; DB guards:
    progress_pct guard, report 24 h window, no delete, immutable identity columns, ≤ 5 photos per report).
- **E1 APK + E3 APK parity** (`apps/mobile`, fase1-golive §E1 AC-10, §E3-b/c/d; branch `feat/mobile-e1-e3`):
  - Approval inbox/tab from `GET /api/v1/me` `capabilities.approvalInbox` (Direktur + Finance, ADR 0013), no longer
    `owner || pm`; PM gets a read-only **team monitor** (home KPIs from `/dashboard/pm`, "Tim" tab = `scope=team`).
    Inbox cards show the server `stepLabel`; the Direktur's "Diketahui" is a "Setujui (Diketahui)" decision;
    403 on a decision shows why and reloads. Timeline: "Diketahui (Direktur)", "Approval (Finance)", skipped
    positions "(tidak berlaku — pemohon)"; pre-E1 snapshots keep the PM label. "Owner" → "Direktur" in the app.
  - Requester parity with the web: "Tarik kembali ke Draft" / "Batalkan pengajuan" (reason ≥ 3), "Ajukan ulang"
    (rejected → new draft), "Ubah & ajukan di HP" imports a server draft into the offline editor (server receipts
    read-only, `draft_upsert` identifies it by `request_id`); "Riwayat" screen (`GET …/history`, web labels).
  - Home KPI cards for Direktur/Finance (`/dashboard/owner|finance`, same data as the web Beranda) with sparklines,
    a budget meter and a tappable monthly cash-flow chart.
  - Background sync with WorkManager (`workmanager` 0.10.10): periodic 15 min + one-off after an unfinished run;
    encrypted DB + token store opened in the task isolate; one token owner per process.
  - Unknown routes show an Indonesian error page; release builds show readable text instead of a grey box
    (salvaged from `fix/mobile-login-redirect`).
  - CI: job `release-prod` (main / tag `mobile-vX.Y.Z`, environment `android-release-prod` approval, production key
    from environment secrets, SHA-256 printed, `apksigner` check, secret scan). No key is created by CI.
  - `config/prod.json` login mode = `password` (K3 / G1-3; needs Direct Access Grants in realm `drms`, E10).
- **E2 — web Finance UI for cash** (`apps/web`, fase1-golive §E2, US-23/US-24, ADR 0005; branch
  `feat/e2-finance-cash-ui`): admin views `/admin/kas` (buku kas with filters akun/periode/project/pusat biaya/arah/
  status, saldo per akun tiles, void rows kept and linked to their jurnal balik), `/admin/kas/baru` (kas masuk/keluar:
  tanggal, akun, sumber/kategori, project XOR pusat biaya, nominal, keterangan, bukti upload, kendaraan for kas keluar),
  `/admin/kas/:id/ubah` (edit before period close, reason required), `/admin/tutup-buku` (close a past month; re-open =
  Direktur = role `pk-owner`, G1-1). Void (cash entry) and Void transfer (Antrian Transfer + request detail) through a
  reason dialog. All writes go to the existing `/api/v1` domain endpoints with `Idempotency-Key`; the collections keep
  `create/update: denyAll`. Menu "Kas"/"Tutup buku" for Finance and Direktur only.
  - API: `GET /api/v1/cash-entries` filters `projectId`/`costCenterId`; `PATCH /api/v1/cash-entries/{id}` honours
    `Idempotency-Key`. No migration.
- **F4b APK completion** (branch `feat/f4b-mobile-completion`; gap analysis `docs/proyekkas/f4/f4-gap-analysis.md`,
  phone test script `docs/proyekkas/f4/f4-e2e-scenario.md`):
  - API: a valid token on a revoked/lost device gets `401` with `code: DEVICE_REVOKED`; the APK logs out on that first
    answer with an Indonesian message and a new install id.
  - Device integrity flags (root, emulator, developer options, ADB; mocked GPS per attendance fix) reported in
    `POST /api/v1/devices/register` and stored on `devices` (`integrityRisk`, `integrity*`) — recorded, never blocking
    (Q-43 proposal); warning on the APK home screen. Migration `20260925_015425_f4b_device_integrity` (additive).
  - APK: transfer status (amount, date, bank reference, void reason) and LPJ summary on the request detail; online
    receipts after approval (camera/gallery, device compression), remove receipt, "Nota sudah lengkap",
    "Kirim LPJ"/"Kirim ulang LPJ", "Kirim ulang nota", "Tandai selesai"; in-app notifications (bell + list, polling).
  - Attendance, F4 slice: own check-in/out at an assigned project from the APK, offline-capable (GPS via geolocator
    14.0.3, front-camera selfie, server geofence/mock/assignment/one-per-day checks, server-estimated time). Company
    setting `syncAttendanceEnabled` (default off). New collection `attendances` (append-only), migrations
    `20260925_023715_f4b_attendance` + `20260925_023716_f4b_attendance_security` (additive), `POST /api/v1/media/selfies`.
  - Env `PUSH_FCM_ENABLED` in the schema (default false; `true` refused until the FCM dispatcher exists).
  - CI: static secret scan of every built APK (`apps/mobile/tool/apk_secret_scan.sh`: gitleaks + trivy + deny-list).
- **F3 dashboards, reports and exports** (`apps/web`; design `docs/proyekkas/f3/*`, approved by the user 2026-09-24 with
  all defaults Q-F3-1…8): role home pages replacing the Payload dashboard (`admin.components.views.dashboard`) for
  Owner, Finance, PM (team scope), Admin and Staff, server-rendered with inline SVG charts (no chart library,
  `<title>` tooltips + data table), budget status always with a text label (Komitmen basis), attendance/progress as
  "F5" placeholders; `/admin/laporan` with 7 reports (Rekap Kas, Buku Kas, Pengeluaran per Kategori, Anggaran Project,
  Rekap Pengajuan, Kelengkapan Nota/LPJ, Biaya per Kendaraan) with plain GET filters and keyset paging; global
  `/admin/audit-log` for Owner/Admin/Finance (read-only; opening it is audited). Every KPI follows
  `kpi-definitions.md` (K-01…K-17) and is reconciled against its SQL rule on ≥ 500 generated requests
  (`tests/integration/f3-kpi-reconciliation.int.test.ts`).
- **API:** `GET /api/v1/dashboard/{owner,finance,pm,admin,me}`, `GET /api/v1/reports/{code}` (JSON, same filters/scope
  as the web page) and `GET /api/v1/reports/{code}/{csv|xlsx|pdf}` (audited `export`, 10/min per user).
- **Exports:** CSV always (streamed in 1 000-row keyset pages, UTF-8 BOM, `;`, CRLF, formula-injection guard, ≤ 100 000
  rows); XLSX via `write-excel-file` 4.1.1 (MIT, lazy import, ≤ 10 000 rows → else 413, amounts `#,##0`, real dates,
  no formula cells; env `EXPORT_XLSX_ENABLED=false` hides it / 404); PDF (A4 landscape, ≤ 500 rows) for Rekap Kas,
  Pengeluaran per Kategori and Anggaran Project with the existing `@react-pdf/renderer`. XLSX and PDF share one
  in-process semaphore (2 concurrent, 10 s → 503) with the F2 document PDF (`lib/heavy-gate.ts`).
- **Company setting `lpjDueDays`** (default 7, Q-F3-1): Uang Muka without LPJ older than this since the first advance
  transfer is "LPJ terlambat". Migration `20260924_110138_f3_reports` (one column with a constant default) — additive.
- Nav links "Laporan" (Finance/Owner/PM) and "Audit Log" (Owner/Admin/Finance); `data-pk-*` selectors for UAT.

- **F4 APK backend** (`apps/web`, ADR 0010): `POST /api/v1/sync/batch` (bearer + registered device; drafts
  create/edit/delete + receipts per line, per-item transactions, idempotent by `client_uuid` via `sync_receipts`,
  `rev`/`base_rev` conflicts — server wins, offline device time stored as comparison only, attendance/progress →
  `unsupported` until F5); public `GET /api/v1/app/config` (min/latest APK version, download URL, company TZ,
  feature flags incl. `pushEnabled:false`); `/.well-known/assetlinks.json` (env `ANDROID_APP_PACKAGE`,
  `ANDROID_APP_CERT_SHA256`); request detail gains `rev`, `timeline` and `nextActor` ("Giliran"); device
  registration accepts `fcmToken: null`. Migrations `20260924_025114_f4_mobile_sync` (columns
  `expense_requests.sync_rev`, `receipts.client_uuid`, company-settings gate fields) and
  `20260924_025115_f4_security` (table `sync_receipts`, immutable `receipts.client_uuid`) — additive.

### Changed
- **Approval flow Direktur → Finance, PM monitors only** (Epic E1, ADR 0013 accepted, GATE 1 fase1-golive 2026-09-26;
  branch `feat/e1-approval-direktur-finance`): the role `pk-owner` is shown as **"Direktur"** (no new Keycloak role).
  "Diketahui" is now the Direktur's **approval** (inbox "Persetujuan Direktur (Diketahui)", button "Setujui"), followed
  by **Finance** approval, for every amount. Approval rules refuse PM/Staff/Admin deciders, the retired "PM project /
  penanggung jawab" acknowledger and an optional Direktur (400); PM/Staff/Admin acknowledge/approve/reject → 403 +
  `access_denied` audit; the PM keeps read access to team requests and no longer gets approval notifications or the
  "Persetujuan" link. G1-2: a position whose only holder is the requester/creator is skipped (audit
  `approval_skipped`, PDF "(tidak berlaku — pemohon)"); no independent decision → submit 409. Status label
  "Menunggu Diketahui (Direktur)"; notification "… menunggu persetujuan Anda sebagai Direktur". Requests submitted
  before the change finish on their old snapshot (PM "Diketahui", F2e delegation).
  - Migration `20260926_022918_e1_approval_direktur_finance` (additive): audit action `approval_skipped`, new
    `approval_rules` column defaults, the two seeded rules rewritten + renamed with audit rows. Seed and UAT seed
    (up to two Direktur and two Finance users) follow.
  - API (additive, for the APK): `GET /api/v1/me` → `capabilities.{approvalInbox,teamMonitor}`; request detail
    `approvalRule.{acknowledgeBy,acknowledgeRole,decisionRoles,skipped}`; `GET /api/v1/approvals/inbox` items
    `stepLabel`, `decisionFlow`.
- **Admin UI retheme to the web-starter design system** (branch `feat/cms-theme-web-starter`; visual only, no
  behaviour/data change): trust blue `#2563EB` primary, orange `#EA580C` CTA (SSO login button), slate surfaces with a
  designed dark palette, Space Grotesk headings / DM Sans body self-hosted via `next/font` (CSP `font-src 'self'`
  unchanged), radius 0.875rem, glass login card and header, card/table surfaces, visible 2px focus ring (also on
  Payload's nav group toggle), reduced-motion honoured. Mechanism (Payload 3.90.1): `(payload)/custom.scss` inside
  `@layer payload`, colour tokens on `<html>` via `RootLayout` `htmlProps`, `admin.components.graphics` Icon/Logo
  with the ProyekKas DRMS name. Tokens in `apps/web/src/theme/tokens.ts`, WCAG contrast checked by
  `tests/unit/theme.test.ts`; hard-coded status colours in the work views replaced by tokens (white on the old
  orange `#ef6c00` was 2.9:1).
- **Beranda redesigned as a data dashboard** (same branch; user feedback 2026-09-25 "terlalu text based"): per role
  a KPI stat-tile row (compact value + exact value, delta vs previous month, 12-point mini columns, meters), charts
  and card tables in a responsive 12-column bento grid (tablet 2 columns, phone 1). Owner: saldo kas, pengajuan
  menunggu (Diketahui/Approval split), pencairan bulan ini, realisasi vs anggaran; arus kas bulanan (masuk vs keluar
  columns, one axis), status pipeline, realisasi vs RAB per project (bullet rows), komposisi biaya per kategori
  (sorted bars, top 6 + "Lainnya", no donut), tren pengajuan, saldo per akun, menunggu tindakan saya, transaksi
  kas terbaru, project realisasi tertinggi. Finance: saldo, antrian transfer, menunggu verifikasi, kas
  masuk/keluar bulan ini, selisih LPJ; antrian transfer teratas, uang muka belum LPJ, pencairan per bulan. PM (team
  scope): menunggu Diketahui, pengajuan tim, LPJ tim, realisasi anggaran; bullets, pipeline, tren, komposisi.
  Staff: perlu tindakan, diproses, bulan ini, selesai; own pipeline and monthly value. **No chart library** (kept
  the existing server-rendered inline SVG approach; one ~70-line client component for hover/focus tooltips, text
  via React); every chart has a table view, focusable marks with accessible names, status always icon + label,
  skeleton via Suspense, one subtle enter animation off under `prefers-reduced-motion`. Chart colours are ramp
  steps of `theme/tokens.ts` validated per mode with the dataviz palette validator (dark mode uses blue-450: the
  dark primary blue-400 fails the chart lightness band). New read-only, scope-parameterised queries
  (`requestStatusCounts`, `requestTrendMonthly`, `disbursedMonthly`, `recentCashEntries`, `transferQueueTop`);
  the cash-ledger rows are office-scope only. `GET /api/v1/dashboard/*` responses gain an additive `viz` object
  (owner `approvals.pendingAck/pendingApproval`, staff `month`); OpenAPI regenerated. No schema change/migration.
  `data-pk-*` UAT selectors kept (the KPI list items of Owner/Finance/PM now sit in tiles/cards, tables in
  "Tabel angka").
- The F2 PDF semaphore moved to `lib/heavy-gate.ts` (shared with the F3 exports); behaviour unchanged.

### Fixed
- Reimburse receipt revision with a changed grand total now goes back to "Menunggu Diketahui (Direktur)" (new cycle)
  instead of straight to "Menunggu Approval" (ADR 0013 §6); a role-based "Diketahui" without any active holder is
  refused at submit (409) instead of leaving the request stuck in "Menunggu Diketahui".
- Manual cash entry with a proof (`proofId`) always failed with 400 "Alasan wajib diisi saat mengedit transaksi kas."
  (the proof was attached by a follow-up update that hit the edit-reason rule); the proof is now set on insert (E2).
- APK (staging phone test, ADR 0010 "Phone test fixes"): "Offline" shown on working mobile data — a successful API
  answer now always means online and a `GET /api/v1/health` probe recovers from failures and wrong `none` reports;
  logout that never finished — now always returns to the login screen (network part ≤ 5 s, local clean-up always,
  unsent data kept with a warning); slow first load — home from the cached profile at once, device registration,
  `/me` and `/app/config` in the background, integrity checks off the Android main thread.
- `media-selfies` stored WebP while accepting only `image/jpeg`, so every selfie upload failed with "Invalid file type";
  selfies are now stored as JPEG q75 (F4b).
- APK: a failed masters refresh at login (e.g. 401/5xx) no longer surfaces as an unhandled async error (F4b).
- **Report "Anggaran Project" with a project filter** (F3 UAT): the per-category table used
  `FULL JOIN … ON category_id IS NOT DISTINCT FROM …`, which PostgreSQL 16 rejects ("FULL JOIN is only supported with
  merge-joinable or hash-joinable join conditions"), so the page ("Data tidak dapat dimuat…"), JSON and CSV/XLSX/PDF
  exports failed. RAB and Komitmen per category are now merged with `UNION ALL` + `GROUP BY` (same K-07 result,
  uncategorised lines in one "Tanpa kategori" bucket). New `tests/integration/f3-report-filters.int.test.ts`: the
  per-category detail in all formats against the K-07 SQL rule, plus a smoke matrix of every report × every filter.

## [0.2.1] - 2026-09-24

### Fixed
- OpenAPI documents regenerated for the release version (the 0.2.0 bump missed `gen:openapi`, which failed the
  CI drift check). No code change.

## [0.2.0] - 2026-09-24

F2 expense-request flow (F2a–F2e) — GATE F2 approved by the user 2026-09-24 after browser UAT on staging (run 4: 56 PASS, 2 FAIL non-blocking, 1 not testable; `docs/proyekkas/uat/f2-uat-report.md`).

F2a (expense request core, `c8c1af6`), F2b (LPJ/settlement, PDF, admin views, notifications, file endpoint,
`4d952ba`), F2c (requester actions in the web panel, `59ba0a4`), F2d (`c11907a`) and F2e (`e9c07ab`) UAT fixes
merged to `develop`; staging runs `0.1.0-stg-e9c07ab`. UAT E2E run 4 on staging: 56 PASS, 2 FAIL (1 by design,
1 wording), 1 not testable (`docs/proyekkas/uat/f2-uat-report.md`); **F2 ready for gate**.

### Added
- **F2e acknowledge delegation** (user decision 2026-09-24, option a; Q-07/Q-08 edge case): when the project PM /
  cost-center manager is a requester or the creator, or is missing, "Diketahui" is delegated at submit to an
  eligible active Owner, else Admin (not a requester/creator; distinct-person matching so the acknowledger is
  never also needed as approver). Delegates fixed in the approval snapshot (`acknowledgeDelegatedTo`,
  `acknowledgeDelegateUserIds`, `acknowledgeDelegationReason`, `acknowledgeOriginalUserId`); audit action
  `acknowledge_delegated`; PDF prints "(dilimpahkan)". Submit still returns 409 when nobody qualifies.
- **F2e Finance self-involvement guard**: Finance cannot verify/reject receipts, review flags, verify all
  receipts, request LPJ revision, verify the LPJ or settle on a request it requested or created → 403; DB
  triggers `receipts_self_verify_guard` / `receipt_flags_self_review_guard` (function `pk_request_involves`).
- **F2e audit action `access_denied`**: refused self-involvement attempts (G1 acknowledge/approve/reject and the
  Finance guard) are recorded in their own transaction (`writeAuditDetached`, also used for `delete_attempt`).
- **F2d Finance Reimburse receipt verification UI** in Antrian Transfer (per receipt Valid/Tolak, flags reviewed,
  "Verifikasi semua nota"); nav badge counts Reimburse requests awaiting verification.
- **F2 UAT report** `docs/proyekkas/uat/f2-uat-report.md` (Playwright E2E runs 1–4 on staging).
- **F2c requester web panel** (`apps/web`): `pk-staff` may use the admin panel with a restricted nav (own
  requests, receipts, notifications, own profile); self-service profile signature; workflow panel with status
  timeline + next actor and the requester actions (Kirim pengajuan, Tarik kembali/Batalkan, Ajukan ulang, upload
  nota per baris, Tandai nota lengkap, Kirim/Kirim ulang LPJ, Konfirmasi selesai) via `/api/v1` with
  `Idempotency-Key`.
- **F2b LPJ & settlement** (T5): `settlements` collection; receipts-complete, LPJ submit/revision/verify, settle —
  exact amount settles at verification, surplus → KM "Pengembalian LPJ" (`settlement_refund`), shortfall →
  `lpj_shortfall` transfer + KK.
- **F2b PDF "Pengajuan Biaya"**: `GET /api/v1/expense-requests/{id}/pdf[?variant=internal]`, `@react-pdf/renderer`
  4.9.0 (MIT), built-in Helvetica, receipts on separate pages (2 per page), semaphore 2 / 10 s → 503; layout
  approved by the user 2026-09-24 (logo pending, Q-32). Measured peak RSS ≈ 138 MiB isolated, 149 MiB web cgroup
  after 3 renders.
- **F2b admin views**: approval inbox (`/admin/persetujuan`, budget impact), transfer queue
  (`/admin/antrian-transfer`), LPJ verification (`/admin/verifikasi-lpj`), "Riwayat" tab; `GET /api/v1/approvals/inbox`.
- **F2b notifications** (in-app): `notifications` collection, `GET /api/v1/notifications[/{id|uuid}]`,
  `POST …/{id}/read`, `POST …/read-all`; column `pushStatus` (`skipped` unless `PUSH_FCM_ENABLED=true`; no FCM
  dispatcher yet — F4).
- **F2b file endpoint** `GET /api/v1/media/{collection}/{id}/file[?variant=thumb]` (scoped; other users' files → 404).
- **F2b Reimburse auto-close** worker job `reimburseAutoClose`, daily 01:15 WITA (`reimburseAutoCloseDays`, default 30).
- **UAT seed** (`apps/web/src/seed/uat.ts`, staging only): idempotent one-off that links app users to
  EXISTING Keycloak users from `UAT_USERS` (no Keycloak call), creates employees `UJI-*`, sets the OPS-PB
  manager to the PM only when empty, a fictional bank account, project `UJI-PRJ` + team assignments;
  run command in `deploy/staging/.env.example`.
- **F2a expense request flow** (`apps/web`): collections `expense-requests` (+ lines), `approval-rules`,
  `approvals`, `expense-line-snapshots`, `receipts`, `receipt-flags`, `transfers`, `cash-entries`,
  `period-closings`; T1 state machines (advance, reimburse incl. "Nota Terverifikasi (Antri Transfer)",
  "Menunggu Diketahui", withdraw); approval rules (default Owner-only; "Diketahui" required, Q-07);
  receipts with validation flags; transfers posting exactly one KK; manual cash in/out; void/reversal
  numbered in the KM/KK series; monthly closing and Owner-only re-open of the latest closed period;
  `/api/v1` expense-request, cash and media endpoints + OpenAPI; `Idempotency-Key` (table `idempotency_keys`,
  72 h; required for the APK); historical number registration for the form-228 fixture without touching the
  live counter; audit actions `approve`, `reject`, `verify`.

### Changed
- **F2e:** "Pengajuan ulang dari" shows the previous request's number and title (read-only link); office-only
  fields hidden in the panel (`approvalRule`/`approvalSnapshot` for Staff/PM, `receipts.vendor` for Staff) —
  removes the 403 noise on `POST /api/approval-rules`; operational 4xx (403/404/409) are logged at `warn`,
  5xx stay `error`.
- **F2d:** "Profil & tanda tangan" linked for every panel role incl. Owner; hint above "Baris item" for the
  Payload 3.90.1 row race.
- Docs: `architecture.md` §5.2/§5.5 (delegation, G1 extended, new G17, guard order, logging), ADR 0006 (F2e
  triggers and audit actions), `open-questions-client.md` (Q-07/Q-08 edge case answered; main question open),
  `phase-plan.md` (F2 ready for gate, gate evidence, carried-over items).
- **Onboarding/staging:** the "submit 409 until PM / cost-center manager is set" prerequisite now applies only
  when no Owner/Admin qualifies for the delegated "Diketahui".
- ADR 0003, 0004, 0005, 0006, 0008, 0011, `architecture.md` (§5.1, §5.2, §6.3, §7.2, §9.2, §9.3, §11), `phase-plan.md`
  and `traceability-matrix.md` (F2 implementation status) updated with the F2b/F2c outcomes (Revision history in
  each; statuses stay accepted).
- Build: `outputFileTracingIncludes` traces the pdfkit standard fonts into the standalone output (first render in
  the image failed with `Cannot find module …/Helvetica.cjs`); the worker bundle replaces the PDF renderer with an
  esbuild stub (the worker never renders PDFs).
- ADR 0001, 0002, 0005, 0006, 0007, `architecture.md` (§5.2, G6, §9.1) and `phase-plan.md` updated with the
  F2a outcomes (Revision history in each; statuses stay accepted). Business dates stored as text `YYYY-MM-DD`.
- Build: `next build` skips its own type check (`typescript.ignoreBuildErrors`) because it OOMs at the 2 GiB
  build cap; `npm run typecheck` remains a required CI gate before the image build.
- **Onboarding/staging prerequisite:** set the PM on every project and the manager on every cost center —
  with the default approval rule, submit returns 409 until the "Diketahui Oleh" party can be resolved.

### Fixed
- The F2b down migration is runnable (it dropped an FK already removed by `DROP TABLE … CASCADE` and re-cast the
  job enums).
- Image uploads to `media-transfer-proofs`, `media-attachments` and `media-progress-photos` always failed:
  the WebP thumbnail was rejected by the collections' `mimeTypes`; these now use a JPEG thumbnail.

### Security
- **Admin form validation:** creating/editing an expense request through the admin panel (generic REST) now runs the
  same `validateContent` as `/api/v1` (Q-09 on-behalf only Admin/Finance, G9 bank account of a requester, G10 scope,
  project XOR cost center); before F2c this path skipped these rules.
- Self-service profile updates are limited to the caller's own row and the `signature` field (403 otherwise; the
  signature must be uploaded by the caller).
- F2b DB guards: `settlements` and `notifications` are Class B (settlement status graph, settled rows frozen,
  refund/shortfall amounts cross-checked; notifications identity immutable, no DELETE); `lpj_shortfall` transfers and
  `settlement_refund` cash entries constrained. Void of a refund KM / shortfall transfer → 409 (settlement reversal
  not implemented, F6 backlog).
- PDF downloads audited `export`; transfer-proof file reads audited `view_sensitive`. Signed media URLs still open (F6).
- DB guards (F2a security migration): request content frozen outside Draft/Revisi Nota via `content_hash` +
  DEFERRED constraint triggers (child tables `expense_requests_lines/_rels` keep DELETE only for Payload's
  rewrite); `approvals` and `expense_line_snapshots` append-only (Class A, G1 in the DB); Class B guards on
  receipts, transfers (amount = approved amount), cash entries and period closings; period lock trigger.
- Payload 3.90.1 swallows COMMIT errors (`@payloadcms/drizzle` `commitTransaction`) → deferred checks are
  forced inside every app-owned transaction so a violation fails the request instead of silently rolling back.

## [0.1.0] - 2026-09-23

F0 design + F1 foundation (GATE F1 approved by the user 2026-09-23). Staging runs image `0.1.0-stg-f8529e6`
at `https://drms-kas.staging.bimacreative.tech`; first admin login (password + TOTP) and real SMTP delivery verified.

### Added
- **F0 discovery & design** (GATE F0 approved by user 2026-09-23): requirements v1.1, open client questions,
  traceability matrix, `docs/proyekkas/architecture.md`, ADR 0001–0011 (accepted), phase plan F0–F7
  (`docs/proyekkas/`). Recorded user decisions: build outside Odoo on Payload CMS 3; DB names
  `pk_drms`/`pk_drms_stg`; hostnames `drms-kas.bimacreative.tech` / `drms-kas.staging.bimacreative.tech`;
  expense-request numbering never resets (start 229); receipt originals discarded after resize; 14-day
  offline session idle.
- **F1 spike week** (`apps/web`, report `docs/proyekkas/spikes/f1-spike-report.md`): Payload 3.90.1 +
  Next 16.3.6 scaffold (npm workspaces), OIDC-only admin login (`oidcSession`), `mobileBearer` on
  `/api/v1/me`, append-only `audit_logs` migrations, in-transaction numbering, jobs worker bundled outside
  Next (`dist/worker.mjs`), nonce CSP proxy, receipt resize (≤ 2000 px JPEG q82, `sha256Original`),
  production Dockerfile (webpack build). Spike-only code (`apps/web/spike/**`, `spike-*` collections/tasks)
  is to be removed in F1.
- **F1 foundation** (`develop` `e2bf46b`): masters, users/role sync via the Keycloak Admin API, devices,
  web-sessions, append-only audit + `pk_protect_columns` migrations, numbering with `number_issued` audit,
  media collections, `/api/v1` skeleton + `packages/api-contract/openapi.json`, idempotent seed (fictional
  default data; real data only via `SEED_DATA_FILE` at deploy time, existing rows never overwritten),
  `deploy/staging/` compose, CI workflow. Spike-only code removed.
- **Staging deployed** at `https://drms-kas.staging.bimacreative.tech` (infra Lead,
  `/opt/infra/staging/drms-proyekkas/`): separate web (640m) + worker (320m) + one-shot migrate; images built
  locally on the VPS until GHCR (temporary). Measured idle RAM web 82 MiB, worker 47 MiB.
- **Outbound email (SMTP)**: `@payloadcms/email-nodemailer` 3.90.1 (MIT; nodemailer 9.1.1 MIT-0) configured
  from `SMTP_HOST/PORT/USER/FROM_ADDRESS/FROM_NAME` + `SMTP_PASSWORD_FILE` (all-or-nothing, From must equal
  `SMTP_USER`; STARTTLS required on 587, certificate verification on). From is forced by the adapter. Mailbox
  limit 30/h (burst 10) → DB-backed token bucket `mail_rate_buckets` shared by web + worker (burst 5, 24/h,
  ≤ 29 in any hour). Mails go through the Jobs queue (`sendEmail`, worker, retried with backoff; input holds
  the user id, not the address). `POST /api/v1/admin/test-email` (Admin, own address, audited `email_test`,
  3/h). REST `/api/payload-jobs/*` closed (worker uses the Local API). Without SMTP_* → console adapter.
- Public GitHub repository `bctech-adm/drms`; CI green on the first run (run 35857158248, commit `e2bf46b`).

### Changed
- ADR 0001, 0002, 0003, 0006, 0007 and `architecture.md` revised with the F1 spike results and the user
  decisions of 2026-09-23 (see each document's Revision history): Payload 3.90.1 = GO; admin CSP
  `style-src 'self' 'unsafe-inline'`, scripts nonce-strict without `'strict-dynamic'`, `form-action 'self'
  https://auth.bimacreative.tech`; no `json`/`code` field editors in the admin; Keycloak offline session max
  lifespan 30 days (+ 14-day idle); app reaches Keycloak via the public issuer (hairpin) on network
  `drms-kas-edge`; back-channel logout disabled; cron evaluated in process `TZ=Asia/Makassar`; measured
  RAM (web idle 108 / peak 205 MiB, worker idle 47 / peak 51 MiB), limits kept until F6.
- `phase-plan.md`: F1 spike gate passed; F1 item 7 (infra) done — infra `main` commit `c557c28`.
- ADR 0002, 0003, 0004, 0006, 0007, `architecture.md` and `phase-plan.md` updated with the F1 foundation
  outcomes (Revision history in each): staging topology as deployed (ADR 0002 §7; pools 5 + 3 + 2 ≤
  CONNECTION LIMIT 10); Keycloak role lookup via `role-mappings/realm/available`, service account
  `manage-users` + `view-users` only, Admin API via internal networks `drms-kc-admin[-stg]`, first staging
  admin bootstrap; `action` enum + `user_roles` text; role names derived from `current_user`; counter
  monotonic trigger. Remaining F1: `HEAD` health (in progress), SMTP adapter (pending infra), F1 gate review.

### Fixed
- Docs: company-logo media slug is `media-company` (was `media-company-logo` in `requirements-v1.1.md` and
  `traceability-matrix.md`).

### Security
- **Public-repo sanitization**: client reference inputs (form image, requirements v1.0, lead prompt) removed
  from the tree (held by the project Lead, `docs/proyekkas/reference/README.md`); person names, bank account,
  receipt/transaction numbers, vehicle plate and vendor name in docs/seed/tests replaced by fictional
  pseudonyms (amounts, dates and analyses unchanged). Seed accepts the real master data from an untracked
  JSON file via `SEED_DATA_FILE` (zod-validated, same shape as the default data).
- Every upload collection must carry the remote-URL guard hook: `pasteURL: false` alone does not stop
  Payload 3.90.1 from fetching a remote `{filename,url}` on REST create (SSRF; spike §h).
- `admin.avatar: 'default'` (no gravatar request leaking `md5(email)`).
- APK bearer tokens are never authenticated on Payload generic REST (`/api/<slug>` → 403 or `{user:null}`);
  Traefik strips `Authorization` outside `/api/v1` (staging routers live).
