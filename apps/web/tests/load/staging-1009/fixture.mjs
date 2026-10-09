#!/usr/bin/env node
// Staging load test 2026-10-09 — FIXTURE for the fictional accounts and PTs (runbook: README.md, plan:
// docs/proyekkas/qa/staging-loadtest-2026-10-09-plan.md). Node ≥ 24, no dependencies. Runs in a throwaway
// container started by run.sh (node is not installed on the host).
//
//   node fixture.mjs plan              dry run (default): logins + reads only, lists what apply would do
//   node fixture.mjs apply             re-activates / creates the fixture, writes roster.json + state.json
//   node fixture.mjs stats             counts of what the run created in the fictional PTs (reads only)
//   node fixture.mjs cleanup           dry run of the cleanup
//   node fixture.mjs cleanup --commit  cancels leftover drafts, archives the projects, deactivates employees,
//                                      memberships, app accounts (→ the app disables their Keycloak accounts)
//                                      and the PTs; restores the PT flags it changed
//
// SAFETY
// - Every write goes through the app (Payload REST with a real web session, /api/v1 with a password-grant
//   token + registered device), never raw SQL, never the Keycloak admin API.
// - Accounts: ONLY admin.uji + lt-field-NN / lt-office-NN @proyekkas.test (regex below). Every account must
//   already exist in Keycloak (preflight: password grant OK or "Account disabled"), so the app's users-sync only
//   links / re-enables — it never creates a Keycloak user and never sends an e-mail.
// - PTs: ONLY the fictional CS1 / CS2 (matched by short code AND name; a mismatch aborts). PT DRMS (real client
//   data) is only READ to prove the group-admin right and to find the lt-* DRMS memberships, which are
//   deactivated if active (so no fictional account can read DRMS data during the run).
// - Target guard: "staging" (https, host contains "staging", never the prod host) or "local" (pk-lt1009-*).
// - Secrets: passwords only from LT_PW_FILE (CSV email,password; mode 600). Tokens, cookies and passwords are
//   never printed or written. Output files carry ids, e-mails of fictional accounts and status codes only.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const env = (k, d) => (process.env[k] ?? '').trim() || d
const mode = process.argv[2] ?? 'plan'
const flags = new Set(process.argv.slice(3))
if (!['plan', 'apply', 'stats', 'cleanup'].includes(mode)) {
  console.error('usage: fixture.mjs plan|apply|stats|cleanup [--commit]')
  process.exit(2)
}
const write = mode === 'apply' || (mode === 'cleanup' && flags.has('--commit'))

// ---------------------------------------------------------------- config
const CFG = {
  target: env('LT_TARGET', ''),
  appUrl: env('LT_APP_URL', '').replace(/\/$/, ''),
  kcUrl: env('LT_KC_URL', '').replace(/\/$/, ''),
  realm: env('LT_REALM', 'drms-staging'),
  mobileClient: env('LT_MOBILE_CLIENT', 'proyekkas-mobile'),
  pwFile: env('LT_PW_FILE', '/secrets/pw.csv'),
  out: env('LT_OUT', '/out'),
  appVersion: env('LT_APP_VERSION', '0.3.4'),
  domain: env('LT_DOMAIN', 'proyekkas.test'),
  admin: env('LT_ADMIN_EMAIL', 'admin.uji@proyekkas.test'),
  prodHost: env('LT_PROD_HOST', 'drms-kas.bimacreative.tech'),
  tokenPaceMs: Number(env('LT_TOKEN_PACE_MS', '1100')),
  reason: env('LT_REASON', 'Uji beban staging 2026-10-09 (data fiktif, tests/load/staging-1009)'),
}
CFG.https = CFG.appUrl.startsWith('https://')
CFG.webPaceMs = Number(env('LT_WEB_PACE_MS', CFG.https ? '10000' : '0'))
CFG.sessionCookie = CFG.https ? '__Host-pk_session' : 'pk_session'

const FICTIONAL = new RegExp(`^(lt-(field|office)-\\d{2}@${CFG.domain.replace(/\./g, '\\.')}|admin2?\\.uji@proyekkas\\.test)$`)

