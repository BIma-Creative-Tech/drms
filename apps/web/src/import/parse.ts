/**
 * Workbook → typed import data + issues (E11). Pure: header validation, cell types, required values,
 * duplicate natural keys and workbook-internal rules (stage weights = 100 %, one default bank account
 * per employee, geofence all-or-nothing, …). References to rows that may already exist in the DB are
 * checked later (resolve.ts) against DB keys loaded read-only.
 * Row numbers in issues are EXCEL row numbers (header = row 1).
 */
import { geofenceError } from '@/domain/attendance/calendar'
import { isBusinessDate } from '@/domain/expense/types'
import { normalizePlate, PLATE_RE } from '@/domain/plates'

import { SETTINGS, SHEETS, YA_TIDAK, type ColSpec, type SheetKey, type SheetSpec } from './spec'
import { excelSerialToDate, type CellValue, type ReadWorkbook } from './xlsx-io'

export type Issue = { level: 'error' | 'warning'; sheet: string; row?: number; column?: string; message: string }
export type Rowed<T> = T & { _row: number }

export type Settings = { goLiveDate: string; pbStartAt: number; closePrevPeriod: boolean }

export type ImportData = {
  settings: Settings | null
  banks: Rowed<{ code: string; name: string }>[]
  uoms: Rowed<{ code: string; name: string; category: string | null }>[]
  categories: Rowed<{ code: string; name: string; coaCode: string | null; defaultUom: string | null; allowedUoms: string[]; requiresVehicle: boolean; active: boolean }>[]
  employees: Rowed<{ code: string; name: string; nickname: string | null; position: string | null; phone: string | null; active: boolean }>[]
  users: Rowed<{ username: string; email: string | null; name: string; employeeCode: string | null; roles: string[]; phone: string | null; active: boolean }>[]
  bankAccounts: Rowed<{ employeeCode: string; bankCode: string; accountNo: string; accountHolder: string; isDefault: boolean; active: boolean }>[]
  costCenters: Rowed<{ code: string; name: string; type: string; manager: string | null; lat: number | null; lng: number | null; radiusM: number | null; active: boolean }>[]
  projects: Rowed<{
    code: string
    name: string
    client: string | null
    address: string | null
    pm: string | null
    lat: number | null
    lng: number | null
    radiusM: number | null
    budget: number | null
    startDate: string | null
    targetDate: string | null
    status: string
  }>[]
  stages: Rowed<{ projectCode: string; sequence: number; name: string; weightPct: number }>[]
  budgetLines: Rowed<{ projectCode: string; categoryCode: string; amount: number }>[]
  vehicles: Rowed<{ plateNo: string; type: string; brandModel: string | null; costCenterCode: string | null; projectCode: string | null; active: boolean }>[]
  assignments: Rowed<{ employeeCode: string; projectCode: string | null; costCenterCode: string | null; role: string; startDate: string | null; endDate: string | null }>[]
  cashAccounts: Rowed<{ name: string; kind: 'cash' | 'bank'; bankCode: string | null; accountNo: string | null; accountHolder: string | null; openingBalance: number; odooJournalCode: string | null; active: boolean }>[]
  /** Sheets present in the file (absent sheet = master not touched). */
  present: SheetKey[]
}

export type ParseResult = { data: ImportData; issues: Issue[] }

const CODE_RE = /^[A-Za-z0-9._/-]{1,32}$/
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/
const EMAIL_RE = /^[^\s@"]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i

export function normHeader(v: CellValue): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\*+$/, '')
    .trim()
    .replace(/[\s-]+/g, '_')
}

type Conv = { ok: true; value: unknown; warning?: string } | { ok: false; message: string }

function str(v: CellValue): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v)
  if (typeof v === 'boolean') return v ? 'Ya' : 'Tidak'
  return String(v ?? '').trim()
}

