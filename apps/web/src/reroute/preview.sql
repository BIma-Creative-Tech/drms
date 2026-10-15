-- d1510 PRATINJAU (READ-ONLY) — keputusan owner 2026-10-15, migrasi 20261015_200000_d1510_approval_reroute.
-- Dua SELECT, tidak menulis apa pun. Jalankan dalam transaksi read-only, mis.:
--   docker exec -i postgres psql -U postgres -d pk_drms -X -v ON_ERROR_STOP=1 \
--     -c "BEGIN READ ONLY;" -f - -c "ROLLBACK;" < apps/web/src/reroute/preview.sql
-- (1) aturan default yang DISELARASKAN (PM project → Direktur → Owner) / DIBIARKAN (bentuknya diubah Admin);
-- (2) pengajuan yang DIALIHKAN (prediksi alur baru, status, siapa yang menunggu) atau TETAP (alasan).
-- Cermin SQL dari src/reroute (plan.ts + domain/expense/snapshot-plan.ts); hasil pasti = dry-run TS
-- (payload run src/reroute/cli.ts -- --dry-run). Batas pratinjau: langkah dengan user bernama dan aturan
-- "satu orang satu posisi" (distinctAssignable) tidak dimodelkan — kolom catatan menyebutnya bila relevan.
-- Tes: apps/web/tests/integration/d1510-reroute.int.test.ts membandingkan hasil (2) dengan rencana TS.

-- ---- (1) aturan
WITH names(from_name, to_name) AS (
  VALUES ('Default — Direktur lalu Finance (semua nominal)', 'Default — PM project lalu Direktur (semua nominal)'),
         ('Contoh — di atas Rp 10 juta: Direktur lalu Finance (Q-31, nonaktif)', 'Contoh — di atas Rp 10 juta: PM project lalu Direktur (Q-31, nonaktif)')
), rs AS (
  SELECT r.id,
         coalesce(array_agg(s.approver_role::text ORDER BY s.level) FILTER (WHERE s.id IS NOT NULL), '{}') AS roles,
         coalesce(array_agg(s.level::int ORDER BY s.level) FILTER (WHERE s.id IS NOT NULL), '{}') AS levels,
         count(s.approver_user_id) AS named
    FROM approval_rules r LEFT JOIN approval_rules_steps s ON s._parent_id = r.id GROUP BY r.id
)
SELECT c.short_code AS pt, r.id AS rule_id, r.name AS nama_sekarang, r.active AS aktif,
       CASE WHEN r.acknowledge::text = 'required' AND r.acknowledge_by::text = 'role' AND r.acknowledge_role::text = 'pk-owner' AND r.acknowledge_user_id IS NULL
             AND rs.named = 0 AND rs.levels = ARRAY(SELECT generate_series(1, cardinality(rs.levels)))
             AND NOT EXISTS (SELECT 1 FROM approval_rules_requester_roles x WHERE x.parent_id = r.id) AND coalesce(r.payee_type::text, 'any') = 'any'
             AND rs.roles IN ('{pk-finance}'::text[], '{pk-principal,pk-finance}'::text[])
            THEN 'UBAH' ELSE 'TETAP (bentuk diubah Admin)' END AS prediksi,
       coalesce(r.acknowledge_by::text, '-') || ':' || coalesce(r.acknowledge_role::text, '-') || ' / ' || array_to_string(rs.roles, ' → ') AS bentuk_sekarang,
       n.to_name AS nama_baru
  FROM approval_rules r JOIN names n ON n.from_name = r.name JOIN rs ON rs.id = r.id LEFT JOIN companies c ON c.id = r.company_id
 WHERE r.doc_type::text = 'expense_request'
 ORDER BY r.company_id, r.id;

