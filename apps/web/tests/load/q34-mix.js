// E9 load test — beban default Q-34: 30 pengguna lapangan + 5 pengguna kantor (k6).
// Laporan & cara pakai: docs/proyekkas/qa/s3-e9-qa-report.md §3.
//
// Dua mode (env MODE):
//   anon (default) — tanpa kredensial: jalur publik & jalur yang ditolak auth (health, app/config,
//                    /admin/login SSR, redirect gate /admin, 401 API, unggah multipart tanpa token).
//   auth           — akun uji beban staging `lt-*` (password grant client proyekkas-mobile, realm drms-staging,
//                    ADR 0012 — HANYA staging). Kredensial lewat --env-file root-only, JANGAN di-commit:
//                      FIELD_USERS='[{"u":"lt-field-01","p":"…"}, …]'            (30 akun pk-staff, 1 akun per VU)
//                      OFFICE_USERS='[{"u":"lt-office-01","p":"…","r":"finance"}, …]'  (r = finance|owner|pm)
//                      PROJECT_ID, LAT, LNG (project uji beban PRJ-LT-E9 + titik geofence)
//                    Campuran (keputusan Lead 2026-09-27, opsi b — hanya PM/Direktur yang boleh lapor progress):
//                      lapangan (Staff): /me, /masters, selfie + check-in/check-out (sync), nota foto 1600 px +
//                                        draft Reimburse lalu draft_delete (dibatalkan), daftar pengajuan, /dashboard/me
//                      kantor Finance:   dashboard finance, inbox approval, antrian transfer, laporan
//                      kantor Direktur:  dashboard owner, inbox approval, progress project, laporan progress + 1–3 foto
//                      kantor PM:        dashboard pm, progress project, laporan progress + 1–3 foto
//                    Membuat data uji: absensi (check-in + check-out 1×/user/hari; sisanya `rejected`), foto
//                    selfie/nota/progress, draft pengajuan yang langsung dibatalkan, laporan progress.
//
// Jalankan (dari host VPS, lalu lintas hairpin tiba di Traefik sebagai 10.100.0.1 — IP privat, di-whitelist
// parser crowdsecurity/whitelists; SEMUA VU berbagi satu bucket rate limit Traefik per IP):
//   docker run --rm --network host -v "$PWD/apps/web/tests/load:/load:ro" -v "$OUT:/out" -e MODE=anon \
//     grafana/k6 run /load/q34-mix.js
//   (auth: tambah --env-file <file 0600 berisi MODE=auth, FIELD_USERS=…, OFFICE_USERS=…, PROJECT_ID=…, LAT=…, LNG=…>)
// Gambar uji: /load/fixtures/{photo,selfie}.jpg (sintetis, dibuat dengan sharp; bukan foto orang).
import http from 'k6/http'
import exec from 'k6/execution'
import { check, sleep } from 'k6'
import { Trend, Rate, Counter } from 'k6/metrics'

const BASE = __ENV.BASE || 'https://drms-kas.staging.bimacreative.tech'
const TOKEN_URL = __ENV.TOKEN_URL || 'https://auth.bimacreative.tech/realms/drms-staging/protocol/openid-connect/token'
const MODE = __ENV.MODE || 'anon'
const DURATION = __ENV.DURATION || '8m'
const RAMP = __ENV.RAMP || '1m'
const FIELD_VUS = Number(__ENV.FIELD_VUS || 30)
const OFFICE_VUS = Number(__ENV.OFFICE_VUS || 5)
const APP_VERSION = __ENV.APP_VERSION || '1.0.0'

const PHOTO = open('./fixtures/photo.jpg', 'b')
const SELFIE = open('./fixtures/selfie.jpg', 'b')

