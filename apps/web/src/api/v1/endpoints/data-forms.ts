import { docAccessOperation, type CollectionSlug, type Field, type PayloadRequest, type SanitizedCollectionPermission, type Where } from 'payload'

import { isRupiahField } from '@/admin/display-cells'
import { BUSINESS_DATE_FIELD } from '@/collections/fields-f2'
import { softDeleteEntry } from '@/domain/soft-delete/registry'
import { CHANGE_REASON } from '@/fields/common'

import { HttpError, json, v1 } from '../http'
import { DataWriteBody } from '../schemas-data'
import { collectionOf, detailOf, labelText, pick, titleOf, type Doc } from './data-lists'

/**
 * User 2026-10-19 (APK ↔ web parity, phase 5): the web admin edit form of the Proyek collections, server-driven.
 * - GET   /data/{collection}/form[?id=]   — the editable fields with the caller's field-level access (Payload
 *   docAccessOperation = what the admin form renders), current values, the reason rules of the audit hooks;
 * - GET   /data/{collection}/options      — the picker of one relationship field (its filterOptions applied);
 * - POST  /data/{collection}, PATCH /data/{collection}/{id} — payload.create / update AS THE CALLER
 *   (overrideAccess: false): collection + field access, hooks (PT rules, guards), validation and audit as on the web.
 * Only DATA_WRITABLE: collections the web edits with the plain collection form. Excluded on purpose: rap-items (RAP
 * endpoints with lock + reason rules), clients (the tabbed Klien page / GET+PUT /client-form with the contacts).
 */
export const DATA_WRITABLE = [
  'cost-centers',
  'team-assignments',
  'project-stages',
  'stage-templates',
  'resource-types',
  'service-types',
  'budget-lines',
  'rap-templates',
  'contract-units',
] as const

const READ_LIMIT: [number, number] = [60, 60_000]
const WRITE_LIMIT: [number, number] = [30, 60_000]

/** Field types the APK form edits; required fields of other types make a create `supported: false`. */
type FormType = 'text' | 'textarea' | 'email' | 'number' | 'money' | 'date' | 'datetime' | 'checkbox' | 'select' | 'multiselect' | 'relationship' | 'relationships'

/** Never shown / never written: system columns and the virtual audit reason (sent as `reason`). */
const SYSTEM = new Set(['id', 'createdAt', 'updatedAt', 'deletedAt', 'isDeleted', 'uuid', CHANGE_REASON])
const LAYOUT_SKIP = new Set(['ui', 'join', 'json', 'richText', 'blocks', 'point', 'code', 'array', 'upload'])

type FormLeaf = { key: string; label: string; field: Field & { name: string }; path: string[] }
type FieldOut = {
  key: string
  label: string
  type: FormType
  required: boolean
  readOnly: boolean
  maxLength?: number
  min?: number
  max?: number
  help?: string
  options?: Array<{ value: string; label: string }>
  relationTo?: string
  value: unknown
  valueLabel?: string | string[] | null
}

function writableOf(req: PayloadRequest, slug: string | undefined) {
  const cfg = collectionOf(req, slug)
  if (!(DATA_WRITABLE as readonly string[]).includes(cfg.slug)) throw new HttpError(404, 'Not Found', { detail: 'Data ini tidak dapat diubah dari aplikasi.' })
  return cfg
}

