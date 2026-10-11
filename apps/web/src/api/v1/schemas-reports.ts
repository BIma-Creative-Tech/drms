import { z } from 'zod'

/**
 * F3 dashboards & reports (docs/proyekkas/f3/kpi-definitions.md, wireframes.md). Amounts are
 * integer Rupiah; business dates 'YYYY-MM-DD' (company TZ); periods 'YYYY-MM'.
 */
const rp = z.number().int().meta({ description: 'Rupiah (integer)' })
const pct = z.number().nullable().meta({ description: 'Percent, 2 decimals; null = no budget' })
const tone = z.enum(['none', 'ok', 'warn', 'over']).meta({ description: 'K-08 colour: Tanpa RAB / Aman / Waspada / Lewat RAB (Komitmen basis)' })

// ---- MC2/MC4 per-PT fields (ADR 0016 §6): additive; every `byCompany` row sums to the combined value
const ptId = z.number().int().meta({ description: 'PT (companies id); label from `companies[]` / GET /me companies[].' })
const Companies = z
  .array(z.object({ id: z.number().int(), shortCode: z.string(), name: z.string() }))
  .meta({ description: 'MC2: PTs covered by this layout = the selected PTs where the caller holds the layout\'s role.' })
const CountSumByCompany = z.array(z.object({ companyId: ptId, count: z.number().int(), sum: rp }))
const WarnPctByCompany = z.array(z.object({ companyId: ptId, warnPct: z.number() })).meta({ description: 'MC4: K-08 Waspada threshold per PT (companies.budgetWarnPct); projects[].tone already uses its own PT.' })
const CompletenessRow = z.object({
  companyId: ptId,
  ratioDone: z.number().int(),
  ratioTotal: z.number().int(),
  withoutLpj: z.number().int(),
  overdue: z.number().int(),
  lpjToVerify: z.number().int(),
  reimburseToVerify: z.number().int(),
  openWarnings: z.number().int(),
})

export const ReportCode = z.enum(['rekap-kas', 'buku-kas', 'pengeluaran-kategori', 'anggaran-project', 'rekap-pengajuan', 'kelengkapan', 'biaya-kendaraan', 'absensi', 'rekap-timesheet-kontrak', 'rekap-aftersales', 'audit-log'])
export const ReportFormat = z.enum(['csv', 'xlsx', 'pdf'])

export const ProjectBudget = z.object({
  id: z.number().int(),
  companyId: ptId,
  code: z.string(),
  name: z.string(),
  status: z.string(),
  budget: rp.nullable(),
  committed: rp.meta({ description: 'K-07 Komitmen' }),
  committedCount: z.number().int(),
  pct: pct.meta({ description: 'K-08 % komitmen / RAB' }),
  tone,
  disbursedNet: rp.meta({ description: 'K-05 Dicairkan bersih' }),
  realized: rp.meta({ description: 'K-06 Realisasi terverifikasi' }),
  pctDisbursed: pct,
  pctRealized: pct,
})

const CashFlowPoint = z.object({ period: z.string(), masuk: rp, keluar: rp, koreksi: rp.optional() })
const CostCenterMonth = z.object({ id: z.number().int(), companyId: ptId, code: z.string(), name: z.string(), fromRequests: rp, manualOut: rp, manualIn: rp, total: rp.meta({ description: 'K-15' }) })
const TransferQueueSummary = z.object({ count: z.number().int(), sum: rp, overdue: z.number().int(), reimburseToVerify: z.number().int(), reimburseToVerifyWarnings: z.number().int(), byCompany: CountSumByCompany })
const AdvanceWithoutLpj = z.object({
  id: z.number().int(),
  companyId: ptId,
  docNo: z.string().nullable(),
  title: z.string(),
  requesters: z.string(),
  scopeName: z.string(),
  status: z.string(),
  transferredTotal: rp,
  firstTransfer: z.string().nullable(),
  ageDays: z.number().int().nullable(),
  overdue: z.boolean().meta({ description: 'K-12b: age > company-settings.lpjDueDays' }),
})

