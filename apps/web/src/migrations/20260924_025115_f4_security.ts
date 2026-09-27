import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * F4 offline sync store (ADR 0010 "Storage": replay results in a small system table, retention
 * 30 days), run as <prefix>_owner. ADDITIVE / staging-safe: one new table + one new trigger.
 *
 * - `sync_receipts`: one row per processed sync item (`client_uuid` = idempotency key of the APK
 *   queue item). A replayed item returns the stored `result` as `duplicate` without re-applying.
 *   Also keeps the device clock facts of the item (`device_time`, `elapsed_ms`, `offline`,
 *   `estimated_time`, `time_trust`) as COMPARISON values; `received_at` (DB clock) is authoritative.
 *   Not a Payload collection (like `idempotency_keys`): written only by the sync service.
 *   App role: SELECT, INSERT, DELETE (purge of expired rows); no UPDATE (a result never changes).
 * - receipts.client_uuid is immutable once set.
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

    CREATE TABLE sync_receipts (
      client_uuid  uuid        PRIMARY KEY,
      user_id      integer     NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
      device_id    text,
      batch_id     uuid        NOT NULL,
      item_type    text        NOT NULL,
      status       text        NOT NULL CHECK (status IN ('applied', 'rejected', 'conflict')),
      server_id    text,
      rev          integer,
      offline      boolean     NOT NULL,
      device_time  timestamptz,
      elapsed_ms   bigint,
      estimated_time timestamptz,
      time_trust   text        NOT NULL CHECK (time_trust IN ('server', 'estimated', 'device_only')),
      result       jsonb       NOT NULL,
      received_at  timestamptz NOT NULL DEFAULT now(),
      expires_at   timestamptz NOT NULL DEFAULT now() + interval '30 days'
    );
    CREATE INDEX sync_receipts_user_idx ON sync_receipts (user_id, received_at);
    CREATE INDEX sync_receipts_expires_idx ON sync_receipts (expires_at);

    CREATE TRIGGER receipts_client_uuid_protect BEFORE UPDATE ON receipts
      FOR EACH ROW EXECUTE FUNCTION pk_protect_columns('client_uuid');

    DO $pk$
    DECLARE
      app_role text := regexp_replace(current_user, '_owner$', '_app');
    BEGIN
      EXECUTE format('REVOKE UPDATE, TRUNCATE ON sync_receipts FROM %I', app_role);
      EXECUTE format('GRANT SELECT, INSERT, DELETE ON sync_receipts TO %I', app_role);
    END
    $pk$;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TRIGGER IF EXISTS receipts_client_uuid_protect ON receipts;
    DROP TABLE IF EXISTS sync_receipts;
  `)
}