/** Data fields of the form (rows / collapsibles / unnamed tabs flattened; groups + named tabs as dot paths). */
function formLeaves(fields: readonly Field[], skipped: string[], prefix: string[] = [], labelPrefix = ''): FormLeaf[] {
  const out: FormLeaf[] = []
  for (const f of fields) {
    if (f.type === 'row' || f.type === 'collapsible') {
      out.push(...formLeaves(f.fields, skipped, prefix, labelPrefix))
      continue
    }
    if (f.type === 'tabs') {
      for (const t of f.tabs) {
        if ('name' in t && t.name) out.push(...formLeaves(t.fields, skipped, [...prefix, t.name], `${labelPrefix}${labelText(t.label, t.name)} › `))
        else out.push(...formLeaves(t.fields, skipped, prefix, labelPrefix))
      }
      continue
    }
    if (!('name' in f) || !f.name || SYSTEM.has(f.name)) continue
    const key = [...prefix, f.name].join('.')
    const flags = f as { hidden?: boolean; virtual?: unknown; admin?: { hidden?: boolean; disabled?: boolean; condition?: unknown } }
    if (flags.hidden === true || flags.admin?.hidden === true || flags.admin?.disabled === true || flags.virtual) continue
    if (f.type === 'ui') continue
    if (flags.admin?.condition || LAYOUT_SKIP.has(f.type)) {
      skipped.push(key)
      continue
    }
    const label = labelText((f as { label?: unknown }).label, f.name)
    if (f.type === 'group') {
      out.push(...formLeaves(f.fields, skipped, [...prefix, f.name], `${labelPrefix}${label} › `))
      continue
    }
    if (f.type === 'relationship' && Array.isArray(f.relationTo)) {
      skipped.push(key) // polymorphic relationship: web only
      continue
    }
    out.push({ key, label: `${labelPrefix}${label}`, field: f as FormLeaf['field'], path: [...prefix, f.name] })
  }
  return out
}

/** Unsupported REQUIRED data fields (array minRows, upload, …) — a create through the APK cannot satisfy them. */
function requiredUnsupported(fields: readonly Field[]): string[] {
  const out: string[] = []
  const walk = (list: readonly Field[]) => {
    for (const f of list) {
      if (f.type === 'row' || f.type === 'collapsible') walk(f.fields)
      else if (f.type === 'tabs') f.tabs.forEach((t) => walk(t.fields))
      else if (f.type === 'group') walk(f.fields)
      else if ('name' in f && f.name && !SYSTEM.has(f.name)) {
        const req = (f as { required?: boolean }).required === true || (f.type === 'array' && (f.minRows ?? 0) > 0)
        const unsupported = LAYOUT_SKIP.has(f.type) || (f.type === 'relationship' && Array.isArray(f.relationTo)) || Boolean((f as { admin?: { condition?: unknown } }).admin?.condition)
        if (req && unsupported) out.push(f.name)
      }
    }
  }
  walk(fields)
  return out
}

function formType(f: FormLeaf['field']): FormType {
  switch (f.type) {
    case 'textarea':
      return 'textarea'
    case 'email':
      return 'email'
    case 'number':
      return isRupiahField(f) ? 'money' : 'number'
    case 'date':
      return f.admin?.date?.pickerAppearance === 'dayOnly' ? 'date' : 'datetime'
    case 'checkbox':
      return 'checkbox'
    case 'select':
      return f.hasMany ? 'multiselect' : 'select'
    case 'radio':
      return 'select'
    case 'relationship':
      return f.hasMany ? 'relationships' : 'relationship'
    case 'text': {
      const comp = (f.admin as { components?: { Field?: unknown } } | undefined)?.components?.Field
      return comp === BUSINESS_DATE_FIELD ? 'date' : 'text'
    }
    default:
      return 'text'
  }
}

/** Field-level permission of the caller (sanitized: `true` = every operation; missing = none). */
function fieldAllowed(perms: SanitizedCollectionPermission, path: string[], op: 'create' | 'update'): boolean {
  let level: unknown = perms.fields
  for (let i = 0; i < path.length; i++) {
    if (level === true) return true
    if (!level || typeof level !== 'object') return false
    const entry = (level as Record<string, unknown>)[path[i]!]
    if (entry === true) return true
    if (!entry || typeof entry !== 'object') return false
    if (i === path.length - 1) return (entry as Record<string, unknown>)[op] === true
    level = (entry as { fields?: unknown }).fields
  }
  return false
}