// ---- dashboard chart data (Beranda redesign 2026-09-25; additive `viz` objects) -------------
const RequestTrendPoint = z.object({ period: z.string(), count: z.number().int(), sum: rp.meta({ description: 'K-13 Σ grand total of non-draft requests dated in the month' }) })
const PipelineStage = z.object({
  key: z.enum(['ack', 'approval', 'queue', 'lpj', 'done', 'exit']),
  label: z.string(),
  count: z.number().int(),
  sum: rp,
  statuses: z.array(z.string()),
})
const Pipeline = z
  .object({ stages: z.array(PipelineStage), exit: PipelineStage, total: z.number().int() })
  .meta({ description: 'K-13 per status (all request dates, drafts excluded) folded into ordered stages; rejected/cancelled = exit' })
const CategoryMix = z.object({
  from: z.string(),
  to: z.string(),
  total: rp,
  includesManual: z.boolean(),
  items: z.array(z.object({ label: z.string(), total: rp, other: z.boolean(), categoryId: z.number().int().nullable() })).meta({ description: 'K-17 Dicairkan per category, top 6 + "Lainnya"' }),
})
const BudgetTotals = z.object({ projects: z.number().int(), budget: rp, committed: rp, realized: rp }).meta({ description: 'Σ over running projects with a budget' })
const InboxItem = z.object({
  id: z.number().int(),
  company: z.object({ id: z.number().int(), shortCode: z.string(), name: z.string() }).nullable().meta({ description: 'MC2: PT of the request.' }),
  docNo: z.string().nullable(),
  title: z.string(),
  type: z.enum(['advance', 'reimburse']),
  status: z.string(),
  statusLabel: z.string(),
  step: z.enum(['approve', 'acknowledge']),
  stepLabel: z.string().meta({ description: 'ADR 0021: "Persetujuan PM" / "Persetujuan Direktur" (ADR 0013: "Persetujuan Direktur (Diketahui)" / "Approval level n").' }),
  scopeName: z.string(),
  requesters: z.string(),
  grandTotal: rp,
  requestDate: z.string().nullable(),
  overWarn: z.boolean(),
})
const RecentCashEntry = z.object({
  id: z.number().int(),
  companyId: ptId,
  entryNo: z.string().nullable(),
  entryDate: z.string(),
  direction: z.enum(['in', 'out']),
  amount: rp,
  status: z.enum(['posted', 'void']),
  sourceType: z.string(),
  account: z.string(),
  label: z.string(),
  requestId: z.number().int().nullable(),
  requestDocNo: z.string().nullable(),
})
const TransferTopItem = z.object({
  id: z.number().int(),
  companyId: ptId,
  docNo: z.string().nullable(),
  title: z.string(),
  type: z.enum(['advance', 'reimburse']),
  status: z.string(),
  scopeName: z.string(),
  amount: rp,
  neededDate: z.string().nullable(),
  overdue: z.boolean(),
})
const BalancePoint = z.object({ period: z.string(), balance: rp.meta({ description: 'K-01 closing balance at month end (book)' }) })
const DisbursedPoint = z.object({ period: z.string(), net: rp.meta({ description: 'K-05 Dicairkan bersih in the month' }) })
const StatusSplit = z.object({ count: z.number().int(), sum: rp })

const BudgetCounts = { running: z.number().int(), over: z.number().int(), warn: z.number().int(), ok: z.number().int(), none: z.number().int() }

export const OwnerDashboard = z.object({
  asOf: z.string(),
  month: z.string(),
  companies: Companies,
  cash: z.object({
    total: rp,
    accounts: z.array(z.object({ id: z.number().int(), companyId: ptId, name: z.string(), active: z.boolean(), balance: rp })),
    monthIn: rp,
    monthOut: rp,
    byCompany: z.array(z.object({ companyId: ptId, total: rp, monthIn: rp, monthOut: rp })),
  }),
  budget: z.object({ ...BudgetCounts, byCompany: z.array(z.object({ companyId: ptId, ...BudgetCounts })) }),
  completeness: z.object({
    ratioDone: z.number().int(),
    ratioTotal: z.number().int(),
    withoutLpj: z.number().int(),
    overdue: z.number().int(),
    reimburseToVerify: z.number().int(),
    openWarnings: z.number().int(),
    byCompany: z.array(CompletenessRow),
  }),
  approvals: z.object({
    count: z.number().int(),
    sum: rp,
    waitingForMe: z.number().int(),
    oldestDays: z.number().int().nullable(),
    pendingAck: StatusSplit,
    pendingApproval: StatusSplit,
    byCompany: CountSumByCompany,
    waitingForMeByCompany: z.array(z.object({ companyId: ptId, total: z.number().int() })),
  }),
  cashFlow: z.object({ basis: z.literal('K-02b'), months: z.number().int(), rows: z.array(CashFlowPoint) }),
  projects: z.array(ProjectBudget),
  costCenters: z.array(CostCenterMonth),
  transferQueue: TransferQueueSummary,
  viz: z.object({
    balanceTrend: z.array(BalancePoint),
    disbursed: z.array(DisbursedPoint),
    requestTrend: z.array(RequestTrendPoint),
    pipeline: Pipeline,
    categories: CategoryMix,
    budgetTotals: BudgetTotals,
    recentCash: z.array(RecentCashEntry),
    inbox: z.array(InboxItem),
    warnPct: z.number().meta({ description: 'K-08 Waspada threshold of the caller\'s only / lowest selected PT (display default; per PT: warnPctByCompany).' }),
    warnPctByCompany: WarnPctByCompany,
  }),
})

