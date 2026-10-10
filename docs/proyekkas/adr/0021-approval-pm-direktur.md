# ADR 0021 — Approval flow: PM project, then Direktur; Finance transfers only

- **Status:** accepted (owner decisions 2026-10-10, plan "Approval pengajuan biaya: Staff → PM project → Direktur →
  Finance transfer"). Staging first; no production deploy without separate owner approval.
- **Date:** 2026-10-10
- **Author:** nextjs developer (branch `feat/approval-pm-direktur`, based on `main` `245972f`)
- **Supersedes in part:** ADR 0013, its **decision part** for expense requests (decision 2 "Direktur → Finance",
  decision 4 "PM has no decision rights", decision 10 notification recipients). ADR 0013 still applies to the Addendum
  RAB (budget addendum, Direktur → Finance), to the G1-2 skip rule, to re-approval via `pending_ack`, and to every
  request submitted under an ADR 0013 snapshot.
- **Related:** ADR 0006 (audit, append-only), ADR 0008 (PDF), ADR 0016 (multi-PT: holders and roles per PT), ADR 0019
  (LPJ shortfall re-approval); requirements v1.1 §4, US-17, US-34, US-42; requirements v1.3 §9 (this change).

## Context

### Owner request (2026-10-10)

> Staff submits → the **PM** of the project approves → the **Direktur** approves → **Finance** does not approve any
> more and only transfers. Every decision step has **Tolak** with a reason, and the requester is notified.

### Current state (prod `pk_drms` and staging `pk_drms_stg`, read-only, identical in DRMS/LAS/TBK/CS1)

| Rule | Content |
|---|---|
| "Default — Direktur lalu Finance (semua nominal)" | Diketahui = Direktur (`role pk-owner`, required), Level 1 = Finance |
| "> Rp 10 juta" (inactive example) | same shape |
| Addendum RAB rule | Direktur → Finance |

ADR 0013 is enforced in code, so the requested flow **cannot be configured by data alone**:

| Guard | Where |
|---|---|
| Only `pk-owner`/`pk-finance` decide | `domain/expense/decision.ts` `DECISION_ROLES`, `lacksDecisionRole` |
| "PM project" (`acknowledgeBy: scope_manager`) refused when a rule is saved / used | `decision.ts` `ruleDecisionError`, `collections/ApprovalRules.ts` |
| PM refused with 403 "PM hanya memantau" | `domain/expense/common.ts` `requireActionAudited` |
| PM/cost-center manager resolution deleted | commit `a8a4c30` (`domain/expense/snapshot.ts`) |

The requested flow is exactly the **pre-E1 default rule**: `acknowledge: required · acknowledgeBy: scope_manager ·
steps [L1 pk-owner]` (`down()` of migration `20260926_022918_e1_approval_direktur_finance`). The state machine, the
transfer gate (Uang Muka `approved` → transfer queue; Reimburse → Finance receipt verification, which is a check of the
receipts, not an approval) and most notification routing already support it.

## Decision

1. **Target flow for expense requests (both types, all amounts):**
   `Draft → Menunggu persetujuan PM (pending_ack) → Menunggu persetujuan Direktur (pending_approval, level 1) →
   Disetujui → Finance transfer` (Reimburse: Finance verifies receipts, then transfers).
   Configured per PT by the Admin (data, not migration): rule "Default — PM project lalu Direktur (semua nominal)" =
   `acknowledge: required`, `acknowledgeBy: scope_manager`, `steps: [{ level: 1, approverRole: pk-owner }]`.
   The seed (`seed/data.ts`) gets this default for fresh installs.

2. **"PM project" is resolved at submit** (`snapshot.ts` `snapshotForRule`, expense requests only):
   - `projects.pm` of the request's project; for a cost-center request `cost-centers.manager`;
   - the user must be an **active member of the request's PT** (ADR 0016 §5);
   - missing → **409** "Project ini belum punya PM. Hubungi Admin untuk mengisi PM project." (cost center: "Pusat
     biaya ini belum punya manajer (penanggung jawab). Hubungi Admin untuk mengisi manajer pusat biaya."). No
     delegation (the F2e delegation stays for legacy snapshots only).
   - The snapshot stores `acknowledgeBy: scope_manager`, `acknowledgerUserId = PM`; `matchesAcknowledger` accepts
     only that user. A later change of `projects.pm` does not move requests already submitted.

3. **The PM decides only as the PM of that request.** `actorContext.lacksDecisionRole` = ADR 0013 check **and not**
   the snapshot acknowledger. A PM of another project, or a team PM who is not `projects.pm`, gets **403** +
   `access_denied` audit, like before. After the PM step the Direktur level follows the normal G2 role match.
   `ruleDecisionError(rule, rolesOf, docType)` allows `scope_manager` only for `docType = expense_request` with
   `acknowledge = required`; approval levels stay Direktur/Finance. Admin UI option: "PM project (manajer pusat biaya
   bila tanpa project)".

4. **G1 (requester/creator never decides) is unchanged**, including the G1-2 skip rule:
   - the PM files for himself (PM = requester) or creates the request for a Staff (PM = creator) → the PM position is
     skipped (`approval_skipped` audit, PDF "(tidak berlaku — pemohon)") and the Direktur decides;
   - under a `scope_manager` rule the **Direktur step is never skipped silently**: when it would be skipped (the only
     Direktur is requester/creator) submit answers **409** "Pengajuan untuk Direktur dibuat oleh PM project. …".

5. **Narrow G1 exception `direktur_via_pm`** (owner decision 2026-10-10: a Direktur's own request is filed by the PM on
   the Direktur's behalf, the PM approves as PM project, then the Direktur approves). Set by the server at submit only
   when **all** hold:
   - the rule is `scope_manager`;
   - the creator is the resolved PM of the request (project PM, or cost-center manager) and is not a requester;
   - every requester has an account and every requester account holds **Direktur (`pk-owner`) in the request's PT**.

   Effect: in the position plan the creator (PM) is not excluded from the PM position and the requester Direktur is
   not excluded from the Direktur level (another Direktur of the PT may also decide). Recorded in four places:
   - snapshot `selfApproval: 'direktur_via_pm'`;
   - column `expense_requests.g1_exception = 'direktur_via_pm'` (system-only, read-only, written at submit);
   - audit action `approval_policy_exception`;
   - PDF and web panel note "Pengajuan Direktur — diajukan oleh PM (kebijakan owner 2026-10-10)".

   **DB enforcement** (migration `20261010_130000_approval_pm_direktur`):
   - `pk_approvals_before_insert` (expense requests and `expense_shortfall` through `settlements.request_id`) still
     refuses requester/creator, except when `g1_exception = 'direktur_via_pm'` and either
     `position = 'diketahui' AND actor = creator AND actor is not a requester`, or
     `position = 'approval' AND actor ∈ requesters AND actor <> creator`. The addendum branch is unchanged.
   - Trigger `expense_requests_g1_exception` (BEFORE INSERT OR UPDATE): new rows carry no exception; the value may only
     change at the submit freeze point (editable status → locked status, i.e. `draft`/`receipt_revision` → a waiting
     status); CHECK `g1_exception IS NULL OR g1_exception = 'direktur_via_pm'`. The existing content lock
     (`pk_expense_requests_guard`) also freezes it while the request is locked.
   - Unique index "one decision position per person per cycle" is unchanged: the PM and the Direktur are always two
     people.

6. **LPJ shortfall re-approval (ADR 0019) follows the same rule:** PM → Direktur, decided in web **Persetujuan**
   (`shortfall-approval.ts`: decision guard by `lacksDecisionRole`/acknowledger instead of the hard-coded
   Direktur/Finance role check; the shortfall inbox includes the requests where the caller is the PM acknowledger).
   The exception applies only when the request itself carries `g1_exception = 'direktur_via_pm'`.

7. **Addendum RAB is unchanged** (Direktur → Finance). `scope_manager` is refused for `budget_addendum` rules.

8. **Labels per snapshot** (web + API + APK): `pending_ack` "Menunggu persetujuan PM" when `scope_manager`, otherwise
   as before ("Menunggu Diketahui (Direktur)" for ADR 0013 snapshots; generic label "Menunggu Diketahui");
   `pending_approval` at a Direktur level "Menunggu persetujuan Direktur". Inbox step labels "Persetujuan PM" /
   "Persetujuan Direktur". The PM gets **Persetujuan** (web nav, `/me` `capabilities.approvalInbox`) and the dashboard
   card "Menunggu tindakan saya". KPI `teamWaiting.waitingFor` = `pm | direktur | finance`.

9. **Notifications:** `expense.pending_ack` to the PM ("Persetujuan PM: {docNo}" / "… menunggu persetujuan Anda
   sebagai PM project"; approval email likewise); the Direktur is notified only after the PM approves
   (`pending_approval`), Finance after the Direktur (`transfer_queue` / `receipts_to_verify`); `expense.rejected` to
   requesters/creator and the team PM. `expense.team_submitted` is not sent to the PM who is the acknowledger (he
   already gets the decision request).

10. **APK 0.4.1:** labels only (decision buttons are server-driven): PM step "Setujui sebagai PM project" → "diteruskan
    ke Direktur"; Direktur final step → "diteruskan ke Finance untuk transfer"; `Capabilities.fromRoles` gives pk-pm
    the inbox. An older APK already shows the buttons to the PM (server `allowedActions`), with Direktur wording.

## Snapshots and in-flight requests

- A submitted request keeps its snapshot (US-34). Requests submitted under the ADR 0013 rule finish **Direktur →
  Finance** with the ADR 0013 guards; only submissions after the Admin changes the rules use the new flow.
- Re-approval after a Reimburse receipt revision takes a new snapshot of the current rule (new flow once the rules are
  changed).

## Consequences

- Positive: the owner's flow with small code changes; DB keeps refusing self-approval except the one recorded case;
  Finance workload drops (no approval).
- Negative: every project needs a PM (`projects.pm`) and every cost center a manager, otherwise submission is blocked
  (409). With one Direktur, his absence still stalls all requests.
- The G1 exception weakens segregation of duties for Direktur requests: the requester Direktur approves his own
  request after the PM. Accepted by the owner; it is narrow (exact conditions above), server-set, DB-enforced and
  visible in audit, panel and PDF.
- Finance approve-vs-transfer separation (ADR 0013 O-2) no longer applies to new requests (Finance no longer approves).

## Rollout

1. Branch `feat/approval-pm-direktur` → PR → merge.
2. Staging deploy (owner approval through the infra lead). Migration `20261010_130000_approval_pm_direktur` is
   additive: new nullable column + CHECK, audit enum value, guard trigger, trigger function replaced.
3. Admin changes the rules on staging, per PT (Keuangan → Aturan approval, reason "Kebijakan owner 2026-10-10: Staff →
   PM → Direktur → Finance transfer"): the default rule → "Default — PM project lalu Direktur (semua nominal)",
   Diketahui Oleh = Wajib, Pengisi = PM project, Level 1 = Direktur (Finance level removed); the inactive example rule
   the same; Addendum RAB rule unchanged. Before that: every active project has a PM, every cost center a manager.
4. UAT (`docs/proyekkas/uat/approval-pm/README.md`): Staff, PM, Direktur, Finance; web + APK 0.4.1.
5. Production only after the owner approves the UAT result; the Admin changes the prod rules after the deploy.

## Rollback

- Data: set the rules back to Direktur → Finance (Admin, reason required, audited). Requests submitted meanwhile keep
  their PM → Direktur snapshot and need the code to finish.
- Code: `git revert`; migration `down()` restores the previous `pk_approvals_before_insert` body and drops the guard
  trigger, the CHECK and the column (the audit enum value stays, enum values cannot be dropped).