// Satu Trend per aksi utama → p50/p95 per aksi di ringkasan.
const T = {}
for (const n of [
  'health', 'app_config', 'admin_login_page', 'admin_gate', 'api_401', 'upload_anon',
  'token', 'me', 'masters', 'upload_selfie', 'checkin', 'upload_photo', 'progress_report',
  'expense_draft', 'expense_list', 'dashboard', 'approvals_inbox', 'report', 'transfer_queue',
  'upload_receipt', 'device_register', 'stages', 'projects_progress', 'dashboard_me',
  // E9 P-1: end-to-end unggahan termasuk tunggu Retry-After setelah 503 UPLOAD_BUSY (antrean resize penuh).
  'upload_selfie_e2e', 'upload_receipt_e2e', 'upload_photo_e2e', 'upload_busy_503',
]) T[n] = new Trend(`act_${n}`, true)
const uploadBusy = new Counter('upload_busy_503')
const uploadGaveUp = new Counter('upload_gave_up')
// Hasil bisnis item /sync/batch dan laporan progress (HTTP 200 tetapi item bisa `rejected`).
const syncApplied = new Counter('sync_applied')
const syncRejected = new Counter('sync_rejected')
const syncOther = new Counter('sync_other')
const progressCreated = new Counter('progress_created')
const errors = new Rate('act_errors')
const ratelimited = new Counter('http_429')
const wafBlocked = new Counter('http_403_waf')

const stages = (vus) => [
  { duration: RAMP, target: vus },
  { duration: DURATION, target: vus },
  { duration: '30s', target: 0 },
]

export const options = {
  // ONLY=field|office: satu skenario per proses k6 (dua container paralel) → exec.vu.idInTest = 1..N per skenario,
  // sehingga 1 VU = 1 akun secara deterministik. Tanpa ONLY: kedua skenario dalam satu proses (mode anon).
  scenarios: Object.fromEntries(Object.entries({
    field: { executor: 'ramping-vus', exec: MODE === 'auth' ? 'fieldAuth' : 'fieldAnon', startVUs: 0, stages: stages(FIELD_VUS), gracefulRampDown: '20s' },
    office: { executor: 'ramping-vus', exec: MODE === 'auth' ? 'officeAuth' : 'officeAnon', startVUs: 0, stages: stages(OFFICE_VUS), gracefulRampDown: '20s' },
  }).filter(([k]) => !__ENV.ONLY || __ENV.ONLY === k)),
  thresholds: {
    // AC E9 (keputusan user 2026-09-27): unggahan foto p95 < 5 s, aksi lain p95 < 2 s.
    act_checkin: ['p(95)<2000'],
    act_progress_report: ['p(95)<2000'],
    act_upload_photo: ['p(95)<5000'],
    act_upload_selfie: ['p(95)<5000'],
    act_expense_draft: ['p(95)<2000'],
    act_upload_receipt: ['p(95)<5000'],
    act_dashboard: ['p(95)<2000'],
    act_approvals_inbox: ['p(95)<2000'],
    act_admin_login_page: ['p(95)<2000'],
    act_app_config: ['p(95)<2000'],
    act_errors: ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'max', 'count'],
  insecureSkipTLSVerify: false,
  userAgent: 'k6-e9-loadtest/drms-proyekkas-qa',
}

function rec(name, res, okStatuses) {
  T[name].add(res.timings.duration)
  if (res.status === 429) ratelimited.add(1)
  if (res.status === 403 && /crowdsec|appsec|Forbidden/i.test(String(res.body).slice(0, 300)) && !String(res.headers['Content-Type'] || '').includes('json')) wafBlocked.add(1)
  const ok = okStatuses.includes(res.status)
  errors.add(!ok)
  check(res, { [`${name} status ${okStatuses.join('|')}`]: () => ok })
  return ok
}

// Waktu jeda ala manusia (detik): lapangan jarang (aksi per 20–40 s), kantor lebih sering.
const think = (min, max) => sleep(min + Math.random() * (max - min))

// ----------------------------------------------------------------------------- anon
export function fieldAnon() {
  rec('health', http.get(`${BASE}/api/v1/health`, { tags: { name: 'health' } }), [200])
  think(2, 5)
  rec('app_config', http.get(`${BASE}/api/v1/app/config?version=${APP_VERSION}`, { tags: { name: 'app_config' } }), [200])
  think(2, 5)
  rec('api_401', http.get(`${BASE}/api/v1/masters`, { tags: { name: 'masters_401' } }), [401])
  think(5, 15)
  // Unggahan selfie/foto tanpa token: melewati Traefik buffering-pk + parser multipart app → 401.
  const f = Math.random() < 0.5 ? http.file(SELFIE, 'selfie.jpg', 'image/jpeg') : http.file(PHOTO, 'photo.jpg', 'image/jpeg')
  rec('upload_anon', http.post(`${BASE}/api/v1/media/selfies`, { file: f }, { tags: { name: 'upload_anon' } }), [401])
  think(10, 20)
}

