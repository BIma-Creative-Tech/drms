# ADR 0022 — Inter-project loan (Pinjaman antar project): PM submits, Direktur approves, notional allocation

- **Status:** accepted (owner decision **D6** 2026-10-11, `../plans/drms-1010.md`: "Yes, approval: PM submits →
  Direktur approves"; owner answers Q-L1…Q-L7 2026-10-11, see "Decisions"). DRMS 10/10 Phase D. Staging first, no
  production deploy without separate owner approval.
- **Date:** 2026-10-11
- **Author:** Analyst (branch `docs/d1010-d-adr`, based on `feat/d1010-int` `cb19838`)
- **Related:** ADR 0005 (cash ledger, period lock; its ADR 0016 revision puts inter-company loans out of scope), ADR 0006
  (audit, append-only), ADR 0007 (numbering, D5 shape `<DOC>/{COMPANY}/{YY}{MM}/{seq}`), ADR 0013 (G1 rules, addendum
  engine), ADR 0016 (multi-PT, cross-PT triggers), ADR 0021 (PM → Direktur, G1 exception `direktur_via_pm[_self]`);
  plan `../plans/drms-1010.md` point 15, D4 (RAP realisation), D8 (tables).

## Context

### Owner request (DRMS 10/10, point 15)

> One project's funds/value are used by another project. Record it, approve it, and monitor what is still owed.
> **D6:** the PM submits, the Direktur approves.

Typical cases (Q-L1: money and goods both covered): project B has to start work before its client pays the first termin, so money
received for project A pays B's costs; or materials/tools bought for A are used up on B.

### Current model (read on `feat/d1010-int` `cb19838`)

| Area | Fact | Evidence |
|---|---|---|
| Cash | Single-entry ledger **per cash account**; cash accounts are per PT and have **no project** (name, kind, bank, account no., holder, Odoo journal). `project` / `costCenter` on a cash entry is an **analytic tag**, not a separate pot of money. | `collections/CashAccounts.ts:60-82`, `collections/CashEntries.ts:41-66`, ADR 0005 §1-2 |
| Cash entry sources | `transfer`, `settlement_refund`, `manual`, `reversal`, `opening` | `collections/CashEntries.ts:52-63`, `domain/cash/ledger.ts:33` |
| Project money figures | RAB (`projects.budget`), committed (Σ grand total of requests from final approval), disbursed net (Σ posted transfers − LPJ refunds), realised (verified receipts) — all per **expense request**, not per cash account | `domain/reports/kpi.ts:137-144,339-386` |
| Manual cash in project reports | Manual KK tagged with a project count as that project's **spending** (`spending()`), and project-tagged entries feed the cash-flow filter `projectId` | `domain/reports/kpi.ts:216,280,813-844` |
| RAP (D4) | planned = volume × unit price per RAP item; realised = Σ line totals of the project's requests from final approval; over plan = warning flag | `domain/rap/budget.ts:9-60` |
| Closest pattern | Addendum RAB: project document, PM creates, Direktur decides, `approvals` rows (`docType budget_addendum`), own status machine + DB guard `pk_budget_addenda_guard`, `/api/v1/budget-addenda/*` incl. `/inbox` | `collections/BudgetAddenda.ts`, `domain/addendum/rules.ts`, `api/v1/endpoints/addenda.ts`, `collections/Approvals.ts:46-49` |
| Numbering | `DEFAULT_SEQUENCES` per PT, D5 shape, monthly reset; allocation at the transition that makes the document official | `domain/numbering.ts:10-24,106-119`, ADR 0007 §4 |
| Inter-company | "Transfers between PTs (inter-company loans) are out of scope: record a manual KK in PT A and a manual KM in PT B." | ADR 0005, section "Revisi 2026-09-27 (ADR 0016)" |

Consequence: inside one PT there is **no per-project money that physically moves** when B uses A's funds — the money
sits in the PT's cash/bank accounts either way. What the owner needs is a **recorded, approved claim** of project A on
project B, with an outstanding balance that can be monitored.

## Decisions (owner, 2026-10-11)

All proposed defaults were accepted.

| # | Decision |
|---|---|
| D6 | Inter-project loans need approval: the PM submits, the Direktur approves. |
| Q-L1 | Money (`dana`) and goods/materials/tools (`barang`, value in Rp) are both recorded as loans to be repaid; the cost of goods **stays** on the lender's RAP (no reallocation). No interest. |
| Q-L2 | Same PT only. Between PTs Finance keeps recording a manual KK in PT A and a KM in PT B. |
| Q-L3 | No lender-PM approval step; the lender PM is notified and can read the loan. Borrower PM = lender PM is marked on the detail. |
| Q-L4 | Due date (jatuh tempo) is required; it drives "Terlambat" and the reminders. |
| Q-L5 | A PM who is the PT's **only** Direktur may approve his own loan, recorded as exception `direktur_self` (audit + note on the detail); when another Direktur exists, the other Direktur decides. |
| Q-L6 | Overdue reminder: daily through the existing reminder job, to the borrower PM and the Direktur, while overdue; can be switched off per PT. |
| Q-L7 | Repayments need no Direktur approval: recorded by the borrower PM or Finance, Direktur and lender PM notified; a wrong entry is voided with a reason. |

## Decision

### 1. Entity `project-loans` (table `project_loans`, per PT — ADR 0016 class "per PT — transaction")

| Field | Type / rule |
|---|---|
| `company` | required, copied from the borrower project, immutable (`pk_protect_columns`) |
| `docNo` | `PJ/{COMPANY}/{YY}{MM}/{seq}`, allocated at submit (§6), immutable |
| `lenderProject` ("Project pemberi pinjaman") | required, `projects`, same PT, not `arsip` at submit |
| `borrowerProject` ("Project peminjam") | required, `projects`, same PT, ≠ lender (CHECK), not `arsip` at submit |
| `kind` | `dana` ("Dana") \| `barang` ("Barang/material", value in Rp) — default `dana` (§8, Q-L1) |
| `amount` | positive integer Rupiah (same rule as the addendum `addition`: safe integer > 0, sanity bound Rp 1 T) |
| `reason` ("Alasan") | required, 3–1000 chars |
| `loanDate` ("Tanggal pinjaman") | business date (PT TZ), default today, not in the future |
| `dueDate` ("Jatuh tempo") | required (Q-L4), ≥ `loanDate` |
| `attachments` | optional `media-attachments` (max 5) — e.g. memo, termin schedule |
| `status` | §2 |
| `repaidTotal`, `outstanding` | system, maintained by the service (outstanding = amount − Σ posted repayments), DB CHECK `0 ≤ repaidTotal ≤ amount` |
| `createdBy`, `submittedAt`, `decidedAt`, `decidedBy`, `rejectReason`, `cancelReason`, `approvalCycle`, `g1Exception`, `source` (web/apk), `clientUuid` | as on `budget-addenda` / `expense-requests` |

Child collection **`project-loan-repayments`** (table `project_loan_repayments`): `loan`, `company` (copied), `repayDate`,
`amount` (integer > 0, ≤ outstanding under a row lock on the loan), `note`, `attachments`, `status` (`posted|void`),
`voidReason`, `recordedBy/At`, `voidedBy/At`. No own document number (shown as "Pengembalian ke-n" of the loan);
append-only like cash entries — a mistake is voided with a reason, never edited.

### 2. Status flow

```
Draft ──submit──▶ Menunggu persetujuan Direktur ──approve──▶ Disetujui ──repay (partial)──▶ Sebagian kembali ──repay (rest)──▶ Lunas
  │                     │            │                          │                                   │
  └─cancel─▶ Dibatalkan ◀─cancel─────┘  └─reject─▶ Ditolak       └─cancel (Direktur, no repayment)─▶ Dibatalkan
```

| Value | Label | Notes |
|---|---|---|
| `draft` | Draft | editable by the creator |
| `pending_approval` | Menunggu persetujuan Direktur | locked (content frozen like an expense request) |
| `approved` | Disetujui | outstanding = amount; counts in all loan figures from here |
| `partially_repaid` | Sebagian kembali | 0 < repaidTotal < amount |
| `repaid` | Lunas | repaidTotal = amount; terminal unless a repayment is voided (→ back to `partially_repaid`/`approved`) |
| `rejected` | Ditolak | reason required; terminal; a new attempt = a new loan (ADR 0007 §4 "resubmission = new document") |
| `cancelled` | Dibatalkan | reason required; by the creator from Draft / Menunggu, by a Direktur from Disetujui **only while no repayment is posted** |

**Overdue ("Terlambat") is derived, not a status:** `dueDate < today (PT TZ) AND outstanding > 0 AND status IN
(approved, partially_repaid)`. A DB trigger `pk_project_loans_guard` mirrors the allowed transitions (pattern of
`pk_budget_addenda_guard`) and freezes the content columns outside Draft.

### 3. Who submits

- **Creator = the PM of the borrower project** (`projects.pm`, resolved at submit; must hold `pk-pm` and an active
  membership in the PT — ADR 0021 §2). The borrower asks; the lender is the one giving something up, so it must see
  the request but does not decide (D6 names one approver).
- **PM of both projects:** allowed — he is simply the borrower PM. The loan carries a visible note "PM peminjam =
  PM pemberi" (web/APK detail, PDF if any) so the Direktur sees that nobody spoke for the lender separately.
- **Lender PM** (when different): notified at submit and at the decision (`project_loan.submitted` /
  `project_loan.decided`), can read the loan; no decision step (Q-L3: no lender-PM consent step).
- Direktur / Admin / Finance do **not** create loans in v1 (D6 = PM submits). Admin can read; Finance reads and may
  record repayments (§7).

### 4. Direktur approval and G1 (ADR 0021)

- One decision level: **Direktur (`pk-owner`) of the loan's PT**, decided with Setujui / Tolak (reason required for
  Tolak). Fixed in code, **not** through `approval-rules` (no configurability was asked for; avoids extending
  `ruleDecisionError` and the rule admin UI). Decisions are written to `approvals` with a new `docType: project_loan`
  and relation `loan` (same signature/source/device columns as today), so the timeline component and the
  "one decision per person per cycle" unique index work unchanged.
