import type { PayloadRequest, Where } from 'payload'

import { relId, userId } from '@/access/roles'
import { ActivityItems, type ActivityItemIn } from '@/api/v1/schemas-field'
import { requestMeta } from '@/lib/request-meta'
import { searchWhere } from '@/lib/text-search'

import { mayReadValue } from './access'
import {
  checkPhotos,
  checkReportDate,
  claimPhotos,
  companyDay,
  createDoc,
  fail,
  flagsOf,
  isEditable,
  loadRaw,
  loadVisible,
  lockDoc,
  photoDto,
  photoIdsOf,
  photosOf,
  replayOf,
  requireCorrector,
  requireReportableProject,
  requireReporterEdit,
  revOf,
  SERVER_TIMING,
  validation,
  withOverride,
  writeDoc,
  type FieldDoc,
  type Timing,
} from './common'
import { clientRef, namesOf, projectRef, str, userRef } from './refs'
import { activityErrors, OPEN_PO_STATUSES, poAgeDays, poStatusAfterDelivery, poStatusCorrection, type ActivityKind, type PoStatus } from './rules'
import { scopedFind } from './service'

/**
 * FR1 Log aktivitas aftersales (ADR 0020 §5) — single write path of POST/PATCH
 * /api/v1/aftersales-activities, POST …/{id}/corrections and the sync item
 * `aftersales_activity.upsert`. A delivery (pengiriman) refers to an incoming PO (po_masuk) of the
 * same customer and moves its status (belum_kirim → sebagian/terkirim, "PO selesai dikirim?") in the
 * same transaction — a system write that the DB accepts after the PO's 24 h window. Values (Rp) are
 * returned only to Direktur/Finance/Admin and the reporter.
 */
const TYPE = 'aftersales_activity' as const
const LABEL = 'Aktivitas aftersales'

export type ActivityDoc = FieldDoc & {
  activityDate: string
  client: unknown
  kind: ActivityKind
  docNo?: string | null
  items?: ActivityItemIn[] | null
  value?: number | null
  relatesTo?: unknown
  poStatus?: PoStatus | null
  followUpDate?: string | null
  receiver?: string | null
  notes?: string | null
  receivedAt?: string | null
  deviceTime?: string | null
  timeTrust?: 'server' | 'estimated' | 'device_only' | null
  offline?: boolean | null
  source?: 'web' | 'apk' | null
  correctedAt?: string | null
  correctedBy?: unknown
}

export type ActivityInput = {
  projectId: number
  clientId: number
  activityDate?: string | null
  kind: ActivityKind
  docNo?: string | null
  items?: ActivityItemIn[] | null
  value?: number | null
  relatesTo?: number | null
  poDelivered?: boolean | null
  followUpDate?: string | null
  receiver?: string | null
  notes?: string | null
  photoIds?: number[]
  clientUuid?: string | null
}

export type ActivityPatch = Partial<Pick<ActivityInput, 'docNo' | 'items' | 'value' | 'followUpDate' | 'receiver' | 'notes'>> & { addPhotoIds?: number[]; poStatus?: PoStatus; reason?: string }

const clean = (v: string | null | undefined): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

function checkItems(items: unknown): void {
  if (items === undefined || items === null) return
  const r = ActivityItems.safeParse(items)
  if (!r.success) validation(r.error.issues.map((i) => ({ path: ['items', ...i.path].join('.'), message: i.message })))
}

async function requireClient(req: PayloadRequest, clientId: number, company: number): Promise<void> {
  const c = (await req.payload.findByID({ collection: 'clients', id: clientId, depth: 0, overrideAccess: true /* SYSTEM-READ: customer of the activity (PT checked) */, req, disableErrors: true })) as { company?: unknown; active?: boolean | null } | null
  if (!c || relId(c.company) !== company) fail(404, 'NOT_FOUND', 'Pelanggan tidak ditemukan.', 'clientId')
}

async function loadPo(req: PayloadRequest, poId: number, company: number, clientId: number): Promise<ActivityDoc> {
  const po = await loadRaw<ActivityDoc>(req, TYPE, poId)
  if (!po || relId(po.company) !== company) return fail(404, 'NOT_FOUND', 'PO masuk tidak ditemukan.', 'relatesTo')
  if (po.kind !== 'po_masuk') return fail(400, 'VALIDATION', 'Aktivitas yang dirujuk bukan PO masuk.', 'relatesTo')
  if (relId(po.client) !== clientId) return fail(400, 'VALIDATION', 'PO masuk milik pelanggan lain.', 'relatesTo')
  return po
}

