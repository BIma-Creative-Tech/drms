import type { CollectionBeforeOperationHook, FilterOptionsProps, PayloadRequest, TextField, Where } from 'payload'

import { memberCompanies, relId, soleCompany, type Role } from '@/access/roles'
import { NO_ROWS } from '@/access/scope'

/**
 * QA-16: users are shown by NAME in every user picker / relationship label, with the email as the
 * secondary part ("Budi Santoso · budi@pt.co.id"); accounts without a name show the email only.
 */
export function userLabel(u: { name?: unknown; email?: unknown } | null | undefined): string {
  const name = typeof u?.name === 'string' ? u.name.trim() : ''
  const email = typeof u?.email === 'string' ? u.email.trim() : ''
  if (name && email) return `${name} · ${email}`
  return name || email
}

export const DISPLAY_NAME = 'displayName'

/**
 * Virtual title field of `users` (admin.useAsTitle): never stored, computed after read. Payload's
 * relationship picker selects and searches the `useAsTitle` field only — `displayNameQuery` maps
 * both to the real columns `name` / `email`.
 */
export function displayNameField(): TextField {
  return {
    name: DISPLAY_NAME,
    type: 'text',
    label: 'Nama (email)',
    virtual: true,
    admin: { hidden: true, disableListColumn: true, disableListFilter: true },
    hooks: { afterRead: [({ siblingData }) => userLabel(siblingData as { name?: unknown; email?: unknown })] },
  }
}

/** Rewrites `where` paths on the virtual title to the stored `name` / `email` columns. */
export function rewriteDisplayNameWhere(where: unknown): unknown {
  if (Array.isArray(where)) return where.map(rewriteDisplayNameWhere)
  if (!where || typeof where !== 'object') return where
  const out: Record<string, unknown> = {}
  const or: Where[] = []
  for (const [k, v] of Object.entries(where as Record<string, unknown>)) {
    if (k === DISPLAY_NAME) {
      or.push({ or: [{ name: v as never }, { email: v as never }] })
      continue
    }
    out[k] = k === 'and' || k === 'or' ? rewriteDisplayNameWhere(v) : v
  }
  if (or.length === 0) return out
  const rest = Object.keys(out).length > 0 ? [out as Where] : []
  const parts = [...rest, ...or]
  return parts.length === 1 ? parts[0] : { and: parts }
}

/**
 * beforeOperation (read) of `users`: picker requests `select[displayName]=true` and
 * `where[displayName][like]=…` (Payload ui Relationship/Input.js @3.90.1). A virtual field has no
 * column → select its sources and search them instead. Sort by the title → sort by name.
 */
export const displayNameQuery: CollectionBeforeOperationHook = ({ args, operation }) => {
  if (operation !== 'read' && operation !== 'count') return args
  const a = args as { select?: Record<string, unknown>; where?: Where; sort?: string | string[] }
  if (a.select && typeof a.select === 'object' && a.select[DISPLAY_NAME] === true) a.select = { ...a.select, name: true, email: true }
  if (a.where) a.where = rewriteDisplayNameWhere(a.where) as Where
  const fixSort = (s: string) => (s === DISPLAY_NAME ? 'name' : s === `-${DISPLAY_NAME}` ? '-name' : s)
  if (typeof a.sort === 'string') a.sort = fixSort(a.sort)
  else if (Array.isArray(a.sort)) a.sort = a.sort.map(fixSort)
  return args
}

/** PT of the document being edited (picker): its `company`, else the caller's only selected PT. */
function pickerCompanies(req: PayloadRequest, data: unknown): number[] {
  const c = relId((data as { company?: unknown } | undefined)?.company)
  if (c !== undefined) return [c]
  const sole = soleCompany(req)
  return sole !== undefined ? [sole] : memberCompanies(req)
}

/**
 * QA-16 user picker: ACTIVE accounts with an ACTIVE membership in the document's PT (optionally
 * holding one of `roles` there), e.g. projects.pm = the PMs of the project's PT. Picker-only like
 * `pickerSameCompany`: the save-time re-validation of filterOptions is switched off (a PM who later
 * loses the role must not block other edits of the project); membership of the PT is enforced on save
 * by `companyHook` (`member: true`).
 */
export function userPicker(opts: { roles?: readonly Role[]; required?: boolean } = {}) {
  return {
    filterOptions: async ({ data, req }: FilterOptionsProps): Promise<Where> => {
      const companies = pickerCompanies(req, data)
      if (companies.length === 0) return NO_ROWS
      const and: Where[] = [{ company: { in: companies } }, { active: { equals: true } }]
      if (opts.roles?.length) and.push({ roles: { in: [...opts.roles] } })
      const res = await req.payload.find({
        collection: 'company-memberships',
        where: { and },
        depth: 0,
        pagination: false,
        select: { user: true },
        overrideAccess: true, // SYSTEM-READ: picker options (members of the document's PT)
        req,
      })
      const ids = [...new Set(res.docs.map((m) => relId((m as { user?: unknown }).user)).filter((x): x is number => x !== undefined))]
      return ids.length === 0 ? NO_ROWS : { and: [{ id: { in: ids } }, { active: { equals: true } }] }
    },
    validate: (v: unknown) => (opts.required && (v === null || v === undefined || v === '') ? 'Wajib diisi.' : true),
  } as const
}

/**
 * DRMS 10/10 integration (Lead review a): read-only user relationships ("Dibuat oleh", "Dicatat oleh",
 * "Pelapor" …) show the person's NAME on the form and in list columns (admin/components/users/
 * UserNameField + UserNameCell, resolver domain/user-display-name.ts userNameOf) — Payload's own label
 * needs read access to `users` and showed "Tanpa Judul - ID: 1" to Staff/PM/Finance.
 */
export const USER_NAME_VIEW = {
  Field: '@/admin/components/users/UserNameField#UserNameField',
  Cell: '@/admin/components/users/UserNameCell#UserNameCell',
} as const
