import type { CollectionConfig, Field } from 'payload'

import { BUSINESS_DATE_FIELD } from '@/collections/fields-f2'

import { ROW_ACTIONS_FIELD } from '../row-actions'

/**
 * DRMS 13/10 Umum #3–#8: per-collection configuration of the generic list view (PkListView) — derived from the
 * collection config, so every collection gets it without its own code. Pure (no React, no Payload instance;
 * unit-tested against the real config):
 * - columns: the fields Payload's own list would offer (top level, rows/collapsibles/unnamed tabs flattened;
 *   no hidden/disabled fields, no `disableListColumn`, ui fields only with a list cell), default set =
 *   `admin.defaultColumns`; sortable = stored scalar columns;
 * - filters (multi-select checklists): select/radio values, booleans and relationships to master data — the
 *   EXPLICIT list below, else the filterable fields of `defaultColumns` plus `status` / `active`; the PT
 *   (`company`) has its own filter (the user's PT selection, never wider);
 * - date ranges: the key date of the collection (EXPLICIT, else the first date column of `defaultColumns`).
 * Field-level read access is applied at request time (pk-list/data.ts): a filter never probes a field the
 * caller cannot read.
 */

export type LabelLike = string | Record<string, string> | ((...args: never[]) => string) | false | undefined
export type PkOption = { value: string; label: LabelLike }

export type PkColumn = { name: string; label: LabelLike; sortable: boolean }

export type PkFilter =
  | { name: string; label: LabelLike; kind: 'select'; options: PkOption[] }
  | { name: string; label: LabelLike; kind: 'boolean' }
  | { name: string; label: LabelLike; kind: 'relationship'; relationTo: string }

export type PkDateFilter = { name: string; label: LabelLike; kind: 'timestamp' | 'business' }

export type PkListConfig = {
  slug: string
  columns: PkColumn[]
  /** Columns shown without a saved preference (Aksi last). */
  defaultColumns: string[]
  filters: PkFilter[]
  dates: PkDateFilter[]
  /** Collection has the top-level PT relationship `company` (PT filter + PT column). */
  hasCompany: boolean
  /** Fields of the search box (admin.listSearchableFields, else useAsTitle). */
  searchFields: string[]
  useAsTitle?: string
  defaultSort?: string
}

/**
 * Relationship targets offered as filter options — master data with a bounded, nameable set of rows. Workflow
 * documents (pengajuan, nota, transfer …) can run into thousands and are reached by search instead.
 */
export const FILTER_TARGETS: ReadonlySet<string> = new Set([
  'projects', 'employees', 'users', 'clients', 'vendors', 'cost-centers', 'sites', 'urgency-levels', 'expense-categories',
  'cash-accounts', 'cash-in-sources', 'banks', 'vehicles', 'uoms', 'resource-types', 'project-stages', 'stage-templates',
  'work-schedules', 'rap-templates', 'approval-rules',
])

/** Explicit filter / date choices where the generic rule (defaultColumns) would pick too little or too much. */
const EXPLICIT: Record<string, { filters?: readonly string[]; dates?: readonly string[] }> = {
  'expense-requests': { filters: ['status', 'type', 'project', 'urgencyLevel', 'costCenter'], dates: ['requestDate'] },
  projects: { filters: ['status', 'kind', 'client', 'site', 'pm'], dates: ['startDate'] },
  employees: { filters: ['attendanceType', 'homeSite', 'workSchedule', 'active'] },
  sites: { filters: ['isHeadOffice', 'costCenter', 'active'] },
  vendors: { filters: ['active'] },
  users: { filters: ['active'] },
  'cash-entries': { filters: ['direction', 'status', 'sourceType', 'cashAccount'], dates: ['entryDate'] },
  transfers: { filters: ['status', 'kind', 'costCenter'], dates: ['transferAt'] },
  receipts: { filters: ['status'], dates: ['receiptDate'] },
  settlements: { filters: ['status', 'settlementType'] },
  attendances: { filters: ['kind', 'source', 'project', 'site', 'outsideArea'] },
  'attendance-corrections': { filters: ['employee', 'kind', 'correctedBy'], dates: ['correctedAt'] },
  notifications: { dates: ['createdAt'] },
  'audit-logs': { filters: ['action', 'docType', 'source'], dates: ['serverTime'] },
}

const MAX_FILTERS = 6
const MAX_DATES = 2

type AnyField = Field & { name?: string; type: string; admin?: Record<string, unknown>; hidden?: boolean; virtual?: unknown; hasMany?: boolean; relationTo?: unknown; options?: unknown; label?: LabelLike; fields?: Field[]; tabs?: Array<{ name?: string; fields: Field[] }> }

/** Top-level named fields (rows, collapsibles and unnamed tabs flattened — as Payload's list columns). */
export function topLevelFields(fields: readonly Field[]): AnyField[] {
  const out: AnyField[] = []
  for (const raw of fields) {
    const f = raw as AnyField
    if ((f.type === 'row' || f.type === 'collapsible') && f.fields) out.push(...topLevelFields(f.fields))
    else if (f.type === 'tabs' && f.tabs) for (const t of f.tabs) if (!t.name) out.push(...topLevelFields(t.fields))
    if ('name' in f && f.name) out.push(f)
  }
  return out
}

