import { APIError, type CollectionBeforeChangeHook, type CollectionSlug, type PayloadRequest, type RelationshipField } from 'payload'

import { PENDING_CREATE_ROLES } from '@/access/policies'
import { hasRole, relId, soleCompany, type Role } from '@/access/roles'
import { defaultCompanyForWrite } from '@/domain/companies'
import { validationError } from '@/lib/validation'

/**
 * ADR 0016 §4: every per-PT collection carries `company` (DB `company_id NOT NULL`, immutable).
 * - master ("C"): chosen on create (default: the caller's only selected PT / the only active PT for
 *   a system write), never changed afterwards;
 * - derived ("D"): copied from the parent document (never user input) by `companyHook`, and by the
 *   DB trigger `pk_company_*` for raw inserts.
 * The DB triggers of migration `*_mc1_security` are the final guard (`cross-company reference`).
 */
export function companyField(opts: { derived?: boolean } = {}): RelationshipField {
  return {
    name: 'company',
    type: 'relationship',
    relationTo: 'companies',
    label: 'PT',
    // Not `required` at the Payload level: the company hook always fills it (default = the caller's
    // only PT / the only active PT; derived = the parent's PT) before validation, and the DB column is
    // NOT NULL (migration *_mc1_company_columns). Keeps typed Local API calls without `company` valid.
    index: true,
    access: opts.derived ? { create: () => false, update: () => false } : { update: () => false },
    // MC2-4 (wireframe §4 "Buat baru"): a chosen PT sits at the top of the form; a derived one in the sidebar.
    admin: opts.derived
      ? { position: 'sidebar', readOnly: true, description: 'Mengikuti dokumen induk.' }
      : { description: 'Wajib bila Anda memilih lebih dari satu PT di pemilih PT; tidak dapat diubah setelah dibuat.' },
  }
}

/** A per-PT reference: `field` (or `field[].sub` for arrays) pointing at a per-PT collection. */
export type CompanyRef = {
  field: string
  /** Array field: the relationship lives in each row under `sub`. */
  sub?: string
  collection: CollectionSlug
  /** `users` reference: needs an ACTIVE membership in the row's PT instead of a company column. */
  member?: boolean
}

function refIds(data: Record<string, unknown>, ref: CompanyRef): number[] | undefined {
  if (!(ref.field in data)) return undefined
  const v = data[ref.field]
  const vals = ref.sub ? (Array.isArray(v) ? v.map((row) => (row as Record<string, unknown> | null)?.[ref.sub!]) : []) : Array.isArray(v) ? v : [v]
  return [...new Set(vals.map((x) => relId(x)).filter((x): x is number => x !== undefined))]
}

async function companiesOf(req: PayloadRequest, collection: CollectionSlug, ids: number[]): Promise<Map<number, number | undefined>> {
  const res = await req.payload.find({
    collection,
    where: { id: { in: ids } },
    depth: 0,
    pagination: false,
    select: { company: true } as never,
    overrideAccess: true, // SYSTEM-READ: company of referenced documents (cross-PT check)
    req,
  })
  const docs = res.docs as unknown as Array<{ id: number; company?: unknown }>
  return new Map(docs.map((d) => [d.id, relId(d.company)]))
}

async function activeMembers(req: PayloadRequest, users: number[], company: number): Promise<Set<number>> {
  const res = await req.payload.find({
    collection: 'company-memberships',
    where: { and: [{ user: { in: users } }, { company: { equals: company } }, { active: { equals: true } }] },
    depth: 0,
    pagination: false,
    overrideAccess: true, // SYSTEM-READ: membership of referenced users (cross-PT check)
    req,
  })
  return new Set(res.docs.map((d) => relId((d as { user?: unknown }).user)).filter((x): x is number => x !== undefined))
}

export const CROSS_COMPANY_MESSAGE = 'Data harus dari PT yang sama (cross-company reference).'

/**
 * beforeChange hook of a per-PT collection. `derive` = parents the company is copied from (all of
 * them that are set must agree); `check` = further per-PT references that must belong to the same PT.
 * On create it also enforces the role a REST/Local create needs IN the resolved PT (rolesAllowed).
 */
