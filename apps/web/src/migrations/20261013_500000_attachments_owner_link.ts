import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * DATA ONLY, hand-written, idempotent, run as <prefix>_owner.
 *
 * Prod 2026-10-12 (PB 230/PB-DRMS): "Lampiran umum" (`media-attachments` in the expense-request
 * relation `attachments`) were never owner-linked, so the deciders could not open them. The code now
 * links them at submit (`claimAttachments`); this backfills the files of requests that were ALREADY
 * submitted (approval cycle > 0) with the same rule:
 * - the file is referenced by exactly ONE expense request and has no owner link yet (not a tombstone),
 * - it was uploaded by that request's creator or by the signer of its "Diajukan Oleh".
 * The owner columns are immutable once set (DB trigger), so a linked file is never moved; the
 * `owner_company` follows from the trigger `pk_media_owner_company`. Audited: one `update` row per
 * linked file (doc type `media_attachments`, field `owner`, source `system`). Count → migrate log.
 * Drafts are left alone (linked at their submit). Down: no-op (the link is what the code writes too).
 */
const NAME = '20261013_500000_attachments_owner_link'
const REASON = `Lampiran umum pengajuan yang sudah diajukan ditautkan ke pengajuannya (bug 2026-10-12, migrasi ${NAME})`

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;`)

  const linked = (await db.execute(sql`
    WITH refs AS (
      SELECT r.media_attachments_id AS mid, min(r.parent_id) AS rid, count(DISTINCT r.parent_id) AS n
        FROM expense_requests_rels r
       WHERE r.path = 'attachments' AND r.media_attachments_id IS NOT NULL
       GROUP BY r.media_attachments_id
    ), todo AS (
      SELECT m.id, f.rid, er.company_id
        FROM media_attachments m
        JOIN refs f ON f.mid = m.id AND f.n = 1
        JOIN expense_requests er ON er.id = f.rid
       WHERE m.owner_doc_id IS NULL
         AND er.approval_cycle > 0
         AND (m.uploaded_by_id = er.created_by_id
              OR EXISTS (SELECT 1 FROM approvals a
                          WHERE a.doc_type = 'expense_request' AND a.request_id = er.id
                            AND a.position = 'diajukan' AND a.actor_id = m.uploaded_by_id))
    ), moved AS (
      UPDATE media_attachments m
         SET owner_doc_type = 'expense_request', owner_doc_id = t.rid::text, updated_at = now()
        FROM todo t
       WHERE m.id = t.id
      RETURNING m.id, t.rid, t.company_id
    ), logged AS (
      INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, action, field, old_value, new_value, reason, source, company_id)
      SELECT gen_random_uuid()::text, txid_current(), 'media_attachments', x.id::text, 'update', 'owner',
             jsonb_build_object('v', NULL), jsonb_build_object('v', jsonb_build_object('docType', 'expense_request', 'docId', x.rid::text)),
             ${REASON}, 'system', x.company_id
        FROM moved x
      RETURNING 1
    )
    SELECT m.id, m.rid FROM moved m, (SELECT count(*) FROM logged) l`)) as unknown as { rows: Array<{ id: number; rid: number }> }

  payload?.logger?.info?.({
    msg: `${NAME}: attachments linked to their expense request`,
    linked: linked.rows.map((r) => `media#${r.id}→request#${r.rid}`),
  })
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  // owner links are immutable (DB trigger) and are exactly what the code writes at submit
}
