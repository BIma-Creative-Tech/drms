import { readFileSync } from 'node:fs'

import { z } from 'zod'

/**
 * Seed data (phase-plan F1 item 6). Sources: the client's paper form
 * `228/PB-DRMS/20/IX/2026` (held privately by the project Lead, see
 * docs/proyekkas/reference/README.md; f0-brief §1), requirements v1.1 §6 (masters, category/UoM
 * proposals Q-19/Q-20) and ADR 0007 (numbering). Values not known yet (COA codes, company bank
 * accounts, positions) are left empty for Finance/Admin to complete — nothing is invented.
 *
 * PUBLIC REPO: people, the bank account number and the vehicle plate below are FICTIONAL
 * pseudonyms of the values on the client form. The real master data is loaded at deploy time from
 * an untracked JSON file (`SEED_DATA_FILE`, same shape as DEFAULT_SEED_DATA, validated by
 * SeedDataSchema) — see loadSeedData().
 */
export const COMPANY = {
  name: 'PT Double Rezki Makmur Sejahtera',
  shortCode: 'DRMS',
  timezone: 'Asia/Makassar',
}

export const UOMS = [
  { code: 'L', name: 'liter', category: 'volume' },
  { code: 'KALI-ISI', name: 'kali isi', category: 'volume' },
  { code: 'KMR', name: 'kamar', category: 'akomodasi' },
  { code: 'MLM', name: 'malam', category: 'akomodasi' },
  { code: 'PRS', name: 'porsi', category: 'konsumsi' },
  { code: 'PKT', name: 'paket', category: 'umum' },
  { code: 'UNIT', name: 'unit', category: 'umum' },
  { code: 'PCS', name: 'pcs', category: 'umum' },
  { code: 'LS', name: 'LS (lumpsum)', category: 'umum' },
  { code: 'TRIP', name: 'trip', category: 'transport' },
  { code: 'HARI', name: 'hari', category: 'waktu' },
  { code: 'BLN', name: 'bulan', category: 'waktu' },
]

/** requirements v1.1 §6: base categories + proposals (Q-19); allowed UoMs drive the uom_suspicious flag (F2). */
export const CATEGORIES = [
  { code: 'MAT', name: 'Material', allowed: ['UNIT', 'PCS', 'PKT', 'LS'] },
  { code: 'UPH', name: 'Upah', allowed: ['HARI', 'LS'] },
  { code: 'ALT', name: 'Alat', allowed: ['UNIT', 'HARI', 'LS'] },
  { code: 'TRN', name: 'Transport', allowed: ['TRIP', 'LS'] },
  { code: 'OPS', name: 'Operasional', allowed: ['LS', 'PKT', 'UNIT'] },
  { code: 'BBM', name: 'BBM', defaultUom: 'L', allowed: ['L', 'KALI-ISI'], requiresVehicle: true },
  { code: 'INAP', name: 'Penginapan', defaultUom: 'KMR', allowed: ['KMR', 'MLM'] },
  { code: 'KSM', name: 'Konsumsi', defaultUom: 'PRS', allowed: ['PRS', 'PKT'] },
  { code: 'SRV', name: 'Service Kendaraan', allowed: ['UNIT', 'PKT', 'LS'], requiresVehicle: true },
]

export const BANKS = [
  { code: 'MANDIRI', name: 'Bank Mandiri' },
  { code: 'BCA', name: 'Bank Central Asia (BCA)' },
  { code: 'BRI', name: 'Bank Rakyat Indonesia (BRI)' },
  { code: 'BNI', name: 'Bank Negara Indonesia (BNI)' },
  { code: 'BSI', name: 'Bank Syariah Indonesia (BSI)' },
]

export const CASH_IN_SOURCES = [
  { code: 'TERMIN', name: 'Termin' },
  { code: 'DP', name: 'DP klien' },
  { code: 'MODAL', name: 'Modal owner' },
  { code: 'LPJ', name: 'Pengembalian LPJ' },
  { code: 'LAIN', name: 'Lainnya' },
]

/** Company cash/bank accounts: numbers unknown → Finance completes them in the admin. */
export const CASH_ACCOUNTS = [
  { name: 'Kas Kecil', kind: 'cash' as const },
  { name: 'Bank Operasional', kind: 'bank' as const },
]