export const FinanceDashboard = z.object({
  asOf: z.string(),
  month: z.string(),
  companies: Companies,
  transferQueue: TransferQueueSummary,
  reimburseToVerify: z.object({ count: z.number().int(), warnings: z.number().int() }),
  lpjToVerify: z.number().int(),
  lpjToSettle: z.object({ count: z.number().int(), refund: rp, shortfall: rp }),
  completenessByCompany: z.array(CompletenessRow),
  accounts: z.array(z.object({ id: z.number().int(), companyId: ptId, name: z.string(), active: z.boolean(), balance: rp, monthIn: rp, monthOut: rp })),
  cashTotal: rp,
  cashByCompany: z.array(z.object({ companyId: ptId, total: rp })),
  advancesWithoutLpj: z.array(AdvanceWithoutLpj),
  lpjDueDays: z.number().int(),
  cashFlow: z.object({ basis: z.literal('K-02a'), months: z.number().int(), rows: z.array(CashFlowPoint) }),
  lastClosedPeriod: z.string().nullable().meta({ description: 'MC2: the OLDEST of the PTs\' latest closed periods (null when one PT never closed).' }),
  lastClosedByCompany: z.array(z.object({ companyId: ptId, period: z.string().nullable() })),
  nextClosable: z.string(),
  viz: z.object({
    balanceTrend: z.array(BalancePoint),
    disbursed: z.array(DisbursedPoint),
    pipeline: Pipeline,
    categories: CategoryMix,
    recentCash: z.array(RecentCashEntry),
    transferTop: z.array(TransferTopItem),
  }),
})

const RequestRow = z.object({
  id: z.number().int(),
  companyId: ptId,
  docNo: z.string().nullable(),
  requestDate: z.string().nullable(),
  type: z.enum(['advance', 'reimburse']),
  title: z.string(),
  scopeName: z.string(),
  requesters: z.string(),
  status: z.string(),
  grandTotal: rp,
  approvedAmount: rp.nullable(),
  disbursed: rp,
  refund: rp,
  realized: rp,
  openFlags: z.number().int(),
})

const TeamWaitingItem = z.object({
  id: z.number().int(),
  companyId: ptId,
  docNo: z.string().nullable(),
  title: z.string(),
  type: z.enum(['advance', 'reimburse']),
  status: z.string(),
  waitingFor: z.enum(['pm', 'direktur', 'finance']),
  scopeName: z.string(),
  requesters: z.string(),
  grandTotal: rp,
  submittedDate: z.string().nullable(),
  days: z.number().int().nullable(),
})

export const PmDashboard = z.object({
  asOf: z.string(),
  month: z.string(),
  companies: Companies,
  hasScope: z.boolean(),
  waitingForMe: z.number().int().meta({ description: 'ADR 0021: requests waiting for the PM\'s own "Persetujuan PM" (PM project → Direktur rule); 0 on Direktur → Finance requests (ADR 0013).' }),
  teamWaiting: z
    .object({ count: z.number().int(), pm: z.number().int(), direktur: z.number().int(), finance: z.number().int(), oldestDays: z.number().int().nullable(), items: z.array(TeamWaitingItem) })
    .meta({ description: 'S3e (US-17): team requests waiting for the PM project (ADR 0021), the Direktur or Finance, oldest first (max 8 items).' }),
  teamMonth: z.object({ count: z.number().int(), sum: rp, waiting: z.number().int() }),
  teamMonthByCompany: z.array(z.object({ companyId: ptId, count: z.number().int(), sum: rp, waiting: z.number().int() })),
  lpj: z.object({ withoutLpj: z.number().int(), overdue: z.number().int(), lpjDueDays: z.number().int() }),
  projects: z.array(ProjectBudget),
  costCenters: z.array(CostCenterMonth),
  latest: z.array(RequestRow),
  attendance: z.object({ available: z.literal(false), phase: z.string() }),
  progressReports: z.object({ available: z.literal(false), phase: z.string() }),
  viz: z.object({
    requestTrend: z.array(RequestTrendPoint),
    pipeline: Pipeline,
    categories: CategoryMix,
    budgetTotals: BudgetTotals,
    inbox: z.array(InboxItem),
    warnPct: z.number().meta({ description: 'Display default (see OwnerDashboard.viz.warnPct).' }),
    warnPctByCompany: WarnPctByCompany,
  }),
})

