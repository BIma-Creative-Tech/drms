# ADR 0029 — Cek dana di persetujuan Owner + Pinjaman antar-PT

- **Status:** Accepted — the owner answered "setuju" (2026-10-14) to every recommended default of "Pertanyaan untuk
  owner" (recorded under "Owner decisions (2026-10-14)"); the decisions of 2026-10-13 were built in already. Web /
  server implemented in `feat/d1310-c-fundcheck` (migrations `20261015_1000xx`–`1003xx`, see "As implemented"); the APK
  part is a separate follow-up (contract below). Staging first; no production deploy without separate owner approval.
- **Date:** 2026-10-14
- **Author:** Analyst (draft, branch `feat/d1310-c-fundcheck`, from `main` `9be31b3`; Phases A and B merged there);
  implementation by the nextjs developer on the same branch (merged with release 0.10.0, `00a02d0`)
- **Extends:** [ADR 0026](0026-owner-approval-level-above-direktur.md) (the Owner level gets a fund check) and
  [ADR 0028](0028-intercompany.md) (the PT grup plumbing — designated receiving account, `intercompany_links`, system
  Kas Masuk, paired void — is reused for loans).
- **Amends (draft text in "Proposed amendments" below):** [ADR 0022](0022-inter-project-loan.md) (Q-L2: money between
  PTs is now a separate document, same-PT project loans unchanged), [ADR 0028](0028-intercompany.md) §4 / §5 (two
  new `source_doc_type` values; the payer's KK of a loan movement is `source_type = intercompany`),
  [ADR 0016](0016-multi-company.md) (two more "group — two PTs" tables), [ADR 0005](0005-cash-ledger-own-model.md)
  (another automated inter-PT movement), [ADR 0007](0007-document-numbering.md) (doc type `PJA`).
- **Related:** ADR 0006 (audit), ADR 0010 (APK), ADR 0011 (notifications), ADR 0013 / 0021 / 0024 (approval rules,
  G1), ADR 0019 (LPJ shortfall), ADR 0023 (site flag on cash accounts), ADR 0025 (Direktur signature), ADR 0027
  (vendor payments).

Paths are relative to `apps/web/src/` unless they start with `apps/mobile/` or `docs/`.

## Context

### Client requirement (DRMS 13/10, Phase C, verbatim)

> "pada saat owner melakukan approval di setiap pengajuan, apakah munngkin pengajuan melakukan pengecekan
> ketersediaan dana di akun masing-masing PT, sehingga jika pengajuan melebihi jumlah ketersediaan maka approval tidak
> bisa dilakukan dan owner mendapatkan notifikasi, serta action berikutnya untuk memerintahkan finance ambil pinjaman
> dari pt yang memiliki ketersediaan dana, dan otomatis membentuk perintah transfer kas keluar dari pt tersebut?"

Three parts: (1) at the Owner's approval, check the PT's available funds; (2) when the request exceeds them, the
approval is refused and the Owner is notified; (3) the Owner can then order Finance to borrow from a PT with funds,
which automatically creates the cash-out transfer order in that PT.

### Owner decisions already made (2026-10-13)

| # | Decision |
|---|---|
| OD-1 | Funds = all bank and cash accounts of the PT **except site petty-cash accounts**. |
| OD-2 | **Hard block**: the Owner cannot approve when the request amount exceeds the available funds. |
| OD-3 | The "PT grup" payee (ADR 0028) also covers non-loan payments; the loan **reuses** it. |
| OD-4 | The Owner level (`pk-principal`, ADR 0026) is the last approval step: Direktur → **Owner** → Finance transfer. |

### Current model (read on `main` `9be31b3`)

| Area | Fact | Evidence |
|---|---|---|
| Approve | `approve()`: lock request, G1/G2, decision row, last level → `approved` + `approvedAmount = grandTotal`, `approvedAt`; nothing reads cash | `domain/expense/workflow.ts:339-366` |
| Owner's own request | rule "Pengajuan Owner" (zero steps) → `principal_no_approval`, `pending_approval → approved` inside `submit` | `domain/expense/decision.ts:88`; `workflow.ts:275`; `domain/expense/receipts.ts:401-402` |
| Owner turn | `ownerTurn()` = current step is role Owner (notifications) | `domain/notifications.ts:98-105` |
| Transfer queue | advance `approved`, reimburse `receipts_verified` | `domain/expense/types.ts:229-234` |
| Committed statuses | `BUDGET_COMMITTED` (approved … completed) — project budget only, not cash | `domain/expense/types.ts:168-178` |
| Account balance | opening + Σ in − Σ out over all rows; `balances()` per account with `site_id`, `active` | `domain/cash/ledger.ts:134-141`, :443-467 |
| Overdraft check | per account, `pg_advisory_xact_lock('pk:cash-account:<id>')`, 409 `CASH_OVERDRAFT_CONFIRM_REQUIRED` unless confirmed (soft) | `domain/cash/ledger.ts:150-165` |
| Site flag | `cash_accounts.site_id` (ADR 0023 Q-S7): "kas kecil / rekening kantor cabang" — petty cash **and** branch bank accounts | `collections/CashAccounts.ts:120-131` |
| Account kinds | `kind cash|bank`, `active`; no currency column (integer Rupiah everywhere) | `collections/CashAccounts.ts:99-112`; `domain/cash/ledger.ts:182` |
| PT grup payment | payee `pt_grup`, designated receiving account per PT, KK `transfer` in A + system KM `intercompany` in B, link row, paired void | ADR 0028; `domain/intercompany/service.ts:192-345`; `domain/expense/transfers.ts:186-312` |
| Link table | `intercompany_links`, `source_doc_type` CHECK `IN ('expense_request')`; sides trigger requires KK `source_type = transfer` | `migrations/20261014_100100_d1310_intercompany.ts:34-63`; `migrations/20261014_100200_d1310_intercompany_guard.ts:118-152` |
| Link consistency | deferred `pk_ic_consistency` (status changes only), `pk_ic_entry_linked` (KM `intercompany` must have a link) | `…_100200_d1310_intercompany_guard.ts:168-205` |
| System posting | `postEntry(…, { systemCompany: true })` skips only the membership check | `domain/cash/ledger.ts:174-198` |
| Reports | `INTERCOMPANY_ENTRY_SQL` (link legs), Rekap Kas "Transfer antar PT (keluar)", "tanpa antar-PT" filter; `spending()` = request transfers + **manual** KK only | `domain/reports/kpi.ts:197-198`, :308, :845-862 |
| Project loans | same PT only (Q-L2), notional (no cash entries), `PJ/{COMPANY}/{YYMM}/{seq}` | ADR 0022; `domain/numbering.ts:123` |
| Numbering | `DOC_TYPES`, `DEFAULT_SEQUENCES` per PT, counter per `(company_id, doc_type, period_key)` | `domain/numbering.ts:11-26`, :111-123 |
| Renumber lists | `RENUMBER_GUARDED_FUNCTIONS` / `RENUMBER_NEUTRAL_FUNCTIONS` (trigger functions on renumbered tables) | `migrations/20261013_610000_d1310_renumber.ts:33-65` |
| Reminders | `REMINDER_RULES` incl. `loan_overdue` (ADR 0022 Q-L6) | `domain/reminders/rules.ts:8-17` |
| LPJ shortfall | settlement `verified` with type `shortfall` is paid at `settle`; above tolerance → re-approval (ADR 0019) | `domain/expense/settlement-rules.ts:5`, :16; `domain/expense/shortfall-approval.ts` |

Consequences for the design: (1) there is no notion of "funds of a PT" — only per-account balances, checked softly
and only at posting time; (2) approval does not reserve money, so two approvals can both pass on the same balance;
(3) the only cross-PT money path is a PT grup **payment** (an expense with invoice, counted as cost); (4) the link
table and its triggers assume a `transfers` row and an expense request on the source side.

## Decision

### 1. "Dana tersedia" (available funds) of a PT

**Formula (one definition, used by the Owner check, the lender list, the loan execution and the repayment):**

```
Dana tersedia(PT) = Saldo dana(PT) − Komitmen(PT)

Saldo dana(PT)  = Σ balance of the PT's cash accounts with active = true AND site_id IS NULL
                  (balance = opening balance + Σ in − Σ out over all rows, the K-01 / accountBalance rule;
                   voids cancel through their reversal rows; a negative account reduces the sum)

Komitmen(PT)    = Σ (approved_amount − transferred_total) of the PT's requests waiting for money:
                     advance  in status approved                         (Disetujui — Antri Transfer)
                     reimburse in approved / receipt_revision / receipts_verified
                + Σ shortfall of the PT's LPJ that are verified, type shortfall, not settled
                + Σ amount of inter-PT loans INSTRUCTED with this PT as lender, not yet disbursed (§3)
```

Decisions inside the formula:

- **Accounts (OD-1):** every active account (`kind` cash or bank) **without a site**. ADR 0023 uses the site flag for
  "kas kecil / rekening kantor cabang", so a branch bank account tagged with a site is excluded too (Q-3). Inactive
  accounts are excluded: Finance cannot pay from them (`assertAccount`). Balance as of now (postings are never
  future-dated).
- **Commitments are subtracted (recommendation, Q-1).** Without them the hard block is meaningless: with Rp 120 jt in
  the bank the Owner could approve two Rp 100 jt requests one after the other, because the first is not yet
  transferred. With them, approval **reserves** the money: a transfer later lowers the balance and the commitment by
  the same amount, so "Dana tersedia" does not move when Finance pays. Requests "approved but not yet transferred" and
  "Owner-approved and in the transfer queue" are the same set once the Owner is the last level; both are covered, as
  are requests approved under older snapshots without an Owner level. Requests still **pending** (any level, incl.
  other requests at the Owner) are **not** committed — first approved, first served — but the panel shows them (§2).
  Cost: a stale approved request keeps blocking until Finance transfers or cancels it; the panel lists the
  commitments so the Owner sees which ones.
- **Per PT, the paying PT:** `expense_requests.company_id`. Payee type does not matter: employee, vendor and PT grup
  payments are all money leaving the paying PT. For a PT grup payment A → B only A is checked (B's funds rise only at
  the transfer).
- **LPJ shortfall payments are counted, not blocked:** a verified shortfall is a commitment, but `settle` (and the
  ADR 0019 re-approval) is **not** hard-blocked in this phase — it reimburses money employees already spent on
  approved work; the account-level overdraft confirmation stays.
- **IDR only.** Every amount is integer Rupiah (`postEntry` "Nominal harus bilangan bulat Rupiah", no currency
  column on accounts or entries). Nothing to convert; a foreign-currency account would need its own ADR.

**Where the check runs (hard block, OD-2):**

| Moment | Rule |
|---|---|
| **Owner approval** (last level, normal case) | `needed = grandTotal` of the request (it is not yet committed); `needed > Dana tersedia` → refused (§2). |
| **Final approval of a snapshot without an Owner level** (requests submitted before ADR 0026, or a rule an admin built without the Owner) | Same check at the decision that makes the request `approved`, whoever takes it. The blocked approver (Direktur / Finance) sees the panel; the Owner of the PT is notified and is the only one who can instruct a loan. Keeps the invariant "nothing enters the transfer queue beyond the PT's funds" (Q-2). |
| **The Owner's own request** (`principal_no_approval`, straight to Finance) | Checked at **submit**: the transition `pending_approval → approved` happens there. Insufficient → 409, the whole submit rolls back, the request stays **Draft**; the draft shows the panel and "Perintahkan pinjaman antar-PT" (Q-2). |
| Reimburse re-approval (receipts resubmitted with a new total) | The re-approval's final decision is checked like any approval (the request is not committed while pending). |
| **Finance transfer** | **No new block** — the money was reserved at approval. The transfer form shows "Dana tersedia PT sesudah transfer" as information; the existing per-account overdraft confirmation (QA-04) stays the only stop. Blocking here would strand already-approved requests with nobody able to resolve them. |
| Loan disbursement (lender) and repayment (borrower) | Hard check on the paying PT (§3.4, §3.6). |

**Per-PT switch:** `companies.fundCheckEnabled` (default **off**). The check reads the cash book; if Finance has not
recorded every bank movement (opening balances, client payments as KM), the hard block would refuse correct
approvals. The switch is turned on per PT after Finance confirms the balances match the bank statements (Rollout
step 4). Changed only by a group admin, reason required, audited. Off = behaviour of today plus the read-only panel.

**Concurrency — advisory lock per PT (chosen), not SERIALIZABLE.** Every operation that can **lower** a PT's
available funds takes `pg_advisory_xact_lock(hashtextextended('pk:fund:<companyId>', 0))` before it reads or writes:
the fund check (approve / submit), `postEntry` (every posting of an account of the PT — KK, KM, reversals; one lock
per posting, cheap), loan instruction create, disbursement, repayment and their voids. Two Owner approvals in the same
PT therefore serialise: the second reads the first's commitment after it commits (READ COMMITTED sees committed rows
per statement). Lock order, to stay deadlock-free: request row lock (existing `loadVisible({lock:true})`) → fund
lock(s) in **ascending company id** (a two-PT operation takes both up front) → account lock (`checkOverdraft`).
SERIALIZABLE was rejected: it would have to wrap Payload's whole request transaction, turn every concurrent write into
a retryable 40001 for the client, and the app runs READ COMMITTED everywhere today.