- **G1 — creator never decides** (DB `pk_approvals_before_insert` gets a `project_loan` branch: actor ≠ creator).
- **PM who is also a Direktur** (the ADR 0021 "Utamakan Direktur lain" answer, applied here):
  - another active Direktur in the PT exists → only the other Direktur(s) decide (`g1_exception` stays NULL; the
    creator is simply excluded from the pool);
  - the creator is the PT's **only** Direktur → self-approval allowed, recorded as
    `g1_exception = 'direktur_self'` (audit `approval_policy_exception`, note on the detail "Disetujui Direktur
    pembuat karena satu-satunya Direktur PT"), the same trade-off the owner accepted for `direktur_via_pm_self` (Q-L5).
- Notifications: `project_loan.pending` to the Direktur pool (inbox "Persetujuan", card "Menunggu tindakan saya"),
  `project_loan.decided` to the creator and the lender PM, `project_loan.overdue` (daily through the existing reminder job while overdue, switchable per PT — Q-L6)
  to the borrower PM and the Direktur.

### 5. Cash / ledger effect — **notional allocation, no cash entries**

| Option | What it means here | Assessment |
|---|---|---|
| **A. Paired cash entries** (`sourceType: project_loan`): KK tagged lender + KM tagged borrower on the same cash account, and the mirror pair at repayment | Two numbered KK/KM rows per loan and per repayment for money that never left the account | Inflates gross cash in/out (K-02 cash flow, Rekap Kas) by 2× the loan; the lender KK would count as **project spending** in `spending()` unless every report learns a new exclusion; needs a cash account choice that is arbitrary; subject to the period lock and overdraft check for a non-event; reversal/void semantics for a pair; Odoo mirror would emit two meaningless moves. Fits only if a project owned its own bank account — it does not (`CashAccounts.ts`). |
| **B. Notional allocation** (chosen) | The loan document + repayment rows are the record; no `cash_entries` row | Cash balances and the cash book stay true (nothing moved); project reports get two explicit figures "Pinjaman diterima" / "Pinjaman diberikan" and the outstanding; no ledger rule changes; no period-lock interaction (loans are not accounting entries; a closed cash period does not freeze them). |

Chosen: **B**. A new `sourceType` is **not** added. If one day a project gets its own bank account (or the owner
wants a real transfer between two accounts), Finance records it as today — a manual KK on one account and a manual KM on
the other — and may reference the loan number in the description; the loan stays the authoritative claim.

**Cross-PT** (lender and borrower in different PTs) is a real inter-company receivable/payable with its own tax and
legal treatment (ADR 0005 revision: manual KK in PT A + KM in PT B). Decided: **same PT only** (Q-L2), enforced by
`pk_same_company` on both project references (ADR 0016 §4) and a 400 "Project pemberi dan peminjam harus di PT yang
sama." in the service.

### 6. Numbering

New doc type `project_loan`, default sequence `{ docCode: 'PJ', pattern: 'PJ/{COMPANY}/{YY}{MM}/{seq}', resetPolicy:
'monthly', padding: 4, startAt: 1 }` added to `DEFAULT_SEQUENCES` (`domain/numbering.ts`), seeded per PT by the
migration and by "copy defaults" for new PTs. Allocated at **submit** (Draft has no number), date token = `loanDate`
in the sequence TZ, audit `number_issued` in the same transaction (ADR 0007 §5). Example: `PJ/DRMS/2610/0001`. Unique
`(company_id, doc_no)`. Repayments are not numbered (§1).

### 7. Repayments (partial)

- Recorded by the **borrower PM or Finance** of the PT (POST `…/repayments`, amount ≤ outstanding, `repayDate` not
  before `loanDate` and not in the future), only while the loan is `approved` / `partially_repaid`. Each repayment
  recomputes `repaidTotal` / `outstanding` / status under `SELECT … FOR UPDATE` on the loan (concurrent repayments
  serialise; DB CHECK is the backstop).
- **No Direktur approval** for a repayment (it only lowers the claim); the Direktur and the lender PM are notified
  (`project_loan.repaid`) — Q-L7.
- **Void** of a repayment: Direktur or Finance, reason required, audited `void`; the loan status moves back
  (`repaid` → `partially_repaid` / `approved`).
- Full early repayment and several partial repayments are the same operation; there is no interest (Q-L1 note).

### 8. Effect on RAB/RAP, realisation and project figures

- **RAB and RAP are not changed** by a loan: it is a funding arrangement, not a budget change (a budget change stays an
  Addendum RAB, ADR 0013 / E5). The borrower's expenses are still charged to the borrower's RAP items through its own
  expense requests (D4), so "Melebihi RAP" keeps meaning "over the borrower's own plan".
- **Realisation / committed / disbursed / verified** (K-05…K-08, `domain/rap/budget.ts`) are unchanged — they are
  computed from expense requests, and a notional loan creates none.
- **Project "P&L"**: the app has no revenue/cost P&L per project today (only RAB vs committed/realised and the
  project-tagged cash flow). A loan is neither revenue nor cost, so no P&L-type figure changes. The project page shows
  a new block "Pinjaman antar project" with *Pinjaman diterima (outstanding)* and *Pinjaman diberikan (outstanding)*;
  the project-filtered cash flow is untouched (option B).
- **Kind `barang`** (materials/tools of A consumed on B): recorded as a claim in Rp exactly like `dana`, so B owes A
  the value. The cost **stays on A's RAP** (it was charged there when A's request was approved); moving realised cost
  from A to B would be a "realokasi biaya" across RAP items, a different feature — not done (Q-L1).

