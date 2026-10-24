import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0032 (DRMS 24/10, user decision): sites (ADR 0023) are removed from the product; a team assignment is a project
 * or a cost center again. DATA ONLY, hand-written, IDEMPOTENT (a converted row has no site any more), run as
 * <prefix>_owner. Every team assignment whose location is a SITE (any state):
 *
 * - the site sits UNDER projects (`projects.site_id`): the ACTIVE projects of the same PT linked to that site (status not
 *   selesai / arsip / dibatalkan, not soft-deleted), ordered by code — minus the projects the employee already has a
 *   running assignment to (no duplicate row) — become its location: the row itself takes the first project (`project_id`
 *   set, `site_id` cleared: `team_assignments_location_one` holds) and one new row per further project is added with the
 *   same employee, role, start and end date;
 * - no such project and the row still running (no end date, or an end date after the migration time): it is ended
 *   now (`end_date` = migration time, not before its start date) — a second run sees it ended (idempotent);
 * - no such project and the row already ended: left as is (history; a site row is shown as "Site (lama)").
 *
 * Every change is logged: a RAISE NOTICE + payload logger line, and one `audit_logs` row (source `system`,
 * doc_type `team_assignment`, old → new) — `update` for a converted / ended row, `create` for an added row.
 * Down: added rows are deleted, converted rows get their site back (project cleared), ended rows get their old end date
 * back — all from this migration's audit rows.
 */
const NAME = '20261024_200000_d2410_site_assignments'
const REASON = `ADR 0032 (DRMS 24/10): site dihapus dari produk — penugasan site menjadi penugasan project site tersebut, atau diakhiri (migrasi ${NAME})`
/** Project statuses of a closed / finished project (no new assignment; frozen copy of domain/user-onboarding CLOSED_PROJECT). */
const CLOSED = ['selesai', 'arsip', 'dibatalkan']

type SiteRow = {
  id: number
  company_id: number | null
  employee_id: number | null
  site_id: number
  role_in_project: string
  start_date: string | Date | null
  end_date: string | Date | null
  running: boolean
}

export type SiteAssignmentPlan = { kind: 'convert'; projects: number[] } | { kind: 'end' } | { kind: 'keep' }

/**
 * What happens to one site assignment (pure, unit-tested): the matching active projects of its site (already without
 * the employee's own running project assignments) → convert; none → end it when still running, else keep it.
 */
export function planSiteAssignment(row: { running: boolean }, projects: readonly number[]): SiteAssignmentPlan {
  if (projects.length > 0) return { kind: 'convert', projects: [...projects] }
  return row.running ? { kind: 'end' } : { kind: 'keep' }
}

