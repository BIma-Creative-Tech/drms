# ADR 0027 — Pembayaran vendor (vendor payments)

- **Status:** Accepted — implemented on `feat/d1310-w4-vendor` (DRMS 13/10 Wave 4a). Decisions D3 approved by the
  owner; the open points were answered by the client on 2026-10-14 (see "Client answers"). Staging first; no
  production deploy without separate owner approval. **Amended 2026-10-16:** Staff may file vendor payments too (section
  "Amendment 2026-10-16").
- **Date:** 2026-10-14
- **Author:** nextjs developer (branch `feat/d1310-w4-vendor`, from `feat/d1310-w3-dash`)
- **Related:** ADR 0005 (cash ledger), ADR 0006 (audit), ADR 0007 (numbering), ADR 0008 (PDF), ADR 0010 (APK offline),
  ADR 0013 / 0021 / 0024 (approval rules — reused unchanged), ADR 0016 (multi-company), ADR 0019 (LPJ shortfall — not
  applicable to vendor payments).

## Context

Client requirement (DRMS 13/10): *"Pembayaran vendor: kelola vendor dan rekening vendor; finance memilih vendor dan
upload invoice."* Until now every expense request pays the **requester's employee account** and a "Pengajuan Baru"
ends with receipts + LPJ. Vendors existed only as an optional master for receipts (nota) and had no bank accounts.

Approved decision **D3**: Finance **and** PM may file a vendor payment, through the **normal approval flow** (rules of
ADR 0021 / 0024: filed by PM → PM step skipped → Direktur; filed by Finance → Direktur only). The invoice is the
proof: **no LPJ and no selisih**. An upcoming change adds an "Owner" level above Direktur for all requests — vendor
payments therefore stay on the generic rule engine, nothing names a step.

## Decision

1. **Rekening vendor** — new per-PT collection `vendor-bank-accounts` (table `vendor_bank_accounts`), a mirror of
   `employee-bank-accounts`: vendor, bank (the shared bank master), account number (digits 5–34, DB CHECK), holder
   ("Atas nama"), "Rekening default", **verification status** (only Admin / Finance set it), active. PT derived from the
   vendor (company hook + DB trigger), immutable; no delete (deactivate with a reason); a reason on every change of
   bank / number / holder / vendor; audited (`vendor_bank_account`). Access: Admin / Finance create + update, Direktur
   and PM read (the PM files vendor payments and picks the account), Staff nothing. The `vendors` form gets a tab
   **Rekening** (join field, no column) listing the vendor's accounts; Master Data lists "Rekening vendor" too.
2. **Jenis penerima** — `expense_requests.payee_type` = `karyawan` (default; every existing request, behaviour
   unchanged) | `vendor` ("Pembayaran vendor"). It is a property of the request, orthogonal to the request type:
   - a vendor payment is **always type `advance`** ("Pengajuan Baru": paid after approval, before any receipt). The
     server sets it (form, API, APK); the "Jenis" input is hidden for vendor. Reimburse makes no sense for a vendor
     (nobody pre-paid) and is not offered;
   - fields of a vendor payment: `vendor`, `vendorBankAccount` (an active account **of that vendor**, same PT),
     `invoiceNo`, `invoiceDate` (not in the future), `invoiceDueDate` (optional, not before the invoice date),
     `invoiceFile` (photo / PDF in `media-attachments`, linked to the request at submit like "Lampiran umum"). Vendor,
     account, invoice number, date and file are **required to submit**. The employee account (`bankAccount`) stays
     empty; the requester picker is hidden: **Pemohon = the filer himself** (his own employee in the PT), so the
     approval routing follows the filer's role;
   - **project OR cost center** (client answer 2026-10-14): a vendor payment is filed on a project, or — without a
     project, e.g. office bills — on a **cost center (pusat biaya)**. Employee requests keep D2 unchanged (project
     required; the requester never sets a cost center; Finance sets it at the transfer), so this is a vendor-payee
     exception: the `costCenter` field is writable only for the vendor payee (field access), "Pilih project atau pusat
     biaya" at submit, and the DB rule `pk_expense_requests_project_rules` (D2) is widened for `payee_type = vendor`
     only (guard migration). Project wins when both are given. A PM files only on his own projects / cost centers
     (existing scope check G10); approval routing of a cost-center vendor payment is the normal rule engine (Finance
     rule → Direktur; a PM's → the default rule, "Diketahui" by the cost center's manager, skipped when that is the
     PM himself). At the transfer Finance's cost center defaults to the request's own one.
3. **Who may file (D3)** — the creator must hold **Finance or PM in the request's PT** (403 "Pembayaran vendor hanya
   dapat diajukan oleh Finance atau PM di PT ini."). Staff, Admin and Direktur cannot file vendor payments; the form only
   offers "Vendor" to Finance / PM (UI hint, the server is the authority). Confirmed by the client 2026-10-14.
