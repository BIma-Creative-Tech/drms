# ADR 0031 — Pusat Biaya = akun kas, pinjaman antar project ber-kas

- **Status:** Accepted — user decisions 2026-10-21 (session plan `drms-tolong-cek-resilient-deer`). Implemented on
  `feat/d2110-pb-akun-kas` (migrations `20261021_1000xx`). Staging first; no production deploy without separate owner
  approval.
- **Date:** 2026-10-21
- **Amends:** ADR 0022 §5 (option B "notional allocation" → option A for money between two different accounts),
  DRMS 10/10 D2 (`plans/drms-1010.md`: Finance picks the cost center at the transfer), ADR 0027 (vendor payment without
  project names a cost center), ADR 0005 (new cash `sourceType` `project_loan`), ADR 0023 §1 (site default cost center).
- **Related:** ADR 0029 (fund check per PT, inter-PT loans — unchanged), ADR 0021 (PM project → Direktur).

Paths are relative to `apps/web/src/` unless they start with `apps/mobile/` or `docs/`.

## Context

User request (DRMS 21/10, verbatim):

> 1. Pusat Biaya mengacu pada akun kas, jadi pilihan pusat biaya harus mengacu pada akun kas di PT yang sama
> 2. Pada saat pembuatan project, creator project harus sudah bisa memapping project dengan pusat biayanya, sehingga
>    pada saat pengajuan sudah tidak menentukan pusat biaya
> 3. jadi detail pusat biaya yang sekarang bisa dihilangkan dan mengarah pada akun kas
> 4. jika pada tahapan finance terjadi perubahan akun kas atau pusat biaya, maka akan tercreate otomatis pinjaman antar
>    project, dan tercatatkan
> 5. … akan tercreate otomatis transaksi kas keluar dari project yang dipinjamkan dan ada transaksi kas masuk ke project
>    yang dipinjamkan

Production data (read-only, 21-10): PT 2 holds five bank accounts named after its five CSR projects — one account per
project in practice. ADR 0022 had chosen "no cash entries" because a cash account had no project; the mapping
project → account removes that reason.

## Decisions (user, 2026-10-21)

| # | Question | Decision |
|---|---|---|
| D1 | Pusat Biaya vs cash account | **Pusat Biaya = a cash account of the PT.** The `cost-centers` master is retired (hidden; rows kept for history). |
| D2 | Lender of the automatic loan when one account serves several projects | **The paying account** (no lender project). |
| D3 | Approval of the automatic loan | **Approved automatically** with the transfer; Finance gives a reason; PM project + Direktur notified. |
| D4 | Manual PJ (ADR 0022) | **Money** between two different Pusat Biaya posts KK / KM **when Finance "Cairkan"** after the Direktur's approval; **goods** stay a claim. |
| — | Fund check (ADR 0029) | Unchanged: per PT of the request (a loan inside one PT nets to 0 unless one side is a site account). |

## Design

### 1. Mapping

- `projects.cashAccount` ("Pusat biaya (akun kas)", `fields/pusat-biaya.ts`): active account of the project's PT,
  required on a user create and when a user clears it (`projectCashAccountValidate`); system writes and updates that
  do not send it stay valid (legacy projects). Same PT: `companyHook` + trigger `projects_pb_company_refs`.
- The PM reads the **active** accounts of his PT (collection `cash-accounts` read rule `pk-pm`), names only: bank,
  number, holder, opening balance, Kas settings are field-read for Admin / Finance / Direktur; the collection has no
  menu entry for him; balances stay behind the Kas endpoints.
- `vehicles.cashAccount` replaces `vehicles.costCenter` (kept read-only).
- `cost-centers`: `admin.hidden`; `projects.costCenter`, `transfers.costCenter`, `expense_requests.costCenter`,
  `cash_entries.costCenter` are legacy read-only columns.

### 2. Requests

