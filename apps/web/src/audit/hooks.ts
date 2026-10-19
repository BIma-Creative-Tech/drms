import {
  type CollectionAfterChangeHook,
  type CollectionBeforeChangeHook,
  type CollectionConfig,
  type Field,
  type GlobalAfterChangeHook,
  type GlobalBeforeChangeHook,
  type GlobalConfig,
  type PayloadRequest,
} from 'payload'

import { changeReasonField, CHANGE_REASON } from '@/fields/common'

import { writeAudit, type AuditAction, type AuditRow } from './writer'
import { validationError } from '@/lib/validation'

/** Top-level data field names (walks unnamed row/collapsible/tabs containers; skips virtual/ui). */
export function dataFieldNames(fields: readonly Field[]): string[] {
  const out: string[] = []
  for (const f of fields) {
    if (f.type === 'ui') continue
    if ('name' in f && f.name) {
      if ('virtual' in f && f.virtual) continue
      out.push(f.name)
      continue
    }
    if (f.type === 'row' || f.type === 'collapsible') out.push(...dataFieldNames(f.fields))
    if (f.type === 'tabs') {
      for (const tab of f.tabs) {
        if ('name' in tab && tab.name) out.push(tab.name)
        else out.push(...dataFieldNames(tab.fields))
      }
    }
  }
  return out
}

/** Populated relationship docs → ids; stable key order; undefined → null. */
export function normalizeValue(v: unknown): unknown {
  if (v === undefined || v === null) return null
  if (Array.isArray(v)) return v.map(normalizeValue)
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('id' in o && ('createdAt' in o || 'updatedAt' in o || 'filename' in o)) return o.id
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(o).sort()) sorted[k] = normalizeValue(o[k])
    return sorted
  }
  return v
}

export type FieldChange = { field: string; oldValue: unknown; newValue: unknown }

/** Field-level diff of tracked fields (pure; unit-tested). `prev` undefined = create. */
export function diffFields(
  tracked: readonly string[],
  prev: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): FieldChange[] {
  const out: FieldChange[] = []
  for (const f of tracked) {
    const a = normalizeValue(prev?.[f])
    const b = normalizeValue(next[f])
    if (prev === undefined && b === null) continue
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field: f, oldValue: prev === undefined ? undefined : a, newValue: b })
  }
  return out
}

export type ReasonRule = (args: {
  operation: 'create' | 'update'
  data: Record<string, unknown>
  original: Record<string, unknown> | undefined
}) => string | false

/** Reason required when a record is deactivated (requirements §8 "Nonaktif"). */
export const reasonOnDeactivate: ReasonRule = ({ operation, data, original }) =>
  operation === 'update' && original?.active === true && data.active === false
    ? 'Alasan wajib diisi saat menonaktifkan data.'
    : false

/** Reason required for every update (e.g. approval rules, document sequences — requirements §8). */
export const reasonOnAnyUpdate: ReasonRule = ({ operation }) =>
  operation === 'update' ? 'Alasan perubahan wajib diisi.' : false

/** Reason required when one of `fields` changes on update (e.g. stage weights, archive). */
export const reasonOnChange =
  (fields: string[], message = 'Alasan perubahan wajib diisi.'): ReasonRule =>
  ({ operation, data, original }) =>
    operation === 'update' &&
    fields.some((f) => f in data && JSON.stringify(normalizeValue(data[f])) !== JSON.stringify(normalizeValue(original?.[f])))
      ? message
      : false

export type AuditOptions = {
  docType: string
  /** Extra tracked names not declared in `fields` (e.g. upload built-ins: filename, mimeType). */
  extraFields?: string[]
  exclude?: string[]
  reasonRules?: ReasonRule[]
  docNo?: (doc: Record<string, unknown>) => string | undefined
  /** Special action per changed field (e.g. users.roles → role_change, devices.status → device_revoke). */
  actionFor?: (change: FieldChange, operation: 'create' | 'update', context: Record<string, unknown>) => AuditAction | undefined
}

const CTX_REASON = 'pkAuditReason'

function takeReason(req: PayloadRequest, data: Record<string, unknown>): string | undefined {
  const fromData = typeof data[CHANGE_REASON] === 'string' ? (data[CHANGE_REASON] as string).trim() : ''
  delete data[CHANGE_REASON]
  const fromCtx = typeof req.context?.auditReason === 'string' ? (req.context.auditReason as string).trim() : ''
  const reason = fromData || fromCtx
  return reason.length > 0 ? reason.slice(0, 1000) : undefined
}

function checkReason(
  rules: ReasonRule[],
  args: Parameters<ReasonRule>[0],
  reason: string | undefined,
  req: PayloadRequest,
  where: { collection?: string; global?: string },
): void {
  if (reason && reason.length >= 3) return
  for (const rule of rules) {
    const message = rule(args)
    if (message) throw validationError(req, where, [{ path: CHANGE_REASON, message }])
  }
}

const relIdOf = (v: unknown): number | undefined => (typeof v === 'number' ? v : v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'number' ? (v as { id: number }).id : undefined)

