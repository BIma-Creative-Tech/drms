# ADR 0006 — Append-only audit log, DB roles and immutability enforcement

- **Status:** accepted (user, GATE F0 2026-09-23); revised 2026-09-23 after the F1 spike (user-approved), the F1 foundation and F2a, and 2026-09-24 after F2b (see Revision history)
- **Date:** 2026-09-23
- **Author:** Analyst/Architect — Phase 0
- **Related:** requirements v1.0 §8 (audit structure + events), §4 rules, US-35; lead prompt "Audit log
  append-only … trigger PostgreSQL"; `/opt/infra/postgres/{conf/pg_hba.conf,scripts/init-roles.sh}` (read);
  ADR 0001, 0005, 0007; `../architecture.md` §8

## Context

### Verified
- Payload 3.90.1 (tag v3.90.1): collection hooks `beforeChange`, `afterChange` (`doc`, `previousDoc`,
  `operation`, `req`, `context`), `beforeDelete`, `afterDelete`, `afterOperation`, `afterRead`, `afterError`,
  auth hooks `afterLogin/afterLogout`; hook `context` for passing flags (`docs/hooks/*.mdx`).
- All Payload write operations run in a DB transaction; hooks join it by passing `req`
  (`docs/database/transactions.mdx`). An error thrown later rolls back everything in that transaction.
- Payload/Drizzle `update` **deletes and re-inserts** array / `_rels` child rows (`packages/drizzle/src/
  upsertRow/index.ts` `deleteWhere` calls) → any table touched by that path needs DELETE privilege.
  Single relationships are FK columns on the main table (`schema/traverseFields.ts` L941–960).
- PostgreSQL 16 docs: databases grant **CONNECT and TEMPORARY to PUBLIC by default**
  (`postgresql.org/docs/16/ddl-priv.html`); tables grant nothing to PUBLIC. `pg_hba.conf`: "The first
  record with a matching connection type, client address, requested database, and user name is used"
  (`auth-pg-hba-conf.html`). BEFORE statement-level triggers exist for `TRUNCATE` on tables
  (`sql-createtrigger.html`).
- Shared cluster conventions (read): per-app login role `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  NOBYPASSRLS CONNECTION LIMIT n`, `REVOKE ALL ON DATABASE <db> FROM PUBLIC` (`init-roles.sh` L31–39);
  `pg_hba.conf` host lines per db/role on `10.100.1.0/24` + final reject; **Odoo pool lines use regex
  `/^[a-z0-9_]+_(prod|demo)$` (role `odoo_pool_a`) and `/^[a-z0-9_]+_staging$` (role `odoo_staging`).**

### Problem found (challenge to brief §3 DB names)
`drms_proyekkas_prod` matches `^[a-z0-9_]+_(prod|demo)$` and `drms_proyekkas_staging` matches
`^[a-z0-9_]+_staging$` → pg_hba would let the Odoo roles *authenticate* to ProyekKas DBs; only the
database `CONNECT` privilege would stop them. It is also confusable with a future Odoo DB `drms_prod`
(ADR 0009 target). Defence in depth requires a name outside those patterns **and** REVOKE CONNECT.

## Decision

### 1. Databases and roles (infra-engineer provisions; coordination with infra session)
- DB names: **`pk_drms`** (prod) and **`pk_drms_stg`** (staging) — do not match either Odoo regex. **Name accepted by user 2026-09-23.**
  (If the Lead keeps `drms_proyekkas_*`, REVOKE CONNECT FROM PUBLIC + explicit pg_hba lines placed **before**
  the Odoo regex lines become mandatory; still recommended to rename.) Independently, ADR 0009 notes Odoo
  lists only DBs owned by its own role (`service/db.py::list_dbs`, `datdba = current_user`) → the DB owner
  must be `pk_drms_owner`, never an Odoo role.
