# ADR 0013 — Approval flow: "Diketahui" by the Direktur (an approval), then Finance; PM monitors only

- **Status:** accepted (GATE 1 fase1-golive, user 2026-09-26)
- **Date:** 2026-09-25
- **Author:** Analyst (Fase 1 go-live plan, branch `docs/plan-fase1-golive`)
- **Supersedes (when accepted):** the Q-07 default (PM / cost-center manager fills "Diketahui") and, for new
  rules, the F2e acknowledger delegation (architecture §5.2, `domain/expense/rules.ts` `resolveAckDelegation`).
- **Related:** requirements v1.1 §4, §7 T1/T2, US-17, US-26, US-30, US-34, US-42, US-43; ADR 0006 (audit), ADR 0008
  (PDF); open questions Q-06, Q-07, Q-08, Q-31, Q-38.

## Context

### User decision (2026-09-25, binding)

> The "Diketahui" step must be filled by **Direktur level and it is an approval**; **Finance also approves**;
> **PM only monitors** (no approval rights, read access to their projects).

### Current implementation (read on `develop` @ `8712964`)

| Area | Fact | Evidence |
|---|---|---|
| Roles | 5 Keycloak realm roles: `pk-staff`, `pk-pm`, `pk-finance`, `pk-owner`, `pk-admin`. **No "Direktur" role.** `pk-owner` appears 134 times in 67 files of `apps/web/src`. | `apps/web/src/access/roles.ts:4`; `grep -rn pk-owner apps/web/src \| wc -l` |
| State machine | `submit → pending_ack \| pending_approval`; `acknowledge: pending_ack → pending_approval`; `approve: pending_approval → pending_approval (more levels) \| approved`; `reject` from both. | `apps/web/src/domain/expense/state.ts:45-51` |
| Guards | acknowledge = caller is the resolved acknowledger; approve = caller matches the current level; neither if requester/creator (G1) or already decided in this cycle. | `state.ts` `allowedActions`; `domain/expense/common.ts:154-164` |
| Rule engine | `approval-rules`: amount band, type, category/project/cost center, `acknowledge` required/optional/none, `acknowledgeBy` `scope_manager`/`role`/`user`, `steps[]` level 1..n with role or user. Rule is **snapshotted** on the request at submit. | `collections/ApprovalRules.ts`, `domain/expense/rules.ts`, `domain/expense/snapshot.ts` |
| Default rule (seed) | "Default — Owner (semua nominal)": `acknowledge: required`, `acknowledgeBy: scope_manager` (= PM of the project / manager of the cost center), `steps: [{level 1, pk-owner}]`. A second, **inactive** example: > Rp 10 juta, 2 × `pk-owner`. | `apps/web/src/seed/data.ts:96-128` |
| F2e delegation | When the PM / manager is a requester/creator or missing, "Diketahui" is delegated to an eligible Owner, else Admin (`acknowledge_delegated` audit, "(dilimpahkan)" on the PDF). Only for `scope_manager`/`user` modes, not for `role`. | `rules.ts` `resolveAckDelegation`; `snapshot.ts` |
| DB guards | Trigger `pk_approvals_before_insert`: requester/creator can never insert a `diketahui`/`approval` row (G1). Unique indexes: one decision per (request, cycle, position, level); **one decision position per person per cycle**. `approvals` is append-only. | `migrations/20260923_133050_f2a_security.ts:150-172` |
| Re-approval | Reimburse receipt revision that changes the grand total → new snapshot, new cycle, status **`pending_approval` level 1 directly** (the "Diketahui" step is not repeated). | `domain/expense/receipts.ts` ≈ L261-269 |
| Notifications | `pending_ack` → acknowledger user, or all holders of `acknowledgeRole`; `pending_approval` → step user or all holders of the step role. Text: "menunggu tanda \"Diketahui\" dari Anda". | `domain/notifications.ts:37,106-130` |
| Web inbox | admin view `/persetujuan` (`admin/config.ts:15`) = requests in `pending_ack`/`pending_approval` where the caller has `acknowledge` or `approve`. | `domain/expense/queues.ts:70-77`, `admin/views/ApprovalInbox.tsx` |
| APK inbox | `hasApprovalInbox => owner \|\| pm`; Finance home is read-only; timeline label "Diketahui Oleh (PM / penanggung jawab)". | `apps/mobile/lib/features/auth/domain/user_profile.dart:64-65`, `features/expense/domain/turn_timeline.dart:95` |
| PDF | 4 signature boxes: Diajukan Oleh, Dibuat Oleh, Diketahui Oleh, Approval (last ≤ 2 approval levels' images). | `apps/web/src/pdf/PengajuanBiaya.tsx:8-17`, `pdf/data.ts:69-98` |
| Requirements | §4: PM **K** team, Owner **A** all; US-17: PM may give "Diketahui" only. | `requirements-v1.1.md` §4, US-17 |
| Production data | Prod DB `pk_drms` has **no consumer yet** (DRMS prod not deployed). | infra `docs/plans/06-network-isolation.md` L85 |

Conclusion: the engine already supports "Diketahui by a **role**" followed by approval levels by **role**. The
target flow is mostly **configuration + guards + labels**, not a new state machine.

## Decision (proposed)

1. **Direktur = the existing role `pk-owner`, relabelled "Direktur"** (`ROLE_LABELS`, APK strings, docs). No new
   Keycloak role. *(GATE G1-1; alternative below.)*
2. **Target flow (both request types, all amounts):**
   `Draft → Menunggu Diketahui (Direktur — a decision: Setujui/Tolak) → Menunggu Approval (Finance, level 1) → Disetujui → …`
   (Uang Muka → transfer queue; Reimburse → Finance receipt verification, unchanged).
   Order follows the client form boxes (Diketahui before Approval). Implemented by a **data migration** of the
   default rule: `acknowledge: required`, `acknowledgeBy: role`, `acknowledgeRole: pk-owner`,
   `steps: [{ level: 1, approverRole: pk-finance }]`. The inactive example rule is rewritten to the same shape
   (thresholds stay open, Q-31). The state table in `state.ts` does not change.
3. **"Diketahui" is an approval:** the Direktur sees budget impact and open flags (already recorded on the
   `acknowledge` row), must sign (already required), must give a reason to reject (already G7). UI wording:
   inbox "Persetujuan Direktur (Diketahui)", button **"Setujui"**; audit action stays `acknowledge` (no enum change
   for history compatibility), the audit/Riwayat label reads "Disetujui Direktur (Diketahui)".
   `acknowledge: optional` is **refused** by the rules hook when `acknowledgeRole = pk-owner` (an approval cannot be
   skippable).
4. **PM has no decision rights** (hard rule, not only configuration):
   - `ApprovalRules` hook refuses `pk-pm` and `pk-staff` in `acknowledgeRole` / `steps[].approverRole`, and refuses a
     named user (`acknowledgeUser`/`approverUser`) who does not hold `pk-owner` or `pk-finance`.
   - `acknowledgeBy: scope_manager` is **no longer selectable for new/updated rules** (kept in the enum so old
     snapshots stay readable).
   - Service guard: `acknowledge`/`approve`/`reject` additionally require the caller to hold `pk-owner` or
     `pk-finance` (defence in depth; denied attempts audited as `access_denied`, like F2e).
   - PM read scope is unchanged (team projects / team cost centers, `domain/expense/access.ts`); the APK inbox is
     removed for PM-only users; PM keeps the team list/dashboard (US-17).
5. **Self-involvement (G1) fallback** replaces the F2e delegation for role-based rules. At submit the snapshot
   resolves the eligible, **distinct** people for each position (existing `approversAssignable`):
   - If another eligible holder exists (e.g. a second Direktur / second Finance), they decide as usual.
   - If the **only** holder(s) of a position are requester/creator, that position is **skipped** and recorded
     (`approval_skipped` audit row with reason "pemohon/pembuat adalah satu-satunya <peran>"; PDF box
     "(tidak berlaku — pemohon)"). *(GATE G1-2.)*
   - At least **one independent decision** must remain; otherwise submit stays **409** as today.
   - Today a role-based rule with no eligible acknowledger would leave the request stuck in `pending_ack`
     (no submit-time check for `acknowledgeBy: role`) — this check is **added**.
6. **Re-approval** after a Reimburse receipt revision that changes the total goes back to **`pending_ack`** when
   the new snapshot requires "Diketahui" (fix in `receipts.ts`), so the Direktur approves the new amount again.
7. **Budget addendum (T12)** uses the same engine (`docType: budget_addendum`, already an option in
   `ApprovalRules.docType`). Proposed default: Direktur approves (US-30), Finance is notified (no approval).
   *(Non-blocking; open item O-3.)*
8. **Segregation of duties Finance approve vs transfer:** allowed for the same Finance user (small team),
   recorded in audit; the transfer screen shows "Anda juga yang menyetujui" as a warning. *(Open item O-2.)*
9. **PDF:** keep the client form labels ("Diketahui Oleh", "Approval"): Direktur's name/signature in "Diketahui
   Oleh", Finance's in "Approval". `(dilimpahkan)` remains for legacy snapshots; `(tidak berlaku — pemohon)` for
   skipped positions. *(Label change is open item O-1, non-blocking.)*
10. **Notifications:** `expense.pending_ack` text → "{docNo} menunggu persetujuan Anda sebagai Direktur";
    recipients = active `pk-owner` holders minus requester/creator. `expense.pending_approval` → active
    `pk-finance` holders minus requester/creator. No approval notifications to PM.

## Data migration for in-flight documents

- **Principle (US-34, already implemented):** a submitted request keeps its snapshot; rule changes never apply
  retroactively. In-flight requests (`pending_ack`/`pending_approval`) finish on the **old** flow.
- **Production:** no data yet → nothing to migrate; go-live starts with the new default rule.
- **Staging:** before UAT of the new flow, list in-flight requests
  (`status IN ('pending_ack','pending_approval')`), then either let them finish or cancel them with reason
  "migrasi alur approval ADR 0013" (audited). The UAT seed (`seed/uat.ts`) gets a Direktur (`pk-owner`) and two
  Finance users so the fallback of Decision 5 is testable.
- **Migration file:** one Payload migration that (a) updates the two seeded rules by `name` with an audit row
  (`reason: "ADR 0013 — keputusan user 2026-09-25"`), (b) adds audit action `approval_skipped` to the DB enum
  (`ALTER TYPE "public"."enum_audit_logs_action" ADD VALUE IF NOT EXISTS …`, same pattern as
  `migrations/20260924_020343_f2e_uat_fixes.ts:11`). No table change
  to `approvals` or `expense_requests`; DB guards (G1 trigger, unique indexes) stay as they are.

## Tests to update / add (non-exhaustive, from `grep -rln "pending_ack\|acknowledge" apps/web/tests`)

- Web unit: `tests/unit/expense-flow.test.ts`, `tests/unit/f2e-uat-fixes.test.ts`, rules/snapshot tests.
- Web integration: `flow-world.ts` (fixture roles), `expense-flow`, `form-228` (signature positions), `f2-authz-db`,
  `f2c-requester-web`, `f2d-finance-receipts`, `f2e-uat-fixes` (delegation → legacy only), `lpj`, `files`,
  `f3-kpi-reconciliation` (K-10 pending counts per role), `f3-report-filters`, `uat-seed`.
- APK: `user_profile` (inbox roles), `turn_timeline`, approvals inbox/decision sheet widget tests,
  `test/integration/mock_backend_flow_test.dart`.
- **New:** PM acknowledge/approve/reject → 403 + `access_denied` audit; rules hook refuses `pk-pm`/`scope_manager`/
  `optional` for Direktur; Finance approves after Direktur; Direktur reject needs reason; re-approval goes to
  `pending_ack`; skip fallback (only Direktur is requester → Finance only, audit `approval_skipped`; only Finance
  is requester → Direktur only; both involved → 409); legacy snapshot (PM ack) still completes.

## Alternatives

| Alternative | Why not (now) |
|---|---|
| New role `pk-direktur` next to `pk-owner` | Needs realm role in `drms` + `drms-staging` (infra), role sync, and review of 134 `pk-owner` checks in 67 files (dashboards, masters, re-open period, audit log access). Only worth it if Owner and Direktur are different people with different rights. |
| Finance first, Direktur last | Contradicts the form box order the user referred to ("Diketahui" = Direktur); possible by configuration (rule steps) if the client prefers it. |
| Parallel approvals (any order) | Needs a new state + quorum logic; no requirement for it. |
| Keep PM as optional "Diketahui" | Contradicts the user decision (PM monitors only). |

## Consequences

- Positive: small code change (guards, hook, labels, inbox roles, one re-approval fix, submit-time check); DB
  guards unchanged; history stays valid.
- Negative: every request needs the Direktur — with one Direktur, absences stall all requests (Q-38 delegation
  becomes important); Finance workload increases (approve + verify + transfer).
- F2e delegation code remains for legacy snapshots only; remove after all legacy requests are closed (F7 cleanup).

## Rollback

Re-activate the old rule content via the admin panel (reason required, audited) or revert the data migration;
requests submitted under ADR 0013 keep their snapshot. Code guards (PM refusal) revert with `git revert`.

## Open items (non-blocking)

- **O-1** PDF labels: keep "Diketahui Oleh"/"Approval" or print "Disetujui Direktur"/"Disetujui Finance"?
- **O-2** Enforce different Finance users for approve and transfer when ≥ 2 Finance users exist?
- **O-3** Addendum RAB: Direktur only (proposal) or Direktur → Finance?
- **O-4** Thresholds (Q-31): e.g. above Rp X a second Direktur? (Needs a second `pk-owner` holder — one position per person.)

## Implementation notes (E1, branch `feat/e1-approval-direktur-finance`)

- Code: `apps/web/src/domain/expense/decision.ts` (`DECISION_ROLES`, `ruleDecisionError`, `planPositions`,
  `lacksDecisionRole`), `snapshot.ts` (submit-time plan), `common.ts` (`requireActionAudited` decision-role guard),
  `workflow.ts` (`approval_skipped` audit, auto-approve when the only approval level was skipped), `receipts.ts`
  (re-approval via `pending_ack`), `collections/ApprovalRules.ts` (hook + `filterOptions`). Migration
  `20260926_022918_e1_approval_direktur_finance`.
- Snapshot marker: snapshots taken since E1 carry `decisionRoles: ['pk-owner','pk-finance']` and `skipped: []`;
  the decision-role guard applies only to them, so pre-E1 snapshots (PM "Diketahui", F2e delegation, Owner approval)
  finish with their old guards (AC-8).
- Decision 4 applied strictly: the rule hook refuses **every** role other than `pk-owner`/`pk-finance` in a decision
  position (also `pk-admin`, which the service guard would refuse anyway), and named users must hold one of the two.
- A rule that does not satisfy ADR 0013 (saved before E1, e.g. an admin-created `scope_manager` rule) is refused at
  submit with **409** instead of being re-interpreted; the migration only rewrites the two seeded rules (by name) and
  prints a NOTICE with the count of remaining active `scope_manager` rules.
- Skip rule details: a position with **no active holder at all** is a 409 (configuration), never a skip. A skipped
  "Diketahui" is stored as `acknowledge: 'none'` + `skipped[]`; skipped approval levels are removed from `steps` and
  the rest renumbered. When no approval level remains, the Direktur's "Setujui" moves the request through
  `pending_approval` to `approved` in one transaction (DB rule G3: `approved_amount` only on `pending_approval → approved`).
- Named approver = requester/creator: previously a 409 (G1), now handled by the same skip rule (it is the only holder).
- APK support (E3): `GET /api/v1/me` `capabilities.approvalInbox` (Direktur/Finance) / `teamMonitor` (PM); detail
  `approvalRule.{acknowledgeBy, acknowledgeRole, decisionRoles, skipped}`; inbox items `stepLabel`, `decisionFlow`.
- Not changed (follow-ups): PM dashboard tile "Menunggu \"Diketahui\" saya" (now 0 for new requests; relabel in E3/E12);
  "Owner" in developer-facing OpenAPI summaries and the cash re-open message (`domain/cash/ledger.ts`, left to the E2
  track to avoid conflicts).
