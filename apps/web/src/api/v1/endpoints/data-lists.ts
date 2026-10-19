import type { CollectionSlug, Field, PayloadRequest, Where } from 'payload'

import { isPlainNumberField, isRupiahField } from '@/admin/display-cells'
import { settings } from '@/domain/expense/common'
import { formatNumber, formatRupiah } from '@/lib/money'
import { formatServerTimestamp } from '@/lib/server-time'

import { HttpError, json, v1 } from '../http'

/**
 * User 2026-10-19 (APK ↔ web parity, phase 3+): the web collection lists behind the "Data …" menu items, read-only,
 * as display text. Columns = the collection's admin `defaultColumns` (what the web list shows), labels and the
 * title from the Payload config, values formatted like the web list cells (admin/display-cells.ts). Access is the
 * web's: find / findByID as the caller (overrideAccess: false, field-level read access; the PT selection narrows
 * through the collection access). Only whitelisted collections (later phases extend the list).
 */
export const DATA_COLLECTIONS = [
  // Keuangan (phase 3)
  'receipts',
  'transfers',
  'settlements',
  'expense-line-snapshots',
  'receipt-flags',
  'period-closings',
  'project-loan-repayments',
  'cash-entries',
  'cash-accounts',
  'cash-in-sources',
] as const

const READ_LIMIT: [number, number] = [60, 60_000]
const SKIP = new Set(['ui', 'join', 'json', 'richText', 'blocks', 'point', 'code'])
const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/

type Doc = Record<string, unknown>
type Leaf = { key: string; label: string; field: Field & { name: string } }

function collectionOf(req: PayloadRequest, slug: string | undefined) {
  if (!slug || !(DATA_COLLECTIONS as readonly string[]).includes(slug)) throw new HttpError(404, 'Not Found', { detail: 'Data ini tidak tersedia di aplikasi.' })
  const c = req.payload.collections[slug as CollectionSlug]
  if (!c) throw new HttpError(404, 'Not Found')
  return c.config
}

/** Indonesian label of a config label (string or {id, en}); functions → fallback. */
function labelText(label: unknown, fallback: string): string {
  if (typeof label === 'string') return label
  if (label && typeof label === 'object') {
    const l = label as Record<string, unknown>
    const v = l.id ?? l.en ?? Object.values(l)[0]
    if (typeof v === 'string') return v
  }
  return fallback
}

const humanize = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())

/** Top-level data fields (rows / collapsibles / unnamed tabs flattened; groups + named tabs prefixed with their label). */
function leaves(fields: readonly Field[], prefix = '', labelPrefix = ''): Leaf[] {
  const out: Leaf[] = []
  for (const f of fields) {
    if (f.type === 'row' || f.type === 'collapsible') {
      out.push(...leaves(f.fields, prefix, labelPrefix))
      continue
    }
    if (f.type === 'tabs') {
      for (const t of f.tabs) {
        if ('name' in t && t.name) out.push(...leaves(t.fields, `${prefix}${t.name}.`, `${labelPrefix}${labelText(t.label, humanize(t.name))} › `))
        else out.push(...leaves(t.fields, prefix, labelPrefix))
      }
      continue
    }
    if (!('name' in f) || !f.name) continue
    const flags = f as { hidden?: boolean; admin?: { hidden?: boolean; disabled?: boolean } }
    if (SKIP.has(f.type) || flags.hidden === true || flags.admin?.hidden === true || flags.admin?.disabled === true) continue
    const label = labelText((f as { label?: unknown }).label, humanize(f.name))
    if (f.type === 'group') {
      out.push(...leaves(f.fields, `${prefix}${f.name}.`, `${labelPrefix}${label} › `))
      continue
    }
    out.push({ key: `${prefix}${f.name}`, label: `${labelPrefix}${label}`, field: f as Leaf['field'] })
  }
  return out
}

const pick = (doc: Doc, key: string): unknown => key.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Doc)[k] : undefined), doc)
const has = (doc: Doc, key: string): boolean => {
  const parts = key.split('.')
  const parent = parts.slice(0, -1).reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Doc)[k] : undefined), doc)
  return !!parent && typeof parent === 'object' && parts[parts.length - 1]! in (parent as Doc)
}

function titleOf(req: PayloadRequest, slug: string, doc: unknown): string {
  if (doc === null || doc === undefined) return '—'
  if (typeof doc !== 'object') return `#${String(doc)}`
  const d = doc as Doc
  const t = req.payload.collections[slug as CollectionSlug]?.config.admin?.useAsTitle
  const v = t && t !== 'id' ? d[t] : undefined
  return v !== undefined && v !== null && v !== '' ? String(v) : `#${String(d.id)}`
}

