// Staging load test 2026-10-09 — Q-34 mix (E9 option b) × MULT over the fictional PTs CS1 / CS2.
// Runbook: README.md · plan: docs/proyekkas/qa/staging-loadtest-2026-10-09-plan.md · method: qa/s3-e9-qa-report.md §7.
//
//   MULT=1  30 field + 5 office VUs  (lt-field-01..30, lt-office-01..05: PT CS1, 2 office accounts also map CS2)
//   MULT=3  90 field + 15 office VUs (lt-field-01..90, lt-office-01..15: CS1 + CS2)
// One VU = one account (REUSE=n lets n VUs share an account — fallback only, see plan §3.3).
// Profile: ramp RAMP → steady STEADY → ramp-down DOWN (default 1m/10m/1m for ×1, 2m/10m/1m for ×3).
//
// Accounts come from a FILE (ACCOUNTS_FILE, default /secrets/accounts.json, mode 600, owned by uid 12345), never
// from env (env is visible in `docker inspect`). Shape: { lat, lng, accounts: [{ u, p, r, cid, pid }] } where
// r = field | finance | owner | pm, cid = PT used for sync items, pid = project (field / PM / Direktur).
//
// Per VU once: password grant (proyekkas-mobile) → POST /devices/register → privacy notice ack (ADR 0018, so
// selfies / attendance are not refused PRIVACY_ACK_REQUIRED) → GET /me (checks the PT mapping).
// Field iteration: /me (+ /masters every 3rd) → 45 %: selfie 720 px + attendance check-in/out (sync) · 55 %: receipt
// photo 1600 px + Reimburse draft + draft_delete in ONE batch (cancelled at once) → own list + /dashboard/me →
// think 20–40 s. Office: dashboard → inbox → Finance: transfer queue + 1 report · Direktur/PM: projects progress +
// 60 % a progress report with 1–3 photos 1600 px → think 15–30 s.
// Images: synthetic JPEGs without EXIF (fixtures/photo.jpg 1600×1200 295 KB, selfie.jpg 720×960 84 KB). With
// UNIQUE_IMAGES=1 (default) every upload gets a random JPEG COM segment → unique sha256 like real photos (no false
// duplicate-receipt matches). UPLOADS=0 = control run without uploads/attendance (separates resize CPU, plan §6).
import http from 'k6/http'
import exec from 'k6/execution'
import { check, sleep } from 'k6'
import { Counter, Rate, Trend } from 'k6/metrics'

const BASE = (__ENV.BASE || 'https://drms-kas.staging.bimacreative.tech').replace(/\/$/, '')
const TOKEN_URL = __ENV.TOKEN_URL || 'https://auth.bimacreative.tech/realms/drms-staging/protocol/openid-connect/token'
const CLIENT_ID = __ENV.CLIENT_ID || 'proyekkas-mobile'
const MULT = Number(__ENV.MULT || 1)
const PHASE = __ENV.PHASE || `x${MULT}`
const RAMP = __ENV.RAMP || (MULT >= 3 ? '2m' : '1m')
const STEADY = __ENV.STEADY || '10m'
const DOWN = __ENV.DOWN || '1m'
const FIELD_VUS = Number(__ENV.FIELD_VUS || 30 * MULT)
const OFFICE_VUS = Number(__ENV.OFFICE_VUS || 5 * MULT)
const REUSE = Math.max(1, Number(__ENV.REUSE || 1))
const UPLOADS = __ENV.UPLOADS !== '0'
const UNIQUE_IMAGES = __ENV.UNIQUE_IMAGES !== '0'
const APP_VERSION = __ENV.APP_VERSION || '0.3.4'
const LOGIN_JITTER_S = Number(__ENV.LOGIN_JITTER_S || 5)
const OUT = __ENV.OUT_DIR || '/out'

