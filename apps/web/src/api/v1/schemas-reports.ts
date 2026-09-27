import { z } from 'zod'

/**
 * F3 dashboards & reports (docs/proyekkas/f3/kpi-definitions.md, wireframes.md). Amounts are
 * integer Rupiah; business dates 'YYYY-MM-DD' (company TZ); periods 'YYYY-MM'.
 */
const rp = z.number().int().meta({ description: 'Rupiah (integer)' })
const pct = z.number().nullable().meta({ description: 'Percent, 2 decimals; null = no budget' })
const tone = z.enum(['none', 'ok', 'warn', 'over']).meta({ description: 'K-08 colour: Tanpa RAB / Aman / Waspada / Lewat RAB (Komitmen basis)' })

export const ReportCode = z.enum(['rekap-kas', 'buku-kas', 'pengeluaran-kategori', 'anggaran-project', 'rekap-pengajuan', 'kelengkapan', 'biaya-kendaraan', 'absensi', 'audit-log'])
export const ReportFormat = z.enum(['csv', 'xlsx', 'pdf'])

export const ProjectBudget = z.object({
  id: z.number().int(),
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
const CostCenterMonth = z.object({ id: z.number().int(), code: z.string(), name: z.string(), fromRequests: rp, manualOut: rp, manualIn: rp, total: rp.meta({ description: 'K-15' }) })
const TransferQueueSummary = z.object({ count: z.number().int(), sum: rp, overdue: z.number().int(), reimburseToVerify: z.number().int(), reimburseToVerifyWarnings: z.number().int() })
const AdvanceWithoutLpj = z.object({
  id: z.number().int(),
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
  docNo: z.string().nullable(),
  title: z.string(),
  type: z.enum(['advance', 'reimburse']),
  status: z.string(),
  statusLabel: z.string(),
  step: z.enum(['approve', 'acknowledge']),
  scopeName: z.string(),
  requesters: z.string(),
  grandTotal: rp,
  requestDate: z.string().nullable(),
  overWarn: z.boolean(),
})
const RecentCashEntry = z.object({
  id: z.number().int(),
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

export const OwnerDashboard = z.object({
  asOf: z.string(),
  month: z.string(),
  cash: z.object({ total: rp, accounts: z.array(z.object({ id: z.number().int(), name: z.string(), active: z.boolean(), balance: rp })), monthIn: rp, monthOut: rp }),
  budget: z.object({ running: z.number().int(), over: z.number().int(), warn: z.number().int(), ok: z.number().int(), none: z.number().int() }),
  completeness: z.object({ ratioDone: z.number().int(), ratioTotal: z.number().int(), withoutLpj: z.number().int(), overdue: z.number().int(), reimburseToVerify: z.number().int(), openWarnings: z.number().int() }),
  approvals: z.object({ count: z.number().int(), sum: rp, waitingForMe: z.number().int(), oldestDays: z.number().int().nullable(), pendingAck: StatusSplit, pendingApproval: StatusSplit }),
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
    warnPct: z.number().meta({ description: 'company-settings.budgetWarnPct (K-08 Waspada threshold)' }),
  }),
})

export const FinanceDashboard = z.object({
  asOf: z.string(),
  month: z.string(),
  transferQueue: TransferQueueSummary,
  reimburseToVerify: z.object({ count: z.number().int(), warnings: z.number().int() }),
  lpjToVerify: z.number().int(),
  lpjToSettle: z.object({ count: z.number().int(), refund: rp, shortfall: rp }),
  accounts: z.array(z.object({ id: z.number().int(), name: z.string(), active: z.boolean(), balance: rp, monthIn: rp, monthOut: rp })),
  cashTotal: rp,
  advancesWithoutLpj: z.array(AdvanceWithoutLpj),
  lpjDueDays: z.number().int(),
  cashFlow: z.object({ basis: z.literal('K-02a'), months: z.number().int(), rows: z.array(CashFlowPoint) }),
  lastClosedPeriod: z.string().nullable(),
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
  docNo: z.string().nullable(),
  title: z.string(),
  type: z.enum(['advance', 'reimburse']),
  status: z.string(),
  waitingFor: z.enum(['direktur', 'finance']),
  scopeName: z.string(),
  requesters: z.string(),
  grandTotal: rp,
  submittedDate: z.string().nullable(),
  days: z.number().int().nullable(),
})

export const PmDashboard = z.object({
  asOf: z.string(),
  month: z.string(),
  hasScope: z.boolean(),
  waitingForMe: z.number().int().meta({ description: 'ADR 0013: 0 for Direktur → Finance requests (PM monitors only); kept for compatibility.' }),
  teamWaiting: z
    .object({ count: z.number().int(), direktur: z.number().int(), finance: z.number().int(), oldestDays: z.number().int().nullable(), items: z.array(TeamWaitingItem) })
    .meta({ description: 'S3e (US-17): team requests waiting for the Direktur (Diketahui) or Finance (Approval), oldest first (max 8 items).' }),
  teamMonth: z.object({ count: z.number().int(), sum: rp, waiting: z.number().int() }),
  lpj: z.object({ withoutLpj: z.number().int(), overdue: z.number().int(), lpjDueDays: z.number().int() }),
  projects: z.array(ProjectBudget),
  costCenters: z.array(CostCenterMonth),
  latest: z.array(RequestRow),
  attendance: z.object({ available: z.literal(false), phase: z.string() }),
  progressReports: z.object({ available: z.literal(false), phase: z.string() }),
  viz: z.object({ requestTrend: z.array(RequestTrendPoint), pipeline: Pipeline, categories: CategoryMix, budgetTotals: BudgetTotals, inbox: z.array(InboxItem), warnPct: z.number() }),
})

const OwnRequest = z.object({ id: z.number().int(), docNo: z.string().nullable(), title: z.string(), type: z.enum(['advance', 'reimburse']), status: z.string(), grandTotal: rp, ageDays: z.number().int() })
export const StaffDashboard = z.object({
  actions: z.array(OwnRequest),
  latest: z.array(OwnRequest),
  month: z.string(),
  viz: z.object({ requestTrend: z.array(RequestTrendPoint), pipeline: Pipeline }),
})

export const AdminDashboard = z.object({
  gaps: z.object({ usersIncomplete: z.number().int(), projectsWithoutPm: z.number().int(), costCentersWithoutManager: z.number().int() }),
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
  })
  .meta({ description: 'Same filters as the web report page; PM filters are intersected with the team scope.' })
