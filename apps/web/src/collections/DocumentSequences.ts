import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { byRole, rolesAllowed } from '@/access/policies'
import { reasonOnAnyUpdate, withAudit } from '@/audit/hooks'
import { DOC_TYPES, patternError, type ResetPolicy } from '@/domain/numbering'
import { activeField } from '@/fields/common'
import { DEFAULT_TZ, isValidTimeZone } from '@/lib/time'
import { companyField, companyHook } from '@/fields/company'

/**
 * Penomoran dokumen (ADR 0007): one active sequence per document type. Counter state lives in
 * `document_sequence_counters` (not a collection; DB trigger: next_value only increases).
 * Admin C/R/U (every change with reason, audited old → new); Finance/Owner R.
 * `startAt` only seeds a period's counter the first time it is used.
 */
export const DocumentSequences: CollectionConfig = withAudit(
  {
    slug: 'document-sequences',
    labels: { singular: 'Penomoran dokumen', plural: 'Penomoran dokumen' },
    admin: { useAsTitle: 'docType', group: 'Sistem', defaultColumns: ['docType', 'pattern', 'resetPolicy', 'startAt', 'active'] },
    access: {
      read: byRole({ 'pk-admin': true, 'pk-finance': true, 'pk-owner': true }),
      create: rolesAllowed('pk-admin'),
      update: byRole({ 'pk-admin': true }),
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('document-sequences')] },
    fields: [
      companyField(),
      {
        name: 'docType',
        type: 'select',
        label: 'Jenis dokumen',
        required: true,
        index: true, // unique per (company_id, doc_type) — raw index, ADR 0016 §4
        options: DOC_TYPES.map((d) => ({ label: d, value: d })),
        access: { update: () => false },
      },
      { name: 'docCode', type: 'text', label: 'Kode dokumen', required: true, maxLength: 8, admin: { description: 'Token {DOC}, mis. PB, TRF.' } },
      {
        name: 'pattern',
        type: 'text',
        label: 'Pola',
        required: true,
        maxLength: 64,
        admin: { description: 'Token: {seq} {DD} {MM} {MM_ROMAN} {YY} {YYYY} {COMPANY} {DOC}' },
        validate: (v: unknown, { siblingData }: { siblingData: Record<string, unknown> }) => {
          if (typeof v !== 'string') return 'Pola wajib diisi.'
          return patternError(v, (siblingData.resetPolicy ?? 'never') as ResetPolicy) ?? true
        },
      },
      {
        name: 'resetPolicy',
        type: 'select',
        label: 'Reset nomor',
        required: true,
        defaultValue: 'monthly',
        options: [
          { label: 'Tidak pernah', value: 'never' },
          { label: 'Tahunan', value: 'yearly' },
          { label: 'Bulanan', value: 'monthly' },
        ],
      },
      { name: 'padding', type: 'number', label: 'Panjang nomor (0 = tanpa nol di depan)', min: 0, max: 8, defaultValue: 4, required: true },
      { name: 'startAt', type: 'number', label: 'Nomor awal', min: 1, defaultValue: 1, required: true },
      {
        name: 'timezone',
        type: 'text',
        label: 'Zona waktu',
        defaultValue: DEFAULT_TZ,
        required: true,
        validate: (v: unknown) => (typeof v === 'string' && isValidTimeZone(v) ? true : 'Zona waktu IANA tidak valid.'),
      },
      activeField(),
    ],
  },
  { docType: 'document_sequence', reasonRules: [reasonOnAnyUpdate] },
)