// ---------------------------------------------------------------- roster (plan §3)
export const GEO = { lat: Number(env('LT_LAT', '-3.32')), lng: Number(env('LT_LNG', '114.59')), radiusM: 200 }
const PTS = {
  CS1: { code: 'CS1', name: env('LT_CS1_NAME', 'PT Contoh Sejahtera Uji'), mustExist: env('LT_CS1_MUST_EXIST', '1') === '1' },
  CS2: { code: 'CS2', name: env('LT_CS2_NAME', 'PT Contoh Sejahtera Uji 2'), mustExist: false, copyFrom: 'CS1' },
}
const PROJECTS = [
  { code: 'PRJ-LT-CS1-01', pt: 'CS1', name: 'Proyek Uji Beban CS1-01', pm: 'lt-office-05', dir: 'lt-office-03' },
  { code: 'PRJ-LT-CS1-02', pt: 'CS1', name: 'Proyek Uji Beban CS1-02', pm: 'lt-office-15', dir: 'lt-office-03' },
  { code: 'PRJ-LT-CS2-01', pt: 'CS2', name: 'Proyek Uji Beban CS2-01', pm: 'lt-office-14', dir: 'lt-office-10' },
]
const STAGES = [
  { name: 'Persiapan', weightPct: 20, sequence: 1 },
  { name: 'Struktur', weightPct: 30, sequence: 2 },
  { name: 'Finishing', weightPct: 50, sequence: 3 },
]
const OFFICE = {
  '01': { r: 'finance', pts: ['CS1'], tier: 1 },
  '02': { r: 'finance', pts: ['CS1', 'CS2'], tier: 1 },
  '03': { r: 'owner', pts: ['CS1'], tier: 1, prj: 'PRJ-LT-CS1-01' },
  '04': { r: 'owner', pts: ['CS1', 'CS2'], tier: 1, prj: 'PRJ-LT-CS1-01' },
  '05': { r: 'pm', pts: ['CS1'], tier: 1, prj: 'PRJ-LT-CS1-01' },
  '06': { r: 'finance', pts: ['CS2'], tier: 3 },
  '07': { r: 'finance', pts: ['CS1'], tier: 3 },
  '08': { r: 'finance', pts: ['CS2'], tier: 3 },
  '09': { r: 'finance', pts: ['CS1', 'CS2'], tier: 3 },
  10: { r: 'owner', pts: ['CS2'], tier: 3, prj: 'PRJ-LT-CS2-01' },
  11: { r: 'owner', pts: ['CS1'], tier: 3, prj: 'PRJ-LT-CS1-02' },
  12: { r: 'owner', pts: ['CS2'], tier: 3, prj: 'PRJ-LT-CS2-01' },
  13: { r: 'owner', pts: ['CS1', 'CS2'], tier: 3, prj: 'PRJ-LT-CS2-01' },
  14: { r: 'pm', pts: ['CS2'], tier: 3, prj: 'PRJ-LT-CS2-01' },
  15: { r: 'pm', pts: ['CS1'], tier: 3, prj: 'PRJ-LT-CS1-02' },
}
const ROLE = { field: 'pk-staff', finance: 'pk-finance', owner: 'pk-owner', pm: 'pk-pm' }
const pad = (n) => String(n).padStart(2, '0')
function parseIds(spec, max) {
  const out = new Set()
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [a, b] = part.split('-').map(Number)
    for (let i = a; i <= (b || a); i++) if (i >= 1 && i <= max) out.add(i)
  }
  return [...out].sort((x, y) => x - y)
}
/** The accounts of this run. LT_FIELD_IDS / LT_OFFICE_IDS narrow it (local validation only). */
export function roster() {
  const list = []
  for (const n of parseIds(env('LT_FIELD_IDS', '1-90'), 90)) {
    const prj = n <= 30 ? 'PRJ-LT-CS1-01' : n <= 45 ? 'PRJ-LT-CS1-02' : 'PRJ-LT-CS2-01'
    const pt = n <= 45 ? 'CS1' : 'CS2'
    list.push({ key: `lt-field-${pad(n)}`, email: `lt-field-${pad(n)}@${CFG.domain}`, r: 'field', pts: [pt], prj, tier: n <= 30 ? 1 : 3, emp: { [pt]: `LT-${pt}-F${pad(n)}` } })
  }
  for (const n of parseIds(env('LT_OFFICE_IDS', '1-15'), 15)) {
    const o = OFFICE[pad(n)] ?? OFFICE[n]
    const emp = o.r === 'pm' ? { [o.pts[0]]: `LT-${o.pts[0]}-O${pad(n)}` } : {}
    list.push({ key: `lt-office-${pad(n)}`, email: `lt-office-${pad(n)}@${CFG.domain}`, r: o.r, pts: o.pts, prj: o.prj ?? null, tier: o.tier, emp })
  }
  return list
}

// ---------------------------------------------------------------- output + guards
const summary = { mode, write, target: CFG.target, appUrl: CFG.appUrl, at: new Date().toISOString(), actions: [], warnings: [] }
const act = (what) => {
  summary.actions.push(what)
  console.log(`${write ? '' : '[dry-run] '}${what}`)
}
const warn = (what) => {
  summary.warnings.push(what)
  console.log(`WARN ${what}`)
}
function die(m) {
  console.error(`FIXTURE STOPPED: ${m}`)
  try {
    summary.stopped = m
    writeFileSync(join(CFG.out, `fixture-${mode}${write ? '' : '-dry'}.json`), `${JSON.stringify(summary, null, 2)}\n`)
  } catch {
    /* out dir missing */
  }
  process.exit(1)
}
function guard() {
  if (!CFG.appUrl || !CFG.kcUrl) die('LT_APP_URL and LT_KC_URL are required')
  const host = new URL(CFG.appUrl).hostname
  if (host === CFG.prodHost || /^drms-kas\.bimacreative\.tech$/i.test(host)) die(`refusing the PROD host ${host}`)
  if (CFG.target === 'staging') {
    if (!host.includes('staging')) die(`staging target but host "${host}" is not a staging host`)
    if (!CFG.https) die('staging must be https')
    if (CFG.realm !== 'drms-staging') die(`staging target but realm "${CFG.realm}" is not drms-staging`)
  } else if (CFG.target === 'local') {
    if (!/^(localhost|127\.0\.0\.1|pk-lt1009-[a-z0-9-]+)$/.test(host)) die(`local target but host "${host}" is not a pk-lt1009-* throwaway host`)
  } else die('LT_TARGET must be "staging" or "local"')
  if (!existsSync(CFG.pwFile)) die(`no password file at ${CFG.pwFile}`)
  mkdirSync(CFG.out, { recursive: true })
}
guard()