### 9. Reports and dashboard

- **Report "Pinjaman antar project"** (Keuangan → Laporan; D8 table with search, filter PT / project / status /
  overdue, pagination; Excel export): one row per loan (no., date, lender, borrower, amount, repaid, outstanding, due,
  status, days overdue) + a per-project summary.
- **Per-project summary** (SQL over `project_loans` + posted repayments, `projectScopeSql(scope)` so PM sees his team
  projects, office roles their PTs — ADR 0016 §6): `borrowed` (Σ amount as borrower, approved and later), `lent`,
  `outstandingBorrowed`, `outstandingLent`, `overdueBorrowed`, `overdueCount`.
- **Dashboard card "Pinjaman antar project"** on the Direktur and Finance dashboards (and the PM dashboard for his
  projects): totals outstanding / overdue, top 5 projects by outstanding, link to the report; waiting loans appear in
  "Menunggu tindakan saya" for the Direktur.
- **Price visibility:** loan amounts are money figures → Direktur, Admin, Finance, PM only (same rule as RAP money,
  owner 2026-10-10); Staff and Operator never see loans.

### 10. Audit (ADR 0006)

Every write audited with `docType: project_loan` and the PT: `create`, `update` (Draft), `number_issued`,
`status_change` (submit), `approve` / `reject` (+ `approvals` row), `approval_policy_exception` (§4), `status_change`
(cancel, reason), repayment `create` / `void` (reason), `access_denied` for refused decisions (G1, wrong PT, wrong
role). Audit and `approvals` rows are append-only as today.

