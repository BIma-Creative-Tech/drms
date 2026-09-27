import type { CollectionSlug, PayloadRequest } from 'payload'

import { hasRole, relId, userId } from '@/access/roles'
import { resolveScope } from '@/access/scope'

import { actorContext, fail, ids, loadRaw, loadVisible, requireAction, type RequestDoc } from './common'
import { validateLines } from './lines'
import { copyReceiptsForResubmit } from './receipts'
import { isBusinessDate, type RequestType } from './types'

export type LineInputApi = {
  id?: string
  description?: string
  qty?: number | null
  uomId?: number | null
  unitPrice?: number | null
  total?: number | null
  notes?: string | null
  categoryId?: number | null
  vehicleId?: number | null
}

export type DraftInput = {
  type?: RequestType
  title?: string
  projectId?: number | null
  costCenterId?: number | null
  neededDate?: string | null
  periodFrom?: string | null
  periodTo?: string | null
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

async function activeIds(req: PayloadRequest, collection: CollectionSlug, wanted: number[]): Promise<Set<number>> {
  if (wanted.length === 0) return new Set()
  const res = await req.payload.find({
    collection,
    where: { and: [{ id: { in: wanted } }, { active: { not_equals: false } }] },
    depth: 0,
    pagination: false,
    overrideAccess: true, // SYSTEM-READ: master validation
    req,
  })
  return new Set(res.docs.map((d) => d.id as number))
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
    periodFrom?: string | null
    periodTo?: string | null
  },
  opts: { forSubmit: boolean; creatorId: number },
): Promise<void> {
  const errors: Array<{ path: string; message: string }> = []
  const office = hasRole(req, ...OFFICE)

  if (c.projectId && c.costCenterId) errors.push({ path: 'projectId', message: 'Pilih project ATAU pusat biaya, tidak keduanya (US-53).' })
  if (opts.forSubmit && !c.projectId && !c.costCenterId) errors.push({ path: 'projectId', message: 'Project atau pusat biaya wajib diisi (US-53).' })
  if (opts.forSubmit && !(c.title ?? '').trim()) errors.push({ path: 'title', message: 'Judul wajib diisi.' })
  for (const f of ['neededDate', 'periodFrom', 'periodTo'] as const) {
    if (c[f] && !isBusinessDate(c[f])) errors.push({ path: f, message: 'Tanggal harus YYYY-MM-DD.' })
  }
  if (c.periodFrom && c.periodTo && c.periodFrom > c.periodTo) errors.push({ path: 'periodTo', message: 'Periode selesai sebelum periode mulai.' })

  // G10: project / cost center in the caller's scope (office roles: any active one).
  if (c.projectId) {
    const p = await req.payload.findByID({ collection: 'projects', id: c.projectId, depth: 0, overrideAccess: true /* SYSTEM-READ: scope check */, req }).catch(() => null)
    if (!p) errors.push({ path: 'projectId', message: 'Project tidak ditemukan.' })
    else if (p.status === 'arsip' || p.status === 'selesai') errors.push({ path: 'projectId', message: 'Project sudah selesai/diarsipkan.' })
    else if (!office && !(await resolveScope(req)).assignedProjects.includes(c.projectId)) fail(403, 'Project di luar penugasan Anda (G10).')
  }
  if (c.costCenterId) {
    const cc = await req.payload.findByID({ collection: 'cost-centers', id: c.costCenterId, depth: 0, overrideAccess: true /* SYSTEM-READ: scope check */, req }).catch(() => null)
    if (!cc || cc.active === false) errors.push({ path: 'costCenterId', message: 'Pusat biaya tidak ditemukan atau nonaktif.' })
    else if (!office && !(await resolveScope(req)).assignedCostCenters.includes(c.costCenterId)) fail(403, 'Pusat biaya di luar penugasan Anda (G10).')
  }

  // Requesters (US-40): ≥ 1 active employee; Staff/PM only for themselves (Q-09 default).
  const uniq = [...new Set(c.requesterIds)]
  if (uniq.length !== c.requesterIds.length) errors.push({ path: 'requesterIds', message: 'Pemohon tidak boleh ganda.' })
  if (opts.forSubmit && uniq.length === 0) errors.push({ path: 'requesterIds', message: 'Minimal 1 pemohon (Diajukan Oleh).' })
  const activeEmp = await activeIds(req, 'employees', uniq)
  uniq.filter((e) => !activeEmp.has(e)).forEach((e) => errors.push({ path: 'requesterIds', message: `Karyawan #${e} tidak ditemukan atau nonaktif.` }))
  if (!hasRole(req, 'pk-admin', 'pk-finance')) {
    const creatorEmp = relId((req.user as { employee?: unknown } | null)?.employee)
    if (userId(req) === opts.creatorId && (creatorEmp === undefined || (uniq.length > 0 && !uniq.includes(creatorEmp)))) {
      fail(403, 'Hanya Admin/Finance yang boleh membuat pengajuan atas nama orang lain (Q-09).')
    }
  }

  // G9 / US-44 / Q-11: account of one of the requesters, active.
  if (opts.forSubmit && !c.bankAccountId) errors.push({ path: 'bankAccountId', message: 'Rekening tujuan wajib diisi.' })
  if (c.bankAccountId) {
    const acc = await req.payload
      .findByID({ collection: 'employee-bank-accounts', id: c.bankAccountId, depth: 0, overrideAccess: true /* SYSTEM-READ: G9 */, req })
      .catch(() => null)
    if (!acc || acc.active === false) errors.push({ path: 'bankAccountId', message: 'Rekening tidak ditemukan atau nonaktif.' })
    else if (!uniq.includes(relId(acc.employee) ?? -1)) errors.push({ path: 'bankAccountId', message: 'Rekening harus milik salah satu pemohon (Q-11).' })
  }

  // Lines (US-37) + masters.
  const lineErrors = validateLines(
    c.lines.map((l) => ({ description: l.description, qty: l.qty, uom: l.uomId, unitPrice: l.unitPrice, total: l.total, notes: l.notes, category: l.categoryId, vehicle: l.vehicleId })),
    { forSubmit: opts.forSubmit },
  )
  errors.push(...lineErrors.map((e) => ({ path: e.path.replace(/\.(uom|category|vehicle)$/, '.$1Id'), message: e.message })))
  const catIds = [...new Set(c.lines.map((l) => l.categoryId).filter((x): x is number => !!x))]
  const uomIds = [...new Set(c.lines.map((l) => l.uomId).filter((x): x is number => !!x))]
  const vehIds = [...new Set(c.lines.map((l) => l.vehicleId).filter((x): x is number => !!x))]
  const [cats, uoms, vehs] = await Promise.all([activeIds(req, 'expense-categories', catIds), activeIds(req, 'uoms', uomIds), activeIds(req, 'vehicles', vehIds)])
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
      errors.push({ path: `lines.${i}.vehicleId`, message: 'Kategori ini wajib ditautkan ke kendaraan (Q-22).' })
    }
  })
  if (errors.length > 0) fail(400, 'Data pengajuan tidak valid.', errors)
}

