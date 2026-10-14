# ADR 0028 — Transfer antar-PT (penerima "PT grup" + Kas Masuk otomatis)

- **Status:** Accepted (owner decisions 2026-10-14, see "Owner decisions" below) — implemented on the web / server
  side in `feat/d1310-b-intercompany` (migrations `20261014_1000xx`–`1003xx`); the APK part is a separate follow-up.
  Staging first; no production deploy without separate owner approval.
- **Date:** 2026-10-14
- **Author:** nextjs developer (branch `feat/d1310-b-intercompany`, from `main` `58ca6d0`)
- **Extends:** [ADR 0027](0027-vendor-payments.md) (payee type `karyawan | vendor` → `karyawan | vendor | pt_grup`).
- **Amends (draft text in "Proposed amendments" below):** [ADR 0005](0005-cash-ledger-own-model.md) (revision
  2026-09-27: "transfers between PTs are out of scope") and [ADR 0016](0016-multi-company.md) (§4 "no cross-PT
  reference"). Also a note for [ADR 0022](0022-inter-project-loan.md) (Q-L2, Phase C).
- **Related:** ADR 0006 (audit), ADR 0007 (numbering + renumber amendment), ADR 0008 (PDF), ADR 0010 (APK), ADR 0011
  (notifications), ADR 0013 / 0021 / 0024 / 0026 (approval rule engine, Owner level).

Paths are relative to `apps/web/src/` unless they start with `apps/mobile/` or `docs/`.

## Context

### Owner requirement (2026-10-13)

> "Otomasi intercompany — misal ada kas keluar dari DRMS ke LAS maka akan terbentuk kas masuk ke LAS setelah kas
> keluar dari DRMS telah di transfer finance."

Approved design direction: a new payee type **"PT grup"** on the expense request (Pengajuan) of PT A whose payee is
PT B of the group, paid to B's designated intercompany receiving account; normal approval flow (Staff → PM → Direktur →
Owner → Finance transfer, i.e. the rule engine); when Finance of A records the transfer (KK in A) the system posts a
**Kas Masuk in B** on that account — a system write, Finance A needs no role in B — linked to the source both ways.
Voiding the transfer reverses the KM. A closed period in B refuses the transfer with a clear message. Like vendor
payments: no LPJ, the transfer completes the request. Phase C later adds a fund check at the Owner approval and an
"inter-PT loan" document that must reuse the same pairing.

### Current model (read on `main` `58ca6d0`)