/** System write of the PO status (delivery side effect / correction), allowed after the PO's window. */
async function setPoStatus(req: PayloadRequest, po: ActivityDoc, status: PoStatus, reason: string): Promise<void> {
  if (po.poStatus === status) return
  await withOverride(req, 'system', () => writeDoc(req, TYPE, po.id, { poStatus: status, syncRev: revOf(po) + 1 }, reason))
}

/** POST /aftersales-activities + sync create. Replay of a clientUuid (same reporter) → existing (created false). */
export async function createActivity(req: PayloadRequest, input: ActivityInput, timing: Timing = SERVER_TIMING()): Promise<{ doc: ActivityDoc; created: boolean }> {
  const uid = userId(req)
  if (uid === undefined) fail(401, 'FORBIDDEN', 'Unauthorized')
  const replay = await replayOf<ActivityDoc>(req, TYPE, input.clientUuid)
  if (replay) return { doc: replay, created: false }
  const project = await requireReportableProject(req, input.projectId, TYPE)
  await requireClient(req, input.clientId, project.company)
  validation(activityErrors(input))
  checkItems(input.items)
  const { today } = await companyDay(req, project.company, timing.time)
  const activityDate = input.activityDate ?? today
  checkReportDate(activityDate, today, 'activityDate')
  const photoIds = input.photoIds ?? []
  await checkPhotos(req, TYPE, photoIds, 0)

  let po: ActivityDoc | null = null
  let poNext: PoStatus | null = null
  if (input.relatesTo !== undefined && input.relatesTo !== null) {
    await lockDoc(req, TYPE, input.relatesTo)
    po = await loadPo(req, input.relatesTo, project.company, input.clientId)
    if (input.kind === 'pengiriman') {
      const t = poStatusAfterDelivery(po.poStatus, input.poDelivered === true)
      if (!t.ok) fail(409, 'PO_CLOSED', t.message, 'relatesTo')
      else poNext = t.status
    } else if (po.poStatus === 'batal') {
      fail(409, 'PO_CLOSED', 'PO sudah dibatalkan.', 'relatesTo')
    }
  }
  const flags = [...(timing.flags ?? [])]
  if (activityDate < today) flags.push('BACKDATED')
  const doc = await createDoc<ActivityDoc>(req, TYPE, {
    project: project.id,
    activityDate,
    reporter: uid!,
    client: input.clientId,
    kind: input.kind,
    docNo: clean(input.docNo),
    items: input.items ?? [],
    value: input.value ?? null,
    relatesTo: po?.id ?? null,
    poStatus: input.kind === 'po_masuk' ? 'belum_kirim' : null,
    followUpDate: input.kind === 'penawaran' ? (input.followUpDate ?? null) : null,
    receiver: clean(input.receiver),
    notes: clean(input.notes),
    photoCount: photoIds.length,
    receivedAt: new Date().toISOString(),
    editableUntil: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    deviceTime: timing.deviceTime ? new Date(timing.deviceTime).toISOString() : null,
    timeTrust: timing.timeTrust,
    offline: timing.offline,
    source: requestMeta(req).source === 'apk' ? 'apk' : 'web',
    flags: [...new Set(flags)],
    syncRev: 1,
    clientUuid: input.clientUuid ?? null,
  })
  await claimPhotos(req, TYPE, doc.id, photoIds)
  if (po && poNext) await setPoStatus(req, po, poNext, `Pengiriman #${doc.id}${doc.docNo ? ` (${doc.docNo})` : ''}`)
  return { doc: (await loadRaw<ActivityDoc>(req, TYPE, doc.id))!, created: true }
}

