-- MC4 QA — LOCAL THROWAWAY perf DB only (pk_perf*): users, memberships, employees, projects and ONE YEAR of
-- history for the three PTs created by seed-3pt.ts (docs/proyekkas/qa/mc4-qa-report.md §Perf).
-- Run as the postgres superuser of the throwaway cluster:  psql -v ON_ERROR_STOP=1 -d pk_perf -f bulk-3pt.sql
-- Triggers are bypassed (session_replication_role = replica) because the rows are generated history,
-- so every column a trigger would derive (company_id, owner links) is set explicitly here.
-- Volumes per PT (Q-34 × 3, one year): 30 field + 3 office accounts, 4 projects × 3 stages,
--   2 400 expense requests × 3 receipts (7 200 receipt photos), 30 × 2 × 260 attendances (15 600 selfies),
--   1 000 progress reports × 2 photos. Plus 6 cross-PT office accounts (lt-x-*).
-- keycloak_sub = the login name, so the local fake IdP (fake-idp.mjs) can mint tokens for it.
\set ON_ERROR_STOP 1
DO $$ BEGIN IF current_database() !~ '^pk_perf' THEN RAISE EXCEPTION 'refusing: % is not a perf DB', current_database(); END IF; END $$;
SET session_replication_role = replica;
BEGIN;

-- ---------------------------------------------------------------- people
CREATE TEMP TABLE p_emp AS
SELECT c.id AS company_id, c.short_code AS sc, 'F' || lpad(i::text, 2, '0') AS code, 'lt-f-' || c.id || '-' || lpad(i::text, 2, '0') AS login, 'pk-staff' AS role, i AS n
FROM companies c, generate_series(1, 30) i
UNION ALL
SELECT c.id, c.short_code, 'O-' || upper(r), 'lt-o-' || c.id || '-' || r, 'pk-' || CASE r WHEN 'fin' THEN 'finance' WHEN 'own' THEN 'owner' ELSE 'pm' END, 100
FROM companies c, unnest(ARRAY['fin', 'own', 'pm']) r;

INSERT INTO employees (code, name, company_id, active, uuid)
SELECT 'PERF-' || code, 'Perf ' || sc || ' ' || code, company_id, true, gen_random_uuid()::text FROM p_emp;

INSERT INTO users (email, name, keycloak_sub, active, group_admin)
SELECT login || '@perf.test', login, login, true, false FROM p_emp
UNION ALL
SELECT x || '@perf.test', x, x, true, false FROM unnest(ARRAY['lt-x-fin12', 'lt-x-fin23', 'lt-x-own12', 'lt-x-own123', 'lt-x-pm13', 'lt-x-fin123']) x;

CREATE TEMP TABLE p_mem (login text, company_id int, role text, emp_code text);
INSERT INTO p_mem SELECT login, company_id, role, 'PERF-' || code FROM p_emp;
INSERT INTO p_mem VALUES
  ('lt-x-fin12', 1, 'pk-finance', NULL), ('lt-x-fin12', 2, 'pk-finance', NULL),
  ('lt-x-fin23', 2, 'pk-finance', NULL), ('lt-x-fin23', 3, 'pk-finance', NULL),
  ('lt-x-own12', 1, 'pk-owner', NULL), ('lt-x-own12', 2, 'pk-owner', NULL),
  ('lt-x-own123', 1, 'pk-owner', NULL), ('lt-x-own123', 2, 'pk-owner', NULL), ('lt-x-own123', 3, 'pk-owner', NULL),
  ('lt-x-pm13', 1, 'pk-pm', NULL), ('lt-x-pm13', 3, 'pk-pm', NULL),
  ('lt-x-fin123', 1, 'pk-finance', NULL), ('lt-x-fin123', 2, 'pk-finance', NULL), ('lt-x-fin123', 3, 'pk-finance', NULL);

WITH m AS (
  INSERT INTO company_memberships (user_id, company_id, employee_id, active)
  SELECT u.id, pm.company_id, e.id, true
  FROM p_mem pm JOIN users u ON u.keycloak_sub = pm.login
  LEFT JOIN employees e ON e.code = pm.emp_code AND e.company_id = pm.company_id
  RETURNING id, user_id, company_id)
INSERT INTO company_memberships_roles ("order", parent_id, value)
SELECT 1, m.id, pm.role::enum_company_memberships_roles FROM m JOIN users u ON u.id = m.user_id JOIN p_mem pm ON pm.login = u.keycloak_sub AND pm.company_id = m.company_id;

