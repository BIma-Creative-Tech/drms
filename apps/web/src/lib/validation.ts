import { ValidationError, type PayloadRequest } from 'payload'

import { fieldLabel } from './field-labels'

type FieldError = { path: string; message: string; label?: string }

/** Label of a top-level field of a collection/global config (string labels only), else the shared map. */
function configLabel(req: PayloadRequest, where: { collection?: string; global?: string }, path: string): string | undefined {
  const top = path.split('.')[0] ?? path
  const collections = req.payload?.collections as Record<string, { config?: { flattenedFields?: unknown } } | undefined> | undefined
  const fields = where.collection
    ? collections?.[where.collection]?.config?.flattenedFields
    : where.global
      ? req.payload?.globals?.config?.find((g) => g.slug === where.global)?.flattenedFields
      : undefined
  const f = (fields as Array<{ name: string; label?: unknown }> | undefined)?.find((x) => x.name === top)
  if (typeof f?.label === 'string' && top === path) return f.label
  return fieldLabel(path) ?? (typeof f?.label === 'string' ? f.label : undefined)
}

/**
 * QA-21: a Payload ValidationError in the user's language — `req.t` gives "Isian berikut tidak
 * valid" instead of the English default ("The following field is invalid"), and every error carries
 * the field LABEL so the toast names "Alasan perubahan", not `changeReason`. The field error itself
 * keeps its `path` (the admin form marks that input).
 */
export function validationError(req: PayloadRequest, where: { collection?: string; global?: string }, errors: FieldError[]): ValidationError {
  const labelled = errors.map((e) => ({ ...e, label: e.label ?? configLabel(req, where, e.path) ?? e.path }))
  return new ValidationError({ ...where, errors: labelled, req }, req.t)
}
