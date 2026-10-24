# ADR 0030 — Hapus per baris (soft delete) dan Batalkan proyek

- **Status:** Accepted — owner decision 2026-10-16 (soft delete with `isDeleted`, who / when / reason, audit; Hapus
  only while unused, otherwise Batalkan / Nonaktifkan). Implemented on `feat/d1610-soft-delete` (from `main` `484642a`
  = v0.12.0, migrations `20261016_2000xx`, see "As implemented"). The defaults marked **(default)** below are the
  developer's reading of the request and need the owner's confirmation at the UAT. Staging first; no production deploy
  without separate owner approval.
- **Date:** 2026-10-16
- **Author:** nextjs developer (branch `feat/d1610-soft-delete`)
- **Amends:** requirements v1.3 §3 ("Semua dokumen: tidak bisa dihapus") and the "no delete" rule of every master
  (requirements v1.1 §4 / v1.2, `delete: denyAll` / `denyDeleteLogged`) — see "Amendment" below.
- **Related:** ADR 0006 (audit log), ADR 0010 (APK offline / masters), ADR 0013 / 0021 (request state machine), ADR
  0016 (multi-company access), ADR 0022 (project loans), E5 (addendum RAB).

Paths are relative to `apps/web/src/` unless they start with `apps/mobile/` or `docs/`.

## Context

Owner request (DRMS 16/10, verbatim):

> "Fitur hapus di setiap row table, seperti project yang mungkin masih draft, atau jika dalam project terdapat
> pengajuan, yang boleh dilakukan hanya membatalkan transaksi, dan pembatalan yang terdampak."

Owner decision (2026-10-16): a **"Hapus"** action on each table row, allowed **only while the record is not used yet**,
implemented as a **soft delete**: a flag column `isDeleted` (true = 1) plus who / when / reason (`deletedAt`,
`deletedBy`, `deleteReason`, reason required) and an audit-log entry. Deleted rows are hidden from tables / grids,
relationship pickers, API lists, dashboards, reports and the APK; an Admin can show them with a list filter
"Tampilkan yang dihapus" and restore them ("Pulihkan", audited). When the record IS used, the row action becomes
"Batalkan" instead (project: cancel with cascade; request: the existing cancel; master: the existing "Nonaktifkan").

Until now nothing could be deleted: every collection has `delete: denyAll` (requests: `denyDeleteLogged`), the DB app
role has no DELETE on business tables, and masters are only deactivated (`active = false` + reason).

## Decision

### 1. Soft delete, never a hard delete

- Collections in the registry (`domain/soft-delete/registry.ts`) get four read-only fields (`withSoftDelete`,
  `domain/soft-delete/collection.ts`, applied once in `payload.config.ts`): `isDeleted` (checkbox, default false,
  indexed), `deletedAt`, `deletedBy` (→ users), `deleteReason`. Field access create / update = false for everyone.
- The ONLY writer is `domain/soft-delete/service.ts`: one SQL `UPDATE <table> SET is_deleted = true, deleted_at =
  now(), deleted_by_id, delete_reason, updated_at` + one `audit_logs` row (`action = soft_delete`, field `isDeleted`,
  aktif → dihapus, reason, PT of the row) in the request transaction. No Payload update: nothing else of the row
  changes, so content validation, notifications and reference re-checks must not run (a draft with incomplete lines
  can be deleted). Restore = the reverse (`action = restore`).
- Hard delete stays denied: `delete: denyAll` / `denyDeleteLogged` are untouched, the DB grants are unchanged. The
  soft delete is an update of the flag through its own endpoint and its own permission check.
- DB guard: CHECK `<table>_soft_delete_state` — a deleted row carries `deleted_at` and a reason of ≥ 3 characters.
- A deleted row is frozen: any Payload update of it is refused with 409 ("Pulihkan dulu") until it is restored
  (`deletedRowGuard`). The DB guard of locked requests (`pk_expense_requests_guard`) also refuses the flag on a
  non-draft request.

### 2. Hidden everywhere — one central read rule