-- ---- (2) pengajuan
WITH names(from_name, to_name) AS (
  VALUES ('Default — Direktur lalu Finance (semua nominal)', 'Default — PM project lalu Direktur (semua nominal)'),
         ('Contoh — di atas Rp 10 juta: Direktur lalu Finance (Q-31, nonaktif)', 'Contoh — di atas Rp 10 juta: PM project lalu Direktur (Q-31, nonaktif)')
), rs AS (
  SELECT r.id,
         coalesce(array_agg(s.approver_role::text ORDER BY s.level) FILTER (WHERE s.id IS NOT NULL), '{}') AS roles,
         coalesce(array_agg(s.level::int ORDER BY s.level) FILTER (WHERE s.id IS NOT NULL), '{}') AS levels,
         count(s.approver_user_id) AS named
    FROM approval_rules r LEFT JOIN approval_rules_steps s ON s._parent_id = r.id GROUP BY r.id
), aligned AS (
  SELECT r.id, n.to_name
    FROM approval_rules r JOIN names n ON n.from_name = r.name JOIN rs ON rs.id = r.id
   WHERE r.doc_type::text = 'expense_request' AND r.acknowledge::text = 'required' AND r.acknowledge_by::text = 'role' AND r.acknowledge_role::text = 'pk-owner'
     AND r.acknowledge_user_id IS NULL AND rs.named = 0 AND rs.levels = ARRAY(SELECT generate_series(1, cardinality(rs.levels)))
     AND NOT EXISTS (SELECT 1 FROM approval_rules_requester_roles x WHERE x.parent_id = r.id) AND coalesce(r.payee_type::text, 'any') = 'any'
     AND rs.roles IN ('{pk-finance}'::text[], '{pk-principal,pk-finance}'::text[])
), eff AS (
  -- active expense rules as a submit TODAY sees them (aligned ones in the new shape)
  SELECT r.id, r.company_id, coalesce(a.to_name, r.name) AS name, coalesce(r.priority, 100) AS priority, r.request_type::text AS request_type,
         coalesce(r.min_amount, 0) AS min_amount, r.max_amount, r.category_id, r.project_id, r.cost_center_id,
         CASE WHEN r.payee_type::text IN ('karyawan', 'vendor', 'pt_grup') THEN r.payee_type::text END AS payee_cond,
         coalesce(r.acknowledge::text, 'none') AS ack,
         CASE WHEN a.id IS NOT NULL THEN 'scope_manager' ELSE coalesce(r.acknowledge_by::text, 'scope_manager') END AS ack_by,
         CASE WHEN a.id IS NOT NULL THEN NULL ELSE r.acknowledge_role::text END AS ack_role,
         CASE WHEN a.id IS NOT NULL THEN '{pk-owner,pk-principal}'::text[] ELSE rs.roles END AS step_roles,
         coalesce((SELECT array_agg(x.value::text) FROM approval_rules_requester_roles x WHERE x.parent_id = r.id), '{}') AS req_roles
    FROM approval_rules r JOIN rs ON rs.id = r.id LEFT JOIN aligned a ON a.id = r.id
   WHERE r.active = true AND r.doc_type::text = 'expense_request'
), cand AS (
  SELECT e.id, e.company_id, e.doc_no, e.status::text AS status, e.type::text AS type, coalesce(e.grand_total, 0) AS total, e.project_id, e.cost_center_id,
         e.created_by_id, coalesce(e.payee_type::text, 'karyawan') AS payee, e.approval_snapshot AS snap, e.g1_exception,
         (SELECT count(*) FROM approvals ap WHERE ap.request_id = e.id AND ap.cycle = e.approval_cycle AND ap.position::text IN ('diketahui', 'approval')) AS decisions
    FROM expense_requests e
   WHERE e.status::text = 'pending_ack' AND e.approval_rule_id IN (SELECT id FROM aligned)
), req_emp AS (
  SELECT c.id AS req_id, x.employees_id AS emp FROM cand c JOIN expense_requests_rels x ON x.parent_id = c.id AND x.path = 'requesters' AND x.employees_id IS NOT NULL
), emp_users AS (
  SELECT DISTINCT m.employee_id AS emp, m.user_id FROM company_memberships m WHERE m.active = true AND m.employee_id IS NOT NULL AND m.user_id IS NOT NULL
), pt_roles AS (
  SELECT m.company_id, m.user_id, array_agg(x.value::text) AS roles
    FROM company_memberships m JOIN company_memberships_roles x ON x.parent_id = m.id WHERE m.active = true GROUP BY m.company_id, m.user_id
), holders AS (
  SELECT DISTINCT m.company_id, x.value::text AS role, m.user_id
    FROM company_memberships m JOIN company_memberships_roles x ON x.parent_id = m.id JOIN users u ON u.id = m.user_id AND u.active = true WHERE m.active = true
), req_roles AS (
  -- "Peran pemohon": per requester employee the roles of its ACTIVE accounts in the request's PT
  SELECT re.req_id, re.emp, coalesce(array_agg(DISTINCT rr) FILTER (WHERE rr IS NOT NULL), '{}') AS roles
    FROM req_emp re JOIN cand c ON c.id = re.req_id
    LEFT JOIN emp_users eu ON eu.emp = re.emp
    LEFT JOIN users u ON u.id = eu.user_id AND u.active IS DISTINCT FROM false
    LEFT JOIN pt_roles pr ON pr.user_id = u.id AND pr.company_id = c.company_id
    LEFT JOIN LATERAL unnest(pr.roles) rr ON true
   GROUP BY re.req_id, re.emp
), excl AS (
  SELECT c.id AS req_id, c.created_by_id AS user_id FROM cand c WHERE c.created_by_id IS NOT NULL
  UNION SELECT re.req_id, eu.user_id FROM req_emp re JOIN emp_users eu ON eu.emp = re.emp
), pick AS (
  SELECT DISTINCT ON (c.id) c.id AS req_id, f.*
    FROM cand c JOIN eff f ON f.company_id = c.company_id
   WHERE (f.request_type = 'any' OR f.request_type = c.type)
     AND c.total >= f.min_amount AND (f.max_amount IS NULL OR c.total <= f.max_amount)
     AND (f.category_id IS NULL OR EXISTS (SELECT 1 FROM expense_requests_lines l WHERE l._parent_id = c.id AND l.category_id = f.category_id))
     AND (f.project_id IS NULL OR f.project_id = c.project_id)
     AND (f.cost_center_id IS NULL OR f.cost_center_id = c.cost_center_id)
     AND (cardinality(f.req_roles) = 0
          OR (EXISTS (SELECT 1 FROM req_emp re WHERE re.req_id = c.id)
              AND NOT EXISTS (SELECT 1 FROM req_roles q WHERE q.req_id = c.id AND NOT (q.roles && f.req_roles))))
     AND (f.payee_cond IS NULL OR f.payee_cond = c.payee)
   ORDER BY c.id, f.priority,
            ((f.category_id IS NOT NULL)::int + (f.project_id IS NOT NULL)::int + (f.cost_center_id IS NOT NULL)::int + (f.request_type <> 'any')::int
              + (cardinality(f.req_roles) > 0)::int + (f.payee_cond IS NOT NULL)::int) DESC,
            f.min_amount DESC, f.id
), plan AS (
  SELECT c.*, p.id AS rule_id, p.name AS rule_name, p.ack, p.ack_by, p.ack_role, p.step_roles,
         pm.pm_id,
         (pm.pm_id IS NOT NULL AND EXISTS (SELECT 1 FROM users u JOIN pt_roles pr ON pr.user_id = u.id AND pr.company_id = c.company_id
                                            WHERE u.id = pm.pm_id AND u.active IS DISTINCT FROM false AND cardinality(pr.roles) > 0)) AS pm_member,
         EXISTS (SELECT 1 FROM excl x WHERE x.req_id = c.id AND x.user_id = pm.pm_id) AS pm_excluded,
         (SELECT count(*) FROM holders h WHERE h.company_id = c.company_id AND h.role = p.ack_role) AS ack_holders,
         (SELECT count(*) FROM holders h WHERE h.company_id = c.company_id AND h.role = p.ack_role
             AND NOT EXISTS (SELECT 1 FROM excl x WHERE x.req_id = c.id AND x.user_id = h.user_id)) AS ack_eligible,
         (SELECT coalesce(jsonb_agg(jsonb_build_object('role', st.role, 'holders',
                    (SELECT count(*) FROM holders h WHERE h.company_id = c.company_id AND h.role = st.role),
                  'eligible',
                    (SELECT count(*) FROM holders h WHERE h.company_id = c.company_id AND h.role = st.role
                        AND NOT EXISTS (SELECT 1 FROM excl x WHERE x.req_id = c.id AND x.user_id = h.user_id))) ORDER BY st.n), '[]'::jsonb)
            FROM unnest(p.step_roles) WITH ORDINALITY st(role, n)) AS steps
    FROM cand c
    LEFT JOIN pick p ON p.req_id = c.id
    LEFT JOIN LATERAL (SELECT CASE WHEN c.project_id IS NOT NULL THEN (SELECT pj.pm_id FROM projects pj WHERE pj.id = c.project_id)
                                   WHEN c.cost_center_id IS NOT NULL THEN (SELECT cc.manager_id FROM cost_centers cc WHERE cc.id = c.cost_center_id) END AS pm_id) pm ON true
), judged AS (
  SELECT pl.*,
         (pl.ack = 'required' AND pl.ack_by = 'scope_manager') AS by_pm,
         (SELECT count(*) FROM jsonb_array_elements(pl.steps) s WHERE (s ->> 'holders')::int = 0) AS steps_without_holder,
         (SELECT array_agg(s ->> 'role' ORDER BY o) FROM jsonb_array_elements(pl.steps) WITH ORDINALITY t(s, o) WHERE (s ->> 'eligible')::int = 0) AS skipped_steps,
         (SELECT array_agg(s ->> 'role' ORDER BY o) FROM jsonb_array_elements(pl.steps) WITH ORDINALITY t(s, o) WHERE (s ->> 'eligible')::int > 0) AS kept_steps
    FROM plan pl
), verdict AS (
  SELECT j.*,
         CASE
           WHEN j.decisions > 0 THEN 'sudah ada keputusan pada siklus ini'
           WHEN j.g1_exception IS NOT NULL THEN 'pengecualian G1 ' || j.g1_exception
           WHEN NOT (j.snap ->> 'acknowledge' = 'required' AND j.snap ->> 'acknowledgeBy' = 'role' AND j.snap ->> 'acknowledgeRole' = 'pk-owner'
                     AND coalesce(j.snap ->> 'acknowledgeDelegatedTo', '') = '' AND coalesce(j.snap ->> 'selfApproval', '') = '') THEN 'snapshot bukan "Diketahui" Direktur'
           WHEN j.rule_id IS NULL THEN 'tidak ada aturan yang berlaku (409)'
           WHEN cardinality(j.step_roles) = 0 THEN 'aturan tanpa persetujuan (pengajuan Owner) — keputusan manual'
           WHEN j.by_pm AND j.pm_id IS NULL THEN 'project/pusat biaya tanpa PM (409)'
           WHEN j.by_pm AND NOT j.pm_member THEN 'PM bukan pengguna aktif PT (409)'
           WHEN j.ack = 'required' AND NOT j.by_pm AND j.ack_holders = 0 THEN 'tidak ada pemegang peran "Diketahui" (409)'
           WHEN j.steps_without_holder > 0 THEN 'level tanpa pemegang peran aktif (409)'
           WHEN j.by_pm AND 'pk-owner' = ANY (coalesce(j.skipped_steps, '{}')) THEN 'Direktur satu-satunya adalah pemohon/pembuat (409)'
           WHEN 'pk-principal' = ANY (coalesce(j.skipped_steps, '{}')) OR (j.ack = 'required' AND NOT j.by_pm AND j.ack_role = 'pk-principal' AND j.ack_eligible = 0)
             THEN 'Owner satu-satunya adalah pemohon/pembuat (409)'
           WHEN NOT ((j.ack = 'required' AND ((j.by_pm AND NOT j.pm_excluded) OR (NOT j.by_pm AND j.ack_eligible > 0))) OR cardinality(coalesce(j.kept_steps, '{}')) > 0)
             THEN 'tidak ada pihak independen (409)'
         END AS keep_reason,
         (j.ack = 'required' AND ((j.by_pm AND NOT j.pm_excluded) OR (NOT j.by_pm AND j.ack_eligible > 0))) AS ack_waits
    FROM judged j
)
SELECT co.short_code AS pt, v.id AS request_id, v.doc_no, v.status AS status_sekarang,
       CASE WHEN v.keep_reason IS NULL THEN 'ALIH' ELSE 'TETAP' END AS prediksi,
       v.rule_id AS rule_id_baru, v.rule_name AS aturan_baru,
       CASE WHEN v.keep_reason IS NOT NULL THEN NULL WHEN v.ack_waits THEN 'pending_ack' ELSE 'pending_approval' END AS status_baru,
       CASE WHEN v.keep_reason IS NOT NULL THEN NULL
            WHEN v.ack_waits AND v.by_pm THEN 'Persetujuan PM (' || coalesce((SELECT coalesce(nullif(u.name, ''), u.email) FROM users u WHERE u.id = v.pm_id), 'user #' || v.pm_id) || ')'
            WHEN v.ack_waits THEN 'Diketahui ' || CASE v.ack_role WHEN 'pk-owner' THEN 'Direktur' WHEN 'pk-principal' THEN 'Owner' WHEN 'pk-finance' THEN 'Finance' ELSE v.ack_role END
            ELSE CASE v.kept_steps[1] WHEN 'pk-owner' THEN 'Persetujuan Direktur' WHEN 'pk-principal' THEN 'Persetujuan Owner' WHEN 'pk-finance' THEN 'Approval Finance' ELSE 'Approval ' || v.kept_steps[1] END
       END AS menunggu,
       CASE WHEN v.keep_reason IS NULL AND v.by_pm AND v.pm_excluded THEN 'PM project (pemohon/pembuat)' END AS dilewati,
       coalesce(v.keep_reason, '') AS catatan
  FROM verdict v LEFT JOIN companies co ON co.id = v.company_id
 ORDER BY v.company_id, v.id;