if (!/staging|^http:\/\/(localhost|127\.0\.0\.1|pk-lt1009-)/.test(BASE) || /\/\/drms-kas\.bimacreative\.tech/.test(BASE)) {
  throw new Error(`refusing target ${BASE}: staging or a local pk-lt1009-* stack only`)
}

const PHOTO = open('../fixtures/photo.jpg', 'b')
const SELFIE = open('../fixtures/selfie.jpg', 'b')
const CFG = JSON.parse(open(__ENV.ACCOUNTS_FILE || '/secrets/accounts.json'))
const LAT = Number(__ENV.LAT || CFG.lat || 0)
const LNG = Number(__ENV.LNG || CFG.lng || 0)

// ------------------------------------------------------------------ VU → account slots
const byName = (a, b) => (a.u < b.u ? -1 : a.u > b.u ? 1 : 0)
const fieldAcc = CFG.accounts.filter((a) => a.r === 'field').sort(byName)
const officeAcc = CFG.accounts.filter((a) => a.r !== 'field').sort(byName)
function take(list, n, kind) {
  const out = []
  for (let i = 0; i < n; i++) {
    const a = list[Math.floor(i / REUSE)]
    if (!a) throw new Error(`${kind}: ${n} VUs need ${Math.ceil(n / REUSE)} accounts (REUSE=${REUSE}), the accounts file has ${list.length}`)
    out.push(a)
  }
  return out
}
const F = take(fieldAcc, FIELD_VUS, 'field')
const O = take(officeAcc, OFFICE_VUS, 'office')
// interleave office VUs over the ramp so they start throughout, not all at the end
const SLOTS = []
{
  const total = F.length + O.length
  let fi = 0
  let oi = 0
  for (let k = 0; k < total; k++) {
    if (oi < O.length && (fi >= F.length || k * O.length >= oi * total)) SLOTS.push(O[oi++])
    else SLOTS.push(F[fi++])
  }
}

// ------------------------------------------------------------------ metrics
const ACTIONS = [
  'token', 'device_register', 'privacy_ack', 'me', 'masters', 'upload_selfie', 'checkin', 'upload_receipt', 'expense_draft',
  'expense_list', 'dashboard_me', 'dashboard', 'approvals_inbox', 'transfer_queue', 'report', 'projects_progress', 'stages',
  'upload_photo', 'progress_report',
]
const T = {}
for (const n of ACTIONS) T[n] = new Trend(`act_${n}`, true)
for (const n of ['upload_selfie', 'upload_receipt', 'upload_photo']) T[`${n}_e2e`] = new Trend(`act_${n}_e2e`, true)
const errors = new Rate('act_errors')
const ratelimited = new Counter('http_429')
const wafBlocked = new Counter('http_403_waf')
const serverErrors = new Counter('http_5xx')
const uploadBusy = new Counter('upload_busy_503')
const uploadGaveUp = new Counter('upload_gave_up')
const syncApplied = new Counter('sync_applied')
const syncRejected = new Counter('sync_rejected')
const syncOther = new Counter('sync_other')
const progressCreated = new Counter('progress_created')
const vuSetupFailed = new Counter('vu_setup_failed')

// Targets (E9 AC + owner decisions 2026-09-27 P-1/P-1b): uploads and /sync/batch p95 < 5 s, everything else < 2 s.
const SLOW_OK = new Set(['upload_selfie', 'upload_receipt', 'upload_photo', 'checkin', 'expense_draft'])
// TARGET_SCALE (default 1) only for validating the "targets missed" path on a local stack — never on staging.
const TARGET_SCALE = Number(__ENV.TARGET_SCALE || 1)
export const TARGET_MS = Object.fromEntries(ACTIONS.map((n) => [n, (SLOW_OK.has(n) ? 5000 : 2000) * TARGET_SCALE]))
const thresholds = { act_errors: ['rate<0.01'] }
for (const n of ACTIONS) thresholds[`act_${n}`] = [`p(95)<${TARGET_MS[n]}`]