/** "Rp 1.500.000", "1500000", 1500000 → 1500000 (integer Rupiah). */
export function parseMoney(v: CellValue): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) ? v : null
  const s = String(v).replace(/rp\.?/i, '').replace(/\s/g, '').replace(/,-$/, '').replace(/,00$/, '')
  if (!/^\d{1,3}(\.\d{3})+$|^\d+$/.test(s)) return null
  const n = Number(s.replace(/\./g, ''))
  return Number.isSafeInteger(n) ? n : null
}

export function parseDecimal(v: CellValue): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim().replace(',', '.')
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null
  return Number(s)
}

export function parseDate(v: CellValue, date1904 = false): string | null {
  if (typeof v === 'number') return excelSerialToDate(v, date1904)
  const s = String(v).trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  let iso: string | null = null
  if (m) iso = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s)
  if (m) iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
  return iso && isBusinessDate(iso) ? iso : null
}

export function convertCell(col: ColSpec, v: CellValue, date1904 = false): Conv {
  switch (col.type) {
    case 'text': {
      const s = str(v)
      if (col.maxLength && s.length > col.maxLength) return { ok: false, message: `Maksimal ${col.maxLength} karakter.` }
      return { ok: true, value: s }
    }
    case 'code': {
      const s = str(v)
      return CODE_RE.test(s) ? { ok: true, value: s } : { ok: false, message: `Kode "${s}" tidak valid: 1–32 karakter huruf, angka, titik, garis bawah, garis miring atau minus (tanpa spasi).` }
    }
    case 'username': {
      const s = str(v).toLowerCase()
      if (USERNAME_RE.test(s) || (col.ref && EMAIL_RE.test(s))) return { ok: true, value: s }
      return { ok: false, message: `Username "${s}" tidak valid: 3–64 karakter huruf kecil, angka, titik, garis bawah atau minus, diawali huruf/angka.` }
    }
    case 'email': {
      const s = str(v).toLowerCase()
      return EMAIL_RE.test(s) ? { ok: true, value: s } : { ok: false, message: `Email "${s}" tidak valid.` }
    }
    case 'phone': {
      const s = str(v)
      if (!/^\+?[0-9][0-9 ().-]{4,30}$/.test(s)) return { ok: false, message: `No. HP "${s}" tidak valid.` }
      return typeof v === 'number' ? { ok: true, value: `0${s}`, warning: 'No. HP tertulis sebagai angka (nol di depan hilang) — dianggap diawali 0. Format kolom sebagai teks.' } : { ok: true, value: s }
    }
    case 'digits': {
      const s = str(v).replace(/[\s.-]/g, '')
      if (!/^\d{5,34}$/.test(s)) return { ok: false, message: 'Nomor rekening hanya angka (5–34 digit).' }
      return typeof v === 'number' ? { ok: true, value: s, warning: 'Nomor rekening tertulis sebagai angka — periksa nol di depan. Format kolom sebagai teks.' } : { ok: true, value: s }
    }
    case 'int': {
      const n = typeof v === 'number' ? v : /^[-+]?\d+$/.test(str(v)) ? Number(str(v)) : NaN
      if (!Number.isSafeInteger(n)) return { ok: false, message: `"${str(v)}" bukan bilangan bulat.` }
      if ((col.min !== undefined && n < col.min) || (col.max !== undefined && n > col.max)) return { ok: false, message: `Nilai harus ${col.min ?? '…'}–${col.max ?? '…'}.` }
      return { ok: true, value: n }
    }
    case 'money': {
      const n = parseMoney(v)
      if (n === null) return { ok: false, message: `"${str(v)}" bukan nominal Rupiah bilangan bulat (contoh 1500000 atau 1.500.000).` }
      if (n < 0) return { ok: false, message: 'Nominal tidak boleh negatif.' }
      return { ok: true, value: n }
    }
    case 'decimal': {
      const n = parseDecimal(v)
      if (n === null) return { ok: false, message: `"${str(v)}" bukan angka.` }
      if ((col.min !== undefined && n < col.min) || (col.max !== undefined && n > col.max)) return { ok: false, message: `Nilai harus ${col.min} s.d. ${col.max}.` }
      return { ok: true, value: n }
    }
    case 'date': {
      const d = parseDate(v, date1904)
      return d ? { ok: true, value: d } : { ok: false, message: `Tanggal "${str(v)}" tidak valid (YYYY-MM-DD atau DD/MM/YYYY).` }
    }
    case 'bool': {
      if (typeof v === 'boolean') return { ok: true, value: v }
      const b = YA_TIDAK[str(v).toLowerCase()]
      return b ? { ok: true, value: b === 'true' } : { ok: false, message: `Isi Ya atau Tidak (bukan "${str(v)}").` }
    }
    case 'enum': {
      const s = str(v).toLowerCase()
      const hit = Object.entries(col.options ?? {}).find(([k]) => k.toLowerCase() === s)
      return hit ? { ok: true, value: hit[1] } : { ok: false, message: `Nilai "${str(v)}" tidak dikenal. Pilihan: ${Object.keys(col.options ?? {}).join(', ')}.` }
    }
    case 'roles': {
      const parts = str(v)
        .split(/[,;/+]+/)
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean)
      const out = new Set<string>()
      for (const p of parts) {
        const r = col.options?.[p]
        if (!r) return { ok: false, message: `Peran "${p}" tidak dikenal. Pilihan: Direktur, Finance, PM, Staff, Admin.` }
        out.add(r)
      }
      return out.size > 0 ? { ok: true, value: [...out].sort() } : { ok: false, message: 'Peran wajib diisi.' }
    }
    case 'codes': {
      const parts = str(v)
        .split(/[,;\s]+/)
        .map((p) => p.trim())
        .filter(Boolean)
      const bad = parts.find((p) => !CODE_RE.test(p))
      return bad ? { ok: false, message: `Kode "${bad}" tidak valid.` } : { ok: true, value: [...new Set(parts)] }
    }
    case 'plate': {
      const p = normalizePlate(str(v))
      return PLATE_RE.test(p) ? { ok: true, value: p } : { ok: false, message: `Nomor polisi "${str(v)}" tidak valid (contoh: DA 1234 XY).` }
    }
  }
}

