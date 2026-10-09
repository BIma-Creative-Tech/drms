import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Row action column "Aksi" (src/admin/row-actions.ts): users who saved list-column preferences BEFORE
 * the column existed (Payload keeps a saved column list over `defaultColumns`) would never see it.
 * DATA ONLY, idempotent, run as <prefix>_owner: for every `payload_preferences` row of a list view
 * (`collection-<slug>`, the only preference rows with a `columns` array) whose saved `columns` do NOT
 * mention `rowActions` at all, append `{ accessor: 'rowActions', active: true }`. A saved list that
 * already names the column (shown or deliberately hidden) is left alone. Every collection gets the
 * column (`withRowActions` wraps all of them), so no slug list is needed.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
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
       SET "value" = jsonb_set(p."value", '{columns}', (p."value" -> 'columns') || jsonb_build_array(jsonb_build_object('accessor', 'rowActions', 'active', true)))
     WHERE p."key" LIKE 'collection-%'
       AND jsonb_typeof(p."value" -> 'columns') = 'array'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p."value" -> 'columns') c WHERE c ->> 'accessor' = 'rowActions');`)
}

/** Preferences only: nothing to undo (a user can hide the column again in the list view). */
export async function down(_args: MigrateDownArgs): Promise<void> {}