export function officeAnon() {
  rec('admin_gate', http.get(`${BASE}/admin`, { redirects: 0, tags: { name: 'admin_gate' } }), [302])
  think(1, 3)
  rec('admin_login_page', http.get(`${BASE}/admin/login`, { tags: { name: 'admin_login_page' } }), [200])
  think(3, 8)
  rec('api_401', http.get(`${BASE}/api/v1/approvals/inbox`, { tags: { name: 'inbox_401' } }), [401])
  think(5, 10)
}

// ----------------------------------------------------------------------------- auth
function uuid() {
  const b = new Uint8Array(16)
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const users = (k) => JSON.parse(__ENV[k] || '[]')
let session = null // per VU
let attendanceStep = 0 // per VU: 0 = check-in, 1 = check-out, ≥ 2 = ulang (diharapkan `rejected`)
const seenReject = {}

function tokenReq(form) {
  const res = http.post(TOKEN_URL, form, { tags: { name: 'token' } })
  rec('token', res, [200])
  if (res.status !== 200) return null
  const j = res.json()
  return { at: j.access_token, rt: j.refresh_token, exp: Date.now() + (j.expires_in - 30) * 1000 }
}

function login(pool) {
  const list = users(pool)
  if (!list.length) throw new Error(`${pool} kosong — MODE=auth butuh kredensial uji lewat env`)
  // 1 akun per VU: indeks VU di dalam skenario (bukan __VU global yang dipakai bersama dua skenario).
  const idx = exec.vu.idInTest
  const u = list[(idx - 1) % list.length]
  // Jeda acak agar ≤ 35 login tidak melampaui ratelimit-drms-kc-token (60/menit, burst 30).
  sleep(Math.random() * 45)
  const tok = tokenReq({ grant_type: 'password', client_id: 'proyekkas-mobile', username: u.u, password: u.p, scope: 'openid' })
  if (!tok) return null
  const deviceId = uuid()
  const s = { ...tok, deviceId, user: u.u, role: u.r || 'staff' }
  const r = http.post(`${BASE}/api/v1/devices/register`, JSON.stringify({ deviceId, platform: 'android', model: 'k6-loadtest', appVersion: APP_VERSION }), { headers: hdr(s, true), tags: { name: 'device_register' } })
  rec('device_register', r, [200, 201])
  console.log(`login ${exec.scenario.name} vu=${idx} user=${u.u} role=${s.role}`)
  return s
}

function hdr(s, jsonBody, extra) {
  const h = { Authorization: `Bearer ${s.at}`, 'X-Device-Id': s.deviceId, 'X-App-Version': APP_VERSION }
  if (jsonBody) h['Content-Type'] = 'application/json'
  return Object.assign(h, extra || {})
}

function ensure(pool) {
  if (!session) session = login(pool)
  if (session && Date.now() > session.exp) {
    // Token reuse: refresh, bukan login ulang (seperti APK).
    const t = tokenReq({ grant_type: 'refresh_token', client_id: 'proyekkas-mobile', refresh_token: session.rt })
    session = t ? { ...session, ...t } : login(pool)
  }
  return session
}

// 503 + Retry-After (code UPLOAD_BUSY) = antrean resize server penuh (E9 P-1): tunggu Retry-After lalu ulangi
// (maks. 3 kali). act_<metric> = latensi request yang DITERIMA; act_<metric>_e2e = total termasuk tunggu;
// percobaan 503 dihitung terpisah (upload_busy_503), bukan error.
function upload(s, kind, bin, name, metric) {
  const t0 = Date.now()
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = http.post(`${BASE}/api/v1/media/${kind}`, { file: http.file(bin, name, 'image/jpeg') }, { headers: hdr(s, false), tags: { name: metric } })
    let code = null
    if (res.status === 503) { try { code = res.json('code') } catch { code = null } }
    if (res.status === 503 && code === 'UPLOAD_BUSY' && attempt < 3) {
      uploadBusy.add(1, { kind })
      T.upload_busy_503.add(res.timings.duration)
      sleep(Number(res.headers['Retry-After'] || 5))
      continue
    }
    if (res.status === 503 && code === 'UPLOAD_BUSY') uploadGaveUp.add(1, { kind })
    const ok = rec(metric, res, [201])
    if (ok) T[`${metric}_e2e`].add(Date.now() - t0)
    return ok ? res.json('id') : null
  }
  return null
}