### 11. API and APK scope

- `/api/v1/project-loans` (pattern of `/budget-addenda`): `GET` list (filters `project`, `role=borrower|lender`,
  `status`, `overdue`, `q`, numbered pages), `GET /inbox`, `GET /:id` (incl. repayments, timeline, `allowedActions`),
  `POST`, `PATCH /:id` (Draft), `POST /:id/submit|cancel|approve|reject`, `POST /:id/repayments`,
  `POST /:id/repayments/:rid/void`. Company from the borrower project (`withNamedCompany`, ADR 0016 §5). OpenAPI updated.
- **APK (owner concern: web = APK):** v1 parity for the two roles in D6 — PM: create/edit Draft, submit, cancel, list +
  detail on the project screen (tab or section "Pinjaman"); Direktur: decide from the existing inbox (server
  `allowedActions`, same decision bar as the addendum), detail. Repayment entry and its void: **web only in v1**
  (Finance work; PM on web). Online only (no offline draft sync — low volume, avoids a sync schema change).

### 12. Tests

- **Unit:** status transitions table; input errors (amount, reason, dates, lender ≠ borrower); outstanding / overdue
  arithmetic (partial, full, void back); G1 pool resolution (other Direktur exists / only Direktur / PM of both);
  numbering default + `patternError`.