const iso = (v: string | Date | null) => (v === null ? null : new Date(v).toISOString())

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
    SELECT t.id, t.company_id, t.employee_id, t.site_id, t.role_in_project::text AS role_in_project, t.start_date, t.end_date,
           (t.end_date IS NULL OR t.end_date > greatest(now(), coalesce(t.start_date, now()))) AS running
      FROM team_assignments t
     WHERE t.site_id IS NOT NULL
     ORDER BY t.id`)) as unknown as { rows: SiteRow[] }

  const log: Array<Record<string, unknown>> = []
  for (const r of rows.rows) {
    const projects = (await db.execute(sql`
      SELECT p.id
        FROM projects p
       WHERE p.site_id = ${r.site_id}
         AND p.company_id IS NOT DISTINCT FROM ${r.company_id}::int
         AND coalesce(p.status::text, '') NOT IN (${sql.join(
           CLOSED.map((s) => sql`${s}`),
           sql`, `,
         )})
         AND p.is_deleted IS NOT TRUE
         AND NOT EXISTS (
           SELECT 1 FROM team_assignments o
            WHERE o.employee_id = ${r.employee_id}::int AND o.project_id = p.id AND o.id <> ${r.id}
              AND (o.end_date IS NULL OR (o.end_date AT TIME ZONE 'Asia/Makassar')::date >= (now() AT TIME ZONE 'Asia/Makassar')::date))
       ORDER BY p.code, p.id`)) as unknown as { rows: Array<{ id: number }> }
    const plan = planSiteAssignment(r, projects.rows.map((p) => Number(p.id)))
    const old = { siteId: r.site_id, projectId: null, endDate: iso(r.end_date), migration: NAME }
    if (plan.kind === 'convert') {
      const [first, ...more] = plan.projects
      await db.execute(sql`UPDATE team_assignments SET project_id = ${first}, site_id = NULL, updated_at = now() WHERE id = ${r.id}`)
      await db.execute(sql`
        INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, action, field, old_value, new_value, reason, source, company_id)
        VALUES (gen_random_uuid()::text, txid_current(), 'team_assignment', ${String(r.id)}, 'update', 'project',
                ${JSON.stringify({ v: old })}::jsonb, ${JSON.stringify({ v: { siteId: null, projectId: first, endDate: iso(r.end_date), migration: NAME } })}::jsonb,
                ${REASON}, 'system', ${r.company_id}::int)`)
      const added: number[] = []
      for (const p of more) {
        const ins = (await db.execute(sql`
          INSERT INTO team_assignments (company_id, employee_id, project_id, role_in_project, start_date, end_date, updated_at, created_at)
          VALUES (${r.company_id}::int, ${r.employee_id}::int, ${p}, ${r.role_in_project}::enum_team_assignments_role_in_project,
                  ${iso(r.start_date)}::timestamptz, ${iso(r.end_date)}::timestamptz, now(), now())
          RETURNING id`)) as unknown as { rows: Array<{ id: number }> }
        const id = Number(ins.rows[0]!.id)
        added.push(id)
        await db.execute(sql`
          INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, action, field, old_value, new_value, reason, source, company_id)
          VALUES (gen_random_uuid()::text, txid_current(), 'team_assignment', ${String(id)}, 'create', 'project', NULL,
                  ${JSON.stringify({ v: { fromAssignment: r.id, siteId: r.site_id, projectId: p, employeeId: r.employee_id, roleInProject: r.role_in_project, startDate: iso(r.start_date), endDate: iso(r.end_date), migration: NAME } })}::jsonb,
                  ${REASON}, 'system', ${r.company_id}::int)`)
      }
      log.push({ assignment: r.id, employee: r.employee_id, site: r.site_id, action: 'convert', project: first, added: more.map((p, i) => ({ project: p, assignment: added[i] })) })
    } else if (plan.kind === 'end') {
      const ended = (await db.execute(sql`
        UPDATE team_assignments SET end_date = greatest(now(), coalesce(start_date, now())), updated_at = now() WHERE id = ${r.id}
        RETURNING end_date`)) as unknown as { rows: Array<{ end_date: string | Date }> }
      const endDate = iso(ended.rows[0]!.end_date)
      await db.execute(sql`
        INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, action, field, old_value, new_value, reason, source, company_id)
        VALUES (gen_random_uuid()::text, txid_current(), 'team_assignment', ${String(r.id)}, 'update', 'endDate',
                ${JSON.stringify({ v: old })}::jsonb, ${JSON.stringify({ v: { siteId: r.site_id, projectId: null, endDate, migration: NAME } })}::jsonb,
                ${REASON}, 'system', ${r.company_id}::int)`)
      log.push({ assignment: r.id, employee: r.employee_id, site: r.site_id, action: 'end', endDate })
    } else {
      log.push({ assignment: r.id, employee: r.employee_id, site: r.site_id, action: 'keep (sudah berakhir, tanpa project site)' })
    }
  }
  for (const l of log) {
    payload?.logger?.info?.({ msg: `${NAME}: site assignment`, ...l })
    // RAISE NOTICE as well (psql / migrate output): ids, dates and fixed words only — quotes stripped all the same
    const line = `${NAME}: ${JSON.stringify(l)}`.replace(/'/g, '')
    await db.execute(sql.raw(`DO $pk$ BEGIN RAISE NOTICE '%', '${line}'; END $pk$;`))
  }
  payload?.logger?.info?.({
    msg: `${NAME}: done (ADR 0032)`,
    siteAssignments: rows.rows.length,
    converted: log.filter((l) => l.action === 'convert').length,
    ended: log.filter((l) => l.action === 'end').length,
    kept: log.filter((l) => String(l.action).startsWith('keep')).length,
  })
}

export async function down({ db, payload }: MigrateDownArgs): Promise<void> {
  const r = (await db.execute(sql`
    WITH mine AS (
      SELECT a.doc_id::int AS id, a.action::text AS action, a.field, a.old_value -> 'v' AS old
        FROM audit_logs a
       WHERE a.doc_type = 'team_assignment' AND coalesce(a.new_value -> 'v' ->> 'migration', '') = ${NAME}
    ), del AS (
      DELETE FROM team_assignments t USING mine m WHERE m.action = 'create' AND t.id = m.id RETURNING t.id
    ), back AS (
      UPDATE team_assignments t SET site_id = (m.old ->> 'siteId')::int, project_id = NULL, updated_at = now()
        FROM mine m WHERE m.action = 'update' AND m.field = 'project' AND t.id = m.id RETURNING t.id
    ), reopened AS (
      UPDATE team_assignments t SET end_date = (m.old ->> 'endDate')::timestamptz, updated_at = now()
        FROM mine m WHERE m.action = 'update' AND m.field = 'endDate' AND t.id = m.id RETURNING t.id
    )
    SELECT (SELECT count(*) FROM del)::int AS deleted, (SELECT count(*) FROM back)::int AS restored, (SELECT count(*) FROM reopened)::int AS reopened`)) as unknown as {
    rows: Array<{ deleted: number; restored: number; reopened: number }>
  }
  payload?.logger?.info?.({ msg: `${NAME} down`, ...r.rows[0] })
}
