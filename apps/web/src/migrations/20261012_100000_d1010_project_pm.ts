import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * DRMS 10/10 #5: Project Manager mandatory (`projects.pm`, `required` + validation in Projects.ts).
 * Hand-written (run as <prefix>_owner) because the DB part is CONDITIONAL so a deploy never fails:
 * - no project without a PM → `pm_id` NOT NULL, and the FK goes from ON DELETE SET NULL (contradicts
 *   NOT NULL; users are never deleted anyway, Users.access.delete = deny) to ON DELETE RESTRICT;
 * - otherwise (legacy rows without a PM) → nothing changes, one log line with the count. The app
 *   still refuses new projects without a PM; the dashboard tile "Project tanpa PM" lists the legacy
 *   rows. A follow-up migration can tighten the column once they are fixed.
 * The .json snapshot carries `notNull: true` (Payload's schema of a required relationship).
 */
const NAME = '20261012_100000_d1010_project_pm'

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  const res = (await db.execute(sql`SELECT count(*)::int AS n FROM projects WHERE pm_id IS NULL`)) as { rows: Array<{ n: number }> }
  const missing = Number(res.rows[0]?.n ?? 0)
  if (missing > 0) {
    payload?.logger?.warn?.({ msg: `${NAME}: ${missing} project(s) without a PM — pm_id NOT NULL / FK RESTRICT skipped (fill the PM, see dashboard "Project tanpa PM")`, projectsWithoutPm: missing })
    return
  }
  await db.execute(sql`
    ALTER TABLE "projects" ALTER COLUMN "pm_id" SET NOT NULL;
    ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_pm_id_users_id_fk";
    ALTER TABLE "projects" ADD CONSTRAINT "projects_pm_id_users_id_fk" FOREIGN KEY ("pm_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  `)
  payload?.logger?.info?.({ msg: `${NAME}: projects.pm_id NOT NULL, FK ON DELETE RESTRICT` })
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "projects" ALTER COLUMN "pm_id" DROP NOT NULL;
    ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_pm_id_users_id_fk";
    ALTER TABLE "projects" ADD CONSTRAINT "projects_pm_id_users_id_fk" FOREIGN KEY ("pm_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  `)
}