-- ---------------------------------------------------------------- projects, stages, teams
INSERT INTO projects (code, name, company_id, pm_id, budget, status, lat, lng, radius_m, uuid, progress_pct)
SELECT 'PERF-P' || k, 'Proyek Perf ' || c.short_code || ' ' || k, c.id,
       CASE WHEN k = 4 AND c.id IN (1, 3) THEN (SELECT id FROM users WHERE keycloak_sub = 'lt-x-pm13') ELSE (SELECT id FROM users WHERE keycloak_sub = 'lt-o-' || c.id || '-pm') END,
       5000000000, 'berjalan', -3.32, 114.59, 500, gen_random_uuid()::text, 0
FROM companies c, generate_series(1, 4) k;

INSERT INTO project_stages (project_id, name, weight_pct, sequence, progress_pct, active, company_id, uuid)
SELECT p.id, 'Tahap ' || s, CASE s WHEN 3 THEN 40 ELSE 30 END, s, 0, true, p.company_id, gen_random_uuid()::text
FROM projects p, generate_series(1, 3) s WHERE p.code LIKE 'PERF-P%';

INSERT INTO team_assignments (employee_id, project_id, role_in_project, company_id)
SELECT e.id, p.id, 'staff', e.company_id
FROM p_emp pe JOIN employees e ON e.code = 'PERF-' || pe.code AND e.company_id = pe.company_id
JOIN projects p ON p.company_id = e.company_id AND p.code = 'PERF-P' || (((pe.n - 1) % 4) + 1)
WHERE pe.role = 'pk-staff';

-- ---------------------------------------------------------------- history: expense requests + receipts
CREATE TEMP TABLE p_field AS
SELECT e.company_id, e.id AS emp_id, u.id AS user_id, pe.n,
       (SELECT id FROM projects p WHERE p.company_id = e.company_id AND p.code = 'PERF-P' || (((pe.n - 1) % 4) + 1)) AS project_id
FROM p_emp pe JOIN employees e ON e.code = 'PERF-' || pe.code AND e.company_id = pe.company_id
JOIN users u ON u.keycloak_sub = pe.login WHERE pe.role = 'pk-staff';

INSERT INTO expense_requests (doc_no, type, status, title, project_id, request_date, needed_date, created_by_id, grand_total, approved_amount, transferred_total,
  verified_receipts_total, submitted_at, source, uuid, company_id, created_at, updated_at, approval_cycle, current_level)
SELECT g || '/PB-' || c.short_code || '/PERF', CASE WHEN g % 3 = 0 THEN 'advance' ELSE 'reimburse' END::enum_expense_requests_type,
       CASE WHEN g % 10 = 0 THEN 'pending_approval' WHEN g % 10 = 1 THEN 'transferred' ELSE 'completed' END::enum_expense_requests_status,
       'Perf ' || c.short_code || ' #' || g, f.project_id, to_char(now() - (g % 260) * interval '1 day', 'YYYY-MM-DD'), to_char(now() - (g % 260) * interval '1 day', 'YYYY-MM-DD'),
       f.user_id, 300000, 300000, 300000, 300000, now() - (g % 260) * interval '1 day', 'apk', gen_random_uuid()::text, c.id,
       now() - (g % 260) * interval '1 day', now() - (g % 260) * interval '1 day', 1, 0
FROM companies c, generate_series(1, 2400) g
JOIN LATERAL (SELECT * FROM p_field pf WHERE pf.company_id = c.id AND pf.n = ((g - 1) % 30) + 1) f ON true;

INSERT INTO expense_requests_lines (_order, _parent_id, id, description, total)
SELECT 1, er.id, 'perf-l-' || er.id, 'Material perf', 300000 FROM expense_requests er WHERE er.doc_no LIKE '%/PERF';

INSERT INTO expense_requests_rels ("order", parent_id, path, employees_id)
SELECT 1, er.id, 'requesters', f.emp_id FROM expense_requests er JOIN p_field f ON f.user_id = er.created_by_id WHERE er.doc_no LIKE '%/PERF';

CREATE TEMP TABLE p_rcpt AS
SELECT er.id AS request_id, er.company_id, er.created_by_id, k, gen_random_uuid()::text AS u
FROM expense_requests er, generate_series(1, 3) k WHERE er.doc_no LIKE '%/PERF';

INSERT INTO media_receipts (uploaded_by_id, received_at, owner_doc_type, owner_doc_id, filename, mime_type, filesize, width, height,
  sizes_thumb_filename, sizes_thumb_mime_type, sizes_thumb_width, sizes_thumb_height, created_at, updated_at)
SELECT created_by_id, now(), 'expense_request', request_id::text, u || '.jpg', 'image/jpeg', 302000, 1600, 1200,
       u || '-320x240.jpg', 'image/jpeg', 320, 240, now(), now() FROM p_rcpt;

