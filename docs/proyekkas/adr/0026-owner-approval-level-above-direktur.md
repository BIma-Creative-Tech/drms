# ADR 0026 — "Owner" approval level above the Direktur (role `pk-principal`)

- **Status:** Accepted (owner decision 2026-10-13, DRMS 13/10 Phase A1). Staging first; no production deploy without
  separate owner approval.
- **Date:** 2026-10-13
- **Branch:** `feat/d1310-a-owner` (from `feat/d1310-w3-dash`). Numbered 0026 because ADR 0025 is taken by the
  Direktur-signature change (PR #59).
- **Amends:** [ADR 0021](0021-approval-pm-direktur.md) (the Direktur is no longer the last approver of expense
  requests) and [ADR 0024](0024-configurable-approval-rules-direktur-no-approval.md) (the zero-step rule is the
  Owner's, not the Direktur's; a Direktur's own request is approved by the Owner).
- **Related:** ADR 0003 / 0016 (roles per PT), ADR 0013 (G1, G1-2), ADR 0019 (LPJ shortfall), ADR 0022 (loans).

## Context

Owner, 2026-10-13: a new role **Owner**, one level above the Direktur.

1. Expense requests: **Staff → PM project → Direktur → Owner → Finance (transfer queue)** ("sebelum ke admin" = before
   Finance; there is no Admin step).
2. The Owner has the **same view and permissions as the Direktur everywhere**; only the approval flow differs. He holds
   a membership with this role in every PT (assigned in Pengguna / Akses PT — never hard-coded).
3. Requests already submitted keep their flow; only requests submitted after go-live get the Owner level.
4. Requests filed **by the Owner** go straight to Finance (like ADR 0024 did for the Direktur). Requests filed **by the
   Direktur** now go through the Owner.
5. Addendum RAB and inter-project loans stay **Direktur-only**. The LPJ shortfall re-approval re-selects the expense
   rule, so it includes the Owner.

## Decision

### 1. Role key `pk-principal`, label "Owner"

`pk-owner` has been the **Direktur** since ADR 0013 (relabelled, also in `/dashboard/owner`, the APK `Role.owner`, the
F2e delegation tier `owner`, …). Reusing "owner" for the new role would make every existing reference ambiguous, so the
new role is **`pk-principal`**, shown as **"Owner"** (`ROLE_LABELS`, APK `Role.principal`, matrix short "Own"). Postgres
enums extended: `enum_company_memberships_roles`, `enum_approval_rules_steps_approver_role`,
`enum_approval_rules_acknowledge_role`, `enum_approval_rules_requester_roles` (migration `…630000_d1310_owner_role`,
own transaction).

### 2. Access = Direktur, approval = exact role (two role sets per membership)

Option (a) "add `pk-principal` next to every `pk-owner`" touches ~130 files and drifts with every new feature.
Option (b) "alias in `loadMemberships`" alone would let the Owner decide the Direktur level. Chosen: **(b) with an
exact-role channel for the approval engine.**

- `ROLE_IMPLIES = { 'pk-principal': ['pk-owner'] }` (`access/roles.ts`). `withCompanyContext` gives every membership
  `roles` = **effective** roles (stored + implied) and `exactRoles` = the **stored** roles. Every access / visibility
  check (`rolesIn`, `hasRole`, `byRole`, `companiesWithRole`, dashboards, modules, panel, `/me` `roles` and
  capabilities, Kas, reports, PDF, …) reads the effective roles → the Owner sees and may do what the Direktur may, per
  PT where he holds the Owner role, without touching those files.
- The **approval engine reads the stored roles only**: `exactRolesIn` / `exactRolesOf` / `hasExactRole` for the caller
  (`actorContext` of expense requests, LPJ shortfall and Addendum RAB: `matchesStep`, `matchesAcknowledger`,
  `lacksDecisionRole`; the loan decision pool `mayDecide` / `loanInbox`); position holders, recipients of a step and
  the distinct-person rule come from the DB (`membersWithRole`, `rolesOfUsersIn`: stored roles). So the Owner never
  decides the Direktur level and the Direktur never the Owner level; a person holding both roles counts once
  (`planPositions` / `distinctAssignable`, DB index `approvals_one_position_per_person`).
- `requesterRolesIn` ("Peran pemohon") uses stored roles: an Owner is not a "Direktur" requester.
- Display labels use the stored roles ("Owner", not "Direktur · Owner"): nav user, PT switcher rows, APK
  `Role.labelsOf`.
- FYI reminders addressed to the Direktur (late progress, overdue loans, budget thresholds) also reach the Owner
  (same view). Decision notifications of a step go to that step's exact role only.

### 3. Approval rules and snapshots

- `DECISION_ROLES` = Direktur, Finance, **Owner** (stored in each new snapshot); Addendum RAB snapshots keep
  `ADDENDUM_DECISION_ROLES` = Direktur, Finance, and an addendum rule may not name the Owner (hook 400).
- The **Owner level is placed Direktur → Owner → Finance**: directly after the last Direktur level; in a rule without a
  Direktur level before the first Finance level (ADR 0013 shape "Diketahui" Direktur → Finance levels: the Owner
  becomes level 1); otherwise at the end. Default rules: "Default — PM project lalu Direktur" =
  PM project ("Diketahui") → L1 Direktur → **L2 Owner**; "Pengajuan Direktur" (Peran pemohon = Direktur, priority 10)
  = **L1 Owner**; new **"Pengajuan Owner"** (Peran pemohon = Owner, priority 5, no level).
- **Zero-step rule = Owner only**: `zeroStepRuleError` / `isNoApprovalRule` / DB trigger `approval_rules_zero_step`
  (`pk_rule_requester_only(rid, 'pk-principal')`). A zero-step Direktur rule is refused from now on.
- The Owner's own request → snapshot `selfApproval = principal_no_approval` (new `expense_requests.g1_exception`
  value, CHECK extended), approved without a decision row, audited (`approval_policy_exception`) — the DB accepts it at
  the submit freeze point only via `pk_no_approval_allowed_for(…, 'pk-principal', 'principal_no_approval')` (every
  requester holds Owner in the PT, creator = one of them). `direktur_no_approval` stays readable for older requests.
- **The Owner level is never skipped silently:** a planned position of role Owner whose only holders are
  requester/creator → 409 `MSG_OWNER_STEP_SKIPPED` (e.g. the Owner files for someone else, or "Pengajuan Owner" is
  missing). Equivalent to the ADR 0021 Direktur guard (which stays). No Owner holder in the PT → 409 "Tidak ada pengguna
  aktif untuk posisi Approval level n (peran Owner)".
- **In-flight requests**: the rule is resolved and snapshotted **at submit** (`selectAndSnapshot`, unchanged); a
  decision reads only the snapshot. Requests submitted before go-live (snapshot without an Owner step, decision roles
  without the Owner) finish with the Direktur as last approver. Re-approval paths that re-select the rule (reimburse
  receipts resubmit with a changed total, LPJ shortfall) take the current rule → Owner included.
- SLA (`approvedAt`) unchanged: it starts at the final approval, now the Owner's.

### 3a. Who grants the Owner role (owner decision 2026-10-14)

Only a **group admin** (`users.groupAdmin`) grants or removes `pk-principal`. Enforced server-side in the
`company-memberships` hook `ownerRoleGuard` (403 "Peran Owner hanya dapat diberikan atau dicabut oleh Admin grup."):
a change of "holds Owner" (role ticked / unticked, membership with Owner created, emptied, deactivated or reactivated) by
any other user is refused. Every path writes through that collection with the caller — Payload REST / Local API, the
Akses PT matrix batch (`/api/v1/company-memberships/batch`) and the Pengguna form (`/api/v1/user-onboarding`). A PT
admin may still change the other roles of a membership that holds Owner. UI: the matrix and the Pengguna form offer the
Owner option to group admins only (`roleOptionsFor`); where a PT admin finds it already held it is shown but locked
(`lockOwner`). System writes (seed, migrations, no user) are not affected.

The distinct-person rule is unchanged: a person who gave the "Persetujuan PM" (or any position) of a request never
decides another position of the same request — e.g. an account holding PM and Direktur approves as PM, then the Direktur
level goes to another Direktur.

### 4. Labels (web + APK)

"Persetujuan Owner" (step), "Menunggu persetujuan Owner" (status of the Owner level, derived from the snapshot's
current level), `decisionBy: owner`, KPI `teamWaiting.owner`, transfer-queue `noApprovalBy`, "Tanpa persetujuan —
pengajuan Owner (kebijakan PT)", PDF Approval box lists every level with its role. `STATUS_LABELS.pending_approval`
stays "Menunggu persetujuan Direktur" (level 1 of the default rule; rows without a snapshot).

### 5. Data migration (`…630200_d1310_owner_role_data`, idempotent)

Inserts one Owner level (placement as in §3, following levels renumbered) into every **active** expense-request rule
and every ADR 0024 zero-step Direktur rule (inactive rules and rule names unchanged), skipping rules that already name
the Owner and the Owner's own rules; creates "Pengajuan Owner" in every PT without an active one. Audited
(`source: system`, old levels in `old_value`). Request rows are not touched. Down removes the levels it added (never
leaving a rule without a level), renumbers the following levels back and deletes / deactivates the rules it created.

## Consequences

- **Deploy step:** after the migration, tick **Owner** for the Owner in **every PT** (Pengguna → Akses & Peran or the
  Akses PT matrix). Until then a submission under a rule with an Owner level answers 409 (fail closed — the Owner level
  is never skipped).
- One person may hold both Direktur and Owner in a PT, but cannot decide both levels of one request; with no other
  holder the submission is refused (409, distinct persons).
- Older APKs: `/me` `roles` carries `pk-owner` for the Owner, so they show the Direktur home and inbox; the server
  labels (`statusLabel`, `stepLabel`) name the Owner.
- New code that needs "acts as Direktur" uses the normal role helpers; code that decides an approval position must use
  the exact-role helpers.

## Amendment 2026-10-14 (ADR 0029)

**§3:** for a PT with "Cek dana saat persetujuan" switched on (`companies.fundCheckEnabled`), the decision that makes an
expense request "Disetujui" (normally the Owner's; under a rule without an Owner level its last level) and the submit
of the Owner's own request (no approval) are refused (409 `FUND_INSUFFICIENT`) when the paying PT's available funds —
balance of its active accounts without a site minus its commitments — are short. Who decides is unchanged (G1 rules
stand). The Owner may instruct a "Pinjaman antar-PT" and then approves again.