export function toDocLines(lines: LineInputApi[]) {
  return lines.map((l) => ({
    ...(l.id ? { id: l.id } : {}),
    description: l.description?.trim() ?? null,
    qty: l.qty ?? null,
    uom: l.uomId ?? null,
    unitPrice: l.unitPrice ?? null,
    total: l.total ?? null,
    notes: l.notes ?? null,
    category: l.categoryId ?? null,
    vehicle: l.vehicleId ?? null,
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
    notes: l.notes ?? null,
    categoryId: relId(l.category) ?? null,
    vehicleId: relId(l.vehicle) ?? null,
  }))
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
  const emp = relId((req.user as { employee?: unknown } | null)?.employee)
  const requesterIds = input.requesterIds && input.requesterIds.length > 0 ? input.requesterIds : emp !== undefined ? [emp] : []
  const lines = input.lines ?? []
  await validateContent(req, { ...input, requesterIds, lines }, { forSubmit: false, creatorId: uid })
  const doc = await validated(req, () => req.payload.create({
    collection: 'expense-requests',
    data: {
      type: input.type,
      title: input.title.trim(),
      project: input.projectId ?? null,
      costCenter: input.costCenterId ?? null,
      neededDate: input.neededDate ?? null,
      periodFrom: input.periodFrom ?? null,
      periodTo: input.periodTo ?? null,
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
    const other = Object.keys(input).filter((k) => k !== 'lines' && k !== 'notes')
    if (other.length > 0) fail(409, `Saat Revisi Nota hanya baris item yang dapat diubah (${other.join(', ')}).`)
    const known = new Set((doc.lines ?? []).map((l) => l.id))
    if ((input.lines ?? []).some((l) => !l.id || !known.has(l.id)) || (input.lines ?? []).length !== known.size) {
      fail(409, 'Saat Revisi Nota baris tidak dapat ditambah/dihapus (nota tertaut ke baris).')
    }
  }
  const current = {
    type: (input.type ?? doc.type) as RequestType,
    title: input.title ?? doc.title,
    projectId: input.projectId !== undefined ? input.projectId : (relId(doc.project) ?? null),
    costCenterId: input.costCenterId !== undefined ? input.costCenterId : (relId(doc.costCenter) ?? null),
    requesterIds: input.requesterIds ?? ids(doc.requesters),
    bankAccountId: input.bankAccountId !== undefined ? input.bankAccountId : (relId(doc.bankAccount) ?? null),
    lines: input.lines ?? fromDocLines(doc),
    neededDate: input.neededDate !== undefined ? input.neededDate : doc.neededDate,
    periodFrom: input.periodFrom !== undefined ? input.periodFrom : doc.periodFrom,
    periodTo: input.periodTo !== undefined ? input.periodTo : doc.periodTo,
  }
  await validateContent(req, current, { forSubmit: false, creatorId: relId(doc.createdBy) ?? -1 })
  const data: Record<string, unknown> = {}
  if (input.type !== undefined) data.type = input.type
  if (input.title !== undefined) data.title = input.title.trim()
  if (input.projectId !== undefined) data.project = input.projectId
  if (input.costCenterId !== undefined) data.costCenter = input.costCenterId
  if (input.neededDate !== undefined) data.neededDate = input.neededDate
  if (input.periodFrom !== undefined) data.periodFrom = input.periodFrom
  if (input.periodTo !== undefined) data.periodTo = input.periodTo
  if (input.notes !== undefined) data.notes = input.notes
  if (input.requesterIds !== undefined) data.requesters = input.requesterIds
  if (input.bankAccountId !== undefined) data.bankAccount = input.bankAccountId
  if (input.lines !== undefined) data.lines = toDocLines(input.lines)
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
      project: relId(src.project) ?? null,
      costCenter: relId(src.costCenter) ?? null,
      neededDate: src.neededDate ?? null,
      periodFrom: src.periodFrom ?? null,
      periodTo: src.periodTo ?? null,
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