function clock() {
  return { device_time: new Date().toISOString(), elapsed_ms: Math.floor(Date.now() % 1e9), boot_id: `k6-${__VU}` }
}

function syncItem(type, payload) {
  return { client_uuid: uuid(), type, schema_version: 1, offline: false, device_time: new Date().toISOString(), elapsed_ms: Math.floor(Date.now() % 1e9), payload }
}

function sync(s, items, metric) {
  const body = { batch_id: uuid(), device_id: s.deviceId, clock: clock(), items }
  const res = http.post(`${BASE}/api/v1/sync/batch`, JSON.stringify(body), { headers: hdr(s, true, { 'Idempotency-Key': body.batch_id }), tags: { name: metric } })
  if (rec(metric, res, [200])) {
    for (const r of res.json('results') || []) {
      if (r.status === 'applied' || r.status === 'duplicate') syncApplied.add(1, { item: metric })
      else if (r.status === 'rejected') {
        syncRejected.add(1, { item: metric })
        const code = (r.errors && r.errors[0] && r.errors[0].code) || '?'
        if (!seenReject[metric + code]) { seenReject[metric + code] = 1; console.log(`sync ${metric} rejected ${code}: ${(r.errors[0] && r.errors[0].message) || ''}`) }
      } else syncOther.add(1, { item: metric })
    }
  }
  return res
}

const PROJECT_ID = Number(__ENV.PROJECT_ID || 0)
const LAT = Number(__ENV.LAT || 0)
const LNG = Number(__ENV.LNG || 0)
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10) // WITA

export function fieldAuth() {
  const s = ensure('FIELD_USERS')
  if (!s) { think(10, 20); return }
  rec('me', http.get(`${BASE}/api/v1/me`, { headers: hdr(s), tags: { name: 'me' } }), [200])
  if (exec.vu.iterationInScenario % 3 === 0) rec('masters', http.get(`${BASE}/api/v1/masters`, { headers: hdr(s), tags: { name: 'masters' } }), [200])
  think(3, 8)
  if (Math.random() < 0.45 && PROJECT_ID) {
    // Absensi: selfie 720 px lalu check-in / check-out (sharp resize di web).
    const mid = upload(s, 'selfies', SELFIE, 'selfie.jpg', 'upload_selfie')
    const type = attendanceStep % 2 === 0 ? 'attendance.check_in' : 'attendance.check_out'
    attendanceStep++
    if (mid) sync(s, [syncItem(type, { project_id: PROJECT_ID, lat: LAT, lng: LNG, accuracy_m: 8, is_mocked: false, selfie_media_id: mid, camera_lens: 'front' })], 'checkin')
  } else {
    // Nota foto 1600 px + draft Reimburse (1 baris, 1 nota) lalu dibatalkan (draft_delete) di batch yang sama.
    const rid = upload(s, 'receipts', PHOTO, 'nota.jpg', 'upload_receipt')
    const cu = uuid()
    const line = { client_uuid: uuid(), description: 'Konsumsi uji beban (lump sum)', total: 50000 }
    if (rid) line.receipts = [{ client_uuid: uuid(), vendor_name: 'Warung Uji Beban', receipt_date: today(), amount: 50000, media_id: rid }]
    const up = syncItem('expense_request.draft_upsert', { kind: 'reimburse', title: 'Uji beban k6 E9 (fiktif)', project_id: PROJECT_ID || null, lines: [line] })
    up.client_uuid = cu
    sync(s, [up, { ...syncItem('expense_request.draft_delete', { draft_client_uuid: cu, reason: 'Data uji beban k6 E9' }), depends_on: [cu] }], 'expense_draft')
    think(2, 5)
    rec('expense_list', http.get(`${BASE}/api/v1/expense-requests?scope=mine&limit=20`, { headers: hdr(s), tags: { name: 'expense_list' } }), [200])
    rec('dashboard_me', http.get(`${BASE}/api/v1/dashboard/me`, { headers: hdr(s), tags: { name: 'dashboard_me' } }), [200])
  }
  think(20, 40)
}

