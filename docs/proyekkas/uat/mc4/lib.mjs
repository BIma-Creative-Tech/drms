// MC4 UAT suite — shared HTTP helpers (node ≥ 24, no dependencies). Used by fixture.mjs, api-suite.mjs,
// ui-checks.mjs and local/emulate-staging.mjs. Runbook: README.md.
//
// SAFETY
// - Target guard: UAT_TARGET=local (host <prefix>-web / localhost only) or UAT_TARGET=staging (host must
//   contain "staging"). Anything else — in particular the prod host — is refused before any request.
// - Secrets: passwords are read from UAT_PW_DIR/<email> (one file per account, mode 600, outside git);
//   tokens, cookies and passwords are never printed or written to disk. Outputs carry ids/status codes only.
// - Accounts: only fictional `*.uji@proyekkas.test` accounts are used (plus the local bootstrap owner of
//   the throwaway stack, local target only).
import { randomUUID, createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync, crc32 } from 'node:zlib'

const env = (k, d) => (process.env[k] ?? '').trim() || d

export const CFG = {
  target: env('UAT_TARGET', ''),
  appUrl: env('UAT_APP_URL', '').replace(/\/$/, ''),
  kcUrl: env('UAT_KC_URL', '').replace(/\/$/, ''),
  realm: env('UAT_REALM', 'drms-staging'),
  mobileClient: env('UAT_MOBILE_CLIENT', 'proyekkas-mobile'),
  pwDir: env('UAT_PW_DIR', ''),
  out: env('UAT_OUT', ''),
  appVersion: env('UAT_APP_VERSION', '99.0.0'),
  ptCode: env('UAT_PT_CODE', 'CS1'),
  ptName: env('UAT_PT_NAME', 'PT Contoh Sejahtera Uji'),
  timezone: env('UAT_TZ', 'Asia/Makassar'),
}
CFG.https = CFG.appUrl.startsWith('https://')
CFG.loginPauseMs = Number(env('UAT_LOGIN_PAUSE_MS', CFG.https ? '10000' : '0'))
CFG.sessionCookie = CFG.https ? '__Host-pk_session' : 'pk_session'
CFG.companyCookie = CFG.https ? '__Host-pk-company-ids' : 'pk-company-ids'

/** The 6 MC4 fictional accounts (UAT report §3) + their planned per-PT roles. */
export const ACCOUNTS = {
  admin: 'admin.uji@proyekkas.test',
  staff: 'staff-cs1.uji@proyekkas.test',
  pm: 'pm-cs1.uji@proyekkas.test',
  dir: 'dir-cs1.uji@proyekkas.test',
  rina: 'rina.uji@proyekkas.test',
  andi: 'andi.uji@proyekkas.test',
}
export const NAMES = { admin: 'Admin Uji', staff: 'Staff CS1 Uji', pm: 'PM CS1 Uji', dir: 'Direktur CS1 Uji', rina: 'Rina Uji', andi: 'Andi Uji' }
export const FICTIONAL_EMAIL = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.uji@proyekkas\.test$/

export function guard() {
  const fail = (m) => {
    console.error(`REFUSED: ${m}`)
    process.exit(2)
  }
  if (!CFG.appUrl || !CFG.kcUrl) fail('UAT_APP_URL and UAT_KC_URL are required')
  if (!CFG.pwDir || !existsSync(CFG.pwDir)) fail('UAT_PW_DIR must name the password directory (one file per e-mail)')
  if (!CFG.out) fail('UAT_OUT (output directory outside git) is required')
  const host = new URL(CFG.appUrl).hostname
  if (CFG.target === 'local') {
    if (!/^(localhost|127\.0\.0\.1|[a-z0-9-]*mc4uat[a-z0-9-]*)$/.test(host)) fail(`local target but app host "${host}" is not a throwaway host`)
  } else if (CFG.target === 'staging') {
    if (!host.includes('staging')) fail(`staging target but app host "${host}" is not a staging host`)
    if (!CFG.https) fail('staging must be https')
  } else fail('UAT_TARGET must be "local" or "staging"')
  mkdirSync(CFG.out, { recursive: true })
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const uuid = () => randomUUID()
export const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10) // Asia/Makassar (UTC+8, no DST)
export const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

export function password(email) {
  const p = join(CFG.pwDir, email)
  if (!existsSync(p)) throw new Error(`no password file for ${email}`)
  return readFileSync(p, 'utf8').trim()
}

// ---------------------------------------------------------------- state (non-secret: ids only)
const statePath = () => join(CFG.out, 'state.json')
export function loadState() {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8'))
  } catch {
    return {}
  }
}
export function saveState(patch) {
  const s = { ...loadState(), ...patch }
  writeFileSync(statePath(), `${JSON.stringify(s, null, 2)}\n`)
  return s
}