export const COST_CENTERS = [{ code: 'OPS-PB', name: 'Ops Palangka Banjar', type: 'operational' as const }]

export const VEHICLES = [{ plateNo: 'DA 1234 XY', type: 'Hilux', costCenter: 'OPS-PB' }]

/**
 * People on the client form (Diajukan Oleh "Budi, Doni" · Dibuat Oleh "Citra" · Diketahui Oleh
 * "Budi Hartono" · Approval "sari"). Under ADR 0013 the "Diketahui Oleh" person is a Direktur and
 * the "Approval" person is Finance (roles are given to user accounts, not to these employees). Whether "Budi" and "Budi Hartono" are the same
 * person is open (Q-08) → two records as listed in phase-plan F1 item 6; Admin can merge.
 */
export const EMPLOYEES = [
  { code: 'EMP-001', name: 'Budi', nickname: 'Budi' },
  { code: 'EMP-002', name: 'Doni Pratama', nickname: 'Doni' },
  { code: 'EMP-003', name: 'Citra', nickname: 'Citra' },
  { code: 'EMP-004', name: 'Budi Hartono', nickname: 'Budi H.' },
  { code: 'EMP-005', name: 'Sari', nickname: 'sari' },
]

/** Transfer box of the form: Mandiri, Doni Pratama, 1234567890123 (unverified until Finance checks). */
export const EMPLOYEE_BANK_ACCOUNTS = [
  { employee: 'EMP-002', bank: 'MANDIRI', accountNo: '1234567890123', accountHolder: 'Doni Pratama', isDefault: true },
]

/**
 * US-34 defaults (see seed.ts), ADR 0013 (E1, GATE 1 G1-2): "Diketahui" = approval by the Direktur
 * (role `pk-owner`), then Finance approves — for every amount (no threshold yet, Q-31) + an inactive
 * example with a threshold of the same shape. Existing databases get the same content through the
 * data migration `20260926_*_e1_approval_direktur_finance` (renamed from the pre-E1 names below).
 */
/** Name of the seeded default addendum rule (shared with the E5 migration). */
export const ADDENDUM_DEFAULT_RULE_NAME = 'Default Addendum RAB — Direktur lalu Finance'

export const DEFAULT_APPROVAL_RULES = [
  {
    name: 'Default — Direktur lalu Finance (semua nominal)',
    docType: 'expense_request',
    requestType: 'any',
    minAmount: 0,
    maxAmount: null,
    priority: 100,
    acknowledge: 'required',
    acknowledgeBy: 'role',
    acknowledgeRole: 'pk-owner',
    signDiajukan: 'required',
    signDibuat: 'required',
    steps: [{ level: 1, approverRole: 'pk-finance' }],
    active: true,
  },
  {
    name: 'Contoh — di atas Rp 10 juta: Direktur lalu Finance (Q-31, nonaktif)',
    docType: 'expense_request',
    requestType: 'any',
    minAmount: 10_000_001,
    maxAmount: null,
    priority: 50,
    acknowledge: 'required',
    acknowledgeBy: 'role',
    acknowledgeRole: 'pk-owner',
    signDiajukan: 'required',
    signDibuat: 'required',
    steps: [{ level: 1, approverRole: 'pk-finance' }],
    active: false,
  },
  // E5 (T12, US-30): Addendum RAB through the same engine — Direktur ("Diketahui" = approval) then
  // Finance (Sprint S2 decision on ADR 0013 O-3). Also inserted by migration e5_budget_addenda.
  {
    name: ADDENDUM_DEFAULT_RULE_NAME,
    docType: 'budget_addendum',
    requestType: 'any',
    minAmount: 0,
    maxAmount: null,
    priority: 100,
    acknowledge: 'required',
    acknowledgeBy: 'role',
    acknowledgeRole: 'pk-owner',
    signDiajukan: 'none',
    signDibuat: 'none',
    steps: [{ level: 1, approverRole: 'pk-finance' }],
    active: true,
  },
] as const