const NO_COLUMN = new Set(['json', 'richText', 'array', 'blocks', 'group', 'point', 'join', 'code', 'tabs'])
const NOT_SORTABLE = new Set([...NO_COLUMN, 'ui', 'upload'])

/** Payload's timestamps are `admin.hidden` in the server config (form) but offered as list columns. */
const TIMESTAMPS = new Set(['createdAt', 'updatedAt'])

function hiddenField(f: AnyField): boolean {
  if (f.type === 'date' && TIMESTAMPS.has(f.name ?? '')) return false
  return f.hidden === true || f.admin?.hidden === true || f.admin?.disabled === true
}

/** A field Payload would offer as a list column. */
export function isListColumn(f: AnyField): boolean {
  if (hiddenField(f) || f.admin?.disableListColumn === true) return false
  if (f.type === 'ui') return f.admin?.disableListColumn === false && !!(f.admin?.components as { Cell?: unknown } | undefined)?.Cell
  if (f.type === 'group') return !!(f.admin?.components as { Cell?: unknown } | undefined)?.Cell
  return !NO_COLUMN.has(f.type)
}

export function isSortable(f: AnyField): boolean {
  return !NOT_SORTABLE.has(f.type) && !f.virtual && f.hasMany !== true
}

function optionsOf(f: AnyField): PkOption[] {
  const opts = Array.isArray(f.options) ? (f.options as Array<string | { value: string; label?: LabelLike }>) : []
  return opts.map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: String(o.value), label: o.label ?? String(o.value) }))
}

export function isBusinessDate(f: AnyField): boolean {
  return f.type === 'text' && (f.admin?.components as { Field?: unknown } | undefined)?.Field === BUSINESS_DATE_FIELD
}

/** The filter of one field, or null when the field cannot be filtered by a checklist. */
export function filterOf(f: AnyField): PkFilter | null {
  if (hiddenField(f) || f.virtual || f.name === 'company' || !f.name) return null
  if (f.type === 'select' || f.type === 'radio') {
    const options = optionsOf(f)
    return options.length > 0 ? { name: f.name, label: f.label, kind: 'select', options } : null
  }
  if (f.type === 'checkbox') return { name: f.name, label: f.label, kind: 'boolean' }
  if (f.type === 'relationship' && typeof f.relationTo === 'string' && FILTER_TARGETS.has(f.relationTo)) return { name: f.name, label: f.label, kind: 'relationship', relationTo: f.relationTo }
  return null
}

export function dateFilterOf(f: AnyField): PkDateFilter | null {
  if (hiddenField(f) || f.virtual || !f.name) return null
  if (f.type === 'date') return { name: f.name, label: f.label, kind: 'timestamp' }
  if (isBusinessDate(f)) return { name: f.name, label: f.label, kind: 'business' }
  return null
}

export function buildPkListConfig(c: Pick<CollectionConfig, 'slug' | 'fields' | 'admin' | 'defaultSort'>): PkListConfig {
  const fields = topLevelFields(c.fields)
  const byName = new Map(fields.map((f) => [f.name!, f]))
  const columns: PkColumn[] = [
    // Payload's lists offer the id column as well
    ...(byName.has('id') ? [] : [{ name: 'id', label: 'ID', sortable: true }]),
    ...fields.filter(isListColumn).map((f) => ({ name: f.name!, label: f.label, sortable: isSortable(f) })),
  ]
  const colNames = new Set(columns.map((x) => x.name))
  const admin = c.admin ?? {}
  const useAsTitle = typeof admin.useAsTitle === 'string' ? admin.useAsTitle : undefined
  const wanted = (admin.defaultColumns ?? []).filter((n) => colNames.has(n) && n !== ROW_ACTIONS_FIELD)
  const fallback = columns.filter((x) => x.name !== 'id' && x.name !== ROW_ACTIONS_FIELD).slice(0, 4).map((x) => x.name)
  const defaultColumns = [...(wanted.length ? wanted : fallback), ...(colNames.has(ROW_ACTIONS_FIELD) ? [ROW_ACTIONS_FIELD] : [])]

  const explicit = EXPLICIT[c.slug]
  const candidates = explicit?.filters ?? [...wanted, 'status', 'active']
  const filters: PkFilter[] = []
  for (const n of new Set(candidates)) {
    const f = byName.get(n)
    const def = f ? filterOf(f) : null
    if (def) filters.push(def)
    if (filters.length >= MAX_FILTERS) break
  }
  const dateNames = explicit?.dates ?? wanted
  const dates: PkDateFilter[] = []
  for (const n of dateNames) {
    const f = byName.get(n)
    const def = f ? dateFilterOf(f) : null
    if (def) dates.push(def)
    if (dates.length >= (explicit?.dates ? MAX_DATES : 1)) break
  }
  const searchFields = admin.listSearchableFields?.length ? [...admin.listSearchableFields] : useAsTitle ? [useAsTitle] : []
  return {
    slug: c.slug,
    columns,
    defaultColumns,
    filters,
    dates,
    hasCompany: fields.some((f) => f.name === 'company' && f.type === 'relationship' && f.relationTo === 'companies'),
    searchFields,
    ...(useAsTitle ? { useAsTitle } : {}),
    ...(typeof c.defaultSort === 'string' ? { defaultSort: c.defaultSort } : {}),
  }
}