const collectionAllowed = (perms: SanitizedCollectionPermission, op: 'create' | 'update' | 'delete') => (perms as Record<string, unknown>)[op] === true

const relId = (v: unknown): number | string | null => (v && typeof v === 'object' ? ((v as { id?: number | string }).id ?? null) : (v as number | string | null) ?? null)

/** Payload calls a function defaultValue with {user, locale, req}; errors → no default. */
async function defaultOf(f: FormLeaf['field'], req: PayloadRequest): Promise<unknown> {
  const dv = (f as { defaultValue?: unknown }).defaultValue
  if (typeof dv !== 'function') return dv ?? null
  try {
    return (await (dv as (a: unknown) => unknown)({ user: req.user, req, locale: undefined })) ?? null
  } catch {
    return null
  }
}

async function labelsOf(req: PayloadRequest, relationTo: string, ids: Array<number | string>): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const r = await req.payload
    .find({ collection: relationTo as CollectionSlug, where: { id: { in: ids } }, depth: 0, limit: ids.length, pagination: false, user: req.user, overrideAccess: false, req })
    .catch(() => ({ docs: [] as unknown[] }))
  return new Map((r.docs as Doc[]).map((d) => [String(d.id), titleOf(req, relationTo, d)]))
}

const reasonRulesOf = (cfg: ReturnType<typeof collectionOf>) =>
  ((cfg.custom as { pkAudit?: { reasonRules?: Array<(a: { operation: 'create' | 'update'; data: Record<string, unknown>; original: Record<string, unknown> | undefined }) => string | false> } } | undefined)?.pkAudit?.reasonRules) ?? []

function idParam(v: string | null | undefined): number {
  if (!v || !/^\d{1,10}$/.test(v)) throw new HttpError(404, 'Not Found')
  return Number(v)
}

/** GET /api/v1/data/{collection}/form[?id=] — the edit form of a writable collection. */
export const dataFormEndpoint = v1({
  path: '/data/:collection/form',
  method: 'get',
  rateLimit: READ_LIMIT,
  handler: async ({ req, params }) => {
    const cfg = writableOf(req, params.collection)
    const rawId = req.searchParams.get('id')
    const id = rawId === null || rawId === '' ? null : idParam(rawId)
    const collection = req.payload.collections[cfg.slug as CollectionSlug]!
    const doc = id === null ? null : ((await req.payload.findByID({ collection: cfg.slug as CollectionSlug, id, depth: 0, user: req.user, overrideAccess: false, req }).catch(() => null)) as Doc | null)
    if (id !== null && !doc) throw new HttpError(404, 'Not Found')
    const perms = await docAccessOperation({ collection, req, ...(id !== null ? { id } : {}) })
    const op = id === null ? 'create' : 'update'
    const skipped: string[] = []
    const leaves = formLeaves(cfg.fields, skipped)
    const fields: FieldOut[] = []
    for (const l of leaves) {
      const f = l.field
      const type = formType(f)
      const raw = doc ? pick(doc, l.key) : await defaultOf(f, req)
      let value: unknown = raw ?? null
      let valueLabel: FieldOut['valueLabel']
      if (type === 'relationship' || type === 'relationships') {
        const relationTo = (f as { relationTo: string }).relationTo
        const ids = (Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw]).map(relId).filter((x): x is number | string => x !== null)
        const names = await labelsOf(req, relationTo, ids)
        value = type === 'relationships' ? ids : (ids[0] ?? null)
        valueLabel = type === 'relationships' ? ids.map((x) => names.get(String(x)) ?? `#${x}`) : ids[0] !== undefined ? (names.get(String(ids[0])) ?? `#${ids[0]}`) : null
      }
      const admin = (f as { admin?: { readOnly?: boolean; description?: unknown } }).admin
      const out: FieldOut = {
        key: l.key,
        label: l.label,
        type,
        required: (f as { required?: boolean }).required === true,
        readOnly: admin?.readOnly === true || !fieldAllowed(perms, l.path, op),
        value,
      }
      if (typeof (f as { maxLength?: unknown }).maxLength === 'number') out.maxLength = (f as { maxLength: number }).maxLength
      if (typeof (f as { min?: unknown }).min === 'number') out.min = (f as { min: number }).min
      if (typeof (f as { max?: unknown }).max === 'number') out.max = (f as { max: number }).max
      if (typeof admin?.description === 'string') out.help = admin.description
      if (f.type === 'select' || f.type === 'radio') {
        out.options = f.options.map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: String(o.value), label: labelText(o.label, String(o.value)) }))
      }
      if (type === 'relationship' || type === 'relationships') {
        out.relationTo = (f as { relationTo: string }).relationTo
        out.valueLabel = valueLabel ?? null
      }
      fields.push(out)
    }
    const rules = reasonRulesOf(cfg)
    const probe = (data: Record<string, unknown>, original: Record<string, unknown>) => rules.some((r) => Boolean(r({ operation: 'update', data, original })))
    return json({
      collection: cfg.slug,
      label: labelText(cfg.labels?.singular, cfg.slug),
      id,
      title: doc ? titleOf(req, cfg.slug, doc) : null,
      canCreate: id === null && collectionAllowed(perms, 'create'),
      canUpdate: id !== null && collectionAllowed(perms, 'update'),
      canDelete: id !== null && softDeleteEntry(cfg.slug) !== undefined,
      supported: id !== null || requiredUnsupported(cfg.fields).length === 0,
      reason: { onUpdate: probe({}, {}), onDeactivate: probe({ active: false }, { active: true }) },
      fields,
      skipped,
    })
  },
})