function display(req: PayloadRequest, f: Leaf['field'], v: unknown, tz: string): string | null {
  if (v === null || v === undefined || v === '') return null
  switch (f.type) {
    case 'relationship':
    case 'upload': {
      const one = (x: unknown): string => {
        if (x && typeof x === 'object' && 'relationTo' in (x as Doc)) {
          const p = x as { relationTo: string; value: unknown }
          return titleOf(req, p.relationTo, p.value)
        }
        return titleOf(req, Array.isArray(f.relationTo) ? '' : f.relationTo, x)
      }
      return Array.isArray(v) ? (v.length ? v.map(one).join(', ') : null) : one(v)
    }
    case 'select':
    case 'radio': {
      const label = (x: unknown) => {
        const o = f.options.find((o) => (typeof o === 'string' ? o : o.value) === x)
        return o === undefined ? String(x) : typeof o === 'string' ? o : labelText(o.label, String(o.value))
      }
      return Array.isArray(v) ? (v.length ? v.map(label).join(', ') : null) : label(v)
    }
    case 'checkbox':
      return f.name === 'active' ? (v === true ? 'Aktif' : 'Nonaktif') : v === true ? 'Ya' : 'Tidak'
    case 'date':
      return f.admin?.date?.pickerAppearance === 'dayOnly' && typeof v === 'string' ? dmy(v.slice(0, 10)) : formatServerTimestamp(v, tz)
    case 'number': {
      if (Array.isArray(v)) return v.length ? v.map((x) => formatNumber(Number(x), 2)).join(', ') : null
      const n = typeof v === 'number' ? v : Number(v)
      if (!Number.isFinite(n)) return String(v)
      if (isRupiahField(f)) return formatRupiah(n)
      return isPlainNumberField(f) ? formatNumber(n, 2) : String(n)
    }
    case 'array':
      return Array.isArray(v) ? `${v.length} baris` : null
    default: {
      if (Array.isArray(v)) return v.length ? v.map(String).join(', ') : null
      const s = String(v)
      return BUSINESS_DATE.test(s) ? dmy(s) : s
    }
  }
}

const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

async function tzOf(req: PayloadRequest): Promise<string> {
  return (await settings(req)).timezone || process.env.TZ || 'Asia/Makassar'
}

function intParam(v: string | null, def: number, min: number, max: number): number {
  if (v === null || v === '' || !/^\d{1,6}$/.test(v)) return def
  return Math.min(max, Math.max(min, Number(v)))
}

/** GET /api/v1/data/{collection} — one page of a web collection list (default columns, display text). */
export const dataListEndpoint = v1({
  path: '/data/:collection',
  method: 'get',
  rateLimit: READ_LIMIT,
  handler: async ({ req, params }) => {
    const cfg = collectionOf(req, params.collection)
    const all = leaves(cfg.fields)
    const byKey = new Map(all.map((l) => [l.key, l]))
    const columns = ((cfg.admin?.defaultColumns ?? []) as string[]).map((k) => byKey.get(k)).filter((l): l is Leaf => l !== undefined)
    const sp = req.searchParams
    const q = (sp.get('q') ?? '').trim().slice(0, 100)
    const page = intParam(sp.get('page'), 1, 1, 10_000)
    const limit = intParam(sp.get('limit'), 20, 1, 50)
    const title = cfg.admin?.useAsTitle
    const searchable = [...new Set([...(title && title !== 'id' ? [title] : []), ...((cfg.admin?.listSearchableFields ?? []) as string[])])].filter((k) => {
      const l = byKey.get(k)
      return l && ['text', 'textarea', 'email'].includes(l.field.type)
    })
    let where: Where | undefined
    if (q && searchable.length) {
      const and: Where[] = q
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 5)
        .map((t) => ({ or: searchable.map((k) => ({ [k]: { like: t } })) }))
      where = { and }
    }
    const res = await req.payload.find({
      collection: cfg.slug as CollectionSlug,
      where,
      sort: (cfg.defaultSort as string | undefined) || '-id',
      page,
      limit,
      depth: 1,
      user: req.user,
      overrideAccess: false, // the web list's access (collection + field level, PT selection)
      req,
    })
    const tz = await tzOf(req)
    return json({
      collection: cfg.slug,
      label: labelText(cfg.labels?.plural, cfg.slug),
      columns: columns.map((c) => ({ key: c.key, label: c.label })),
      items: (res.docs as unknown as Doc[]).map((d) => ({
        id: d.id as number | string,
        title: titleOf(req, cfg.slug, d),
        cells: Object.fromEntries(columns.map((c) => [c.key, display(req, c.field, pick(d, c.key), tz)])),
      })),
      totalDocs: res.totalDocs,
      page: res.page ?? page,
      totalPages: res.totalPages,
    })
  },
})

/** GET /api/v1/data/{collection}/{id} — every readable field of one document (display text). */
export const dataDetailEndpoint = v1({
  path: '/data/:collection/:id',
  method: 'get',
  rateLimit: READ_LIMIT,
  handler: async ({ req, params }) => {
    const cfg = collectionOf(req, params.collection)
    const id = params.id ?? ''
    if (!/^\d{1,10}$/.test(id)) throw new HttpError(404, 'Not Found')
    const doc = (await req.payload
      .findByID({ collection: cfg.slug as CollectionSlug, id: Number(id), depth: 1, user: req.user, overrideAccess: false, req })
      .catch(() => null)) as Doc | null
    if (!doc) throw new HttpError(404, 'Not Found')
    const tz = await tzOf(req)
    return json({
      collection: cfg.slug,
      label: labelText(cfg.labels?.singular, cfg.slug),
      id: doc.id as number | string,
      title: titleOf(req, cfg.slug, doc),
      fields: leaves(cfg.fields)
        .filter((l) => has(doc, l.key))
        .map((l) => ({ key: l.key, label: l.label, value: display(req, l.field, pick(doc, l.key), tz) })),
    })
  },
})

export const DATA_ENDPOINTS = [dataListEndpoint, dataDetailEndpoint]
