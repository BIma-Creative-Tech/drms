# MC4 UAT suite — runbook (US-MC-01…19 + PT scope rule 2026-10-02)

Automated replacement for the blocked staging UAT of `../mc4-uat-report.md` (blockers B-1, MC4-01). Three parts, each run
in a throwaway container (node is not installed on the host):

| File | What |
|---|---|
| `fixture.mjs` | Fixture through the app's own API as the fictional group admin `admin.uji`: PT **CS1** with "Salin default saat dibuat", the CS1 masters, the app accounts (linked to the existing Keycloak users by e-mail) and the memberships. Modes `plan` (dry run, default) / `apply`, `cleanup` (dry run) / `cleanup --commit`. Prints and saves the created ids. |
| `api-suite.mjs` | 68 API cases (`node:test`, plain `fetch`, no dependency) → `$UAT_OUT/api-results.{md,json}` |
| `ui-checks.mjs` | 19 Playwright checks (switcher, `/admin/akses-pt`, company form, consolidated dashboard / inbox / list at 1440 + 390 px, light + dark) → `$UAT_OUT/ui-results.{md,json}`, screenshots in `$UAT_OUT/screens` |
| `lib.mjs` | Shared HTTP code: password grant on `proyekkas-mobile` + device registration for `/api/v1`, a real web session (Keycloak login form → `/auth/callback`) for Payload REST, target guard, pacing |
| `run.sh` | Runs one step in a throwaway container: `fixture-plan`, `fixture-apply`, `api`, `ui`, `cleanup-plan`, `cleanup`, `all` |
| `local/` | Local throwaway stack used to validate the suite: `up.sh`, `kc-realm.sh`, `emulate-staging.mjs`, `validate.sh`, `down.sh` |
| `kc-fixture-users.mjs` | (earlier attempt) Keycloak helper of the infra service account — not used by this suite |

## Accounts and data

| Account (`*.uji@proyekkas.test`) | Role after `fixture.mjs apply` |
|---|---|
| `admin.uji` | group admin (owner step B-1) + Admin CS1 (needed to create accounts) |
| `staff-cs1.uji` | Staff CS1 (employee `CS1-UJI-STAFF`) |
| `pm-cs1.uji` | PM CS1 (employee `CS1-UJI-PM`, PM of `PRJ-CS1-UJI-01`) |
| `dir-cs1.uji` | Direktur CS1 (also creates / archives the CS1 project: projects are Direktur-only) |
| `rina.uji` | Direktur DRMS + Finance CS1 |
| `andi.uji` | Finance DRMS + Finance CS1 (employee `CS1-UJI-ANDI`) |

CS1 masters: PT `CS1` "PT Contoh Sejahtera Uji" (TZ Asia/Makassar, defaults copied from DRMS), cost centre `CC-CS1-UJI`,
cash account "Kas Uji CS1" (opening balance 25 000 000), category `MAT`, two fictional bank accounts, project
`PRJ-CS1-UJI-01` with team assignments. DRMS: only the two memberships of rina / andi (no DRMS employee or master).

What the run writes (all in PT CS1 except the two DRMS memberships): a few requests with receipts (one goes
Diketahui → Approval → transfer), drafts that are cancelled again, a CS1 period close that is re-opened at once,
device registrations of the six accounts. DRMS data is only **read** (by rina / andi, ids and status codes only;
nothing of it is printed or stored). Probes that must be rejected and would touch DRMS on a defect use harmless values
and undo themselves (`CLS-02` re-opens a wrongly closed 2020-01, `CO-02` deactivates a wrongly created PT).

## Prerequisites (staging)

1. **Staging runs `develop` `bff95ac`** (web + worker; migration `20261002_080000_mc4_scope_rule` applied).
2. **MC4-01 fixed** — realm role `pk-user` in the scope mappings of `proyekkas-mobile` and `proyekkas-web` (realm
   `drms-staging`). `fixture.mjs` checks it first (password grant of the 6 accounts, `realm_access.roles ∋ pk-user`)
   and stops otherwise (`UAT_ALLOW_LEGACY_MARKER=1` only if the owner chose the legacy-role workaround).
3. **B-1 done** — the owner created the app account `admin.uji@proyekkas.test` with **Admin grup (semua PT)**. The
   fixture checks it (`/me` works, PT DRMS readable without a DRMS membership) and stops otherwise.
4. **Passwords** of the 6 accounts: one file per e-mail in `UAT_PW_DIR` (mode 600, outside git) — the files of the
   blocked attempt (`mc4-uat/pw/`). They are only read inside the containers, never printed.
5. **Owner OK for the side effects** (UAT report §3 plan): during the UAT rina is Direktur DRMS and andi Finance DRMS,
   so both see real DRMS data and rina is in the DRMS Direktur pool (DRMS "Diketahui" notifications also go to her
   fictional address); case `SCP-04` copies receipt no. / vendor / amount of ONE active DRMS receipt into a fictional CS1
   draft (cancelled at the end; `UAT_DUP_FROM_DRMS=0` skips it). `cleanup` deactivates both DRMS memberships.
