# ADR 0007 — Document numbering (configurable per document type, client format by default)

- **Status:** accepted (user, GATE F0 2026-09-23); revised 2026-09-23 after the F1 spike (user-approved) the F1 foundation and F2a (see Revision history)
- **Date:** 2026-09-23
- **Author:** Analyst/Architect — Phase 0
- **Related:** requirements v1.0 §1 finding #8, §6 (company settings "format penomoran"), §7 (T1 `PG/YYMM/####`,
  T3 `TRF/…`, T5 `LPJ/…`, T6 `KM/…`, T7 `KK/…`, T11 `LP/…`, T12 `ADD/…`); lead prompt "Temuan tambahan" #4;
  `reference/contoh-form-pengajuan-biaya-drms.jpg` (number `228/PB-DRMS/20/IX/2026`, date 20 September 2026);
  ADR 0001 (transactions), 0006 (audit); `../architecture.md` §10

## Context

- The client's real form uses `228/PB-DRMS/20/IX/2026` = sequence / document code-company code / day /
  Roman month / year (observed in the image; the title line also shows "228-PB DRMS-…" as a free-text
  title prefix).
- Requirements v1.0 proposed `PG/YYMM/####` style per period; lead prompt: client format as default for
  expense requests, v1.0 formats for others; configurable per document type.
- Payload runs each operation in one DB transaction; hooks join it via `req` (`docs/database/transactions.mdx`,
  v3.90.1). The Drizzle transaction handle for raw SQL is reachable internally via
  `payload.db.sessions[await req.transactionID].db` — pattern read in `packages/drizzle/src/utilities/
  getTransaction.ts`, but `getTransaction` is **not exported** from `@payloadcms/drizzle` (`src/index.ts`
  export list) → **internal API, UNVERIFIED as stable**. `payload.db.drizzle` is documented
  (`docs/database/postgres.mdx` L105–107) but is outside the request transaction.
- Unknown: whether "228" resets yearly, monthly, never (client question).

## Decision

1. **Master `document-sequences`** (Admin/Finance editable, audited): `docType` (unique:
   `expense_request`, `transfer`, `settlement`, `cash_in`, `cash_out`, `progress_report`, `budget_addendum`,
   `reversal`), `pattern`, `resetPolicy` (`never|yearly|monthly`), `padding`, `startAt`, `timezone`
   (default from company-settings = `Asia/Makassar`), `active`. Counter state in a separate table
   **`document_sequence_counters`** (`doc_type`, `period_key`, `next_value`) — not editable in admin
   except via an audited "set next value" action (Admin, reason required, only upward).
2. **Tokens**: `{seq}` (padded to `padding`, 0 = no padding), `{DD}`, `{MM}`, `{MM_ROMAN}` (I…XII),
   `{YY}`, `{YYYY}`, `{COMPANY}` (company-settings short code, `DRMS`), `{DOC}` (doc code, e.g. `PB`).
   All date tokens use the **document date** evaluated in the sequence timezone (not server UTC).
   Validation: pattern must contain `{seq}`; if `resetPolicy=yearly` it must contain `{YY}`/`{YYYY}`; if
   `monthly`, also `{MM}`/`{MM_ROMAN}` (otherwise numbers could repeat).
3. **Defaults** (seed):
   | docType | pattern | reset | example |
   |---|---|---|---|
   | expense_request | `{seq}/PB-{COMPANY}/{DD}/{MM_ROMAN}/{YYYY}` | **never** (user 2026-09-23; go-live `startAt` = 229, continuing the paper series; client may still change via Q-17 → config only) | `228/PB-DRMS/20/IX/2026` |
   | transfer | `TRF/{YY}{MM}/{seq}` pad 4 | monthly | `TRF/2609/0001` |
   | settlement (LPJ) | `LPJ/{YY}{MM}/{seq}` pad 4 | monthly | `LPJ/2609/0001` |
   | cash_in | `KM/{YY}{MM}/{seq}` pad 4 | monthly | `KM/2609/0001` |
   | cash_out | `KK/{YY}{MM}/{seq}` pad 4 | monthly | `KK/2609/0001` |
   | progress_report | `LP/{YY}{MM}/{seq}` pad 4 | monthly | `LP/2609/0001` |
   | budget_addendum | `ADD/{YY}{MM}/{seq}` pad 4 | monthly | `ADD/2609/0001` |
   `period_key` = `ALL` / `YYYY` / `YYYY-MM` according to reset policy, computed from document date in TZ.
   Go-live: Admin sets `expense_request` next value to continue the client's paper series (e.g. 229).