export function companyHook(slug: CollectionSlug, opts: { derive?: CompanyRef[]; check?: CompanyRef[] } = {}): CollectionBeforeChangeHook {
  return async ({ data, originalDoc, operation, req }) => {
    const d = data as Record<string, unknown>
    const prev = (originalDoc ?? {}) as Record<string, unknown>
    let company = relId(prev.company)
    if (operation === 'create') {
      const given = relId(d.company)
      let derived: number | undefined
      for (const ref of opts.derive ?? []) {
        const ids = refIds(d, ref)
        if (!ids?.length) continue
        const map = await companiesOf(req, ref.collection, ids)
        for (const id of ids) {
          const c = map.get(id)
          if (c === undefined) continue
          if (derived !== undefined && derived !== c) throw validationError(req, { collection: slug }, [{ path: ref.field, message: CROSS_COMPANY_MESSAGE }])
          derived = c
        }
      }
      if (given !== undefined && derived !== undefined && given !== derived) {
        throw validationError(req, { collection: slug }, [{ path: 'company', message: CROSS_COMPANY_MESSAGE }])
      }
      company = derived ?? given ?? (await defaultCompanyForWrite(req))
      d.company = company
      const need = req.context?.[PENDING_CREATE_ROLES] as Role[] | undefined
      if (need) {
        delete req.context[PENDING_CREATE_ROLES]
        if (req.user && !hasRole(req, need, company)) throw new APIError('Anda tidak berhak membuat data di PT ini.', 403, null, true)
      }
    } else if (company !== undefined) {
      d.company = company // immutable (field access + DB trigger)
    }
    if (company === undefined) return data
    for (const ref of [...(opts.derive ?? []), ...(opts.check ?? [])]) {
      const ids = refIds(d, ref)
      if (!ids?.length) continue
      const before = refIds(prev, ref) ?? []
      const fresh = operation === 'create' ? ids : ids.filter((id) => !before.includes(id))
      if (fresh.length === 0) continue
      if (ref.member) {
        const ok = await activeMembers(req, fresh, company)
        if (fresh.some((id) => !ok.has(id))) {
          throw validationError(req, { collection: slug }, [{ path: ref.sub ? `${ref.field}` : ref.field, message: 'Pengguna harus anggota aktif PT ini.' }])
        }
        continue
      }
      const map = await companiesOf(req, ref.collection, fresh)
      if (fresh.some((id) => map.has(id) && map.get(id) !== company)) {
        throw validationError(req, { collection: slug }, [{ path: ref.field, message: CROSS_COMPANY_MESSAGE }])
      }
    }
    return data
  }
}

/**
 * `filterOptions` of a per-PT relationship: rows of the document's PT only (admin pickers). Before a
 * PT is known (a derived document on create) every readable row. NOTE: Payload re-validates a value
 * against filterOptions with the caller's read access — use it only where the editor can read the
 * referenced rows anyway (employee pickers, MC2-4).
 */
export const sameCompanyOptions = ({ data }: { data?: unknown }) => {
  const c = relId((data as { company?: unknown } | undefined)?.company)
  return c === undefined ? true : { company: { equals: c } }
}

/**
 * Picker-only PT filter (MC2-4, "employee picker filtered by PT"): `filterOptions` narrows the admin
 * dropdown to the document's PT, while the save-time re-validation of filterOptions (which re-reads
 * the referenced rows with the CALLER's access) is switched off — same pattern as
 * `expense-requests.bankAccount`. Cross-PT values stay impossible: `companyHook` + DB trigger
 * `pk_same_company` (`cross-company reference`).
 */
export function pickerSameCompany(opts: { required?: boolean } = {}) {
  return {
    filterOptions: sameCompanyOptions,
    validate: (v: unknown) => (opts.required && (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) ? 'Wajib diisi.' : true),
  } as const
}

/**
 * Employees (MC2-4, D1 "1 employee = 1 PT"): the PT must be chosen explicitly on create when the
 * caller has more than one PT selected (same condition as `defaultCompanyForWrite`, but as a field
 * error next to the PT picker instead of a generic 400). System writes (no user) keep the default.
 */
export function requireCompanyWhenAmbiguous(
  value: unknown,
  opts: { operation?: string; req?: { user?: unknown } },
): true | string {
  if (value !== null && value !== undefined && value !== '') return true
  if (opts.operation !== 'create' || !opts.req?.user) return true
  return soleCompany(opts.req as never) === undefined ? 'PT wajib dipilih: Anda memilih lebih dari satu PT (atau belum punya PT).' : true
}