// ---------------------------------------------------------------- tiny PNG (unique bytes per call)
let pngSeq = 0
export function png(w = 320, h = 240) {
  const seed = createHash('sha256').update(`${Date.now()}-${++pngSeq}-${randomUUID()}`).digest()
  const row = Buffer.alloc(1 + w * 3)
  const raw = Buffer.alloc((1 + w * 3) * h)
  for (let y = 0; y < h; y++) {
    row[0] = 0
    for (let x = 0; x < w; x++) {
      const band = Math.floor(x / 20) + Math.floor(y / 20)
      row[1 + x * 3] = seed[band % 32]
      row[2 + x * 3] = seed[(band + 7) % 32]
      row[3 + x * 3] = seed[(band + 13) % 32]
    }
    row.copy(raw, y * row.length)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// ---------------------------------------------------------------- tiny JPEG (320×240 gradient, made once with sharp)
// Selfies and progress photos accept JPEG only. Each call inserts a random COM segment → unique bytes / sha256.
const JPEG_B64 =
  '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'
export function jpeg() {
  const base = Buffer.from(JPEG_B64, 'base64')
  const text = Buffer.from(`uji-${randomUUID()}`)
  const len = Buffer.alloc(2)
  len.writeUInt16BE(text.length + 2)
  return Buffer.concat([base.subarray(0, 2), Buffer.from([0xff, 0xfe]), len, text, base.subarray(2)])
}

// ---------------------------------------------------------------- HTTP
let lastAuthAt = 0
/** Paces every Keycloak login / token request (staging: Traefik login rate limit, F2 report §1). */
async function authPace() {
  const wait = lastAuthAt + CFG.loginPauseMs - Date.now()
  if (wait > 0) await sleep(wait)
  lastAuthAt = Date.now()
}

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
      const del = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === ''
      const m = this.c.get(host) ?? new Map()
      if (del) m.delete(name)
      else m.set(name, value)
      this.c.set(host, m)
    }
  }
  header(url, extra = {}) {
    const m = new Map([...(this.c.get(new URL(url).host) ?? new Map())])
    for (const [k, v] of Object.entries(extra)) m.set(k, v)
    return [...m].map(([k, v]) => `${k}=${v}`).join('; ')
  }
  get(url, name) {
    return this.c.get(new URL(url).host)?.get(name)
  }
}

async function parse(res) {
  const text = await res.text()
  let body = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    /* not json */
  }
  return { status: res.status, body, text, headers: res.headers }
}