type RawRow = { row: number; values: Record<string, unknown> }

function isBlank(v: CellValue | undefined): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

/** Header + cell validation of one sheet → typed raw rows (only rows without cell errors are returned). */
function readSheet(spec: SheetSpec, rows: CellValue[][], date1904: boolean, issues: Issue[]): RawRow[] {
  const sheet = spec.name
  const header = rows[0] ?? []
  const index = new Map<string, number>()
  header.forEach((h, i) => {
    const k = normHeader(h)
    if (!k) return
    if (index.has(k)) issues.push({ level: 'error', sheet, row: 1, column: k, message: `Kolom "${k}" muncul dua kali.` })
    else index.set(k, i)
  })
  const known = new Set(spec.columns.map((c) => c.key))
  for (const k of index.keys()) {
    if (!known.has(k)) issues.push({ level: 'error', sheet, row: 1, column: k, message: `Kolom "${k}" tidak dikenal. Kolom yang benar: ${spec.columns.map((c) => c.key).join(', ')}.` })
  }
  let headerOk = true
  for (const c of spec.columns) {
    if (c.required && !index.has(c.key)) {
      headerOk = false
      issues.push({ level: 'error', sheet, row: 1, column: c.key, message: `Kolom wajib "${c.key}" tidak ada di baris 1 (header). Jangan mengubah/menghapus header template.` })
    }
  }
  if (!headerOk || issues.some((i) => i.sheet === sheet && i.row === 1 && i.level === 'error')) return []

  const out: RawRow[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    if (row.every(isBlank)) continue
    const values: Record<string, unknown> = {}
    let ok = true
    for (const c of spec.columns) {
      const i = index.get(c.key)
      const raw = i === undefined ? null : (row[i] ?? null)
      if (isBlank(raw)) {
        if (c.required) {
          ok = false
          issues.push({ level: 'error', sheet, row: r + 1, column: c.key, message: `Kolom "${c.key}" wajib diisi.` })
        }
        values[c.key] = null
        continue
      }
      if (typeof raw === 'string' && raw.startsWith('#ERROR')) {
        ok = false
        issues.push({ level: 'error', sheet, row: r + 1, column: c.key, message: `Sel berisi error Excel (${raw.slice(7)}).` })
        continue
      }
      const conv = convertCell(c, raw, date1904)
      if (!conv.ok) {
        ok = false
        issues.push({ level: 'error', sheet, row: r + 1, column: c.key, message: conv.message })
        continue
      }
      if (conv.warning) issues.push({ level: 'warning', sheet, row: r + 1, column: c.key, message: conv.warning })
      values[c.key] = conv.value
    }
    if (ok) out.push({ row: r + 1, values })
  }
  return out
}

