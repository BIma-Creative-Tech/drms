/**
 * Reference checks of the import against workbook rows + keys already in the DB (E11), and the plan
 * for user rows (Keycloak link). Pure: the DB keys are loaded read-only by run.ts.
 */
import type { ImportData, Issue } from './parse'
import { SHEET_BY_KEY } from './spec'

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

export type DbKeys = {
  employees: Set<string>
  banks: Set<string>
  uoms: Set<string>
  categories: Set<string>
  costCenters: Set<string>
  projects: Set<string>
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

export type ResolveResult = { issues: Issue[]; users: Map<string, UserPlan> }

export function emptyDbKeys(): DbKeys {
  return {
    employees: new Set(),
    banks: new Set(),
    uoms: new Set(),
    categories: new Set(),
    costCenters: new Set(),
    projects: new Set(),
    usersByEmail: new Map(),
    usersBySub: new Map(),
  }
}

export function resolveReferences(data: ImportData, db: DbKeys, kcMap: ReadonlyMap<string, string>): ResolveResult {
  const issues: Issue[] = []
  const set = (wb: Iterable<string>, dbSet: Set<string>) => new Set([...wb, ...dbSet])
  const employees = set(
    data.employees.map((e) => e.code),
    db.employees,
  )
  const banks = set(
    data.banks.map((b) => b.code),
    db.banks,
  )
  const uoms = set(
    data.uoms.map((u) => u.code),
    db.uoms,
  )
  const categories = set(
    data.categories.map((c) => c.code),
    db.categories,
  )
  const costCenters = set(
    data.costCenters.map((c) => c.code),
    db.costCenters,
  )
  const projects = set(
    data.projects.map((p) => p.code),
    db.projects,
  )

  const need = (sheet: keyof typeof SHEET_BY_KEY, row: number, column: string, value: string | null, pool: Set<string>, what: string, where: string) => {
    if (value !== null && !pool.has(value)) {
      issues.push({ level: 'error', sheet: SHEET_BY_KEY[sheet].name, row, column, message: `${what} "${value}" tidak ditemukan (sheet ${where} maupun database).` })
    }
  }

  for (const c of data.categories) {
    need('kategori', c._row, 'satuan_default', c.defaultUom, uoms, 'Satuan', 'Satuan')
    for (const u of c.allowedUoms) need('kategori', c._row, 'satuan_wajar', u, uoms, 'Satuan', 'Satuan')
  }
  for (const u of data.users) need('pengguna', u._row, 'kode_karyawan', u.employeeCode, employees, 'Karyawan', 'Karyawan')
  for (const a of data.bankAccounts) {
    need('rekening', a._row, 'kode_karyawan', a.employeeCode, employees, 'Karyawan', 'Karyawan')
    need('rekening', a._row, 'kode_bank', a.bankCode, banks, 'Bank', 'Bank')
  }
  for (const s of data.stages) need('tahapan', s._row, 'kode_project', s.projectCode, projects, 'Project', 'Project')
  for (const b of data.budgetLines) {
    need('rab', b._row, 'kode_project', b.projectCode, projects, 'Project', 'Project')
    need('rab', b._row, 'kode_kategori', b.categoryCode, categories, 'Kategori', 'Kategori')
  }
  for (const v of data.vehicles) {
    need('kendaraan', v._row, 'kode_pusat_biaya', v.costCenterCode, costCenters, 'Pusat biaya', 'PusatBiaya')
    need('kendaraan', v._row, 'kode_project', v.projectCode, projects, 'Project', 'Project')
  }
  for (const a of data.assignments) {
    need('penugasan', a._row, 'kode_karyawan', a.employeeCode, employees, 'Karyawan', 'Karyawan')
    need('penugasan', a._row, 'kode_project', a.projectCode, projects, 'Project', 'Project')
    need('penugasan', a._row, 'kode_pusat_biaya', a.costCenterCode, costCenters, 'Pusat biaya', 'PusatBiaya')
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
        issues.push({ level: 'error', sheet: sheetUsers, row: u._row, column: 'email', message: `Email ${email} sudah dipakai pengguna lain di ProyekKas.` })
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
        message: `Akun Keycloak untuk "${u.username}" belum ada di file pemetaan → pengguna belum dibuat di ProyekKas (jalankan ulang impor setelah Lead membuat akun di Keycloak).`,
      })
    }
  }
  for (const [username] of kcMap) {
    if (!users.has(username)) issues.push({ level: 'warning', sheet: sheetUsers, message: `Username "${username}" ada di file pemetaan Keycloak tetapi tidak ada di sheet Pengguna — diabaikan.` })
  }

  // user references: username of the Pengguna sheet, or the email of an existing ProyekKas user
  const userRef = (sheet: 'pusatBiaya' | 'project', row: number, column: string, ref: string | null, needRole?: string) => {
    if (ref === null) return
    if (ref.includes('@')) {
      if (!db.usersByEmail.has(ref)) issues.push({ level: 'error', sheet: SHEET_BY_KEY[sheet].name, row, column, message: `Pengguna dengan email ${ref} tidak ditemukan di ProyekKas.` })
      return
    }
    const plan = users.get(ref)
    if (!plan) {
      issues.push({ level: 'error', sheet: SHEET_BY_KEY[sheet].name, row, column, message: `Username "${ref}" tidak ada di sheet Pengguna.` })
      return
    }
    if (plan.action === 'pending') {
      issues.push({ level: 'warning', sheet: SHEET_BY_KEY[sheet].name, row, column, message: `"${ref}" belum punya akun Keycloak → ${column} dikosongkan dulu, terisi saat impor ulang dengan file pemetaan.` })
    }
    const u = data.users.find((x) => x.username === ref)
    if (needRole && u && !u.roles.includes(needRole)) {
      issues.push({ level: 'warning', sheet: SHEET_BY_KEY[sheet].name, row, column, message: `"${ref}" tidak berperan PM.` })
    }
  }
  for (const c of data.costCenters) userRef('pusatBiaya', c._row, 'penanggung_jawab', c.manager)
  for (const p of data.projects) userRef('project', p._row, 'pm', p.pm, 'pk-pm')

  return { issues, users }
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