const decodeHtml = (s) => s.replace(/&amp;/g, '&').replace(/&#x3D;/gi, '=').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

/**
 * One fictional account: bearer tokens (password grant on proyekkas-mobile, ADR 0012) + a registered
 * device for `/api/v1`, and — on demand — a web session (OIDC code flow through the Keycloak login form)
 * for Payload REST `/api/<slug>`, exactly like a browser.
 */
export class Account {
  constructor(key, email) {
    this.key = key
    this.email = email
    this.jar = new Jar()
    this.tok = null
    this.deviceId = null
    this.sessionOk = false
  }

  async tokenGrant() {
    await authPace()
    const body = new URLSearchParams({ grant_type: 'password', client_id: CFG.mobileClient, username: this.email, password: password(this.email), scope: 'openid' })
    const r = await fetch(`${CFG.kcUrl}/realms/${CFG.realm}/protocol/openid-connect/token`, { method: 'POST', body })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.access_token) {
      const e = new Error(`token grant for ${this.key} failed: HTTP ${r.status} ${j.error ?? ''} ${j.error_description ?? ''}`.trim())
      e.disabled = /disabled/i.test(j.error_description ?? '')
      throw e
    }
    this.tok = { at: j.access_token, rt: j.refresh_token, exp: Date.now() + (j.expires_in - 30) * 1000 }
    return this.claims()
  }

  /** Decoded access-token claims WITHOUT the token itself (for the MC4-01 check). */
  claims() {
    const p = JSON.parse(Buffer.from(this.tok.at.split('.')[1], 'base64url').toString('utf8'))
    return { sub: p.sub, azp: p.azp, typ: p.typ, realmRoles: p.realm_access?.roles ?? null }
  }

  async bearer() {
    if (!this.tok) await this.tokenGrant()
    if (Date.now() > this.tok.exp) {
      await authPace()
      const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: CFG.mobileClient, refresh_token: this.tok.rt })
      const r = await fetch(`${CFG.kcUrl}/realms/${CFG.realm}/protocol/openid-connect/token`, { method: 'POST', body })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.access_token) this.tok = { at: j.access_token, rt: j.refresh_token ?? this.tok.rt, exp: Date.now() + (j.expires_in - 30) * 1000 }
      else await this.tokenGrant()
    }
    return this.tok.at
  }

  /** Registers (once per output dir) an APK-like device for this account; the id is kept in state.json. */
  async ensureDevice() {
    if (this.deviceId) return this.deviceId
    const st = loadState()
    const known = st.devices?.[this.email]
    const at = await this.bearer()
    if (known) {
      const r = await fetch(`${CFG.appUrl}/api/v1/me`, { headers: { Authorization: `Bearer ${at}`, 'X-Device-Id': known, 'X-App-Version': CFG.appVersion } })
      if (r.status === 200) {
        this.deviceId = known
        return known
      }
    }
    const deviceId = randomUUID()
    const r = await fetch(`${CFG.appUrl}/api/v1/devices/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${at}`, 'X-Device-Id': deviceId, 'X-App-Version': CFG.appVersion, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ deviceId, platform: 'android', model: 'UAT MC4 runner', appVersion: CFG.appVersion }),
    })
    if (r.status !== 201 && r.status !== 200) throw new Error(`device register for ${this.key}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`)
    this.deviceId = deviceId
    saveState({ devices: { ...(loadState().devices ?? {}), [this.email]: deviceId } })
    return deviceId
  }

  /** `/api/v1` call as the APK would make it. `opts.json`, `opts.headers`, `opts.form`, `opts.idem` (default on for writes). */
  async v1(method, path, opts = {}) {
    const at = await this.bearer()
    const dev = await this.ensureDevice()
    const headers = { Authorization: `Bearer ${at}`, 'X-Device-Id': dev, 'X-App-Version': CFG.appVersion, ...(opts.headers ?? {}) }
    let body
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(opts.json)
    } else if (opts.form) body = opts.form
    if (method !== 'GET' && opts.idem !== false && !headers['Idempotency-Key']) headers['Idempotency-Key'] = randomUUID()
    if (opts.cookie) headers.Cookie = opts.cookie
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${CFG.appUrl}/api/v1${path}`, { method, headers, body })
      if (res.status === 429 && attempt < 3) {
        await res.arrayBuffer()
        await sleep(Number(res.headers.get('retry-after') ?? 20) * 1000)
        continue
      }
      return opts.raw ? { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) } : parse(res)
    }
  }

  async upload(kind, bytes, mimetype) {
    if (!bytes) {
      const jpg = kind === 'selfies' || kind === 'progress-photos'
      bytes = jpg ? jpeg() : png()
      mimetype = jpg ? 'image/jpeg' : 'image/png'
    }
    mimetype ??= 'image/png'
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mimetype }), `uji-${kind}.${mimetype === 'image/jpeg' ? 'jpg' : 'png'}`)
    const r = await this.v1('POST', `/media/${kind}`, { form })
    if (r.status !== 201) throw new Error(`upload ${kind} as ${this.key}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
    return r.body.id
  }

  // ------------------------------------------------------------ web session (browser path)
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
    await authPace()
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
      if (!action) throw new Error(`web login ${this.key}: Keycloak login form not found (HTTP ${res.status})`)
      res = await this.fetchJar(decodeHtml(action), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: this.email, password: password(this.email), credentialId: '' }).toString(),
      })
      if (res.status < 300 || res.status >= 400) {
        const page = await res.text()
        const msg = /id="input-error[^"]*"[^>]*>([^<]+)/i.exec(page)?.[1] ?? /<title>([^<]+)/i.exec(page)?.[1] ?? ''
        throw new Error(`web login ${this.key}: Keycloak answered HTTP ${res.status} (${decodeHtml(msg).trim().slice(0, 120)}) — required action / wrong password?`)
      }
      url = new URL(res.headers.get('location'), url).toString()
    }
    res = await this.fetchJar(url)
    if (res.status !== 302 || !this.jar.get(CFG.appUrl, CFG.sessionCookie)) {
      throw new Error(`web login ${this.key}: app callback HTTP ${res.status} ${(await res.text()).slice(0, 120)}`)
    }
    await res.arrayBuffer()
    this.sessionOk = true
  }

  /** Payload REST / admin request with the web session (CSRF: same-origin `Origin`). */
  async rest(method, path, opts = {}) {
    await this.webLogin()
    const headers = { Origin: CFG.appUrl, Accept: 'application/json', ...(opts.headers ?? {}) }
    const cookie = this.jar.header(CFG.appUrl, opts.extraCookies ?? {})
    headers.Cookie = cookie
    let body
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(opts.json)
    }
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${CFG.appUrl}${path}`, { method, headers, body, redirect: 'manual' })
      if (res.status === 429 && attempt < 3) {
        await res.arrayBuffer()
        await sleep(Number(res.headers.get('retry-after') ?? 20) * 1000)
        continue
      }
      return opts.raw ? { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) } : parse(res)
    }
  }

  /** Session cookie pair for Playwright (value never printed). */
  sessionCookie() {
    return { name: CFG.sessionCookie, value: this.jar.get(CFG.appUrl, CFG.sessionCookie) }
  }
}

export function accounts() {
  return Object.fromEntries(Object.entries(ACCOUNTS).map(([k, e]) => [k, new Account(k, e)]))
}

/** Short JSON for error messages: status + code/detail/errors only (never document content). */
export function brief(r) {
  const b = r?.body && typeof r.body === 'object' ? r.body : {}
  const errs = Array.isArray(b.errors) ? b.errors.slice(0, 3).map((e) => `${e.path ?? e.field ?? ''}:${e.code ?? ''}:${(e.message ?? '').slice(0, 80)}`) : undefined
  return JSON.stringify({ status: r?.status, code: b.code, detail: typeof b.detail === 'string' ? b.detail.slice(0, 160) : undefined, errors: errs })
}

export function where(obj) {
  // Payload REST query string from a flat { 'where[a][equals]': v } map
  return new URLSearchParams(Object.entries(obj).map(([k, v]) => [k, String(v)])).toString()
}