function dupCheck<T extends { _row: number }>(sheet: string, rows: T[], key: (r: T) => string | null, label: string, issues: Issue[]): void {
  const seen = new Map<string, number>()
  for (const r of rows) {
    const k = key(r)
    if (k === null) continue
    const first = seen.get(k)
    if (first !== undefined) issues.push({ level: 'error', sheet, row: r._row, message: `${label} "${k}" duplikat (sudah ada di baris ${first}).` })
    else seen.set(k, r._row)
  }
}

const S = (v: unknown) => (v === null || v === undefined ? null : (v as string))
const N = (v: unknown) => (v === null || v === undefined ? null : (v as number))
const B = (v: unknown, dflt = true) => (v === null || v === undefined ? dflt : (v as boolean))

function parseSettings(rows: CellValue[][], date1904: boolean, issues: Issue[]): Settings | null {
  const sheet = 'Pengaturan'
  const header = (rows[0] ?? []).map(normHeader)
  const ki = header.indexOf('pengaturan')
  const vi = header.indexOf('nilai')
  if (ki < 0 || vi < 0) {
    issues.push({ level: 'error', sheet, row: 1, message: 'Header sheet Pengaturan harus memuat kolom "pengaturan" dan "nilai".' })
    return null
  }
  const values = new Map<string, { v: CellValue; row: number }>()
  for (let r = 1; r < rows.length; r++) {
    const k = String(rows[r]?.[ki] ?? '').trim().toLowerCase()
    if (k) values.set(k, { v: rows[r]?.[vi] ?? null, row: r + 1 })
  }
  for (const k of values.keys()) {
    if (!SETTINGS.some((s) => s.key === k)) issues.push({ level: 'error', sheet, row: values.get(k)!.row, message: `Pengaturan "${k}" tidak dikenal.` })
  }
  const g = values.get('tanggal_golive')
  const goLiveDate = g && !isBlank(g.v) ? parseDate(g.v, date1904) : null
  if (!goLiveDate) issues.push({ level: 'error', sheet, row: g?.row, column: 'nilai', message: 'tanggal_golive wajib diisi dengan tanggal valid (YYYY-MM-DD).' })
  else if (!goLiveDate.endsWith('-01')) issues.push({ level: 'warning', sheet, row: g?.row, column: 'nilai', message: `Go-live ${goLiveDate} bukan tanggal 1: tutup buku hanya mengunci bulan sebelumnya; transaksi kas sebelum ${goLiveDate} tetap ditolak per akun (tanggal saldo awal).` })
  const p = values.get('nomor_pb_mulai')
  let pbStartAt = 229
  if (p && !isBlank(p.v)) {
    const n = typeof p.v === 'number' ? p.v : Number(String(p.v).trim())
    if (!Number.isSafeInteger(n) || n < 1) issues.push({ level: 'error', sheet, row: p.row, column: 'nilai', message: 'nomor_pb_mulai harus bilangan bulat ≥ 1.' })
    else pbStartAt = n
  }
  const c = values.get('tutup_periode_sebelum_golive')
  let closePrevPeriod = true
  if (c && !isBlank(c.v)) {
    const b = typeof c.v === 'boolean' ? String(c.v) : YA_TIDAK[String(c.v).trim().toLowerCase()]
    if (!b) issues.push({ level: 'error', sheet, row: c.row, column: 'nilai', message: 'tutup_periode_sebelum_golive: isi Ya atau Tidak.' })
    else closePrevPeriod = b === 'true'
  }
  return goLiveDate ? { goLiveDate, pbStartAt, closePrevPeriod } : null
}