- **Integration:** happy path PM → Direktur → two partial repayments → Lunas → void one → Sebagian kembali; Tolak with
  reason; cancel rules (creator in Draft/Menunggu, Direktur after approval only without repayment); 403 for Staff,
  Finance, lender PM, PM of another project deciding; creator Direktur refused when another Direktur exists;
  `direktur_self` path recorded (audit + column); cross-PT refused (service 400 + DB trigger); concurrent repayments
  never exceed the amount; number `PJ/<code>/<YYMM>/0001` per PT and monthly reset; report/dashboard figures per
  project and per scope (PM sees team only, PT isolation — extend `mc-isolation`); **no `cash_entries` row is created**
  and K-01/K-02/`spending()` are unchanged (reconciliation guard for option B); DB guard refuses edits outside Draft and
  invalid transitions; APK API contract (`allowedActions`, labels).
- **Semgrep:** new raw SQL goes through `projectScopeSql` / company helpers (existing rule set).

### 13. Migration plan

1. `20261013_100000_d1010_project_loans` (Payload-generated, + `.json` snapshot): tables `project_loans`,
   `project_loan_repayments` (+ `_rels` for attachments), enum values (`approvals.doc_type` += `project_loan`,
   `approvals.loan_id`), `document_sequences` doc type `project_loan`, notification templates.