/** GET /api/v1/data/{collection}/options?field=&q=&id= — the picker of one relationship field. */
export const dataOptionsEndpoint = v1({
  path: '/data/:collection/options',
  method: 'get',
  rateLimit: READ_LIMIT,
  handler: async ({ req, params }) => {
    const cfg = writableOf(req, params.collection)
    const key = req.searchParams.get('field') ?? ''
    const leaf = formLeaves(cfg.fields, []).find((l) => l.key === key)
    if (!leaf || leaf.field.type !== 'relationship' || Array.isArray(leaf.field.relationTo)) throw new HttpError(404, 'Not Found', { detail: 'Bukan field pilihan.' })
    const f = leaf.field as Field & { relationTo: string; filterOptions?: unknown }
    const rawId = req.searchParams.get('id')
    const id = rawId ? idParam(rawId) : undefined
    const doc = id !== undefined ? ((await req.payload.findByID({ collection: cfg.slug as CollectionSlug, id, depth: 0, user: req.user, overrideAccess: false, req }).catch(() => null)) as Doc | null) : null
    // the form state the web hands filterOptions (`data` / `siblingData`): the stored doc, overlaid by `data[<key>]=` params
    const data: Doc = { ...(doc ?? {}) }
    for (const [k, v] of req.searchParams.entries()) {
      const m = /^data\[([A-Za-z0-9_.]{1,64})\]$/.exec(k)
      if (m) data[m[1]!] = /^\d{1,10}$/.test(v) ? Number(v) : v
    }
    const and: Where[] = []
    if (typeof f.filterOptions === 'function') {
      const r = await (f.filterOptions as (a: unknown) => unknown)({ req, user: req.user, data, siblingData: data, id, relationTo: f.relationTo, blockData: undefined })
      if (r === false) return json({ items: [] })
      if (r && typeof r === 'object') and.push(r as Where)
    } else if (f.filterOptions && typeof f.filterOptions === 'object') {
      and.push(f.filterOptions as Where)
    }
    const target = req.payload.collections[f.relationTo as CollectionSlug]?.config
    const title = target?.admin?.useAsTitle
    const q = (req.searchParams.get('q') ?? '').trim().slice(0, 60)
    if (q && title && title !== 'id') and.push({ [title]: { like: q } })
    const res = await req.payload.find({
      collection: f.relationTo as CollectionSlug,
      where: and.length ? { and } : undefined,
      sort: title && title !== 'id' ? title : '-id',
      limit: 30,
      depth: 0,
      user: req.user,
      overrideAccess: false,
      req,
    })
    return json({ items: (res.docs as unknown as Doc[]).map((d) => ({ id: d.id as number | string, label: titleOf(req, f.relationTo, d) })) })
  },
})