6. A quiet time slot (dashboard reconciliation; login rate limit of 6/min → the suite waits 10 s between logins).

## Run against staging (the Lead)

```bash
cd <worktree of test/mc4-uat-suite>                       # this branch, any checkout
export UAT_TARGET=staging
export UAT_APP_URL=https://drms-kas.staging.bimacreative.tech
export UAT_KC_URL=https://auth.bimacreative.tech UAT_REALM=drms-staging
export UAT_PW_DIR=<scratch>/mc4-uat/pw                     # 6 password files (600)
export UAT_OUT=<scratch>/mc4-uat/out-$(date +%Y%m%d-%H%M)  # results, screenshots, state.json (outside git)

docs/proyekkas/uat/mc4/run.sh fixture-plan     # dry run: checks MC4-01 + B-1, lists what would be created
docs/proyekkas/uat/mc4/run.sh fixture-apply    # creates CS1 + accounts + memberships + masters; prints the ids
docs/proyekkas/uat/mc4/run.sh api              # 68 cases → $UAT_OUT/api-results.md
docs/proyekkas/uat/mc4/run.sh ui               # 19 checks → $UAT_OUT/ui-results.md + screens/
UAT_DEACTIVATE_PT=1 docs/proyekkas/uat/mc4/run.sh api   # optional: + SCP-06 (deactivates CS1 for a few seconds)
```

Containers: `pk-mc4uat-fixture|api|pw` (`--rm`, default bridge network, 384 MiB / 2 GiB for Playwright). Re-runs are
safe: the fixture is idempotent (find-or-create by its own natural keys, never touches another record) and the API
cases tolerate earlier runs. The target guard refuses any host without "staging" in it and plain http.

**Expected duration** (10 s login pacing): fixture ≈ 2 min, API ≈ 4–6 min, UI ≈ 4 min (incl. `npm i playwright`),
cleanup ≈ 1 min — about 15 min in total.

**Reading the results:** every row is PASS / FAIL / SKIP (API) or PASS / WARN / FAIL (UI). A SKIP names the missing
prerequisite (e.g. no DRMS attendance selfie on staging → that path of ISO-02 is not probed; it does not hide a FAIL of
the other paths). Notes contain ids and status codes only.

## Cleanup (after the UAT)

```bash
docs/proyekkas/uat/mc4/run.sh cleanup-plan     # dry run
docs/proyekkas/uat/mc4/run.sh cleanup          # deactivates: project (archived by dir-cs1), cost centre, cash account,
                                               # category, bank accounts, employees, the 7 memberships, the 5 app
                                               # accounts, PT CS1 (reason "UAT MC4 …")
UAT_KEEP_USERS=1 docs/proyekkas/uat/mc4/run.sh cleanup   # same, but keeps the app accounts (client UAT)
```

Deactivating an app account makes the app disable its Keycloak account (users-sync) — that is the app's own rule; a
later `fixture-apply` re-activates them. Nothing is deleted (documents, audit rows and the CS1 numbers stay). Left to the
owner: untick "Admin grup" of `admin.uji` and deactivate it (UAT report B-1 recommendation). Delete `$UAT_OUT` when the
report is written (it holds `state.json` with ids and the screenshots).

## Case catalogue

