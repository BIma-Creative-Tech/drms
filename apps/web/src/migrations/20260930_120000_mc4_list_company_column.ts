import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * MC4 (ADR 0016 §11, MC2-4 follow-up): users who saved list-column preferences BEFORE the PT column
 * existed (Payload keeps a saved column list over `defaultColumns`) never saw the `PT` column. DATA
 * ONLY, idempotent, run as <prefix>_owner: for every `payload_preferences` row of a list view
 * (`collection-<slug>`) of a collection with a `company` column whose saved `columns` do NOT mention
 * `company` at all, prepend `{ accessor: 'company', active: true }`. A saved list that already names
 * `company` (shown or deliberately hidden) is left alone. Slugs = `admin/company-list.ts`
 * `withCompanyListUi` set (unit test tests/unit/mc4-code.test.ts pins both lists together).
 */
export const LIST_COMPANY_SLUGS = [
  'approval-rules', 'approvals', 'attendance-corrections', 'attendances', 'audit-logs', 'budget-addenda', 'budget-lines',
  'cash-accounts', 'cash-entries', 'cash-in-sources', 'clients', 'company-memberships', 'cost-centers', 'document-sequences',
  'employee-bank-accounts', 'employees', 'expense-categories', 'expense-line-snapshots', 'expense-requests', 'notifications',
  'period-closings', 'progress-reports', 'project-stages', 'projects', 'receipt-flags', 'receipts', 'settlements',
  'stage-templates', 'team-assignments', 'transfers', 'vehicles', 'vendors', 'work-schedules',
] as const

export async function up({ db }: MigrateUpArgs): Promise<void> {
  const keys = sql.join(
    LIST_COMPANY_SLUGS.map((s) => sql`${`collection-${s}`}`),
    sql`, `,
  )
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;`)
  await db.execute(sql`
    UPDATE "payload_preferences" p
       SET "value" = jsonb_set(p."value", '{columns}', jsonb_build_array(jsonb_build_object('accessor', 'company', 'active', true)) || (p."value" -> 'columns'))
     WHERE p."key" IN (${keys})
       AND jsonb_typeof(p."value" -> 'columns') = 'array'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p."value" -> 'columns') c WHERE c ->> 'accessor' = 'company');`)
}

/** Preferences only: nothing to undo (a user can hide the column again in the list view). */
export async function down(_args: MigrateDownArgs): Promise<void> {}
