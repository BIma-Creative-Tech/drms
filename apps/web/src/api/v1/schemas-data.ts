import { z } from 'zod'

/**
 * User 2026-10-19 (APK ↔ web parity, phase 5): the generic edit form of the Proyek collections (endpoints/data-forms.ts).
 * Pure zod (bundled by scripts/gen-openapi.mjs).
 */
export const DataWriteBody = z
  .object({
    data: z.record(z.string().max(64), z.unknown()).meta({ description: 'Field key (dot path for groups) → value; only the editable keys of GET /data/{collection}/form.' }),
    reason: z.string().trim().max(1000).optional().meta({ description: 'Audit reason (required by the collection rules — see `reason` of the form).' }),
  })
  .strict()
  .meta({ id: 'DataWriteBody' })

const FormField = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'textarea', 'email', 'number', 'money', 'date', 'datetime', 'checkbox', 'select', 'multiselect', 'relationship', 'relationships']).meta({ description: 'date = YYYY-MM-DD; datetime = ISO; money = integer rupiah.' }),
  required: z.boolean(),
  readOnly: z.boolean().meta({ description: 'admin.readOnly or no field-level create / update access for the caller.' }),
  maxLength: z.number().int().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  help: z.string().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  relationTo: z.string().optional().meta({ description: 'Picker: GET /data/{collection}/options?field=<key>.' }),
  value: z.unknown().meta({ description: 'Current value (relationships: id / ids); create: the default.' }),
  valueLabel: z.union([z.string(), z.array(z.string())]).nullable().optional(),
})

export const DataForm = z
  .object({
    collection: z.string(),
    label: z.string(),
    id: z.number().int().nullable(),
    title: z.string().nullable(),
    canCreate: z.boolean(),
    canUpdate: z.boolean(),
    canDelete: z.boolean().meta({ description: 'Soft delete exists for the collection — check GET /records/{collection}/{id}/delete-check first.' }),
    supported: z.boolean().meta({ description: 'false = a required field the APK cannot edit (create only) — use the web.' }),
    reason: z.object({ onUpdate: z.boolean(), onDeactivate: z.boolean() }).meta({ description: 'When the audit hooks require `reason`; other rules (changing protected fields) answer 400 at path changeReason.' }),
    fields: z.array(FormField),
    skipped: z.array(z.string()).meta({ description: 'Field keys edited on the web only (arrays, uploads, conditional fields, …).' }),
  })
  .meta({ id: 'DataForm' })

export const DataOptions = z.object({ items: z.array(z.object({ id: z.union([z.number(), z.string()]), label: z.string() })) }).meta({ id: 'DataOptions' })