4. **When allocated**: at the transition that makes the document official — expense request at
   `submit` (Draft → Menunggu Approval), transfer at posting, LPJ at submit, cash entries at posting,
   progress report at create, addendum at submit. Drafts (incl. offline APK drafts) have **no number**,
   only an internal id + `clientUuid`. Resubmission after rejection = new document, new number, with
   `resubmitOf` reference (US-06).
5. **Concurrency-safe allocation** (inside the business transaction):
   ```sql
   -- pseudo-config, not final
   INSERT INTO document_sequence_counters (doc_type, period_key, next_value)
     VALUES ($1, $2, $startAt) ON CONFLICT (doc_type, period_key) DO NOTHING;
   UPDATE document_sequence_counters SET next_value = next_value + 1
     WHERE doc_type = $1 AND period_key = $2 RETURNING next_value - 1 AS allocated;
   ```
   The `UPDATE` takes a row lock held until commit → concurrent submits serialise on that row; rollback
   returns the value (no gap). **Backstop**: `UNIQUE (doc_no)` per document table (+ partial unique on
   `(doc_type, period_key, seq)` in counters) → a duplicate can never be committed; on unique violation
   the service retries once.
   Execution handle: preferred = the request transaction via the internal Drizzle session —
   **verified in the F1 spike** (report §d): allocation in a `beforeChange` hook / domain service via
   `payload.db.sessions[await req.transactionID].db` (`apps/web/src/lib/tx.ts`, throws when there is no
   transaction); first number `229/PB-DRMS/23/IX/2026` with pattern `{seq}/PB-{COMPANY}/{DD}/{MM_ROMAN}/{YYYY}`,
   reset `never`, `startAt` 229; a failed create after allocation rolls back and **burns no number**;
   50 parallel creates → unique and gapless (also with 10 forced failures); pool 10 × 50 concurrent → no
   deadlock (serialised on the counter row). The handle is typed but internal (not an exported helper) →
   **keep the integration test** (Payload pinned; re-run on every upgrade). Fallback (not needed) = the domain service opens its own transaction with
   `payload.db.beginTransaction()` and passes `req` with that `transactionID` to all Local API calls of the
   transition, and runs the raw SQL on the same session.
   **Implemented (F1 foundation):** `allocateDocNo()` in `apps/web/src/domain/numbering-db.ts` (the SQL above,
   on the request transaction via `getRequestTx`). DB guards in the security migration: trigger
   `pk_counter_monotonic` on `document_sequence_counters` — `next_value` may **only increase** and
   `doc_type`/`period_key` cannot change (SQLSTATE 42501); `DELETE`/`TRUNCATE` rejected by trigger and revoked
   from the app role; `CHECK (next_value > 0)`. **Every allocation writes an audit row** `action =
   'number_issued'` (`field = docNo`, `new_value` = the number) in the same transaction (integration test
   `numbering.int.test.ts` checks the same `tx_id`); the `audit: false` option exists only for the 50-way
   concurrency load test.
   Postgres `SEQUENCE` objects rejected: not transactional (values consumed on rollback → gaps) and one
   sequence per doc type × period would need DDL at runtime.
   **Historical registration (F2a):** `submit(req, id, { historical: { seq, requestDate } })`
   (`src/domain/expense/workflow.ts`) registers a paper document with its original number and date: the
   number is formatted from the `expense_request` pattern (`formatDocNo`) **without** calling
   `allocateDocNo()`, so the live counter is not touched; a `number_issued` audit row with reason "nomor
   historis (dokumen kertas), counter tidak berubah" is written. INTERNAL only (tests / data migration),
   never reachable over HTTP. The form fixture (`src/seed/form-fixture.ts`, not loaded by the live seed)
   registers `228/PB-DRMS/20/IX/2026` this way; go-live continues at 229. Resubmitting after a withdraw keeps
   the number and the request date (Q-04); cash reversals take KM/KK numbers (ADR 0005 "As implemented").