const PW = new Map()
for (const line of readFileSync(CFG.pwFile, 'utf8').split(/\r?\n/)) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf(',')
  if (i < 0) continue
  const email = t.slice(0, i).trim().toLowerCase()
  if (email === 'email') continue // header
  PW.set(email, t.slice(i + 1).trim())
}
try {
  if ((statSync(CFG.pwFile).mode & 0o077) !== 0) warn('password file is readable by group/other — run.sh copies it with mode 600')
} catch {
  /* ignore */
}
const password = (email) => {
  const p = PW.get(email)
  if (!p) die(`no password for ${email} in the password file`)
  return p
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const statePath = join(CFG.out, 'state.json')
const loadState = () => {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'))
  } catch {
    return {}
  }
}
const saveState = (patch) => writeFileSync(statePath, `${JSON.stringify({ ...loadState(), ...patch }, null, 2)}\n`)
function brief(r) {
  const b = r?.body && typeof r.body === 'object' ? r.body : {}
  const errs = Array.isArray(b.errors) ? b.errors.slice(0, 3).map((e) => `${e.path ?? e.field ?? ''}:${e.code ?? ''}:${String(e.message ?? '').slice(0, 80)}`) : undefined
  return JSON.stringify({ status: r?.status, code: b.code, detail: typeof b.detail === 'string' ? b.detail.slice(0, 160) : undefined, errors: errs })
}

// ---------------------------------------------------------------- HTTP (same paths as the MC4 UAT suite lib.mjs)
let lastToken = 0
let lastWeb = 0
async function pace(kind) {
  const last = kind === 'web' ? lastWeb : lastToken
  const ms = kind === 'web' ? CFG.webPaceMs : CFG.tokenPaceMs
  const wait = last + ms - Date.now()
  if (wait > 0) await sleep(wait)
  if (kind === 'web') lastWeb = Date.now()
  else lastToken = Date.now()
}
async function parse(res) {
  const text = await res.text()
  let body = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    /* not json */
  }
  return { status: res.status, body, headers: res.headers }
}
const decodeHtml = (s) => s.replace(/&amp;/g, '&').replace(/&#x3D;/gi, '=').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
class Jar {
  constructor() {
    this.c = new Map()
  }
  set(url, res) {
    const host = new URL(url).host
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [nv, ...attrs] = sc.split(';')
      const i = nv.indexOf('=')
      if (i < 0) continue
      const name = nv.slice(0, i).trim()
      const value = nv.slice(i + 1).trim()
      const m = this.c.get(host) ?? new Map()
      if (attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === '') m.delete(name)
      else m.set(name, value)
      this.c.set(host, m)
    }
  }
  header(url) {
    return [...(this.c.get(new URL(url).host) ?? new Map())].map(([k, v]) => `${k}=${v}`).join('; ')
  }
  get(url, name) {
    return this.c.get(new URL(url).host)?.get(name)
  }
}

