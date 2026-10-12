/**
 * Reference checks of the import against workbook rows + keys already in the DB (E11), and the plan
 * for user rows (Keycloak link). Pure: the DB keys are loaded read-only by run.ts.
 */
import type { ImportData, Issue } from './parse'
import { SHEET_BY_KEY, type SheetKey } from './spec'

/**
 * Users without an email (Q-37: email optional) still need a unique `users.email` in ProyekKas → a
 * placeholder on the reserved TLD `.invalid` (RFC 2606: never deliverable). Never sent to Keycloak.
 */
export const PLACEHOLDER_EMAIL_DOMAIN = 'pengguna.drms.invalid'

export function effectiveEmail(u: { username: string; email: string | null }): string {
  return u.email ?? `${u.username}@${PLACEHOLDER_EMAIL_DOMAIN}`
}

export function isPlaceholderEmail(email: string): boolean {
  return email.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`)
}

/** Per-PT natural keys already in the DB: PT short code → codes (MC2-5). */
export type PtKeys = Map<string, Set<string>>

export type DbKeys = {
  /** PT short code → id + active flag. */
  companies: Map<string, { id: number; active: boolean }>
  employees: PtKeys
  banks: Set<string>
  uoms: Set<string>
  categories: PtKeys
  costCenters: PtKeys
  /** ADR 0023: sites (kantor cabang) per PT. */
  sites: PtKeys
  projects: PtKeys
  /** user id → PT codes with an ACTIVE membership (PM / cost-center manager must be a member there). */
  membershipsByUser: Map<number, Set<string>>
  /** email → user */
  usersByEmail: Map<string, { id: number; sub: string | null; employee: number | null }>
  /** keycloakSub → user */
  usersBySub: Map<string, { id: number; email: string }>
}

export type UserPlan = {
  username: string
  email: string
  /** create = new ProyekKas user linked to Keycloak `sub`; update = existing user; pending = no Keycloak account yet. */
  action: 'create' | 'update' | 'pending'
  sub: string | null
  id: number | null
}

export type ResolveResult = { issues: Issue[]; users: Map<string, UserPlan>; defaultPt: string | null; pts: string[] }

export function emptyDbKeys(): DbKeys {
  return {
    companies: new Map(),
    employees: new Map(),
    banks: new Set(),
    uoms: new Set(),
    categories: new Map(),
    costCenters: new Map(),
    sites: new Map(),
    projects: new Map(),
    membershipsByUser: new Map(),
    usersByEmail: new Map(),
    usersBySub: new Map(),
  }
}

/** Codes of one PT in a per-PT key map (created on demand — tests / DB loader). */
export function ptSet(keys: PtKeys, pt: string): Set<string> {
  let s = keys.get(pt)
  if (!s) {
    s = new Set()
    keys.set(pt, s)
  }
  return s
}

/**
 * The PT an empty `kode_pt` means (MC2-5): the only PT of sheet Perusahaan, else the only ACTIVE PT of
 * the database; null when ambiguous (then every per-PT row must name its PT).
 */
export function defaultPtOf(data: Pick<ImportData, 'companies'>, db: Pick<DbKeys, 'companies'>): string | null {
  if (data.companies.length === 1) return data.companies[0]!.code
  if (data.companies.length > 1) return null
  const active = [...db.companies].filter(([, c]) => c.active).map(([code]) => code)
  return active.length === 1 ? active[0]! : null
}

/** Effective PT of a row. */
export const ptOf = (row: { pt: string | null }, defaultPt: string | null): string | null => row.pt ?? defaultPt

/**
 * `opts.pmRequired` (DRMS 10/10 #5, set by runImport): a project's PM must resolve to an account NOW —
 * a PM still pending in Keycloak is an error (the project cannot be created without its PM).
 */
export function resolveReferences(data: ImportData, db: DbKeys, kcMap: ReadonlyMap<string, string>, opts: { pmRequired?: boolean } = {}): ResolveResult {
  const issues: Issue[] = []
  const defaultPt = defaultPtOf(data, db)
  const knownPts = new Set([...data.companies.map((c) => c.code), ...db.companies.keys()])
  const usedPts = new Set<string>()

  // ---- PT of every per-PT row: known, active, and given when more than one PT exists
  const ptCheck = (sheet: SheetKey, row: number, pt: string | null, column = 'kode_pt'): string | null => {
    const eff = pt ?? defaultPt
    const name = SHEET_BY_KEY[sheet].name
    if (eff === null) {
      issues.push({ level: 'error', sheet: name, row, column, message: 'kode_pt wajib diisi: file/database berisi lebih dari satu PT (atau belum ada PT).' })
      return null
    }
    if (!knownPts.has(eff)) {
      issues.push({ level: 'error', sheet: name, row, column, message: `PT "${eff}" tidak dikenal (sheet Perusahaan maupun database).` })
      return null
    }
    const inDb = db.companies.get(eff)
    if (inDb && !inDb.active && !data.companies.some((c) => c.code === eff)) {
      issues.push({ level: 'error', sheet: name, row, column, message: `PT "${eff}" nonaktif — aktifkan dulu di Master Perusahaan.` })
      return null
    }
    usedPts.add(eff)
    return eff
  }
  for (const c of data.companies) {
    const inDb = db.companies.get(c.code)
    if (inDb && !inDb.active) issues.push({ level: 'error', sheet: SHEET_BY_KEY.perusahaan.name, row: c._row, column: 'kode_pt', message: `PT "${c.code}" sudah ada tetapi nonaktif — aktifkan dulu di Master Perusahaan.` })
    else if (!inDb) issues.push({ level: 'warning', sheet: SHEET_BY_KEY.perusahaan.name, row: c._row, column: 'kode_pt', message: `PT baru "${c.code}" (${c.name}) akan dibuat, dengan penomoran dan aturan approval default.` })
    usedPts.add(c.code)
  }
  const rowPt = new Map<object, string | null>()
  const withPt = <T extends { _row: number; pt: string | null }>(sheet: SheetKey, rows: readonly T[]) => {
    for (const r of rows) rowPt.set(r, ptCheck(sheet, r._row, r.pt))
  }
  withPt('kategori', data.categories)
  withPt('karyawan', data.employees)
  withPt('pengguna', data.users.filter((u) => u.roles.length > 0 || u.pt !== null))
  withPt('rekening', data.bankAccounts)
  withPt('pusatBiaya', data.costCenters)
  withPt('site', data.sites)
  withPt('project', data.projects)
  withPt('tahapan', data.stages)
  withPt('rab', data.budgetLines)
  withPt('kendaraan', data.vehicles)
  withPt('penugasan', data.assignments)
  withPt('akunKas', data.cashAccounts)
  for (const a of data.access) rowPt.set(a, ptCheck('aksesPt', a._row, a.pt))
  const P = (row: object) => rowPt.get(row) ?? null

  /** Per-PT pool: workbook rows of that PT + DB keys of that PT. */
  const pool = (rows: ReadonlyArray<{ _row: number; pt: string | null }>, code: (r: never) => string, dbKeys: PtKeys) => {
    const m = new Map<string, Set<string>>()
    for (const r of rows) {
      const pt = P(r)
      if (pt) ptSet(m, pt).add(code(r as never))
    }
    for (const [pt, codes] of dbKeys) for (const c of codes) ptSet(m, pt).add(c)
    return m
  }
  const employees = pool(data.employees, (e: { code: string }) => e.code, db.employees)
  const categories = pool(data.categories, (c: { code: string }) => c.code, db.categories)
  const costCenters = pool(data.costCenters, (c: { code: string }) => c.code, db.costCenters)
  const projects = pool(data.projects, (p: { code: string }) => p.code, db.projects)
  const sites = pool(data.sites, (x: { code: string }) => x.code, db.sites)
  const set = (wb: Iterable<string>, dbSet: Set<string>) => new Set([...wb, ...dbSet])
  const banks = set(
    data.banks.map((b) => b.code),
    db.banks,
  )
  const uoms = set(
    data.uoms.map((u) => u.code),
    db.uoms,
  )

  const need = (sheet: keyof typeof SHEET_BY_KEY, row: number, column: string, value: string | null, pool: Set<string>, what: string, where: string) => {
    if (value !== null && !pool.has(value)) {
      issues.push({ level: 'error', sheet: SHEET_BY_KEY[sheet].name, row, column, message: `${what} "${value}" tidak ditemukan (sheet ${where} maupun database).` })
    }
  }
  /** Per-PT reference: must exist IN THE ROW'S PT; a hit in another PT is named (cross-PT reference). */
  const needIn = (sheet: SheetKey, rowObj: object, row: number, column: string, value: string | null, pools: Map<string, Set<string>>, what: string, where: string) => {
    const pt = P(rowObj)
    if (value === null || pt === null) return
    if (pools.get(pt)?.has(value)) return
    const elsewhere = [...pools].filter(([p, codes]) => p !== pt && codes.has(value)).map(([p]) => p)
    issues.push({
      level: 'error',
      sheet: SHEET_BY_KEY[sheet].name,
      row,
      column,
      message: elsewhere.length
        ? `${what} "${value}" tidak ada di PT ${pt} (ada di PT ${elsewhere.join(', ')}) — referensi lintas PT tidak diperbolehkan.`
        : `${what} "${value}" tidak ditemukan di PT ${pt} (sheet ${where} maupun database).`,
    })
  }

  for (const c of data.categories) {
    need('kategori', c._row, 'satuan_default', c.defaultUom, uoms, 'Satuan', 'Satuan')
    for (const u of c.allowedUoms) need('kategori', c._row, 'satuan_wajar', u, uoms, 'Satuan', 'Satuan')
  }
  // ADR 0023: site links (same PT; workbook sheet Site or an existing site)
  for (const x of data.sites) needIn('site', x, x._row, 'kode_pusat_biaya', x.costCenterCode, costCenters, 'Pusat biaya', 'PusatBiaya')
  for (const e of data.employees) needIn('karyawan', e, e._row, 'kode_site', e.siteCode, sites, 'Site', 'Site')
  for (const p of data.projects) needIn('project', p, p._row, 'kode_site', p.siteCode, sites, 'Site', 'Site')
  for (const a of data.cashAccounts) needIn('akunKas', a, a._row, 'kode_site', a.siteCode, sites, 'Site', 'Site')
  for (const x of data.sites) {
    // the default cost center of a site is an operational one (DB trigger pk_site_cost_center_operational)
    const cc = x.costCenterCode ? data.costCenters.find((c) => c.code === x.costCenterCode && P(c) === P(x)) : undefined
    if (cc && cc.type !== 'operational') issues.push({ level: 'error', sheet: SHEET_BY_KEY.site.name, row: x._row, column: 'kode_pusat_biaya', message: `Pusat biaya "${cc.code}" bukan jenis Operasional — pusat biaya default site harus operasional.` })
  }
  for (const u of data.users) needIn('pengguna', u, u._row, 'kode_karyawan', u.employeeCode, employees, 'Karyawan', 'Karyawan')
  for (const a of data.access) needIn('aksesPt', a, a._row, 'kode_karyawan', a.employeeCode, employees, 'Karyawan', 'Karyawan')
  for (const a of data.bankAccounts) {
    needIn('rekening', a, a._row, 'kode_karyawan', a.employeeCode, employees, 'Karyawan', 'Karyawan')
    need('rekening', a._row, 'kode_bank', a.bankCode, banks, 'Bank', 'Bank')
  }
  for (const s of data.stages) needIn('tahapan', s, s._row, 'kode_project', s.projectCode, projects, 'Project', 'Project')
  for (const b of data.budgetLines) {
    needIn('rab', b, b._row, 'kode_project', b.projectCode, projects, 'Project', 'Project')
    needIn('rab', b, b._row, 'kode_kategori', b.categoryCode, categories, 'Kategori', 'Kategori')
  }
  for (const v of data.vehicles) {
    needIn('kendaraan', v, v._row, 'kode_pusat_biaya', v.costCenterCode, costCenters, 'Pusat biaya', 'PusatBiaya')
    needIn('kendaraan', v, v._row, 'kode_project', v.projectCode, projects, 'Project', 'Project')
  }
  for (const a of data.assignments) {
    needIn('penugasan', a, a._row, 'kode_karyawan', a.employeeCode, employees, 'Karyawan', 'Karyawan')
    needIn('penugasan', a, a._row, 'kode_project', a.projectCode, projects, 'Project', 'Project')
    needIn('penugasan', a, a._row, 'kode_pusat_biaya', a.costCenterCode, costCenters, 'Pusat biaya', 'PusatBiaya')
    needIn('penugasan', a, a._row, 'kode_site', a.siteCode, sites, 'Site', 'Site')
  }
  // one account per (user, PT): Pengguna row PT + AksesPT rows; one employee per account per PT
  {
    const seen = new Map<string, number>()
    for (const u of data.users) if (u.roles.length > 0 && P(u)) seen.set(`${u.username}@${P(u)}`, u._row)
    const empSeen = new Map<string, string>()
    for (const u of data.users) if (u.employeeCode && P(u)) empSeen.set(`${P(u)}/${u.employeeCode}`, u.username)
    const known = new Set(data.users.map((u) => u.username))
    for (const a of data.access) {
      const pt = P(a)
      if (!known.has(a.username)) issues.push({ level: 'error', sheet: SHEET_BY_KEY.aksesPt.name, row: a._row, column: 'username', message: `Username "${a.username}" tidak ada di sheet Pengguna.` })
      if (!pt) continue
      const k = `${a.username}@${pt}`
      if (seen.has(k)) issues.push({ level: 'error', sheet: SHEET_BY_KEY.aksesPt.name, row: a._row, column: 'kode_pt', message: `Akses "${a.username}" di PT ${pt} sudah ada (sheet Pengguna baris ${seen.get(k)}).` })
      if (a.employeeCode) {
        const other = empSeen.get(`${pt}/${a.employeeCode}`)
        if (other && other !== a.username) issues.push({ level: 'error', sheet: SHEET_BY_KEY.aksesPt.name, row: a._row, column: 'kode_karyawan', message: `Karyawan ${a.employeeCode} (PT ${pt}) sudah terhubung ke akun ${other}.` })
        empSeen.set(`${pt}/${a.employeeCode}`, a.username)
      }
    }
    for (const u of data.users) {
      if (u.roles.length === 0 && !data.access.some((a) => a.username === u.username)) {
        issues.push({ level: 'warning', sheet: SHEET_BY_KEY.pengguna.name, row: u._row, column: 'peran', message: `"${u.username}" tanpa peran di PT mana pun: akun dibuat tetapi belum bisa memakai RR Teams.` })
      }
    }
  }
  for (const a of data.cashAccounts) need('akunKas', a._row, 'kode_bank', a.bankCode, banks, 'Bank', 'Bank')

  // ---- users: Keycloak link plan
  const users = new Map<string, UserPlan>()
  const sheetUsers = SHEET_BY_KEY.pengguna.name
  const mappedSubs = new Map<string, string>()
  for (const u of data.users) {
    const email = effectiveEmail(u)
    const sub = kcMap.get(u.username) ?? null
    if (sub) {
      const other = mappedSubs.get(sub)
      if (other) issues.push({ level: 'error', sheet: sheetUsers, row: u._row, column: 'username', message: `Keycloak id ${sub} dipetakan ke dua username (${other}, ${u.username}).` })
      mappedSubs.set(sub, u.username)
    }
    const bySub = sub ? db.usersBySub.get(sub) : undefined
    const byEmail = db.usersByEmail.get(email)
    if (bySub) {
      if (byEmail && byEmail.id !== bySub.id) {
        issues.push({ level: 'error', sheet: sheetUsers, row: u._row, column: 'email', message: `Email ${email} sudah dipakai pengguna lain di RR Teams.` })
      }
      users.set(u.username, { username: u.username, email, action: 'update', sub, id: bySub.id })
    } else if (byEmail) {
      if (sub && byEmail.sub && byEmail.sub !== sub) {
        issues.push({ level: 'error', sheet: sheetUsers, row: u._row, column: 'username', message: `Email ${email} sudah terhubung ke akun Keycloak lain (${byEmail.sub}); periksa file pemetaan Keycloak.` })
      }
      users.set(u.username, { username: u.username, email, action: 'update', sub: byEmail.sub, id: byEmail.id })
    } else if (sub) {
      users.set(u.username, { username: u.username, email, action: 'create', sub, id: null })
    } else {
      users.set(u.username, { username: u.username, email, action: 'pending', sub: null, id: null })
      issues.push({
        level: 'warning',
        sheet: sheetUsers,
        row: u._row,
        column: 'username',
        message: `Akun Keycloak untuk "${u.username}" belum ada di file pemetaan → pengguna belum dibuat di RR Teams (jalankan ulang impor setelah Lead membuat akun di Keycloak).`,
      })
    }
  }
  for (const [username] of kcMap) {
    if (!users.has(username)) issues.push({ level: 'warning', sheet: sheetUsers, message: `Username "${username}" ada di file pemetaan Keycloak tetapi tidak ada di sheet Pengguna — diabaikan.` })
  }

  // PTs where each workbook user will hold a membership (Pengguna row PT + AksesPT)
  const memberPts = new Map<string, Set<string>>()
  // (a user deactivated by this file keeps its PM / manager links: the DB guard only checks new references)
  for (const u of data.users) if (u.roles.length > 0 && P(u)) ptSet(memberPts, u.username).add(P(u)!)
  for (const a of data.access) if (P(a)) ptSet(memberPts, a.username).add(P(a)!)

  // user references: username of the Pengguna sheet, or the email of an existing ProyekKas user; the
  // user must be an ACTIVE member of the row's PT (DB trigger pk_company_member, ADR 0016 §4)
  const userRef = (sheet: 'pusatBiaya' | 'project', rowObj: object, row: number, column: string, ref: string | null, needRole?: string) => {
    if (ref === null) return
    const pt = P(rowObj)
    if (ref.includes('@')) {
      const existing = db.usersByEmail.get(ref)
      if (!existing) issues.push({ level: 'error', sheet: SHEET_BY_KEY[sheet].name, row, column, message: `Pengguna dengan email ${ref} tidak ditemukan di RR Teams.` })
      else if (pt && !db.membershipsByUser.get(existing.id)?.has(pt)) issues.push({ level: 'error', sheet: SHEET_BY_KEY[sheet].name, row, column, message: `Pengguna ${ref} bukan anggota aktif PT ${pt}.` })
      return
    }
    if (pt && data.users.some((x) => x.username === ref) && !memberPts.get(ref)?.has(pt)) {
      issues.push({ level: 'error', sheet: SHEET_BY_KEY[sheet].name, row, column, message: `"${ref}" tidak punya akses aktif di PT ${pt} (isi peran di sheet Pengguna/AksesPT untuk PT ini).` })
    }
    const plan = users.get(ref)
    if (!plan) {
      issues.push({ level: 'error', sheet: SHEET_BY_KEY[sheet].name, row, column, message: `Username "${ref}" tidak ada di sheet Pengguna.` })
      return
    }
    if (plan.action === 'pending' && opts.pmRequired && sheet === 'project' && column === 'pm') {
      // DRMS 10/10 #5: a project cannot be created without its PM → map the PM's Keycloak account first
      issues.push({ level: 'error', sheet: SHEET_BY_KEY[sheet].name, row, column, message: `Project Manager wajib diisi: "${ref}" belum punya akun Keycloak — sertakan file pemetaan Keycloak untuk PM ini.` })
    } else if (plan.action === 'pending') {
      issues.push({ level: 'warning', sheet: SHEET_BY_KEY[sheet].name, row, column, message: `"${ref}" belum punya akun Keycloak → ${column} dikosongkan dulu, terisi saat impor ulang dengan file pemetaan.` })
    }
    const u = data.users.find((x) => x.username === ref)
    const rolesInPt = [...(u && P(u) === pt ? u.roles : []), ...data.access.filter((a) => a.username === ref && P(a) === pt).flatMap((a) => a.roles)]
    if (needRole && u && !rolesInPt.includes(needRole)) {
      issues.push({ level: 'warning', sheet: SHEET_BY_KEY[sheet].name, row, column, message: `"${ref}" tidak berperan PM.` })
    }
  }
  for (const c of data.costCenters) userRef('pusatBiaya', c, c._row, 'penanggung_jawab', c.manager)
  for (const p of data.projects) userRef('project', p, p._row, 'pm', p.pm, 'pk-pm')

  const pts = [...usedPts].filter((p) => knownPts.has(p)).sort()
  return { issues, users, defaultPt, pts }
}

/** `--kc-map` file: CSV `username,id` (kcadm.sh `--fields username,id --format csv`, header optional) or JSON. */
export function parseKcMap(text: string): { map: Map<string, string>; errors: string[] } {
  const map = new Map<string, string>()
  const errors: string[] = []
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const add = (username: unknown, sub: unknown, where: string) => {
    const u = String(username ?? '').trim().replace(/^"|"$/g, '').toLowerCase()
    const s = String(sub ?? '').trim().replace(/^"|"$/g, '').toLowerCase()
    if (!u || !uuid.test(s)) {
      errors.push(`${where}: butuh username dan id Keycloak (UUID).`)
      return
    }
    if (map.has(u) && map.get(u) !== s) errors.push(`${where}: username ${u} muncul dua kali dengan id berbeda.`)
    map.set(u, s)
  }
  const t = text.trim()
  if (t.startsWith('[') || t.startsWith('{')) {
    let json: unknown
    try {
      json = JSON.parse(t)
    } catch (e) {
      return { map, errors: [`JSON tidak valid: ${(e as Error).message}`] }
    }
    if (Array.isArray(json)) json.forEach((o, i) => add((o as Record<string, unknown>)?.username, (o as Record<string, unknown>)?.id ?? (o as Record<string, unknown>)?.sub ?? (o as Record<string, unknown>)?.keycloakSub, `baris ${i + 1}`))
    else for (const [k, v] of Object.entries(json as Record<string, unknown>)) add(k, v, k)
    return { map, errors }
  }
  t.split(/\r?\n/).forEach((line, i) => {
    const cols = line.split(/[,;\t]/).map((c) => c.trim())
    if (cols.length < 2 || (i === 0 && /^"?username"?$/i.test(cols[0]!))) return
    // accept `username,id` and `id,username`
    if (uuid.test(cols[0]!.replace(/"/g, ''))) add(cols[1], cols[0], `baris ${i + 1}`)
    else add(cols[0], cols[1], `baris ${i + 1}`)
  })
  return { map, errors }
}
