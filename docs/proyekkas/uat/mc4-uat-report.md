# ProyekKas MC4 — staging UAT multi-company (ADR 0016, US-MC-01…19)

- **Date:** 2026-09-30 · **Target:** `https://drms-kas.staging.bimacreative.tech` (realm `drms-staging`)
- **Build under test:** `ghcr.io/bctech-adm/proyekkas-web:0.4.2-stg-197226b` (web `drms-pk-stg` + worker), MC1–MC3
  migrated (companies = 1 DRMS, memberships = 40).
- **Approval:** owner, 2026-09-30. **Backup before UAT (infra-lead):**
  `/opt/infra/backups/proyekkas/pk_drms_stg-20260930-204234-pre-mc4-uat.dump`.
- **Data rule:** staging holds REAL client data (never reset). The UAT only ADDS fictional data
  (`*.uji@proyekkas.test`, PT "CS1"); no existing record is modified or deleted; no raw SQL writes.
- **Status (final, 2026-10-04):** **PASS** — automated suite `docs/proyekkas/uat/mc4/` on staging `0.5.1-stg-5fe21fa`:
  API **68/68 PASS** (incl. optional SCP-06), browser **19/19 PASS**. See §0. The 2026-09-30 attempt below (§1–§3) was
  blocked by B-1 / MC4-01; both were resolved on 2026-10-02.

## 0. Final staging run (2026-10-02 → 2026-10-04)

