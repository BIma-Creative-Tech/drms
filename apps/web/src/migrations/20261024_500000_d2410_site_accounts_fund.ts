import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * DRMS 24/10 (user decision after ADR 0032): every project is mapped to a cash account (Pusat Biaya, ADR 0031), so the
 * funds are computed WITHOUT the old site exclusion (ADR 0029 §1 "akun tanpa site"). Hand-written, run as
 * <prefix>_owner, IDEMPOTENT:
 *
 * 1. DATA: every cash account still flagged with a legacy site (`cash_accounts.site_id`, hidden column since ADR 0032)
 *    loses the flag — one `audit_logs` row per account (source `system`, doc_type `cash_account`, field `site`,
 *    old → new) and a RAISE NOTICE line, so nothing hidden keeps the old behaviour.
 * 2. `pk_fund_balance(cid)` (Saldo dana of a PT): every ACTIVE account of the PT (the `a.site_id IS NULL` filter goes).
 *    `pk_fund_available`, `pk_request_fund_available` and the DB backstop `pk_expense_fund_guard` read it.
 * 3. `pk_icl_transfer_guard()` (inter-PT loan movement): the paying account is any ACTIVE account of the paying PT.
 *
 * Both functions are patched from their CURRENT definition (`pg_get_functiondef`, exact text replacement, refused when
 * the text is not found) so later amendments of their bodies are kept.
 * Down: the site flags come back from this migration's audit rows (only where the column is still empty and the site
 * still exists), the two filters are put back.
 */
const NAME = '20261024_500000_d2410_site_accounts_fund'
const REASON = `DRMS 24/10: semua project dipetakan ke akun kas — tanda site lama pada akun kas dihapus, dana dihitung tanpa pengecualian site (migrasi ${NAME})`

/** [function, text with the site filter, text without it] — exact fragments of the 20261015_100200 bodies. */
export const SITE_FILTER_PATCHES: ReadonlyArray<readonly [string, string, string]> = [
  ['pk_fund_balance', 'a.active IS NOT FALSE AND a.site_id IS NULL', 'a.active IS NOT FALSE'],
  ['pk_icl_transfer_guard', 'a.active IS NOT FALSE AND a.site_id IS NULL) THEN', 'a.active IS NOT FALSE) THEN'],
  ['pk_icl_transfer_guard', 'is not an active account without site of PT %', 'is not an active account of PT %'],
]

type Db = MigrateUpArgs['db']

async function functionDef(db: Db, fn: string): Promise<string> {
  const r = (await db.execute(sql`
    SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ${fn}`)) as unknown as { rows: Array<{ def: string }> }
  if (r.rows.length !== 1) throw new Error(`${NAME}: function ${fn} not found exactly once (${r.rows.length})`)
  return r.rows[0]!.def
}

/**
 * Applies the patches of one direction to a definition (pure, unit-tested): `from` → `to` exactly once each; a patch
 * already applied (only `to` present) is skipped (idempotent); neither present → error (the body changed unexpectedly).
 */
export function patchDefinition(fn: string, def: string, direction: 'up' | 'down'): string {
  let out = def
  for (const [name, withSite, without] of SITE_FILTER_PATCHES) {
    if (name !== fn) continue
    const [from, to] = direction === 'up' ? [withSite, without] : [without, withSite]
    if (out.includes(from) && out.split(from).length === 2) {
      out = out.replace(from, to)
      continue
    }
    if (direction === 'up' ? !out.includes(withSite) && out.includes(without) : out.includes(withSite)) continue
    throw new Error(`${NAME}: "${from}" not found exactly once in ${fn}`)
  }
  return out
}

async function patchFunctions(db: Db, direction: 'up' | 'down'): Promise<void> {
  for (const fn of [...new Set(SITE_FILTER_PATCHES.map(([f]) => f))]) {
    const def = await functionDef(db, fn)
    const next = patchDefinition(fn, def, direction)
    if (next !== def) await db.execute(sql.raw(next))
  }
}

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;`)
  const rows = (await db.execute(sql`
    SELECT a.id, a.company_id, a.site_id, a.name FROM cash_accounts a WHERE a.site_id IS NOT NULL ORDER BY a.id`)) as unknown as {
    rows: Array<{ id: number; company_id: number | null; site_id: number; name: string }>
  }
  for (const a of rows.rows) {
    await db.execute(sql`UPDATE cash_accounts SET site_id = NULL, updated_at = now() WHERE id = ${a.id}`)
    await db.execute(sql`
      INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, action, field, old_value, new_value, reason, source, company_id)
      VALUES (gen_random_uuid()::text, txid_current(), 'cash_account', ${String(a.id)}, 'update', 'site',
              ${JSON.stringify({ v: { siteId: Number(a.site_id), migration: NAME } })}::jsonb, ${JSON.stringify({ v: { siteId: null, migration: NAME } })}::jsonb,
              ${REASON}, 'system', ${a.company_id}::int)`)
    const line = `${NAME}: cash account ${Number(a.id)} (PT ${a.company_id ?? '-'}) site ${Number(a.site_id)} -> none`
    payload?.logger?.info?.({ msg: line })
    await db.execute(sql.raw(`DO $pk$ BEGIN RAISE NOTICE '%', '${line.replace(/'/g, '')}'; END $pk$;`))
  }
  await patchFunctions(db, 'up')
  payload?.logger?.info?.({ msg: `${NAME}: done`, cashAccountsCleared: rows.rows.length })
}

export async function down({ db, payload }: MigrateDownArgs): Promise<void> {
  await patchFunctions(db, 'down')
  const r = (await db.execute(sql`
    WITH mine AS (
      SELECT DISTINCT ON (a.doc_id) a.doc_id::int AS id, (a.old_value -> 'v' ->> 'siteId')::int AS site_id
        FROM audit_logs a
       WHERE a.doc_type = 'cash_account' AND a.field = 'site' AND coalesce(a.new_value -> 'v' ->> 'migration', '') = ${NAME}
       ORDER BY a.doc_id, a.id DESC
    ), back AS (
      UPDATE cash_accounts c SET site_id = m.site_id, updated_at = now()
        FROM mine m
       WHERE c.id = m.id AND c.site_id IS NULL AND EXISTS (SELECT 1 FROM sites s WHERE s.id = m.site_id)
      RETURNING c.id
    )
    SELECT count(*)::int AS restored FROM back`)) as unknown as { rows: Array<{ restored: number }> }
  payload?.logger?.info?.({ msg: `${NAME} down`, ...r.rows[0] })
}
