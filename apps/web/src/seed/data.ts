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
  // ADR 0028: system source of the automatic Kas Masuk of a payment from another PT of the group
  { code: 'ANTAR-PT', name: 'Antar PT' },
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
 * US-34 defaults (see seed.ts). ADR 0021 (owner 2026-10-10, supersedes the decision part of ADR 0013 for
 * expense requests): "Diketahui" = approval by the PM project (`scope_manager`: projects.pm, else the
 * cost-center manager), then the Direktur (`pk-owner`) — for every amount (no threshold yet, Q-31) + an
 * inactive example with a threshold of the same shape; Finance only transfers. Fresh installs only:
 * existing databases keep their rules — the Admin changes them in the UI (ADR 0021 rollout; the ADR 0013
 * names "Default — Direktur lalu Finance (semua nominal)" / "Contoh — di atas Rp 10 juta: Direktur lalu
 * Finance" came from the data migration `20260926_*_e1_approval_direktur_finance`). ADR 0024 (owner 2026-10-11):
 * + "Pengajuan Direktur" (Peran pemohon = Direktur, priority 10). ADR 0026 (owner 2026-10-13): every expense rule
 * gets the Owner level (`pk-principal`, above the Direktur) right after the Direktur: Staff → PM project → Direktur → Owner → Finance
 * transfer; "Pengajuan Direktur" → Owner; "Pengajuan Owner" (Peran pemohon = Owner, no approval level → straight to
 * Finance, priority 5). Existing databases get the same shape from the data migration 20261013_630200 (names kept).
 */
/** Name of the seeded default addendum rule (shared with the E5 migration). */
export const ADDENDUM_DEFAULT_RULE_NAME = 'Default Addendum RAB — Direktur lalu Finance'

/** ADR 0024: name of the seeded rule for a Direktur's own requests (also migration 20261013_300000_d1010_approval_config_data). */
export const DIREKTUR_RULE_NAME = 'Pengajuan Direktur'
/** ADR 0026: name of the seeded no-approval rule for the Owner's own requests (also migration 20261013_630200_d1310_owner_role_data). */
export const OWNER_RULE_NAME = 'Pengajuan Owner'

/**
 * ADR 0027 (DRMS 13/10 Wave 4, D3): a vendor payment filed by Finance → Direktur → Owner (ADR 0026; no PM project step). A PM's vendor
 * payment needs no rule of its own: the default rule applies and the PM step is skipped because he is its PM (G1-2).
 * Also inserted per PT by migration 20261013_700200_d1310_vendor_payments_data.
 */
export const VENDOR_FINANCE_RULE_NAME = 'Pembayaran vendor oleh Finance — Direktur lalu Owner'

/**
 * ADR 0028 (DRMS 13/10 Phase B): a payment to another PT of the group filed by Finance → Direktur → Owner (mirror of the
 * vendor rule). A PM's follows the default rule (PM step skipped, G1-2), a Direktur's "Pengajuan Direktur" (→ Owner).
 * Also inserted per PT by migration 20261014_100300_d1310_intercompany_data.
 */
export const INTERCOMPANY_FINANCE_RULE_NAME = 'Pembayaran antar-PT oleh Finance — Direktur lalu Owner'

/**
 * Owner decision 2026-10-15: Finance's OWN employee request (Jenis penerima = Karyawan; Reimburse and Pengajuan Baru)
 * → Direktur → Owner → Finance transfer, without the PM project step (the vendor / PT grup rules already have that shape).
 * Also inserted per PT by migration 20261015_150000_d1510_finance_rule_data.
 */
export const FINANCE_RULE_NAME = 'Pengajuan Finance — Direktur lalu Owner'

export const DEFAULT_APPROVAL_RULES = [
  {
    // ADR 0021 (owner decision 2026-10-10): Staff → PM project ("Diketahui" = Persetujuan PM) → Direktur;
    // ADR 0026 (owner 2026-10-13): → Owner (right after the Direktur); Finance only transfers (no approval level).
    name: 'Default — PM project lalu Direktur (semua nominal)',
    docType: 'expense_request',
    requestType: 'any',
    minAmount: 0,
    maxAmount: null,
    priority: 100,
    acknowledge: 'required',
    acknowledgeBy: 'scope_manager',
    acknowledgeRole: null,
    signDiajukan: 'required',
    signDibuat: 'required',
    steps: [
      { level: 1, approverRole: 'pk-owner' },
      { level: 2, approverRole: 'pk-principal' },
    ],
    active: true,
  },
  {
    // ADR 0026 (owner decision 2026-10-13): the Owner's OWN request → no approval step, straight to the Finance
    // transfer queue (audited exception `principal_no_approval`). Evaluated first (5).
    name: OWNER_RULE_NAME,
    docType: 'expense_request',
    requestType: 'any',
    minAmount: 0,
    maxAmount: null,
    priority: 5,
    requesterRoles: ['pk-principal'],
    acknowledge: 'none',
    acknowledgeBy: 'role',
    acknowledgeRole: null,
    signDiajukan: 'required',
    signDibuat: 'required',
    steps: [],
    active: true,
  },
  {
    // ADR 0024 (owner decision 2026-10-11): a Direktur's OWN request, no PM step. ADR 0026: approved by the Owner
    // (was: no approval, `direktur_no_approval`), then the Finance transfer queue. Evaluated before the default (10 < 100).
    name: DIREKTUR_RULE_NAME,
    docType: 'expense_request',
    requestType: 'any',
    minAmount: 0,
    maxAmount: null,
    priority: 10,
    requesterRoles: ['pk-owner'],
    acknowledge: 'none',
    acknowledgeBy: 'role',
    acknowledgeRole: null,
    signDiajukan: 'required',
    signDibuat: 'required',
    steps: [{ level: 1, approverRole: 'pk-principal' }],
    active: true,
  },
  {
    // Owner decision 2026-10-15: Finance's own employee request (Reimburse + Pengajuan Baru) → Direktur → Owner, no PM step.
    name: FINANCE_RULE_NAME,
    docType: 'expense_request',
    requestType: 'any',
    payeeType: 'karyawan',
    minAmount: 0,
    maxAmount: null,
    priority: 20,
    requesterRoles: ['pk-finance'],
    acknowledge: 'none',
    acknowledgeBy: 'role',
    acknowledgeRole: null,
    signDiajukan: 'required',
    signDibuat: 'required',
    steps: [
      { level: 1, approverRole: 'pk-owner' },
      { level: 2, approverRole: 'pk-principal' },
    ],
    active: true,
  },
  {
    // ADR 0027: vendor payment filed by Finance (Peran pemohon = Finance, Jenis penerima = Vendor) → Direktur → Owner (ADR 0026).
    name: VENDOR_FINANCE_RULE_NAME,
    docType: 'expense_request',
    requestType: 'any',
    payeeType: 'vendor',
    minAmount: 0,
    maxAmount: null,
    priority: 20,
    requesterRoles: ['pk-finance'],
    acknowledge: 'none',
    acknowledgeBy: 'role',
    acknowledgeRole: null,
    signDiajukan: 'required',
    signDibuat: 'required',
    steps: [
      { level: 1, approverRole: 'pk-owner' },
      { level: 2, approverRole: 'pk-principal' },
    ],
    active: true,
  },
  {
    // ADR 0028: PT grup payment filed by Finance (Peran pemohon = Finance, Jenis penerima = PT grup) → Direktur → Owner.
    name: INTERCOMPANY_FINANCE_RULE_NAME,
    docType: 'expense_request',
    requestType: 'any',
    payeeType: 'pt_grup',
    minAmount: 0,
    maxAmount: null,
    priority: 20,
    requesterRoles: ['pk-finance'],
    acknowledge: 'none',
    acknowledgeBy: 'role',
    acknowledgeRole: null,
    signDiajukan: 'required',
    signDibuat: 'required',
    steps: [
      { level: 1, approverRole: 'pk-owner' },
      { level: 2, approverRole: 'pk-principal' },
    ],
    active: true,
  },
  {
    name: 'Contoh — di atas Rp 10 juta: PM project lalu Direktur (Q-31, nonaktif)',
    docType: 'expense_request',
    requestType: 'any',
    minAmount: 10_000_001,
    maxAmount: null,
    priority: 50,
    acknowledge: 'required',
    acknowledgeBy: 'scope_manager',
    acknowledgeRole: null,
    signDiajukan: 'required',
    signDibuat: 'required',
    steps: [
      { level: 1, approverRole: 'pk-owner' },
      { level: 2, approverRole: 'pk-principal' },
    ],
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

const companyShape = z.strictObject({ name, shortCode: z.string().trim().regex(/^[A-Z0-9]{2,16}$/, 'shortCode: A-Z/0-9, 2–16'), timezone: z.string().min(1) })
const uomsShape = z.array(z.strictObject({ code, name, category: name }))
const banksShape = z.array(z.strictObject({ code, name }))

/** Per-PT masters (ADR 0016 §4): everything except the shared banks / UoM. */
const companyMasters = {
  categories: z.array(z.strictObject({ code, name, defaultUom: code.optional(), allowed: z.array(code), requiresVehicle: z.boolean().optional() })),
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
}

type RefCtx = { uoms: Set<string>; banks: Set<string> }
type MastersIn = { categories: Array<{ defaultUom?: string; allowed: string[] }>; costCenters: Array<{ code: string }>; vehicles: Array<{ costCenter: string }>; employees: Array<{ code: string }>; employeeBankAccounts: Array<{ employee: string; bank: string }> }

/** Cross-references must resolve inside the same file / PT (the seed looks them up by code). */
function checkRefs(d: MastersIn, shared: RefCtx, ctx: z.RefinementCtx, prefix: (string | number)[]) {
  const ccs = new Set(d.costCenters.map((x) => x.code))
  const emps = new Set(d.employees.map((x) => x.code))
  const bad = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path: [...prefix, ...path], message })
  d.categories.forEach((c, i) => {
    if (c.defaultUom && !shared.uoms.has(c.defaultUom)) bad(['categories', i, 'defaultUom'], 'unknown UoM code')
    c.allowed.forEach((a, j) => shared.uoms.has(a) || bad(['categories', i, 'allowed', j], 'unknown UoM code'))
  })
  d.vehicles.forEach((v, i) => ccs.has(v.costCenter) || bad(['vehicles', i, 'costCenter'], 'unknown cost center code'))
  d.employeeBankAccounts.forEach((a, i) => {
    if (!emps.has(a.employee)) bad(['employeeBankAccounts', i, 'employee'], 'unknown employee code')
    if (!shared.banks.has(a.bank)) bad(['employeeBankAccounts', i, 'bank'], 'unknown bank code')
  })
}

/** Single-company shape (F1…S3; = DRMS). Strict: unknown keys are rejected. */
export const SingleCompanySeedSchema = z
  .strictObject({ company: companyShape, uoms: uomsShape, banks: banksShape, ...companyMasters })
  .superRefine((d, ctx) => checkRefs(d, { uoms: new Set(d.uoms.map((u) => u.code)), banks: new Set(d.banks.map((b) => b.code)) }, ctx, []))

/** Multi-company shape (ADR 0016): shared masters at the top, one block per PT (first = company #1). */
export const MultiCompanySeedSchema = z
  .strictObject({ uoms: uomsShape, banks: banksShape, companies: z.array(z.strictObject({ company: companyShape, ...companyMasters })).min(1) })
  .superRefine((d, ctx) => {
    const shared = { uoms: new Set(d.uoms.map((u) => u.code)), banks: new Set(d.banks.map((b) => b.code)) }
    const codes = new Set<string>()
    d.companies.forEach((c, i) => {
      if (codes.has(c.company.shortCode)) ctx.addIssue({ code: 'custom', path: ['companies', i, 'company', 'shortCode'], message: 'duplicate shortCode' })
      codes.add(c.company.shortCode)
      checkRefs(c, shared, ctx, ['companies', i])
    })
  })

/** Either shape (SEED_DATA_FILE); the seed normalises both to `{ uoms, banks, companies[] }`. */
export const SeedDataSchema = z.union([SingleCompanySeedSchema, MultiCompanySeedSchema])

export type SeedData = z.infer<typeof SeedDataSchema>
export type CompanySeed = z.infer<typeof MultiCompanySeedSchema>['companies'][number]
export type NormalizedSeed = { uoms: SeedData['uoms']; banks: SeedData['banks']; companies: CompanySeed[] }

/** Old single-company shape → `{ uoms, banks, companies: [DRMS block] }` (ADR 0016). */
export function normalizeSeedData(d: SeedData): NormalizedSeed {
  if ('companies' in d) return { uoms: d.uoms, banks: d.banks, companies: d.companies }
  const { uoms, banks, ...rest } = d
  return { uoms, banks, companies: [rest] }
}

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
  // discriminate on `companies` (a union would hide the field errors behind one invalid_union issue)
  const schema = raw && typeof raw === 'object' && 'companies' in raw ? MultiCompanySeedSchema : SingleCompanySeedSchema
  const r = schema.safeParse(raw)
  if (!r.success) {
    const where = r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new Error(`SEED_DATA_FILE does not match the seed schema — ${where}`)
  }
  return r.data
}
