import type { RelationshipField } from 'payload'

/**
 * DRMS 16/10 (owner 2026-10-16, "konsep no. 1" part b): a "+" beside a relationship picker creates the missing record
 * in a side drawer without leaving the form, and the picker then holds the new record.
 * - Klien / Vendor → the tabbed form of the partner pages (PartnerFormLoader: detail + Kontak PIC + Proyek / Rekening,
 *   one save), with the parent form's PT preselected;
 * - every other target (Karyawan) → Payload's document drawer of the collection with `initialData: { company }` — for
 *   Karyawan the plain employee form, which creates no user account (accounts: Pengguna).
 * Payload's own "+" (`admin.allowCreate`, on by default, no PT carried over) is switched off on these fields.
 * Pure data + functions (collection configs load in the worker: no React here); the client component is
 * admin/components/relationship/CreatableRelationshipField.tsx. The drawer forms and the server re-check everything.
 */

export const CREATABLE_RELATIONSHIP_FIELD = '@/admin/components/relationship/CreatableRelationshipField#CreatableRelationshipField'

export type CreateTarget = { slug: string; noun: string; drawer: 'partner'; partnerKind: 'client' | 'vendor' } | { slug: string; noun: string; drawer: 'document' }

/** Collections a picker may create into (target slug → drawer). */
export const CREATE_TARGETS: Readonly<Record<string, CreateTarget>> = {
  clients: { slug: 'clients', noun: 'Klien', drawer: 'partner', partnerKind: 'client' },
  vendors: { slug: 'vendors', noun: 'Vendor', drawer: 'partner', partnerKind: 'vendor' },
  employees: { slug: 'employees', noun: 'Karyawan', drawer: 'document' },
}

export function createTargetOf(relationTo: unknown): CreateTarget | null {
  return typeof relationTo === 'string' ? (CREATE_TARGETS[relationTo] ?? null) : null
}

/**
 * Where the new record's PT comes from:
 * - `form`: the form's own `company` field (it is chosen in the form) — the "+" waits for it ("Pilih PT terlebih
 *   dahulu") and the drawer starts in that PT; `lock` additionally locks the picker itself (CompanyScopedField, the
 *   expense-request pickers);
 * - `record`: the form's PT is DERIVED from this very picker (rekening / penugasan of a vendor / karyawan) — the drawer
 *   asks for the PT itself.
 */
export type CreatableOptions = { company: 'form' | 'record'; lock?: boolean }

/** clientProps key of the field component (kept short: it travels in the client config). */
export const CREATE_PROP = 'pkCreate'

/**
 * A relationship field with the drawer "+" — Payload's own "+" off, our Field component with its options. Keeps every
 * other admin option (placeholder, condition, description, …).
 */
export function creatableRelationship<T extends RelationshipField>(field: T, opts: CreatableOptions): T {
  if (typeof field.relationTo !== 'string' || !CREATE_TARGETS[field.relationTo]) throw new Error(`creatableRelationship: no create target for ${String(field.relationTo)}`)
  return {
    ...field,
    admin: {
      ...field.admin,
      allowCreate: false,
      components: { ...field.admin?.components, Field: { path: CREATABLE_RELATIONSHIP_FIELD, clientProps: { [CREATE_PROP]: opts } } },
    },
  } as T
}

/** Relationship value → id (number, numeric string, `{ value }`, `{ id }`), else null. */
export function relationId(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v)
  if (v && typeof v === 'object' && 'value' in v) return relationId((v as { value: unknown }).value)
  if (v && typeof v === 'object' && 'id' in v) return relationId((v as { id: unknown }).id)
  return null
}

export type CreateButtonState = 'hidden' | 'needs-company' | 'ready'

/**
 * The "+": hidden without the create permission or on a read-only field; waits for the form's PT in `form` mode;
 * otherwise ready.
 */
export function createButtonState(args: { canCreate: boolean; readOnly: boolean; mode: CreatableOptions['company']; company: number | null }): CreateButtonState {
  if (!args.canCreate || args.readOnly) return 'hidden'
  if (args.mode === 'form' && args.company === null) return 'needs-company'
  return 'ready'
}

/** Field value after the drawer saved record `id`: the id (single) or appended once (hasMany, ids kept as stored). */
export function valueWithCreated(current: unknown, id: number, hasMany: boolean): number | unknown[] {
  if (!hasMany) return id
  const list = Array.isArray(current) ? current : current === null || current === undefined || current === '' ? [] : [current]
  return list.some((v) => relationId(v) === id) ? list : [...list, id]
}

/** Start data of the drawer form: the form's PT in `form` mode, nothing otherwise. */
export function drawerInitialData(mode: CreatableOptions['company'], company: number | null): { company: number } | undefined {
  return mode === 'form' && company !== null ? { company } : undefined
}

export const NEEDS_COMPANY_TEXT = 'Pilih PT terlebih dahulu'