- Roles per DB (prod shown; staging `_stg` suffix):
  | Role | Login | Rights | Used by |
  |---|---|---|---|
  | `pk_drms_owner` | yes, CONNECTION LIMIT 2 | owns schema `public` objects; DDL | `drms-pk-migrate` only |
  | `pk_drms_app` | yes, CONNECTION LIMIT 25 | `CONNECT`; `USAGE` on schema; per-table grants below; **no TRUNCATE, no REFERENCES, no DDL** | web + worker |
  | `pk_drms_ro` | yes, CONNECTION LIMIT 3 | SELECT only (reports/datamart later, ops) | optional |
- `REVOKE ALL ON DATABASE pk_drms FROM PUBLIC; GRANT CONNECT ON DATABASE pk_drms TO pk_drms_app, pk_drms_ro;`
  `REVOKE CREATE ON SCHEMA public FROM PUBLIC`. pg_hba: `host pk_drms pk_drms_app 10.100.1.0/24 scram-sha-256`
  (+ owner, ro) — placed before the final reject lines.
- **Live (infra, verified by Lead 2026-09-23):** DBs `pk_drms`/`pk_drms_stg` and the 6 roles exist, pg_hba
  lines loaded without error, `pk_drms_app`→`pk_drms` accepted, cross-DB / Odoo-role logins rejected, PUBLIC
  has no CONNECT (infra runbook `/opt/infra/docs/runbooks/proyekkas-drms-onboarding.md` Langkah 1). Staging
  connection limits 2/10/2 (ESTIMATE, runbook). Per-table grants and triggers remain app migrations.
- Default grants (run by owner **at the top of the first Payload migration** — a separate earlier migration
  fails because `payload_migrations` does not exist yet, observed in the F1 spike):
  `ALTER DEFAULT PRIVILEGES FOR ROLE pk_drms_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO pk_drms_app;`
  `… GRANT USAGE, SELECT ON SEQUENCES TO pk_drms_app;` — **DELETE is never a default**.
