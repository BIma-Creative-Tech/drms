# ADR 0009 — One-way mirror ProyekKas → Odoo 19 (JSON-2 API, outbox pattern)

- **Status:** accepted (user, GATE F0 2026-09-23); multi-company revision proposed 2026-09-27 (ADR 0016, section "Revisi 2026-09-27")
- **Date:** 2026-09-23
- **Author:** Analyst (mobile & integration), Phase 0
- **Related:** `docs/proyekkas/f0-brief.md` §2 decision 2, §3 "Odoo mirror"; `/opt/infra/CLAUDE.md` §0, §3.2, §3.6;
  `/opt/infra/docs/adr/0003-odoo-no-oca.md` (D1 `sh_dbfilter_header`); `/opt/infra/docs/adr/0004-capacity.md` §2–§3;
  requirements v1.1 §9 "Transisi Odoo"; open question Q-27 (migration timing), Q-25 (COA), Q-01 (cash scope).
  ADRs 0001–0008 (architecture, auth, storage, cash ledger, audit log, numbering, PDF) are written in parallel by
  another agent — where this ADR depends on them it says so explicitly.

## Context

DRMS will likely move to Odoo after this phase (user decision #2). ProyekKas (Payload CMS + Postgres) is the
system of record now; Odoo must receive a **one-way copy** (ProyekKas → Odoo) so the later cutover is a data
flip, not a data migration project. The mirror is planned for phase **F7** (requirements v1.1, Q-27); the schema
hooks it needs (outbox table, `odoo_id`, stable UUIDs) must exist from F1.

### Facts verified in this session (source read inside container `odoo-pool-a`, image `odoo:19.0-20260908`, `odoo/release.py` → `version_info = (19, 0, 0, FINAL, 0, '')`)

Paths are relative to `/usr/lib/python3/dist-packages/odoo/`.

**JSON-2 endpoint** — `addons/rpc/controllers/json2.py`:
- Route `POST /json/2/<__model__>/<__method__>`, `auth='bearer'`, `type='json2'`, `save_session=False`.
  Body = JSON object; keys `ids` (list, default `()`), `context` (object) and the method's keyword arguments.
  `@api.model` methods reject `ids` (HTTP 422 "cannot call … with ids"). Return value is JSON; recordsets are
  converted to `ids`.
- Only public methods: `service/model.py::get_public_method` refuses names starting with `_`, names in
  `_UNSAFE_ATTRIBUTES` and methods marked `@api.private`.
- **One HTTP request = one method call = one DB transaction.** There is no multi-call transaction in JSON-2.
- Errors (`http.py::Json2Dispatcher.handle_error`): `UserError` → its `http_status`; `HTTPException` → its code;
  anything else → 500, body = serialized exception.
- `addons/rpc/controllers/__init__.py`: `/xmlrpc`, `/xmlrpc/2`, `/jsonrpc` "deprecated in Odoo 19 and scheduled
  for removal in Odoo 22" → XML-RPC/JSON-RPC are **not** used.

**Bearer auth / API keys** — `addons/base/models/ir_http.py::_auth_method_bearer` and
`addons/base/models/res_users.py` (`class ResUsersApikeys`, `_name = 'res.users.apikeys'`):
- Header `Authorization: Bearer <key>`; checked with `_check_credentials(scope='rpc', key=token)`. Source comment:
  *"'rpc' scope does not really exist, we basically require a global key (scope NULL)"* → a JSON-2 key is always a
  **global key of one user**; there is **no per-model scope**. Least privilege = the user's groups/ACL/record rules.
- Key = 20 random bytes hex (`API_KEY_SIZE = 20`), stored hashed (`pbkdf2_sha512`, 6000 rounds), lookup by first
  8 hex chars (`INDEX_SIZE = 8`). Fields: `name`, `user_id`, `scope`, `create_date`, `expiration_date`.
- Expiration: `_check_expiration_date` — non-system users **must** set an expiration date ≤ max
  `res.groups.api_key_duration` of their groups (`addons/base/models/res_groups.py`); `base.group_user` has
  `api_key_duration = 90.0` (`addons/base/security/base_groups.xml`). System users may create persistent keys.
  Expired keys are deleted by `_gc_user_apikeys`.
- Programmatic rotation: `res.users.apikeys.generate(key, scope, name, expiration_date)` and `revoke(key)` exist, but
  `_ensure_can_manage_keys_programmatically` refuses unless the caller is system **or**
  `ir.config_parameter` `base.enable_programmatic_api_keys` is true; limit `base.programmatic_api_keys_limit`
  (default `DEFAULT_PROGRAMMATIC_API_KEYS_LIMIT = 10`).

**Database selection** — `http.py::Request._get_session_and_dbname` + platform module
`/mnt/extra-addons/shared/sh_dbfilter_header/dbfilter.py` (loaded via `server_wide_modules = base,rpc,web,sh_dbfilter_header`
in `/etc/odoo/odoo.conf`):
- Core Odoo 19 selects a DB from the `X-Odoo-Database` header (stateless) or monodb. On this platform
  `sh_dbfilter_header` (active because `proxy_mode = True`) **pops `X-Odoo-Database`** from the WSGI environ and
  wraps `db_filter` so only the DB named exactly in **`X-Sh-Odoo-Db`** (`[a-z0-9_]{1,63}`) survives; missing/invalid
  header → no DB (fail-closed). With one DB left, `_get_session_and_dbname` takes the monodb branch.
- Traefik sets `X-Sh-Odoo-Db` per router and blanks `X-Odoo-Database`
  (`/opt/infra/traefik/dynamic/clients/demo-demo.yml`, middleware `odoo-demo-demo-db`). **Therefore a JSON-2 client
  must NOT send `X-Odoo-Database`** (it is dropped) and, when calling through Traefik, cannot choose the DB at all —
  the hostname decides.
- Pool filters: prod `dbfilter = ^[a-z0-9_]+_(prod|demo)$` (odoo-pool-a), staging `^[a-z0-9_]+_staging$`
  (odoo-staging). The originally proposed names `drms_proyekkas_prod` / `drms_proyekkas_staging` matched these
  patterns (and the pg_hba rule `/^[a-z0-9_]+_staging$` for role `odoo_staging`), so ProyekKas DBs are named
  **`pk_drms` / `pk_drms_stg`** (ADR 0006, pending user approval). Independently, `service/db.py::list_dbs` lists
  only DBs **owned by the Odoo role** (`datdba = current_user`), so ProyekKas DBs MUST be owned by `pk_drms_owner`.

**External IDs / idempotency** — `addons/base/models/ir_model.py` (`_name = 'ir.model.data'`, fields `name`,
`module`, `model`, `res_id`, `noupdate`; unique index `(module, name)`), `addons/base/security/ir.model.access.csv`,
`orm/models.py`:
- `ir.model.data` ACL: `base.group_user` has **0/0/0/0**; only `base.group_erp_manager` has CRUD → a least-privilege
  technical user **cannot** `create`/`search` `ir.model.data` directly.
- `BaseModel.load(fields, data)` (`orm/models.py` line 895, `@api.model`, public) imports rows; an `id` column is an
  external ID. `_load_records` (line 5114) looks up existing XMLIDs with `ir.model.data` **in sudo**, updates the
  record if the XMLID exists, creates it (and the XMLID) otherwise → an **idempotent upsert keyed by external ID**
  without giving the user `ir.model.data` rights. XMLIDs without a dot get the `__import__` module. Errors do **not**
  raise: `load` returns `{'ids': False, 'messages': [...]}` after rolling back its savepoint.
- `get_external_id()` (line 5722, public) returns `{id: 'module.name'}` using sudo → usable for reconciliation.
- Custom `x_` fields: `ir.model.fields` default name `'x_'` (`ir_model.py` line 523) — manual fields can be added
  only with `base.group_erp_manager` (`ir.model.access.csv` L16: CRUD; L20: `base.group_user` 0/0/0/0) — not by
  the mirror user.
- `BaseModel.action_archive` exists (`orm/models.py` line 5803).

## Decision

1. **Pattern: transactional outbox → single worker → JSON-2.**
   - Every business write in Payload that changes a mirrored collection inserts a row in collection `odoo-outbox`
     **in the same DB transaction** (Payload hook using the request's transaction, or a Postgres trigger —
     implementation choice for F1, must be proven by a test that rolls back the business change and asserts no
     outbox row). Columns: `id` (bigserial, ordering), `aggregate` (collection slug), `aggregate_id` (UUID),
     `op` (`upsert`|`archive`|`post_message`|`attach`), `payload_hash`, `created_at` (server), `status`
     (`pending`|`in_flight`|`done`|`failed`|`dead`), `attempts`, `next_attempt_at`, `last_error` (truncated, no PII),
     `odoo_id`, `odoo_xmlid`, `sent_at`, `response_code`.
   - The outbox stores **references + hash, not the full row**; the worker reads the current row when sending
     (latest state wins, avoids storing PII twice). Multiple pending rows for the same aggregate are coalesced.
   - Worker = a scheduled task of the **Payload Jobs Queue** (chosen in ADR 0002 §4, not pg-boss) running in the
     jobs worker container, **one** consumer (single concurrency key `odoo-mirror`), rows claimed with
     `SELECT … FOR UPDATE SKIP LOCKED`, per-aggregate ordering by `id`. The mirror is asynchronous: a failure never
     blocks or rolls back a user action (requirements v1.1 §9).
2. **Idempotency key = Odoo external ID** `__import__.pk_<slug_with_underscores>_<uuid_hex>` (e.g.
   `__import__.pk_employees_3f2b…`), created/updated with `POST /json/2/<model>/load` (`fields` incl. `"id"`, `data`
   rows as strings; relations as `"<field>/id"` columns pointing to other `pk_*` XMLIDs). ProyekKas also stores
   `odoo_id` + `odoo_xmlid` on each mirrored row after success. Fields that `load` cannot express simply
   (e.g. `analytic_distribution` Json, attachments) are sent by a follow-up `write`/`create` call using the id
   returned by `load`. A re-sent item therefore updates instead of duplicating.
   - Rejected for idempotency: custom `x_proyekkas_uuid` fields (needs admin to create manual fields in every DB;
     acceptable only inside the F7 addon, see §6), and creating `ir.model.data` directly (needs `group_erp_manager`).
   - **UNVERIFIED (test on `drms_staging` in F7 before relying on it):** behaviour of `load` for Json fields,
     `readonly=True` stored fields (e.g. `hr.attendance.in_latitude`), `_inherits` records (`hr.employee` →
     `hr.version`: `_load_records` adds an extra XMLID `<xid>_hr_version`), and `noupdate`.
3. **Batching:** up to 50 rows of the **same model** per `load` call (one transaction per call). If `load` returns
   `ids: false`, the worker retries that batch **row by row** to isolate the bad row. Dependencies are sent in
   topological order: `banks` → partners → `employees` → bank accounts → analytic/projects → `uoms`/`vehicles` →
   expenses → attendances → messages/attachments.
4. **Retries / dead letter:** exponential back-off 1 min → 2 → 4 … capped at 6 h, max 10 attempts, then `dead`.
   HTTP 401/403 (key expired/revoked, ACL) → pause the whole worker and alert (no point retrying rows). HTTP 422/
   `UserError` → row-level failure (data problem) → `failed` after 3 attempts, visible in the admin UI with a
   "retry" button (Admin only). 5xx/timeouts/429 → back-off. Dead rows never block other aggregates, but block
   later rows **of the same aggregate** (ordering).
5. **Reconciliation report (daily job + on demand):** for each mirrored collection, compare counts and a per-row
   hash of mirrored fields (ProyekKas side) against `search_read` of the same fields by `odoo_id` (Odoo side);
   list missing, extra (`get_external_id` returns a `pk_*` XMLID but no ProyekKas row), and drifted rows (someone
   edited in Odoo). Output: Payload admin view + CSV export. Drift is reported, never auto-overwritten back into
   ProyekKas (one-way).
6. **Mapping** — see table below. What has no faithful Odoo 19 CE target goes to (a) chatter (`message_post`) +
   `ir.attachment` on the nearest record in F7, and (b) a client addon **`cl_drms_proyekkas`** (repo
   `odoo-addons-drms`, prefix per CLAUDE.md §3.2) designed in F7 **only if the client confirms the Odoo migration
   scope (Q-27)**. Accounting mirroring (`account.move`/`account.payment`) is **deferred** until COA (Q-25) and cash
   scope (Q-01) are decided — mirroring a cash ledger into a real general ledger without a COA would create wrong
   books.
7. **Target DB & network path:** Odoo DB `drms_prod` (convention `<slug>_prod`) on `odoo-pool-a`, `drms_staging`
   on `odoo-staging`; the ProyekKas staging environment mirrors only to `drms_staging`. The worker calls
   **through Traefik** at the DRMS Odoo hostname (e.g. `https://drms.erp.<platform-domain>`; exact FQDN chosen by
   infra) so that the proven header middleware (`X-Sh-Odoo-Db` set by Traefik, `X-Odoo-Database` stripped),
   CrowdSec and rate limits apply. Rejected: joining the ProyekKas container to network `odoo-edge` and calling
   `odoo-pool-a:8069` directly — then the worker itself sets `X-Sh-Odoo-Db`, i.e. any process in that container
   could address any `*_prod` DB of other clients on the pool (the API key is per-DB, but the network trust is
   not). If hairpin routing to the public IP fails on this host, the fallback is an internal Traefik entrypoint —
   infra decision, **UNVERIFIED**.
8. **Technical user & key:** Odoo user `svc_proyekkas_mirror` (no login via Keycloak, local password only for the
   one-time interactive key creation, then password disabled/randomised), groups limited to (XMLIDs verified in
   `addons/<module>/security/*_security.xml`): `hr.group_hr_user` (needed because `bank_account_ids` is
   `groups="hr.group_hr_user"`), `hr_expense.group_hr_expense_team_approver` or `…_user`,
   `hr_attendance.group_hr_attendance_officer`, `project.group_project_user` (+ `project.group_project_stages`
   if project stages are mirrored), `fleet.fleet_group_user`, `analytic.group_analytic_accounting`. Whether these
   groups are *sufficient* for `create`/`write` on every mapped model is **UNVERIFIED** (ACL CSVs not fully read) —
   F7 test with the real user. **Never** `base.group_system` / `group_erp_manager`
   (`group_erp_manager` is the only group with CRUD on `ir.model.data` and `ir.model.fields` —
   `addons/base/security/ir.model.access.csv` L15–20). Key created with expiration **≤ 90 days** (forced by `api_key_duration`), rotated at day 75:
   admin creates the new key interactively as that user (programmatic generation stays disabled — enabling
   `base.enable_programmatic_api_keys` is DB-wide), stores it, then revokes the old one. Key stored as a Docker
   secret / `.env` mode 600 (`ODOO_MIRROR_API_KEY`), never in the repo, never logged (log only the 8-char index).
9. **Load on the shared pool:** pool prod has `workers = 3`, `limit_time_real = 300`, `db_maxconn = 8`
   (`/etc/odoo/odoo.conf`) and ≈18 concurrent users total for all clients (ADR 0004 §3). The mirror uses
   **concurrency 1**, ≤ 50 rows per call, ≥ 250 ms pause between calls, bulk back-fill only 20:00–06:00 WITA, and
   stops on 503/429. Traefik `ratelimit-default` (average 50 req/s, burst 100 — `/opt/infra/traefik/dynamic/middlewares/ratelimit.yml`)
   is far above this. Estimated volume (Q-34 proposal: 100 requests + 300 receipts/month, 30 staff × 2
   attendance/day) ≈ < 3 000 calls/month — negligible; measure in F7.

### Mapping table (ProyekKas collection → Odoo 19 CE model/fields)

"Src" = file in container where the model/field was verified this session (prefix `addons/`).

| ProyekKas slug | Odoo model | Fields (ProyekKas → Odoo) | Src | Notes |
|---|---|---|---|---|
| `banks` | `res.bank` | name→`name`, code→(none), —→`bic`, active→`active` | `base/models/res_bank.py` (L17–33) | Indonesian bank code has no field; keep in XMLID or F7 addon. |
| `employees` | `hr.employee` (`_inherits = {'hr.version': 'version_id'}`) | name→`name`, phone→`mobile_phone`, code→`barcode` (groups hr_user) or `identification_id` (on `hr.version`), job title→`job_title` (`hr.version`), active→`active`, user→`user_id` (only if the person has an Odoo user — normally **not** mirrored), —→`work_contact_id` (auto partner) | `hr/models/hr_employee.py` (L84–149, 210), `hr/models/hr_version.py` (L73, 131) | **19.0 change:** no `bank_account_id`; employee has `bank_account_ids` (M2M, `groups="hr.group_hr_user"`) and computed `primary_bank_account_id`. Reference face photo: not mirrored (biometric PII). |
| `employee-bank-accounts` | `res.partner.bank` + link in `hr.employee.bank_account_ids` | number→`acc_number`, holder→`acc_holder_name`, bank→`bank_id`, owner→`partner_id` = employee's `work_contact_id`, active→`active`, verified→`allow_out_payment` (**decision needed**: only verified accounts get `allow_out_payment=True`) | `base/models/res_bank.py` (L74–101), `hr/models/hr_employee.py` (L137–149) | Test seed: Mandiri · Doni Pratama · 1234567890123. |
| `clients` | `res.partner` (`is_company=True`) | name→`name`, contact→`phone`/`email`, address→`street`/`city`, —→`customer_rank` (account) | `base/models/res_partner.py` (L213–282), `account/models/partner.py` (L606–607) | **19.0:** `res.partner` has no `mobile` field (grep found none) — use `phone`. |
| `vendors` | `res.partner` | name→`name`, NPWP→`vat`, contact→`phone`/`email`, —→`supplier_rank` | same as above | |
| `projects` | `project.project` + `account.analytic.account` | code→(analytic `code`), name→`name`, client→`partner_id`, PM→`user_id` (only if PM has Odoo user; else chatter note), start→`date_start`, target→`date`, status→`stage_id` (`project.project.stage`, `groups="project.group_project_stages"`) / archived→`active`, analytic→`account_id` | `project/models/project_project.py` (L90–166), `project/models/project_project_stage.py`, `analytic/models/analytic_account.py` (L20–67) | lat/long/radius, RAB: **no field** → F7 addon; RAB not mappable to CE budget (no budget module in image: `ls addons | grep budget` empty). |
| `cost-centers` | `account.analytic.account` in plan "Pusat Biaya" (`account.analytic.plan`) | code→`code`, name→`name`, plan→`plan_id` (required), active→`active` | `analytic/models/analytic_account.py`, `analytic/models/analytic_plan.py` (L14–85) | Projects in a second plan "Project" so both can be combined in `analytic_distribution`. |
| `project-stages` | `project.task` (one task per stage) | name→`name`, order→`sequence`, project→`project_id` | `project/models/project_task.py` (L152–262) | Weight % and stage progress %: **no CE field** → F7 addon or text in `description`. Alternative `project.milestone` (`project/models/project_milestone.py`: `name`, `sequence`, `project_id`, `deadline`, `is_reached`) — choose in F7. |
| `stage-templates` | — | — | — | Unmappable; Odoo has project templates (`is_template` domain seen in `project_update.py` L58) — evaluate in F7. |
| `budget-lines`, `budget-addenda` | — | — | — | Unmappable in CE → F7 addon; addendum approval history → chatter on the project. |
| `expense-categories` | `product.product` with `can_be_expensed=True` | name→`name`, COA mapping→product's expense account (**UNVERIFIED** field, depends on Q-25) | `hr_expense/models/product_template.py` (L18) | "Daftar satuan wajar", "perlu kendaraan": no field → F7 addon. |
| `uoms` | `uom.uom` | name→`name`, active→`active`, —→`relative_uom_id`/`relative_factor` | `uom/models/uom_uom.py` (L18–43) | **19.0 change:** no `uom.category` (grep empty); units are related by `relative_uom_id`. Units like "kamar", "porsi", "kali isi" have no reference unit → create standalone. |
| `vehicles` | `fleet.vehicle` | plate→`license_plate`, type/model→`model_id` (**required**, `fleet.vehicle.model` needs `brand_id` **required**), active→`active` | `fleet/models/fleet_vehicle.py` (L38–115), `fleet/models/fleet_vehicle_model.py` (L32–37) | Needs a brand/model seed (e.g. "Toyota/Hilux"); vehicle costs could later map to `fleet.vehicle.log.services` (`vehicle_id`, `amount`, `date`, `vendor_id` — `fleet/models/fleet_vehicle_log_services.py`). |
| `expense-requests` (header) | **no model** in 19.0 | number/title → prefix of each line's `name` and chatter | `hr_expense/models/hr_expense.py` | **19.0 change: `hr.expense.sheet` no longer exists** (only in `i18n/*.po`; `hr_expense/models/` has no sheet file). Expenses are grouped only by the posted `account.move` (`hr_expense/models/account_move.py` L12 `expense_ids`). Header (type Uang Muka/Reimburse, requesters, "Dibuat Oleh", bank snapshot, status machine) → F7 addon or chatter. |
| `expense-requests.lines` | `hr.expense` (one per line) | description→`name`, date→`date`, employee (first requester)→`employee_id`, category→`product_id`, qty→`quantity`, line total→`total_amount_currency`, notes→`description`, vendor→`vendor_id`, project/cost-center→`analytic_distribution` `{"<analytic_id>": 100}`, advance vs reimburse→`payment_mode` (`own_account` = employee paid = Reimburse; Uang Muka **has no CE equivalent**) | `hr_expense/models/hr_expense.py` (L43–283) | `price_unit` is computed **readonly** and `product_uom_id` is computed from the product (not writable per line) → ProyekKas unit/unit price kept in `description`. `state` is computed (`draft`…`paid`/`refused`); approve actions `action_submit`/`action_approve`/`action_post` exist (L1128–1205) but the mirror **only creates drafts**; replaying approvals is an F7 decision. Vehicle link → F7 addon. |
| `receipts` | `ir.attachment` on the `hr.expense` | photo→`datas` (base64), `res_model='hr.expense'`, `res_id`; receipt no./vendor/date/amount → chatter message | `base/models/ir_attachment.py` (L453–477), `mail/models/mail_thread.py::message_post` (L2199) | Validation flags and Finance "checked" marks → chatter text. |
| `approvals` (incl. signatures) | — | — | — | **Unmappable** as structured data (no 4-position signature model in CE). F7: `message_post` on each `hr.expense` with position, name, server time, decision + signature PNG as attachment. Legal weight of signatures in Odoo: out of scope. |
| `transfers`, `cash-entries`, `cash-reversals`, `period-closings`, `cash-accounts` | `account.payment` / `account.move` (`move_type='entry'`) in `account.journal` (`type` `cash`/`bank`) ; reversal via `account.move.reversal.reverse_moves`; closing via company `fiscalyear_lock_date`/`hard_lock_date` | journal→`journal_id`, date→`date`, amount→`amount` / `line_ids` (debit/credit/`account_id`/`analytic_distribution`), ref→`ref`/`memo`, recipient bank→`partner_bank_id` | `account/models/account_payment.py` (L8–130), `account/models/account_move.py` (L74–661), `account/models/account_move_line.py`, `account/models/account_journal.py` (L43–247), `account/wizard/account_move_reversal.py` (L110), `account/models/company.py` (L56–66) | **Deferred** (Q-01, Q-25). `l10n_id` provides the Indonesian COA (`l10n_id/data/template/account.account-id.csv`) and taxes; it adds QRIS fields only (`l10n_id/models/`). |
| `attendances` | `hr.attendance` | employee→`employee_id`, check-in/out→`check_in`/`check_out` (UTC), GPS→`in_latitude`/`in_longitude`/`out_latitude`/`out_longitude` (digits 10,7, `readonly=True` in field def), address text→`in_location`/`out_location`, source→`in_mode`/`out_mode` (selection `kiosk`/`systray`/`manual`/`technical`; use `technical`) | `hr_attendance/models/hr_attendance.py` (L28–82, 197–240) | Geolocation fields exist. **No project field**, no selfie, no distance, no offline flag → F7 addon / chatter. Constraint `_check_validity`: one open attendance per employee and **no overlaps** — ProyekKas "one check-in per project per day" may create records Odoo rejects (multi-project same day, PM corrections) → such rows become `failed` and appear in reconciliation. |
| `attendance-corrections` | `hr.attendance` write + chatter | new times→`check_in`/`check_out` | same | Correction reason → `message_post`. |
| `progress-reports` | `project.update` | title→`name`, status (derived from traffic-light)→`status` (`on_track`/`at_risk`/`off_track`/`on_hold`/`done`), project % →`progress` (Integer), work+issues→`description` (HTML), date→`date`, reporter→`user_id` (required, default = mirror user) | `project/models/project_update.py` (L22–63; `_inherit` `mail.thread.cc`) | Per-stage % before→after: no field → description text / F7. Photos (≤ 5) → `ir.attachment` on the update. |
| `team-assignments`, `work-schedules`, `holidays` | (partial) `resource.calendar` / `resource.calendar.leaves` exist in `hr/models/` | — | `hr/models/resource_calendar.py`, `resource_calendar_leaves.py` (file names only; fields **UNVERIFIED**) | Evaluate in F7. |
| `audit-logs` | — | — | — | **Not mirrored.** Append-only ProyekKas log stays the evidence; exported as a signed archive (CSV/JSON + sha256) at cutover and kept read-only. Odoo `mail.tracking` will only track changes made in Odoo afterwards. |
| `users`, `devices`, `notifications`, `notification-templates`, `document-sequences`, `approval-rules`, `company-settings`, `odoo-outbox` | — | — | — | Not mirrored (identity is Keycloak; numbering continues in Odoo `ir.sequence` configured at cutover). |

## Cutover procedure (F7+, after the client confirms the migration)

1. **Dry run on staging:** full back-fill `pk_drms_stg` → `drms_staging`, reconciliation report = 0
   missing / 0 drift; user acceptance by Finance on Odoo staging.
2. **Announce freeze window** (e.g. Saturday 18:00 WITA). APK shows banner; offline queues must be empty
   (admin dashboard lists devices with unsynced items; `devices.last_sync_at`).
3. **Freeze:** ProyekKas switched to read-only mode (global setting enforced server-side in Payload access
   control; `/api/v1/sync/batch` returns `423 LOCKED` with a Bahasa Indonesia message).
4. **Final sync:** drain `odoo-outbox` to 0 `pending/in_flight`; resolve or explicitly accept `failed/dead` rows
   (signed off by Finance + Lead).
5. **Reconciliation** report archived (PDF/CSV) + audit-log export with sha256.
6. **Flip system of record:** Odoo becomes authoritative; set Odoo `ir.sequence` next numbers to continue ProyekKas
   numbering; revoke the mirror API key.
7. **CMS read-only** for a retention period agreed with the client; APK either retired or re-pointed (separate
   ADR). Rollback window: until the first business write in Odoo, unfreezing ProyekKas is the rollback.

## Alternatives

| Alternative | Rejected because |
|---|---|
| XML-RPC / JSON-RPC (`/xmlrpc/2`, `/jsonrpc`) | Deprecated in 19, removed in 22 (`addons/rpc/controllers/__init__.py`). |
| Dual write (Payload hook calls Odoo synchronously) | Couples user latency/availability to the shared Odoo pool; partial failures leave the two systems inconsistent. Violates requirements v1.1 §9 (mirror must not slow or fail user actions). |
| CDC/logical replication from Postgres into Odoo tables | Bypasses Odoo ORM (computed fields, constraints, `_inherits`), unsupported, and needs DB-level access across clients in the shared cluster. |
| Nightly CSV import via Odoo UI | Manual, no idempotency guarantee, no per-row errors, no audit trail. |
| Build ProyekKas inside Odoo now | Explicitly out per user decision #1. |
| Custom Odoo addon endpoint now (`/api/drms/...`) | Needs Odoo development before the migration is even confirmed; kept as F7 option for unmappable data. |

## Consequences

- (+) Cutover becomes "freeze → drain → flip"; idempotent upserts allow re-running the back-fill at any time.
- (+) Odoo-friendly schema from F1: every mirrored row has a UUID, `odoo_id`, `odoo_xmlid`; money in integer
  rupiah; timestamps UTC.
- (−) Significant data has no CE target (request header, approvals/signatures, geofence data, stage weights, RAB).
  Without the F7 addon the Odoo copy is **partial**; this must be stated to the client (Q-27).
- (−) API key rotation every ≤ 90 days is a recurring operational task (calendar + alert 15 days before expiry).
- (−) Odoo constraints (attendance overlap, required `model_id` for vehicles) will reject some rows; reconciliation
  and a manual fix loop are needed.

## Security implications

- **Least privilege:** dedicated non-admin user; JSON-2 keys cannot be model-scoped, so ACL/record rules of the
  user are the only boundary → QA test in F7: the key cannot read `res.users`, cannot call `ir.model.data` CRUD,
  cannot access another company.
- **Key handling:** secret only in server env/Docker secret; masked in logs; rotation ≤ 90 days (enforced by
  Odoo); revoke immediately on suspicion (`res.users.apikeys.revoke` or UI).
- **DB isolation:** calls go through Traefik → DB chosen by hostname; worker never sets `X-Sh-Odoo-Db` itself.
  ProyekKas DBs not owned by the Odoo role (otherwise Odoo's `list_dbs` would see them and they match `dbfilter`).
- **PII minimisation:** selfies, face reference photos, and GPS of attendance are mirrored only if the client
  confirms Odoo attendance use (Q-27, Q-33); default = not mirrored.
- **Integrity:** the outbox is in the same transaction → no "ghost" mirror writes for rolled-back business changes.
- Licence: Odoo CE LGPL-3; no OCA code used (ADR 0003 of the platform).

## Rollback

Mirror is additive and asynchronous: disable the worker (feature flag `ODOO_MIRROR_ENABLED=false`), revoke the API
key, optionally archive the `pk_*` records in Odoo (`action_archive`/`active=False` via JSON-2) or drop the
`drms_staging`/`drms_prod` Odoo DB via the control plane. ProyekKas keeps working unchanged; `odoo-outbox` rows
can be truncated after export.

## Proposed CLAUDE.md changes (need user approval; the ADR author does not edit)

None for the platform `CLAUDE.md`. Suggested addition to the future ProyekKas project docs: "ProyekKas databases
must not be owned by the Odoo Postgres role."

## Revisi 2026-09-27 (ADR 0016)

*Status of this revision: paper only (F7 is after go-live); nothing is built now.*

- **Company mapping:** each ProyekKas PT (`companies`) maps to one **`res.company`** in the single client DB
  (`drms_prod` / `drms_staging`, §7 unchanged — still one Odoo DB for the client). XMLID
  `__import__.pk_companies_<uuid_hex>` like every other mirrored row (§2).
- **Per-PT records** (employees, partners from clients/vendors, projects/analytic accounts, cost centers, vehicles,
  expense lines, attendances, journals of cash accounts) are sent with the Odoo `company_id` of their PT; shared
  masters (`banks`, `uoms`) are sent **without** company (shared in Odoo). A person with two employee rows (ADR 0016
  D1) becomes two `hr.employee` records (one per company) linked to the same partner/user only if the client wants
  Odoo users (UNVERIFIED: Odoo 19 multi-company rules for `hr.employee`/`hr.expense` — verify in F7 on
  `drms_staging`).
- **Technical user** `svc_proyekkas_mirror` needs access to all mirrored companies (`company_ids`); still no
  `base.group_system`.
- **Accounting mirroring** stays deferred (§6) and, when enabled, is per company (COA per PT, Q-53).
- **Mapping table:** add row `companies` → `res.company` (name, `shortCode` → XMLID only, logo → `logo`,
  address/phone → partner of the company); `company-memberships` → not mirrored (identity/authorisation is ProyekKas +
  Keycloak).