| Step | Build | Result |
|---|---|---|
| Prerequisites | — | MC4-01 fixed by infra-lead (owner-approved) in `drms-staging` + `drms` (`pk-user` in the scope mappings of `proyekkas-web` / `proyekkas-mobile`; infra `fe01694`); B-1: `admin.uji` created as group admin via the staging seed bootstrap (owner-approved), its seed-added DRMS Admin membership deactivated at once (owner condition) |
| Fixture (`fixture.mjs apply`) | `3dd8a96` | PT CS1 id 2 with copied defaults (7 sequences from 1, 3 approval rules), users 112–116, employees 115–117, memberships 42–49 |
| API run 1 | `3dd8a96` | 66 PASS · **1 FAIL (AUD-02 → MC4-04)** · 1 SKIP |
| Browser run 1 | `3dd8a96` | 15 PASS · **4 FAIL (UI-CO: copy-defaults fields disabled)** |
| Fixes | `5fe21fa` | MC4-04 audit backfill (`20261003_090000_mc4_audit_company_backfill`, staging: 3.05 s, 8 422 `expense_request` rows + 24 other doc types tagged); UI-CO `admin.readOnly: false` on the virtual fields (PR #18) |
| API run 2 (+ `UAT_DEACTIVATE_PT=1`) | `5fe21fa` | **68 PASS · 0 FAIL · 0 SKIP** |
| Browser run 2 | `5fe21fa` | **19 PASS** (the first re-run failed UI-CO only on the check's 400 ms wait; Payload re-evaluates `admin.condition` through a debounced form-state request → the check now polls ≤ 5 s) |
| Cleanup (`cleanup --commit`) | `5fe21fa` | project archived; CS1 masters, employees, bank accounts, 7 memberships (incl. rina/andi DRMS), users 112–116 and PT CS1 deactivated (Keycloak accounts disabled by users-sync). Nothing deleted |

**Left for the owner:** `admin.uji@proyekkas.test` (user 111) is still a **group admin** with no membership. It cannot
deactivate itself (the `active` / `groupAdmin` fields need an Admin role in an ACTIVE PT, and CS1 is inactive), and
re-granting DRMS Admin would break the owner's condition. Owner, with the own admin account on staging: Pengguna →
`admin.uji@proyekkas.test` → untick **Admin grup (semua PT)** → untick **Aktif** → Simpan.

**Observation (no defect):** after the backfill some per-PT audit rows stay without PT because their source document
no longer exists (staging: `media_selfies` 3 267, `attendance` 297, `media_receipts` 11, `expense_request` 6). Such
rows are readable by group admins only — no leak; to be checked against selfie retention / E9 load-test data.

## 1. Method (planned, unchanged)

1. Fixture only through the running app (admin UI, Payload REST, `/api/v1`) as a properly authorised fictional
   user; Keycloak accounts via the `drms-staging` service account `proyekkas-admin-api` over the internal network
   `drms-kc-admin-stg` (Traefik router `drms-kc-admin-stg`), from a throwaway container `pk-mc4uat-*`.
2. API tests first (password grant on `proyekkas-mobile`, ADR 0012), then Playwright (throwaway container,
   ≤ 2 GiB), then a light security pass (IDOR, `X-Company-Ids`, cookie `__Host-pk-company-ids`).
3. No ZAP / load test against staging in this task (see §6).

Helper: [`mc4/kc-fixture-users.mjs`](mc4/kc-fixture-users.mjs) (list users; create/ensure a fictional account with
a password set `temporary=false`, no required actions, realm role `pk-user`; never calls `execute-actions-email`).
Passwords live only in the agent scratchpad (`mc4-uat/pw/`, mode 600), never in git.

## 2. Blockers

### B-1 — no fictional group admin (needed to create PT CS1)

| Fact | Evidence |
|---|---|
| Creating a company is group-admin only | `apps/web/src/collections/Companies.ts` access `create: isGroupAdmin(req)`; field `active` group-admin only |
| `groupAdmin` can only be granted by a group admin | `collections/Users.ts` field `groupAdmin` access create/update = `isGroupAdmin(req)` |
| Group admins on staging = accounts that were **Admin** at the MC1 migration | `migrations/20260927_230033_mc1_companies.ts` (`UPDATE users SET group_admin = true WHERE … 'pk-admin'`) |
| The 4 existing fictional accounts are not Admin | Keycloak (SA, read-only): `staff.uji` pk-staff, `pm.uji` pk-pm, `finance.uji` pk-finance, `owner.uji` pk-owner (+ `pk-user`); no `admin.uji` existed. F2 report §3: "the only Admin account on staging is the user's own". |
| Creating app accounts also needs Admin in some PT | `Users.ts` `create: rolesAllowedAny('pk-admin')`; memberships need Admin of that PT or group admin (`CompanyMemberships.ts`) |
| The UAT seed cannot help | `seed/uat-seed.ts` accepts only pk-staff/pm/finance/owner and seeds company #1 only; it also runs as a compose job (infra), not through the app |

Per the task rules (no SQL, not the owner's personal admin account) the fixture stops here.

**Needed (owner, 2–3 minutes, own admin account on staging `/admin`):**

1. **Pengguna & Akses → Pengguna → Buat baru:** Email `admin.uji@proyekkas.test`, Nama `Admin Uji`, tick
   **Admin grup (semua PT)**, Aktif → Simpan. The Keycloak account already exists (created by this UAT), so the
   app links it by email and **no e-mail is sent** (`users-sync` only calls `execute-actions-email` for a NEW
   Keycloak user — do not create any other `*.test` account from the admin UI before its Keycloak user exists).
2. Decide B-2 below (login marker).

After that the UAT continues as `admin.uji` (group admin): create CS1 → grant itself Admin in CS1 (needed for
`users` create) → create the app accounts of §3 → memberships → CS1 masters. Recommendation: after the UAT, untick
"Admin grup" / deactivate `admin.uji` (a group admin reads every membership and the app-wide settings).

### B-2 — DEFECT MC4-01 (High): accounts that hold only `pk-user` cannot log in

| | |
|---|---|
| Component | Keycloak realm `drms-staging` (and very likely `drms`) client scope mappings × app login gate |
| Steps | 1. Create a Keycloak user with only realm role `pk-user` (as `users-sync` does for every new account since the role exists). 2. Password grant on `proyekkas-mobile` (`admin.uji@proyekkas.test`). 3. Decode the access token. |
| Actual | Token has **no `realm_access` claim** (`azp=proyekkas-mobile`, `typ=Bearer`, `realm_access=None`). `tokenAllowsLogin()` (`auth/strategies.ts:128`) needs `pk-user` or a legacy `pk-*` role in `realm_access.roles` → APK bearer rejected (`/api/v1/*` 401) and web callback 403 "Akun belum diberi akses ProyekKas." |
| Cause | `proyekkas-mobile` and `proyekkas-web` have `fullScopeAllowed=false`; their realm scope mappings list only `pk-admin, pk-pm, pk-owner, pk-staff, pk-finance` — **`pk-user` was never added** (`/opt/infra/identity/keycloak/realm-export/drms-staging.json` `scopeMappings`; live token confirms). Existing accounts still log in only because they keep a legacy `pk-*` role. |
| Impact | Every account onboarded after MC1 through the admin UI (gets `pk-user` only) cannot log in (web + APK); ADR 0016 backfill step 5 ("later remove the five `pk-*` mappings") would lock everyone out; prod (`drms`, v0.5.0) has the same pattern unless its mapping differs (not checked — prod is out of scope). |
| Expected | A `pk-user`-only account logs in (ADR 0016 §2). |
| Fix | Infra (realm config, owner approval): add realm role `pk-user` to the scope mappings of clients `proyekkas-mobile` and `proyekkas-web` in `drms-staging` and `drms`, update the realm exports. Regression: repeat step 2, token carries `realm_access.roles ∋ pk-user`. |
| Agent | infra-lead (Keycloak), then qa-security retest |

UAT workaround (only if the owner prefers not to wait for the realm fix): map the legacy realm role `pk-staff` to
the 6 new fictional accounts as the MC1-transition login marker (the app never uses it as a permission —
`tokenAllowsLogin`; per-PT roles come from memberships). Not done without approval, because it would also hide
MC4-01 from the UAT.

## 3. Fixture created on staging (so far)

Keycloak realm `drms-staging` only (via SA `proyekkas-admin-api`; password set `temporary=false`, no required
actions, realm role `pk-user`; no e-mail sent; realm/clients/flows untouched). **No app (DB) records yet.**

| Account | Keycloak id | Planned app role (per PT) |
|---|---|---|
| `admin.uji@proyekkas.test` | `d7313dfc-3026-44d9-8a95-f684a1bd4065` | group admin (+ Admin CS1) — needs owner step B-1 |
| `staff-cs1.uji@proyekkas.test` | `4899dd32-3452-49ba-b886-2ed8a0c05785` | Staff CS1 only |
| `pm-cs1.uji@proyekkas.test` | `40cdc0c3-aa08-487a-8d13-67768ed665e9` | PM CS1 |
| `dir-cs1.uji@proyekkas.test` | `b1ecd943-4351-4efc-922c-ac5a5c9d3605` | Direktur CS1 (ADR 0013 "Diketahui" in CS1) |
| `rina.uji@proyekkas.test` | `f2cd9797-3870-444d-8b43-065afa5932da` | Direktur DRMS + Finance CS1 (traceability "Rina") |
| `andi.uji@proyekkas.test` | `8eed7312-2724-4cfd-a665-f0466b8ed74c` | Finance DRMS + Finance CS1 |

Existing `{staff,pm,finance,owner}.uji@proyekkas.test` were only listed (not changed).
Cleanup if the UAT is abandoned: delete these 6 Keycloak users (SA, `DELETE /admin/realms/drms-staging/users/<id>`);
otherwise keep them for the client UAT.

Planned app fixture (after B-1/B-2): PT **CS1 "PT Contoh Sejahtera Uji"** (shortCode `CS1`, TZ Asia/Makassar);
7 document sequences, approval rule Direktur → Finance and a default work schedule entered by hand in the admin UI
(the "copy defaults from DRMS" action is not built yet — ADR 0016 MC2 notes; the import CLI would seed them but runs
as an infra job); employees `CS1-UJI-*`, project `PRJ-CS1-UJI-01`, cost centre `CC-CS1-UJI`, cash account
"Kas Uji CS1", memberships as in the table (Rina/Andi also get DRMS memberships + DRMS employee rows).

## 4. Results per US-MC

| US | Result | Note |
|---|---|---|
| US-MC-01 … US-MC-19 + scope rule | **PASS** (2026-10-04) | API 68/68 and browser 19/19 on `5fe21fa` — per-case table in the run output (`api-results.md`, `ui-results.md`, kept outside git) and §0. |
| (login of a new account, ADR 0016 §2 / US-MC-02 "akun baru mendapat `pk-user`") | **PASS** (2026-10-02) | MC4-01 fixed; tokens carry `pk-user`. |

## 5. Defects

| ID | Severity | Summary | Status |
|---|---|---|---|
| MC4-01 | High | `pk-user` missing from the `proyekkas-mobile` / `proyekkas-web` scope mappings → `pk-user`-only accounts cannot log in | **fixed** 2026-10-02 (infra-lead, both realms, infra `fe01694`) |
| MC4-04 | High | AUD-02 (staging run 2026-10-02): historic audit rows of DRMS documents carry no PT (8 428 of 8 524 `expense_request` rows), so Rina (Direktur DRMS + Finance CS1) reads none of them once CS1 exists | fixed on `fix/mc4-audit-backfill` (migration `20261003_090000_mc4_audit_company_backfill`, `../qa/mc4-qa-report.md` §11.2); AUD-02 **PASS** on `5fe21fa` (2026-10-04) |

The staging AUD-02 failure (MC4-04) is fixed by branch `fix/mc4-audit-backfill`: its migration tags the historic
audit rows with their document's PT.

## 6. Remaining MC4 items

- ~~This UAT~~ — done 2026-10-04 (§0). Owner: deactivate `admin.uji` (§0).
- ZAP baseline rerun against staging (not run in this task).
- 3-PT load test (NFR "konsolidasi 3 PT p95 < 2 s"; media-access performance, ADR 0016 MC2 note 4) — not run here.
- APK phone test (MC3 APK, PT switcher, per-PT outbox) on a real device.
- ~~Prod check of MC4-01~~ — scope mapping fixed in `drms` 2026-10-02 (verified via Admin REST by infra-lead).
