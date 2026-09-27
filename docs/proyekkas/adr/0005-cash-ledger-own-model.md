# ADR 0005 — Cash & bank: own append-only ledger (not Odoo `account`), Odoo-mappable

- **Status:** accepted (user, GATE F0 2026-09-23); implementation recorded after F2a and F2b (see Revision history)
- **Date:** 2026-09-23
- **Author:** Analyst/Architect — Phase 0
- **Related:** requirements v1.0 §4 (Kas & bank), §7 T3/T5–T8, §8, §9 ("Tutup buku bulanan");
  `reference/prompt-lead-proyekkas.md` ("Analisis dulu apakah kas & bank memakai `account` Odoo…");
  brief §2 #1–#2; ADR 0001, 0006, 0007; Odoo-mirror ADR `0009-*.md` (other agent); `../architecture.md` §4, §5

## Context

The original lead prompt asked: *use Odoo `account` (journals, lock dates) or an own cash model?* With
user decision #1 (build outside Odoo) the question becomes: own ledger now, and how to keep it mappable
to Odoo `account.move` for the later transition (#2).

Verified in the running Odoo 19 image (`docker exec odoo-pool-a grep …`, read-only, 2026-09-23;
path `/usr/lib/python3/dist-packages/odoo/addons/`):
- `account/models/account_move.py`: fields `ref`, `date`, `state`, `move_type`, `journal_id`, `line_ids`,
  `partner_id`, `payment_reference`, `reversed_entry_id`; methods `_reverse_moves()`, `action_reverse()`.
- `account/models/account_move_line.py`: `move_id`, `account_id`, `name`, `debit`, `credit`, `balance`,
  `partner_id`, `product_uom_id`, `quantity`, `price_unit`, `analytic_distribution` (`fields.Json`).
- `account/models/company.py`: `fiscalyear_lock_date`, `tax_lock_date`, `sale_lock_date`,
  `purchase_lock_date`, `hard_lock_date`.
- `base/data/res_currency_data.xml`: IDR `rounding` **0.01**, symbol `Rp`, `active` False by default.
- `hr_expense/models/hr_expense.py`: `analytic_distribution` present; field `former_sheet_id` suggests
  expense sheets changed in 19 (mapping detail = ADR 0009).

## Decision

1. **Own ledger in ProyekKas** — collection `cash-entries` (table `cash_entries`), single-entry cash book
   per company cash/bank account (`cash-accounts`), which is what the requirements describe (KM/KK,
   balance per account, recap per category/project, void/reversal, monthly closing). No double-entry COA
   inside ProyekKas; COA codes are carried as **mapping attributes** for Odoo.
2. **Row model** (see ERD in `../architecture.md` §4):
   `entryNo` (KM/KK numbering, ADR 0007), `entryDate` (date, company TZ Asia/Makassar), `period`
   (`YYYY-MM`, derived), `direction` (`in|out`), `amount` (**positive integer Rupiah**), `cashAccount`,
   `category` (out; `expense-categories`, has `coaCode`) **or** `cashInSource` (in; has `coaCode`),
   `project` **xor** `costCenter` (analytic), `counterpartyType/Id` (client/vendor/employee),
   `description`, `proof` (media), `sourceType` (`transfer|settlement_refund|manual|reversal|opening`),
   `sourceId`, `status` (`posted|void`), `reversalOf` (FK, only on reversal rows), `voidReason`,
   `postedBy`, `postedAt` (DB `now()`), `odooSyncState` (ADR 0009).
3. **Automatic postings** (domain service, same DB transaction as the business transition):
   - T3 transfer (advance or reimburse, or LPJ shortfall top-up) → `out` entry, `sourceType=transfer`.
   - T5 settlement with surplus → `in` entry, `cashInSource = "Pengembalian LPJ"`, `sourceType=settlement_refund`.
   - Manual T6/T7 by Finance (US-23) → `sourceType=manual`, proof optional.
   - Opening balance per account → one `opening` entry at go-live (not a mutable field on the account).
4. **Void / reversal (T8, US-24)**: never delete, never change `amount/direction/account/date` of a posted
   row. Void = insert a **reversal row** (`direction` inverted, same `amount`, `reversalOf` = original,
   `entryDate` = today if the original's period is closed, else the original date — Odoo-like) **and**
   set original `status=void`, `voidReason`. Voiding a transfer entry reverts the linked expense request
   to `Disetujui` (architecture §5.1) — transactional.
5. **Edits before closing (requirements §8 T6/T7 "diedit hanya sebelum tutup buku", reason required)**:
   allowed only for *manual* entries, only descriptive fields (`description`, `category`/`cashInSource`,
   `project/costCenter`, `proof`) while the period is open; amount/date/account/direction changes = void
   + new entry. Every edit audited with reason (ADR 0006).
6. **Period closing**: `period-closings` rows (`period`, `closedAt`, `closedBy`, `reopenedAt`,
   `reopenedBy`, `reason`); company-wide lock date = end of the last closed period. **DB trigger** on
   `cash_entries` rejects INSERT/UPDATE where `entry_date <= lock_date` (except the `status/void_reason`
   columns on a row whose reversal is being inserted in an open period). Re-opening a period = Owner only,
   reason mandatory, audited (client question whether re-open is allowed at all).
7. **Balances**: computed by SQL (`opening + Σin − Σout`) per account; no stored running balance (avoids
   update anomalies). If performance requires, a monthly snapshot table filled at closing.
8. **Budget usage** (requirements finding #11): two figures per project — *disbursed* (Σ transfer outs
   linked to the project) and *realised* (Σ verified receipt amounts of LPJ-verified/reimburse requests);
   computed views, not ledger columns.

### As implemented (F2a, `develop` `c8c1af6`)

Verified in `apps/web/src/domain/cash/{ledger,periods}.ts`, `domain/expense/transfers.ts`,
`migrations/20260923_133050_f2a_security.ts`, `domain/numbering.ts`:
- **One KK per transfer.** `recordTransfer()` posts exactly one `out` entry (`sourceType=transfer`) for the
  approved amount, linked to the request and the transfer (`transfers.cash_entry_id`, set once). Its
  `category` is taken from the request lines: the lines' single category when all lines share one, else
  empty — the per-category breakdown comes from the request lines (US-25), not from split ledger rows.
- **Reversals are numbered in the KM/KK series.** `voidEntry()` inserts the reversal through the same
  `postEntry()` path, so it takes a `KM/…` (reversal of an `out`) or `KK/…` (reversal of an `in`) number from
  the `cash_in`/`cash_out` sequence of its date. There is **no `cash-reversals` collection**; the
  `reversal` doc type of ADR 0007 §1 exists in the type list but has no seeded sequence and is unused.
  Reversal description `Jurnal balik <entryNo>: <reason>`; the original gets `status=void`, `voidReason`,
  `voidedBy/At`, `reversedBy`. A reversal row cannot itself be voided; a transfer's KK is voided only via
  the transfer void (`POST …/transfers/{tid}/void`), which returns the request to its transfer queue.
- **Lock = latest closed period.** DB function `pk_cash_lock_date()` = last day of the latest period with
  `status='closed'` (mirrored by the pure `lockDate()`); used by the `cash_entries`/`transfers` triggers and
  by the service (409 before the DB would reject). Closing: Finance/Owner, only months already past,
  audited `period_close`; at most one `closed` row per period (partial unique index).
- **Re-open = only the latest closed period**, Owner only (`pk-owner`), reason mandatory (API schema: 3–1000
  chars), row set to `status=reopened` with `reopenedBy/At/reopenReason`, audited `period_reopen`.
- Manual entry edits (§5) implemented as specified: manual + posted + open period only, descriptive fields
  only, reason stored as the audit reason.

### As implemented (F2b, `develop` `59ba0a4`) — LPJ settlement postings

Verified in `apps/web/src/domain/expense/{lpj.ts,settlement-rules.ts,transfers.ts}`, `domain/cash/ledger.ts`,
`migrations/20260923_161854_f2b_security.ts`, `tests/integration/lpj.int.test.ts`:
- `difference = transferredTotal − verifiedReceiptsTotal` (Σ **valid** receipts), computed at LPJ verification.
  **0 → settled at verification** (request "Selesai", no cash posting); otherwise "LPJ Terverifikasi" and
  Finance runs `POST …/settle` (amount computed server-side; an optional echo must match, else 409).
- **Surplus → refund KM:** one `in` entry, `sourceType=settlement_refund`, cash-in source code `LPJ`
  ("Pengembalian LPJ"), amount = difference, linked to the request (project/cost center copied); proof
  (`media-attachments`) optional. DB: such a row must be cash-IN, amount = verified surplus, request in
  "LPJ Terverifikasi".
- **Shortfall → transfer + KK:** a T3 transfer of kind `lpj_shortfall` (own transfer number) of −difference to
  the request's bank snapshot, bank reference + proof required, posting its automatic KK like any transfer;
  `transferredTotal` increases by that amount. DB: only for a shortfall-verified LPJ, one posted per request.
- Settlement date defaults to today, not in the future, and the period lock applies (409, DB-enforced).
- **Void rule:** the refund KM cannot be voided on its own (`POST /cash-entries/{id}/void` → 409 "tidak dapat
  di-void terpisah dari LPJ"), and the shortfall transfer cannot be voided once the request is "Selesai"
  (transfer void → 409, state machine). **Settlement reversal is not implemented** — F6 backlog
  (`phase-plan.md`).

### As implemented (S3b, go-live data import E11) — opening balance

Verified in `apps/web/src/collections/CashAccounts.ts`, `src/import/run.ts`,
`migrations/20260926_133934_s3b_data_import.ts`, `tests/integration/s3b-import.int.test.ts`:
- **Deviation from §3 (kept on purpose):** the opening balance stays the field `cash-accounts.openingBalance`
  (balances = `opening + Σin − Σout`, §7), **not** an `opening` ledger row. Reasons: every report (K-01/K-02,
  Rekap Kas) already reads the field; an `opening` row would need a KM number, a category/source and would appear
  as "cash in" in the go-live month's flow, distorting K-02; the Odoo mirror (ADR 0009) can still emit one opening
  move per account from the field + date. The `opening` value of `sourceType` stays reserved/unused.
- **Opening date:** new field `openingBalanceDate` (`YYYY-MM-DD`, set to the go-live date by the import; NULL for
  accounts without one). DB trigger `pk_cash_entries_opening_guard`: no cash entry dated before its account's
  opening date (the opening balance already contains everything before go-live).
- **Lock (decision S3b):** once a period **on or after** the month of `openingBalanceDate` is closed,
  `openingBalance` and `openingBalanceDate` are immutable (collection hook → 409 with an Indonesian message; DB
  trigger `pk_cash_accounts_opening_lock`, SQLSTATE 42501). Before that, Finance may correct it with a reason
  (F2 rule). After the lock, corrections are manual KM/KK entries with a reason. Rationale: after a close the opening
  balance is part of a reported closing balance; changing it would silently rewrite a closed period (§6). The
  cut-over closes the month **before** go-live, which intentionally does not lock, so discrepancies found in the
  first weeks can still be fixed until the go-live month is closed. Accounts without an opening date keep the F2
  rule (change with reason, no lock).
- **Cut-over by the import** (`--commit`): opening balances + date = go-live date; the month before go-live is closed
  (`period-closings` row, audited `period_close`) unless it is already closed/locked or was re-opened.

### Odoo mapping hints (for ADR 0009, not binding here)

| ProyekKas | Odoo 19 |
|---|---|
| `cash-accounts` | `account.journal` (type bank/cash) + its default `account.account` (mapping field `odooJournalCode`) |
| `cash-entries` row | `account.move` (`move_type='entry'`, `journal_id`, `date`=`entryDate`, `ref`=`entryNo`) with 2 `account.move.line`: cash account vs `category.coaCode` / `cashInSource.coaCode`; `debit/credit` = `amount` |
| `project` / `costCenter` | `analytic_distribution` = `{"<analytic_account_id>": 100}` on the non-cash line |
| reversal row | `reversed_entry_id` → original move (Odoo `_reverse_moves`) |
| `period-closings` lock | `res.company.fiscalyear_lock_date` / `hard_lock_date` |
| integer Rupiah | IDR rounding 0.01 → integers map losslessly; IDR currency must be activated (`active` False by default) |
| expense lines (UoM, qty, total) | `hr.expense` (`product_uom_id`, `quantity`, `total_amount_currency`) — details ADR 0009 |

## Alternatives

| Alternative | Rejected because |
|---|---|
| Odoo `account` now as system of record | User decision #1 (outside Odoo); needs COA/journals/`l10n_id` setup and accounting skills from DRMS now; ties APK availability to Odoo pool capacity |
| Double-entry ledger inside ProyekKas | Over-engineering for a cash book; COA ownership belongs to Odoo later; mapping attributes suffice |
| Mutable balance column on `cash-accounts` | Update anomalies/races; not auditable |
| Soft-delete (Payload `trash`) for wrong entries | Violates "no hard delete, void with reason, original stays visible" (requirements §1 #6, US-24) |

## Consequences

- Simple, auditable cash book matching the client's mental model; Odoo mirror maps each row 1:1 to a
  2-line journal entry.
- Accounting correctness (COA mapping, taxes such as "pajak restoran" on receipts) is **not** handled
  here — taxes stay informational on receipts (client question whether PPN/PB1 must be split).
- Closing locks require DB-level enforcement (trigger) in addition to app checks.

## Security implications

- App DB role has no DELETE on `cash_entries`; UPDATE limited by trigger to allowed columns/state
  (ADR 0006 role model). Finance cannot alter approved/transferred amounts (requirements §4 rule 2) —
  enforced by the transfer amount being copied from the approved request server-side.
- All postings/voids/edits audited with reason; reversal requires `pk-finance` (Owner optional per
  requirements §4 "X opsional" — client question).

## Rollback

Before go-live: schema is migration-managed; drop/replace via migration. After go-live: ledger rows are
permanent; changes only by additive migrations. Moving the system of record to Odoo later = ADR 0009
(one-way mirror first, then cut-over plan).

## Proposed CLAUDE.md changes (need user approval; author does not edit)

None.

## Revision history

- **2026-09-23 (F0 gate):** accepted by user.
- **2026-09-23 (F2a):** "As implemented" section added, verified against `develop` `c8c1af6`: one KK per
  transfer (category = the lines' single category, else empty); reversals numbered in the KM/KK series (no
  `cash-reversals` collection, `reversal` sequence unused); lock = last day of the latest closed period
  (`pk_cash_lock_date()`); only the latest closed period can be re-opened, Owner only, reason required.
  Status stays accepted.
- **2026-09-24 (F2b):** "As implemented (F2b)" section added, verified against `develop` `59ba0a4`: settlement
  refund KM (`settlement_refund`, source `LPJ`) / shortfall `lpj_shortfall` transfer + KK, exact amount settles
  at verification, DB cross-checks; void of a refund KM or of a shortfall transfer → 409, settlement reversal
  not implemented (F6 backlog). Status stays accepted.
- **2026-09-26 (E9, S3 track A):** settlement reversal implemented — `POST …/settle/reverse` (Finance, reason)
  voids the refund KM (reversal row) or the shortfall transfer + KK and returns the LPJ to "Terverifikasi"; refused
  (409) when the settlement transaction lies in a closed period (§6: re-open by Direktur first), so the reversal row
  is always dated like the original. A refund KM still cannot be voided from the cash book alone (409 with a pointer
  to the LPJ action). Architecture §5.1 updated. Status stays accepted.
- **2026-09-26 (S3b, E11):** "As implemented (S3b)" added: opening balance stays a field (deviation from §3 with
  rationale) + `openingBalanceDate`; lock after the first close on/after the opening month (hook + DB trigger);
  no cash entry before the opening date; cut-over closes the month before go-live. Verified against branch
  `feat/s3b-e11-data-import`. Status stays accepted.
