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

### 6. Fund check per Pusat Biaya first (amendment, user 2026-10-22)

ADR 0029 kept the fund check per PT. With every project mapped to a Pusat Biaya that hid free money. In production,
PT LAS was short overall: 196 jt in five accounts against 286 jt of commitments, most of them on CSR BULUNGAN. A
17 jt request of a CSR SEPASO project was blocked even though CSR SEPASO itself had 51 jt and no commitment. User
decision **"PB dulu, lalu PT"**:

- **Dana bebas Pusat Biaya** = balance of the project's account. A site account counts here, because it is the
  project's own account. From that balance subtract the account's commitments:
  - approved-but-not-transferred requests of the projects mapped to the account;
  - their verified, unpaid LPJ shortfalls;
  - approved, cash-backed inter-project loans the account lends that are not yet disbursed.

  SQL: `pk_pb_balance` / `pk_pb_commitments`.
- The final approval (and the Owner's own submit) passes when the request is covered by the Pusat Biaya **or** by the
  PT's "Dana tersedia" (ADR 0029, unchanged), whichever is larger. SQL: `pk_request_fund_available(company, project)`.
  The DB backstop `pk_expense_fund_guard` uses the same function, under the same per-PT lock.
- Route shown in the panel (web + APK `fundCheck.route` / `routeText`):
  - `pusat_biaya`: Finance pays from the Pusat Biaya.
  - `other_account`: the Pusat Biaya is short but the PT has the money. Finance pays from another account, and the
    transfer creates the automatic inter-project loan (§3).
  - `pt`: no mapped project; the PT has the money.
  - `short`: neither covers the request. Reject it, or the Owner orders an inter-PT loan.
- Requests without a project (vendor / PT grup) and projects not yet mapped are checked per PT only, as before.
- Consequence: an overcommitted account no longer blocks the other projects of its PT. The PT total can go further
  negative, and the dashboard and the PT figure in the panel still show that.

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

## Amendment 2026-10-24 (DRMS 24/10 #11–#12)

User decisions 2026-10-24; the approval side (PM / Finance file, Direktur → Owner) is ADR 0022 "Amendment 2026-10-24".

- **Transfer order instead of "Cairkan".** After the Owner's approval a cash-backed manual loan is a **transfer order** in
  Finance's **Antrian Transfer** (web section "Transfer pinjaman antar project", APK Antrian Transfer;
  `GET /project-loans/transfer-orders`, office roles of the PT read, Finance executes). Finance gives the transfer date
  (loan date … today), an optional note and an optional proof (stored on the KK); the accounts are the ones frozen at
  the approval. `POST /project-loans/:id/execute` posts, in one transaction, **KK on the lender account tagged with the
  LENDER project + KM on the borrower account tagged with the BORROWER project** (before: the lender leg had no project)
  and records `disbursed_at` / `disbursed_by` (DB: a Finance member of the PT). The loan page shows "Eksekusi di Antrian
  Transfer" (a link) instead of "Cairkan"; `POST /project-loans/:id/disburse` stays for older APKs and runs the same
  execution. **No Finance self-guard on loans:** the Finance user who filed the loan (or the repayment) may execute it;
  the audit row carries `selfExecuted: true` and the queue says so.
- **One shared account is cash-backed too.** Money (`dana`) between two projects whose Pusat Biaya is the SAME account
  is now `cash_backed`: the KK / KM pair is posted on that account, each leg tagged with its project, so both project
  cash books show the loan (the account nets to 0; the KM is posted first). CHECK `project_loans_cash_backed` allows it
  for manual loans (an automatic loan still needs two different accounts). `pk_project_loan_cash_check` needed no change
  (KK and KM are counted per direction on the frozen accounts). Goods stay a claim (no cash, no queue; two levels still).
  A loan approved before this change between two projects of one account stays a claim (`cash_backed` is frozen at the
  approval).
- **Repayment = request + transfer order.** A repayment of a cash-backed loan (manual or automatic) is requested by the
  borrower PM or Finance, approved Direktur → Owner, then executed by Finance from the queue: **KK on the borrower
  account tagged with the borrower project + KM on the lender account tagged with the lender project** (none for an
  automatic loan); the repayment becomes `posted` with the execution date and the loan Sebagian kembali / Lunas — one
  transaction. Void of an executed repayment reverses the pair (unchanged). A transfer void of an automatic loan is
  refused while a repayment request is open.
- **Fund check.** `pk_pb_commitments` (and the panel items): an approved, not executed loan counts on the lender account
  only when the money leaves it (two different accounts); an approved repayment order counts on the borrower account the
  same way (item kind `project_loan`, status `repayment_approved`).
- **Migrations:** `20261024_400000_d2410_loan_enums` (repayment statuses, approvals doc type),
  `_400100_d2410_loan_schema` (+ .json snapshot), `_400200_d2410_loan_data` (in-flight pending loans → level 1),
  `_400300_d2410_loan_guard` (loan / repayment / approval guards, CHECKs, commitments). Already approved, not disbursed
  cash-backed loans need no data change: they appear in the queue.

## Amendment 2026-10-24 (DRMS 24/10, user decision) — PT figures without the site exclusion

Because every project is mapped to a Pusat Biaya account, the PT figures behind "Seluruh PT" (`pk_fund_balance`, ADR
0029 §1) count every active account of the PT — accounts once flagged with a site included (migration
`20261024_500000_d2410_site_accounts_fund` clears the flags, audited). The Pusat Biaya figures (`pk_pb_balance`) never
excluded them; nothing changes there.