6. **Gap policy**: numbers are gapless for committed documents under normal operation. Cancelled
   documents **keep** their number (status Dibatalkan) — numbers are never reused or deleted. If a gap
   is ever detected (e.g. manual "set next value" upward, restore), the admin action records reason; a
   report lists gaps per period for auditors.
7. **Display & PDF** use `docNo`; APIs expose `docNo` read-only; `docNo` is immutable after allocation
   (field access `update: false` + trigger in Class B tables per ADR 0006).

## Alternatives

| Alternative | Rejected because |
|---|---|
| Odoo `ir.sequence` (original prompt) | Outside Odoo (ADR 0001) |
| Postgres SEQUENCE per type | Gaps on rollback; runtime DDL per period |
| `MAX(seq)+1` query | Race condition without table lock; slow |
| Number at draft creation | Offline drafts cannot get numbers; abandoned drafts create gaps |
| Advisory locks | Equivalent to row lock but no persistent state; row counter is simpler |

## Consequences

- Row lock serialises submissions of the same type/period — negligible at DRMS volume.
- Timezone change in settings affects only future numbers (documented; audited).
- Relies on an internal Payload/Drizzle detail (verified at 3.90.1; guarded by the integration test on upgrades).

## Security implications

- Only Admin/Finance can change patterns; "set next value" only upward, reason required, audited.
- `docNo` immutable after allocation (prevents re-labelling evidence).

## Rollback

Patterns are data → revert via admin (audited). Algorithm change = code + migration; issued numbers are
never rewritten.

## Proposed CLAUDE.md changes (need user approval; author does not edit)

None.

## Revision history

- **2026-09-23 (F0 gate):** accepted by user.
- **2026-09-23 (F1 spike, user-approved):** Payload 3.90.1 = GO (user). §5 preferred path verified:
  allocation inside the request transaction via `payload.db.sessions[await req.transactionID].db`
  (`src/lib/tx.ts`); 50 parallel → unique and gapless; rollback burns no number. Keep the integration test
  (pinned Payload; re-run on upgrade). Gap policy (§6) unchanged.
- **2026-09-23 (F1 foundation):** §5 implementation recorded (`src/domain/numbering-db.ts`): counter trigger
  lets `next_value` only increase (no DELETE/TRUNCATE, key columns immutable); every allocation writes a
  `number_issued` audit row in the same transaction. Status stays accepted.
- **2026-09-23 (F2a):** §5 historical registration option recorded (`submit(…, { historical })`, formats the
  number without touching the live counter, audited `number_issued`; form fixture `228/PB-DRMS/20/IX/2026`);
  withdraw → resubmit keeps number and date; reversals numbered KM/KK (the `reversal` doc type is unused).
  Verified against `develop` `c8c1af6`. Status stays accepted.
- **2026-09-26 (S3b, E11):** go-live cut-over implemented by the data import (`apps/web/src/import/run.ts`):
  `expense_request.startAt` = the workbook's `nomor_pb_mulai` (default 229); an existing counter below it is raised
  (upward only, audited `update` field `nextValue` with the import reason), a counter already beyond it is left
  unchanged (warning). Runbook `runbooks/import-data-golive.md`. Status stays accepted.