class Account {
  constructor(email) {
    this.email = email
    this.jar = new Jar()
    this.tok = null
    this.deviceId = null
    this.sessionOk = false
  }
  /** → { ok, disabled, roles } ; never throws for a refused login. */
  async tokenGrant() {
    for (let attempt = 0; ; attempt++) {
      await pace('token')
      const body = new URLSearchParams({ grant_type: 'password', client_id: CFG.mobileClient, username: this.email, password: password(this.email), scope: 'openid' })
      const r = await fetch(`${CFG.kcUrl}/realms/${CFG.realm}/protocol/openid-connect/token`, { method: 'POST', body })
      if (r.status === 429 && attempt < 3) {
        await r.arrayBuffer()
        await sleep(Number(r.headers.get('retry-after') ?? 20) * 1000)
        continue
      }
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.access_token) {
        this.tok = { at: j.access_token, rt: j.refresh_token, exp: Date.now() + (j.expires_in - 30) * 1000 }
        const p = JSON.parse(Buffer.from(j.access_token.split('.')[1], 'base64url').toString('utf8'))
        return { ok: true, disabled: false, roles: p.realm_access?.roles ?? [] }
      }
      return { ok: false, disabled: /disabled/i.test(j.error_description ?? ''), status: r.status, error: `${j.error ?? ''} ${j.error_description ?? ''}`.trim() }
    }
  }
  async bearer() {
    if (!this.tok || Date.now() > this.tok.exp) {
      const g = await this.tokenGrant()
      if (!g.ok) die(`login of ${this.email} failed: HTTP ${g.status} ${g.error}`)
    }
    return this.tok.at
  }
  async ensureDevice() {
    if (this.deviceId) return this.deviceId
    const at = await this.bearer()
    const deviceId = randomUUID()
    const r = await fetch(`${CFG.appUrl}/api/v1/devices/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${at}`, 'X-Device-Id': deviceId, 'X-App-Version': CFG.appVersion, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ deviceId, platform: 'android', model: 'LT1009 fixture', appVersion: CFG.appVersion }),
    })
    if (r.status !== 201 && r.status !== 200) die(`device register for ${this.email}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`)
    this.deviceId = deviceId
    return deviceId
  }
  async v1(method, path, opts = {}) {
    const at = await this.bearer()
    const dev = await this.ensureDevice()
    const headers = { Authorization: `Bearer ${at}`, 'X-Device-Id': dev, 'X-App-Version': CFG.appVersion, ...(opts.headers ?? {}) }
    let body
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(opts.json)
    }
    if (method !== 'GET' && !headers['Idempotency-Key']) headers['Idempotency-Key'] = randomUUID()
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${CFG.appUrl}/api/v1${path}`, { method, headers, body })
      if (res.status === 429 && attempt < 3) {
        await res.arrayBuffer()
        await sleep(Number(res.headers.get('retry-after') ?? 20) * 1000)
        continue
      }
      return parse(res)
    }
  }
  async fetchJar(url, init = {}) {
    const headers = { ...(init.headers ?? {}) }
    const cookie = this.jar.header(url)
    if (cookie) headers.Cookie = cookie
    const res = await fetch(url, { ...init, headers, redirect: 'manual' })
    this.jar.set(url, res)
    return res
  }
  async webLogin() {
    if (this.sessionOk) return
    await pace('web')
    let url = `${CFG.appUrl}/auth/login?returnTo=%2Fadmin`
    let res = await this.fetchJar(url)
    for (let hop = 0; hop < 8 && res.status >= 300 && res.status < 400; hop++) {
      url = new URL(res.headers.get('location'), url).toString()
      if (url.startsWith(`${CFG.appUrl}/auth/callback`)) break
      res = await this.fetchJar(url)
    }
    if (!url.startsWith(`${CFG.appUrl}/auth/callback`)) {
      const html = await res.text()
      const form = /<form[^>]*id="kc-form-login"[^>]*>/i.exec(html)?.[0] ?? ''
      const action = /action="([^"]+)"/i.exec(form)?.[1]
      if (!action) die(`web login ${this.email}: Keycloak login form not found (HTTP ${res.status})`)
      res = await this.fetchJar(decodeHtml(action), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: this.email, password: password(this.email), credentialId: '' }).toString(),
      })
      if (res.status < 300 || res.status >= 400) die(`web login ${this.email}: Keycloak answered HTTP ${res.status} (required action / wrong password?)`)
      url = new URL(res.headers.get('location'), url).toString()
    }
    res = await this.fetchJar(url)
    if (res.status !== 302 || !this.jar.get(CFG.appUrl, CFG.sessionCookie)) die(`web login ${this.email}: app callback HTTP ${res.status}`)
    await res.arrayBuffer()
    this.sessionOk = true
  }
  async rest(method, path, json) {
    await this.webLogin()
    const headers = { Origin: CFG.appUrl, Accept: 'application/json', Cookie: this.jar.header(CFG.appUrl) }
    let body
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(json)
    }
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${CFG.appUrl}${path}`, { method, headers, body, redirect: 'manual' })
      if (res.status === 429 && attempt < 3) {
        await res.arrayBuffer()
        await sleep(Number(res.headers.get('retry-after') ?? 20) * 1000)
        continue
      }
      return parse(res)
    }
  }
}

// ---------------------------------------------------------------- REST helpers
const qs = (o) => new URLSearchParams({ depth: '0', limit: '100', ...o }).toString()
async function find(acc, collection, w) {
  const r = await acc.rest('GET', `/api/${collection}?${qs(w)}`)
  if (r.status !== 200) die(`read ${collection} as ${acc.email}: ${brief(r)}`)
  return r.body.docs
}
async function count(acc, collection, w) {
  const r = await acc.rest('GET', `/api/${collection}?${qs({ ...w, limit: '1' })}`)
  return r.status === 200 ? r.body.totalDocs : `HTTP ${r.status}`
}
async function create(acc, collection, data, label) {
  if (!write) {
    act(`would create ${collection} ${label}`)
    return null
  }
  const r = await acc.rest('POST', `/api/${collection}?depth=0`, data)
  if (r.status !== 201) die(`create ${collection} ${label} as ${acc.email}: ${brief(r)}`)
  act(`created ${collection} ${label} id=${r.body.doc.id}`)
  return r.body.doc
}
async function patch(acc, collection, id, data, label) {
  if (!write) {
    act(`would update ${collection} ${label} id=${id} ${JSON.stringify(data)}`)
    return null
  }
  const r = await acc.rest('PATCH', `/api/${collection}/${id}?depth=0`, { ...data, changeReason: CFG.reason })
  if (r.status !== 200) die(`update ${collection} ${label} as ${acc.email}: ${brief(r)}`)
  act(`updated ${collection} ${label} id=${id} ${JSON.stringify(data)}`)
  return r.body.doc
}
async function membershipBatch(adminAcc, items, label) {
  for (let i = 0; i < items.length; i += 50) {
    const chunk = items.slice(i, i + 50)
    if (write) {
      const r = await adminAcc.v1('POST', '/company-memberships/batch', { json: { reason: CFG.reason, items: chunk } })
      if (r.status !== 200) die(`membership batch (${label}): ${brief(r)}`)
    }
    act(`${write ? '' : 'would '}save ${chunk.length} memberships (${label})`)
  }
}

// Fields of a fictional PT this run switches on/off for the window (restored by cleanup).
const PT_FLAGS = {
  syncAttendanceEnabled: true,
  syncProgressReportsEnabled: true,
  syncExpenseDraftsEnabled: true,
  remindersEnabled: false,
  approvalEmailEnabled: false,
  notifyRequesterStatusEnabled: false,
}