2. `20261013_100100_d1010_project_loans_guard` (security): `company_id NOT NULL` + immutable, `pk_same_company`
   triggers for both projects and the repayment's loan, CHECKs (amount > 0, lender ≠ borrower, repaid ≤ amount,
   `g1_exception` values), `pk_project_loans_guard` (transitions, frozen content), `pk_approvals_before_insert`
   `project_loan` branch, unique `(company_id, doc_no)`, grants for the app role (no DELETE).
3. Data: seed the `PJ` sequence for every existing PT (idempotent, skips a PT that already has one).
4. Additive only — no existing data changes; `down()` drops the new objects (pre-production) and restores the previous
   `pk_approvals_before_insert` body.

## Alternatives

| Alternative | Why not (now) |
|---|---|
| Paired cash entries (`sourceType project_loan`) | §5 option A: distorts cash flow and project spending, arbitrary cash account, nothing really moves. |
| Reuse the expense request (a "Pengajuan" from B charged to A) | Mixes a claim between projects with a payment to an employee; no outstanding/repayment concept; breaks D4 (lines charged to the wrong RAP). |
| Reuse `approval-rules` (`docType project_loan`) | Configurable levels nobody asked for; more admin and validation surface. Can be added later without a data change (snapshot column would be added then). |
| Allow cross-PT loans with paired documents in both PTs | Inter-company debt needs accounting/tax treatment outside ProyekKas' single-entry cash book; one approval spanning two PTs' role sets. Not done (Q-L2). |
| Status "Terlambat" stored | A stored overdue flag needs a job and goes stale; derived from `dueDate` it is always right. |

## Consequences

- Positive: the owner gets an approved, numbered, auditable record of every use of one project's funds by another,
  with outstanding and overdue visible per project; cash books stay true; no change to RAP/realisation logic.
- Negative: the loan is a **memo claim** — the app cannot prove that B actually used A's money (it does not know
  which project's money is in which account). The claim is as good as the PM's statement and the Direktur's approval.
- One more inbox item type for the Direktur; one more document type in numbering, audit and isolation tests.

## Rollback

Feature is additive: hide the menu/cards and revert the code; `down()` of both migrations before production. After
production use, keep the tables (read-only) — loans are approval evidence.

## Pertanyaan untuk owner

All answered on 2026-10-11 (section "Decisions"): Q-L1…Q-L7 = the proposed defaults. No open questions.

## Note 2026-10-14 (ADR 0028)

Q-L2 (same-PT loans only) is unchanged by ADR 0028. Phase C's inter-PT loan document will reuse `intercompany_links`
(`source_doc_type = intercompany_loan` / `intercompany_loan_repayment`) for its disbursement and repayments, which then
are real cash movements between PTs (unlike same-PT loans, §5 option B).

## Note 2026-10-14 (ADR 0029)

Money lent **between PTs** is the "Pinjaman antar-PT" of [ADR 0029](0029-fund-check-and-inter-pt-loans.md) (`PJA`,
real cash movements through `intercompany_links`, doc types `intercompany_loan_disbursement` /
`intercompany_loan_repayment` — these replace the provisional names `intercompany_loan` / `intercompany_loan_repayment`
of the 2026-10-14 note above). Same-PT project loans (`PJ`, Q-L2) are unchanged.

## Note 2026-10-21 (ADR 0031)

§5 is **amended**: with the project → cash account mapping ("Pusat Biaya = akun kas"), a loan of **money** between two
projects with different Pusat Biaya posts KK on the lender account and KM on the borrower account when Finance
disburses it ("Cairkan"), and every repayment posts the mirror pair (Finance only). Goods, or two projects on the same
account, stay a notional claim (option B). A transfer paid from an account other than the project's Pusat Biaya creates
an automatic, approved loan whose lender is that account (`origin = 'transfer'`). See ADR 0031.

## Amendment 2026-10-24 (DRMS 24/10 #10–#12)

