-- d1510 PRATINJAU (READ-ONLY) — keputusan owner 2026-10-15, migrasi 20261015_210000_d1510_approval_inflight_trim.
-- Satu SELECT, tidak menulis apa pun. Jalankan dalam transaksi read-only, mis.:
--   docker exec -i postgres psql -U postgres -d pk_drms -X -v ON_ERROR_STOP=1 \
--     -c "BEGIN READ ONLY;" -f - -c "ROLLBACK;" < apps/web/src/reroute/preview-trim.sql
-- Pengajuan berjalan (pending_ack / pending_approval) yang snapshot-nya masih punya level approval Finance yang BELUM
-- diputuskan, dan apa yang dilakukan migrasi:
--   POTONG  = level Finance dibuang (status, level, keputusan tetap) — kasus 1;
--   OWNER   = level Finance yang sedang menunggu menjadi level Owner (atau level berikutnya naik) — kasus 2, Owner diberi notifikasi;
--   SETUJU  = Owner sudah menyetujui, tidak ada level tersisa → "Disetujui" (cek dana ADR 0029 dulu; ditolak → TETAP) — kasus 3;
--   TETAP   = dibiarkan (pengecualian G1, …);
--   LEWAT   = masih "Diketahui" Direktur di bawah aturan default lama — dialihkan dulu oleh 20261015_200000 (alur barunya
--             tanpa Finance; perkiraan: 200000 bisa juga MEMBIARKAN-nya, lihat preview.sql / dry-run).
-- Kolom pm: kasus 4 (alur lama tanpa PM project — tidak dikembalikan ke PM).
-- Cermin SQL dari src/reroute/trim-plan.ts; hasil pasti = dry-run TS (payload run src/reroute/cli.ts -- --dry-run).
-- Batas: syarat G1 Owner baru (pemohon/pembuat, satu orang satu posisi) hanya diperiksa sebagian (kolom owner_aktif).
-- Tes: apps/web/tests/integration/d1510-trim.int.test.ts membandingkan hasil dengan rencana TS.
WITH old_defaults(name) AS (
  VALUES ('Default — Direktur lalu Finance (semua nominal)'), ('Contoh — di atas Rp 10 juta: Direktur lalu Finance (Q-31, nonaktif)')
), cand AS (
  SELECT e.id, e.company_id, e.doc_no, e.status::text AS status, e.current_level::int AS lvl, e.g1_exception, e.approval_snapshot AS snap,
         (SELECT r.name FROM approval_rules r WHERE r.id = e.approval_rule_id) AS rule_name,
         (SELECT count(*) FROM approvals a WHERE a.request_id = e.id AND a.doc_type::text = 'expense_request' AND a.cycle = e.approval_cycle
             AND a.position::text IN ('diketahui', 'approval')) AS decisions,
         (SELECT max(a.level)::int FROM approvals a WHERE a.request_id = e.id AND a.doc_type::text = 'expense_request' AND a.cycle = e.approval_cycle
             AND a.position::text = 'approval' AND a.decision::text = 'approved') AS last_approved,
         CASE WHEN e.status::text = 'pending_ack' THEN 1 ELSE greatest(coalesce(e.current_level, 1)::int, 1) END AS from_lvl,
         (SELECT count(DISTINCT m.user_id) FROM company_memberships m JOIN company_memberships_roles x ON x.parent_id = m.id JOIN users u ON u.id = m.user_id
           WHERE m.company_id = e.company_id AND m.active = true AND u.active = true AND x.value::text = 'pk-principal') AS owner_aktif
    FROM expense_requests e
   WHERE e.status::text IN ('pending_ack', 'pending_approval') AND jsonb_typeof(e.approval_snapshot -> 'steps') = 'array'
), agg AS (
  SELECT c.*, x.roles, x.fin, x.has_owner
    FROM cand c, LATERAL (
      SELECT array_agg(s ->> 'approverRole' ORDER BY (s ->> 'level')::int) AS roles,
             array_agg((s ->> 'level')::int ORDER BY (s ->> 'level')::int) FILTER (WHERE s ->> 'approverRole' = 'pk-finance' AND (s ->> 'level')::int >= c.from_lvl) AS fin,
             coalesce(bool_or(s ->> 'approverRole' = 'pk-principal'), false) AS has_owner
        FROM jsonb_array_elements(c.snap -> 'steps') s) x
   WHERE x.fin IS NOT NULL
), plan AS (
  SELECT a.*,
         ARRAY(SELECT CASE WHEN t.l = a.fin[1] AND NOT a.has_owner THEN 'pk-principal' ELSE t.r END
                 FROM unnest(a.roles) WITH ORDINALITY t(r, l)
                WHERE NOT (t.l = ANY (a.fin)) OR (t.l = a.fin[1] AND NOT a.has_owner)
                ORDER BY t.l) AS new_roles
    FROM agg a
), verdict AS (
  SELECT p.*,
         CASE
           WHEN p.g1_exception IS NOT NULL OR coalesce(p.snap ->> 'selfApproval', '') <> '' THEN 'TETAP'
           WHEN p.status = 'pending_ack' AND p.decisions = 0 AND p.rule_name IN (SELECT name FROM old_defaults)
                AND p.snap ->> 'acknowledge' = 'required' AND p.snap ->> 'acknowledgeBy' = 'role' AND p.snap ->> 'acknowledgeRole' = 'pk-owner'
                AND coalesce(p.snap ->> 'acknowledgeDelegatedTo', '') = '' THEN 'LEWAT'
           WHEN NOT p.has_owner AND p.owner_aktif = 0 THEN 'TETAP'
           WHEN p.status = 'pending_ack' THEN 'POTONG'
           WHEN p.from_lvl <= cardinality(p.new_roles) THEN CASE WHEN p.from_lvl = ANY (p.fin) THEN 'OWNER' ELSE 'POTONG' END
           WHEN p.last_approved = cardinality(p.new_roles) THEN 'SETUJU'
           ELSE 'TETAP'
         END AS prediksi
    FROM plan p
)
SELECT co.short_code AS pt, v.id AS request_id, v.doc_no, v.status AS status_sekarang, v.lvl AS level_sekarang, v.prediksi,
       array_to_string(v.roles, ' → ') AS level_sekarang_peran,
       CASE WHEN v.prediksi IN ('POTONG', 'OWNER', 'SETUJU') THEN array_to_string(v.new_roles, ' → ') END AS level_baru_peran,
       CASE v.prediksi WHEN 'SETUJU' THEN 'approved' WHEN 'POTONG' THEN v.status WHEN 'OWNER' THEN v.status END AS status_baru,
       CASE
         WHEN v.prediksi = 'SETUJU' THEN 'Disetujui — antrian transfer Finance'
         WHEN v.prediksi NOT IN ('POTONG', 'OWNER') THEN NULL
         WHEN v.status = 'pending_ack' THEN CASE WHEN v.snap ->> 'acknowledgeBy' = 'scope_manager' THEN 'Persetujuan PM' ELSE 'Diketahui ' || CASE v.snap ->> 'acknowledgeRole' WHEN 'pk-owner' THEN 'Direktur' WHEN 'pk-principal' THEN 'Owner' WHEN 'pk-finance' THEN 'Finance' ELSE coalesce(v.snap ->> 'acknowledgeRole', '?') END END
         ELSE CASE v.new_roles[v.from_lvl] WHEN 'pk-owner' THEN 'Persetujuan Direktur' WHEN 'pk-principal' THEN 'Persetujuan Owner' ELSE 'Approval ' || coalesce(v.new_roles[v.from_lvl], '?') END
       END AS menunggu,
       CASE WHEN v.prediksi IN ('POTONG', 'OWNER', 'SETUJU') AND v.snap ->> 'acknowledge' <> 'none' AND v.snap ->> 'acknowledgeBy' <> 'scope_manager'
            THEN CASE WHEN v.status = 'pending_approval' THEN 'PM project: tidak berlaku — alur lama — Direktur sudah memutuskan' ELSE 'PM project: tidak ditambahkan — alur lama' END END AS pm,
       v.owner_aktif,
       CASE WHEN v.prediksi = 'TETAP' AND (v.g1_exception IS NOT NULL OR coalesce(v.snap ->> 'selfApproval', '') <> '') THEN 'pengecualian G1'
            WHEN v.prediksi = 'TETAP' AND NOT v.has_owner AND v.owner_aktif = 0 THEN 'tidak ada Owner aktif di PT'
            WHEN v.prediksi = 'SETUJU' THEN 'cek dana ADR 0029 saat migrasi (fund_check_enabled=' || coalesce((SELECT c.fund_check_enabled::text FROM companies c WHERE c.id = v.company_id), '?') || ')'
            ELSE '' END AS catatan
  FROM verdict v LEFT JOIN companies co ON co.id = v.company_id
 ORDER BY v.company_id, v.id;