// ---------------------------------------------------------------- 0. preflight
const R = roster()
for (const a of [CFG.admin, ...R.map((x) => x.email)]) if (!FICTIONAL.test(a)) die(`not a fictional account: ${a}`)
const ADMIN = new Account(CFG.admin)
const A = Object.fromEntries(R.map((x) => [x.key, new Account(x.email)]))

const ag = await ADMIN.tokenGrant()
if (!ag.ok) die(`${CFG.admin} cannot log in (HTTP ${ag.status} ${ag.error}) — owner step O-1 / infra step I-2 not done (plan §4)`)
if (!ag.roles.includes('pk-user')) die(`${CFG.admin} token has no pk-user (MC4-01 regression?)`)
const meR = await ADMIN.v1('GET', '/me')
if (meR.status !== 200) die(`${CFG.admin} /me: ${brief(meR)} — owner step O-1 (Aktif + Admin grup) not done`)
const me = meR.body
const drms = (await find(ADMIN, 'companies', { 'where[shortCode][equals]': 'DRMS' }))[0]
if (!drms) die(`${CFG.admin} cannot read PT DRMS → it is not a group admin (owner step O-1: tick "Admin grup (semua PT)")`)
console.log(`preflight: ${CFG.admin} = app user ${me.id}, group admin, PTs ${JSON.stringify(me.companies.map((c) => c.code))}`)

// ---------------------------------------------------------------- stats (reads only)
async function ptIds() {
  const ids = {}
  for (const [k, p] of Object.entries(PTS)) {
    const c = (await find(ADMIN, 'companies', { 'where[shortCode][equals]': p.code }))[0]
    if (c && c.name !== p.name) die(`PT ${p.code} exists with another name — not the fictional fixture, refusing`)
    if (c) ids[k] = c.id
  }
  return ids
}
if (mode === 'stats') {
  const ids = await ptIds()
  const since = env('LT_SINCE', new Date(Date.now() - 6 * 3600_000).toISOString())
  const inPts = { 'where[company][in]': Object.values(ids).join(','), 'where[createdAt][greater_than_equal]': since }
  const out = { since, pts: ids, counts: {} }
  for (const col of ['expense-requests', 'attendances', 'progress-reports', 'devices', 'media-receipts', 'media-selfies', 'media-progress-photos']) {
    const since0 = { 'where[createdAt][greater_than_equal]': since }
    // media rows carry `ownerCompany` (derived by DB trigger once linked to a request / attendance / report)
    const w = col === 'devices' ? since0 : col.startsWith('media-') ? { ...since0, 'where[ownerCompany][in]': Object.values(ids).join(',') } : inPts
    out.counts[col] = await count(ADMIN, col, w)
  }
  for (const st of ['draft', 'cancelled']) out.counts[`expense-requests:${st}`] = await count(ADMIN, 'expense-requests', { ...inPts, 'where[status][equals]': st })
  writeFileSync(join(CFG.out, 'fixture-stats.json'), `${JSON.stringify(out, null, 2)}\n`)
  console.log(`STATS ${JSON.stringify(out)}`)
  process.exit(0)
}

// Every lt account must exist in Keycloak BEFORE any app write (otherwise users-sync would create it + mail).
const kcState = {}
let nOk = 0
for (const x of mode === 'cleanup' ? [] : R) {
  const g = await A[x.key].tokenGrant()
  if (g.ok) {
    if (!g.roles.includes('pk-user') && mode !== 'cleanup') warn(`${x.email} logs in without realm role pk-user (the app adds it when the account is saved)`)
    kcState[x.key] = 'enabled'
    nOk++
  } else if (g.disabled) kcState[x.key] = 'disabled'
  else die(`${x.email}: HTTP ${g.status} ${g.error} — Keycloak account missing or password file wrong (infra request I-2)`)
}
if (mode !== 'cleanup') console.log(`preflight: ${R.length} lt accounts exist in Keycloak (${nOk} enabled, ${R.length - nOk} disabled → re-enabled by the app)`)