`hideDeleted` (beforeOperation of find / count / findDistinct on every registry collection) AND-s
`isDeleted != true` to every list read: the admin lists, relationship pickers, Payload REST `/api/<slug>`, the
`/api/v1` lists, the APK masters, dashboards and reports that read through Payload, system reads included. Exceptions:

- **lookups of explicit ids** (`findByID`, `where: { id: { equals | in } }`, alone or as one conjunct of `and`):
  Payload's relationship population / dataloader, the admin's relationship labels, relationship validation and the
  detail page. An old request that points at a deleted vendor still shows the vendor's name; a deleted row can be
  opened by its URL (read-only, badge "Dihapus" in the sidebar);
- an **explicit `isDeleted` condition** of an Admin (`pk-admin` in a selected PT, group admin), of a system read
  (`overrideAccess: true`) or of a server read that opted in (`req.context.pkIncludeDeleted`). A non-Admin's
  `where[isDeleted][equals]=true` finds nothing.

Raw-SQL reports use the shared scope helpers, which now carry `is_deleted IS NOT TRUE` inside every company part
(`domain/reports/scope.ts`: requests, projects, cost centers, sites, per-PT masters); the attendance location lists and
two dashboard counts got the same predicate. Join fields pointing at a registry collection (the vendor's "Rekening"
tab) get `isDeleted != true`.

Unique codes stay unique **including** deleted rows (DB unique indexes are unchanged): re-creating a deleted code is
refused as a duplicate — restore the deleted row instead **(default)**.

### 3. When "Hapus" is allowed