function rowsFor(
  changes: FieldChange[],
  operation: 'create' | 'update',
  base: Pick<AuditRow, 'docType' | 'docId' | 'docNo' | 'reason' | 'companyId'>,
  actionFor?: AuditOptions['actionFor'],
  context: Record<string, unknown> = {},
): AuditRow[] {
  return changes.map((c) => {
    const special = actionFor?.(c, operation, context)
    if (special === 'status_change') {
      return {
        ...base,
        action: special,
        field: c.field,
        oldValue: c.oldValue,
        newValue: c.newValue,
        statusFrom: typeof c.oldValue === 'string' ? c.oldValue : undefined,
        statusTo: typeof c.newValue === 'string' ? c.newValue : undefined,
      }
    }
    if (special) return { ...base, action: special, field: c.field, oldValue: c.oldValue, newValue: c.newValue }
    if (operation === 'update' && c.field === 'active' && typeof c.newValue === 'boolean') {
      return {
        ...base,
        action: c.newValue ? 'reactivate' : 'deactivate',
        field: 'active',
        oldValue: c.oldValue,
        newValue: c.newValue,
        statusFrom: c.oldValue ? 'aktif' : 'nonaktif',
        statusTo: c.newValue ? 'aktif' : 'nonaktif',
      }
    }
    return { ...base, action: operation, field: c.field, oldValue: c.oldValue, newValue: c.newValue }
  })
}

/**
 * Audit hooks factory (ADR 0006 §4): adds the virtual `changeReason` field, a beforeChange hook
 * (reason capture + mandatory-reason rules) and an afterChange hook writing one row per changed
 * tracked field in the SAME transaction. Tracked fields = all top-level data fields.
 */
export function withAudit(collection: CollectionConfig, opts: AuditOptions): CollectionConfig {
  const exclude = new Set(['updatedAt', 'createdAt', CHANGE_REASON, ...(opts.exclude ?? [])])
  const tracked = [...dataFieldNames(collection.fields), ...(opts.extraFields ?? [])].filter((f) => !exclude.has(f))
  const rules = opts.reasonRules ?? []

  const before: CollectionBeforeChangeHook = ({ data, operation, originalDoc, req }) => {
    if (operation !== 'create' && operation !== 'update') return data
    const reason = takeReason(req, data)
    checkReason(rules, { operation, data, original: originalDoc }, reason, req, { collection: collection.slug })
    const ctx = (req.context[CTX_REASON] ??= {}) as Record<string, string | undefined>
    ctx[collection.slug] = reason
    return data
  }

  const after: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req, context }) => {
    if (context?.audit === false) return doc
    const prev = operation === 'create' ? undefined : (previousDoc as Record<string, unknown>)
    const changes = diffFields(tracked, prev, doc as Record<string, unknown>)
    if (changes.length === 0) return doc
    const reason = ((req.context[CTX_REASON] ?? {}) as Record<string, string | undefined>)[collection.slug]
    const rows = rowsFor(changes, operation, {
      docType: opts.docType,
      docId: String(doc.id),
      docNo: opts.docNo?.(doc),
      reason,
      // ADR 0016 §4: rows of a per-PT document carry its PT (companies: the PT itself)
      companyId: collection.slug === 'companies' ? (doc.id as number) : relIdOf((doc as { company?: unknown }).company),
    }, opts.actionFor, (context ?? {}) as Record<string, unknown>)
    await writeAudit(req, rows)
    return doc
  }

  const hasReasonField = collection.fields.some((f) => 'name' in f && f.name === CHANGE_REASON)
  return {
    ...collection,
    fields: hasReasonField ? collection.fields : [...collection.fields, changeReasonField()],
    hooks: {
      ...collection.hooks,
      beforeChange: [...(collection.hooks?.beforeChange ?? []), before],
      afterChange: [...(collection.hooks?.afterChange ?? []), after],
    },
    // reasonRules: read by the APK form (api/v1/endpoints/data-forms.ts) to show when a reason is required
    custom: { ...collection.custom, pkAudit: { docType: opts.docType, tracked, reasonRules: rules } },
  }
}

/** Same for globals (company-settings). docId = global slug. */
export function withGlobalAudit(global: GlobalConfig, opts: Omit<AuditOptions, 'docNo'>): GlobalConfig {
  const exclude = new Set(['updatedAt', 'createdAt', CHANGE_REASON, ...(opts.exclude ?? [])])
  const tracked = [...dataFieldNames(global.fields), ...(opts.extraFields ?? [])].filter((f) => !exclude.has(f))
  const rules = opts.reasonRules ?? []

  const before: GlobalBeforeChangeHook = ({ data, originalDoc, req }) => {
    const reason = takeReason(req, data)
    checkReason(rules, { operation: 'update', data, original: originalDoc }, reason, req, { global: global.slug })
    const ctx = (req.context[CTX_REASON] ??= {}) as Record<string, string | undefined>
    ctx[`global:${global.slug}`] = reason
    return data
  }

  const after: GlobalAfterChangeHook = async ({ doc, previousDoc, req, context }) => {
    if (context?.audit === false) return doc
    const changes = diffFields(tracked, (previousDoc ?? {}) as Record<string, unknown>, doc as Record<string, unknown>)
    if (changes.length === 0) return doc
    const reason = ((req.context[CTX_REASON] ?? {}) as Record<string, string | undefined>)[`global:${global.slug}`]
    await writeAudit(req, rowsFor(changes, 'update', { docType: opts.docType, docId: global.slug, reason }))
    return doc
  }

  const hasReasonField = global.fields.some((f) => 'name' in f && f.name === CHANGE_REASON)
  return {
    ...global,
    fields: hasReasonField ? global.fields : [...global.fields, changeReasonField()],
    hooks: {
      ...global.hooks,
      beforeChange: [...(global.hooks?.beforeChange ?? []), before],
      afterChange: [...(global.hooks?.afterChange ?? []), after],
    },
    custom: { ...global.custom, pkAudit: { docType: opts.docType, tracked } },
  }
}