// ---------------------------------------------------------------- cleanup
if (mode === 'cleanup') {
  const ids = await ptIds()
  const st = loadState()
  const cids = Object.values(ids)
  if (!cids.length) die('no fictional PT found — nothing to clean up')
  // a) leftover drafts of the run (requests in CS1/CS2 still in status draft) → cancelled through the owner's sync
  const drafts = await find(ADMIN, 'expense-requests', { 'where[company][in]': cids.join(','), 'where[status][equals]': 'draft', limit: '500' })
  const byUser = new Map()
  for (const d of drafts) {
    const u = typeof d.createdBy === 'object' ? d.createdBy?.id : d.createdBy
    if (!byUser.has(u)) byUser.set(u, [])
    byUser.get(u).push(d)
  }
  const users = await find(ADMIN, 'users', { 'where[email][in]': R.map((x) => x.email).join(','), limit: '200' })
  const emailOf = new Map(users.map((u) => [u.id, u.email]))
  for (const [uid, list] of byUser) {
    const email = emailOf.get(uid)
    const x = R.find((y) => y.email === email)
    if (!x) {
      warn(`${list.length} draft(s) in the fictional PTs belong to a non-roster user ${uid} — left untouched`)
      continue
    }
    if (!write) {
      act(`would cancel ${list.length} leftover draft(s) of ${email}`)
      continue
    }
    const items = list.map((d) => ({ client_uuid: randomUUID(), company_id: typeof d.company === 'object' ? d.company.id : d.company, type: 'expense_request.draft_delete', schema_version: 1, offline: false, device_time: new Date().toISOString(), elapsed_ms: 1, payload: { request_id: d.id, reason: CFG.reason } }))
    const r = await A[x.key].v1('POST', '/sync/batch', { json: { batch_id: randomUUID(), device_id: await A[x.key].ensureDevice(), clock: { device_time: new Date().toISOString(), elapsed_ms: 1, boot_id: 'lt1009-cleanup' }, items } })
    act(`cancel ${list.length} leftover draft(s) of ${email}: HTTP ${r.status} ${JSON.stringify((r.body?.results ?? []).map((i) => i.status))}`)
  }
  if (!drafts.length) console.log('no leftover drafts in the fictional PTs')
  // b) projects → archived by the PT's Direktur (projects are Direktur-only)
  for (const p of PROJECTS) {
    if (!ids[p.pt] || !A[p.dir]) continue
    const hit = (await find(ADMIN, 'projects', { 'where[company][equals]': ids[p.pt], 'where[code][equals]': p.code }))[0]
    if (hit && hit.status !== 'arsip') await patch(A[p.dir], 'projects', hit.id, { status: 'arsip' }, p.code)
  }
  // c) employees LT-*
  for (const [k, cid] of Object.entries(ids)) {
    for (const e of await find(ADMIN, 'employees', { 'where[company][equals]': cid, 'where[code][like]': `LT-${k}-`, limit: '200' })) {
      if (e.active !== false && String(e.code).startsWith(`LT-${k}-`)) await patch(ADMIN, 'employees', e.id, { active: false }, e.code)
    }
  }
  // d) memberships of the lt accounts in CS1/CS2, then e) their app accounts (users-sync disables Keycloak + logout)
  const uids = users.map((u) => u.id)
  const ms = uids.length ? await find(ADMIN, 'company-memberships', { 'where[user][in]': uids.join(','), limit: '500' }) : []
  const off = ms.filter((m) => cids.includes(m.company) && m.active !== false).map((m) => ({ user: m.user, company: m.company, roles: m.roles, active: false }))
  if (off.length) await membershipBatch(ADMIN, off, 'lt accounts in CS1/CS2 → inactive')
  for (const u of users) if (u.active !== false) await patch(ADMIN, 'users', u.id, { active: false }, `${u.email} (the app disables the Keycloak account)`)
  // f) PT flags restored, PTs deactivated (CS2 first), g) admin.uji memberships of CS1/CS2 last
  for (const k of ['CS2', 'CS1']) {
    if (!ids[k]) continue
    const before = st.ptFlagsBefore?.[k]
    if (before && Object.keys(before).length) await patch(ADMIN, 'companies', ids[k], before, `${k} flags restored`)
    const c = (await find(ADMIN, 'companies', { 'where[id][equals]': ids[k] }))[0]
    if (c?.active !== false) await patch(ADMIN, 'companies', ids[k], { active: false }, k)
  }
  const am = await find(ADMIN, 'company-memberships', { 'where[user][equals]': me.id, limit: '50' })
  const amOff = am.filter((m) => cids.includes(m.company) && m.active !== false).map((m) => ({ user: me.id, company: m.company, roles: m.roles, active: false }))
  if (amOff.length) await membershipBatch(ADMIN, amOff, `${CFG.admin} in CS1/CS2 → inactive`)
  console.log(`cleanup ${write ? 'done' : 'planned (add --commit)'}. LEFT TO THE OWNER: ${CFG.admin} → untick "Admin grup" + "Aktif" (plan §4 O-3).`)
  writeFileSync(join(CFG.out, `fixture-cleanup${write ? '' : '-dry'}.json`), `${JSON.stringify(summary, null, 2)}\n`)
  process.exit(0)
}

// ---------------------------------------------------------------- 1. admin.uji: no active DRMS membership (owner condition 2026-10-02)
const adminMs = await find(ADMIN, 'company-memberships', { 'where[user][equals]': me.id, limit: '50' })
const adminDrms = adminMs.filter((m) => m.company === drms.id && m.active !== false)
if (adminDrms.length) await membershipBatch(ADMIN, adminDrms.map((m) => ({ user: me.id, company: drms.id, roles: m.roles, active: false })), `${CFG.admin} DRMS membership → inactive`)

