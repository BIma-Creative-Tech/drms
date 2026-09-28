import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * MC1-5 (ADR 0016 §4, ADR 0007 revision), hand-written, run as <prefix>_owner: numbering counters per
 * PT. `document_sequence_counters` gets `company_id` (existing counters → company #1 DRMS, so the
 * paper series continues: PB 229…), primary key `(company_id, doc_type, period_key)`, and the
 * monotonic guard also freezes the company. `{COMPANY}` = the document PT's short code (app code).
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

    ALTER TABLE document_sequence_counters ADD COLUMN company_id integer REFERENCES companies(id);
    UPDATE document_sequence_counters SET company_id = (SELECT min(id) FROM companies) WHERE company_id IS NULL;
    ALTER TABLE document_sequence_counters ALTER COLUMN company_id SET NOT NULL;
    ALTER TABLE document_sequence_counters DROP CONSTRAINT document_sequence_counters_pkey;
    ALTER TABLE document_sequence_counters ADD PRIMARY KEY (company_id, doc_type, period_key);

    CREATE OR REPLACE FUNCTION pk_counter_monotonic() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.next_value < OLD.next_value OR NEW.doc_type <> OLD.doc_type OR NEW.period_key <> OLD.period_key
         OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
        RAISE EXCEPTION 'document_sequence_counters: next_value may only increase' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION pk_counter_monotonic() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.next_value < OLD.next_value OR NEW.doc_type <> OLD.doc_type OR NEW.period_key <> OLD.period_key THEN
        RAISE EXCEPTION 'document_sequence_counters: next_value may only increase' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;
    ALTER TABLE document_sequence_counters DROP CONSTRAINT document_sequence_counters_pkey;
    -- pre-go-live rollback: counters of other PTs are dropped (no DELETE trigger bypass needed: owner)
    ALTER TABLE document_sequence_counters DISABLE TRIGGER USER;
    DELETE FROM document_sequence_counters WHERE company_id <> (SELECT min(id) FROM companies);
    ALTER TABLE document_sequence_counters ENABLE TRIGGER USER;
    ALTER TABLE document_sequence_counters ADD PRIMARY KEY (doc_type, period_key);
    ALTER TABLE document_sequence_counters DROP COLUMN company_id;
  `)
}