| Area | Fact | Evidence |
|---|---|---|
| Inter-PT money | Out of scope: "record a manual KK in PT A and a manual KM in PT B" | ADR 0005:200, `../requirements-v1.2.md:215`, ADR 0022:34, :143-146 |
| Loans | Same PT only (Q-L2, 400 "Project pemberi dan peminjam harus di PT yang sama."); loans write **no** cash entries | `domain/loans/service.ts:327-338`, :51; ADR 0022 §5 |
| Payee types | `PAYEE_TYPES = ['karyawan','vendor']`; `payeeOf()` is binary (anything not `vendor` = `karyawan`) | `domain/expense/types.ts:22-40`; zod `api/v1/schemas-flow.ts:33-35` |
| Payee field | `payeeType` select, options filtered by role in the form PT | `collections/ExpenseRequests.ts:392-408`, :111-116 |
| Who files vendor | `VENDOR_PAYMENT_ROLES = ['pk-finance','pk-pm']`, filer = requester | `domain/expense/drafts.ts:61`, :297-350 |
| State machine | payee dimension; vendor `approved → completed` on transfer, `completed → approved` on void; LPJ rows `karyawan` only | `domain/expense/state.ts:40-41`, :58-63, :76-81 |
| Snapshot | `bankSnapshot {bankName, accountNo, accountHolder}` taken at submit from the vendor / employee account | `domain/expense/workflow.ts:205-218` |
| Rule engine | `approval_rules.payee_type` `any|karyawan|vendor`; `payeeCondition()` hard-codes the two values | `domain/expense/rules.ts:41-62`, :118-124, :143-144; `domain/expense/snapshot.ts:62` |
| Vendor DB guards | CHECK `expense_requests_payee`, `pk_expense_vendor_guard`, `settlements_no_vendor_payment`, widened `pk_expense_requests_project_rules` | `migrations/20261013_700100_d1310_vendor_payments_guard.ts:46-119` |
| Transfer | `recordTransfer`: lock request, amount = approved, A's lock date (409 "Periode … sudah ditutup (tutup buku s/d …)"), `checkDestination`, `transfers` row, KK via `postEntry({sourceType:'transfer'})`, vendor → `completed` | `domain/expense/transfers.ts:178-260`; route `api/v1/endpoints/expense-requests.ts:441-455` (pk-finance, transactional, idempotent) |
| Void transfer | `voidTransfer` → `voidEntry(…, {viaTransfer:true})` (reversal row, original `void`), transfer `void`, request back to `approved` / `receipts_verified` | `domain/expense/transfers.ts:266-289`; `domain/cash/ledger.ts:365-408` |
| Ledger | `cash_entries.source_type` enum `transfer | settlement_refund | manual | reversal | opening`; every posting through `postEntry` | `migrations/20260923_133049_f2a_flow.ts:31`; `collections/CashEntries.ts:36-76`; `domain/cash/ledger.ts:170-232` |
| Membership check | `postEntry` refuses an account whose PT is not mapped to the caller (400 "Akun kas tidak ditemukan atau nonaktif."); skipped when there is no user | `domain/cash/ledger.ts:176-186`; `access/roles.ts:218-222` |
| Reversal | dated the original date if open, else today; reversals skip the overdraft check | `domain/cash/ledger.ts:380-381`, :187 |
| Immutability | `pk_cash_entries_guard`: posted rows immutable, only `posted → void` with reason; no DELETE grant | `migrations/20260928_000100_mc1_security.ts:177-219`; `migrations/20260923_103219_security.ts:17-29` |
| Period lock | per PT, `pk_cash_lock_date(company_id)`; DB 42501 "cash_entries: period of % is closed" → HTTP 409 | `migrations/20260928_000100_mc1_security.ts:172-191`; `lib/pg-error.ts:9` |
| Cross-PT guards | `pk_same_company` on `cash_entries` (`cash_account_id`, `expense_request_id`, `transfer_id`, `reversal_of_id`, …) and `transfers` (`request_id`, `cash_entry_id`, …); app `companyHook` "Data harus dari PT yang sama (cross-company reference)." | `migrations/20260928_000100_mc1_security.ts:23-48`, :77-98, :296-298; `fields/company.ts:123-182`; `collections/CashEntries.ts:35` |
| Cash accounts | per PT; `kind cash|bank`, `bank`, `accountNo`, `accountHolder`, `active` — **no** intercompany / default flag | `collections/CashAccounts.ts:52-56`, :147-184 |
| System cash-in source | `LPJ` seeded per PT (`SYSTEM_CASH_IN_SOURCES`, `ensureSystemCashInSources`) for the automatic refund KM | `domain/company-defaults.ts:28-60`; `domain/expense/lpj.ts:303-331` |
| Numbering | KM / KK `<DOC>/{COMPANY}/{YY}{MM}/{seq}`, counter per `(company_id, doc_type, period_key)` of the **account's** PT | `domain/numbering.ts:115-116`; `domain/numbering-db.ts:49-83` |
| Renumber CLI | one-time per PT; rewrites `entry_no` + `cash_entries.description`, text maps **per PT** (a PT A number quoted in a PT B description is not rewritten) | `renumber/plan.ts:259-270`; `renumber/db.ts:187-194`; ADR 0007 Amendment 2026-10-13 |
| Audit | `writeAudit(req, rows, user?)`, `companyId` per row, `user = null` = system; `docType` is free text, `action` a Postgres enum | `audit/writer.ts:79-95`, :188-241; `collections/AuditLogs.ts:23`; `migrations/20260923_103218_initial.ts:47` |
| Notifications | `notifyTransition`; recipients `membersWithRole(role, doc.company)`; event = text (no enum); after a vendor void (`completed → approved`) `expense.approved` goes to people, not `expense.transfer_queue` to Finance | `domain/notifications.ts:24-67`, :147-149, :250-320 |
| Reports | Rekap Kas Rincian groups by `direction, source_type, cash-in source`; Buku Kas filter `SOURCE_TYPES`; `spending()` = advance + reimburse transfers; nothing filters on `payee_type` | `domain/reports/kpi.ts:214-291`, :838; `domain/reports/registry.ts:301`, :360-361, :403-411 |
| APK | `PayeeType` karyawan/vendor, `fromCode` maps unknown → karyawan; vendor form, picker, detail; no cash-book screen (only the "Transaksi kas terbaru" card, no `sourceType`) | `apps/mobile/lib/features/expense/domain/request_status.dart:13-27`; `…/presentation/draft_editor_screen.dart:164-190`, :531-544; `…/data/expense_mappers.dart:405-468`; `apps/mobile/lib/features/dashboard/domain/dashboard.dart:415-440` |
| Odoo | mirror not built; cash entries deferred to F7 | ADR 0009:129-130, :258 |

Consequences for the design: (1) there is no way to name a PT as payee; (2) a KM in B cannot carry
`transfer_id` / `expense_request_id` of A (DB + hook refuse it, by design of ADR 0016); (3) `postEntry` refuses a PT A
user posting into B; (4) the two PTs have independent locks; (5) `voidTransfer` has no cascade.

## Decision

### 1. Payee type `pt_grup` ("PT grup")

