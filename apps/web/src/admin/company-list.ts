import type { CollectionConfig, Field } from 'payload'

/**
 * MC2-4 (ADR 0016 §11, wireframe mc/wireframes.md §4): the PT column + PT filter on the Payload list
 * view of EVERY collection that carries a top-level `company` relationship (the 30 per-PT
 * collections, memberships, and the PT-tagged notifications / audit logs). Applied once in
 * payload.config.ts, so a new per-PT collection gets it automatically (unit test guards the set):
 * - `company` first in `defaultColumns` (users with saved column preferences keep theirs);
 * - list cell = PT short-code chip (`CompanyCell`, full name in the tooltip);
 * - `beforeListTable` = PT chips (`CompanyListFilter`) that narrow the list WITHIN the switcher
 *   selection (`where[company][equals]`); rows stay filtered by access control either way.
 * Plain data (import-map paths); no React import — collection configs also load in the worker.
 */
export const COMPANY_CELL = '@/admin/components/companies/CompanyCell#CompanyCell'
export const COMPANY_LIST_FILTER = '@/admin/components/companies/CompanyListFilter#CompanyListFilter'

export function companyFieldOf(c: CollectionConfig): Field | undefined {
  return c.fields.find((f) => 'name' in f && f.name === 'company' && f.type === 'relationship' && f.relationTo === 'companies')
}

function withCell(f: Field): Field {
  if (f.type !== 'relationship') return f
  const admin = f.admin ?? {}
  if (admin.components?.Cell) return f
  return { ...f, admin: { ...admin, components: { ...admin.components, Cell: COMPANY_CELL } } } as Field
}

function asArray<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v]
}

export function withCompanyListUi(collections: CollectionConfig[]): CollectionConfig[] {
  return collections.map((c) => {
    const field = companyFieldOf(c)
    if (!field) return c
    const admin = c.admin ?? {}
    const cols = admin.defaultColumns
    const before = asArray(admin.components?.beforeListTable)
    return {
      ...c,
      fields: c.fields.map((f) => (f === field ? withCell(f) : f)),
      admin: {
        ...admin,
        ...(cols ? { defaultColumns: cols.includes('company') ? cols : ['company', ...cols] } : {}),
        components: {
          ...admin.components,
          beforeListTable: before.includes(COMPANY_LIST_FILTER) ? before : [...before, COMPANY_LIST_FILTER],
        },
      },
    }
  })
}
