import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * DRMS 13/10 A2 (ADR 0023 amendment 2026-10-13) — DB guard, hand-written, run as <prefix>_owner after
 * 20261013_620000_d1310_onsite: at most ONE head office ("Kantor pusat") per PT (partial unique index; the collection
 * hook gives the friendly field error first). A deactivated head office keeps its flag (history); the Admin moves the
 * flag by clearing it on the old site first. No data is changed.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;
    CREATE UNIQUE INDEX sites_one_head_office_per_company ON sites (company_id) WHERE is_head_office;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP INDEX IF EXISTS sites_one_head_office_per_company;`)
}