User decisions 2026-10-24 amend §3 (who files), §4 (approval), §7 (repayments); details of the cash side in
[ADR 0031](0031-pusat-biaya-akun-kas.md) "Amendment 2026-10-24".

- **§3 Who files.** The borrower project's PM **or a Finance user of the PT** (`pk-finance`) creates and submits a manual
  loan. Finance picks borrower and lender among the PT's open projects (`GET /project-loans/options` lists them).
  `project_loans.submitter_role` records `pm` | `finance`, frozen at create; the DB insert guard checks that the creator
  holds that role in the PT (`pm` = pk-pm **and** `projects.pm` of the borrower). Existing loans keep NULL (= PM, the
  only filer before). The Direktur / Admin / Owner still never file.
- **§4 Approval: two levels.** Level 1 = Direktur (STORED `pk-owner`), level 2 = Owner (STORED `pk-principal`); the
  Owner's implied Direktur role (ADR 0026) never decides level 1. `project_loans.approval_level` = the level a pending
  loan waits at; status text "Menunggu persetujuan Direktur" / "Menunggu persetujuan Owner". Reject with a reason at
  either level ends the loan. Only the Owner's approval sets `approved` (and freezes the accounts, ADR 0031).
  - **G1:** the creator never decides. The narrow `direktur_self` (creator PM = the PT's only Direktur) stays as it was,
    **for level 1 only**; level 2 has no exception. One person never holds both levels (one decision position per
    person, existing unique index); the last Owner who could still take level 2 does not decide level 1.
  - **Pools at submit** (`decisionPools`): Direktur pool as before; Owner pool = active Owners minus the creator.
    No Owner → 409 `NO_OWNER` "PT ini belum punya Owner aktif …" (like an expense request, ADR 0026); the single
    Direktur being the single Owner → 409 `SAME_PERSON`. At the level-1 approval the Owner pool is re-checked (409
    `NO_OWNER` when it became empty).
  - **Notifications:** `project_loan.pending` (Direktur pool) → `project_loan.pending_owner` (Owner pool) →
    `project_loan.approved` (creator, lender PM, borrower PM) + `project_loan.disburse_pending` (Finance, transfer
    order); `project_loan.filed` tells the borrower PM about a loan Finance filed.
  - **DB:** `pk_approvals_before_insert` — a loan decision is level 1 by a stored Direktur or level 2 by a stored Owner
    after an approved level 1 of the cycle; `pk_project_loans_guard` — level 0 → 1 only at submit, 1 → 2 only after the
    approved level-1 row, `approved` only at level 2 after the approved level-2 row, `rejected` only with the rejection
    row of the current level (migration `20261024_400300_d2410_loan_guard`).
- **§7 Repayments.** A **claim** (goods) is still recorded at once by the borrower PM or Finance, without approval. A
  repayment of a **cash-backed** loan is a **request**: the borrower PM or Finance submits amount (≤ outstanding minus
  the requests not executed yet) + planned date (≥ loan date, may be in the future) + note → Direktur → Owner (same G1,
  no `direktur_self`: the submitter never decides) → transfer order executed by Finance (ADR 0031). Statuses
  `pending_approval` → `approved` → `posted` (= executed; every existing repayment is `posted`, no data change), or
  `rejected` / `cancelled` (reasons). The submitter cancels while pending; Finance or the submitter cancels an approved
  order before its execution. Void of a posted repayment unchanged (Finance only when cash moved). Decision rows:
  `approvals.doc_type = project_loan_repayment` + `loan_repayment_id` (own unique indexes).
- **In-flight data** (`20261024_400200_d2410_loan_data`, audited): a loan pending at the single Direktur level gets
  `approval_level = 1` and follows the new path (the Direktur's approval no longer finalises it). Approved loans keep
  their approval; a cash-backed one not yet disbursed appears as a transfer order (ADR 0031). Overdue reminders, due
  dates, automatic loans (origin `transfer`, created approved) and inter-PT loans (ADR 0029) are unchanged.