export function emptyData(): ImportData {
  return {
    settings: null,
    banks: [],
    uoms: [],
    categories: [],
    employees: [],
    users: [],
    bankAccounts: [],
    costCenters: [],
    projects: [],
    stages: [],
    budgetLines: [],
    vehicles: [],
    assignments: [],
    cashAccounts: [],
    present: [],
  }
}

export function parseWorkbook(wb: ReadWorkbook): ParseResult {
  const issues: Issue[] = []
  const data = emptyData()
  const byName = new Map(wb.sheets.map((s) => [s.name.trim().toLowerCase(), s]))
  const known = new Set(SHEETS.map((s) => s.name.toLowerCase()))
  for (const s of wb.sheets) {
    const n = s.name.trim().toLowerCase()
    if (!known.has(n) && n !== 'petunjuk' && !n.startsWith('_')) issues.push({ level: 'warning', sheet: s.name, message: `Sheet "${s.name}" tidak dikenal — diabaikan.` })
  }
  const rowsOf = (spec: SheetSpec): RawRow[] | null => {
    const sh = byName.get(spec.name.toLowerCase())
    if (!sh || sh.rows.length === 0) return null
    data.present.push(spec.key)
    return readSheet(spec, sh.rows, wb.date1904, issues)
  }

  const settingsSheet = byName.get('pengaturan')
  if (!settingsSheet) issues.push({ level: 'error', sheet: 'Pengaturan', message: 'Sheet "Pengaturan" wajib ada (tanggal go-live, nomor PB awal).' })
  else {
    data.present.push('pengaturan')
    data.settings = parseSettings(settingsSheet.rows, wb.date1904, issues)
  }

  for (const spec of SHEETS) {
    if (spec.key === 'pengaturan') continue
    const rows = rowsOf(spec)
    if (!rows) continue
    const sheet = spec.name
    switch (spec.key) {
      case 'bank':
        data.banks = rows.map((r) => ({ _row: r.row, code: S(r.values.kode)!, name: S(r.values.nama)! }))
        dupCheck(sheet, data.banks, (r) => r.code, 'Kode bank', issues)
        break
      case 'satuan':
        data.uoms = rows.map((r) => ({ _row: r.row, code: S(r.values.kode)!, name: S(r.values.nama)!, category: S(r.values.kelompok) }))
        dupCheck(sheet, data.uoms, (r) => r.code, 'Kode satuan', issues)
        break
      case 'kategori':
        data.categories = rows.map((r) => ({
          _row: r.row,
          code: S(r.values.kode)!,
          name: S(r.values.nama)!,
          coaCode: S(r.values.kode_coa),
          defaultUom: S(r.values.satuan_default),
          allowedUoms: (r.values.satuan_wajar as string[] | null) ?? [],
          requiresVehicle: B(r.values.perlu_kendaraan, false),
          active: B(r.values.aktif),
        }))
        dupCheck(sheet, data.categories, (r) => r.code, 'Kode kategori', issues)
        for (const c of data.categories) {
          if (c.defaultUom && c.allowedUoms.length > 0 && !c.allowedUoms.includes(c.defaultUom)) {
            issues.push({ level: 'warning', sheet, row: c._row, column: 'satuan_default', message: `Satuan default ${c.defaultUom} tidak ada di satuan_wajar — ditambahkan otomatis.` })
            c.allowedUoms.push(c.defaultUom)
          }
        }
        break
      case 'karyawan':
        data.employees = rows.map((r) => ({
          _row: r.row,
          code: S(r.values.kode)!,
          name: S(r.values.nama)!,
          nickname: S(r.values.nama_panggilan),
          position: S(r.values.jabatan),
          phone: S(r.values.no_hp),
          active: B(r.values.aktif),
        }))
        dupCheck(sheet, data.employees, (r) => r.code, 'Kode karyawan', issues)
        break
      case 'pengguna':
        data.users = rows.map((r) => ({
          _row: r.row,
          username: S(r.values.username)!,
          email: S(r.values.email),
          name: S(r.values.nama)!,
          employeeCode: S(r.values.kode_karyawan),
          roles: r.values.peran as string[],
          phone: S(r.values.no_hp),
          active: B(r.values.aktif),
        }))
        for (const u of data.users) {
          if (u.username.includes('@')) issues.push({ level: 'error', sheet, row: u._row, column: 'username', message: 'Username tidak boleh berupa email.' })
        }
        dupCheck(sheet, data.users, (r) => r.username, 'Username', issues)
        dupCheck(sheet, data.users, (r) => r.email, 'Email', issues)
        dupCheck(sheet, data.users, (r) => r.employeeCode, 'Kode karyawan (satu karyawan = satu akun)', issues)
        break
      case 'rekening':
        data.bankAccounts = rows.map((r) => ({
          _row: r.row,
          employeeCode: S(r.values.kode_karyawan)!,
          bankCode: S(r.values.kode_bank)!,
          accountNo: S(r.values.no_rekening)!,
          accountHolder: S(r.values.atas_nama)!,
          isDefault: B(r.values.rekening_default, false),
          active: B(r.values.aktif),
        }))
        dupCheck(sheet, data.bankAccounts, (r) => `${r.bankCode} ${r.accountNo}`, 'Rekening (bank + nomor)', issues)
        dupCheck(
          sheet,
          data.bankAccounts.filter((r) => r.isDefault),
          (r) => r.employeeCode,
          'Rekening default karyawan',
          issues,
        )
        break
      case 'pusatBiaya':
        data.costCenters = rows.map((r) => ({
          _row: r.row,
          code: S(r.values.kode)!,
          name: S(r.values.nama)!,
          type: S(r.values.jenis) ?? 'operational',
          manager: S(r.values.penanggung_jawab),
          lat: N(r.values.latitude),
          lng: N(r.values.longitude),
          radiusM: N(r.values.radius_m),
          active: B(r.values.aktif),
        }))
        dupCheck(sheet, data.costCenters, (r) => r.code, 'Kode pusat biaya', issues)
        for (const c of data.costCenters) {
          const g = geofenceError(c)
          if (g) issues.push({ level: 'error', sheet, row: c._row, column: 'latitude', message: g })
        }
        break
      case 'project':
        data.projects = rows.map((r) => ({
          _row: r.row,
          code: S(r.values.kode)!,
          name: S(r.values.nama)!,
          client: S(r.values.klien),
          address: S(r.values.alamat),
          pm: S(r.values.pm),
          lat: N(r.values.latitude),
          lng: N(r.values.longitude),
          radiusM: N(r.values.radius_m),
          budget: N(r.values.rab),
          startDate: S(r.values.tanggal_mulai),
          targetDate: S(r.values.target_selesai),
          status: S(r.values.status) ?? 'berjalan',
        }))
        dupCheck(sheet, data.projects, (r) => r.code, 'Kode project', issues)
        for (const p of data.projects) {
          const g = geofenceError(p)
          if (g) issues.push({ level: 'error', sheet, row: p._row, column: 'latitude', message: g })
          if (p.startDate && p.targetDate && p.targetDate < p.startDate) issues.push({ level: 'error', sheet, row: p._row, column: 'target_selesai', message: 'Target selesai sebelum tanggal mulai.' })
          if (!p.pm) issues.push({ level: 'warning', sheet, row: p._row, column: 'pm', message: 'Project tanpa PM: tidak ada PM yang memantau project ini.' })
          if (p.lat === null) issues.push({ level: 'warning', sheet, row: p._row, column: 'latitude', message: 'Tanpa koordinat: absensi di project ini ditolak (NO_GEOFENCE).' })
        }
        break
      case 'tahapan':
        data.stages = rows.map((r) => ({ _row: r.row, projectCode: S(r.values.kode_project)!, sequence: N(r.values.urutan)!, name: S(r.values.nama)!, weightPct: N(r.values.bobot_persen)! }))
        dupCheck(sheet, data.stages, (r) => `${r.projectCode} #${r.sequence}`, 'Tahapan (project + urutan)', issues)
        {
          const sums = new Map<string, { sum: number; row: number }>()
          for (const s of data.stages) {
            const cur = sums.get(s.projectCode) ?? { sum: 0, row: s._row }
            cur.sum += s.weightPct
            sums.set(s.projectCode, cur)
          }
          for (const [code, { sum, row }] of sums) {
            if (Math.abs(sum - 100) > 0.005) issues.push({ level: 'error', sheet, row, column: 'bobot_persen', message: `Total bobot tahapan project ${code} = ${Math.round(sum * 100) / 100}% (harus tepat 100%).` })
          }
        }
        break
      case 'rab':
        data.budgetLines = rows.map((r) => ({ _row: r.row, projectCode: S(r.values.kode_project)!, categoryCode: S(r.values.kode_kategori)!, amount: N(r.values.nominal)! }))
        dupCheck(sheet, data.budgetLines, (r) => `${r.projectCode} / ${r.categoryCode}`, 'RAB (project + kategori)', issues)
        break
      case 'kendaraan':
        data.vehicles = rows.map((r) => ({
          _row: r.row,
          plateNo: S(r.values.no_polisi)!,
          type: S(r.values.jenis)!,
          brandModel: S(r.values.merek_model),
          costCenterCode: S(r.values.kode_pusat_biaya),
          projectCode: S(r.values.kode_project),
          active: B(r.values.aktif),
        }))
        dupCheck(sheet, data.vehicles, (r) => r.plateNo, 'Nomor polisi', issues)
        break
      case 'penugasan':
        data.assignments = rows.map((r) => ({
          _row: r.row,
          employeeCode: S(r.values.kode_karyawan)!,
          projectCode: S(r.values.kode_project),
          costCenterCode: S(r.values.kode_pusat_biaya),
          role: S(r.values.peran) ?? 'staff',
          startDate: S(r.values.tanggal_mulai),
          endDate: S(r.values.tanggal_selesai),
        }))
        for (const a of data.assignments) {
          if ((a.projectCode === null) === (a.costCenterCode === null)) issues.push({ level: 'error', sheet, row: a._row, column: 'kode_project', message: 'Isi salah satu: kode_project ATAU kode_pusat_biaya.' })
          if (a.startDate && a.endDate && a.endDate < a.startDate) issues.push({ level: 'error', sheet, row: a._row, column: 'tanggal_selesai', message: 'Tanggal selesai sebelum tanggal mulai.' })
        }
        dupCheck(sheet, data.assignments, (r) => `${r.employeeCode} → ${r.projectCode ?? r.costCenterCode}`, 'Penugasan (karyawan + project/pusat biaya)', issues)
        break
      case 'akunKas':
        data.cashAccounts = rows.map((r) => ({
          _row: r.row,
          name: S(r.values.nama)!,
          kind: S(r.values.jenis)! as 'cash' | 'bank',
          bankCode: S(r.values.kode_bank),
          accountNo: S(r.values.no_rekening),
          accountHolder: S(r.values.atas_nama),
          openingBalance: N(r.values.saldo_awal)!,
          odooJournalCode: S(r.values.kode_jurnal_odoo),
          active: B(r.values.aktif),
        }))
        dupCheck(sheet, data.cashAccounts, (r) => r.name.toLowerCase(), 'Nama akun', issues)
        for (const a of data.cashAccounts) {
          if (a.kind === 'bank' && !a.bankCode) issues.push({ level: 'warning', sheet, row: a._row, column: 'kode_bank', message: 'Akun jenis Bank tanpa kode_bank.' })
        }
        break
    }
  }
  return { data, issues }
}

export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((i) => i.level === 'error')
}