INSERT INTO receipts (request_id, line_id, vendor_name, receipt_date, amount, image_id, status, created_by_id, company_id, uuid, created_at, updated_at)
SELECT r.request_id, 'perf-l-' || r.request_id, 'Toko Perf ' || r.k, to_char(now(), 'YYYY-MM-DD'), 100000, m.id, 'valid', r.created_by_id, r.company_id, gen_random_uuid()::text, now(), now()
FROM p_rcpt r JOIN media_receipts m ON m.filename = r.u || '.jpg';

-- ---------------------------------------------------------------- history: attendances + selfies (yesterday and before: today stays free for k6 check-ins)
CREATE TEMP TABLE p_att AS
SELECT f.company_id, f.emp_id, f.user_id, f.project_id, d, kind, gen_random_uuid()::text AS u
FROM p_field f, generate_series(1, 260) d, unnest(ARRAY['check_in', 'check_out']) kind;

INSERT INTO media_selfies (uploaded_by_id, received_at, filename, mime_type, filesize, width, height, created_at, updated_at)
SELECT user_id, now(), u || '.jpg', 'image/jpeg', 84000, 540, 720, now(), now() FROM p_att;

INSERT INTO attendances (employee_id, user_id, kind, project_id, local_date, attendance_time, received_at, time_trust, lat, lng, distance_m, selfie_id,
  client_uuid, source, company_id, created_at, updated_at)
SELECT a.emp_id, a.user_id, a.kind::enum_attendances_kind, a.project_id, to_char((now() AT TIME ZONE 'Asia/Makassar')::date - a.d, 'YYYY-MM-DD'),
       ((now() AT TIME ZONE 'Asia/Makassar')::date - a.d) + CASE a.kind WHEN 'check_in' THEN time '08:00' ELSE time '17:00' END, now(), 'server', -3.32, 114.59, 12,
       m.id, gen_random_uuid()::text, 'self', a.company_id, now(), now()
FROM p_att a JOIN media_selfies m ON m.filename = a.u || '.jpg';

-- ---------------------------------------------------------------- history: progress reports + photos
CREATE TEMP TABLE p_pr AS
SELECT c.id AS company_id, g, p.id AS project_id, s.id AS stage_id, p.pm_id
FROM companies c, generate_series(1, 1000) g
JOIN LATERAL (SELECT * FROM projects p WHERE p.company_id = c.id AND p.code = 'PERF-P' || (((g - 1) % 4) + 1)) p ON true
JOIN LATERAL (SELECT * FROM project_stages s WHERE s.project_id = p.id ORDER BY s.sequence LIMIT 1) s ON true;

INSERT INTO progress_reports (doc_no, project_id, stage_id, report_date, pct_before, pct_after, work, reporter_id, photo_count, uuid, company_id, created_at, updated_at)
SELECT 'LP-PERF-' || company_id || '-' || g, project_id, stage_id, to_char(now() - (g % 260) * interval '1 day', 'YYYY-MM-DD'), 0, 0, 'Pekerjaan perf', pm_id, 2, gen_random_uuid()::text, company_id, now(), now()
FROM p_pr;

CREATE TEMP TABLE p_ph AS
SELECT pr.id AS report_id, pr.reporter_id, k, gen_random_uuid()::text AS u FROM progress_reports pr, generate_series(1, 2) k WHERE pr.doc_no LIKE 'LP-PERF-%';

INSERT INTO media_progress_photos (uploaded_by_id, received_at, owner_doc_type, owner_doc_id, filename, mime_type, filesize, width, height,
  sizes_thumb_filename, sizes_thumb_mime_type, sizes_thumb_width, sizes_thumb_height, created_at, updated_at)
SELECT reporter_id, now(), 'progress_report', report_id::text, u || '.jpg', 'image/jpeg', 302000, 1600, 1200, u || '-320x240.jpg', 'image/jpeg', 320, 240, now(), now() FROM p_ph;

COMMIT;
SET session_replication_role = origin;
ANALYZE;
SELECT 'media_receipts' AS t, count(*) FROM media_receipts UNION ALL SELECT 'media_selfies', count(*) FROM media_selfies
UNION ALL SELECT 'media_progress_photos', count(*) FROM media_progress_photos UNION ALL SELECT 'expense_requests', count(*) FROM expense_requests
UNION ALL SELECT 'attendances', count(*) FROM attendances UNION ALL SELECT 'progress_reports', count(*) FROM progress_reports UNION ALL SELECT 'users', count(*) FROM users;
