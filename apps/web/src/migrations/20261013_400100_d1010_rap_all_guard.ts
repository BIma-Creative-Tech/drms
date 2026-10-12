import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * DRMS 10/10 D4, owner decision 2026-10-11 "RAP wajib untuk semua proyek yang punya RAB" — hand-written, run as
 * <prefix>_owner after 20261013_400000_d1010_rap_all.
 * 1. `pk_rap_item_guard`: a RAP item WITHOUT stage is allowed only outside konstruksi (konstruksi stages drive the
 *    progress from the daily reports, P3); a set stage still belongs to the item's project. The ledger rule is unchanged.
 *    The project kind stays frozen once RAP items exist (pk_project_kind_guard, P3), so a stage-less item never ends
 *    up in a konstruksi project.
 * 2. Data: existing RAP templates were made for konstruksi (P3) → `project_kind = 'konstruksi'`.
 * 3. Report (no data change): projects that NEED a RAP from now on (RAB > 0 or konstruksi, not archived / finished)
 *    but have no active RAP item — their requests can no longer be SUBMITTED until a PM / Direktur fills the RAP
 *    (requests already submitted stay valid; drafts are blocked at submit). Logged here and shown on the Direktur
 *    dashboard ("Project ber-RAB belum punya RAP"). No RAP is created automatically.
 */
const GUARD_UP = `
    CREATE OR REPLACE FUNCTION pk_rap_item_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.stage_id IS NULL THEN
        IF EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.kind::text = 'konstruksi') THEN
          RAISE EXCEPTION 'rap_items: an item of konstruksi project % needs a stage', NEW.project_id USING ERRCODE = '23514';
        END IF;
      ELSIF NOT EXISTS (SELECT 1 FROM project_stages s WHERE s.id = NEW.stage_id AND s.project_id = NEW.project_id) THEN
        RAISE EXCEPTION 'rap_items: stage % is not a stage of project %', NEW.stage_id, NEW.project_id USING ERRCODE = '23514';
      END IF;
      IF TG_OP = 'INSERT' THEN
        NEW.realised_qty := 0;
        NEW.received_qty := 0;
        NEW.used_qty := 0;
      ELSIF coalesce(current_setting('pk.rap_ledger', true), '') <> 'on'
        AND (NEW.realised_qty IS DISTINCT FROM OLD.realised_qty OR NEW.received_qty IS DISTINCT FROM OLD.received_qty OR NEW.used_qty IS DISTINCT FROM OLD.used_qty) THEN
        RAISE EXCEPTION 'rap_items %: realised / received / used change only through the daily-report ledger', OLD.id USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;`

/** P3 version (20261011_110000_p3_security). */
const GUARD_DOWN = `
    CREATE OR REPLACE FUNCTION pk_rap_item_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM project_stages s WHERE s.id = NEW.stage_id AND s.project_id = NEW.project_id) THEN
        RAISE EXCEPTION 'rap_items: stage % is not a stage of project %', NEW.stage_id, NEW.project_id USING ERRCODE = '23514';
      END IF;
      IF TG_OP = 'INSERT' THEN
        NEW.realised_qty := 0;
        NEW.received_qty := 0;
        NEW.used_qty := 0;
      ELSIF coalesce(current_setting('pk.rap_ledger', true), '') <> 'on'
        AND (NEW.realised_qty IS DISTINCT FROM OLD.realised_qty OR NEW.received_qty IS DISTINCT FROM OLD.received_qty OR NEW.used_qty IS DISTINCT FROM OLD.used_qty) THEN
        RAISE EXCEPTION 'rap_items %: realised / received / used change only through the daily-report ledger', OLD.id USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;`

type MissingRow = { id: number; code: string; name: string; kind: string; budget: string | null; company: string | null }

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  await db.execute(sql.raw(GUARD_UP))
  await db.execute(sql`UPDATE rap_templates SET project_kind = 'konstruksi' WHERE project_kind IS NULL`)
  const r = (await db.execute(sql`
    SELECT p.id, p.code, p.name, p.kind::text AS kind, p.budget::text AS budget, c.short_code AS company
      FROM projects p LEFT JOIN companies c ON c.id = p.company_id
     WHERE (coalesce(p.budget, 0) > 0 OR p.kind::text = 'konstruksi')
       AND coalesce(p.status::text, '') NOT IN ('arsip', 'selesai')
       AND NOT EXISTS (SELECT 1 FROM rap_items i WHERE i.project_id = p.id AND coalesce(i.active, true))
     ORDER BY c.short_code NULLS LAST, p.code`)) as unknown as { rows: MissingRow[] }
  const rows = r.rows
  if (rows.length === 0) {
    payload.logger.info('d1010_rap_all: every project with a RAB already has a RAP')
    return
  }
  payload.logger.warn(
    `d1010_rap_all: ${rows.length} project(s) with a RAB have NO RAP — requests of these projects cannot be submitted until a PM / Direktur fills the RAP (submitted requests stay valid): ` +
      rows.map((x) => `${x.company ?? '?'}/${x.code} "${x.name}" (${x.kind}, RAB ${x.budget ?? '-'})`).join('; '),
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`UPDATE rap_templates SET project_kind = NULL WHERE project_kind = 'konstruksi'`)
  await db.execute(sql.raw(GUARD_DOWN))
}