export const options = {
  scenarios: {
    mix: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMP, target: SLOTS.length },
        { duration: STEADY, target: SLOTS.length },
        { duration: DOWN, target: 0 },
      ],
      gracefulRampDown: '30s',
      gracefulStop: '30s',
    },
  },
  thresholds,
  tags: { phase: PHASE },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  insecureSkipTLSVerify: false,
  userAgent: 'k6-lt1009/drms-proyekkas-qa (staging load test 2026-10-09)',
  setupTimeout: '30s',
}

function rec(name, res, okStatuses) {
  T[name].add(res.timings.duration)
  const ctype = String(res.headers['Content-Type'] || '')
  // 429 source: the app answers problem+json (per-user bucket), Traefik plain text (per-source-IP bucket, plan §5)
  if (res.status === 429) ratelimited.add(1, { action: name, src: ctype.includes('json') ? 'app' : 'edge' })
  if (res.status >= 500) serverErrors.add(1, { action: name })
  if (res.status === 403 && !ctype.includes('json')) wafBlocked.add(1, { action: name })
  const ok = okStatuses.includes(res.status)
  errors.add(!ok, { action: name })
  check(res, { [`${name} ${okStatuses.join('|')}`]: () => ok })
  return ok
}
const think = (min, max) => sleep(min + Math.random() * (max - min))

function uuid() {
  const b = new Uint8Array(16)
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** JPEG with a random COM segment right after SOI (no EXIF/APPn added; sharp drops metadata anyway). */
function unique(bin) {
  if (!UNIQUE_IMAGES) return bin
  const src = new Uint8Array(bin)
  const tag = `lt1009-${uuid()}`
  const out = new Uint8Array(src.length + 4 + tag.length)
  out.set([0xff, 0xd8, 0xff, 0xfe, (tag.length + 2) >> 8, (tag.length + 2) & 0xff], 0)
  for (let i = 0; i < tag.length; i++) out[6 + i] = tag.charCodeAt(i)
  out.set(src.subarray(2), 6 + tag.length)
  return out.buffer
}

// ------------------------------------------------------------------ session per VU
let S = null // { at, rt, exp, deviceId, a }
let broken = false
let attendanceStep = 0
const seenReject = {}

function hdr(s, json, extra) {
  const h = { Authorization: `Bearer ${s.at}`, 'X-Device-Id': s.deviceId, 'X-App-Version': APP_VERSION }
  if (json) h['Content-Type'] = 'application/json'
  return Object.assign(h, extra || {})
}

function tokenReq(form) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = http.post(TOKEN_URL, form, { tags: { name: 'token' } })
    if (res.status === 429 && attempt < 3) {
      ratelimited.add(1, { action: 'token' })
      sleep(Number(res.headers['Retry-After'] || 10))
      continue
    }
    if (!rec('token', res, [200])) return null
    const j = res.json()
    return { at: j.access_token, rt: j.refresh_token, exp: Date.now() + (j.expires_in - 30) * 1000 }
  }
  return null
}

