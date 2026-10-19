import { docAccessOperationGlobal, type GlobalSlug, type PayloadRequest } from 'payload'

import { CHANGE_REASON } from '@/fields/common'

import { HttpError, json, v1 } from '../http'
import { DataWriteBody } from '../schemas-data'
import { collectionAllowed, dataOfFields, formFieldsOf, reasonRulesOf, type Perms } from './data-forms'
import { display, has, labelText, leaves, pick, tzOf, type Doc } from './data-lists'

/**
 * User 2026-10-19 (APK ↔ web parity, phase 7): the web edit form of a Payload GLOBAL ("Pengaturan › Setting
 * aplikasi"), with the same field / permission logic as the collection forms (data-forms.ts):
 * - GET   /data-globals/{slug}       — every readable field as display text;
 * - GET   /data-globals/{slug}/form  — the editable fields (docAccessOperationGlobal = the admin form), values;
 * - PATCH /data-globals/{slug}       — payload.updateGlobal AS THE CALLER (overrideAccess: false): access, validation,
 *   hooks and the global audit (withGlobalAudit) as on the web.
 * company-settings is app-wide (ADR 0016 §1: identity + operational settings are per PT on `companies`): read by every
 * role, updated by the group admin only — the global's own access.
 */
export const DATA_GLOBALS = ['company-settings'] as const

const READ_LIMIT: [number, number] = [60, 60_000]
const WRITE_LIMIT: [number, number] = [30, 60_000]

function globalOf(req: PayloadRequest, slug: string | undefined) {
  if (!slug || !(DATA_GLOBALS as readonly string[]).includes(slug)) throw new HttpError(404, 'Not Found', { detail: 'Pengaturan ini tidak tersedia di aplikasi.' })
  const g = req.payload.globals.config.find((x) => x.slug === slug)
  if (!g) throw new HttpError(404, 'Not Found')
  return g
}

async function readGlobal(req: PayloadRequest, slug: string): Promise<Doc> {
  return (await req.payload
    .findGlobal({ slug: slug as GlobalSlug, depth: 1, user: req.user, overrideAccess: false, req })
    .catch(() => {
      throw new HttpError(403, 'Forbidden', { detail: 'Anda tidak dapat melihat pengaturan ini.' })
    })) as unknown as Doc
}

async function detailOfGlobal(req: PayloadRequest, cfg: ReturnType<typeof globalOf>) {
  const doc = await readGlobal(req, cfg.slug)
  const tz = await tzOf(req)
  const label = labelText(cfg.label, cfg.slug)
  return {
    global: cfg.slug,
    label,
    title: label,
    fields: leaves(cfg.fields)
      .filter((l) => has(doc, l.key) && l.key !== CHANGE_REASON)
      .map((l) => ({ key: l.key, label: l.label, value: display(req, l.field, pick(doc, l.key), tz) })),
  }
}

export const dataGlobalDetailEndpoint = v1({
  path: '/data-globals/:slug',
  method: 'get',
  rateLimit: READ_LIMIT,
  handler: async ({ req, params }) => json(await detailOfGlobal(req, globalOf(req, params.slug))),
})

export const dataGlobalFormEndpoint = v1({
  path: '/data-globals/:slug/form',
  method: 'get',
  rateLimit: READ_LIMIT,
  handler: async ({ req, params }) => {
    const cfg = globalOf(req, params.slug)
    const doc = await readGlobal(req, cfg.slug)
    const perms = (await docAccessOperationGlobal({ globalConfig: cfg, req })) as Perms
    const { fields, skipped } = await formFieldsOf(req, cfg.fields, doc, perms, 'update')
    const rules = reasonRulesOf(cfg)
    const label = labelText(cfg.label, cfg.slug)
    return json({
      global: cfg.slug,
      label,
      canUpdate: collectionAllowed(perms, 'update'),
      reason: { onUpdate: rules.some((r) => Boolean(r({ operation: 'update', data: {}, original: {} }))) },
      fields,
      skipped,
    })
  },
})

export const dataGlobalUpdateEndpoint = v1({
  path: '/data-globals/:slug',
  method: 'patch',
  body: DataWriteBody,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => {
    const cfg = globalOf(req, params.slug)
    const perms = (await docAccessOperationGlobal({ globalConfig: cfg, req })) as Perms
    if (!collectionAllowed(perms, 'update')) throw new HttpError(403, 'Forbidden', { detail: 'Anda tidak dapat mengubah pengaturan ini.' })
    const data = dataOfFields(cfg.fields, perms, body.data, 'update')
    if (body.reason) data[CHANGE_REASON] = body.reason
    await req.payload.updateGlobal({ slug: cfg.slug as GlobalSlug, data: data as never, user: req.user, overrideAccess: false, req, depth: 0 })
    return json(await detailOfGlobal(req, cfg))
  },
})

/** `/form` before `/:slug` (same path depth would not clash, kept explicit). */
export const DATA_GLOBAL_ENDPOINTS = [dataGlobalFormEndpoint, dataGlobalDetailEndpoint, dataGlobalUpdateEndpoint]