async function applyPatch(req: PayloadRequest, doc: ActivityDoc, patch: ActivityPatch, mode: 'edit' | 'correction', reason: string | undefined): Promise<ActivityDoc> {
  validation(activityErrors({ kind: doc.kind, followUpDate: patch.followUpDate, value: patch.value, relatesTo: relId(doc.relatesTo) ?? null }))
  checkItems(patch.items)
  if (patch.poStatus !== undefined && doc.kind !== 'po_masuk') fail(400, 'VALIDATION', 'Status PO hanya untuk PO masuk.', 'poStatus')
  if (patch.receiver !== undefined && patch.receiver !== null && doc.kind !== 'pengiriman') fail(400, 'VALIDATION', 'Penerima hanya untuk pengiriman.', 'receiver')
  const add = patch.addPhotoIds ?? []
  const current = await photoIdsOf(req, TYPE, doc.id)
  await checkPhotos(req, TYPE, add, current.length)
  const data: Record<string, unknown> = {}
  const set = (k: string, v: unknown, cur: unknown) => {
    if (v !== undefined && JSON.stringify(v ?? null) !== JSON.stringify(cur ?? null)) data[k] = v
  }
  set('docNo', patch.docNo === undefined ? undefined : clean(patch.docNo), doc.docNo)
  set('items', patch.items === undefined ? undefined : (patch.items ?? []), doc.items ?? [])
  set('value', patch.value, doc.value === undefined || doc.value === null ? null : Number(doc.value))
  set('followUpDate', patch.followUpDate, doc.followUpDate)
  set('receiver', patch.receiver === undefined ? undefined : clean(patch.receiver), doc.receiver)
  set('notes', patch.notes === undefined ? undefined : clean(patch.notes), doc.notes)
  if (patch.poStatus !== undefined && patch.poStatus !== doc.poStatus) {
    const t = poStatusCorrection(doc.poStatus, patch.poStatus)
    if (!t.ok) fail(409, 'PO_CLOSED', t.message, 'poStatus')
    data.poStatus = patch.poStatus
  }
  if (add.length > 0) data.photoCount = current.length + add.length
  if (Object.keys(data).length === 0 && add.length === 0) return doc
  data.syncRev = revOf(doc) + 1
  if (mode === 'correction') {
    data.correctedAt = new Date().toISOString()
    data.correctedBy = userId(req)
    data.flags = [...new Set([...flagsOf(doc), 'CORRECTED'])]
    await withOverride(req, 'correction', () => writeDoc(req, TYPE, doc.id, data, `Koreksi: ${reason}`))
  } else {
    await writeDoc(req, TYPE, doc.id, data, reason)
  }
  if (add.length > 0) await claimPhotos(req, TYPE, doc.id, add)
  return (await loadRaw<ActivityDoc>(req, TYPE, doc.id))!
}

/** PATCH /aftersales-activities/{id}: the reporter, within 24 h (no PO status change here). */
export async function editActivity(req: PayloadRequest, id: number, patch: ActivityPatch): Promise<ActivityDoc> {
  await loadVisible(req, TYPE, id)
  await lockDoc(req, TYPE, id)
  const doc = (await loadRaw<ActivityDoc>(req, TYPE, id))!
  requireReporterEdit(req, doc, LABEL)
  if (patch.poStatus !== undefined) fail(400, 'VALIDATION', 'Status PO diubah lewat pengiriman atau koreksi PM/Direktur.', 'poStatus')
  return applyPatch(req, doc, patch, 'edit', patch.reason?.trim() || undefined)
}

/** POST /aftersales-activities/{id}/corrections: PM team / Direktur, reason required (also PO status, e.g. batal). */
export async function correctActivity(req: PayloadRequest, id: number, patch: ActivityPatch): Promise<ActivityDoc> {
  await loadVisible(req, TYPE, id)
  await lockDoc(req, TYPE, id)
  const doc = (await loadRaw<ActivityDoc>(req, TYPE, id))!
  const reason = await requireCorrector(req, TYPE, doc, patch.reason)
  return applyPatch(req, doc, patch, 'correction', reason)
}

// ---------------------------------------------------------------- read side

export async function activityDtos(req: PayloadRequest, docs: readonly ActivityDoc[]) {
  const relIds = [...new Set(docs.map((d) => relId(d.relatesTo)).filter((x): x is number => x !== undefined))]
  const related = new Map<number, { docNo: string | null; activityDate: string | null }>()
  if (relIds.length) {
    const r = await req.payload.find({ collection: 'aftersales-activities', where: { id: { in: relIds } }, depth: 0, pagination: false, select: { docNo: true, activityDate: true }, overrideAccess: true /* SYSTEM-READ: PO label of readable activities */, req })
    for (const d of r.docs as Array<{ id: number; docNo?: string | null; activityDate?: string | null }>) related.set(d.id, { docNo: d.docNo ?? null, activityDate: d.activityDate ?? null })
  }
  const n = await namesOf(req, docs)
  const ph = await photosOf(req, TYPE, docs.map((d) => d.id))
  return docs.map((d) => {
    const visible = mayReadValue(req, d)
    const rid = relId(d.relatesTo)
    return {
      id: d.id,
      uuid: (d.uuid as string | null) ?? null,
      companyId: relId(d.company) ?? null,
      project: projectRef(n, d.project),
      activityDate: d.activityDate,
      reporter: userRef(n, d.reporter)!,
      client: clientRef(n, d.client)!,
      kind: d.kind,
      docNo: str(d.docNo),
      items: Array.isArray(d.items) ? d.items : [],
      value: visible && d.value !== undefined && d.value !== null ? Number(d.value) : null,
      valueVisible: visible,
      relatesTo: rid === undefined ? null : { id: rid, ...(related.get(rid) ?? { docNo: null, activityDate: null }) },
      poStatus: d.poStatus ?? null,
      followUpDate: str(d.followUpDate),
      receiver: str(d.receiver),
      notes: str(d.notes),
      photos: (ph.get(d.id) ?? []).map(photoDto),
      offline: d.offline === true,
      timeTrust: d.timeTrust ?? 'server',
      source: d.source ?? null,
      flags: flagsOf(d),
      receivedAt: d.receivedAt ?? null,
      editableUntil: d.editableUntil ?? null,
      editable: isEditable(req, d),
      correctedAt: d.correctedAt ?? null,
      correctedBy: userRef(n, d.correctedBy),
      rev: revOf(d),
      clientUuid: d.clientUuid ?? null,
      createdAt: d.createdAt ?? null,
    }
  })
}

