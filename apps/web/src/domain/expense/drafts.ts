import { sql } from '@payloadcms/db-postgres'
import type { CollectionSlug, PayloadRequest } from 'payload'

import { getRequestTx } from '@/lib/tx'

import { employeeIn, exactRolesIn, exactRolesOf, hasRole, hasRoleAny, isRole, isStaffOnly, mappedCompanies, relId, rolesIn, soleCompany, userId, type Role } from '@/access/roles'
import { companyOf } from '@/domain/companies'
import { resolveScope } from '@/access/scope'

import { actorContext, fail, ids, loadRaw, loadVisible, requireAction, today, type RequestDoc } from './common'
import { rapRequirement } from '@/domain/rap/budget'
import { RAP_MISSING_MESSAGE } from '@/domain/rap/rules'

import { normalizeLines, validateLines } from './lines'
import { pmMayFileFor, PM_ON_BEHALF_MESSAGE } from './on-behalf'
import { copyReceiptsForResubmit } from './receipts'
import { INACTIVE_FOR_DUPLICATES, isBusinessDate, isDirectPayment, normalizeInvoiceNo, payeeOf, STATUS_LABELS, type PayeeType, type RequestStatus, type RequestType } from './types'
import { assertDocumentUnused, INTERCOMPANY_NO_ACCOUNT, payeeCompanyErrors } from '@/domain/intercompany/service'
import { failCoded } from '@/domain/coded-error'
import { isClosedProjectStatus } from '@/domain/projects/status'
import { NOT_DELETED } from '@/domain/soft-delete/where'
import { softDeleteEntry } from '@/domain/soft-delete/registry'

export type LineInputApi = {
  id?: string
  description?: string
  qty?: number | null
  uomId?: number | null
  unitPrice?: number | null
  /** Ignored when a unit price is given (D3: server computes qty × unitPrice). */
  total?: number | null
  /** D3 "Nominal sesuai nota" (optional, whole Rupiah ≥ 0). */
  receiptAmount?: number | null
  notes?: string | null
  categoryId?: number | null
  vehicleId?: number | null
  /** D4: RAP item of the request's project (required to submit when the project has a RAP). Omitted = keep the stored one. */
  rapItemId?: number | null
}

export type DraftInput = {
  type?: RequestType
  title?: string
  projectId?: number | null
  /** D2: no longer accepted from the requester — ignored (old APKs keep working); legacy rows keep theirs. */
  costCenterId?: number | null
  neededDate?: string | null
  urgencyLevelId?: number | null
  notes?: string | null
  requesterIds?: number[]
  bankAccountId?: number | null
  lines?: LineInputApi[]
  attachmentIds?: number[]
  clientUuid?: string
  /** ADR 0027 "Jenis penerima" (default karyawan). `vendor` = Pembayaran vendor (Staff / Finance / PM; type is set to advance). */
  payeeType?: PayeeType
  vendorId?: number | null
  vendorBankAccountId?: number | null
  invoiceNo?: string | null
  invoiceDate?: string | null
  invoiceDueDate?: string | null
  /** media-attachments id of the invoice (photo / PDF), uploaded by the caller (POST /media/attachments). */
  invoiceFileId?: number | null
  /** ADR 0028: receiving PT of a `pt_grup` payment (payee directory GET /intercompany/payees). */
  payeeCompanyId?: number | null
}

/**
 * ADR 0027 (D3): roles that may file a vendor payment, IN the request's PT. Owner request 2026-10-16 ("untuk pengajuan
 * vendor dibukakan di level staff"): Staff too — a Staff's vendor payment follows the normal Staff flow (default rule:
 * PM project → Direktur → Owner → Finance transfer). PT grup (INTERCOMPANY_PAYMENT_ROLES) is unchanged.
 */
export const VENDOR_PAYMENT_ROLES: readonly Role[] = ['pk-finance', 'pk-pm', 'pk-staff']

export const VENDOR_PAYMENT_ROLE_MESSAGE = 'Pembayaran vendor hanya dapat diajukan oleh Staff, Finance atau PM di PT ini.'

/**
 * ADR 0028 (owner decision 2026-10-14): roles that may file a payment to another PT of the group, IN the paying PT —
 * Finance, PM and Direktur (`pk-owner`). Staff, Admin and an Owner (`pk-principal`) without one of these roles cannot.
 */
export const INTERCOMPANY_PAYMENT_ROLES: readonly Role[] = ['pk-finance', 'pk-pm', 'pk-owner']

export const INTERCOMPANY_PAYMENT_ROLE_MESSAGE = 'Pembayaran antar-PT hanya dapat diajukan oleh Finance, PM atau Direktur di PT ini.'

/** Filer roles of a payment without LPJ (ADR 0027 / 0028), per payee type. */
export function payeeFilerRoles(payee: PayeeType): readonly Role[] {
  return payee === 'pt_grup' ? INTERCOMPANY_PAYMENT_ROLES : VENDOR_PAYMENT_ROLES
}

/**
 * ADR 0028: may the CALLER file a PT grup payment in PT `company` (no PT yet: in any selected PT)? Checked on the
 * STORED roles (ADR 0026 `exactRolesIn`): the Owner (`pk-principal`) carries the Direktur's access everywhere else, but
 * the owner's decision names Finance, PM and Direktur only — an Owner without one of those roles cannot file.
 */
export function mayFileIntercompany(req: Parameters<typeof exactRolesIn>[0], company?: number): boolean {
  const roles = company !== undefined ? exactRolesIn(req, company) : exactRolesOf(req.user)
  return roles.some((r) => INTERCOMPANY_PAYMENT_ROLES.includes(r))
}

/**
 * Payee fields of a draft (ADR 0027 vendor, ADR 0028 PT grup) — the part of `validateContent`'s input that only a
 * payment without LPJ uses (the invoice fields hold the vendor's invoice / the receiving PT's document).
 */
export type VendorContent = {
  payeeType?: PayeeType | null
  vendorId?: number | null
  vendorBankAccountId?: number | null
  payeeCompanyId?: number | null
  invoiceNo?: string | null
  invoiceDate?: string | null
  invoiceDueDate?: string | null
  invoiceFileId?: number | null
}

const OFFICE = ['pk-admin', 'pk-finance', 'pk-owner'] as const

/**
 * req.context flag: the service already ran validateContent() (or deliberately skips it, e.g. the
 * resubmit clone) → the collection hook does not validate the same write twice.
 */
export const CONTENT_VALIDATED = 'pkContentValidated'