- **Role names are derived from `current_user`, not hard-coded (F1 foundation,
  `apps/web/src/migrations/20260923_103218_initial.ts` + `…_103219_security.ts`):** the migration requires
  `current_user ~ '_owner$'` (else it raises) and computes the app/ro roles with
  `regexp_replace(current_user, '_owner$', '_app' | '_ro')` → `pk_drms_owner` → `pk_drms_app`/`pk_drms_ro`,
  `pk_drms_stg_owner` → `pk_drms_stg_app`/`pk_drms_stg_ro`. The **same migrations serve prod and staging**
  (and CI's throwaway roles). The app role must exist; the ro default grant is applied only if the ro role
  exists.
- DELETE is granted **explicitly per table** in migrations, only where Payload needs it: array/`_rels`
  child tables of *mutable* collections, Payload internals (`payload_preferences*`,
  `payload_locked_documents*` — needed even when nothing is locked: every update of a lockable collection
  runs `delete from "payload_locked_documents" where false` (F1 spike §c), `payload_jobs`, `payload_migrations` is owner-only), `web_sessions` cleanup,
  `idempotency_keys`. A CI test lists all tables with DELETE for `pk_drms_app` and fails on unexpected
  ones.

### 2. Immutable tables
Class A — **strict append-only** (no UPDATE, no DELETE, no TRUNCATE for anyone except owner with an
explicit, audited migration): `audit_logs`, `approvals`, `attendance_corrections`, `expense_line_snapshots`.
Class B — **append + guarded update** (no DELETE; UPDATE limited by trigger to whitelisted columns/state):
`cash_entries` (ADR 0005 §5–6), `transfers`, `receipts` (status fields only after LPJ submitted),
`progress_reports` (edit ≤ 24 h, requirements §8 T11), `attendances` (corrections via T10 only),
`odoo_outbox` (ADR 0009 collection `odoo-outbox`: rows never deleted by the app; only delivery-state
columns updatable — exact column list owned by ADR 0009).
**Class B guard triggers compare values, not column lists** (verified F1 spike §c): a Payload `UPDATE` on a
flat collection sets **every column** (`set "code"=$1, "name"=$2, …, "created_at"=$7`), so a
`BEFORE UPDATE OF col` trigger would fire on every update. Guards use `OLD.col IS DISTINCT FROM NEW.col` per
protected column.
**Implemented (F1 foundation):** generic trigger function **`pk_protect_columns(col, …)`** (security
migration) — columns named in `TG_ARGV` are **immutable once non-null** (compares `to_jsonb(OLD)->col` vs
`to_jsonb(NEW)->col`, SQLSTATE 42501). Attached as `<table>_protect` to `users.keycloak_sub`, `devices`
(`device_id`, `user_id`, `registered_at`), `web_sessions` (`id_hash`, `user_id`, `keycloak_sid`),
`document_sequences.doc_type`, `project_stages.project_id`, `budget_lines` (`project_id`, `category_id`) and
every media table (`filename`, `sha256_original`, `uploaded_by_id`, `received_at`), plus `<table>_uuid_immutable`
on every table with a `uuid` column.

Class A/B tables must be **flat** Payload collections (**confirmed mandatory** in F1: Payload deletes and
re-inserts **all** array/`_rels` child rows on **every** parent update, even when the array is unchanged): no `array`, `hasMany`, polymorphic relationships,
localized fields or versions (these create child tables that Payload rewrites with DELETE). Lines of an
expense request live in the mutable `expense_requests_lines` child table while in Draft; once submitted,
the domain service snapshots them into `expense_line_snapshots` (Class A) for the audit/PDF trail.

**Implemented (F2a, `migrations/20260923_133050_f2a_security.ts`, `develop` `c8c1af6`):**
- The mutable child tables Payload rewrites on every parent update, **`expense_requests_lines`** and
  **`expense_requests_rels`** (requesters), are the only F2a tables granted DELETE to the app role (plus
  `idempotency_keys` for the expiry purge). DELETE/INSERT there is harmless while the request is editable
  (statuses `draft`, `receipt_revision`). On every transition **out of** an editable status the BEFORE UPDATE
  guard `pk_expense_requests_guard` sets `expense_requests.content_hash` = md5 of the lines + requesters
  (`pk_expense_content_hash()`); while locked, header columns outside a whitelist (`status`, `updated_at`,
  `current_level`, `approved_amount`, `content_hash`, `transferred_total`, `cancel_reason`, `reject_reason`)
  and the hash itself are immutable (SQLSTATE 42501). **DEFERRABLE INITIALLY DEFERRED constraint triggers**
  on the parent and both child tables (`pk_expense_frozen_check`) re-check at commit that the recomputed hash
  still matches and that `grand_total = Σ lines.total` — so Payload's delete-and-reinsert of unchanged rows
  passes, while any real change to a locked request fails. `approved_amount` changes only on
  `pending_approval → approved` and must equal `grand_total` (G3).
- **Class A `expense_line_snapshots`** (collection `expense-line-snapshots`, flat; `reason` =
  `submit|approve|receipts_resubmit`, `cycle`, `grandTotal`, `contentHash`, `data` json): `taken_at` forced to
  `clock_timestamp()`, UPDATE/DELETE/TRUNCATE rejected by trigger and revoked; same for `approvals`
  (+ G1 in the DB: requester/creator never decides, one decision per level, one position per person).
- Class B guards on `receipts`, `receipt_flags`, `transfers`, `cash_entries`, `period_closings` (ADR 0005).
- New table **`idempotency_keys`** (PK `user_id, key`; `request_hash`, stored 2xx response, `expires_at`,
  TTL 72 h; `src/lib/idempotency.ts`): G15 for mutating `/api/v1` POSTs, required for APK requests.
- **Payload swallows COMMIT errors.** Read in `@payloadcms/drizzle` 3.90.1
  `dist/transactions/commitTransaction.js`: `try { await session.resolve() } catch (_) { await session.reject() }`
  — a COMMIT that fails (e.g. a deferred constraint trigger) is rolled back **silently** and the caller sees
  success. Therefore every transaction the app owns forces the deferred checks **inside** the transaction
  before committing: `forceDeferredChecks()` (`SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED`)
  in `withReqTransaction()` (`src/lib/system-tx.ts`) and in the `expense-requests` `afterChange` hook, so a
  violation surfaces as a real error. Re-verify on every Payload upgrade.

**Implemented (F2b, `migrations/20260923_161854_f2b_security.ts`, `develop` `59ba0a4`):**
- **`settlements` (LPJ) — Class B**, flat, no DELETE. Trigger `pk_settlements_guard`: status graph
  `draft → submitted ⇄ revision`, `submitted → verified → settled` only; identity immutable; each column group
  changes only on its own transition; a `settled` row is frozen; on `verified` the DB checks
  `difference = transferred_total − verified_receipts_total` and `settlement_type` (`refund` > 0, `shortfall`
  < 0, `none` = 0); on `settled` the row must reference a **posted** refund KM / `lpj_shortfall` transfer of
  exactly the difference (or none when 0).
- **`notifications` — Class B**, no DELETE (default grants), trigger `notifications_protect`: identity
  columns immutable once set, `read_at` once set stays set, `uuid` immutable; only `read_at` and the push
  delivery columns (`push_status`, ADR 0011) change later.
- `transfers` guard extended: kind `lpj_shortfall` only for an Uang Muka in "LPJ Terverifikasi" whose LPJ is
  verified as shortfall, amount = −difference, one posted per request. `cash_entries`: `settlement_refund`
  rows are cash-IN linked to the request, amount = verified LPJ surplus. `expense_requests` whitelist gains
  `verified_receipts_total`.

**Implemented (F2e, `migrations/20260924_020344_f2e_security.ts`, `develop` `e9c07ab`) — self-involvement
guards** (architecture §5.5 G17, same pattern as `pk_approvals_before_insert` for G1):
- function **`pk_request_involves(request_id, user_id)`** (SQL, STABLE): true when the user created the request
  or is linked to one of its requester employees (mirrors the domain `involvedUserIds`);
- trigger **`receipts_self_verify_guard`** (BEFORE UPDATE on `receipts`, `pk_receipts_self_verify_guard`):
  refuses setting a receipt `valid`/`rejected` with a `verified_by_id` involved in the request;
- trigger **`receipt_flags_self_review_guard`** (BEFORE UPDATE on `receipt_flags`,
  `pk_receipt_flags_self_review_guard`): refuses `reviewed` with an involved `reviewed_by_id`.
Both raise SQLSTATE 42501 and only fire when the verifier/reviewer or the decision changes (existing rows are not
re-checked). Additive and staging-safe; the down migration drops the triggers and functions. LPJ verification and
settlement by an involved Finance user are refused in the service only.

Enforcement per class (in migrations, owner role):
```sql
-- pseudo-config, not final
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM pk_drms_app;
CREATE FUNCTION pk_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append-only table %: % rejected', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501'; END $$;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION pk_reject_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION pk_reject_mutation();
CREATE FUNCTION pk_audit_server_time() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.server_time := clock_timestamp(); RETURN NEW; END $$;   -- ignore any client/app value
CREATE TRIGGER audit_logs_time BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION pk_audit_server_time();
```
Triggers stop even the owner/superuser path through normal DML; privilege revocation stops the app.
A superuser can still `ALTER TABLE … DISABLE TRIGGER` → residual risk documented; mitigated by
restic history (ADR 0006 platform) and optional hash chain (§5).

### 3. Audit table design (requirements §8)
`audit_logs` (flat): `id` bigserial · `server_time` timestamptz (trigger) · `event_id` uuid (groups the
rows of one operation) · `tx_id` bigint (`txid_current()`) · `request_id` text · `doc_type` text ·
`doc_id` text · `doc_no` text · `action` **Postgres enum** (see below) · `field` text · `old_value` jsonb · `new_value` jsonb ·
`status_from` text · `status_to` text · `reason` text · `user_id` bigint (no FK) · `user_roles` **text** (comma-separated role names, not `text[]`) ·
`source` text (`web|apk|system|job`) · `app_version` text · `ip` inet · `device_id` text · `lat`
numeric(9,6) · `lng` numeric(9,6) · `device_time` timestamptz (offline only, comparison data) ·
`prev_hash`/`row_hash` bytea (optional §5). Indexes: (`doc_type`,`doc_id`,`server_time`),
(`user_id`,`server_time`), (`action`,`server_time`), BRIN on `server_time`.
**As implemented (F1 foundation, initial migration):** `action` is the Postgres enum
`enum_audit_logs_action` (Payload `select`) with the extended value set `create`, `update`, `status_change`,
`deactivate`, `reactivate`, `delete_attempt`, `void`, `view_sensitive`, `login`, `logout`, `login_failed`,
`session_revoked`, `role_change`, `role_sync`, `device_register`, `device_revoke`, `number_issued`, `export`,
`print`, `sign`, `acknowledge`, `flag_raised`, `flag_reviewed`, `sync_odoo`, `sync_offline`, `period_close`,
`period_reopen`, `schema_maintenance` (a new value = a migration). Added since: `email_test` (F1 SMTP
migration), **`approve`, `reject`, `verify`** (F2a flow migration `20260923_133049_f2a_flow.ts`) and
**`acknowledge_delegated`, `access_denied`** (F2e migration `20260924_020343_f2e_uat_fixes.ts`, `ADD VALUE` only;
its down migration is a deliberate no-op because Postgres cannot drop enum values and rows using them are
append-only). `acknowledge_delegated` is written at submit when "Diketahui" is delegated to Owner/Admin
(old = skipped user id, new = tier, delegate user ids, cycle; architecture §5.2); `access_denied` records a
refused self-involvement attempt (G1 acknowledge/approve/reject, Finance G17), `field` = the action. `user_roles` is a Payload `text` field
(`varchar`), written as `roles.join(',')` (`src/audit/writer.ts`). Payload column types differ from the sketch:
`id` serial, `tx_id`/`user_id` numeric, `ip` varchar, `source` enum; `server_time` NOT NULL (security migration).
Payload collection `audit-logs` exposes it read-only: `access.create/update/delete = () => false` (writes
only via system path), `read` = scope rule (own doc/team/all per requirements §4 matrix),
`lockDocuments: false`, no versions.

### 4. Capture mechanism
- **Field-level diff**: a factory `auditHooks({ docType, trackedFields, reasonRequiredFor })` attached to
  each business collection: `afterChange` compares `previousDoc` vs `doc` for `trackedFields` (from the
  §8 event table) and inserts one row per changed field (+ one `status_change` row) via
  `req.payload.create({ collection: 'audit-logs', data, req, overrideAccess: true, context: { audit: false } })`
  → **same transaction** as the change (atomic: no change without log).
- Request metadata (`ip`, `device_id`, `source`, `app_version`, `lat/lng`, `request_id`, `reason`) is
  placed on `req.context.audit` by the `/api/v1` layer / admin actions; a `beforeChange` guard rejects
  operations whose event requires a reason (cancel, reject, void, correction, weight change, archive,
  deactivate, receipt reject, LPJ revision) when `reason` is missing.
- **delete_attempt**: `beforeDelete` throws (deletes forbidden) — the log row must be written **outside**
  the failing transaction (new `payload.db.beginTransaction()` or no `req`) before throwing.
  **As implemented (F2e):** shared helper `writeAuditDetached` (`src/audit/writer.ts`) writes such rows in their
  own transaction (new local req + `withReqTransaction`) and never throws (a failed write is logged); used for
  `delete_attempt` and **`access_denied`** (`domain/expense/common.ts` `requireActionAudited`: the business
  operation rolls back with 403, the attempt stays recorded).
- **view_sensitive**: `afterRead`/`afterOperation` (`findByID`) on sensitive collections
  (`employee-bank-accounts`, selfies, exports) — throttled (1 row per user/doc/10 min).
- **Auth events**: login/logout in the auth routes (ADR 0003); role sync; device revoke.
- **Offline sync**: rows keep server time; `device_time` + `source=apk` + `action=sync_offline` flag.
- **Audit JSON values are wrapped** as `{"v": <value>}` in `old_value`/`new_value` (Payload `json` fields reject
  bare strings; F1 spike §c).
- **Verified in F1** (spike §c, Postgres statement log): `payload.create`/`update` + audit rows run in one
  transaction (same `txid`), only `INSERT`/`SELECT` touch `audit_logs`, a throw after the audit insert rolls
  back both; as `pk_drms_app` UPDATE/DELETE/TRUNCATE → SQLSTATE 42501; as owner the trigger rejects them;
  a forged `server_time` is overwritten by the trigger. The `tx_id` source uses the request transaction handle
  (`adapter.sessions[await req.transactionID].db`, typed but internal → keep the integration test on every
  Payload upgrade, see ADR 0007 §5).
- Tested invariant (F1 gate): for every tracked field of every collection, a change produces exactly the
  expected rows; `UPDATE/DELETE/TRUNCATE audit_logs` as `pk_drms_app` fails with SQLSTATE 42501.

### 5. Optional tamper evidence (decide in F6)
Hash chain: BEFORE INSERT trigger sets `row_hash = sha256(prev_hash || canonical_row)` with
`prev_hash` from the latest row under an advisory lock — serialises audit inserts (throughput cost small
at DRMS volume). Daily job exports the day's last hash to logs (Loki) as an external anchor.

**Decision E9 (2026-09-26): not implemented for go-live (deferred, revisit after the load test).** Rationale:
- The advisory lock is held until COMMIT, and every business transaction writes its audit rows in the same
  transaction (§4) — so the chain serialises **all** mutating requests (approvals, sync batches, transfers) behind
  each other, not just the audit INSERTs; with offline sync batches of up to 50 items that is a real latency and
  lock-wait risk that the pending load test (E9, Q-34) has not measured.
- It needs more than a trigger to be useful: a canonical row encoding stable across Payload upgrades, a
  verification tool, a daily anchor job and a runbook for "chain broken" — none exists yet.
- The threat it adds evidence for (a DB **superuser** disabling the triggers and rewriting history) is already
  bounded by: `REVOKE UPDATE/DELETE/TRUNCATE` + reject triggers (§2), no superuser in the app path, daily restic
  backups with retention (platform ADR 0006; restore drill in E9), and container/application logs in Loki.
Cheaper follow-up (proposed, not built): a **daily digest** job in the worker — `sha256` over the previous day's
`audit_logs` rows ordered by `id` (+ count and max id) written to the log (Loki) as an external anchor; no lock, no
schema change, verification = recompute. Owner: nextjs + infra (Loki retention). Open question for the Lead/user.

### 6. Payload migrations vs these rules
- Payload generates DDL migrations (`payload migrate:create`); we **append raw SQL** (roles, grants,
  triggers, CHECKs) in the same or follow-up migration files (Payload migrations are TS with `up/down`
  receiving `db`/`payload` — `MigrateUpArgs` exported by `@payloadcms/db-postgres`, source `index.ts` L250).
- Migrations run as `pk_drms_owner` (one-shot container). Any future Payload-generated `ALTER` on Class A/B
  tables is reviewed; a migration that needs to rewrite rows of a Class A table must explicitly
  `ALTER TABLE … DISABLE TRIGGER …; …; ENABLE TRIGGER …` and is itself recorded as an `audit_logs` row
  (`action='schema_maintenance'` — already a value of `enum_audit_logs_action`) — requires Lead + user approval.
- `push` mode is never used against staging/prod (ADR 0001 §7).
- Integration test in CI: run all migrations as owner, then run the app test suite as `pk_drms_app`
  (catches missing grants, e.g. a new child table needing DELETE).

## Alternatives

| Alternative | Rejected because |
|---|---|
| Payload `versions` as audit trail | Versions are mutable tables Payload itself deletes/prunes (`maxPerDoc`), do not carry reason/IP/device/geo, and are per-doc snapshots rather than field diffs |
| Postgres generic trigger audit (row → jsonb diff) only | Cannot see app context (user, device, reason, geo) without session GUCs; possible later via `SET LOCAL app.*` but Payload owns the connection/transaction lifecycle → **UNVERIFIED** feasibility; app-level hooks chosen, DB triggers only enforce immutability |
| Separate audit DB | Loses atomicity with the business write |
| Odoo `mail.tracking` | Outside Odoo (ADR 0001) |

## Consequences

- Strong guarantees: app cannot alter history; every tracked change is atomic with its log.
- Developers must keep Class A/B collections flat and add explicit DELETE grants for new child tables —
  enforced by CI test.
- Rename of DB (vs brief) must be accepted by Lead; infra provisions pg_hba lines.

## Security implications

- STRIDE "Repudiation" and "Tampering" mitigated at DB level; residual: superuser/owner can disable
  triggers (host root compromise is out of scope; restic snapshots preserve prior state).
- Audit rows contain PII (IP, GPS) → read access per scope; retention = keep for life of the system
  (client question: legal retention period); excluded from staging refresh unless anonymised.

## Rollback

Triggers/grants are migrations → a down-migration can drop them (owner role; requires approval). Renaming
the DB before first deploy is free; after deploy it needs dump/restore.

## Proposed CLAUDE.md changes (need user approval; author does not edit)

1. §3.2/§3.5 (or postgres runbook): "Non-Odoo client DBs must not match the Odoo pool pg_hba regexes
   (`*_prod`, `*_demo`, `*_staging`); always `REVOKE CONNECT … FROM PUBLIC`."

## Revision history

- **2026-09-23 (F0 gate):** accepted by user.
- **2026-09-23 (F1 spike, user-approved):** Payload 3.90.1 = GO (user); append-only design verified (spike §c).
  §2: Class B triggers compare `OLD.col IS DISTINCT FROM NEW.col` (Payload UPDATE writes all columns);
  "flat Class A/B" confirmed mandatory (every parent update deletes and re-inserts all array/`_rels` rows).
  §1: default privileges at the top of the first Payload migration; `payload_locked_documents(_rels)` need
  DELETE for the app role; DBs/roles now live (infra, verified by Lead). §4: audit JSON values wrapped
  `{v: …}`; verification evidence recorded.
- **2026-09-23 (F1 foundation):** verified against `apps/web/src/migrations/`. §1 role names derived from
  `current_user` (`*_owner` → `*_app`/`*_ro`) so the same migrations serve prod and staging. §2 generic
  `pk_protect_columns` trigger for immutable-once-set columns (+ `uuid` on every table). §3 `action` is the
  Postgres enum `enum_audit_logs_action` with the extended value set (incl. `number_issued`,
  `schema_maintenance`); `user_roles` is text (comma-separated), not `text[]`. Status stays accepted.
- **2026-09-23 (F2a):** verified against `develop` `c8c1af6`. §2: `expense_requests_lines/_rels` get DELETE
  (editable statuses only); after the lock they are protected by `content_hash` + DEFERRED constraint
  triggers (hash and Σ lines re-checked at commit); Class A `expense-line-snapshots` (and `approvals`);
  `idempotency_keys` table; Payload `commitTransaction` swallows COMMIT errors (read in `@payloadcms/drizzle`
  3.90.1) → deferred checks are forced inside the transaction. §3: new audit enum values `approve`,
  `reject`, `verify` (and `email_test` from F1). Status stays accepted.
- **2026-09-24 (F2b):** verified against `develop` `59ba0a4`. §2: `settlements` and `notifications` are
  Class B with DB guards (settlement status graph, frozen when settled, difference and refund/shortfall
  cross-checks; notifications identity immutable, `read_at` sticky, no DELETE); `transfers`/`cash_entries`
  guards extended for `lpj_shortfall` / `settlement_refund`. Downloads of the PDF are audited `export`,
  transfer-proof file reads `view_sensitive` (ADR 0008, architecture §6.3). Status stays accepted.
- **2026-09-24 (F2e):** verified against `develop` `e9c07ab`. §2: self-involvement DB guards
  `receipts_self_verify_guard` / `receipt_flags_self_review_guard` with `pk_request_involves` (SQLSTATE 42501).
  §3: audit enum values `acknowledge_delegated`, `access_denied` (down = no-op). §4: detached audit writer for
  refused attempts (`delete_attempt`, `access_denied`). Status stays accepted.
- **2026-09-26 (E9, S3 track A):** §5 decided — hash chain **not** implemented for go-live (serialises every
  mutating transaction; verification tooling missing; superuser risk bounded by grants, triggers, backups, Loki);
  daily digest anchor proposed as a follow-up. Status stays accepted.
