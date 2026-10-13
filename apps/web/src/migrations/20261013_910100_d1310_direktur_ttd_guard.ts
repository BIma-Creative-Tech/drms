import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0025 Tanda tangan Direktur definitif per PT — DB guards (hand-written, run as <prefix>_owner AFTER
 * 20261013_910000_d1310_direktur_ttd, which adds the enum value `company`: a new enum value may not be used in
 * the transaction that adds it). Defence in depth behind domain/direktur-signature.ts:
 *
 * 1. approvals: `signature_source = company` ⇔ a `represented_direktur_name` snapshot (+ a signature), only on a
 *    decision position (diketahui / approval: acknowledged / approved / rejected). Trigger
 *    `approvals_signature_company` (BEFORE INSERT): such a row is written only by a DESIGNATED REPRESENTATIVE of the
 *    row's PT (`companies_rels` path `direktur.representatives`) who holds the Direktur role there (active account +
 *    membership), with the PT's CURRENT Direktur signature and name/title — nobody signs as the PT's Direktur
 *    otherwise, whatever the application does. Rows stay append-only (existing Class A triggers).
 * 2. media_signatures: owner link (`owner_doc_type` / `owner_doc_id`, set to `company_direktur` / <PT id> when the PT
 *    is saved) immutable once set — a PT signature never moves to another PT or back to "personal".
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

    ALTER TABLE approvals
      ADD CONSTRAINT approvals_represented_direktur CHECK (
        (coalesce(signature_source::text, '') = 'company') = (represented_direktur_name IS NOT NULL)
        AND (represented_direktur_title IS NULL OR represented_direktur_name IS NOT NULL)
        AND (coalesce(signature_source::text, '') <> 'company' OR (
          signature_id IS NOT NULL AND position::text IN ('diketahui', 'approval') AND decision::text IN ('acknowledged', 'approved', 'rejected')))
      );

    CREATE OR REPLACE FUNCTION pk_approvals_signature_company() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF coalesce(NEW.signature_source::text, '') <> 'company' THEN
        RETURN NEW;
      END IF;
      IF NOT coalesce(EXISTS (
           SELECT 1 FROM companies c
            WHERE c.id = NEW.company_id
              AND c.direktur_signature_id = NEW.signature_id
              AND btrim(c.direktur_name) = NEW.represented_direktur_name
              AND nullif(btrim(coalesce(c.direktur_title, '')), '') IS NOT DISTINCT FROM NEW.represented_direktur_title
              AND EXISTS (SELECT 1 FROM companies_rels r
                           WHERE r.parent_id = c.id AND r.path = 'direktur.representatives' AND r.users_id = NEW.actor_id)
              AND EXISTS (SELECT 1 FROM company_memberships m JOIN users u ON u.id = m.user_id
                            JOIN company_memberships_roles mr ON mr.parent_id = m.id
                           WHERE m.company_id = c.id AND m.user_id = NEW.actor_id AND coalesce(m.active, true)
                             AND coalesce(u.active, true) AND mr.value::text = 'pk-owner')), false) THEN
        RAISE EXCEPTION 'approvals: only a designated representative (Direktur role) of the PT signs with the PT''s current definitive Direktur signature (ADR 0025)'
          USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER approvals_signature_company BEFORE INSERT ON approvals FOR EACH ROW EXECUTE FUNCTION pk_approvals_signature_company();

    CREATE TRIGGER media_signatures_owner_protect BEFORE UPDATE ON media_signatures
      FOR EACH ROW EXECUTE FUNCTION pk_protect_columns('owner_doc_type', 'owner_doc_id');
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TRIGGER IF EXISTS media_signatures_owner_protect ON media_signatures;
    DROP TRIGGER IF EXISTS approvals_signature_company ON approvals;
    DROP FUNCTION IF EXISTS pk_approvals_signature_company();
    ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_represented_direktur;
  `)
}