// ---------------------------------------------------------------- 2. PTs CS1 (re-activate) + CS2 (create, defaults copied from CS1)
const ptId = {}
const flagsBefore = loadState().ptFlagsBefore ?? {}
for (const [k, p] of Object.entries(PTS)) {
  let c = (await find(ADMIN, 'companies', { 'where[shortCode][equals]': p.code }))[0]
  if (c && c.name !== p.name) die(`a PT with short code ${p.code} exists and is not the fictional fixture (name differs) — refusing`)
  if (!c && p.mustExist) die(`PT ${p.code} "${p.name}" not found — expected the deactivated MC4 UAT fixture`)
  if (!c) {
    const from = p.copyFrom ? ptId[p.copyFrom] : undefined
    c = await create(ADMIN, 'companies', { shortCode: p.code, name: p.name, legalName: p.name, timezone: 'Asia/Makassar', active: true, copyDefaults: true, ...(from ? { copyDefaultsFrom: from } : {}), pdfHeader: `${p.name}\nData uji fiktif — bukan dokumen resmi`, ...PT_FLAGS }, `${p.code} "${p.name}"${from ? ` (copy defaults from ${p.copyFrom})` : ''}`)
    if (c) flagsBefore[k] = { active: false }
  } else {
    if (!flagsBefore[k]) flagsBefore[k] = Object.fromEntries(Object.keys(PT_FLAGS).map((f) => [f, c[f] ?? null]))
    const change = { ...(c.active === false ? { active: true } : {}), ...Object.fromEntries(Object.entries(PT_FLAGS).filter(([f, v]) => c[f] !== v)) }
    if (Object.keys(change).length) await patch(ADMIN, 'companies', c.id, change, p.code)
    else console.log(`exists companies ${p.code} id=${c.id} (active, flags set)`)
  }
  ptId[k] = c?.id ?? null
}
if (write) saveState({ ptFlagsBefore: Object.fromEntries(Object.entries(flagsBefore).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([f]) => f !== 'active'))])) })
if (!ptId.CS1 || !ptId.CS2) {
  console.log('[dry-run] CS2 does not exist yet → the remaining steps (memberships, employees, projects, stages, team) are listed by apply only')
}

// ---------------------------------------------------------------- 3. admin.uji = Admin CS1 + CS2 (needed to create accounts)
const adminItems = []
for (const k of ['CS1', 'CS2']) {
  if (!ptId[k]) continue
  const m = adminMs.find((x) => x.company === ptId[k])
  if (!m || m.active === false || !(m.roles ?? []).includes('pk-admin')) adminItems.push({ user: me.id, company: ptId[k], roles: ['pk-admin'], active: true })
}
if (adminItems.length) await membershipBatch(ADMIN, adminItems, `${CFG.admin} Admin CS1/CS2`)

// ---------------------------------------------------------------- 4. app accounts (linked by e-mail; re-activated → the app re-enables Keycloak)
const U = {}
const usersR = await ADMIN.rest('GET', `/api/users?${qs({ 'where[email][in]': R.map((x) => x.email).join(','), limit: '200' })}`)
if (usersR.status === 403 && !write) {
  // a group admin without ANY active PT membership cannot list users; apply re-activates CS1/CS2 + its Admin
  // memberships (steps 2–3) first, so this only limits the dry run
  console.log(`[dry-run] ${CFG.admin} has no active PT membership yet → user list not readable before apply; apply re-activates/creates the ${R.length} app accounts, sets their CS1/CS2 memberships, deactivates active lt DRMS memberships, then employees/projects/stages/team`)
  writeFileSync(join(CFG.out, 'fixture-plan.json'), `${JSON.stringify(summary, null, 2)}\n`)
  process.exit(0)
}
if (usersR.status !== 200) die(`read users as ${CFG.admin}: ${brief(usersR)}`)
const existingUsers = usersR.body.docs
for (const x of R) {
  const u = existingUsers.find((y) => y.email === x.email)
  if (u?.groupAdmin === true) die(`${x.email} is a group admin — not an expected load-test account`)
  if (u) {
    if (u.active === false) await patch(ADMIN, 'users', u.id, { active: true }, x.email)
    U[x.key] = u.id
  } else {
    const c = await create(ADMIN, 'users', { email: x.email, name: `Uji Beban ${x.key.replace('lt-', '').replace('-', ' ')}`, active: true }, x.email)
    U[x.key] = c?.id ?? null
  }
}

// ---------------------------------------------------------------- 5. lt-* memberships in PT DRMS → inactive (no fictional account reads DRMS)
const uidList = Object.values(U).filter(Boolean)
const allMs = uidList.length ? await find(ADMIN, 'company-memberships', { 'where[user][in]': uidList.join(','), limit: '500' }) : []
const drmsActive = allMs.filter((m) => m.company === drms.id && m.active !== false)
// employee: null — the batch validates the existing employee link against the caller's PT selection, and a group
// admin without an active DRMS membership cannot "see" DRMS employees → 400 (finding LT-F1). The link is to a
// fictional E9 employee (LT-*) and the membership becomes inactive anyway.
if (drmsActive.length) await membershipBatch(ADMIN, drmsActive.map((m) => ({ user: m.user, company: m.company, roles: m.roles, ...(m.employee ? { employee: null } : {}), active: false })), 'lt accounts in DRMS → inactive (employee link of the fictional E9 employee removed)')
else console.log(`lt accounts: no active DRMS membership (${allMs.filter((m) => m.company === drms.id).length} inactive ones stay as they are)`)

if (!ptId.CS1 || !ptId.CS2 || !write) {
  writeFileSync(join(CFG.out, 'fixture-plan.json'), `${JSON.stringify(summary, null, 2)}\n`)
  console.log(`plan done: ${R.length} accounts, PTs ${JSON.stringify(ptId)} — run "apply" to create the rest`)
  process.exit(0)
}

