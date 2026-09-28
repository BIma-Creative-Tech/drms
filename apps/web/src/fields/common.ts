import { randomUUID } from 'node:crypto'

import type { CheckboxField, NumberField, TextField } from 'payload'

export const CHANGE_REASON = 'changeReason'

/**
 * Virtual (not stored) "reason" input shown in the admin form; consumed by the audit hooks
 * (src/audit/hooks.ts) and written to `audit_logs.reason`. `admin.readOnly: false` is required
 * because Payload makes virtual fields read-only by default (fields/config/sanitize.js @3.90.1).
 */
export function changeReasonField(): TextField {
  return {
    name: CHANGE_REASON,
    type: 'text',
    virtual: true,
    label: 'Alasan perubahan',
    maxLength: 1000,
    admin: {
      readOnly: false,
      position: 'sidebar',
      description: 'Wajib saat menonaktifkan data atau mengubah data yang dilindungi. Dicatat di audit log.',
    },
  }
}

/**
 * Stable identity for the Odoo mirror (architecture §4.1, ADR 0009): server-generated at create,
 * immutable (field access + DB trigger pk_protect_columns).
 */
export function uuidField(): TextField {
  return {
    name: 'uuid',
    type: 'text',
    unique: true,
    index: true,
    access: { update: () => false },
    admin: { readOnly: true, position: 'sidebar', hidden: true },
    hooks: {
      beforeValidate: [({ operation, value }) => (operation === 'create' ? randomUUID() : value)],
    },
  }
}

export function activeField(): CheckboxField {
  return {
    name: 'active',
    type: 'checkbox',
    label: 'Aktif',
    defaultValue: true,
    index: true,
    admin: { position: 'sidebar' },
  }
}

/**
 * `code` of a master. Shared masters (banks, UoM): globally unique. Per-PT masters pass
 * `{ perCompany: true }`: unique per (company_id, code) through a raw-SQL index of migration
 * `*_mc1_company_columns` (ADR 0016 §4) — two PTs may use the same code.
 */
export function codeField(label = 'Kode', maxLength = 32, opts: { perCompany?: boolean } = {}): TextField {
  return {
    name: 'code',
    type: 'text',
    label,
    required: true,
    unique: !opts.perCompany,
    index: true,
    maxLength,
    validate: (v: unknown) =>
      typeof v === 'string' && /^[A-Za-z0-9._/-]{1,64}$/.test(v) ? true : 'Kode hanya huruf, angka, titik, garis bawah, garis miring atau minus.',
  }
}

/** Integer Rupiah (architecture §4.1): Postgres numeric ↔ JS number, must be a safe integer ≥ 0. */
export function rupiahField(name: string, label: string, opts: { required?: boolean } = {}): NumberField {
  return {
    name,
    type: 'number',
    label,
    required: opts.required,
    min: 0,
    validate: (v: unknown) =>
      v === null || v === undefined || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0)
        ? true
        : 'Nominal harus bilangan bulat Rupiah ≥ 0.',
  }
}

export function percentField(name: string, label: string): NumberField {
  return {
    name,
    type: 'number',
    label,
    min: 0,
    max: 100,
    validate: (v: unknown) =>
      v === null || v === undefined || (typeof v === 'number' && v >= 0 && v <= 100) ? true : 'Persen 0–100.',
  }
}

export function odooRefField(name: string, label: string): TextField {
  return {
    name,
    type: 'text',
    label,
    maxLength: 128,
    admin: { position: 'sidebar', description: 'Referensi Odoo (diisi saat mirror, ADR 0009).' },
  }
}