let privacyVersion = null
function login(a) {
  sleep(Math.random() * LOGIN_JITTER_S)
  const tok = tokenReq({ grant_type: 'password', client_id: CLIENT_ID, username: a.u, password: a.p, scope: 'openid' })
  if (!tok) return null
  const s = { ...tok, deviceId: uuid(), a }
  const r = http.post(`${BASE}/api/v1/devices/register`, JSON.stringify({ deviceId: s.deviceId, platform: 'android', model: 'k6-lt1009', appVersion: APP_VERSION }), { headers: hdr(s, true, { 'Idempotency-Key': uuid() }), tags: { name: 'device_register' } })
  if (!rec('device_register', r, [200, 201])) return null
  if (privacyVersion === null) {
    const pn = http.get(`${BASE}/api/v1/privacy-notice`, { tags: { name: 'privacy_notice' } })
    privacyVersion = pn.status === 200 ? pn.json('version') : 0
  }
  if (privacyVersion) {
    const ack = http.post(`${BASE}/api/v1/me/privacy-ack`, JSON.stringify({ version: privacyVersion }), { headers: hdr(s, true, { 'Idempotency-Key': uuid() }), tags: { name: 'privacy_ack' } })
    rec('privacy_ack', ack, [200])
  }
  const me = http.get(`${BASE}/api/v1/me`, { headers: hdr(s), tags: { name: 'me' } })
  if (!rec('me', me, [200])) return null
  const mapped = (me.json('companies') || []).map((c) => c.id)
  if (a.cid && !mapped.includes(a.cid)) {
    console.error(`vu=${exec.vu.idInTest} ${a.u}: PT ${a.cid} not in /me companies ${JSON.stringify(mapped)} — fixture not applied?`)
    return null
  }
  return s
}

function session() {
  if (broken) return null
  const a = SLOTS[exec.vu.idInTest - 1]
  if (!S) {
    S = login(a)
    if (!S) {
      broken = true
      vuSetupFailed.add(1)
      return null
    }
  } else if (Date.now() > S.exp) {
    const t = tokenReq({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: S.rt })
    S = t ? { ...S, ...t } : login(a)
    if (!S) {
      broken = true
      vuSetupFailed.add(1)
      return null
    }
  }
  return S
}