async function validated<T>(req: PayloadRequest, fn: () => Promise<T>): Promise<T> {
  const before = req.context[CONTENT_VALIDATED]
  req.context[CONTENT_VALIDATED] = true
  try {
    return await fn()
  } finally {
    req.context[CONTENT_VALIDATED] = before
  }
}

/**
 * Active master ids among `wanted`. Per-PT masters (`perPt`): only rows of the PTs the caller is mapped
 * to (QA-MC4-10, scope rule 2026-10-02) — a row of another PT is reported like a missing one.
 */
async function activeIds(req: PayloadRequest, collection: CollectionSlug, wanted: number[], perPt = true): Promise<Set<number>> {
  if (wanted.length === 0) return new Set()
  const mapped = perPt ? mappedCompanies(req) : null
  const res = await req.payload.find({
    collection,
    // D1610: a soft-deleted master is refused like an inactive one (an explicit id list skips the central read rule)
    where: { and: [{ id: { in: wanted } }, { active: { not_equals: false } }, ...(softDeleteEntry(collection) ? [NOT_DELETED] : []), ...(mapped !== null ? [{ company: { in: mapped } }] : [])] },
    depth: 0,
    pagination: false,
    overrideAccess: true, // SYSTEM-READ: master validation
    req,
  })
  return new Set(res.docs.map((d) => d.id as number))
}

/**
 * Active employees among `wanted` → their PT. Only employees of PTs the caller is mapped to (QA-MC4-10):
 * one of another PT is reported like a missing one.
 */
async function activeEmployees(req: PayloadRequest, wanted: number[]): Promise<Map<number, number>> {
  if (wanted.length === 0) return new Map()
  const mapped = mappedCompanies(req)
  const res = await req.payload.find({
    collection: 'employees',
    where: { and: [{ id: { in: wanted } }, { active: { not_equals: false } }, NOT_DELETED, ...(mapped !== null ? [{ company: { in: mapped } }] : [])] },
    depth: 0,
    pagination: false,
    select: { company: true },
    overrideAccess: true, // SYSTEM-READ: requester validation (PTs filtered to the caller's mapping)
    req,
  })
  return new Map(res.docs.map((d) => [d.id as number, relId((d as { company?: unknown }).company) ?? -1]))
}

/**
 * PT of a draft (ADR 0016): the PT of its project / cost center, else the caller's only selected PT
 * (a request without scope yet); undefined = ambiguous (the collection hook then asks for a PT).
 */
async function draftCompany(req: PayloadRequest, c: { projectId?: number | null; costCenterId?: number | null }): Promise<number | undefined> {
  const raw = c.projectId ? await companyOf(req, 'projects', c.projectId) : c.costCenterId ? await companyOf(req, 'cost-centers', c.costCenterId) : soleCompany(req)
  // QA-MC4-10: a project / cost center of a PT the caller is not mapped to behaves like a missing one
  return isForeign(req, raw) ? undefined : raw
}

/** PT outside the caller's mapping (system requests: never). */
function isForeign(req: PayloadRequest, company: number | undefined): boolean {
  const mapped = mappedCompanies(req)
  return company !== undefined && mapped !== null && !mapped.includes(company)
}

/**
 * Header/line/master validation shared by create, update and submit (US-03, US-37, US-40, US-44,
 * US-53, G9, G10, Q-09, Q-11, Q-22). `forSubmit` adds completeness rules.
 */