| Kind | Hapus allowed when | Otherwise (row action) | Who may Hapus |
|---|---|---|---|
| Master (§ 5) | no other row references it | **Nonaktifkan** (dialog lists where it is used + link to the form) | whoever may update the row (the collection's update access, per PT) |
| Project | no other row references it, except its own set-up: project stages (weights) and team assignments | **Batalkan proyek** (§ 4) | Direktur, Admin, PM of the team (project update access) |
| Pengajuan | status Draft **and never submitted** (no number yet — the number is issued at the first submit) | **Batalkan** (the existing cancel; state machine `cancel` transitions) | its creator / requesters (the draft's update access) |

"Used" is read from the database's own foreign keys (`domain/soft-delete/usage.ts`, `pg_catalog`): every single-column
FK that points at the table counts — requests (and their lines), cash entries, transfers, receipts, approvals, loans,
addenda, progress / daily / field reports, attendances, RAP items, approval rules, vehicles, company memberships
(an employee linked to a user account), hand-written tables such as the inter-PT loans, and any table added later.
Ignored: the row's own sub-tables (`<table>_rels.parent_id`, array rows `_parent_id`), Payload system tables
(`payload_*`: document locks, preferences), the `deleted_by_id` columns, and rows that are themselves soft-deleted.
Owned children (`registry.ts`) are part of the row: a vendor's bank accounts and an employee's bank accounts are
soft-deleted **with** it and restored with it (same transaction time); a project's stages and team assignments stay as
they are. Their own references count (a vendor account used by a request makes the vendor used).

A request that was submitted and withdrawn back to Draft keeps its number → it is not deleted but cancelled (its
number stays accounted for, ADR 0007).

Restore ("Pulihkan") and the list filter "Tampilkan yang dihapus" (`?dihapus=tampil|hanya`, offered only to them):
**Admin of the row's PT** (shared masters: an Admin of any PT), group admins **(default)**. Reason required for Hapus,
Pulihkan and Batalkan proyek (3–1000 characters).

### 4. Batalkan proyek — status `dibatalkan` with cascade

- New project status **`dibatalkan`** ("Dibatalkan"), terminal, set **only** by `POST /api/v1/projects/{id}/cancel`
  (form refuses it, a cancelled project is never re-opened). Reason, time and user are stored on the project
  (`cancelReason`, `cancelledAt`, `cancelledBy`; DB CHECK `projects_cancel_state`) and in the audit log
  (`status_change`, with the number of cancelled documents).
- Who: **Direktur or Admin of the project's PT** **(default — the PM may delete an unused project of his team, but not
  cancel a used one)**; statuses Perencanaan / Berjalan / Ditunda (a Selesai / Arsip project is not cancelled).
- In the SAME transaction, every in-flight document of the project that can still be cancelled under its existing
  state machine is cancelled with the reason **"Proyek dibatalkan: <alasan>"**, through the document's own write path
  (status, cancel reason, audit, the normal notifications):
  - pengajuan: Draft / Menunggu persetujuan; Pengajuan Baru Disetujui; Reimburse Disetujui / Nota Terverifikasi /
    Revisi Nota (`domain/expense/state.ts` `cancel` rows) — `cancelForProject`;
  - addendum RAB: Draft / Menunggu — `cancelAddendumForProject`;
  - pinjaman antar project (as lender or borrower): Draft / Menunggu, Disetujui without any repayment —
    `cancelLoanForProject`.
  The actor check of each document is replaced by the project-cancel permission; the state machine still decides.
- **Refused (409 `PROJECT_HAS_OPEN_DOCUMENTS`)** while a document cannot be cancelled any more — money already moved
  (Ditransfer, Nota Lengkap, LPJ Diajukan / Revisi / Terverifikasi) or a loan with a repayment: the response lists them
  (`blocking`) so they are settled first (LPJ, refund, repayment). Finished documents (Selesai, Ditolak, Dibatalkan,
  approved addenda, repaid loans) stay as they are.
- Dry run first: `GET /api/v1/projects/{id}/cancel-plan` (what is cancelled, what blocks); the confirmation dialog
  shows it. The cancel re-computes the plan under the project row lock.
- A cancelled project is **closed like an archived one**: no new requests, addenda, loans, progress / field / daily
  reports, attendance or RAP edits (`domain/projects/status.ts`, every former `'arsip'` check); it is left out of the
  default project lists (APK `GET /projects`, pickers) and is `active: false` in the APK masters.

### 5. Collections covered

Masters: `banks`, `uoms` (shared), `clients`, `vendors` (+ `vendor-bank-accounts`), `vendor-bank-accounts`,
`employees` (+ `employee-bank-accounts`), `employee-bank-accounts`, `sites`, `cost-centers`, `expense-categories`,
`urgency-levels`, `resource-types`, `vehicles`, `cash-in-sources`, `cash-accounts`, `work-schedules`,
`stage-templates`, `rap-templates`. Plus `projects` and `expense-requests`.

Not covered **(default)**: user accounts and PT access (`users`, `company-memberships`, `companies` — Keycloak / access
history; deactivate), configuration with its own history (`approval-rules`, `document-sequences`,
`notification-templates`), project sub-structures edited in their own screens (`project-stages`, `rap-items`,
`budget-lines`, `contract-units`), `holidays`, and every workflow document other than the request (cash entries,
transfers, receipts, settlements, reports, loans, addenda: cancelled / voided through their own actions, never deleted).

### 6. API (`/api/v1`, problem+json, Idempotency-Key, 30/min)

- `GET /records/{collection}/{id}/delete-check` — the row action for the caller, usage lines, deleted state;
- `POST /records/{collection}/{id}/delete` `{ reason }` — 409 `IN_USE` / `PROJECT_IN_USE` (+ `usage`), 409
  `NOT_A_DRAFT`, 403, 404;
- `POST /records/{collection}/{id}/restore` `{ reason }` — Admin;
- `GET /projects/{id}/cancel-plan`, `POST /projects/{id}/cancel` `{ reason }` — 409 `PROJECT_HAS_OPEN_DOCUMENTS`
  (+ `blocking`).
`GET /masters?since=…` lists rows soft-deleted since then as tombstones (`deleted: true, active: false`); a full read
never contains them.

### 7. Admin UI

The "Aksi" column of every registry list (`RowActionsCell` → `RowRecordAction`) shows next to Ubah / Lihat: **Hapus**
(unused / never-submitted draft), **Batalkan** (used project → dialog with the dry run; submitted request → the
existing cancel), **Nonaktifkan** (used master → where it is used + link to the form) or, on a deleted row,
**Pulihkan** + badge "Dihapus" (Admin). The state is computed server-side per page (one usage query, PkListView);
every endpoint re-checks. Admin filter "Data dihapus": Sembunyikan (default) / Tampilkan yang dihapus / Hanya yang
dihapus.

## Amendment — requirements v1.3 §3 / masters "tidak dihapus"

"Semua dokumen: tidak bisa dihapus" stays true for **hard** deletes. Amended: a record that **nothing references yet**
— a master row, a project, a request Draft that was never submitted — may be **soft-deleted** (hidden, flag + reason,
audited, restorable by an Admin). A used record is never deleted: masters are deactivated, requests and projects are
cancelled (projects with the cascade of § 4).

## Consequences

- One more state on 20 tables; every list read of them carries one indexed predicate (`is_deleted`).
- Reads by explicit id still return deleted rows (labels of old documents) — a client that enumerates ids could see a
  deleted row it was allowed to read before; nothing new is disclosed.
- A deleted master is not re-checked on create of a new document that names it by id (stale APK cache): the pickers
  and lists no longer offer it; the server accepts it like an inactive one today.
- The previous image (rollback) ignores the columns and shows deleted rows again — harmless.

## APK follow-up (not in this branch)

The APK needs no change to stay correct: its masters are full reads (deleted rows disappear), cancelled projects come
with `active: false` (hidden by `masterFromJson(...).active`), `GET /projects` leaves them out, and unknown status codes
fall back to the server label. To do in the APK later:
1. `ProjectStatus` enum: add `dibatalkan` ("Dibatalkan") and treat it like `arsip` in the progress, attendance and
   field-report project filters (`progress_providers.dart`, `attendance_service.dart`, `field_providers.dart`);
2. a delta masters cache (if ever built) must drop items with `deleted: true`;
3. optional: "Hapus" of an own never-submitted draft (`POST /records/expense-requests/{id}/delete`) and a "Dihapus" /
   "Dibatalkan" message when an opened request / project was deleted or cancelled on the web.

## As implemented

- Registry + read rule + fields: `domain/soft-delete/{registry,where,collection}.ts`; usage: `usage.ts`; service:
  `service.ts`; project cancel: `domain/projects/cancel.ts`, closed statuses `domain/projects/status.ts`; system
  cancels in `domain/expense/workflow.ts`, `domain/addendum/service.ts`, `domain/loans/service.ts`.
- Endpoints `api/v1/endpoints/records.ts` (+ `schemas-records.ts`, `openapi-records.ts`); masters tombstones
  `api/v1/endpoints/masters.ts`.
- UI: `admin/components/RowRecordAction.tsx`, `RowActionsCell.tsx`, `admin/pk-list/{PkListView.tsx,data.ts}`.
- Migrations: `20261016_200000_d1610_soft_delete_enums` (`enum_projects_status` += `dibatalkan`,
  `enum_audit_logs_action` += `soft_delete`, `restore`) → `20261016_200100_d1610_soft_delete` (columns, FKs, indexes,
  CHECKs; snapshot `.json`). Additive; down refused while a project is `dibatalkan`.
- Tests: `tests/unit/d1610-soft-delete.test.ts`, `tests/integration/d1610-soft-delete.int.test.ts`.

## Rollout / rollback

Staging first. Deploy as usual (migrate → web + worker); nothing is deleted by the migration. Rollback before any
project is cancelled: `payload migrate:down` (newest first) — the deletion flags are lost (the audit log keeps them);
after a project cancel → restore the dump and the 0.12.0 image.

## Amendment 2026-10-24 — "Batalkan" only at the Finance stage (D2410)

User decision 2026-10-24 (point 13): the expense-request `cancel` transition exists only at the Finance stage
(advance / vendor / PT grup `approved`; Reimburse `approved`, `receipts_verified`, `receipt_revision`) and only for
Finance / Direktur of the PT. The row action **Batalkan** of a submitted request follows it (`requestCancellable` +
`mayCancelRequest`); a submitted / withdrawn request otherwise has no row action. **Batalkan proyek** keeps cancelling
the project's drafts and pending requests as before — a system cascade (`state.ts` `PROJECT_CASCADE_CANCEL_FROM`,
`cascadeCancellable`), never offered to a user.

