# ADR 0024 — Configurable approval rules + Direktur no-approval

> **Amended by [ADR 0026](0026-owner-approval-level-above-direktur.md) (owner, 2026-10-13).** The zero-step rule is now
> allowed only for requester role = **Owner** (`pk-principal`, rule "Pengajuan Owner", exception
> `principal_no_approval`); a Direktur's own request ("Pengajuan Direktur") is approved by the Owner. Requests that
> already carry `direktur_no_approval` keep their state and wording. "Peran pemohon" and everything else stand.

- **Status:** Accepted (owner decision 2026-10-11, confirmed by the owner). Staging first; no production deploy without
  separate owner approval.
- **Date:** 2026-10-11
- **Author:** nextjs developer (branch `feat/d1010-e-approval-config`, from `feat/d1010-int` `a7ec8ad`)
- **Supersedes in part:** [ADR 0021](0021-approval-pm-direktur.md) — decision 4 (the 409 "Pengajuan untuk Direktur
  dibuat oleh PM project …" for new requests) and decision 5 (the narrow G1 exception `direktur_via_pm` /
  `direktur_via_pm_self`: the PM files a Direktur's request) **for new submissions**. Everything else of ADR 0021 (PM
  project → Direktur → Finance transfer, PM decides only as PM of the request, labels, Addendum RAB unchanged) stays.
  Also an explicit, audited exception to ADR 0013 G1-2 ("at least one independent decision must remain").
- **Related:** ADR 0006 (audit), ADR 0008 (PDF), ADR 0013, ADR 0016 (roles per PT), ADR 0019 (LPJ shortfall), ADR 0021,
  ADR 0022 (inter-project loans, reuses the ADR 0021 G1 rules — see "Consequences").

## Context

Owner, 2026-10-11:

1. Default flow unchanged: **Staff → PM project → Direktur → Finance (transfer only)**. A PM filing for himself or for a
   Staff → PM step skipped → Direktur → Finance.
2. **A Direktur filing his OWN request → straight to the Finance transfer queue, with no approval step.** No other
   Direktur approves it and the PM no longer files on the Direktur's behalf.
3. The LPJ shortfall of such a request follows the same rule; Addendum RAB unchanged (Direktur → Finance).
4. "Pastikan aturan approval bisa dikonfigurasi": rules get a requester-role condition and may have zero steps — with
   guardrails so an Admin cannot open a no-approval path for Staff.

ADR 0021 had implemented the Direktur case as "PM files on the Direktur's behalf, PM approves, then another Direktur (or
the requester Direktur when he is the only one)". That path is withdrawn for new requests.

## Decision

1. **"Peran pemohon"** (`approval-rules.requesterRoles`, hasMany select: Direktur `pk-owner`, PM, Staff, Finance,
   Admin; empty = any requester). A rule matches only when **every** requester employee holds one of the roles **in the
   request's PT** (union of the roles of its active accounts with an active membership there; an employee without an
   account matches no role condition). Selection order unchanged: lowest **Prioritas**, then most specific (a requester
   condition counts as one more specificity), then narrower amount band, then lowest id (`rules.ts` `selectRule`).
