import type { PayloadRequest } from 'payload'

import { loadClientForm, loadVendorForm, PartnerFormError, saveClientForm, saveVendorForm, type ClientFormInput, type SaveResult, type VendorFormInput } from '@/domain/partners/service'
import { withReqTransaction } from '@/lib/system-tx'

import { HttpError, json, v1 } from '../http'
import { ClientFormCreate, ClientFormUpdate, VendorFormCreate, VendorFormUpdate } from '../schemas-partners'

/**
 * DRMS 16/10 — "Klien" / "Vendor" tabbed pages (owner 2026-10-16): load + save a client (detail + Kontak PIC) or a
 * vendor (detail + Kontak PIC + bank accounts) in ONE DB transaction (all-or-nothing: a refused row rolls back the
 * whole save). Access = the collections' own rules, evaluated with the caller (domain/partners/service.ts); a refused
 * save answers RFC 9457 with `errors[].path` = body paths (`client.*` / `vendor.*`, `contacts.<i>.*`,
 * `bankAccounts.<j>.*`, `reason`). Web only (no Idempotency-Key): a retried create makes a second record.
 */
function idParam(raw: string | undefined, what: string): number {
  if (!/^[1-9]\d{0,9}$/.test(raw ?? '')) throw new HttpError(404, 'Not Found', { detail: `${what} tidak ditemukan.` })
  return Number(raw)
}

function toHttp(err: unknown): never {
  if (err instanceof PartnerFormError) {
    const title = err.status === 403 ? 'Forbidden' : err.status === 404 ? 'Not Found' : err.status === 409 ? 'Conflict' : 'Bad Request'
    throw new HttpError(err.status, title, { detail: err.detail, ...(err.errors.length ? { errors: err.errors } : {}) })
  }
  throw err
}

async function inTx(req: PayloadRequest, fn: () => Promise<SaveResult>): Promise<SaveResult> {
  try {
    return await withReqTransaction(req, fn)
  } catch (err) {
    return toHttp(err)
  }
}

const WRITE = { rateLimit: [30, 60_000] as [number, number], maxBodyBytes: 128 * 1024 }

export const clientFormNewEndpoint = v1({
  path: '/client-form',
  method: 'get',
  handler: async ({ req }) => json(await loadClientForm(req, null).catch(toHttp)),
})

export const clientFormGetEndpoint = v1({
  path: '/client-form/:clientId',
  method: 'get',
  handler: async ({ req, params }) => json(await loadClientForm(req, idParam(params.clientId, 'Klien')).catch(toHttp)),
})

export const clientFormCreateEndpoint = v1({
  path: '/client-form',
  method: 'post',
  body: ClientFormCreate,
  ...WRITE,
  handler: async ({ req, body }) => {
    const r = await inTx(req, () => saveClientForm(req, body as ClientFormInput, null))
    return json({ ...r, detail: await loadClientForm(req, r.id) }, 201)
  },
})

export const clientFormUpdateEndpoint = v1({
  path: '/client-form/:clientId',
  method: 'patch',
  body: ClientFormUpdate,
  ...WRITE,
  handler: async ({ req, body, params }) => {
    const id = idParam(params.clientId, 'Klien')
    const r = await inTx(req, () => saveClientForm(req, body as ClientFormInput, id))
    return json({ ...r, detail: await loadClientForm(req, r.id) })
  },
})

export const vendorFormNewEndpoint = v1({
  path: '/vendor-form',
  method: 'get',
  handler: async ({ req }) => json(await loadVendorForm(req, null).catch(toHttp)),
})

export const vendorFormGetEndpoint = v1({
  path: '/vendor-form/:vendorId',
  method: 'get',
  handler: async ({ req, params }) => json(await loadVendorForm(req, idParam(params.vendorId, 'Vendor')).catch(toHttp)),
})

export const vendorFormCreateEndpoint = v1({
  path: '/vendor-form',
  method: 'post',
  body: VendorFormCreate,
  ...WRITE,
  handler: async ({ req, body }) => {
    const r = await inTx(req, () => saveVendorForm(req, body as VendorFormInput, null))
    return json({ ...r, detail: await loadVendorForm(req, r.id) }, 201)
  },
})

export const vendorFormUpdateEndpoint = v1({
  path: '/vendor-form/:vendorId',
  method: 'patch',
  body: VendorFormUpdate,
  ...WRITE,
  handler: async ({ req, body, params }) => {
    const id = idParam(params.vendorId, 'Vendor')
    const r = await inTx(req, () => saveVendorForm(req, body as VendorFormInput, id))
    return json({ ...r, detail: await loadVendorForm(req, r.id) })
  },
})

export const PARTNER_FORM_ENDPOINTS = [
  clientFormNewEndpoint,
  clientFormGetEndpoint,
  clientFormCreateEndpoint,
  clientFormUpdateEndpoint,
  vendorFormNewEndpoint,
  vendorFormGetEndpoint,
  vendorFormCreateEndpoint,
  vendorFormUpdateEndpoint,
]