| Area | Cases | US |
|---|---|---|
| Company + copy defaults | CO-01…03 (7 sequences from 1, rule Direktur → Finance; Direktur cannot create a PT; 1-PT user reads only its PT) | US-MC-01 |
| `/me` | ME-01…03 (`companies[]` = mapped PTs + per-PT roles, capabilities, `X-Company-Ids` narrows) | US-MC-05 |
| Spoofing | SPF-01…07 (foreign / mixed / malformed `X-Company-Ids` → 403 `COMPANY_NOT_ALLOWED`; `?company=`; cookie `__Host-pk-company-ids` with a DRMS id → ignored; switcher endpoint; audited `access_denied`) | US-MC-04/05/14 |
| Isolation sweep | ISO-01…07 (DRMS request detail / history / PDF, media files + signed URLs of 7 kinds, progress / addendum / stages, 12 REST `/api/<slug>/:id`, REST + v1 lists + masters, reports + CSV/PDF exports) for staff / pm / dir | US-MC-14 |
| Body `company`, cross-PT refs | BDY-01…05 (foreign PT → 403; DRMS project / cash account → 400 `COMPANY_MISMATCH`; header does not block a named PT; membership with an employee of another PT rejected) | US-MC-03/07 |
| CS1 flow + numbering | FLW-01…09, NUM-01/02, MUT-01…03 (`1/PB-CS1/…`; Diketahui by Direktur CS1 → Approval by rina; rina's inbox: CS1 only at Approval, DRMS only at Diketahui; role in another PT → 403; DRMS cash account on a CS1 transfer → 400; PDF) | US-MC-06/07/08/12 |
| Queues | INB-01/02 (PT chip on inbox / transfer / LPJ queues, `?company=` narrows, role gate) | US-MC-06 |
| Dashboards | DSH-01…06 (Σ `byCompany` = total; layouts per PT role; CS1 cash = Σ balances; header narrows) | US-MC-10 |
| Reports | REP-01…05 (PT column + "Subtotal per PT", Σ = TOTAL; `pt=` narrows; foreign PT; CSV PT column, PDF) | US-MC-11 |
| Closing | CLS-01…04 (closing CS1 keeps the DRMS lock date; posting in the closed CS1 month refused; foreign / wrong role → 403; re-open) | US-MC-09 |
| Audit | AUD-01…03 (Direktur CS1 reads CS1 rows only; rows of the request carry CS1; DRMS rows invisible; Riwayat) | US-MC-18 |
| Sync | SYN-01…03 (`COMPANY_MISMATCH`, `COMPANY_NOT_ALLOWED`, 409 `COMPANY_REQUIRED`) | US-MC-17 |
| Scope rule | SCP-01…06 (2-PT consolidated; 1-PT never another PT; duplicate receipt: no flag for a 1-PT uploader, flag only for viewers mapped to the other PT, nothing in detail / REST / Riwayat / inbox counts for CS1-only viewers; deactivated-PT media, optional) | owner 2026-10-02 |
| Browser | UI-DSH / UI-INB × {1440, 390} × {light, dark}, UI-PT-01…03, UI-AKS × 4, UI-CO × 4 | US-MC-01/02/04/06/10 |

Not automated (stay manual / elsewhere): US-MC-15 jobs per PT, US-MC-16 import, US-MC-19 migration (covered by
`mc/mc1-progress.md`), the APK on a phone, ZAP and the 3-PT load test (`../../qa/mc4-qa-report.md` §9).

## Staging-only differences (validated locally, see below)

- **Real Keycloak `drms-staging`** behind Traefik + CrowdSec: TLS, `__Host-` cookies, login rate limit, WAF. Locally:
  a throwaway Keycloak 26.7.4 (start-dev) realm with the same three clients, `fullScopeAllowed=false` and the MC4-01
  fix applied; the suite used the same password grant and login-form code path.
- **DRMS data is real**: discovery reads whatever DRMS documents rina / andi see. Kinds that do not exist on staging
  (e.g. attendance selfies while attendance is off, a DRMS logo) are reported in the ISO notes / as SKIP of that path.
- **NUM-02** runs read-only on staging (CS1 starts at 1 while the DRMS series stands at its own number); the "next
  DRMS = max + 1" variant submits a DRMS request and is **local only** (`UAT_DRMS_WRITER`).
- **FLW-05** proves "DRMS only at Diketahui" only if some DRMS request waits for "Diketahui" on staging (else a note).
- **SCP-04** needs one active DRMS receipt with a receipt number (else SKIP).

## Local validation (how this suite was checked)

```bash
UAT_WORK=<scratch outside the repo> docs/proyekkas/uat/mc4/local/validate.sh   # fresh stack, ~10 min
UAT_PREFIX=pk-mc4uat2 docs/proyekkas/uat/mc4/local/down.sh                    # remove containers + network
```

`validate.sh`: postgres 16.15 + Keycloak 26.7.4 + the standalone build of this worktree (node 24.22.1) on a private
network → `emulate-staging.mjs` (owner step B-1 through Payload REST, DRMS history by the DRMS UAT accounts: requests
pending_ack / approved / transferred, cash entry, progress report + photo, addendum, attendance with selfie) → fixture
plan → apply → API (all optional flags on) → UI → cleanup plan → cleanup → apply again (re-activation) → API (default
flags). Results of the 2026-10-02 run: [`local-run-2026-10-02.md`](local-run-2026-10-02.md).

## Safety rules built in

- `lib.mjs` refuses `UAT_TARGET` other than `local` / `staging`, a staging host without "staging", plain http for
  staging, and a local host that is not a throwaway one. The prod host can never pass.
- Passwords only from `UAT_PW_DIR`; tokens, cookies and passwords are never printed or written; results hold ids and
  status codes, never document content.
- Fixture: only `*.uji@proyekkas.test` accounts; an existing PT `CS1` with another name aborts the run; an account
  that turns out to be a group admin aborts; the preflight proves every Keycloak account exists BEFORE any app write,
  so the app's users-sync only links (no Keycloak user is created, no e-mail is sent).
- No raw SQL, no direct Keycloak admin call, no `docker prune`; containers are `--rm` with fixed names.