// 503 + Retry-After (UPLOAD_BUSY) = resize queue full (E9 P-1): wait, retry ≤ 3×. act_<x> = accepted request,
// act_<x>_e2e = including the waits; 503s are counted (upload_busy_503), not errors.
function upload(s, kind, bin, name, metric) {
  const t0 = Date.now()
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = http.post(`${BASE}/api/v1/media/${kind}`, { file: http.file(unique(bin), name, 'image/jpeg') }, { headers: hdr(s, false), tags: { name: metric } })
    let code = null
    if (res.status === 503) {
      try {
        code = res.json('code')
      } catch {
        code = null
      }
    }
    if (res.status === 503 && code === 'UPLOAD_BUSY' && attempt < 3) {
      uploadBusy.add(1, { kind })
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

const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10) // WITA (Asia/Makassar)
function item(s, type, payload) {
  return { client_uuid: uuid(), company_id: s.a.cid, type, schema_version: 1, offline: false, device_time: new Date().toISOString(), elapsed_ms: Math.floor(Date.now() % 1e9), payload }
}
function sync(s, items, metric) {
  const body = { batch_id: uuid(), device_id: s.deviceId, clock: { device_time: new Date().toISOString(), elapsed_ms: Math.floor(Date.now() % 1e9), boot_id: `k6-${exec.vu.idInTest}` }, items }
  const res = http.post(`${BASE}/api/v1/sync/batch`, JSON.stringify(body), { headers: hdr(s, true, { 'Idempotency-Key': body.batch_id }), tags: { name: metric } })
  if (rec(metric, res, [200])) {
    for (const r of res.json('results') || []) {
      if (r.status === 'applied' || r.status === 'duplicate') syncApplied.add(1, { item: metric })
      else if (r.status === 'rejected') {
        const code = (r.errors && r.errors[0] && r.errors[0].code) || '?'
        syncRejected.add(1, { item: metric, code })
        if (!seenReject[metric + code]) {
          seenReject[metric + code] = 1
          console.log(`sync ${metric} rejected ${code}: ${(r.errors[0] && r.errors[0].message) || ''}`)
        }
      } else syncOther.add(1, { item: metric })
    }
  }
}

function field(s) {
  rec('me', http.get(`${BASE}/api/v1/me`, { headers: hdr(s), tags: { name: 'me' } }), [200])
  if (exec.vu.iterationInScenario % 3 === 0) rec('masters', http.get(`${BASE}/api/v1/masters`, { headers: hdr(s), tags: { name: 'masters' } }), [200])
  think(3, 8)
  if (UPLOADS && Math.random() < 0.45 && s.a.pid) {
    const mid = upload(s, 'selfies', SELFIE, 'selfie.jpg', 'upload_selfie')
    const kind = attendanceStep % 2 === 0 ? 'attendance.check_in' : 'attendance.check_out'
    attendanceStep++
    if (mid) sync(s, [item(s, kind, { project_id: s.a.pid, lat: LAT, lng: LNG, accuracy_m: 8, is_mocked: false, selfie_media_id: mid, camera_lens: 'front' })], 'checkin')
  } else {
    const rid = UPLOADS ? upload(s, 'receipts', PHOTO, 'nota.jpg', 'upload_receipt') : null
    const amount = 25000 + 500 * Math.floor(Math.random() * 950)
    const line = { client_uuid: uuid(), description: 'Konsumsi uji beban (lump sum, fiktif)', total: amount }
    if (rid) line.receipts = [{ client_uuid: uuid(), vendor_name: `Toko Uji Beban ${1 + Math.floor(Math.random() * 999)}`, receipt_date: today(), amount, media_id: rid }]
    const up = item(s, 'expense_request.draft_upsert', { kind: 'reimburse', title: 'Uji beban k6 LT1009 (fiktif)', project_id: s.a.pid || null, lines: [line] })
    const del = { ...item(s, 'expense_request.draft_delete', { draft_client_uuid: up.client_uuid, reason: 'Data uji beban k6 LT1009' }), depends_on: [up.client_uuid] }
    sync(s, [up, del], 'expense_draft')
    think(2, 5)
    rec('expense_list', http.get(`${BASE}/api/v1/expense-requests?scope=mine&limit=20`, { headers: hdr(s), tags: { name: 'expense_list' } }), [200])
    rec('dashboard_me', http.get(`${BASE}/api/v1/dashboard/me`, { headers: hdr(s), tags: { name: 'dashboard_me' } }), [200])
  }
  think(20, 40)
}

function progressReport(s) {
  const st = http.get(`${BASE}/api/v1/projects/${s.a.pid}/stages`, { headers: hdr(s), tags: { name: 'stages' } })
  if (!rec('stages', st, [200])) return
  const open = (st.json('stages') || []).filter((x) => x.active !== false && Number(x.progressPct || 0) < 100)
  if (!open.length) return
  const stg = open[Math.floor(Math.random() * open.length)]
  const pct = Math.min(100, Math.round((Number(stg.progressPct || 0) + 0.25) * 100) / 100)
  const ids = []
  if (UPLOADS) {
    const n = 1 + Math.floor(Math.random() * 3)
    for (let i = 0; i < n; i++) {
      const id = upload(s, 'progress-photos', PHOTO, `progress-${i}.jpg`, 'upload_photo')
      if (id) ids.push(id)
      think(1, 3)
    }
  }
  const body = { projectId: s.a.pid, stageId: stg.id, pctAfter: pct, work: 'Uji beban k6 LT1009 (data fiktif)', photoIds: ids, clientUuid: uuid() }
  const r = http.post(`${BASE}/api/v1/progress-reports`, JSON.stringify(body), { headers: hdr(s, true, { 'Idempotency-Key': uuid() }), tags: { name: 'progress_report' } })
  // 409 PROGRESS_DECREASED = two reporters raced on the same stage (not a load error)
  if (rec('progress_report', r, [200, 201, 409]) && r.status !== 409) progressCreated.add(1)
}

function office(s) {
  const dash = { finance: 'finance', owner: 'owner', pm: 'pm' }[s.a.r] || 'me'
  rec('dashboard', http.get(`${BASE}/api/v1/dashboard/${dash}`, { headers: hdr(s), tags: { name: `dashboard_${dash}` } }), [200])
  think(3, 8)
  if (s.a.r !== 'pm') {
    rec('approvals_inbox', http.get(`${BASE}/api/v1/approvals/inbox`, { headers: hdr(s), tags: { name: 'approvals_inbox' } }), [200])
    think(3, 8)
  }
  if (s.a.r === 'finance') {
    rec('transfer_queue', http.get(`${BASE}/api/v1/transfer-queue`, { headers: hdr(s), tags: { name: 'transfer_queue' } }), [200])
    think(3, 8)
    const code = ['rekap-kas', 'rekap-pengajuan', 'anggaran-project', 'buku-kas'][Math.floor(Math.random() * 4)]
    rec('report', http.get(`${BASE}/api/v1/reports/${code}`, { headers: hdr(s), tags: { name: `report_${code}` } }), [200])
  } else {
    rec('projects_progress', http.get(`${BASE}/api/v1/projects/progress`, { headers: hdr(s), tags: { name: 'projects_progress' } }), [200])
    think(3, 8)
    if (s.a.pid && Math.random() < 0.6) progressReport(s)
  }
  think(15, 30)
}

export default function mix() {
  const s = session()
  if (!s) {
    sleep(30)
    return
  }
  if (s.a.r === 'field') field(s)
  else office(s)
}

// ------------------------------------------------------------------ summary
const fmt = (v) => (v === undefined || v === null ? '—' : String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ','))
export function handleSummary(data) {
  const m = data.metrics
  const rows = [`| Action | n | p50 ms | p95 ms | p99 ms | max ms | target p95 | result |`, `|---|---:|---:|---:|---:|---:|---|---|`]
  for (const n of [...ACTIONS, 'upload_selfie_e2e', 'upload_receipt_e2e', 'upload_photo_e2e']) {
    const t = m[`act_${n}`]
    if (!t || !t.values.count) continue
    const v = t.values
    const target = TARGET_MS[n] ?? TARGET_MS[n.replace('_e2e', '')]
    const pass = n.endsWith('_e2e') ? 'info' : v['p(95)'] < target ? 'PASS' : '**FAIL**'
    rows.push(`| ${n} | ${v.count} | ${fmt(v.med)} | ${fmt(v['p(95)'])} | ${fmt(v['p(99)'])} | ${fmt(v.max)} | < ${target / 1000} s | ${pass} |`)
  }
  const c = (k) => (m[k] ? m[k].values.count ?? 0 : 0)
  const reqs = m.http_reqs ? m.http_reqs.values : { count: 0, rate: 0 }
  const errRate = m.act_errors ? m.act_errors.values.rate : 0
  const lines = [
    `## k6 ${PHASE} — ${BASE}`,
    '',
    `VUs ${SLOTS.length} (field ${F.length}, office ${O.length}, REUSE ${REUSE}, UPLOADS ${UPLOADS ? 'on' : 'off'}, unique images ${UNIQUE_IMAGES ? 'on' : 'off'}) · profile ${RAMP} / ${STEADY} / ${DOWN}`,
    `Requests ${reqs.count} (${(reqs.rate || 0).toFixed(2)}/s) · **action error rate ${(errRate * 100).toFixed(2)} %** (target < 1 %) · HTTP 429 ${c('http_429')} · 403 WAF ${c('http_403_waf')} · 5xx ${c('http_5xx')}`,
    `503 UPLOAD_BUSY ${c('upload_busy_503')} (gave up ${c('upload_gave_up')}) · sync applied ${c('sync_applied')} / rejected ${c('sync_rejected')} / other ${c('sync_other')} · progress reports ${c('progress_created')} · VUs without session ${c('vu_setup_failed')}`,
    '',
    ...rows,
    '',
  ]
  const md = lines.join('\n')
  return { stdout: `${md}\n`, [`${OUT}/k6-${PHASE}.md`]: md, [`${OUT}/k6-${PHASE}.json`]: JSON.stringify(data, null, 1) }
}