export async function validateContent(
  req: PayloadRequest,
  c: {
    type: RequestType
    title?: string | null
    projectId?: number | null
    costCenterId?: number | null
    requesterIds: number[]
    bankAccountId?: number | null
    lines: LineInputApi[]
    neededDate?: string | null
    urgencyLevelId?: number | null
  } & VendorContent,
  opts: {
    forSubmit: boolean
    creatorId: number
    callerSetsRequesters?: boolean
    /** D2: a legacy cost-center request submitted before (withdrawn / back to Draft) may be sent again without a project. */
    legacyCostCenter?: boolean
    /** ADR 0027: the request itself (excluded from the duplicate-invoice check); absent on create. */
    requestId?: number
  },
): Promise<void> {
  const errors: Array<{ path: string; message: string }> = []
  // ADR 0016 §5: roles, scope and own employee IN THE REQUEST's PT (from its project / cost center)
  const company = await draftCompany(req, c)
  const office = company !== undefined ? hasRole(req, OFFICE, company) : hasRoleAny(req, ...OFFICE)
  const scope = () => resolveScope(req, company ?? null)

  if (c.projectId && c.costCenterId) errors.push({ path: 'projectId', message: 'Pilih project ATAU pusat biaya, tidak keduanya.' })
  // D2 (owner 2026-10-11): no non-project requests — the project is mandatory to send (legacy cost-center rows aside).
  // ADR 0027 (client 2026-10-14): a vendor payment may name a cost center instead (e.g. office bills).
  // ADR 0028: the same for a payment to a PT of the group
  const payee = payeeOf(c.payeeType)
  const direct = payee !== 'karyawan'
  if (opts.forSubmit && !c.projectId && !(c.costCenterId && (opts.legacyCostCenter || direct))) {
    errors.push({
      path: 'projectId',
      message: payee === 'vendor' ? 'Pilih project atau pusat biaya (pembayaran vendor).' : payee === 'pt_grup' ? 'Pilih project atau pusat biaya (pembayaran antar-PT).' : 'Project wajib diisi (pengajuan tanpa project tidak dapat dikirim).',
    })
  }
  if (opts.forSubmit && !(c.title ?? '').trim()) errors.push({ path: 'title', message: 'Judul wajib diisi.' })
  if (c.neededDate && !isBusinessDate(c.neededDate)) errors.push({ path: 'neededDate', message: 'Tanggal harus YYYY-MM-DD.' })

  // G10: project / cost center in the caller's scope (office roles: any active one).
  if (c.projectId) {
    const p = await req.payload.findByID({ collection: 'projects', id: c.projectId, depth: 0, overrideAccess: true /* SYSTEM-READ: scope check */, req }).catch(() => null)
    // D1610: a soft-deleted project is reported like a missing one (findByID still returns it — labels of old documents)
    if (!p || p.isDeleted === true || isForeign(req, relId(p.company) ?? -1)) errors.push({ path: 'projectId', message: 'Project tidak ditemukan.' })
    else if (isClosedProjectStatus(p.status) || p.status === 'selesai') errors.push({ path: 'projectId', message: p.status === 'dibatalkan' ? 'Project sudah dibatalkan.' : 'Project sudah selesai/diarsipkan.' })
    else if (!office && !(await scope()).assignedProjects.includes(c.projectId)) fail(403, 'Project di luar penugasan Anda.')
  }
  if (c.costCenterId) {
    const cc = await req.payload.findByID({ collection: 'cost-centers', id: c.costCenterId, depth: 0, overrideAccess: true /* SYSTEM-READ: scope check */, req }).catch(() => null)
    if (!cc || cc.active === false || cc.isDeleted === true || isForeign(req, relId(cc.company) ?? -1)) errors.push({ path: 'costCenterId', message: 'Pusat biaya tidak ditemukan atau nonaktif.' })
    else if (!office && !(await scope()).assignedCostCenters.includes(c.costCenterId)) fail(403, 'Pusat biaya di luar penugasan Anda.')
  }

  // Owner decision 2026-10-09: "Tingkat Urgensi" (per-PT master) replaces the activity period of Q-04.
  if (c.urgencyLevelId) {
    const u = await req.payload.findByID({ collection: 'urgency-levels', id: c.urgencyLevelId, depth: 0, overrideAccess: true /* SYSTEM-READ: master check */, req }).catch(() => null)
    const uPt = relId(u?.company) ?? -1
    if (!u || u.active === false || isForeign(req, uPt) || (company !== undefined && uPt !== company)) {
      errors.push({ path: 'urgencyLevelId', message: 'Tingkat urgensi tidak ditemukan atau nonaktif.' })
    }
  }

  // Requesters (US-40): ≥ 1 active employee; Staff/PM only for themselves (Q-09 default; D1810: the PM also for
  // the team of the request's project).
  const uniq = [...new Set(c.requesterIds)]
  if (uniq.length !== c.requesterIds.length) errors.push({ path: 'requesterIds', message: 'Pemohon tidak boleh ganda.' })
  if (opts.forSubmit && uniq.length === 0) errors.push({ path: 'requesterIds', message: 'Minimal 1 pemohon (Diajukan Oleh).' })
  const activeEmp = await activeEmployees(req, uniq)
  uniq.filter((e) => !activeEmp.has(e)).forEach((e) => errors.push({ path: 'requesterIds', message: `Karyawan #${e} tidak ditemukan atau nonaktif.` }))
  // QA-MC4-09: "Admin/Finance for others" needs that role IN THE DERIVED PT(s) = the PT of the project /
  // cost center and of every requester (the collection hook derives the document's PT from them), never
  // a role held in another PT. No derivable PT (no reference yet) → the role in any selected PT, as before.
  const derived = [...new Set([...(company !== undefined ? [company] : []), ...activeEmp.values()])]
  const onBehalf = derived.length > 0 ? derived.every((pt) => hasRole(req, ['pk-admin', 'pk-finance'], pt)) : hasRoleAny(req, 'pk-admin', 'pk-finance')
  const ownPt = company ?? (derived.length === 1 ? derived[0] : undefined)
  // QA-15 (owner decision 2026-10-08): a user whose ONLY role in the request's PT is Staff requests for
  // themselves only — "Diajukan Oleh" = exactly their own employee. PM keeps Q-09 (themselves, may add
  // co-requesters; D1810: or the team of a project he leads); Admin/Finance may represent others (QA-MC4-09
  // above). Checked for the CREATOR of the request (also at submit, so an older draft that breaks the rule
  // cannot be sent) and for a Staff-only caller who changes the requesters of someone else's draft. Before Q-09
  // (clearer message for Staff).
  if (uniq.length > 0) await assertStaffSelfOnly(req, uniq, ownPt, opts)
  // ADR 0024 (owner decision 2026-10-11): the PM no longer files on a Direktur's behalf (ADR 0021
  // `direktur_via_pm` withdrawn) — a Direktur files his own request (zero-step rule → Finance transfer queue).
  // D1810 (owner decision 2026-10-18): the PM of the request's project also files for its team members (pmMayFileFor).
  if (!onBehalf) {
    const creatorEmp = ownPt !== undefined ? employeeIn(req, ownPt) : relId((req.user as { employee?: unknown } | null)?.employee)
    if (userId(req) === opts.creatorId && (creatorEmp === undefined || (uniq.length > 0 && !uniq.includes(creatorEmp)))) {
      const pm = await pmMayFileFor(req, { company: ownPt, projectId: c.projectId, requesters: uniq, own: creatorEmp })
      if (pm === false) fail(403, PM_ON_BEHALF_MESSAGE)
      if (pm === undefined) fail(403, 'Hanya Admin/Finance yang boleh membuat pengajuan atas nama orang lain.')
    }
  }

  // ADR 0027: a vendor payment pays the vendor's account — the requester's account plays no part. ADR 0028: a PT grup
  // payment pays the receiving PT's designated account.
  let noAccount = false
  if (direct) {
    if (c.bankAccountId) errors.push({ path: 'bankAccountId', message: payee === 'vendor' ? 'Pembayaran vendor memakai rekening vendor, bukan rekening karyawan.' : 'Pembayaran antar-PT memakai rekening penerimaan PT penerima, bukan rekening karyawan.' })
    const payeeCheck = await directPaymentErrors(req, c, { ...opts, company: ownPt, requesters: uniq })
    errors.push(...payeeCheck.errors)
    noAccount = payeeCheck.noAccount
  }
  // G9 / US-44 / Q-11: account of one of the requesters, active.
  if (!direct && opts.forSubmit && !c.bankAccountId) errors.push({ path: 'bankAccountId', message: 'Rekening tujuan wajib diisi.' })
  if (!direct && c.bankAccountId) {
    const acc = await req.payload
      .findByID({ collection: 'employee-bank-accounts', id: c.bankAccountId, depth: 0, overrideAccess: true /* SYSTEM-READ: G9 */, req })
      .catch(() => null)
    if (!acc || acc.active === false || isForeign(req, relId(acc.company) ?? -1)) errors.push({ path: 'bankAccountId', message: 'Rekening tidak ditemukan atau nonaktif.' })
    else if (!uniq.includes(relId(acc.employee) ?? -1)) errors.push({ path: 'bankAccountId', message: 'Rekening harus milik salah satu pemohon.' })
  }

  // Lines (US-37) + masters.
  // D3: validated as the server will store them (total = qty × unit price; a client total is ignored)
  const lineErrors = validateLines(
    normalizeLines(c.lines).map((l) => ({ description: l.description, qty: l.qty, uom: l.uomId, unitPrice: l.unitPrice, total: l.total, receiptAmount: l.receiptAmount, notes: l.notes, category: l.categoryId, vehicle: l.vehicleId })),
    { forSubmit: opts.forSubmit },
  )
  errors.push(...lineErrors.map((e) => ({ path: e.path.replace(/\.(uom|category|vehicle)$/, '.$1Id'), message: e.message })))
  const catIds = [...new Set(c.lines.map((l) => l.categoryId).filter((x): x is number => !!x))]
  const uomIds = [...new Set(c.lines.map((l) => l.uomId).filter((x): x is number => !!x))]
  const vehIds = [...new Set(c.lines.map((l) => l.vehicleId).filter((x): x is number => !!x))]
  const [cats, uoms, vehs] = await Promise.all([activeIds(req, 'expense-categories', catIds), activeIds(req, 'uoms', uomIds, false), activeIds(req, 'vehicles', vehIds)])
  let needsVehicle = new Set<number>()
  if (opts.forSubmit && catIds.length > 0) {
    const res = await req.payload.find({
      collection: 'expense-categories',
      where: { and: [{ id: { in: catIds } }, { requiresVehicle: { equals: true } }] },
      depth: 0,
      pagination: false,
      overrideAccess: true, // SYSTEM-READ: vehicle requirement (Q-22)
      req,
    })
    needsVehicle = new Set(res.docs.map((d) => d.id as number))
  }
  c.lines.forEach((l, i) => {
    if (l.categoryId && !cats.has(l.categoryId)) errors.push({ path: `lines.${i}.categoryId`, message: 'Kategori tidak ditemukan atau nonaktif.' })
    if (l.uomId && !uoms.has(l.uomId)) errors.push({ path: `lines.${i}.uomId`, message: 'Satuan tidak ditemukan atau nonaktif.' })
    if (l.vehicleId && !vehs.has(l.vehicleId)) errors.push({ path: `lines.${i}.vehicleId`, message: 'Kendaraan tidak ditemukan atau nonaktif.' })
    if (l.categoryId && needsVehicle.has(l.categoryId) && !l.vehicleId) {
      errors.push({ path: `lines.${i}.vehicleId`, message: 'Kategori ini wajib ditautkan ke kendaraan.' })
    }
  })
  errors.push(...(await rapLineErrors(req, c.projectId ?? null, c.lines, opts.forSubmit)))
  if (errors.length > 0) {
    // ADR 0028: the chosen PT designated no receiving account → stable code (the APK / form explain it)
    if (noAccount) failCoded(400, INTERCOMPANY_NO_ACCOUNT, 'Data pengajuan tidak valid.', { payeeCompanyId: c.payeeCompanyId ?? null }, errors)
    fail(400, 'Data pengajuan tidak valid.', errors)
  }
  // ADR 0027: the same invoice of the same vendor on another live request → 409 (DB: expense_requests_vendor_invoice_uq)
  if (payee === 'vendor' && c.vendorId && normalizeInvoiceNo(c.invoiceNo)) await assertInvoiceUnused(req, c.vendorId, c.invoiceNo!, opts.requestId)
  // ADR 0028 (owner 2026-10-14): the same document of the same receiving PT → 409 (DB: expense_requests_ic_invoice_uq)
  if (payee === 'pt_grup' && c.payeeCompanyId && normalizeInvoiceNo(c.invoiceNo)) await assertDocumentUnused(req, c.payeeCompanyId, c.invoiceNo!, opts.requestId)
}

