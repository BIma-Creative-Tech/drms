// MC4 QA — media access with 3 PTs (ADR 0016 MC2 note 4; docs/proyekkas/qa/mc4-qa-report.md §Perf).
// Runs NEXT TO the Q-34 mix (tests/load/q34-mix.js ONLY=field / ONLY=office, × 3 PTs): office accounts
// that hold their role in a SUBSET of the active PTs get id-list media rules, the slow path to measure.
// Per iteration (think 3–8 s between steps, like the Q-34 office mix):
//   1. GET /api/v1/expense-requests?limit=20            (media-heavy list: requests with receipts)
//   2. GET /api/v1/expense-requests/{id}                (detail: receipts with imageId)
//   3. GET /api/v1/media/receipts/{imageId}/file?variant=thumb, then the full file of one receipt
//   4. GET /api/v1/progress-reports?limit=20            (list with photo URLs) + one photo thumb
//   5. GET /api/v1/media/selfies/{id}/file              (selfie of the caller's PTs — office selfie rule)
// Env: BASE, TOKEN_URL, OFFICE_USERS='[{"u":"lt-x-fin12","r":"finance","pts":[1,2]}, …]',
//      SELFIES='{"1":[ids…],"2":[…],"3":[…]}' (selfie ids per PT), DURATION, RAMP, VUS.
// Same token/device handling as q34-mix.js (password grant + refresh, POST /devices/register).
import http from 'k6/http'
import exec from 'k6/execution'
import { check, sleep } from 'k6'
import { Trend, Rate } from 'k6/metrics'

const BASE = __ENV.BASE || 'http://pk-mc4qa-web:3000'
const TOKEN_URL = __ENV.TOKEN_URL || 'http://pk-mc4qa-idp:8080/realms/drms-perf/protocol/openid-connect/token'
const VUS = Number(__ENV.VUS || 15)
const SELFIES = JSON.parse(__ENV.SELFIES || '{}')
const T = {}
for (const n of ['token', 'device_register', 'er_list', 'er_detail', 'media_receipt_thumb', 'media_receipt_file', 'pr_list', 'media_photo_thumb', 'media_selfie_file']) T[n] = new Trend(`act_${n}`, true)
const errors = new Rate('act_errors')

export const options = {
  scenarios: {
    media: { executor: 'ramping-vus', exec: 'officeMedia', startVUs: 0, stages: [{ duration: __ENV.RAMP || '1m', target: VUS }, { duration: __ENV.DURATION || '8m', target: VUS }, { duration: '30s', target: 0 }], gracefulRampDown: '20s' },
  },
  thresholds: {
    act_media_receipt_file: ['p(95)<2000'],
    act_media_selfie_file: ['p(95)<2000'],
    act_er_list: ['p(95)<2000'],
    act_er_detail: ['p(95)<2000'],
    act_pr_list: ['p(95)<2000'],
    act_errors: ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'max', 'count'],
  userAgent: 'k6-mc4qa-media/proyekkas-qa-local',
}

