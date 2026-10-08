# ADR 0019 — LPJ shortfall above the approved amount: tolerance, then re-approval

- **Status:** accepted (owner decision 2026-10-08 on QA-06 of the QA report 2026-10-08: "toleransi, lalu persetujuan
  ulang").
- **Date:** 2026-10-08
- **Author:** nextjs developer (branch `fix/qa-finance-integrity`, based on `main` `ac4d9a9` = v0.6.1)
- **Related:** ADR 0005 (cash ledger), ADR 0013 (approval flow Direktur → Finance), ADR 0016 (multi-PT); QA report
  2026-10-08 QA-06; requirements v1.1 T5 (US-21/US-22).

## Context

An Uang Muka is approved for `approvedAmount` and transferred. At the LPJ the verified receipts may exceed it; the
settlement then pays the **shortfall** with a second transfer (`lpj_shortfall`). Until v0.6.1 nothing compared the new
total with the approved amount: QA paid Rp 101.000 on top of Rp 1.350.000 (+7,5 %) with no decision by anybody who
approved the request.

## Decision

1. **Tolerance per PT:** `companies.shortfallTolerancePct` (0–100, default **10**; Pengaturan operasional). The highest
   total transfer without a new decision is `approved + ⌊approved × tol / 100⌋` (whole Rupiah).
2. **Up to the tolerance nothing changes** (settle pays the shortfall as before).
3. **Above it** `POST …/settle` answers **409 `SHORTFALL_REAPPROVAL_REQUIRED`** `{approvedAmount, transferredTotal
   (after the shortfall), tolerancePct, limit, shortfallApprovalStatus}` until the new total is approved.
4. **Re-approval = the existing engine (ADR 0013), smallest state:** Finance (the `settle` guard: Finance of the request
   PT, never on its own request) calls `POST …/lpj/shortfall-approval {note}`. The request's approval rule is selected
   again **for the new total** (US-34 selection, ADR 0013 rule checks, G1-2 skip rule) and snapshotted on the **LPJ**
   (`settlements.shortfallApproval*`: status `pending_ack → pending_approval → approved | rejected`, cycle, level,
   amount, snapshot, note, reject reason). The request itself stays **"LPJ Terverifikasi"** — its status machine, its
   approval cycles and the PDF are untouched.
   Decisions: `…/shortfall-approval/acknowledge` (Direktur "Diketahui" = approval), `…/approve` (Finance level 1..n),
   `…/reject {reason}`; same guards as request decisions (G1 requester/creator never, G2 current step, one position per
   person per cycle, ADR 0013 decision roles, profile signature to approve), refusals audited `access_denied`.
   Rows in `approvals` with `doc_type = 'expense_shortfall'` and `settlement_id` (no `request_id`, so nothing that
   reads the request's approvals changes). Approved → settle allowed while the approved amount ≥ the new total;
   rejected → settle stays refused, Finance may ask again (new cycle) with a new justification.
5. **Where:** web only — "Verifikasi LPJ" shows why and the request button; "Persetujuan" gets a section "Kekurangan
   LPJ di atas nominal disetujui" (`GET /api/v1/lpj-shortfall-approvals/inbox`). In-app notifications
   (`expense.shortfall_*`, doc type `expense_request`) reach the deciders on web and APK (a tap opens the request).
6. **DB guards (last line of defence):** `pk_settlements_guard` lets the `shortfall_approval_*` columns change only
   while the LPJ stays verified and only along the graph (amount/rule/note fixed per cycle, rejection needs a reason);
   `approvals_owner_doc` CHECK + G1 trigger + unique indexes cover the new owner kind; trigger
   `transfers_shortfall_tolerance` refuses an `lpj_shortfall` transfer above the tolerance without an approved
   re-approval of at least that total.

## APK

The APK approval inbox lists **requests** in `pending_ack`/`pending_approval` (`GET /expense-requests?scope=inbox`).
Moving the request into those statuses would put an LPJ-stage request into the request approval flow of released
APKs (approve there would mean "approve the request" with `approvedAmount := grandTotal`), so the request status is
**not** changed and the APK is **not** affected: no new status value reaches it (the settlement `status` values are
unchanged; `settlement.shortfallApproval` is an extra field the APK ignores and is only sent to Finance/Direktur).
Deciding from the phone needs an APK change (follow-up, not in this release).

## Alternatives

| Alternative | Why not |
|---|---|
| Hard cap at the approved amount | Owner chose tolerance + re-approval; real costs do exceed estimates. |
| Re-open the request approval (request back to `pending_ack`) | Breaks the LPJ state machine and released APK inboxes (see APK); the request PDF/history would show the shortfall as a second request approval. |
| New collection "shortfall approvals" | More schema/UI for one LPJ-bound decision; the LPJ row already has the right lifecycle and guard. |

## Consequences

- A shortfall above the tolerance waits for Direktur + Finance; settle is blocked meanwhile (by design).
- Migration `20261008_090000_qa_finance_integrity` (additive). Rollback refused once a re-approval exists
  (append-only decision rows) — restore the dump.
- Open: APK decision screen for shortfalls; whether a PT wants a different rule than the request's own rule.