/** Names of the two seeded rules before ADR 0013 (renamed by the E1 data migration). */
export const PRE_E1_APPROVAL_RULE_NAMES = ['Default — Owner (semua nominal)', 'Contoh — di atas Rp 10 juta: 2 approver (Q-31, nonaktif)'] as const

export const DEFAULT_SEED_DATA = {
  company: COMPANY,
  uoms: UOMS,
  categories: CATEGORIES,
  banks: BANKS,
  cashInSources: CASH_IN_SOURCES,
  cashAccounts: CASH_ACCOUNTS,
  costCenters: COST_CENTERS,
  vehicles: VEHICLES,
  employees: EMPLOYEES,
  employeeBankAccounts: EMPLOYEE_BANK_ACCOUNTS,
}

const code = z.string().trim().min(1).max(32)
const name = z.string().trim().min(1).max(200)

/** Shape of DEFAULT_SEED_DATA / the SEED_DATA_FILE JSON (strict: unknown keys are rejected). */
export const SeedDataSchema = z
  .strictObject({
    company: z.strictObject({ name, shortCode: code, timezone: z.string().min(1) }),
    uoms: z.array(z.strictObject({ code, name, category: name })),
    categories: z.array(
      z.strictObject({ code, name, defaultUom: code.optional(), allowed: z.array(code), requiresVehicle: z.boolean().optional() }),
    ),
    banks: z.array(z.strictObject({ code, name })),
    cashInSources: z.array(z.strictObject({ code, name })),
    cashAccounts: z.array(z.strictObject({ name, kind: z.enum(['cash', 'bank']) })),
    costCenters: z.array(z.strictObject({ code, name, type: z.literal('operational') })),
    vehicles: z.array(z.strictObject({ plateNo: z.string().trim().min(1).max(20), type: name, costCenter: code })),
    employees: z.array(z.strictObject({ code, name, nickname: name.optional() })),
    employeeBankAccounts: z.array(
      z.strictObject({
        employee: code,
        bank: code,
        accountNo: z.string().regex(/^[0-9]{5,20}$/, 'accountNo: digits only'),
        accountHolder: name,
        isDefault: z.boolean(),
      }),
    ),
  })
  .superRefine((d, ctx) => {
    // Cross-references must resolve inside the same file (the seed looks them up by code).
    const has = (list: { code: string }[]) => new Set(list.map((x) => x.code))
    const uoms = has(d.uoms)
    const banks = has(d.banks)
    const ccs = has(d.costCenters)
    const emps = has(d.employees)
    const bad = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
    d.categories.forEach((c, i) => {
      if (c.defaultUom && !uoms.has(c.defaultUom)) bad(['categories', i, 'defaultUom'], 'unknown UoM code')
      c.allowed.forEach((a, j) => uoms.has(a) || bad(['categories', i, 'allowed', j], 'unknown UoM code'))
    })
    d.vehicles.forEach((v, i) => ccs.has(v.costCenter) || bad(['vehicles', i, 'costCenter'], 'unknown cost center code'))
    d.employeeBankAccounts.forEach((a, i) => {
      if (!emps.has(a.employee)) bad(['employeeBankAccounts', i, 'employee'], 'unknown employee code')
      if (!banks.has(a.bank)) bad(['employeeBankAccounts', i, 'bank'], 'unknown bank code')
    })
  })

export type SeedData = z.infer<typeof SeedDataSchema>

/**
 * Returns the seed dataset: DEFAULT_SEED_DATA (fictional) unless `SEED_DATA_FILE` names a JSON file
 * (e.g. a Compose secret) holding the real data. The file is validated; errors never echo its content.
 */
export function loadSeedData(env: Record<string, string | undefined> = process.env, read: (p: string) => string = (p) => readFileSync(p, 'utf8')): SeedData {
  const file = env.SEED_DATA_FILE?.trim()
  if (!file) return SeedDataSchema.parse(DEFAULT_SEED_DATA)
  let raw: unknown
  try {
    raw = JSON.parse(read(file))
  } catch {
    throw new Error('SEED_DATA_FILE is not readable or not valid JSON')
  }
  const r = SeedDataSchema.safeParse(raw)
  if (!r.success) {
    const where = r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new Error(`SEED_DATA_FILE does not match the seed schema — ${where}`)
  }
  return r.data
}
