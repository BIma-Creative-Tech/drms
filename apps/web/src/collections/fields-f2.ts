import type { Field } from 'payload'

import { isBusinessDate } from '@/domain/expense/types'

/**
 * Business date (company TZ, no time) stored as text `YYYY-MM-DD` (+ DB CHECK in the F2a security
 * migration): TZ-free comparisons in SQL (period lock) and in the flag rules.
 * DRMS 10/10 8c (WA-01): edited with the date picker (BusinessDateField) — same column, no migration.
 */
export const BUSINESS_DATE_FIELD = '@/admin/components/BusinessDateField#BusinessDateField'

export function businessDateField(name: string, label: string, extra: Record<string, unknown> = {}): Field {
  const admin = (extra.admin ?? {}) as { components?: Record<string, unknown> }
  return {
    name,
    type: 'text',
    label,
    maxLength: 10,
    validate: (v: unknown) => (v === null || v === undefined || v === '' || isBusinessDate(v) ? true : 'Tanggal harus YYYY-MM-DD.'),
    ...extra,
    admin: { ...admin, components: { Field: BUSINESS_DATE_FIELD, ...(admin.components ?? {}) } },
  } as Field
}

export const SOURCE_OPTIONS = ['web', 'apk', 'system', 'job'].map((s) => ({ label: s, value: s }))
export const ro = { readOnly: true }