function progressReport(s) {
  const st = http.get(`${BASE}/api/v1/projects/${PROJECT_ID}/stages`, { headers: hdr(s), tags: { name: 'stages' } })
  if (!rec('stages', st, [200])) return
  const open = (st.json('stages') || []).filter((x) => Number(x.progressPct ?? 0) < 100)
  if (!open.length) return
  const stg = open[Math.floor(Math.random() * open.length)]
  const pct = Math.min(100, Math.round((Number(stg.progressPct ?? 0) + 0.25) * 100) / 100)
  const ids = []
  const n = 1 + Math.floor(Math.random() * 3)
  for (let i = 0; i < n; i++) { const id = upload(s, 'progress-photos', PHOTO, `progress-${i}.jpg`, 'upload_photo'); if (id) ids.push(id); think(1, 3) }
  const body = { projectId: PROJECT_ID, stageId: stg.id, pctAfter: pct, work: 'Uji beban k6 E9 (data fiktif)', photoIds: ids, clientUuid: uuid() }
  const r = http.post(`${BASE}/api/v1/progress-reports`, JSON.stringify(body), { headers: hdr(s, true, { 'Idempotency-Key': uuid() }), tags: { name: 'progress_report' } })
  // 409 PROGRESS_DECREASED = balapan dua pelapor pada tahapan yang sama (bukan error beban).
  if (rec('progress_report', r, [200, 201, 409]) && r.status !== 409) progressCreated.add(1)
}

export function officeAuth() {
  const s = ensure('OFFICE_USERS')
  if (!s) { think(10, 20); return }
  const dash = { finance: 'finance', owner: 'owner', pm: 'pm' }[s.role] || 'me'
  rec('dashboard', http.get(`${BASE}/api/v1/dashboard/${dash}`, { headers: hdr(s), tags: { name: `dashboard_${dash}` } }), [200])
  think(3, 8)
  if (s.role !== 'pm') {
    rec('approvals_inbox', http.get(`${BASE}/api/v1/approvals/inbox`, { headers: hdr(s), tags: { name: 'approvals_inbox' } }), [200])
    think(3, 8)
  }
  if (s.role === 'finance') {
    rec('transfer_queue', http.get(`${BASE}/api/v1/transfer-queue`, { headers: hdr(s), tags: { name: 'transfer_queue' } }), [200])
    think(3, 8)
    const code = ['rekap-kas', 'rekap-pengajuan', 'anggaran-project', 'buku-kas'][Math.floor(Math.random() * 4)]
    rec('report', http.get(`${BASE}/api/v1/reports/${code}`, { headers: hdr(s), tags: { name: `report_${code}` } }), [200])
  } else {
    rec('projects_progress', http.get(`${BASE}/api/v1/projects/progress`, { headers: hdr(s), tags: { name: 'projects_progress' } }), [200])
    think(3, 8)
    if (PROJECT_ID && Math.random() < 0.6) progressReport(s)
  }
  think(15, 30)
}

export function handleSummary(data) {
  return { stdout: textSummary(data), [`/out/summary${__ENV.ONLY ? '-' + __ENV.ONLY : ''}.json`]: JSON.stringify(data, null, 1) }
}

function textSummary(data) {
  const lines = [`MODE=${MODE} BASE=${BASE}`]
  for (const [k, m] of Object.entries(data.metrics)) {
    if (!k.startsWith('act_') && !['http_req_duration', 'http_reqs', 'http_req_failed', 'http_429', 'http_403_waf', 'iterations', 'sync_applied', 'sync_rejected', 'sync_other', 'progress_created', 'upload_busy_503', 'upload_gave_up'].includes(k)) continue
    const v = m.values
    if (m.type === 'trend') { if (v.count) lines.push(`${k.padEnd(24)} n=${v.count} p50=${v.med.toFixed(0)}ms p95=${v['p(95)'].toFixed(0)}ms max=${v.max.toFixed(0)}ms`) }
    else lines.push(`${k.padEnd(24)} ${JSON.stringify(v)}`)
  }
  return lines.join('\n') + '\n'
}