/**
 * ADR 0027 (D3): vendor-payment rules of a draft / submit — filer = Staff, Finance or PM of the request's PT (Staff: owner
 * request 2026-10-16), the requester is the filer himself, an active vendor of the PT and an active account OF THAT
 * vendor, invoice number / date / file (required to send), due date not before the invoice date.
 * ADR 0028 (owner 2026-10-14): a PT grup payment the same way — filer = Finance, PM or Direktur of the paying PT, the
 * receiving PT (active, another PT, with a designated receiving account) instead of vendor + account, and the receiving
 * PT's document (invoice / memo: number, date, file required to send).
 */
async function directPaymentErrors(
  req: PayloadRequest,
  c: VendorContent & { type: RequestType },
  opts: { forSubmit: boolean; creatorId: number; company: number | undefined; requesters: number[] },
): Promise<{ errors: Array<{ path: string; message: string }>; noAccount: boolean }> {
  const errors: Array<{ path: string; message: string }> = []
  const payee = payeeOf(c.payeeType)
  const vendorPay = payee === 'vendor'
  const roles = payeeFilerRoles(payee)
  const roleMessage = vendorPay ? VENDOR_PAYMENT_ROLE_MESSAGE : INTERCOMPANY_PAYMENT_ROLE_MESSAGE
  const kind = vendorPay ? 'Pembayaran vendor' : 'Pembayaran antar-PT'
  // D3: Staff (2026-10-16), Finance and PM (ADR 0028 PT grup: Finance, PM, Direktur) — checked for the CREATOR in the request's PT (no PT yet: the caller's roles in any selected PT)
  if (opts.company !== undefined) {
    const mine = await rolesOfUserIn(req, opts.creatorId, opts.company)
    // ADR 0028: PT grup on the STORED roles (an Owner-only user is not a Direktur filer); another creator's are stored anyway
    const filer = !vendorPay && opts.creatorId === userId(req) ? exactRolesIn(req, opts.company) : mine.roles
    if (!filer.some((r) => roles.includes(r))) fail(403, roleMessage)
    // the filer is the applicant: "Pemohon" = exactly his own employee in the PT (routing by his role, ADR 0027)
    if (opts.requesters.length > 0 && (mine.employee === undefined || opts.requesters.length !== 1 || opts.requesters[0] !== mine.employee)) {
      errors.push({ path: 'requesterIds', message: vendorPay ? 'Pembayaran vendor: pemohon adalah pembuat pengajuan sendiri (Staff / Finance / PM).' : 'Pembayaran antar-PT: pemohon adalah pembuat pengajuan sendiri (Finance / PM / Direktur).' })
    }
  } else if (vendorPay ? !hasRoleAny(req, ...roles) : !mayFileIntercompany(req)) fail(403, roleMessage)
  if (c.type !== 'advance') errors.push({ path: 'type', message: `${kind} memakai jenis Pengajuan Baru.` })

  let noAccount = false
  let vendorPt: number | undefined
  if (!vendorPay) {
    // ADR 0028: receiving PT (≠ own PT, active, designated receiving account)
    const pc = await payeeCompanyErrors(req, c.payeeCompanyId, { forSubmit: opts.forSubmit, ownCompany: opts.company })
    errors.push(...pc.errors)
    noAccount = pc.noAccount
  }
  if (vendorPay && opts.forSubmit && !c.vendorId) errors.push({ path: 'vendorId', message: 'Vendor wajib dipilih.' })
  if (vendorPay && c.vendorId) {
    const v = (await req.payload.findByID({ collection: 'vendors', id: c.vendorId, depth: 0, overrideAccess: true /* SYSTEM-READ: vendor check (PT below) */, req, disableErrors: true })) as { company?: unknown; active?: boolean | null } | null
    vendorPt = relId(v?.company)
    if (!v || v.active === false || isForeign(req, vendorPt ?? -1) || (opts.company !== undefined && vendorPt !== opts.company)) errors.push({ path: 'vendorId', message: 'Vendor tidak ditemukan, nonaktif, atau bukan vendor PT pengajuan ini.' })
  }
  if (vendorPay && opts.forSubmit && !c.vendorBankAccountId) errors.push({ path: 'vendorBankAccountId', message: 'Rekening vendor wajib dipilih.' })
  if (vendorPay && c.vendorBankAccountId) {
    const a = (await req.payload.findByID({ collection: 'vendor-bank-accounts', id: c.vendorBankAccountId, depth: 0, overrideAccess: true /* SYSTEM-READ: vendor account check (vendor + PT below) */, req, disableErrors: true })) as {
      company?: unknown
      vendor?: unknown
      active?: boolean | null
    } | null
    if (!a || a.active === false || isForeign(req, relId(a.company) ?? -1)) errors.push({ path: 'vendorBankAccountId', message: 'Rekening vendor tidak ditemukan atau nonaktif.' })
    else if (!c.vendorId || relId(a.vendor) !== c.vendorId) errors.push({ path: 'vendorBankAccountId', message: 'Rekening harus milik vendor yang dipilih.' })
  }

  // vendor: "invoice"; PT grup: the receiving PT's "dokumen" (tagihan / memo)
  const doc = vendorPay ? 'invoice' : 'dokumen (tagihan / memo PT penerima)'
  const invoiceNo = (c.invoiceNo ?? '').trim()
  if (opts.forSubmit && !invoiceNo) errors.push({ path: 'invoiceNo', message: `Nomor ${doc} wajib diisi.` })
  else if (invoiceNo && !normalizeInvoiceNo(invoiceNo)) errors.push({ path: 'invoiceNo', message: `Nomor ${doc} harus memuat huruf atau angka.` })
  if (invoiceNo.length > 64) errors.push({ path: 'invoiceNo', message: `Nomor ${doc} maksimal 64 karakter.` })
  if (opts.forSubmit && !c.invoiceDate) errors.push({ path: 'invoiceDate', message: `Tanggal ${doc} wajib diisi.` })
  if (c.invoiceDate && !isBusinessDate(c.invoiceDate)) errors.push({ path: 'invoiceDate', message: 'Tanggal harus YYYY-MM-DD.' })
  else if (c.invoiceDate) {
    const todayDate = await today(req, opts.company ?? vendorPt)
    if (c.invoiceDate > todayDate) errors.push({ path: 'invoiceDate', message: `Tanggal ${vendorPay ? 'invoice' : 'dokumen'} tidak boleh di masa depan (hari ini ${todayDate}).` })
  }
  if (c.invoiceDueDate && !isBusinessDate(c.invoiceDueDate)) errors.push({ path: 'invoiceDueDate', message: 'Tanggal harus YYYY-MM-DD.' })
  else if (c.invoiceDueDate && c.invoiceDate && isBusinessDate(c.invoiceDate) && c.invoiceDueDate < c.invoiceDate) errors.push({ path: 'invoiceDueDate', message: `Jatuh tempo tidak boleh sebelum tanggal ${vendorPay ? 'invoice' : 'dokumen'}.` })
  if (opts.forSubmit && !c.invoiceFileId) errors.push({ path: 'invoiceFileId', message: `File ${doc} (foto / PDF) wajib diunggah.` })
  if (c.invoiceFileId) {
    const m = (await req.payload.findByID({ collection: 'media-attachments', id: c.invoiceFileId, depth: 0, overrideAccess: true /* SYSTEM-READ: invoice file exists (owner link at submit) */, req, disableErrors: true })) as { id?: number } | null
    if (!m) errors.push({ path: 'invoiceFileId', message: `File ${vendorPay ? 'invoice' : 'dokumen'} tidak ditemukan; unggah ulang.` })
  }
  return { errors, noAccount }
}