2. **Zero-step rule** = "Tanpa persetujuan — langsung ke antrian transfer Finance": allowed **only** for an
   expense-request rule whose requester roles are **exactly {Direktur}** and whose "Diketahui" is **Tidak dipakai**.
   Enforced in the collection hook (`ruleDecisionError` → `zeroStepRuleError`, 400 in Indonesian) **and** in the DB
   (deferred constraint triggers `approval_rules_zero_step` on `approval_rules`, `approval_rules_steps`,
   `approval_rules_requester_roles`, SQLSTATE 23514). Changes need a reason and are audited (existing
   `reasonOnAnyUpdate`). The rule form shows an explanation and a live preview ("Contoh: pengajuan oleh Direktur →
   langsung ke Finance", `ApprovalRulePreview`).
3. **Direktur no-approval exception** `direktur_no_approval` (snapshot `selfApproval` + column
   `expense_requests.g1_exception`, the existing ADR 0021 mechanism): set at submit when the selected rule has zero steps
   AND every requester account holds Direktur in the PT AND the **creator is one of those Direktur accounts** (his own
   request). Otherwise 409 `MSG_DIREKTUR_OWN_REQUEST` ("… harus dibuat dan dikirim sendiri oleh Direktur pemohon …").
   - Submit: Draft → "Menunggu persetujuan" → **Disetujui** in one transaction, no decision row; `approvedAmount =
     grandTotal`, `approvedAt` (start of the transfer SLA); Uang Muka → transfer queue, Reimburse → Finance receipt
     verification. Audit `approval_policy_exception` (reason "Tanpa persetujuan — pengajuan Direktur (kebijakan PT)",
     rule id/name, cycle).
   - Reimburse re-approval (receipt revision with a new total): rule re-selected; zero-step → approved again, audited.
   - **DB:** `pk_expense_requests_g1_exception` accepts `direktur_no_approval` at the submit freeze point only when
     `pk_no_approval_allowed` (applied rule = zero-step Direktur rule of the request's PT without "Diketahui", snapshot
     without steps carrying the value, every requester employee has an active Direktur account with an active membership
     in that PT, the creator is one of them); CHECK widened. New guard `expense_requests_approval_guard`: "Menunggu
     persetujuan" → "Disetujui" needs a decision row (acknowledged/approved) of the current cycle unless the request
     carries `direktur_no_approval`.
   - Visible: detail timeline step **"Persetujuan" (Dilewati)** with the note "Tanpa persetujuan — pengajuan Direktur
     (kebijakan PT)" (web `approval-timeline.ts` = APK `turn_timeline.dart`), status **"Tanpa persetujuan (Antri
     Transfer)"** / **"(Verifikasi Nota)"** (`NO_APPROVAL_STATUS_LABELS`, never "Disetujui"), transfer queue badge
     "Tanpa persetujuan (Direktur)" (`noApproval`), PDF note + boxes "(tidak berlaku — tanpa persetujuan)", report
     Rekap Pengajuan column **Persetujuan**.
   - Notifications: nobody is asked to decide; on "Disetujui" the requesters, Finance (transfer queue / receipt
     verification) and the team PM ("Pengajuan Direktur: …") are informed.
   - **Finance remains the only check before money leaves** (existing transfer checks: account verification, own-request
     G1 for Finance, period lock, flags).
4. **The PM no longer files for a Direktur:** the ADR 0021 draft exception (`pmForDirektur`) is removed — a PM creating a
   request for a Direktur gets 403 "Hanya Admin/Finance yang boleh membuat pengajuan atas nama orang lain."; an
   Admin/Finance draft for a Direktur is refused at submit (409, decision 3). The ADR 0021 409 text is replaced by
   `MSG_DIREKTUR_STEP_SKIPPED` (PT without the Direktur rule, only Direktur is requester/creator). The APK does not offer a
   Direktur employee as requester to anyone else (`masters` employees `direktur`), and shows "Pengajuan Anda langsung ke
   antrian transfer Finance" to a Direktur (`/me` `companies[].ownRequestNoApproval`).
5. **LPJ shortfall** (ADR 0019): rule re-selected for the new total; zero-step → shortfall approval **approved at once**,
   no decision row, audit `approval_policy_exception` on the settlement, label "Kekurangan tanpa persetujuan — pengajuan
   Direktur (kebijakan PT)".
6. **Addendum RAB unchanged** (Direktur → Finance); zero steps and requester roles are refused on addendum rules.
7. **Seed per PT** (data migration `20261013_300000_d1010_approval_config_data`): rule **"Pengajuan Direktur"**
   (Peran pemohon = Direktur, no "Diketahui", no level, priority 10) **only** in a PT whose active expense-request rules
   are all a seeded default shape (ADR 0021 PM project → Direktur, or ADR 0013 Direktur → Finance, unconditioned) and
   that has no active zero-step / "Pengajuan Direktur" rule; other PTs are listed as `customisedKept` in the migrate log.
   Fresh installs: `seed/data.ts` `DEFAULT_APPROVAL_RULES` (also copied to new PTs and by the importer).

## Legacy / in-flight requests

- Requests already submitted with `direktur_via_pm` / `direktur_via_pm_self` keep their snapshot, decision guards, DB
  exception, notifications and wording ("Pengajuan Direktur — diajukan oleh PM (kebijakan owner 2026-10-10)").
  Re-approval / LPJ shortfall of such a request keep that flow (`selectAndSnapshot({ legacy })`; zero-step rules are not
  considered for them).
- New submissions never get the ADR 0021 values.

## Consequences

- Positive: owner flow; rules are data (Admin can add e.g. "Staff → Direktur only" with priority); the no-approval path
  is narrow, server-set, DB-enforced at two points and visible everywhere.
- Negative: a Direktur's own spending is checked by Finance only (owner decision, recorded as a G1-2 exception). Finance
  must treat the badge as "you are the only control".
- The `/me` and masters hints are UI only (masters delta sync does not see a role change until the employee row
  changes; the server refuses anyway).
- **ADR 0022 (inter-project loans)** reuses the ADR 0021 G1 rules for loan approval (PM submits → Direktur approves). It
  must **not** reuse `direktur_via_pm` and needs no change for this ADR unless the owner wants a Direktur-filed loan to
  skip approval too — open question for the loans track (a loan has no `requesterRoles` rule today).

## Rollout

1. Merge → staging deploy; migrations `20261013_300000_d1010_approval_config` (schema), `…_guard`, `…_data` (additive
   for the previous image: it never writes the new value or a zero-step rule).
2. Admin checks per PT: rule "Pengajuan Direktur" present (else create it: Peran pemohon = Direktur, Diketahui = Tidak
   dipakai, no level, Prioritas 10, reason "Kebijakan owner 2026-10-11").
3. UAT: Direktur own request (web + APK) → transfer queue; Staff/PM flows unchanged; LPJ shortfall; legacy request.

## Rollback

- Data: deactivate the "Pengajuan Direktur" rule (reason required) → Direktur requests follow the default rule again.
- Code: `git revert`; the data migration's down deletes / deactivates its rules; the guard migration's down restores
  the ADR 0021 trigger body and drops the new guards (the CHECK keeps the new value while rows carry it); the schema
  down drops the requester-role table.