const OwnRequest = z.object({ id: z.number().int(), companyId: ptId, docNo: z.string().nullable(), title: z.string(), type: z.enum(['advance', 'reimburse']), status: z.string(), grandTotal: rp, ageDays: z.number().int() })
export const StaffDashboard = z.object({
  companies: Companies,
  actions: z.array(OwnRequest),
  latest: z.array(OwnRequest),
  month: z.string(),
  viz: z.object({ requestTrend: z.array(RequestTrendPoint), pipeline: Pipeline }),
})

export const AdminDashboard = z.object({
  companies: Companies,
  gaps: z.object({
    usersIncomplete: z.number().int(),
    projectsWithoutPm: z.number().int(),
    costCentersWithoutManager: z.number().int(),
    byCompany: z.array(z.object({ companyId: ptId, usersIncomplete: z.number().int(), projectsWithoutPm: z.number().int(), costCentersWithoutManager: z.number().int() })),
  }),
  latestAudit: z.array(z.record(z.string(), z.unknown())),
})

const Cell = z.union([z.string(), z.number(), z.null()])
const ReportTable = z.object({
  key: z.string(),
  title: z.string(),
  columns: z.array(z.object({ key: z.string(), label: z.string(), type: z.enum(['text', 'money', 'int', 'date', 'datetime', 'pct']), primary: z.boolean().optional(), width: z.number().optional() })),
  rows: z.array(z.record(z.string(), Cell)),
  totals: z.record(z.string(), Cell).nullable(),
})

export const ReportResponse = z.object({
  code: ReportCode,
  title: z.string(),
  kpi: z.string(),
  scope: z.enum(['all', 'team']),
  count: z.number().int(),
  nextCursor: z.string().nullable(),
  main: ReportTable,
  extra: z.array(ReportTable),
  notes: z.array(z.string()),
  formats: z.array(ReportFormat),
})

export const ReportQuery = z
  .object({
    cursor: z.string().optional().meta({ description: 'Keyset cursor (paged reports: buku-kas, rekap-pengajuan, audit-log)' }),
    dari: z.string().optional().meta({ description: 'From: YYYY-MM-DD (rekap-kas: YYYY-MM)' }),
    sampai: z.string().optional().meta({ description: 'To: YYYY-MM-DD (rekap-kas: YYYY-MM)' }),
    project: z.string().optional(),
    pusat: z.string().optional().meta({ description: 'Cost center id' }),
    kategori: z.string().optional(),
    jenis: z.string().optional().meta({ description: 'advance | reimburse (audit-log: document type)' }),
    status: z.string().optional().meta({ description: 'Comma separated request statuses (rekap-pengajuan)' }),
    akun: z.string().optional(),
    kendaraan: z.string().optional(),
    pemohon: z.string().optional(),
    dasar: z.string().optional().meta({ description: 'dicairkan | realisasi (pengeluaran-kategori)' }),
    grup: z.string().optional().meta({ description: 'kategori | lingkup (pengeluaran-kategori)' }),
    user: z.string().optional(),
    aksi: z.string().optional(),
    nodok: z.string().optional(),
    sumber: z.string().optional(),
    bulan: z.string().optional().meta({ description: 'YYYY-MM (absensi; default current month)' }),
    pt: z.string().optional().meta({ description: 'MC2: PT filter (company ids, repeatable or comma list) — narrows the scope; a PT outside the caller\'s selection → 403 code COMPANY_NOT_ALLOWED (QA-MC4-14)' }),
  })
  .meta({ description: 'Same filters as the web report page; PM filters are intersected with the team scope.' })
