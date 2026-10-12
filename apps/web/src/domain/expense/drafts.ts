import type { CollectionSlug, PayloadRequest } from 'payload'

import { employeeIn, hasRole, hasRoleAny, isRole, isStaffOnly, mappedCompanies, relId, rolesIn, soleCompany, userId, type Role } from '@/access/roles'
import { companyOf } from '@/domain/companies'
import { resolveScope } from '@/access/scope'

import { actorContext, fail, ids, loadRaw, loadVisible, requireAction, type RequestDoc } from './common'
import { rapRequirement } from '@/domain/rap/budget'

import { normalizeLines, validateLines } from './lines'
import { copyReceiptsForResubmit } from './receipts'
import { isBusinessDate, type RequestType } from './types'

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
    where: { and: [{ id: { in: wanted } }, { active: { not_equals: false } }, ...(mapped !== null ? [{ company: { in: mapped } }] : [])] },
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
    where: { and: [{ id: { in: wanted } }, { active: { not_equals: false } }, ...(mapped !== null ? [{ company: { in: mapped } }] : [])] },
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
  },
  opts: {
    forSubmit: boolean
    creatorId: number
    callerSetsRequesters?: boolean
    /** D2: a legacy cost-center request submitted before (withdrawn / back to Draft) may be sent again without a project. */
    legacyCostCenter?: boolean
  },
): Promise<void> {
  const errors: Array<{ path: string; message: string }> = []
  // ADR 0016 §5: roles, scope and own employee IN THE REQUEST's PT (from its project / cost center)
  const company = await draftCompany(req, c)
  const office = company !== undefined ? hasRole(req, OFFICE, company) : hasRoleAny(req, ...OFFICE)
  const scope = () => resolveScope(req, company ?? null)

  if (c.projectId && c.costCenterId) errors.push({ path: 'projectId', message: 'Pilih project ATAU pusat biaya, tidak keduanya.' })
  // D2 (owner 2026-10-11): no non-project requests — the project is mandatory to send (legacy cost-center rows aside)
  if (opts.forSubmit && !c.projectId && !(opts.legacyCostCenter && c.costCenterId)) errors.push({ path: 'projectId', message: 'Project wajib diisi (pengajuan tanpa project tidak dapat dikirim).' })
  if (opts.forSubmit && !(c.title ?? '').trim()) errors.push({ path: 'title', message: 'Judul wajib diisi.' })
  if (c.neededDate && !isBusinessDate(c.neededDate)) errors.push({ path: 'neededDate', message: 'Tanggal harus YYYY-MM-DD.' })

  // G10: project / cost center in the caller's scope (office roles: any active one).
  if (c.projectId) {
    const p = await req.payload.findByID({ collection: 'projects', id: c.projectId, depth: 0, overrideAccess: true /* SYSTEM-READ: scope check */, req }).catch(() => null)
    if (!p || isForeign(req, relId(p.company) ?? -1)) errors.push({ path: 'projectId', message: 'Project tidak ditemukan.' })
    else if (p.status === 'arsip' || p.status === 'selesai') errors.push({ path: 'projectId', message: 'Project sudah selesai/diarsipkan.' })
    else if (!office && !(await scope()).assignedProjects.includes(c.projectId)) fail(403, 'Project di luar penugasan Anda.')
  }
  if (c.costCenterId) {
    const cc = await req.payload.findByID({ collection: 'cost-centers', id: c.costCenterId, depth: 0, overrideAccess: true /* SYSTEM-READ: scope check */, req }).catch(() => null)
    if (!cc || cc.active === false || isForeign(req, relId(cc.company) ?? -1)) errors.push({ path: 'costCenterId', message: 'Pusat biaya tidak ditemukan atau nonaktif.' })
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

  // Requesters (US-40): ≥ 1 active employee; Staff/PM only for themselves (Q-09 default).
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
  // co-requesters); Admin/Finance may represent others (QA-MC4-09 above). Checked for the CREATOR of the
  // request (also at submit, so an older draft that breaks the rule cannot be sent) and for a Staff-only
  // caller who changes the requesters of someone else's draft. Before Q-09 (clearer message for Staff).
  if (uniq.length > 0) await assertStaffSelfOnly(req, uniq, ownPt, opts)
  // ADR 0024 (owner decision 2026-10-11): the PM no longer files on a Direktur's behalf (ADR 0021
  // `direktur_via_pm` withdrawn) — a Direktur files his own request (zero-step rule → Finance transfer queue).
  if (!onBehalf) {
    const creatorEmp = ownPt !== undefined ? employeeIn(req, ownPt) : relId((req.user as { employee?: unknown } | null)?.employee)
    if (userId(req) === opts.creatorId && (creatorEmp === undefined || (uniq.length > 0 && !uniq.includes(creatorEmp)))) {
      fail(403, 'Hanya Admin/Finance yang boleh membuat pengajuan atas nama orang lain.')
    }
  }

  // G9 / US-44 / Q-11: account of one of the requesters, active.
  if (opts.forSubmit && !c.bankAccountId) errors.push({ path: 'bankAccountId', message: 'Rekening tujuan wajib diisi.' })
  if (c.bankAccountId) {
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
  if (errors.length > 0) fail(400, 'Data pengajuan tidak valid.', errors)
}

/**
 * D4 (owner 2026-10-11): every line names a RAP item OF THE REQUEST's PROJECT. Draft: a chosen item must belong to the
 * project; submit: required on every line when the project has a RAP, an inactive item must be replaced, and a
 * konstruksi project without RAP cannot send requests yet (the PM / Direktur fills the RAP first).
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
  if (forSubmit && !rap.hasRap && rap.konstruksi) {
    errors.push({ path: 'projectId', message: 'Project konstruksi ini belum punya RAP. Minta PM / Direktur mengisi RAP project dulu.' })
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
  // D2: a cost center sent by an old client is ignored (the requester no longer picks one)
  const company = await draftCompany(req, { projectId: input.projectId })
  const emp = company !== undefined ? employeeIn(req, company) : relId((req.user as { employee?: unknown } | null)?.employee)
  const requesterIds = input.requesterIds && input.requesterIds.length > 0 ? input.requesterIds : emp !== undefined ? [emp] : []
  const lines = input.lines ?? []
  await validateContent(req, { ...input, costCenterId: null, requesterIds, lines }, { forSubmit: false, creatorId: uid })
  const doc = await validated(req, () => req.payload.create({
    collection: 'expense-requests',
    data: {
      type: input.type,
      title: input.title.trim(),
      project: input.projectId ?? null,
      neededDate: input.neededDate ?? null,
      urgencyLevel: input.urgencyLevelId ?? null,
      notes: input.notes ?? null,
      requesters: requesterIds,
      bankAccount: input.bankAccountId ?? null,
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
  const current = {
    type: (input.type ?? doc.type) as RequestType,
    title: input.title ?? doc.title,
    projectId,
    costCenterId: projectId ? null : (relId(doc.costCenter) ?? null),
    requesterIds: input.requesterIds ?? ids(doc.requesters),
    bankAccountId: input.bankAccountId !== undefined ? input.bankAccountId : (relId(doc.bankAccount) ?? null),
    lines: lines ?? fromDocLines(doc),
    neededDate: input.neededDate !== undefined ? input.neededDate : doc.neededDate,
    urgencyLevelId: input.urgencyLevelId !== undefined ? input.urgencyLevelId : (relId(doc.urgencyLevel) ?? null),
  }
  await validateContent(req, current, { forSubmit: false, creatorId: relId(doc.createdBy) ?? -1, callerSetsRequesters: input.requesterIds !== undefined && input.requesterIds.join(',') !== ids(doc.requesters).join(',') })
  const data: Record<string, unknown> = {}
  if (input.type !== undefined) data.type = input.type
  if (input.title !== undefined) data.title = input.title.trim()
  if (input.projectId !== undefined) data.project = input.projectId
  if (input.neededDate !== undefined) data.neededDate = input.neededDate
  if (input.urgencyLevelId !== undefined) data.urgencyLevel = input.urgencyLevelId
  if (input.notes !== undefined) data.notes = input.notes
  if (input.requesterIds !== undefined) data.requesters = input.requesterIds
  if (input.bankAccountId !== undefined) data.bankAccount = input.bankAccountId
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