4. **Approval** — the generic engine (`rules.ts`, `snapshot.ts`) with one new rule condition **"Jenis penerima"**
   (`approval_rules.payee_type`: `any` (default, every existing rule) | `karyawan` | `vendor`; counts as one more
   specificity like "Peran pemohon"; addendum rules: `any` only — hook + DB CHECK). Seeded per PT (data migration
   `20261013_700200_d1310_vendor_payments_data`, `seed/data.ts`, copied to new PTs) the rule
   **"Pembayaran vendor oleh Finance — Direktur lalu Owner"**: Jenis penerima = Vendor, Peran pemohon = Finance, no
   "Diketahui", levels Direktur then Owner (ADR 0026, `pk-principal`), priority 20. Result:
   - **filed by Finance** → that rule → **Direktur → Owner**;
   - **filed by a PM** → the PT's default rule (PM project → Direktur → Owner); the PM step is skipped and recorded because the
     filer is the project's PM (ADR 0013 G1-2, unchanged). A PM filing on a project whose PM is someone else gets that
     PM's approval first (same as any request).
   Admins can change / add rules in the UI as for any request (e.g. an amount band for vendor payments). The upcoming
   Owner level is added to these rules like to every other rule.
5. **Duplicate invoice** — the same vendor + the same **normalized** invoice number (upper case, letters and digits only:
   `INV/2026-01` = `inv 202601`) on a request that is not *Dibatalkan* / *Ditolak* (Draft included) → **409** with the
   field error `invoiceNo` ("Invoice … dari vendor ini sudah dipakai di pengajuan …"); the admin form marks the input.
   DB guard: partial unique index `expense_requests_vendor_invoice_uq` on `(vendor_id, pk_invoice_key(invoice_no))`. A
   rejected request may be re-filed ("Ajukan ulang" keeps vendor + invoice); "Duplikat" copies vendor + account but
   **not** the invoice.
6. **Transfer** — Finance's existing transfer (antrian transfer, web + APK) pays the **snapshot of the vendor account**
   taken at submit (`bankSnapshot`, the same columns as the employee snapshot → `transfers.destination`). An
   **unverified vendor account** needs the same confirmation as an unverified employee account
   (`confirmUnverifiedAccount`, 409 `BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED`, audit `bank_unverified_confirmed` with
   `accountKind: vendor`). Transfer kind stays `advance` (cash reports unchanged); the KK cash-out is posted as before.
7. **Status flow** — `draft → (Menunggu persetujuan …) → approved → completed`: the transfer **completes** the vendor
   payment (`transfer` vendor row of the state machine, audit reason "pembayaran vendor selesai dengan transfer");
   there is no "Ditransfer", receipts, LPJ, selisih or settlement. "Void transfer" brings it back to the transfer queue
   (`completed → approved`, vendor only; the LPJ `settle_reverse` stays employee-only). The state machine gets a payee
   dimension (`TRANSITIONS[].payees`): the LPJ rows are `karyawan` only. DB guard `pk_expense_vendor_guard`: a vendor
   payment never takes a receipt / LPJ status; `settlements_no_vendor_payment`: no LPJ row for it;
   `expense_requests_payee` CHECK: an employee payment carries no vendor data, a vendor payment is `advance` without an
   employee account and — outside Draft / Dibatalkan — has vendor, account, invoice number, date and file.
8. **Visible** — web form (label-left grid): "Jenis penerima", then Vendor → Rekening vendor (preview with the masked
   number, eye toggle) → Nomor / Tanggal invoice / Jatuh tempo / File invoice; the read-only summary, the stepper
   (no "Nota & LPJ" / "Penyelesaian LPJ"; "Selesai" note "pembayaran vendor selesai saat ditransfer"), the PDF (box
   "Pembayaran Vendor" + the invoice as first Lampiran, Jenis "Pembayaran vendor"), the transfer queue badge
   "Pembayaran vendor: <vendor>", list filter "Jenis penerima". API: `payeeType`, `vendorId`, `vendorBankAccountId`,
   `invoiceNo`, `invoiceDate`, `invoiceDueDate`, `invoiceFileId` on POST / PATCH `/expense-requests`; list `payeeType`
   filter; detail `payeeType`, `vendor`, `vendorBankAccountId`, `invoice`; transfer queue `payeeType`, `vendorName`;
   masters type `vendor-bank-accounts`; bank preview `vendorAccount`. APK: PM / Finance file a vendor payment (offline
   draft like any request), detail without LPJ.

## Consequences

- Positive: one request model, one approval engine, one transfer path; the vendor account is verified by Finance like
  employee accounts; double payment of an invoice is blocked in the app and in the DB.