// ---------------------------------------------------------------- 6. employees (field + PM), 7. memberships
const E = {}
for (const x of R) {
  for (const [pt, code] of Object.entries(x.emp)) {
    const hit = (await find(ADMIN, 'employees', { 'where[company][equals]': ptId[pt], 'where[code][equals]': code }))[0]
    let e = hit
    if (!hit) e = await create(ADMIN, 'employees', { company: ptId[pt], code, name: `Uji Beban ${code}`, active: true }, code)
    else if (hit.active === false) await patch(ADMIN, 'employees', hit.id, { active: true }, code)
    E[`${x.key}@${pt}`] = e?.id ?? null
  }
}
const items = []
for (const x of R) {
  for (const pt of x.pts) {
    const want = { user: U[x.key], company: ptId[pt], roles: [ROLE[x.r]], employee: E[`${x.key}@${pt}`] ?? null, active: true }
    const m = allMs.find((y) => y.user === want.user && y.company === want.company)
    const same = m && m.active !== false && [...(m.roles ?? [])].sort().join() === want.roles.join() && (m.employee ?? null) === want.employee
    if (same) continue
    if (m) {
      // batch UPDATE must not carry `employee`: its filterOptions read data.company, which an update body lacks →
      // 400 "pilihan tidak valid" (finding LT-F1). Existing rows keep their employee link.
      if ((m.employee ?? null) !== want.employee) warn(`${x.email}@${pt}: existing membership has employee ${m.employee ?? 'none'}, wanted ${want.employee} — kept`)
      delete want.employee
    }
    items.push(want)
  }
}
if (items.length) await membershipBatch(ADMIN, items, 'lt accounts in CS1/CS2')
else console.log('memberships: all present')

// ---------------------------------------------------------------- 8. projects (as the PT's Direktur) + stages + team
const P = {}
for (const p of PROJECTS) {
  const dir = A[p.dir]
  if (!dir || !U[p.pm]) {
    warn(`project ${p.code} skipped (Direktur ${p.dir} or PM ${p.pm} not in this roster)`)
    continue
  }
  let hit = (await find(ADMIN, 'projects', { 'where[company][equals]': ptId[p.pt], 'where[code][equals]': p.code }))[0]
  if (!hit) hit = await create(dir, 'projects', { company: ptId[p.pt], code: p.code, name: p.name, pm: U[p.pm], budget: 1_000_000_000, status: 'berjalan', lat: GEO.lat, lng: GEO.lng, radiusM: GEO.radiusM }, `${p.code} (as ${p.dir})`)
  else if (hit.status !== 'berjalan' || hit.lat == null) await patch(dir, 'projects', hit.id, { status: 'berjalan', lat: GEO.lat, lng: GEO.lng, radiusM: GEO.radiusM }, p.code)
  P[p.code] = hit.id
  const s = await dir.v1('GET', `/projects/${hit.id}/stages`)
  if (s.status !== 200) die(`stages of ${p.code}: ${brief(s)}`)
  if (!(s.body.stages ?? []).some((x) => x.active !== false)) {
    const r = await dir.v1('PUT', `/projects/${hit.id}/stages`, { json: { stages: STAGES } })
    if (r.status !== 200) die(`stage set of ${p.code}: ${brief(r)}`)
    act(`stages of ${p.code}: ${STAGES.map((x) => `${x.name} ${x.weightPct}%`).join(' · ')}`)
  }
  const team = await find(ADMIN, 'team-assignments', { 'where[project][equals]': hit.id, limit: '200' })
  for (const x of R) {
    const role = x.r === 'field' && x.prj === p.code ? 'staff' : x.r === 'pm' && x.prj === p.code ? 'pm' : null
    if (!role) continue
    const emp = E[`${x.key}@${p.pt}`]
    if (!emp || team.some((t) => t.employee === emp)) continue
    await create(ADMIN, 'team-assignments', { company: ptId[p.pt], employee: emp, project: hit.id, roleInProject: role }, `${x.key} → ${p.code} (${role})`)
  }
}

// ---------------------------------------------------------------- 9. verify logins of the re-enabled accounts, write roster.json
const failed = []
for (const x of R) {
  if (kcState[x.key] === 'enabled') continue
  const g = await A[x.key].tokenGrant()
  if (!g.ok) failed.push(`${x.email}: ${g.error}`)
  else if (!g.roles.includes('pk-user')) failed.push(`${x.email}: token without pk-user`)
}
if (failed.length) die(`after re-activation ${failed.length} account(s) still cannot log in: ${failed.slice(0, 5).join('; ')}`)
const ptOfProject = (code) => PROJECTS.find((p) => p.code === code)?.pt
const rosterOut = R.map((x) => ({ u: x.email, r: x.r, tier: x.tier, cid: ptId[(x.prj && ptOfProject(x.prj)) || x.pts[0]], cids: x.pts.map((k) => ptId[k]), pid: x.prj ? (P[x.prj] ?? null) : null }))
writeFileSync(join(CFG.out, 'roster.json'), `${JSON.stringify({ at: summary.at, lat: GEO.lat, lng: GEO.lng, pts: ptId, projects: P, accounts: rosterOut }, null, 2)}\n`)
saveState({ fixture: { at: summary.at, admin: me.id, pts: ptId, users: U, employees: E, projects: P } })
writeFileSync(join(CFG.out, 'fixture-apply.json'), `${JSON.stringify(summary, null, 2)}\n`)
console.log(`\napply done: ${R.length} accounts ready, PTs ${JSON.stringify(ptId)}, projects ${JSON.stringify(P)} → ${join(CFG.out, 'roster.json')}`)