/** `data` keys → the nested Payload shape (groups); unknown / read-only keys → 400. */
async function writeData(req: PayloadRequest, cfg: ReturnType<typeof collectionOf>, data: Record<string, unknown>, op: 'create' | 'update', id?: number) {
  const collection = req.payload.collections[cfg.slug as CollectionSlug]!
  const perms = await docAccessOperation({ collection, req, ...(id !== undefined ? { id } : {}) })
  if (!collectionAllowed(perms, op)) throw new HttpError(403, 'Forbidden', { detail: op === 'create' ? 'Anda tidak dapat menambah data ini.' : 'Anda tidak dapat mengubah data ini.' })
  const leaves = new Map(formLeaves(cfg.fields, []).map((l) => [l.key, l]))
  const errors: Array<{ path: string; message: string }> = []
  const out: Doc = {}
  for (const [k, v] of Object.entries(data)) {
    const l = leaves.get(k)
    if (!l) {
      errors.push({ path: k, message: 'Field tidak dikenal.' })
      continue
    }
    const ro = (l.field as { admin?: { readOnly?: boolean } }).admin?.readOnly === true || !fieldAllowed(perms, l.path, op)
    if (ro) {
      errors.push({ path: k, message: 'Field ini tidak dapat diubah.' })
      continue
    }
    let target = out
    for (const seg of l.path.slice(0, -1)) target = (target[seg] ??= {}) as Doc
    target[l.path[l.path.length - 1]!] = v
  }
  if (errors.length) throw new HttpError(400, 'Bad Request', { detail: 'Data tidak valid.', errors })
  return out
}

/** POST /api/v1/data/{collection} {data, reason?} → 201 + the detail. */
export const dataCreateEndpoint = v1({
  path: '/data/:collection',
  method: 'post',
  body: DataWriteBody,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => {
    const cfg = writableOf(req, params.collection)
    const data = await writeData(req, cfg, body.data, 'create')
    if (body.reason) data[CHANGE_REASON] = body.reason
    const doc = (await req.payload.create({ collection: cfg.slug as CollectionSlug, data: data as never, user: req.user, overrideAccess: false, req, depth: 0 })) as unknown as Doc
    return json(await detailOf(req, cfg, Number(doc.id)), 201)
  },
})

/** PATCH /api/v1/data/{collection}/{id} {data, reason?} → the detail. */
export const dataUpdateEndpoint = v1({
  path: '/data/:collection/:id',
  method: 'patch',
  body: DataWriteBody,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => {
    const cfg = writableOf(req, params.collection)
    const id = idParam(params.id)
    const exists = await req.payload.findByID({ collection: cfg.slug as CollectionSlug, id, depth: 0, user: req.user, overrideAccess: false, req }).catch(() => null)
    if (!exists) throw new HttpError(404, 'Not Found')
    const data = await writeData(req, cfg, body.data, 'update', id)
    if (body.reason) data[CHANGE_REASON] = body.reason
    await req.payload.update({ collection: cfg.slug as CollectionSlug, id, data: data as never, user: req.user, overrideAccess: false, req, depth: 0 })
    return json(await detailOf(req, cfg, id))
  },
})

/** Before DATA_ENDPOINTS: `/form` and `/options` must win over `/data/:collection/:id`. */
export const DATA_FORM_ENDPOINTS = [dataFormEndpoint, dataOptionsEndpoint, dataCreateEndpoint, dataUpdateEndpoint]