The requester never picks a Pusat Biaya; the detail shows "Pusat biaya: <account of the project>". A vendor / PT grup
payment may go without project (no Pusat Biaya; Finance picks the paying account); its "PM project → Direktur" rule
decides at the Direktur level only (`resolveSnapshotForRule`, `unscoped`).

### 3. Transfer (`domain/expense/transfers.ts` `recordTransfer`)

`cashAccountId` = the account Finance **pays from** (B); A = `projects.cashAccount` (409 `PROJECT_WITHOUT_PB` when the
project is not mapped).
- B = A: as before (KK on A).
- B ≠ A (project request): `loanReason` required, `loanDueDate` optional (default +30 days). One transaction:
  transfer row (`cashAccount` = A, `paidFromCashAccount` = B) → automatic loan (`project_loans.origin = 'transfer'`,
  approved, numbered PJ, disbursed, lender = account B, borrower = the project / A) with **KK on B + KM on A** →
  transfer **KK on A**. A nets to 0, B carries the payment — the bank statement of B shows the debit.
- Void of the transfer reverses its KK and the loan's KK / KM and cancels the loan; refused while a repayment is posted.
- DB: `pk_transfers_cost_center_required` (replaced): a project request is charged to its Pusat Biaya;
  `transfers_paid_from_loan` (deferred): "paid from" ⇒ its automatic loan.

### 4. Inter-project loans (`domain/loans/service.ts`, `domain/loans/cash.ts`)

- Approval freezes both Pusat Biaya; `cashBacked` = money between two different accounts (`isCashBacked`).
- Cash-backed: "Disetujui – menunggu pencairan" → Finance `POST /project-loans/{id}/disburse` (KK lender, KM borrower,
  once) → repayments by **Finance** (KK borrower, KM lender) → void reverses the pair (Finance only). A disbursed loan
  is not cancelled (settled by repayments); the project-cancel cascade refuses it too.
- Claim (goods / same account): as ADR 0022 (PM or Finance repay, no cash).
- Cash rows: `sourceType = 'project_loan'`, `projectLoan` (+ `projectLoanRepayment`), voided only through the loan.
  DB: `pk_project_loan_cash_check` (deferred) — exactly one posted KK lender + KM borrower per disbursed cash-backed
  loan (none once cancelled), the mirror pair per posted repayment (none once void).

### 5. Reports

- K-15 "Pusat biaya bulan ini" per account: transfers charged to it − LPJ refunds on it + manual cash on it (office).
- Filter `?pusat=` = an account: request reports match requests of projects mapped to it or charged to it; ledger
  reports treat it as `?akun=`.
- Loan legs are internal: excluded from K-02 operational flow (PT level), own lines in Rekap Kas.
- Admin tile "Project tanpa pusat biaya" replaces "Pusat biaya tanpa penanggung jawab".

## Migration / rollout

1. `20261021_100000_d2110_pb_enums` (cash source `project_loan`, audit `disburse`, `auto_create`).
2. `20261021_100100_d2110_pb_schema` (Payload shape + .json snapshot). Down refused once loan cash rows exist.
3. `20261021_100200_d2110_pb_guard` (same PT, transfer rule, loan shape + guard with the renumber prelude, cash legs).
4. **No automatic mapping.** Before go-live the Owner confirms the mapping (proposal in the plan: PT 1 → its single
   account, PT 2 CSR projects → their accounts, PT 4 / PT 6 → their account; PT 3 / PT 5 need an account first);
   entered in the app (project form). Until mapped, the project's transfers are refused (tile on the Admin dashboard).
5. Rollback of the image after the migration: the old image's transfers of a mapped project from another account are
   refused by the DB (choose the Pusat Biaya) — acceptable for a short rollback window.

## Consequences

- Positive: the cash book shows which account financed which project; inter-project money is visible both as a loan
  (outstanding, overdue) and as cash.
- Negative: gross cash in / out per account grows by the loan legs (PT-level operational flow excludes them);
  Finance must give a reason for every payment from another account.