function rec(name, res, ok) {
  T[name].add(res.timings.duration)
  const good = ok.includes(res.status)
  errors.add(!good)
  check(res, { [`${name} ${ok.join('|')}`]: () => good })
  return good
}
const think = (a, b) => sleep(a + Math.random() * (b - a))
function uuid() {
  const h = [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

let s = null
function tokenReq(form) {
  const r = http.post(TOKEN_URL, form, { tags: { name: 'token' } })
  if (!rec('token', r, [200])) return null
  const j = r.json()
  return { at: j.access_token, rt: j.refresh_token, exp: Date.now() + (j.expires_in - 30) * 1000 }
}
function hdr(json) {
  const h = { Authorization: `Bearer ${s.at}`, 'X-Device-Id': s.deviceId, 'X-App-Version': '1.0.0' }
  if (json) h['Content-Type'] = 'application/json'
  return h
}
function ensure() {
  const list = JSON.parse(__ENV.OFFICE_USERS || '[]')
  if (!s) {
    const u = list[(exec.vu.idInTest - 1) % list.length]
    sleep(Math.random() * 20)
    const t = tokenReq({ grant_type: 'password', client_id: 'proyekkas-mobile', username: u.u, password: 'local', scope: 'openid' })
    if (!t) return null
    s = { ...t, deviceId: uuid(), u }
    rec('device_register', http.post(`${BASE}/api/v1/devices/register`, JSON.stringify({ deviceId: s.deviceId, platform: 'android', model: 'k6-mc4qa', appVersion: '1.0.0' }), { headers: hdr(true), tags: { name: 'device_register' } }), [200, 201])
  } else if (Date.now() > s.exp) {
    const t = tokenReq({ grant_type: 'refresh_token', client_id: 'proyekkas-mobile', refresh_token: s.rt })
    if (t) s = { ...s, ...t }
  }
  return s
}

export function officeMedia() {
  if (!ensure()) { think(5, 10); return }
  const list = http.get(`${BASE}/api/v1/expense-requests?limit=20`, { headers: hdr(), tags: { name: 'er_list' } })
  if (rec('er_list', list, [200])) {
    const items = list.json('items') || list.json('docs') || []
    if (items.length) {
      think(2, 5)
      const pick = items[Math.floor(Math.random() * items.length)]
      const d = http.get(`${BASE}/api/v1/expense-requests/${pick.id}`, { headers: hdr(), tags: { name: 'er_detail' } })
      if (rec('er_detail', d, [200])) {
        const lines = d.json('lines') || []
        const imgs = []
        for (const l of lines) for (const r of l.receipts || []) if (r.imageId) imgs.push(r.imageId)
        for (const r of d.json('receipts') || []) if (r.imageId) imgs.push(r.imageId)
        for (const id of imgs.slice(0, 3)) rec('media_receipt_thumb', http.get(`${BASE}/api/v1/media/receipts/${id}/file?variant=thumb`, { headers: hdr(), tags: { name: 'media_receipt_thumb' } }), [200])
        if (imgs.length) { think(1, 3); rec('media_receipt_file', http.get(`${BASE}/api/v1/media/receipts/${imgs[0]}/file`, { headers: hdr(), tags: { name: 'media_receipt_file' } }), [200]) }
      }
    }
  }
  think(3, 8)
  const pr = http.get(`${BASE}/api/v1/progress-reports?limit=20`, { headers: hdr(), tags: { name: 'pr_list' } })
  if (rec('pr_list', pr, [200])) {
    const reps = pr.json('items') || []
    const ph = reps.flatMap((r) => r.photos || [])
    if (ph.length) rec('media_photo_thumb', http.get(`${BASE}${ph[Math.floor(Math.random() * ph.length)].thumbUrl}`, { headers: hdr(), tags: { name: 'media_photo_thumb' } }), [200])
  }
  think(3, 8)
  const pts = s.u.pts || []
  const pool = SELFIES[String(pts[Math.floor(Math.random() * pts.length)])] || []
  if (pool.length) rec('media_selfie_file', http.get(`${BASE}/api/v1/media/selfies/${pool[Math.floor(Math.random() * pool.length)]}/file`, { headers: hdr(), tags: { name: 'media_selfie_file' } }), [200])
  think(10, 20)
}

export function handleSummary(data) {
  const lines = []
  for (const [k, m] of Object.entries(data.metrics)) {
    if (!k.startsWith('act_') && !['http_reqs', 'http_req_failed', 'iterations'].includes(k)) continue
    const v = m.values
    if (m.type === 'trend') { if (v.count) lines.push(`${k.padEnd(26)} n=${v.count} p50=${v.med.toFixed(0)}ms p95=${v['p(95)'].toFixed(0)}ms max=${v.max.toFixed(0)}ms`) } else lines.push(`${k.padEnd(26)} ${JSON.stringify(v)}`)
  }
  return { stdout: lines.join('\n') + '\n', '/out/summary-media.json': JSON.stringify(data, null, 1) }
}