export type ActivityDto = Awaited<ReturnType<typeof activityDtos>>[number]

export async function activityDto(req: PayloadRequest, d: ActivityDoc): Promise<ActivityDto> {
  return (await activityDtos(req, [d]))[0]!
}

export type ActivityListFilter = { projectId?: number; clientId?: number; kind?: ActivityKind; poStatus?: PoStatus; reporterId?: number; from?: string; to?: string; mine?: boolean; limit: number; after?: number; companyIds?: readonly number[]; q?: string }

export async function listActivities(req: PayloadRequest, f: ActivityListFilter): Promise<{ items: ActivityDto[]; nextCursor: number | null }> {
  const and: Where[] = []
  if (f.projectId !== undefined) and.push({ project: { equals: f.projectId } })
  if (f.clientId !== undefined) and.push({ client: { equals: f.clientId } })
  if (f.kind) and.push({ kind: { equals: f.kind } })
  if (f.poStatus) and.push({ poStatus: { equals: f.poStatus } })
  if (f.reporterId !== undefined) and.push({ reporter: { equals: f.reporterId } })
  if (f.from) and.push({ activityDate: { greater_than_equal: f.from } })
  if (f.to) and.push({ activityDate: { less_than_equal: f.to } })
  if (f.mine) and.push({ reporter: { equals: userId(req) ?? -1 } })
  if (f.after !== undefined) and.push({ id: { less_than: f.after } })
  if (f.companyIds?.length) and.push({ company: { in: [...f.companyIds] } })
  const text = searchWhere(['docNo', 'receiver', 'notes'], f.q) // DRMS 10/10 D8
  if (text) and.push(text)
  const docs = await scopedFind<ActivityDoc>(req, 'aftersales-activities', and, f.limit + 1, '-id')
  const page = docs.slice(0, f.limit)
  return { items: await activityDtos(req, page), nextCursor: docs.length > f.limit ? page[page.length - 1]!.id : null }
}

/** GET /aftersales/open-pos: incoming POs still to deliver (belum_kirim / sebagian) in the caller's scope, oldest first. */
export async function openPos(req: PayloadRequest, f: { clientId?: number; projectId?: number; companyIds?: readonly number[]; asOf: string }) {
  const and: Where[] = [{ kind: { equals: 'po_masuk' } }, { poStatus: { in: [...OPEN_PO_STATUSES] } }]
  if (f.clientId !== undefined) and.push({ client: { equals: f.clientId } })
  if (f.projectId !== undefined) and.push({ project: { equals: f.projectId } })
  if (f.companyIds?.length) and.push({ company: { in: [...f.companyIds] } })
  const docs = await scopedFind<ActivityDoc>(req, 'aftersales-activities', and, 500, 'activityDate')
  const counts = new Map<number, number>()
  if (docs.length) {
    const r = await req.payload.find({
      collection: 'aftersales-activities',
      where: { and: [{ kind: { equals: 'pengiriman' } }, { relatesTo: { in: docs.map((d) => d.id) } }] },
      depth: 0,
      pagination: false,
      select: { relatesTo: true },
      overrideAccess: true, // SYSTEM-READ: number of deliveries of POs the caller may read
      req,
    })
    for (const d of r.docs as Array<{ relatesTo?: unknown }>) {
      const k = relId(d.relatesTo)
      if (k !== undefined) counts.set(k, (counts.get(k) ?? 0) + 1)
    }
  }
  const dtos = await activityDtos(req, docs)
  return {
    asOf: f.asOf,
    items: dtos.map((d) => ({
      id: d.id,
      companyId: d.companyId!,
      project: d.project,
      client: d.client,
      activityDate: d.activityDate,
      docNo: d.docNo,
      items: d.items,
      value: d.value,
      valueVisible: d.valueVisible,
      poStatus: d.poStatus as PoStatus,
      ageDays: poAgeDays(d.activityDate, f.asOf),
      deliveries: counts.get(d.id) ?? 0,
    })),
  }
}