/** Message of a duplicate invoice (ADR 0027): the other request by number (or id) and its status. */
export function duplicateInvoiceMessage(invoiceNo: string, other: { id: number; docNo: string | null; status: RequestStatus }): string {
  return `Invoice ${invoiceNo.trim()} dari vendor ini sudah dipakai di pengajuan ${other.docNo ?? `#${other.id} (draft)`} — status ${STATUS_LABELS[other.status]}. Satu invoice hanya boleh dibayar sekali; batalkan pengajuan lama atau periksa nomor invoice.`
}

/**
 * ADR 0027 duplicate-invoice rule: same vendor + same normalized invoice number on a request that is not cancelled /
 * rejected (Draft included) → 409 with a field error on `invoiceNo`. The DB unique index
 * `expense_requests_vendor_invoice_uq` (same key, `pk_invoice_key`) is the final guard against a race.
 */
export async function assertInvoiceUnused(req: PayloadRequest, vendorId: number, invoiceNo: string, requestId?: number): Promise<void> {
  const key = normalizeInvoiceNo(invoiceNo)
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT id, doc_no, status::text AS status FROM expense_requests
     WHERE payee_type = 'vendor' AND vendor_id = ${vendorId} AND id <> ${requestId ?? -1}
       AND status::text NOT IN (${sql.join(
         INACTIVE_FOR_DUPLICATES.map((s) => sql`${s}`),
         sql`, `,
       )})
       AND pk_invoice_key(invoice_no) = ${key}
     ORDER BY id LIMIT 1`)) as unknown as { rows: Array<{ id: number; doc_no: string | null; status: RequestStatus }> }
  const other = r.rows[0]
  if (!other) return
  const message = duplicateInvoiceMessage(invoiceNo, { id: Number(other.id), docNo: other.doc_no, status: other.status })
  fail(409, message, [{ path: 'invoiceNo', message }])
}

/**
 * D4 (owner 2026-10-11): every line names a RAP item OF THE REQUEST's PROJECT. Draft: a chosen item must belong to the
 * project; submit: required on every line when the project has a RAP, an inactive item must be replaced, and a
 * project that needs a RAP (any kind with a RAB, or konstruksi — "RAP wajib untuk semua proyek yang punya RAB") but has
 * none cannot send requests yet (the PM / Direktur fills the RAP first). Requests sent before stay valid.
 */
async function rapLineErrors(req: PayloadRequest, projectId: number | null, lines: LineInputApi[], forSubmit: boolean): Promise<Array<{ path: string; message: string }>> {
  const errors: Array<{ path: string; message: string }> = []
  const chosen = lines.some((l) => l.rapItemId)
  if (!projectId) {
    lines.forEach((l, i) => {
      if (l.rapItemId) errors.push({ path: `lines.${i}.rapItemId`, message: 'Pilih project dulu, lalu item RAP dari project itu.' })
    })
    return errors
  }
  if (!chosen && !forSubmit) return errors
  const rap = await rapRequirement(req, projectId)
  if (forSubmit && !rap.hasRap && rap.required) {
    errors.push({ path: 'projectId', message: RAP_MISSING_MESSAGE })
  }
  lines.forEach((l, i) => {
    const item = l.rapItemId ? rap.items.get(l.rapItemId) : undefined
    if (l.rapItemId && !item) errors.push({ path: `lines.${i}.rapItemId`, message: 'Item RAP bukan item RAP project pengajuan ini.' })
    else if (forSubmit && item && !item.active) errors.push({ path: `lines.${i}.rapItemId`, message: 'Item RAP sudah nonaktif — pilih item RAP lain.' })
    else if (forSubmit && !l.rapItemId && rap.hasRap) errors.push({ path: `lines.${i}.rapItemId`, message: 'Item RAP wajib dipilih.' })
  })
  return errors
}

export const STAFF_SELF_ONLY_MESSAGE = 'Staff hanya dapat mengajukan untuk dirinya sendiri: "Diajukan Oleh" harus hanya Anda. Minta PM/Admin/Finance bila pengajuan untuk orang lain (QA-15).'

/** QA-15: roles of `uid` IN PT `company` (active membership), from the caller's context when it is the caller. */
async function rolesOfUserIn(req: PayloadRequest, uid: number, company: number): Promise<{ roles: Role[]; employee: number | undefined }> {
  if (uid === userId(req)) return { roles: rolesIn(req, company), employee: employeeIn(req, company) }
  const res = await req.payload.find({
    collection: 'company-memberships',
    where: { and: [{ user: { equals: uid } }, { company: { equals: company } }, { active: { equals: true } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true, // SYSTEM-READ: creator's roles in the request's PT (QA-15 rule)
    req,
  })
  const m = res.docs[0] as { roles?: unknown; employee?: unknown } | undefined
  return { roles: (Array.isArray(m?.roles) ? m.roles : []).filter(isRole), employee: relId(m?.employee) }
}

const staffOnly = (roles: readonly Role[]) => roles.includes('pk-staff') && roles.every((r) => r === 'pk-staff')

async function assertStaffSelfOnly(req: PayloadRequest, requesters: number[], company: number | undefined, opts: { creatorId: number; callerSetsRequesters?: boolean }): Promise<void> {
  const caller = userId(req)
  const check = async (uid: number) => {
    if (company === undefined) {
      // no PT derivable yet (nothing chosen): only the caller's own Staff-only status is known
      if (uid !== caller || !isStaffOnly(req.user)) return
      const emp = relId((req.user as { employee?: unknown } | null)?.employee)
      if (emp === undefined || requesters.some((e) => e !== emp)) fail(403, STAFF_SELF_ONLY_MESSAGE)
      return
    }
    const { roles, employee } = await rolesOfUserIn(req, uid, company)
    if (!staffOnly(roles)) return
    if (employee === undefined || requesters.length !== 1 || requesters[0] !== employee) fail(403, STAFF_SELF_ONLY_MESSAGE)
  }
  if (opts.creatorId > 0) await check(opts.creatorId)
  if (caller !== undefined && caller !== opts.creatorId && opts.callerSetsRequesters) await check(caller)
}

/** ADR 0027: the vendor fields of a stored request in API shape (ADR 0028: + the receiving PT). */
export function vendorOfDoc(doc: RequestDoc): Required<VendorContent> {
  return {
    payeeType: payeeOf(doc.payeeType),
    vendorId: relId(doc.vendor) ?? null,
    vendorBankAccountId: relId(doc.vendorBankAccount) ?? null,
    payeeCompanyId: relId(doc.payeeCompany) ?? null,
    invoiceNo: doc.invoiceNo ?? null,
    invoiceDate: doc.invoiceDate ?? null,
    invoiceDueDate: doc.invoiceDueDate ?? null,
    invoiceFileId: relId(doc.invoiceFile) ?? null,
  }
}

/** ADR 0027 / 0028: validateContent's payee part of an API input (karyawan: nothing but the payee type). */
function vendorInput(input: VendorContent, payee: PayeeType): VendorContent {
  if (payee === 'karyawan') return { payeeType: 'karyawan' }
  return {
    payeeType: payee,
    vendorId: payee === 'vendor' ? (input.vendorId ?? null) : null,
    vendorBankAccountId: payee === 'vendor' ? (input.vendorBankAccountId ?? null) : null,
    payeeCompanyId: payee === 'pt_grup' ? (input.payeeCompanyId ?? null) : null,
    invoiceNo: input.invoiceNo ?? null,
    invoiceDate: input.invoiceDate ?? null,
    invoiceDueDate: input.invoiceDueDate ?? null,
    invoiceFileId: input.invoiceFileId ?? null,
  }
}

/**
 * ADR 0027 / 0028: the payee columns written for a draft — only those of its payee type (karyawan → all empty), so a
 * payee switch never leaves stale data (DB CHECK expense_requests_payee).
 */
export function vendorData(input: VendorContent, payee: PayeeType): Record<string, unknown> {
  const direct = payee !== 'karyawan'
  return {
    payeeType: payee,
    vendor: payee === 'vendor' ? (input.vendorId ?? null) : null,
    vendorBankAccount: payee === 'vendor' ? (input.vendorBankAccountId ?? null) : null,
    payeeCompany: payee === 'pt_grup' ? (input.payeeCompanyId ?? null) : null,
    invoiceNo: direct ? (input.invoiceNo?.trim() || null) : null,
    invoiceDate: direct ? (input.invoiceDate ?? null) : null,
    invoiceDueDate: direct ? (input.invoiceDueDate ?? null) : null,
    invoiceFile: direct ? (input.invoiceFileId ?? null) : null,
  }
}

export function toDocLines(lines: LineInputApi[]) {
  return lines.map((l) => ({
    ...(l.id ? { id: l.id } : {}),
    description: l.description?.trim() ?? null,
    qty: l.qty ?? null,
    uom: l.uomId ?? null,
    unitPrice: l.unitPrice ?? null,
    total: l.total ?? null, // recomputed by the collection hook (D3)
    receiptAmount: l.receiptAmount ?? null,
    notes: l.notes ?? null,
    category: l.categoryId ?? null,
    vehicle: l.vehicleId ?? null,
    rapItem: l.rapItemId ?? null,
  }))
}

export function fromDocLines(doc: RequestDoc): LineInputApi[] {
  return (doc.lines ?? []).map((l) => ({
    id: l.id,
    description: l.description ?? undefined,
    qty: l.qty ?? null,
    uomId: relId(l.uom) ?? null,
    unitPrice: l.unitPrice ?? null,
    total: l.total ?? null,
    receiptAmount: l.receiptAmount ?? null,
    notes: l.notes ?? null,
    categoryId: relId(l.category) ?? null,
    vehicleId: relId(l.vehicle) ?? null,
    rapItemId: relId(l.rapItem) ?? null,
  }))
}

/**
 * D4 compatibility: a client that does not know RAP items (APK ≤ 0.7, old API callers) sends lines without
 * `rapItemId` — a line that keeps its id keeps its stored RAP item instead of losing it. `null` clears it.
 */
export function keepRapItems(lines: LineInputApi[], stored: LineInputApi[]): LineInputApi[] {
  const byId = new Map(stored.filter((l) => l.id).map((l) => [l.id as string, l.rapItemId ?? null]))
  return lines.map((l) => (l.rapItemId === undefined && l.id && byId.has(l.id) ? { ...l, rapItemId: byId.get(l.id) ?? null } : l))
}

/** POST /expense-requests — new Draft (idempotent per clientUuid for the APK offline queue). */
export async function createDraft(req: PayloadRequest, input: DraftInput & { type: RequestType; title: string }): Promise<{ doc: RequestDoc; created: boolean }> {
  const uid = userId(req)
  if (uid === undefined) fail(401, 'Unauthorized')
  if (input.clientUuid) {
    const found = await req.payload.find({
      collection: 'expense-requests',
      where: { clientUuid: { equals: input.clientUuid } },
      depth: 0,
      limit: 1,
      overrideAccess: true, // SYSTEM-READ: offline idempotency key lookup
      req,
    })
    const existing = found.docs[0] as unknown as RequestDoc | undefined
    if (existing) {
      if (relId(existing.createdBy) !== uid) fail(409, 'clientUuid sudah dipakai.')
      return { doc: existing, created: false }
    }
  }
  // D2: a cost center sent by an old client is ignored (the requester no longer picks one) — ADR 0027: except on a
  // vendor payment without a project (ADR 0028: or a PT grup payment)
  const payee = payeeOf(input.payeeType)
  const direct = payee !== 'karyawan'
  const vendorCc = direct && !input.projectId ? (input.costCenterId ?? null) : null
  const company = await draftCompany(req, { projectId: input.projectId, costCenterId: vendorCc })
  const emp = company !== undefined ? employeeIn(req, company) : relId((req.user as { employee?: unknown } | null)?.employee)
  const requesterIds = input.requesterIds && input.requesterIds.length > 0 ? input.requesterIds : emp !== undefined ? [emp] : []
  const lines = input.lines ?? []
  // ADR 0027 / 0028: a vendor / PT grup payment is always a Pengajuan Baru (type advance), without an employee account
  const type: RequestType = direct ? 'advance' : input.type
  await validateContent(req, { ...input, type, costCenterId: vendorCc, requesterIds, lines, ...vendorInput(input, payee) }, { forSubmit: false, creatorId: uid })
  const doc = await validated(req, () => req.payload.create({
    collection: 'expense-requests',
    data: {
      type,
      ...vendorData(input, payee),
      ...(vendorCc ? { costCenter: vendorCc } : {}),
      title: input.title.trim(),
      project: input.projectId ?? null,
      neededDate: input.neededDate ?? null,
      urgencyLevel: input.urgencyLevelId ?? null,
      notes: input.notes ?? null,
      requesters: requesterIds,
      bankAccount: direct ? null : (input.bankAccountId ?? null),
      lines: toDocLines(lines),
      attachments: input.attachmentIds ?? [],
      clientUuid: input.clientUuid ?? null,
    } as never,
    depth: 0,
    user: req.user,
    overrideAccess: false, // collection create access + hooks (createdBy/status/grandTotal server-set)
    req,
  }))
  return { doc: doc as unknown as RequestDoc, created: true }
}

/** PATCH /expense-requests/{id} — Draft (and Reimburse "Revisi Nota": lines only), creator/requesters only (US-04, G8). */
export async function updateDraft(req: PayloadRequest, id: number, input: DraftInput): Promise<RequestDoc> {
  const doc = await loadVisible(req, id, { lock: true })
  requireAction(await actorContext(req, doc), 'edit')
  if (doc.status === 'receipt_revision') {
    const other = Object.keys(input).filter((k) => k !== 'lines' && k !== 'notes' && k !== 'costCenterId')
    if (other.length > 0) fail(409, `Saat Revisi Nota hanya baris item yang dapat diubah (${other.join(', ')}).`)
    const known = new Set((doc.lines ?? []).map((l) => l.id))
    if ((input.lines ?? []).some((l) => !l.id || !known.has(l.id)) || (input.lines ?? []).length !== known.size) {
      fail(409, 'Saat Revisi Nota baris tidak dapat ditambah/dihapus (nota tertaut ke baris).')
    }
  }
  // D2: `costCenterId` from the requester is ignored; a legacy draft that gets a project drops its old cost center.
  const projectId = input.projectId !== undefined ? input.projectId : (relId(doc.project) ?? null)
  // D4: lines without `rapItemId` (old clients) keep the stored RAP item of the same line id
  const lines = input.lines !== undefined ? keepRapItems(input.lines, fromDocLines(doc)) : undefined
  // ADR 0027: the payee type of a Draft may change (vendor ⇄ karyawan); vendor → type advance, no employee account.
  // ADR 0028: the same for PT grup. A client that omits `payeeType` (APK before ADR 0028 editing a PT grup draft) keeps
  // the STORED payee type and receiving PT — never reset to karyawan.
  const payee = payeeOf(input.payeeType ?? doc.payeeType)
  const direct = payee !== 'karyawan'
  if (doc.status === 'receipt_revision' && input.payeeType !== undefined && payeeOf(input.payeeType) !== payeeOf(doc.payeeType)) fail(409, 'Saat Revisi Nota jenis penerima tidak dapat diubah.')
  const stored = vendorOfDoc(doc)
  const vendorNow = direct
    ? {
        payeeType: payee,
        vendorId: payee !== 'vendor' ? null : input.vendorId !== undefined ? input.vendorId : stored.vendorId,
        vendorBankAccountId: payee !== 'vendor' ? null : input.vendorBankAccountId !== undefined ? input.vendorBankAccountId : stored.vendorBankAccountId,
        payeeCompanyId: payee !== 'pt_grup' ? null : input.payeeCompanyId !== undefined ? input.payeeCompanyId : stored.payeeCompanyId,
        invoiceNo: input.invoiceNo !== undefined ? input.invoiceNo : stored.invoiceNo,
        invoiceDate: input.invoiceDate !== undefined ? input.invoiceDate : stored.invoiceDate,
        invoiceDueDate: input.invoiceDueDate !== undefined ? input.invoiceDueDate : stored.invoiceDueDate,
        invoiceFileId: input.invoiceFileId !== undefined ? input.invoiceFileId : stored.invoiceFileId,
      }
    : { payeeType: payee }
  const current = {
    ...vendorNow,
    type: direct ? ('advance' as const) : ((input.type ?? doc.type) as RequestType),
    title: input.title ?? doc.title,
    projectId,
    // ADR 0027 / 0028: a vendor / PT grup payment without a project may change its cost center
    costCenterId: projectId ? null : direct && input.costCenterId !== undefined ? input.costCenterId : (relId(doc.costCenter) ?? null),
    requesterIds: input.requesterIds ?? ids(doc.requesters),
    bankAccountId: direct ? null : input.bankAccountId !== undefined ? input.bankAccountId : (relId(doc.bankAccount) ?? null),
    lines: lines ?? fromDocLines(doc),
    neededDate: input.neededDate !== undefined ? input.neededDate : doc.neededDate,
    urgencyLevelId: input.urgencyLevelId !== undefined ? input.urgencyLevelId : (relId(doc.urgencyLevel) ?? null),
  }
  await validateContent(req, current, { forSubmit: false, creatorId: relId(doc.createdBy) ?? -1, requestId: id, callerSetsRequesters: input.requesterIds !== undefined && input.requesterIds.join(',') !== ids(doc.requesters).join(',') })
  const data: Record<string, unknown> = {}
  if (input.type !== undefined) data.type = input.type
  if (doc.status === 'draft' && direct && input.costCenterId !== undefined) data.costCenter = projectId ? null : input.costCenterId
  if (doc.status === 'draft' && (input.payeeType !== undefined || direct)) {
    // ADR 0027 / 0028: payee type + its fields (karyawan clears them; vendor / PT grup clear the employee account)
    Object.assign(data, vendorData(direct ? { ...input, ...vendorNow } : {}, payee), { type: current.type })
    if (direct) data.bankAccount = null
  }
  if (input.title !== undefined) data.title = input.title.trim()
  if (input.projectId !== undefined) data.project = input.projectId
  if (input.neededDate !== undefined) data.neededDate = input.neededDate
  if (input.urgencyLevelId !== undefined) data.urgencyLevel = input.urgencyLevelId
  if (input.notes !== undefined) data.notes = input.notes
  if (input.requesterIds !== undefined) data.requesters = input.requesterIds
  if (input.bankAccountId !== undefined && !direct) data.bankAccount = input.bankAccountId
  if (lines !== undefined) data.lines = toDocLines(lines)
  if (input.attachmentIds !== undefined) data.attachments = input.attachmentIds
  const updated = await validated(req, () => req.payload.update({
    collection: 'expense-requests',
    id,
    data: data as never,
    depth: 0,
    user: req.user,
    overrideAccess: false, // update access = own Draft (G8)
    req,
  }))
  return updated as unknown as RequestDoc
}

/**
 * POST /expense-requests/{id}/resubmit (US-06): a rejected request is cloned into a NEW Draft
 * (lines, requesters, bank account, project/cost center) with `resubmitOf`; it gets its own number
 * when submitted. Receipts are not copied (re-attach them; the old request no longer counts for
 * duplicate detection because it is rejected).
 */
export async function resubmitAsDraft(req: PayloadRequest, id: number): Promise<RequestDoc> {
  const doc = await loadVisible(req, id, { lock: true })
  requireAction(await actorContext(req, doc), 'resubmit')
  const src = await loadRaw(req, id)
  // The clone keeps the rejected content as-is (US-06); it is fully validated at submit.
  const created = await validated(req, () => req.payload.create({
    collection: 'expense-requests',
    data: {
      type: src.type,
      title: src.title,
      // D2: a rejected legacy cost-center request is cloned WITHOUT its cost center (the requester picks a project)
      project: relId(src.project) ?? null,
      neededDate: src.neededDate ?? null,
      urgencyLevel: relId(src.urgencyLevel) ?? null,
      notes: src.notes ?? null,
      requesters: ids(src.requesters),
      bankAccount: relId(src.bankAccount) ?? null,
      // ADR 0027: a rejected vendor payment comes back with its vendor + invoice (the rejected one no longer counts as a duplicate)
      // and — without a project — its cost center. ADR 0028: a PT grup payment with its receiving PT + document.
      ...vendorData(vendorOfDoc(src), payeeOf(src.payeeType)),
      ...(isDirectPayment(src.payeeType) && !relId(src.project) && relId(src.costCenter) ? { costCenter: relId(src.costCenter) } : {}),
      lines: toDocLines(fromDocLines(src).map(({ id: _id, ...l }) => l)),
      attachments: ids(src.attachments),
    } as never,
    depth: 0,
    user: req.user,
    overrideAccess: false, // same create path as a new draft (createdBy = caller)
    req,
  }))
  // resubmitOf is a system field (create access false for users) → set by the service.
  req.context.pkTransition = true
  try {
    const linked = await req.payload.update({
      collection: 'expense-requests',
      id: created.id,
      data: { resubmitOf: id } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: resubmit reference (US-06)
      req,
    })
    delete req.context.pkTransition
    // S3e (US-06, S-26): receipts come along (Reimburse needs them before submit).
    await copyReceiptsForResubmit(req, id, linked as unknown as RequestDoc)
    return linked as unknown as RequestDoc
  } finally {
    delete req.context.pkTransition
  }
}
