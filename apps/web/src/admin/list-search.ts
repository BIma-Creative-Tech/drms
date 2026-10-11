import type { CollectionConfig, Field } from 'payload'

/**
 * DRMS 10/10 D8: every Payload list view has a meaningful search box. Payload searches only
 * `admin.useAsTitle` (or the id) when `admin.listSearchableFields` is not set; this fills it for
 * every collection that does not set it itself: the explicit list below, else the collection's
 * top-level text fields among SEARCH_CANDIDATES (numbers, codes, names, titles). Only stored text
 * fields WITHOUT field-level read access are used (a search must never probe a field the caller
 * cannot read, e.g. masked account numbers). Filters ("Filter" → where builder) and pagination
 * (per page 10…100) are Payload's own on every list. Plain data; no React import (worker loads it).
 */
const SEARCH_CANDIDATES = ['docNo', 'entryNo', 'receiptNo', 'code', 'shortCode', 'name', 'title', 'description', 'plateNo', 'unitCode', 'email', 'period', 'deviceId', 'event', 'docType', 'reason', 'notes'] as const

/** Explicit choices where the generic order would pick too little or too much. */
const EXPLICIT: Record<string, readonly string[]> = {
  projects: ['code', 'name', 'address'],
  clients: ['name', 'code', 'contactName', 'phone'],
  vendors: ['name', 'code', 'phone'],
  'cash-entries': ['entryNo', 'description'],
  notifications: ['title', 'body'],
  attendances: ['localDate'],
  'attendance-corrections': ['localDate', 'reason'],
  'web-sessions': ['ip', 'userAgent'],
}

type TextField = { name: string; type: string; virtual?: unknown; access?: { read?: unknown } }

function topLevelFields(fields: Field[]): TextField[] {
  const out: TextField[] = []
  for (const f of fields) {
    if ('name' in f && f.name) out.push(f as unknown as TextField)
    else if ((f.type === 'row' || f.type === 'collapsible') && 'fields' in f) out.push(...topLevelFields(f.fields))
  }
  return out
}

/** Stored, readable text-like field of the collection (eligible for `like` search). */
export function searchableField(c: CollectionConfig, name: string): boolean {
  const f = topLevelFields(c.fields).find((x) => x.name === name)
  if (!f || f.virtual || f.access?.read) return false
  return ['text', 'textarea', 'email', 'code'].includes(f.type) // `like` on text columns only
}

export function listSearchFieldsOf(c: CollectionConfig): string[] {
  const wanted = EXPLICIT[c.slug] ?? SEARCH_CANDIDATES
  const title = typeof c.admin?.useAsTitle === 'string' ? [c.admin.useAsTitle] : []
  return [...new Set([...wanted, ...title])].filter((n) => searchableField(c, n)).slice(0, 5)
}

export function withListSearch(collections: CollectionConfig[]): CollectionConfig[] {
  return collections.map((c) => {
    if (c.admin?.listSearchableFields?.length) return c
    const fields = listSearchFieldsOf(c)
    return fields.length ? { ...c, admin: { ...(c.admin ?? {}), listSearchableFields: fields } } : c
  })
}