`expense_requests.payee_type` = `karyawan | vendor | pt_grup`. Label "PT grup"; kind label "Pembayaran antar-PT"
(`requestKindLabel`). Like a vendor payment, it is **always `advance`** (set by the server), the requester picker is
hidden and **Pemohon = the filer** (his employee in A), the employee account stays empty.

Fields of a `pt_grup` request:

| Field | Rule |
|---|---|
| `payeeCompany` (`payee_company_id` → `companies`) | required to submit; an **active** PT ≠ the request's PT that has a designated receiving account (§2). `companies` is app-wide (ADR 0016 §4 class "group"), so this FK is not a cross-PT reference and `pk_same_company` is untouched. DB CHECK `payee_company_id IS DISTINCT FROM company_id`. |
| `bankSnapshot` | taken at submit from B's designated account (bank name, account no., holder) — the same columns as the vendor / employee snapshot, so `transfers.destination` is filled unchanged. |
| `invoiceNo` / `invoiceDate` / `invoiceFile` | **required to submit** (owner decision 2026-10-14: the receiving PT's document — service bill / memo — number, date and file, the same fields and rules as the vendor invoice; due date optional); the number is unique per receiving PT among live requests: `(payee_company_id, pk_invoice_key(invoice_no))` partial unique index `expense_requests_ic_invoice_uq` + 409 field error `invoiceNo`, like ADR 0027 §5. |
| project **or** cost center | as ADR 0027 decision 2 (project wins; PM only on his own scope). |
| lines | normal lines and categories of A (e.g. "Jasa antar PT"); they drive A's KK category as today. |

**Who may file (owner decision 2026-10-14):** Finance, PM or **Direktur (`pk-owner`)** **in A**
(`INTERCOMPANY_PAYMENT_ROLES`; vendor payments stay Finance + PM, `VENDOR_PAYMENT_ROLES`; `payeeFilerRoles(payee)`
picks the list), else 403 "Pembayaran antar-PT hanya dapat diajukan oleh Finance, PM atau Direktur di PT ini." Staff,
Admin and an **Owner (`pk-principal`) without one of these roles cannot** (the owner's answer names Finance, PM and
Direktur only; "if unclear, not allowed") — checked on the STORED roles (`mayFileIntercompany`, ADR 0026
`exactRolesIn`), since the Owner otherwise carries the Direktur's access; the form option, the payee directory and the
masters type follow the same rule. A Direktur's own `pt_grup` request goes through the rule engine like any of
his requests: "Pengajuan Direktur" (priority 10, Peran pemohon = Direktur) → Owner — it wins over the Finance rule
(priority 20) even when the Direktur also holds Finance; G1 holds (the Direktur is the requester, the Owner decides; a
user who is both is skipped per ADR 0013 G1-2).

"Duplikat" / "Ajukan ulang" copy `payeeCompany` but not the invoice; withdraw → resubmit takes a fresh snapshot.

### 2. Designated receiving account per PT

New field on `cash-accounts`: `intercompanyReceiving` ("Rekening penerimaan antar-PT", checkbox). Rules (hook + DB):
only `kind = bank`, active, with bank, account number and holder; **at most one per PT** (partial unique index
`cash_accounts_ic_receiving_uq (company_id) WHERE intercompany_receiving AND active`). Set by the roles that edit cash
accounts today (Admin / Finance / Direktur of that PT, `collections/CashAccounts.ts:52-56`); audited (`update`,
field `intercompanyReceiving`, reason required). No designated account = PT B is not offered as payee.

A PT A filer may not read B's cash accounts (ADR 0016 isolation). A new selection endpoint returns the **payee
directory** only: `GET /api/v1/intercompany/payees?company=<A>` → `[{ companyId, shortCode, name, bankName,
accountNoMasked, accountHolder }]` for every other active PT with a designated account (SYSTEM-READ limited to those
fields; caller must hold Finance / PM in A). The full number is only in the snapshot, shown like the vendor account
(eye toggle, Finance / filer).

Own cash accounts are trusted: there is **no "unverified account" confirmation** for `pt_grup`.

### 3. Approval

The generic engine, unchanged: `approval_rules.payee_type` gains `pt_grup` (`payeeCondition()` and the specificity in
`rules.ts:118-124` learn the value; CHECK `approval_rules_payee_type` unchanged — addendum rules stay `any`). Without a
specific rule a `pt_grup` request follows the PT's default rule (PM project → Direktur → Owner; PM step skipped when
the filer is the project's PM, ADR 0013 G1-2). Data migration seeds per PT, mirroring ADR 0027, the rule
**"Pembayaran antar-PT oleh Finance — Direktur lalu Owner"** (Jenis penerima = PT grup, Peran pemohon = Finance,
levels Direktur then Owner, priority 20). Approvers are those of **A only**; B takes no decision (owner direction).

**Phase C hook:** the Owner step gets a read-only "Saldo kas PT A" panel and the fund check later; nothing here
depends on it.

### 4. Pairing: dedicated table `intercompany_links` (decision)

*As implemented:* a **plain SQL table** (like `document_sequence_counters`), not a Payload collection — the domain
module `domain/intercompany/service.ts` reads / writes it with SQL; text columns with CHECKs instead of enum types, so
the Payload schema snapshot never sees it. Nothing is lost: it had no admin UI ("hidden") anyway.

Options considered: (a) a plain integer "counterpart id" on `cash_entries` / `transfers` without FK; (b) relax
`pk_same_company` for some columns; (c) a dedicated pair table. **Chosen: (c).** Per-PT tables keep their rule "no
reference leaves the PT" (no trigger exception, no new column on `cash_entries` / `transfers` that points across PTs);
the only cross-PT row is in a table whose purpose is to hold two PTs, with real FKs whose company is checked against
the side they belong to.

Table `intercompany_links` (Payload collection `intercompany-links`, hidden, read via the domain only; class "group —
two PTs"):

| Column | Rule |
|---|---|
| `source_company_id`, `target_company_id` | → `companies`, NOT NULL, CHECK distinct; immutable |
| `source_doc_type` | enum `expense_request` (now); Phase C adds `intercompany_loan`, `intercompany_loan_repayment` |
| `source_doc_id` | integer, NOT NULL (polymorphic — no FK; checked by trigger per `source_doc_type`: request of `source_company_id` with `payee_type = pt_grup` and `payee_company_id = target_company_id`) |
| `source_transfer_id` | → `transfers`, nullable (set for `expense_request`), UNIQUE, company = source |
| `source_cash_entry_id` | → `cash_entries` (the KK in A), NOT NULL, UNIQUE, company = source, `direction = out` |
| `target_cash_account_id` | → `cash_accounts`, company = target |
| `target_cash_entry_id` | → `cash_entries` (the KM in B), NOT NULL, UNIQUE, company = target, `direction = in`, `source_type = intercompany` |
| `amount` | integer > 0, = both entries' amount |
| `status` | `posted | void`; `void_reason`, `voided_by`, `voided_at`; `created_by`, `created_at` |
| `uuid` | for a later Odoo mirror (ADR 0009) |

Guards (`…_guard` migration): `pk_ic_link_sides()` (each FK's `company_id` = its side's company, SQLSTATE 23514
`intercompany link side mismatch`); insert-only except `posted → void` with reason (same shape as
`pk_cash_entries_guard`); no DELETE grant; deferred constraint triggers: every `cash_entries` row with
`source_type = 'intercompany'` has exactly one link; a link is `void` **iff** its KM is `void` **iff** its KK is
`void` (fired only `WHEN OLD.status IS DISTINCT FROM NEW.status`, so the renumber CLI's `entry_no` / `description`
updates never trip them). Phase C reuses the table unchanged (new `source_doc_type` values; `source_transfer_id` NULL).

### 5. Ledger: new source type `intercompany`

`enum_cash_entries_source_type` += `intercompany` ("Antar PT"). Used for the **KM in B** only; the KK in A stays
`transfer` (it is the transfer of A's request; `pk_transfers_guard`, `transfers.cash_entry_id` unchanged). The KM:

- account = B's designated account (re-resolved at the transfer; must still carry the snapshot's account number,
  else 409 `INTERCOMPANY_ACCOUNT_CHANGED` "Rekening penerimaan PT LAS berubah sejak pengajuan. Tarik dan ajukan ulang
  pengajuan ini.");
- date = the transfer date; amount = transfer amount; `cashInSource` = new **system** source `ANTAR-PT` ("Antar PT")
  seeded per PT next to `LPJ` (`SYSTEM_CASH_IN_SOURCES`), so Rekap Kas' manual-KM breakdown stays clean;
- no project / cost center (A's analytic tags belong to A; `cash_entries_project_xor` satisfied);
- description `Antar-PT dari <shortCode A>: <judul pengajuan>` — **no PT A document number in the text**; numbers of
  the counterpart are rendered live from the link (see §11 renumber);
- `postedBy` = the Finance user of A who recorded the transfer (truthful initiator; users are not per PT).
- Not editable, not directly voidable: `book.ts` `canEdit/canVoid` false, `voidEntry` refuses with 409 "Kas masuk
  antar-PT di-void lewat pembatalan transfer di PT <A>." unless called with `viaIntercompany`.

`postEntry` gets an internal option `systemCompany: true` that skips only the caller-membership check
(`ledger.ts:181-182`) — callable from the new module `domain/intercompany/service.ts`, never from request input. Lock,
opening-date, account-active and numbering checks run for B exactly as for any posting.

### 6. Transfer (Finance A) — one transaction

`recordTransfer` (`domain/expense/transfers.ts:178-260`) for `payee_type = pt_grup`, inside the existing request
transaction, **before** anything is written:

1. all current checks for A (amount, A's lock, A's account, overdraft of A's account with `confirmOverdraft`);
2. B checks: B active; designated account active and matching the snapshot; transfer date > `pk_cash_lock_date(B)`
   else **409** `INTERCOMPANY_PERIOD_CLOSED` "Periode 2026-09 PT LAS sudah ditutup (tutup buku s/d 2026-09-30).
   Transfer antar-PT tidak dapat dicatat pada tanggal ini — minta Direktur PT LAS membuka kembali periode itu, atau
   catat transfer dengan tanggal di periode terbuka."; transfer date ≥ B account's opening date.

Then: `transfers` row + KK in A (unchanged) → `postIntercompanyReceipt()` posts the KM in B → inserts the
`intercompany_links` row → request `approved → completed` (the vendor row of the state machine, `payees: ['vendor',
'pt_grup']`), audit reason "pembayaran antar-PT selesai dengan transfer". Any failure rolls back everything (the DB
triggers remain the authority: a race with B's closing still ends in 409 from `pk_cash_entries_guard`). Idempotency
key of the endpoint unchanged; the UNIQUE `source_transfer_id` prevents a double KM.

### 7. Void (Finance A)

`voidTransfer` for `pt_grup`: void A's KK (unchanged) → `voidEntry(kmId, reason, {viaIntercompany: true})` posts B's
reversal (dated per the existing rule: the KM date when B's period is open, else today — so a closed period in B never
blocks the void; reversals skip the overdraft check, `ledger.ts:187`) → link `void` → request `completed →
approved` (back to the transfer queue). Only Finance of A (action `transfer_void`, unchanged). B's Finance cannot void
the KM alone (§5). B gets a notification (§9).

### 8. No LPJ

As ADR 0027 §7: `pk_expense_vendor_guard` (no receipt / LPJ statuses) and `settlements_no_vendor_payment` extend to
`pt_grup`; the LPJ rows of the state machine stay `karyawan` only; stepper without "Nota & LPJ"; "Selesai" note
"pembayaran antar-PT selesai saat ditransfer".

### 9. Notifications

- A: unchanged events (`expense.completed` to filer + PM). Fix in the same change: a void `completed → approved`
  (vendor and `pt_grup`) sends `expense.transfer_queue` to Finance instead of `expense.approved` to people
  (`domain/notifications.ts:287-293`).
- B: new events `cash.intercompany_received` ("Kas masuk antar-PT: {entryNo}", "Dari PT {sourceShortCode} {amount} ke
  {account}.") and `cash.intercompany_reversed`, to **Finance and Direktur of B** (`membersWithRole(role, B)`),
  notification `company = B`. Templates editable like any other (event is text, no enum change).

### 10. Audit

- KM in B: the usual `create` + `number_issued` rows with `companyId = B`, actor = A's Finance user,
  `source = system` (`req.context.auditSource`), reason "Kas masuk otomatis antar-PT".
- Link: docType `intercompany_link` (text), action `create` / `void`, **two rows** (one per PT, explicit `companyId`)
  so each PT's audit readers see it; `newValue` = `{ sourceDoc, transferId, kkId, kmId, amount }` (ids only).
- No new `enum_audit_logs_action` value is needed.

### 11. Renumber CLI

No change. Links hold ids; the KM description holds no PT A number; A's own KK description ("Transfer TRF/… — PB/…")
is same-PT and is rewritten as today. The new deferred triggers fire only on status changes (§4). The guard functions
re-created by this change (`pk_expense_vendor_guard`, `pk_settlement_not_vendor`, `pk_expense_requests_project_rules`)
keep the renumber prelude where it exists (integration test `d1310-w4-renumber` stays green).

## API

- `POST` / `PATCH /expense-requests`: `payeeType: 'pt_grup'`, `payeeCompanyId`, `invoiceNo`, `invoiceDate`,
  `invoiceFileId` (required to submit, owner 2026-10-14; `invoiceDueDate` optional). Sync (`domain/sync/service.ts:240,335`): `payee_type`, `payee_company_id`; when an
  existing draft is synced **without** `payee_type` (old APK), the stored payee type is kept, never reset.
- Detail: `payeeType`, `payeeCompany { id, shortCode, name }`, `intercompany { status, targetEntryNo, targetCompany }`
  (after transfer). List filter `payeeType` accepts `pt_grup`. Transfer queue: `payeeType`, `payeeCompanyName`.
- `GET /intercompany/payees?company=` (§2).
- Cash entry detail / Buku Kas row: `intercompany { direction: 'in'|'out', counterpartCompany { shortCode, name },
  sourceDocNo, transferDocNo, counterpartEntryNo, canOpenCounterpart }` — counterpart **numbers and PT name only**;
  a link opens only when the caller has access in the other PT (else plain text).
- Errors: 409 `INTERCOMPANY_PERIOD_CLOSED`, 409 `INTERCOMPANY_ACCOUNT_CHANGED`, 400 `INTERCOMPANY_NO_ACCOUNT`
  ("PT LAS belum menetapkan rekening penerimaan antar-PT."), 403 filer role, 409 direct void of the KM.
- OpenAPI updated; `PayeeTypeEnum` (`api/v1/schemas-flow.ts:33-35`), cash `sourceType` zod enum (:601).

## UI

**Web**

- Pengajuan form: "Jenis penerima" gets "PT grup" (Finance / PM in the form's PT) → "PT penerima" select (payee
  directory) → preview of the receiving account (masked; full number after submit, eye toggle) → required document
  fields (number, date, file); read-only
  summary, stepper, list filter, transfer-queue badge "Antar PT: <PT>".
- Master Data → Akun kas: checkbox "Rekening penerimaan antar-PT" + list badge; Kas page header shows the designated
  account per PT.
- Kas (`admin/views/Kas.tsx`): `SOURCE` label `intercompany` = "Antar PT"; row cell "Dari PT DRMS · PB/DRMS/2610/0012
  · TRF/DRMS/2610/0007"; A's KK row gets "Ke PT LAS · KM/LAS/2610/0003". Void button hidden on the KM with the hint of
  §5. Dashboard "Transaksi kas terbaru" label (`admin/views/Dashboard.tsx:591`).
- PDF Pengajuan Biaya (`pdf/PengajuanBiaya.tsx:259-282`, `pdf/data.ts:170-238`): box "Pembayaran Antar-PT" (PT
  penerima, legal name, invoice / memo if any), transfer box "Info Transfer (rekening PT penerima)", and after the
  transfer "Kas masuk di PT LAS: KM/LAS/…".

**APK** (`apps/mobile`)

- `PayeeType.ptGrup('pt_grup', 'PT grup')`; `fromCode` maps it (old builds show `karyawan` — see Rollout).
- Draft editor: third segment for Finance / PM, "PT penerima" picker (master type `intercompany-payees`, offline
  cache like vendors), masked account preview; validation (`draft_validation.dart`) payee company required; drift
  schema bump (payee company json, like `vendorJson`).
- Detail: section "Pembayaran antar-PT" (PT, account, invoice if any), no LPJ, after transfer the KM number of B;
  timeline note. Finance transfer queue badge; the transfer form shows the two new 409 messages.
- No cash-book screen in the APK → nothing for the KM; the dashboard card takes the server label.

## Reports and dashboards

- **Per-PT views count both legs as real cash** (money really left A and entered B).
- Rekap Kas (`domain/reports/registry.ts:301`, `kpi.ts:278-291`): Rincian row "Antar PT (masuk)" from `source_type`;
  the KK of a `pt_grup` transfer is split from other transfers ("Transfer antar PT (keluar)") by a join on the
  request's `payee_type`. Buku Kas: filter "Sumber" + column "Lawan PT".
- Project figures in A: a `pt_grup` payment is a **cost** of A's project / cost center (like a vendor payment;
  `spending()` unchanged). Loans (Phase C) are a separate document and never enter `spending()`.
- Consolidated views (several PTs selected): owner decision 3 — count and label ("Antar PT"), no elimination; a
  filter "tanpa antar-PT" on Rekap Kas and a toggle on the Direktur cash-flow card leave both legs out.
- Odoo (F7, not built): a link maps naturally to an inter-company pair of moves (`res.company` per PT); noted in the
  ADR 0009 backlog, nothing now.

## Security

- Finance A gets **no** role, read or write in B. The KM is written through one server function inside A's
  authorised transfer, with the membership check skipped only by an internal flag (§5) — not reachable from input.
- The cross-PT rule stays intact for every per-PT table; the only two-PT row is `intercompany_links`, guarded by
  `pk_ic_link_sides`, immutable, no DELETE.
- Data visible across PTs: PT name / short code, the designated account (masked in the directory, full in the A
  snapshot as for vendors), counterpart document numbers, amount. No other B data (balances, other entries) reaches A.
- Isolation suite (`mc-isolation`): user of A only → 404 on B's KM / account by id; payee directory shows no
  non-designated account; a B user cannot void the KM; header spoofing unchanged.
- Approval and transfer authority are A's (rule engine + `pk-finance` in A); B controls only which account receives.

## Effort (estimate, person-days)

| Part | pd |
|---|---|
| Web — migrations (enums, schema, guards incl. deferred link triggers, data) | 2.5 |
| Web — domain: payee validation / snapshot / rules / state machine, `domain/intercompany` (post, void cascade), `postEntry` / `voidEntry` options, notifications, audit | 3.5 |
| Web — API + OpenAPI (requests, payee directory, cash entry counterpart, sync) | 1 |
| Web — admin UI (form, cash-account flag, Kas list/detail, transfer queue, stepper), PDF | 2 |
| Web — reports / dashboard labels + "tanpa antar-PT" filter | 1 |
| Web — tests (unit, integration: transfer / closed period / void / race, `mc-isolation`, renumber regression) | 3 |
| Docs, runbook update (tutup buku, master data), UAT script | 0.5 |
| **Web total** | **≈ 13.5** |
| APK — enum / models / drift bump / mappers / sync | 1.5 |
| APK — editor (segment, PT picker, preview, validation), detail, timeline, transfer-queue badge | 2 |
| APK — tests + release | 1 |
| **APK total** | **≈ 4.5** |

## Migrations / rollout

1. `20261014_100000_d1310_intercompany_enums` (own transaction — `ALTER TYPE … ADD VALUE`):
   `enum_expense_requests_payee_type` += `pt_grup`, `enum_approval_rules_payee_type` += `pt_grup`,
   `enum_cash_entries_source_type` += `intercompany`.
2. `20261014_100100_d1310_intercompany` (Payload schema + `.json` snapshot, additive): `expense_requests.payee_company_id`,
   `cash_accounts.intercompany_receiving`, table `intercompany_links` (+ enum `source_doc_type`), grants.
3. `20261014_100200_d1310_intercompany_guard`: CHECK `expense_requests_payee` (three shapes), CHECK payee ≠ own PT,
   invoice unique index per payee company, `pk_expense_vendor_guard` / `pk_settlement_not_vendor` /
   `pk_expense_requests_project_rules` extended to `pt_grup`, `cash_accounts_ic_receiving_uq` + kind check,
   `pk_ic_link_sides`, link immutability, deferred consistency triggers on `cash_entries` / `transfers` /
   `intercompany_links`.
4. `20261014_100300_d1310_intercompany_data`: per PT the system cash-in source `ANTAR-PT` (+ `SYSTEM_CASH_IN_SOURCES`
   for new PTs) and the rule "Pembayaran antar-PT oleh Finance — Direktur lalu Owner". No account is designated by
   the migration.
5. Staging: Finance / Admin of each PT designate the receiving account. UAT: DRMS Finance files → Direktur → Owner →
   transfer → KM in LAS (numbered `KM/LAS/…`), both detail pages link; LAS period closed → 409; void → reversal in
   LAS, request back in the queue; PM files on a project; APK PM / Finance flow; isolation tests.
6. APK released with the web change; raise `company-settings.minAppVersion` (ADR 0010 #13, `lib/app-min-version.ts`)
   to that build so an old build never edits a `pt_grup` draft (server also keeps the payee type, API section).

## Rollback

- Data: un-designate the receiving accounts → no PT is offered as payee; existing links stay valid.
- Code: `git revert`. The data migration's down deactivates its rules and source; the guard down restores the
  ADR 0027 bodies; the schema down **refuses** when `intercompany_links` or `pt_grup` requests exist (posted ledger
  rows are permanent, ADR 0005) — restore the pre-deploy dump instead before any production use. Enum values cannot
  be removed (Postgres); they stay unused.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Keep manual KK in A + manual KM in B (status quo) | The owner asked for automation; double typing, no link, B often forgets. |
| Represent PT B as a **vendor** of A | A vendor is per-PT master data with no company link; no way to post into B; duplicate master data per pair of PTs. |
| Integer "counterpart id" columns on `cash_entries` / `transfers` (no FK) | No referential integrity; two places to keep consistent; per-PT tables would carry cross-PT data; Phase C would add more columns. |
| Relax `pk_same_company` for `transfer_id` / `expense_request_id` | Weakens the core ADR 0016 isolation guard for every row of the table. |
| KM in B created **pending**, confirmed by B's Finance | Extra step the owner did not ask for ("akan terbentuk kas masuk"); still possible later as a status on the link. |
| KM dated **today** when B's period is closed | Silently moves a transaction into another period; the owner chose refusal. |
| Approval by B (Direktur B) as well | Two PTs' role sets in one approval; not asked; B's control is the designated account. |
| New `source_type` also on A's KK | Would change every report / KPI that counts `transfer` KKs; the request already tells the payee. |

## Owner decisions (2026-10-14; were the open questions of the draft)

1. **Who may file a "PT grup" payment?** **Finance, PM and Direktur (`pk-owner`) of the paying PT** (vendor payments
   remain Finance + PM). Staff / Admin / an Owner (`pk-principal`) without one of these roles cannot (§1).
2. **Is a supporting document (tagihan / memo from the receiving PT) required?** **Mandatory**: document number, date
   and file at submit (same fields as the vendor invoice); the number is unique per receiving PT among live requests
   (DB index + 409 field error `invoiceNo`).
3. **Consolidated reports:** **count and label** intercompany in/out ("Antar PT") with a filter **"tanpa antar-PT"** on
   Rekap Kas and the Direktur cash-flow card; no automatic elimination. Per-PT views always count them.

## As implemented (web / server, `feat/d1310-b-intercompany`)

- **Migrations** `20261014_100000_d1310_intercompany_enums`, `…_100100_d1310_intercompany` (+ the latest Payload
  snapshot `.json`), `…_100200_d1310_intercompany_guard`, `…_100300_d1310_intercompany_data` — as listed under
  "Migrations / rollout", with `intercompany_links` as a plain SQL table (§4) and the document fields required (CHECK
  `expense_requests_payee`, third shape). Renumber: the new trigger functions `pk_ic_consistency` /
  `pk_ic_entry_linked` are on the neutral list (`RENUMBER_NEUTRAL_FUNCTIONS`).
- **Payee directory** also as masters type `intercompany-payees` (APK offline cache): per paying PT `company` where the
  caller is Finance / PM / Direktur, items `{ id = payeeCompanyId, shortCode, name, bankName, accountNoMasked,
  accountHolder }` (unique per `(company, id)`).
- **Receiving account check at the transfer** compares the designated account's number with the submit snapshot; a
  missing designation at the transfer is 409 `INTERCOMPANY_NO_ACCOUNT` (at draft / submit: 400 with the same code).
- **Notifications** of B use events `cash.intercompany_received` / `cash.intercompany_reversed` (doc type
  `cash_entry`; the link opens the cash entry). The void fix (§9) covers every `completed → approved`.
- **Reports**: Rekap Kas columns "Masuk / Keluar antar PT" (when any), breakdown lines "Antar PT (masuk)" /
  "Transfer antar PT (keluar)", filter "Antar PT: Tanpa antar-PT" (balances hidden then — they would not reconcile);
  Buku Kas "Jenis" Antar PT + column "Lawan PT"; Kas page filter "Sumber" + counterpart line per row; dashboard cash
  flow rows carry `masukAntarPt` / `keluarAntarPt` and the Direktur card has the toggle "tanpa antar-PT".
- **Kas page** names the designated receiving account per shown PT ("belum ditetapkan" otherwise).
- **Not done in this change** (follow-up): the APK (enum, editor, detail, queue badge — the API contract is ready).

Decided by the owner already (not asked again): payee type "PT grup", rule-engine approval with Owner, system KM on
B's designated account, void cascades, closed period in B refuses, no LPJ.

## Amendments (applied 2026-10-14 to ADR 0005, ADR 0016 and ADR 0022)

### ADR 0005 — new section "Amendment 2026-10-14 (ADR 0028)"

> *Replaces the last bullet of "Revisi 2026-09-27 (ADR 0016)".* Payments between PTs of the group made through an
> expense request with payee **PT grup** are posted automatically: the transfer's KK in the paying PT and a KM
> (`source_type = intercompany`, system cash-in source `ANTAR-PT`) on the receiving PT's designated account,
> paired in `intercompany_links` (ADR 0028). The KM follows every ledger rule of this ADR (per-PT numbering, period
> lock of the receiving PT — a closed period refuses the transfer —, immutability); it is voided only through the
> transfer void, which posts its reversal. Other inter-PT movements (loans until Phase C) stay manual KK + KM.

### ADR 0016 — new section "Amendment 2026-10-14 (ADR 0028)"

> **§4 classification:** new class **"Group link (two PTs)"**: `intercompany_links` carries `source_company_id` and
> `target_company_id`; each of its references is checked against the company of its own side (`pk_ic_link_sides`),
> not against one `company_id`. It is the **only** table that may relate rows of two PTs; per-PT tables keep the
> `pk_same_company` rule without exception. `expense_requests.payee_company_id` references the app-wide `companies`
> master and is therefore not a cross-PT reference (CHECK: ≠ own PT).
> **§5 mutations:** a mutation authorised in PT A may write into PT B only through a named system function of the
> intercompany module (posting / reversing the paired KM), never with the caller's role in B; it is audited in both
> PTs. Users of A see of B only the PT name, the designated receiving account and counterpart document numbers.
> **Requirements v1.2 §"Di luar cakupan" "Transaksi antar-PT"**: superseded for payee "PT grup" (ADR 0028).

### ADR 0022 — note for Q-L2

> Q-L2 (same-PT loans only) is unchanged by ADR 0028. Phase C's inter-PT loan document will reuse
> `intercompany_links` (`source_doc_type = intercompany_loan` / `intercompany_loan_repayment`) for its disbursement
> and repayments, which then are real cash movements between PTs (unlike same-PT loans, §5 option B).

## Revision history

- **2026-10-14:** proposed (draft for owner review).
- **2026-10-14:** accepted with the owner decisions above (Direktur may file; document mandatory; count + label +
  "tanpa antar-PT"); web / server implementation; amendments applied to ADR 0005, 0016 and 0022.