- The filer is always the requester of a vendor payment — a PM cannot file "on behalf of" Finance or vice versa.
- Reports keep counting vendor payments as Pengajuan Baru money (kind `advance`), now with status Selesai right after
  the transfer (no open LPJ). Reports can filter on `payee_type` later if the client wants a separate column.
- Vendors without accounts cannot be paid: Finance / Admin add the account (tab Rekening) first.

## Client answers (2026-10-14)

1. Vendor payment without a project: **yes, on a cost center** (pusat biaya), e.g. office bills — decision 2 above.
2. Invoice **due date**: stays **optional**.
3. Who files: **Finance and PM only** (no Admin / Direktur).
4. Partial / term payments of one invoice: **no** — one invoice = one request (duplicate rule unchanged).
5. Amount band on the Finance vendor rule: **no**. The upcoming Owner level is a separate change (after PR #62) on the
   generic rule engine.

## Amendment 2026-10-16 — Staff may file vendor payments

Owner request 2026-10-16: *"untuk pengajuan vendor dibukakan di level staff"*. Decision 3 and client answer 3 are
widened; everything else of this ADR is unchanged.

1. **Who may file** — Staff (`pk-staff`), Finance or PM **in the request's PT** (`VENDOR_PAYMENT_ROLES` =
   `['pk-finance', 'pk-pm', 'pk-staff']`; 403 "Pembayaran vendor hanya dapat diajukan oleh Staff, Finance atau PM di PT
   ini."). Admin, Direktur and an Owner (`pk-principal`) without one of these roles still cannot. "PT grup" (ADR 0028,
   `INTERCOMPANY_PAYMENT_ROLES`) is **unchanged** (Finance / PM / Direktur). The existing Staff rules apply as for any
   Staff request: Pemohon = the Staff himself (QA-15 + the filer rule), only projects / cost centers the Staff is
   assigned to (G10), vendor and account of the request's PT.
2. **Approval** — no new rule and **no migration**: a Staff vendor payment takes the **normal Staff flow**, the PT's
   default rule ("Default — PM project lalu Direktur"): **PM project** ("Diketahui" = Persetujuan PM; on a cost center
   without project: its manager) → **Direktur** → **Owner** → Finance transfer → Selesai (no LPJ). The seeded rule
   "Pembayaran vendor oleh Finance — Direktur lalu Owner" keeps "Peran pemohon = Finance" and therefore does not match a
   Staff requester (a Staff who also holds Finance in the PT is a Finance requester, as before). Rules an Admin added with
   "Jenis penerima = Vendor" and no "Peran pemohon" apply to Staff vendor payments too — check them before the rollout.
3. **Read access** — Staff READ `vendors` and `vendor-bank-accounts` of the PTs they are mapped to (collection access,
   so also REST, the masters types `vendors` / `vendor-bank-accounts` of the APK and the bank preview of the form), never
   of another PT; **no** create / update (Admin / Finance as before; the vendor page `/admin/vendor/<id>` opens read-only).
   The Staff panel still hides the Master Data lists (`STAFF_VISIBLE_COLLECTIONS` unchanged); the pickers of the request
   form work through the relationship drawer. Vendor account numbers are business data shown in full to their readers
   (like the PM since this ADR); the snapshot at submit is unchanged.
4. **Visible** — web: "Jenis penerima" offers *Vendor* to a Staff of the form's PT (the "+ Buat" menu stays without a
   Staff button: Staff use **+ Buat pengajuan**); APK: the editor offers *Vendor* to Staff (`mayFileVendorPayment`).
   A Staff sees the amounts of his own request (owner decision, unchanged). OpenAPI descriptions updated
   (no contract shape change).
5. **Rollback** — `git revert` (code only); Staff vendor payments already filed stay valid and continue through their
   snapshot.

## Rollout

1. Merge → staging; migrations `20261013_700000_d1310_vendor_payments` (schema, additive),
   `…_700100_…_guard`, `…_700200_…_data` (rule per PT).
2. Finance / Admin: add vendor accounts (Master Data → Vendor → tab Rekening), verify them.
3. UAT: Finance files a vendor payment → Direktur approves → transfer (unverified account confirmation) → Selesai;
   PM files → (PM step skipped) Direktur → transfer; duplicate invoice → 409; APK PM flow.

## Rollback

- Data: deactivate the rule "Pembayaran vendor oleh Finance — Direktur lalu Owner" (vendor payments then follow the default rule).
- Code: `git revert`; the data migration's down deletes / deactivates its rules; the guard migration's down drops the
  triggers / checks / index; the schema down drops the columns and the table (vendor payments are lost — restore the
  pre-deploy dump instead when any exist).