**DB backstop:** trigger `pk_expense_fund_guard` (BEFORE UPDATE on `expense_requests`, fired only when
`OLD.status IN ('pending_ack','pending_approval') AND NEW.status = 'approved'` and the PT's `fund_check_enabled`)
takes the same advisory lock and raises SQLSTATE 23514 `fund check: PT % available % < needed %` when
`pk_fund_available(company_id) < NEW.approved_amount`. The row itself is not yet counted (the commitment query sees
the OLD status). The service check runs first and answers the coded 409; the trigger only catches a path that
forgets it.

### 2. Block UX (Owner)

- **Panel "Ketersediaan dana PT <code>"** on the request detail (web + APK) whenever the request waits at the Owner
  level (or at a final level of §1), for callers with Kas view in the PT (Finance, Direktur, Owner):
  *Saldo dana* (with "n akun, tanpa akun site") − *Komitmen* (expandable list: request no., status, amount; open
  loan instructions) = **Dana tersedia**; *Dibutuhkan* = this request; **Kurang** = needed − available (red) or
  "Cukup" (green). Also: "Pengajuan lain menunggu persetujuan Owner di PT ini: n, total Rp X" (not committed). The
  Direktur sees the panel read-only at his step ("cek akhir di Owner").
- **Setujui is disabled** while short, with the text "Dana PT tidak cukup — kurang Rp X. Tolak, atau perintahkan
  pinjaman antar-PT." The server is the authority: `POST …/approve` answers **409 `FUND_INSUFFICIENT`** with
  `{ companyId, balance, commitments, available, needed, gap }` and writes a detached audit row
  `fund_insufficient` (the refused attempt stays recorded, like `access_denied`). Nothing else changes.
- **The request stays pending at the Owner step** (status, level, cycle unchanged). It is **not** rejected; the Owner
  may still Tolak with a reason. Inbox row badge "Dana kurang Rp X" (computed live: one availability per PT, each
  request compared on its own).
- **Notification `expense.fund_shortfall`** to the Owner(s) of the PT (exact role `pk-principal`) when the request
  reaches the Owner level and the check fails at that moment (title "Dana PT {company} tidak cukup: {docNo}", body
  "Dibutuhkan {needed}, tersedia {available}, kurang {gap}. Perintahkan pinjaman antar-PT atau tolak."), in addition
  to the normal `expense.pending_approval`. Once per request and cycle (not repeated when availability changes;
  the badge is live). Push + in-app, template editable (event is text).
- **Action "Perintahkan pinjaman antar-PT"** on the panel (Owner only, `allowedActions` gains `instruct_loan`) opens
  the instruction form with the borrower = this PT, the request pre-linked, amount = gap (§3).
- **After the loan arrives the Owner approves again** (recommendation, Q-5): the request is **not** approved
  automatically. An approval is a signed decision (ADR 0025 signature, `approvals` row with the actor); the money may
  also have been consumed by another approval in between, and the Owner may prefer to reject after all. When the
  disbursement posts, the Owner gets `icloan.disbursed` listing the linked requests now covered ("Dana pinjaman
  PJA/… masuk di PT LAS; PB/LAS/2610/0012 siap disetujui") with deep links; the re-check runs at that approval. No
  earmarking of the loan for the linked requests (the Owner controls the order of his own approvals).

### 3. "Pinjaman antar-PT" (inter-PT loan, doc code `PJA`)

#### 3.1 Own document reusing the PT grup plumbing (decision, Q-4)

| Option | Assessment |
|---|---|
| **A. Expense request, payee `pt_grup`, in the lender PT** (flag "pinjaman") | Reuses the transfer queue / form / TRF / void unchanged — but: a request needs a filer in the lender PT who is Finance / PM / Direktur (ADR 0028 §1 — the Owner alone may not file), a rule-engine approval in the lender PT (the Owner already decided), lines with categories and a project or cost center; the mandatory, unique "invoice" of the receiving PT (owner 2026-10-14) does not exist for a loan; a PT grup payment is a **cost** of A (`spending()` "dicairkan" counts its lines, RAP / budget committed) — a loan is a receivable, not a cost; there is no due date, outstanding, partial repayment or overdue; the repayment would be another PT grup "payment" in B, also counted as B's cost. Every report and guard would need a loan exception. |
| **B. Own document `intercompany-loans`, reusing ADR 0028's mechanism** (chosen) | The **movement** is exactly PT grup: B's designated receiving account (ADR 0028 §2), the system Kas Masuk `intercompany` with source `ANTAR-PT`, the pairing in `intercompany_links`, the period-lock / opening-date checks of the receiving PT, the paired void, the "Antar PT" label, the counterpart rendering and the "tanpa antar-PT" filter. What differs is the document that carries it: an Owner instruction with amount, due date, outstanding and repayments, never a cost. |

So OD-3 ("the loan reuses PT grup") holds at the level of the money movement; the loan is not an expense request.
`domain/intercompany/service.ts` is refactored into a generic `preparePair` / `postPair` / `voidPair` (payer KK +
receiver KM + link) used by the PT grup payment (unchanged behaviour) and by the loan movements.

#### 3.2 Entities (class "group — two PTs", ADR 0016 amendment)

**`intercompany-loans`** (table `intercompany_loans`, Payload collection, writes through the domain only):

| Field | Rule |
|---|---|
| `docNo` | `PJA/{COMPANY}/{YY}{MM}/{seq}`, `{COMPANY}` = **lender** PT (it issues the money and holds the receivable); allocated at instruction; unique `(lender_company_id, doc_no)`; immutable |
| `lenderCompany`, `borrowerCompany` | → `companies`, required, CHECK distinct, immutable |
| `amount` | integer Rp > 0 (sanity bound Rp 1 T); default = gap of the linked request(s); may be **below** the gap (several lenders) or **above** it (cover several requests / a buffer) — warning text only; ≤ lender's Dana tersedia at instruction |
| `instructionDate` | business date (lender TZ), today |
| `dueDate` ("Jatuh tempo") | **required**, ≥ instruction date, default + 30 days (Q-6) |
| `reason` | required, 3–1000 chars |
| `requests` | hasMany → `expense-requests` of the **borrower** PT, optional (the loan can also be instructed without a request, from the loans page); informational |
| `status` | §3.3 |
| `repaidTotal` | system, Σ posted repayments; CHECK `0 ≤ repaid_total ≤ amount` |
| `snapshot` | at instruction: `{ borrowerAvailable, borrowerGap, lenderAvailable }` (evidence) |
| `createdBy` (the Owner), `cancelReason`, `cancelledBy`, `cancelledAt`, `uuid` | as other documents; outstanding = `amount − repaid_total` (derived) |

**`intercompany-loan-transfers`** (table `intercompany_loan_transfers`): the money movements of a loan, one row per
disbursement or repayment, no own number (shown "Pencairan" / "Pengembalian ke-n" of the PJA; the KK / KM carry the
ledger numbers).

| Field | Rule |
|---|---|
| `loan` | → `intercompany_loans`, required |
| `kind` | `disbursement` \| `repayment` |
| `fromCompany` / `toCompany` | disbursement: lender → borrower; repayment: borrower → lender (DB-checked against the loan) |
| `fromCashAccount` | active account of `fromCompany` **without a site** (the pool of §1) |
| `toCashAccount` | `toCompany`'s designated receiving account at execution (ADR 0028 §2) |
| `amount` | disbursement = loan amount (one disbursement); repayment ≤ outstanding (row lock on the loan) |
| `transferDate`, `transferAt`, `bankRef`, `proof` (`media-transfer-proofs`) | as a request transfer (item 11: date + time of the bank proof) |
| `status` | `posted` \| `void`; `voidReason`, `voidedBy`, `voidedAt`; `executedBy` |

At most one **posted** disbursement per loan (partial unique index). The KK / KM ids are in the link row.

#### 3.3 Status flow

```
instruct (Owner) ──▶ Menunggu pencairan ──disburse (Finance pemberi)──▶ Dicairkan ──repay──▶ Sebagian kembali ──repay──▶ Lunas
                        │         ▲                                       │
                        │         └──── void pencairan (no repayment) ────┘
                        └─cancel (Owner, reason)─▶ Dibatalkan
```

| Value | Label | Notes |
|---|---|---|
| `instructed` | Menunggu pencairan (Finance PT pemberi) | amount reserved in the lender's Komitmen (§1) |
| `disbursed` | Dicairkan | outstanding = amount |
| `partially_repaid` | Sebagian dikembalikan | 0 < repaid < amount |
| `repaid` | Lunas | voiding a repayment moves it back |
| `cancelled` | Dibatalkan | only from `instructed`; terminal; number kept (ADR 0007 §4) |

**Overdue ("Terlambat") is derived:** `due_date < today (borrower TZ) AND outstanding > 0 AND status IN (disbursed,
partially_repaid)`. No interest (as ADR 0022 Q-L1); tax / transfer-pricing treatment stays with the accountant
outside the app (Q-6).

#### 3.4 Instruction (Owner)

- **Who:** the Owner — exact stored role `pk-principal` in **both** PTs (ADR 0026 `hasExactRole`; he holds it in
  every PT). The client says "owner … memerintahkan finance": the Owner's instruction *is* the decision; there is no
  further approval step (the Owner is the top level; the lender's Direktur is informed, not asked).
- **Lender selection:** `GET /intercompany-loans/lenders?borrower=&amount=` lists every other **active** PT where the
  caller is Owner, with its Dana tersedia (same §1 definition) and `sufficient = available ≥ amount`; PTs short of the
  amount are shown disabled ("Dana tersedia Rp X"); a PT without a designated receiving account is selectable with the
  warning "pengembalian belum dapat dicatat sampai PT ini menetapkan rekening penerimaan antar-PT".
- **Checks (one transaction, fund locks of both PTs in id order):** borrower has a designated receiving account (else
  400 `INTERCOMPANY_NO_ACCOUNT`); `amount ≤ Dana tersedia(lender)` (else 409 `LOAN_LENDER_INSUFFICIENT` with the
  figure); linked requests belong to the borrower PT and are not cancelled / rejected.
- **Effect:** number allocated (lender's `PJA` counter), status `instructed`, the amount enters the lender's
  Komitmen — the **"perintah transfer kas keluar"** of the requirement is this instruction sitting in the lender
  Finance's queue. Notifications: `icloan.instructed` to Finance of the lender (action) and to Finance + Direktur of
  the borrower and Direktur of the lender (FYI).
- **Cancel:** Owner, reason, only while `instructed`; the reservation is released.
- **Several requests short at once:** the panel offers "Hitung untuk semua pengajuan yang menunggu" — the form then
  links every waiting request of the borrower PT the Owner ticks, amount default = Σ needed − available. One lender
  short of the whole gap → several instructions from several lenders (each ≤ its lender's funds).

#### 3.5 Execution = disbursement (Finance of the lender)

`POST /intercompany-loans/{id}/disburse` (lender `pk-finance`, transactional, idempotent), one transaction:

1. lock the loan; status `instructed`; **G1:** the executor ≠ the instruction's creator (an Owner who also holds
   Finance in the lender PT cannot execute his own order — 403, audited; DB-checked);
2. fund locks of both PTs; **re-check the lender:** `Dana tersedia(lender) + this loan's own reservation ≥ amount`,
   else **409 `LOAN_LENDER_INSUFFICIENT`** — the instruction stays `instructed`, the Owner gets
   `icloan.lender_insufficient` (cancel and instruct another lender, or wait). Finance cannot override (OD-2 applies
   to the money leaving the lender too);
3. lender checks as a transfer: account of the lender, active, without site, opening date, lender lock date (409
   "Periode … sudah ditutup"), account overdraft confirmation (QA-04, `confirmOverdraft`);
4. borrower checks (ADR 0028 `prepareReceipt`, generalised): designated account active; date after the borrower's
   lock date (409 `INTERCOMPANY_PERIOD_CLOSED`, same text); not before its opening date;
5. writes: movement row → **KK in the lender** (`source_type = intercompany`, direction `out`, no project / cost
   center, category null, description `Pinjaman antar-PT ke <borrower code> — <PJA no.>`) → **KM in the borrower**
   via the system path (`postEntry(…, { systemCompany: true })`, designated account, source `ANTAR-PT`, description
   `Pinjaman antar-PT dari <lender code>` — no number of the other PT, ADR 0028 §5 rule) → link
   (`source_doc_type = intercompany_loan_disbursement`, `source_doc_id` = movement id, `source_transfer_id` NULL) →
   loan `disbursed`; audit in both PTs; notifications `icloan.disbursed` (Owner, borrower Finance + Direktur) — the
   generic `cash.intercompany_received` is not sent for loan KMs (one message, not two).

Why the lender KK is `intercompany`, not `transfer`: `transfers` rows belong to expense requests (`request_id`, kind,
`pk_transfers_guard`, TRF numbering, renumber CLI). A loan KK with `source_type = intercompany` and no project is
automatically outside `spending()` (request transfers + **manual** KK only), RAP and budget figures, and is still a
real outflow in K-01 / K-02 and Rekap Kas.

#### 3.6 Repayment (Finance of the borrower)

- `POST /intercompany-loans/{id}/repayments` (borrower `pk-finance`): amount ≤ outstanding (loan row lock), date not
  before the disbursement, the same transfer fields, destination = the **lender's designated receiving account**
  (none → 409 `INTERCOMPANY_NO_ACCOUNT`). Partial repayments allowed, any number; the loan status follows
  `repaid_total`.
- **Fund check on the borrower:** `amount ≤ Dana tersedia(borrower)` else 409 `FUND_INSUFFICIENT` — repaying must not
  strand the borrower's already-approved requests. Lock dates of both PTs as in §3.5.
- Writes: movement (`kind = repayment`) → KK in the borrower (`intercompany`, out) → system KM in the lender
  (`intercompany`, in) → link (`source_doc_type = intercompany_loan_repayment`) → `repaid_total` / status. Notified:
  Owner, lender Finance + Direktur (`icloan.repaid`).
- **No approval** for a repayment (recommendation, Q-6): it only lowers a debt inside the group, goes only to the
  lender's own designated account and is capped at the outstanding — the same reasoning as ADR 0022 Q-L7. The Owner is
  notified of every repayment.

#### 3.7 Voids

| What | Who | Rule |
|---|---|---|
| Instruction | Owner | cancel while `instructed` (§3.4) |
| Disbursement | Finance of the **lender** (payer side, like ADR 0028 §7) | reason required; only while **no posted repayment**; reverses the lender KK and the borrower KM (`voidEntry … viaIntercompany`, reversal dated per the ledger rule — a closed period never blocks), link + movement `void`, loan back to `instructed` (Finance may execute again, the Owner may cancel). If the borrower's Dana tersedia **after** the reversal is < 0 (the money was already spent / committed), the void needs `confirmBorrowerShortfall: true` (409 `LOAN_VOID_BORROWER_SHORTFALL_CONFIRM_REQUIRED` with the figures), is audited, and the Owner + borrower Finance are notified. Requests approved on the strength of the loan **stay approved** (no automatic un-approval); the borrower simply shows negative availability until money comes in. |
| Repayment | Finance of the **borrower** | reason required; reverses both legs; loan status recomputed (`repaid` → `partially_repaid` / `disbursed`). |
| A loan KK / KM directly in the cash book | nobody | 409 "Kas antar-PT di-void lewat pinjaman PJA/… di PT <payer>." (existing `voidEntry` refusal for `intercompany`, message generalised to both directions) |

#### 3.8 Due date and reminders

New reminder rule `ic_loan_overdue` (`REMINDER_RULES`, event `icloan.overdue`): daily while overdue, to the Owner,
Finance and Direktur of the borrower and Finance of the lender; switchable per borrower PT
(`companies.reminderIcLoanOverdueEnabled`, default on), like ADR 0022 Q-L6. A "jatuh tempo dalam 7 hari" heads-up is
not added in this phase.

#### 3.9 Accounting labels and reports

| Leg | Lender PT | Borrower PT |
|---|---|---|
| Disbursement | KK "Pinjaman antar-PT diberikan" → **Piutang antar-PT** | KM "Pinjaman antar-PT diterima" → **Hutang antar-PT** |
| Repayment | KM "Pengembalian pinjaman antar-PT diterima" (piutang ↓) | KK "Pembayaran hutang antar-PT" (hutang ↓) |

- Rekap Kas Rincian: these four lines, split from the PT grup payment lines by the link's `source_doc_type`;
  `INTERCOMPANY_ENTRY_SQL` already matches them (it keys on the link's entries), so the ADR 0028 "Antar PT" columns,
  the "tanpa antar-PT" filter and the Direktur card toggle include loans without change.
- Buku Kas / Kas page: "Jenis" Antar PT, counterpart line "Pinjaman PJA/DRMS/2610/0001 · ke PT LAS" via
  `counterpartsOf` (extended to loan links; opens the loan when the caller has a role in that PT).
- New report **"Pinjaman antar-PT"** (Keuangan → Laporan, D8 table + Excel): per loan no., date, lender, borrower,
  amount, repaid, outstanding, due, status, days overdue; filters PT, role (pemberi / penerima), status, overdue; per-PT
  summary *Piutang antar-PT* / *Hutang antar-PT* outstanding. Owner + Direktur dashboards: card "Hutang / piutang
  antar-PT" and a card "Dana tersedia per PT" (§1 per PT the caller sees).
- Never in `spending()`, RAP, budget committed, project figures (no project / cost center tag). Odoo (F7, not
  built): an inter-company receivable / payable pair per movement — noted in the ADR 0009 backlog.

### 4. Roles, visibility and G1

| Actor | Fund panel on a request | Instruct / cancel loan | Execute disbursement | Record repayment | Void disbursement / repayment | Read loans |
|---|---|---|---|---|---|---|
| **Owner** (`pk-principal`, exact, both PTs) | yes (decides) | **yes** | no¹ | no¹ | no¹ | all PTs where Owner |
| Direktur (`pk-owner`) of lender / borrower | read-only | no | no | no | no | loans of his PT |
| Finance of the **lender** | read-only | no | **yes** | — | disbursement | loans of his PT |
| Finance of the **borrower** | read-only | no | — | **yes** | repayment | loans of his PT |
| Admin of either PT | no | no | no | no | no | read (as ADR 0022) |
| PM / Staff / Operator, requester | **no** (status label unchanged, no figures) | no | no | no | no | no |

¹ unless he also holds Finance there; even then never the disbursement of his own instruction (G1 below).

- A user of PT A sees of PT B only what ADR 0028 allows (PT name / code, designated account masked, counterpart
  numbers) plus the loan document itself (amount, dates, status, PJA no.) — the loan belongs to both PTs. The Owner
  sees every PT's availability (he is Owner everywhere). The lender list is served only to the Owner.
- **G1:** (1) the fund check never changes who decides — the ADR 0013 / 0021 / 0026 rules of the request stand,
  including G1-2 skips and the distinct-person rule; (2) **instruction creator ≠ disbursement executor** (service 403
  + DB `executed_by <> created_by` for `kind = disbursement`); (3) a Finance user who is requester of a linked request
  may execute the disbursement (money goes PT → PT, not to him); (4) the Owner may instruct a loan for **his own**
  blocked request: Finance's execution is the independent second person; the loan detail notes "Pinjaman untuk
  pengajuan Owner sendiri" and the audit carries it. The ADR 0021 / 0024 exceptions (`direktur_via_pm*`) play no role.
- Owner instructions and loan writes are checked on **stored** roles (`exactRolesIn`), like ADR 0026 decisions.

### 5. Data model and migrations

Next names after the latest on `main` (`20261014_100300_d1310_intercompany_data`):

1. **`20261015_100000_d1310_fundcheck_enums`** (own transaction — `ALTER TYPE … ADD VALUE`):
   `enum_document_sequences_doc_type` += `intercompany_loan`; `enum_audit_logs_action` += `fund_insufficient`.
2. **`20261015_100100_d1310_fundcheck_loans`** (Payload schema + **`20261015_100100_d1310_fundcheck_loans.json`**,
   the new latest Payload snapshot after `20261014_100100_d1310_intercompany.json`; generated on the CI runner, not
   locally), additive:
   - `intercompany_loans` (+ `intercompany_loans_rels` for `requests`), `intercompany_loan_transfers`, their enums
     (`enum_intercompany_loans_status`, `enum_intercompany_loan_transfers_kind` / `_status`), `uuid` columns;
   - `companies.fund_check_enabled` (boolean, default false), `companies.reminder_ic_loan_overdue_enabled` (default
     true);
   - `approvals.fund_balance`, `approvals.fund_commitments`, `approvals.fund_available` (nullable integers — the
     figures at a checked final decision; evidence, PDF approval box line "Dana tersedia saat disetujui");
   - grants for the app role (SELECT / INSERT / UPDATE, no DELETE); `payload_locked_documents_rels` columns as Payload
     generates them.
3. **`20261015_100200_d1310_fundcheck_guard`** (hand-written, `<prefix>_owner`), same style as
   `20261014_100200_d1310_intercompany_guard`:
   - SQL functions `pk_fund_balance(cid)`, `pk_fund_commitments(cid)`, `pk_fund_available(cid)` (STABLE, the §1
     formula; the service calls the same functions so web and DB never disagree);
   - `pk_expense_fund_guard()` + trigger `expense_requests_fund_guard` BEFORE UPDATE OF status … WHEN
     (`OLD.status IN ('pending_ack','pending_approval') AND NEW.status = 'approved'`) — advisory lock + 23514;
   - `intercompany_links`: CHECK `source_doc_type IN ('expense_request', 'intercompany_loan_disbursement',
     'intercompany_loan_repayment')`; `pk_ic_link_sides()` re-created with the loan branches (movement of
     `source_doc_id` with matching kind, `from_company = source`, `to_company = target`, `source_transfer_id IS
     NULL`, KK `out` with `source_type = intercompany` and no `transfer_id`, KM unchanged, amounts equal) — the
     `expense_request` branch unchanged;
   - `pk_ic_entry_linked()` re-created: every `intercompany` entry, `in` **or** `out`, has exactly one link (as
     target or source); `pk_ic_consistency()` extended so a loan link, its movement and both entries are all posted
     or all void (still fired only on status changes);
   - `pk_icl_guard()` on `intercompany_loans`: transitions of §3.3; content columns (companies, amount, dates, reason,
     doc_no, requests) frozen after insert; `repaid_total` = Σ posted repayments (deferred); `created_by` holds
     `pk-principal` in both PTs at insert (`company_memberships_roles`, pattern of `pk_no_approval_allowed_for`);
     linked requests belong to the borrower PT;
   - `pk_icl_transfer_guard()` on `intercompany_loan_transfers`: sides match the loan and the kind; from-account of
     `from_company`, active, `site_id IS NULL`; to-account = `to_company`'s designated account; repayment amount ≤
     outstanding at insert (loan row locked by the service; deferred re-check); disbursement only from `instructed`,
     `executed_by <> loan.created_by`; immutable except `posted → void` with reason; partial unique index "one posted
     disbursement per loan";
   - no DELETE / TRUNCATE on both tables (`pk_reject_mutation`); unique `(lender_company_id, doc_no)`.
4. **`20261015_100300_d1310_fundcheck_data`** (idempotent): `PJA` sequence per PT (`DEFAULT_SEQUENCES` gets
   `{ docType: 'intercompany_loan', docCode: 'PJA', pattern: 'PJA/{COMPANY}/{YY}{MM}/{seq}', resetPolicy: 'monthly',
   padding: 4, startAt: 1 }`, copied to new PTs); `fund_check_enabled` stays false everywhere; default notification
   templates for the new events. `PJA` is free (`PJ` = ADR 0022 project loan).

**Renumber lists** (`migrations/20261013_610000_d1310_renumber.ts`, integration test `d1310-w4-renumber`):

| Function | List | Why |
|---|---|---|
| `pk_expense_fund_guard` (on `expense_requests`, renumbered) | `RENUMBER_NEUTRAL_FUNCTIONS` | fires only on a status change into `approved`; a `doc_no`-only update never reaches it |
| `pk_ic_entry_linked`, `pk_ic_consistency` (re-created) | stay `RENUMBER_NEUTRAL_FUNCTIONS` | INSERT-only / status-change-only, as in ADR 0028 |
| `pk_ic_link_sides`, `pk_icl_guard`, `pk_icl_transfer_guard` | neither | on tables the renumber CLI does not touch. `PJA` numbers are issued in the D5 shape from day one, so `intercompany_loans` is **not** added to the CLI's table list; if it ever is, `pk_icl_guard` (it freezes `doc_no`) must move to `RENUMBER_GUARDED_FUNCTIONS` with the prelude |

Descriptions of loan KK / KM never quote a number of the other PT (ADR 0028 §11), so a per-PT renumbering of KM / KK
stays consistent; counterpart numbers are rendered live from the link.

### 6. API (contract for web and APK)

- **Request detail** (`GET /expense-requests/{id}`) gains, for callers with Kas view in the request's PT:
  ```
  fundCheck: { enabled, applies, status: 'ok'|'insufficient'|'not_applicable',
               balance, commitments, available, needed, gap,
               waitingAtOwner: { count, amount },
               commitmentItems: [{ kind: 'request'|'shortfall'|'loan', id, docNo, amount }],   // first 20
               loans: [{ id, docNo, status, amount, lender: { id, shortCode } }] }               // linked PJA
  ```
  `allowedActions` gains `instruct_loan` (Owner, insufficient). `approve` stays listed (old clients get the 409).
- `POST /expense-requests/{id}/approve` (and `/submit` of an Owner request): **409 `FUND_INSUFFICIENT`**
  `{ companyId, balance, commitments, available, needed, gap }`, Indonesian `message` with the three figures.
- Approval inbox rows: `fundShort: number | null` (gap) for rows at the caller's Owner level.
- `GET /fund-availability?company=` → `{ companyId, balance, commitments, available, accounts: [{ id, name,
  balance }], excludedSiteAccounts: { count, balance } }` (Finance / Direktur / Owner of that PT).
- `/intercompany-loans` (pattern of `/project-loans`): `GET` list (filters `company`, `role=lender|borrower`,
  `status`, `overdue`, `q`), `GET /queue?company=` + count (lender Finance, nav badge), `GET /lenders?borrower=&amount=`
  (Owner), `GET /{id}` (movements, timeline, `allowedActions`), `POST` `{ borrowerCompanyId, lenderCompanyId, amount,
  dueDate, reason, requestIds[] }` (Owner, idempotent), `POST /{id}/cancel {reason}`, `POST /{id}/disburse
  { cashAccountId, bankRef, proofMediaId, transferAt, confirmOverdraft? }`, `POST /{id}/disbursement/void { reason,
  confirmBorrowerShortfall? }`, `POST /{id}/repayments { cashAccountId, amount, bankRef, proofMediaId, transferAt,
  confirmOverdraft? }`, `POST /{id}/repayments/{mid}/void { reason }`. All mutations transactional + idempotent.
- `/me` `companies[].capabilities`: `instructIntercompanyLoan` (exact Owner), `disburseIntercompanyLoan` (Finance),
  `fundCheckEnabled`.
- Error codes (OpenAPI): `FUND_INSUFFICIENT`, `LOAN_LENDER_INSUFFICIENT`, `LOAN_HAS_REPAYMENTS`,
  `LOAN_VOID_BORROWER_SHORTFALL_CONFIRM_REQUIRED`, `LOAN_REPAYMENT_EXCEEDS_OUTSTANDING`, reused
  `INTERCOMPANY_PERIOD_CLOSED`, `INTERCOMPANY_NO_ACCOUNT`, `CASH_OVERDRAFT_CONFIRM_REQUIRED`.
- Notifications (doc types `expense_request` / `intercompany_loan`, deep links): `expense.fund_shortfall`,
  `icloan.instructed`, `icloan.lender_insufficient`, `icloan.disbursed`, `icloan.disbursement_voided`,
  `icloan.repaid`, `icloan.cancelled`, `icloan.overdue`.

## UI

**Web**

- Request detail: panel "Ketersediaan dana PT" (§2) in the workflow column; Setujui disabled with the reason;
  "Perintahkan pinjaman antar-PT"; inbox badge "Dana kurang Rp X". Draft of an Owner request: the same panel before
  "Kirim".
- Keuangan → **Pinjaman antar-PT**: list, detail (movements, linked requests, timeline, counterpart entries), the
  instruction form (lender select with availability, amount default gap, due date, reason, linked requests), cancel.
- Transfer queue page: second tab **"Pencairan pinjaman antar-PT"** (lender Finance) with the execution form (the
  transfer form component: account, bank reference, proof, date + time, overdraft confirm); repayment form and both
  void dialogs on the loan detail.
- Kas / Rekap Kas / reports / dashboard cards per §3.9. Company settings: "Cek dana saat persetujuan" switch
  (group admin, reason).

**APK** (`apps/mobile`) — Owner and Finance only; online only (no offline drafts of loans)

- **Owner approval shortfall:** `approvals/presentation/decision_sheet.dart` and
  `expense/presentation/request_detail_screen.dart` render `fundCheck` (available / needed / gap, commitments
  expandable), disable Setujui, keep Tolak; inbox badge from `fundShort`; the 409 `FUND_INSUFFICIENT` message shown on
  a race.
- **Loan instruction:** new screen in `features/loans/` (next to the project-loan screens): lender picker from
  `/intercompany-loans/lenders` (available per PT, insufficient ones disabled), amount (default gap), due date,
  reason, linked requests (pre-filled); also a read-only loan detail reached from notifications.
- **Finance execution:** `finance/presentation/finance_screen.dart` gets the "Pencairan pinjaman antar-PT" section;
  the execution form reuses `transfer_form_screen.dart` (source account without site, bank ref, proof photo, date /
  time, overdraft and period-closed messages).
- Repayment and voids: **web only** in this phase (Finance desk work, like ADR 0022 repayments).
- Old APKs: an Owner on an old build sees Setujui, taps it and gets the 409 with the figures — acceptable; no
  `minAppVersion` bump is needed (no write of old clients is wrong, unlike ADR 0028 drafts).

## Edge cases

| Case | Behaviour |
|---|---|
| **Period closed** | Lender's lock date → 409 at disbursement; borrower's → 409 `INTERCOMPANY_PERIOD_CLOSED` (both checked before any write, DB trigger stays the authority). Same for repayments (payer / receiver swapped). Voids never blocked (reversal dated today when the original's period is closed). The fund check itself ignores periods (balances are all-time). |
| **Lender funds drop between instruction and execution** | Rare (the instruction reserves the amount, so the lender's own Owner approvals see it). Only unchecked outflows (manual KK, transfers of earlier commitments paid from site accounts, KM reversals) can do it. Re-check at execution → 409 `LOAN_LENDER_INSUFFICIENT`, instruction stays, Owner notified; cancel + new lender, or wait. |
| **Multi-currency** | Not applicable: integer Rupiah only (no currency anywhere in the model). |
| **Several requests short at once** | Each inbox row shows its own gap against the current availability; the instruction can link several and default to Σ needed − available; partial loans from several lenders allowed. Approving one consumes availability for the next (lock + re-check per approval). |
| **Loan larger than the gap** | Allowed up to the lender's availability (warning only); the surplus simply raises the borrower's availability. |
| **Loan smaller than the gap** | Allowed; the panel shows the remaining gap; another instruction from another PT can cover it. |
| **Void of a disbursement after the borrower spent the money** | Allowed only without repayments; explicit `confirmBorrowerShortfall` when the borrower goes negative; approved requests stay approved; Owner notified (§3.7). Normally the right fix is a repayment, not a void (the void is for a wrong entry). |
| **Linked request rejected / cancelled while the loan is instructed** | Loan unaffected (links are informational); the Owner gets a hint on the loan ("pengajuan terkait dibatalkan — batalkan perintah bila tidak diperlukan"). |
| **No PT of the group has enough** | Lender list shows all short; partial loans or reject / wait. |
| **Borrower has no designated receiving account** | Instruction refused (400 `INTERCOMPANY_NO_ACCOUNT`); re-checked at execution (409). |
| **Two approvals race in one PT** | Serialised by the per-PT advisory lock; the second re-reads availability incl. the first's commitment. Approvals in different PTs do not wait on each other. |
| **Two-PT operations in opposite directions at once** (A→B loan while B→A repayment) | Both take the two fund locks in ascending company id → no deadlock. |
| **Payment from a site account** | Lowers the site account (not in the pool) and the commitment → availability rises by the paid amount; correct (the money came from outside the pool). |
| **Stale approved requests** | They stay commitments until transferred or cancelled; the panel lists them so the Owner can ask Finance to clean up. |

## Security

- Availability figures are cash data: served only to Kas roles of that PT (Finance, Direktur, Owner); the lender list
  only to the Owner (exact role). Requesters, PM and Staff never see figures.
- Cross-PT writes only through the named system functions of the intercompany module inside the Owner-authorised /
  Finance-executed transaction (ADR 0016 §5 amendment), audited in both PTs.
- New two-PT tables are guarded like `intercompany_links`: sides checked per FK, append-only movements, no DELETE.
- Isolation suite (`mc-isolation`): a user of PT A only gets 404 on loans that do not involve A, on B's accounts and
  on `/fund-availability?company=B`; a lender Finance cannot record a repayment; a borrower Finance cannot disburse;
  `executed_by = created_by` refused by service and DB.

## Effort (estimate, person-days)

| Part | pd |
|---|---|
| Web — migrations (enums, schema + `.json`, guards incl. fund functions / trigger, link-sides branches, loan guards, data) | 3 |
| Web — domain: availability + commitments + locks, approve / submit / inbox / DTO, Owner notifications | 2 |
| Web — domain: loans (instruction, lender list, disbursement / repayment via generic `postPair` / `voidPair`, voids, status, reminders, audit) | 4 |
| Web — API + OpenAPI + `/me` capabilities | 1.5 |
| Web — admin UI (panel, inbox badge, loans list / detail / forms, Finance tab, void dialogs, company switch) | 3 |
| Web — reports / Kas labels / dashboard cards | 1.5 |
| Web — tests (unit: formula, transitions; integration: block / unblock, race of two approvals, loan happy path, period closed both sides, lender drop, voids, isolation, renumber regression) | 3.5 |
| Docs, runbook (enabling the switch, reconciliation), UAT script | 0.5 |
| **Web total** | **≈ 19** |
| APK — models / API / problem codes / capabilities | 1 |
| APK — Owner shortfall panel, decision sheet, inbox badge | 1 |
| APK — loan instruction screen + read-only loan detail, notification deep links | 2 |
| APK — Finance disbursement section + execution form (reusing the transfer form) | 1.5 |
| APK — tests + release | 1 |
| **APK total** | **≈ 6.5** |

## Rollout

1. Merge → staging; migrations `20261015_100000…100300` (additive; the previous image never writes the new tables,
   and the fund trigger is inert while `fund_check_enabled` is false).
2. Every PT designates its intercompany receiving account (ADR 0028) if not done.
3. UAT on staging: Owner approval short → panel + notification → instruction → lender Finance executes → KK in lender,
   KM in borrower, both linked → Owner approves again; two approvals racing; lender drop → 409; borrower period
   closed → 409; repayment partial + full; voids; APK Owner + Finance flows; isolation.
4. **Per PT, before switching on:** Finance reconciles every non-site account with the bank statement (opening
   balances, all KM recorded); then a group admin enables "Cek dana saat persetujuan" for that PT (reason "saldo
   cocok dengan rekening koran per <tanggal>"). PTs can go live one by one.
5. APK released with the web change (no forced update).

## Rollback

- Data: switch the PT's fund check off → the block disappears at once (panel stays read-only). Cancel open
  instructions.
- Code: `git revert`; the data down removes the `PJA` sequences and templates only when no loan exists; the guard
  down restores the ADR 0028 bodies of `pk_ic_link_sides` / `pk_ic_entry_linked` / `pk_ic_consistency` and the
  `source_doc_type` CHECK (refused while loan links exist); the schema down **refuses** when loans exist (posted
  ledger rows are permanent, ADR 0005) — restore the pre-deploy dump instead. Enum values stay (Postgres).

## Alternatives considered

| Alternative | Why not |
|---|---|
| Fund check on the balance only, no commitments | Two approvals pass on the same money; the hard block would not protect anything. |
| Soft warning instead of a block | OD-2 asks for a hard block. |
| Check only at the Finance transfer | Too late: the Owner already approved and the requester was told "Disetujui"; nobody at the transfer can fix funds. |
| SERIALIZABLE transactions for the check | Retries across Payload's whole request, 40001 errors to clients on unrelated writes; the advisory lock is the pattern already used (`checkOverdraft`). |
| Auto-approve the linked requests when the loan arrives | Skips the signed decision; money may be gone by then; the Owner may want to reject. |
| Loan as a PT grup expense request in the lender PT | §3.1 option A: filer / approval / invoice / cost semantics all wrong for a loan; no outstanding or repayments. |
| Loan as per-PT document (lender's) with a plain `borrower_company_id` | Repayments and the borrower's view would need cross-PT references from per-PT tables; the "group — two PTs" class keeps the ADR 0016 rule (only named group tables relate two PTs). |
| Extend ADR 0022 project loans across PTs | Notional claims without cash entries; the inter-PT loan is a real bank movement with a ledger pair. |
| Loan KK as `source_type = transfer` with a synthetic `transfers` row | `transfers` is tied to expense requests (FK, kind, guard, TRF numbering, renumber CLI); would count in request-transfer reports. |

## Proposed amendments (applied 2026-10-14 — see "Amendments" below)

- **ADR 0022 — note for Q-L2:** money lent between PTs is the "Pinjaman antar-PT" of ADR 0029 (`PJA`, real cash
  movements through `intercompany_links`, doc types `intercompany_loan_disbursement` / `intercompany_loan_repayment`
  — this replaces the provisional names `intercompany_loan` / `intercompany_loan_repayment` of the 2026-10-14 note).
  Same-PT project loans (`PJ`) are unchanged.
- **ADR 0028 §4 / §5:** `source_doc_type` gains the two loan values with `source_doc_id` = the loan movement and
  `source_transfer_id` NULL; for those links the payer's KK is `source_type = intercompany` (direction `out`), so
  `intercompany` is no longer "the KM in B only". PT grup payments are unchanged (KK stays `transfer`).
- **ADR 0016 §4:** the "group link (two PTs)" class also covers `intercompany_loans` and `intercompany_loan_transfers`
  (each FK checked against its side's company).
- **ADR 0005:** inter-PT loan disbursements and repayments are posted automatically as a KK / KM pair (ADR 0029); other
  inter-PT movements stay manual.
- **ADR 0026 §3:** the final approval of an expense request (normally the Owner's) and the submit of the Owner's own
  request are refused when the paying PT's available funds are short, for PTs with the fund check switched on.
- **ADR 0007:** doc type `intercompany_loan`, `PJA/{COMPANY}/{YY}{MM}/{seq}` (lender PT), allocated at the instruction.

## Pertanyaan untuk owner

Ringkas, masing-masing dengan usulan default (dipakai bila owner setuju / tidak menjawab). **Dijawab 2026-10-14:
"setuju" untuk semua usulan** — see "Owner decisions (2026-10-14)" below.

1. **Komitmen dikurangkan dari dana tersedia?** Dana tersedia = saldo semua akun kas/bank PT (tanpa akun site)
   **dikurangi** pengajuan yang sudah disetujui tetapi belum ditransfer, kekurangan LPJ yang belum dibayar, dan
   perintah pinjaman yang belum dicairkan. *Usulan: Ya* — tanpa ini dua pengajuan bisa lolos dengan uang yang sama.
2. **Cek dana juga untuk (a) pengajuan Owner sendiri dan (b) pengajuan yang aturannya tanpa level Owner?** (a) dicek
   saat dikirim — bila kurang, tetap Draft dan Owner bisa langsung memerintahkan pinjaman; (b) dicek pada persetujuan
   terakhir (Direktur/Finance), Owner yang dapat notifikasi. *Usulan: Ya untuk keduanya.*
3. **Akun site yang dikecualikan:** di sistem, tanda "site" dipakai untuk kas kecil **dan** rekening kantor cabang.
   *Usulan: semua akun yang ditandai site tidak dihitung* (bila ada rekening cabang yang harus dihitung, hapus tanda
   site-nya).
4. **Pinjaman sebagai dokumen sendiri "Pinjaman antar-PT" (PJA/…)** yang memakai mekanisme PT grup (rekening
   penerimaan, kas masuk otomatis, label "Antar PT"), **bukan** Pengajuan PT grup biasa — karena pinjaman bukan biaya,
   punya jatuh tempo, sisa pinjaman dan pengembalian. *Usulan: Ya, dokumen sendiri.*
5. **Setelah dana pinjaman masuk, pengajuan disetujui ulang oleh Owner** (cek dana diulang saat itu), tidak otomatis
   disetujui; Owner mendapat notifikasi "siap disetujui". *Usulan: Owner menyetujui ulang.*
6. **Pengembalian & syarat pinjaman:** pengembalian dicatat Finance PT peminjam tanpa persetujuan (boleh bertahap,
   dicek dananya, Owner dapat notifikasi); **tanpa bunga**; jatuh tempo wajib, default **30 hari**; pengingat harian
   saat terlambat. *Usulan: seperti tertulis.*

## Owner decisions (2026-10-14; were the open questions of the draft — "setuju" on every default)

1. **Commitments are subtracted** from the available funds: requests approved but not transferred, unpaid LPJ
   shortfalls (verified, type shortfall, not settled), loans instructed but not yet disbursed (§1).
2. **The check also applies to** (a) the Owner's own request — at **submit**; short → 409, the request stays **Draft**;
   and (b) a rule **without an Owner level** — at its final approval (Direktur / Finance), the Owner is notified (§1).
3. **All site-flagged accounts are excluded** (kas kecil and rekening kantor cabang; untag an account to count it).
4. **The loan is its own document** "Pinjaman antar-PT" `PJA/{LENDER}/{YY}{MM}/{seq}`, reusing the PT grup mechanism
   (designated receiving account, automatic KM, `intercompany_links`, paired void) — not a PT grup payment request.
5. **After the loan arrives the Owner approves again** with a fresh check; nothing is approved automatically.
6. **Loan terms:** no interest; due date required, default 30 days; daily overdue reminder; repayments recorded by the
   borrower's Finance without approval, partial allowed, fund-checked, the Owner notified.
7. **Per-PT switch** `companies.fundCheckEnabled` ("Cek dana saat persetujuan"), default **OFF** (group admin, reason).

## As implemented (web / server, `feat/d1310-c-fundcheck`)

- **Migrations** `20261015_100000_d1310_fundcheck_enums` (own transaction: `enum_document_sequences_doc_type` +=
  `intercompany_loan`, `enum_audit_logs_action` += `fund_insufficient`), `…_100100_d1310_fundcheck_loans` (+ the
  latest Payload snapshot `.json`, based on `20261014_100100_d1310_intercompany.json`, every earlier enum value kept),
  `…_100200_d1310_fundcheck_guard`, `…_100300_d1310_fundcheck_data` (PJA sequence per PT; `DEFAULT_SEQUENCES` carries
  it for new PTs and the seed). `pk_expense_fund_guard` is on `RENUMBER_NEUTRAL_FUNCTIONS`; the loan tables are not
  renumbered (their guards are on neither list).
- **Domain:** `domain/fundcheck/{rules,service}.ts` (figures through the SQL functions, per-PT advisory lock
  `pk:fund:<id>` in ascending id, `checkFundsForApproval` at the final `approve`, a final `acknowledge` and
  `approveWithoutDecision` — the Owner's submit and receipt resubmit —, the detail panel, the inbox badge, the
  notification `expense.fund_shortfall`); `postEntry` takes the PT's fund lock before the account lock; a PT grup
  transfer / its void takes both PTs' locks up front. `domain/intercompany/{loan-rules,loans,loan-report}.ts`: the
  loan document, its movements through the generic `prepareReceiver` + system KM + link of ADR 0028, report and
  overdue query. The approval row stores `fundBalance` / `fundCommitments` / `fundAvailable` of a checked decision.
- **API:** `GET /fund-availability`, `/intercompany-loans` (list, `queue`, `lenders`, detail, instruct, cancel,
  disburse, disbursement void, repayments + void), request detail `fundCheck` + action `instruct_loan`, inbox
  `fundShort`, `/me` capabilities `instructIntercompanyLoan` / `disburseIntercompanyLoan` / `fundCheckEnabled`, cash
  entry counterpart `sourceDocType` / `loanLeg`, Owner dashboard block `intercompany`.
- **Admin UI:** panel "Ketersediaan dana PT" on the request page (Setujui disabled with the reason; "Perintahkan
  pinjaman antar-PT"), inbox badge "Dana kurang Rp X" (no Setujui in the row), Keuangan → **Pinjaman antar-PT** (list,
  instruction form, detail with cancel / disbursement / repayment / both voids), section **"Pencairan pinjaman
  antar-PT"** on Antrian Transfer, switch "Cek dana saat persetujuan" on the PT (Operasional tab), Kas counterpart
  line "Pinjaman antar-PT diterima · PJA/… · dari PT …", Rekap Kas lines (four loan legs), report
  `pinjaman-antar-pt`, Direktur / Owner dashboard card "Dana tersedia & pinjaman antar-PT".
- **Deviations from the draft (reason):**
  - The loan tables are **hand-written SQL tables, not Payload collections** (like `intercompany_links`): a two-PT
    document has no `company` column, so the per-PT collection machinery (company hook, list PT filter, access by one
    PT, admin list views, audit hook) does not fit; the domain module reads / writes with SQL and the admin views are
    custom views. Consequently there is no `payload_locked_documents_rels` column and the linked requests are a plain
    table `intercompany_loan_requests` (instead of a Payload `_rels` table). The Payload snapshot carries only the
    Payload-managed columns (companies, approvals) and the enum values.
  - **The loan steps are fund-checked whatever the PT switch says** (instruction / disbursement on the lender,
    repayment on the borrower): the switch protects today's approvals from an unreconciled cash book; loans are new
    and money leaving a PT must never strand its approved requests.
  - Notification texts are **code defaults** (editable by creating a `notification-templates` row of the event), not
    rows inserted by the data migration — the existing pattern of every other event.
  - The disbursement queue count is shown on the section of Antrian Transfer and served by `GET
    /intercompany-loans/queue`; the module nav badge stays the request transfer queue (its count is pinned to the page
    title, S3e S-07).
- **Not done here (follow-up):** the APK part (Owner shortfall panel + decision sheet, loan instruction screen, Finance
  disbursement section) — the contract is ready (`fundCheck`, `fundShort`, `/intercompany-loans/*`, capabilities).
  *Done in `feat/d1310-c-fundcheck-apk`, see "As implemented (APK)".*

## As implemented (APK, `feat/d1310-c-fundcheck-apk`)

- **Contract:** no web change was needed. The APK reads `fundCheck` (request detail), `fundShort` (inbox rows), the
  `/me` capabilities `instructIntercompanyLoan` / `disburseIntercompanyLoan` / `fundCheckEnabled` (per PT; absent on an
  older server = false, PT scope = union) and `/intercompany-loans` `queue`, `lenders`, `{id}`, `POST`,
  `{id}/disburse`. No drift schema change (nothing is stored offline: loans are online only), no `minAppVersion` bump.
- **Shortfall panel** (`expense/presentation/widgets/fund_check_panel.dart`) on the request detail (after the
  "Tahapan saat ini" card) and, compact, in the decision sheet: the web panel's lines and texts; "cek akhir di
  persetujuan Owner" while `applies` is false, "informasi saja" while the PT's switch is off. While `blocked` the
  primary decision ("Setujui", or a final "Diketahui") is disabled with `blockedText` (built locally with the web
  sentence when absent), "Tolak" stays. `instruct_loan` adds "Perintahkan pinjaman antar-PT" →
  `/intercompany-loans/new?borrower=<PT>&requests=<id>&amount=<gap>`. A 409 `FUND_INSUFFICIENT` (race in the sheet,
  the Owner's own submit) shows the server's sentence, else a local one with the figures; after the Owner's own submit
  the message carries the instruction action (borrower and gap from the problem body).
- **Instruction** (`loans/presentation/intercompany_loan_screens.dart`): the lender list is fetched once with the
  initial amount; when the Owner edits the amount the APK re-evaluates `sufficient` locally with the server's rule
  (available ≥ amount) instead of refetching per keystroke — the server re-checks at `POST` (409
  `LOAN_LENDER_INSUFFICIENT` reloads the list). Requests waiting at their final step are offered as links (the one the
  form came from pre-ticked; opened without an amount, the default is the gap of the ticked requests); a pre-linked
  request no longer listed as waiting (e.g. the Owner's own server Draft) stays linked. After the `POST` the screen is
  replaced by the loan detail.
- **Loan detail** read-only (also the target of `docType = intercompany_loan` notifications): figures, notes,
  linked requests (openable for the borrower's people), movements with KK / KM numbers, void marks; a hint that
  cancel, repayments and voids are recorded on the web. The only APK action is `disburse`.
- **Disbursement:** "Pencairan pinjaman antar-PT" is a section above the transfer queue (shown with the capability,
  hidden when empty or unreachable); the form reuses the transfer form's pieces (`pickTransferAt`,
  `TransferProofPicker`, the overdraft prompt, `validateTransferForm` without a cost center). The source account list
  is `GET /cash-accounts/balances?company=<lender>` filtered to active accounts **without a site** (`siteId`, now parsed),
  the server's rule for loan movements. The borrower's receiving account comes from the queue item (`destination`);
  the loan detail does not carry it, so a form opened from a notification shows it only once the queue has loaded.
- **Not in the APK (this phase, as decided):** cancel of an instruction, repayments, both voids, the loans list and
  report, the fund-availability page and the company switch.

## Amendments (applied 2026-10-14 to ADR 0005, 0007, 0016, 0022, 0026, 0028)

The draft texts of "Proposed amendments" above were added as sections "Amendment 2026-10-14 (ADR 0029)" to the
respective ADRs.

## Revision history

- **2026-10-14:** proposed (draft for owner review).
- **2026-10-14:** accepted ("setuju" on every default); web / server implementation in `feat/d1310-c-fundcheck`;
  amendments applied to ADR 0005, 0007, 0016, 0022, 0026 and 0028.
