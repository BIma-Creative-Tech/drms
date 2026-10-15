import type { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

import * as P from './schemas-partners'

type Helpers = {
  security: Array<Record<string, string[]>>
  res: (code: number, description: string, schema: z.ZodType, errors: number[]) => RouteConfig['responses']
}

/** DRMS 16/10 "Klien" / "Vendor" tabbed pages (one save each). Pure (bundled by scripts/gen-openapi.mjs). */
export function registerPartnerFormPaths(registry: OpenAPIRegistry, h: Helpers): void {
  const body = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } })
  const write = [400, 401, 403, 404, 409, 413, 429]
  const kinds = [
    {
      path: '/client-form',
      param: 'clientId',
      what: 'client',
      create: P.ClientFormCreate,
      update: P.ClientFormUpdate,
      detail: P.ClientFormDetail,
      result: P.ClientFormResult,
      parts: 'the client (Admin / Direktur of the PT) and its contact persons (Kontak PIC, the whole list)',
      read: 'the client, its contact persons, its PT, whether the caller may save, the client\'s projects the caller can read and whether the caller may create a project for it',
    },
    {
      path: '/vendor-form',
      param: 'vendorId',
      what: 'vendor',
      create: P.VendorFormCreate,
      update: P.VendorFormUpdate,
      detail: P.VendorFormDetail,
      result: P.VendorFormResult,
      parts:
        'the vendor (create Admin / Finance; edit Admin / Finance / Direktur of the PT), its contact persons (Kontak PIC, the whole list) and its bank accounts (Admin / Finance of the PT: create / update, never deleted; verification Admin / Finance; reason on number / holder / bank change and on deactivation), the accounts written after the vendor',
      read: 'the vendor, its contact persons, its bank accounts, its PT (with the bank-account right), whether the caller may save and the active banks',
    },
  ] as const
  for (const k of kinds) {
    const params = z.object({ [k.param]: z.string().regex(/^\d+$/) })
    registry.registerPath({
      method: 'get',
      path: k.path,
      summary: `Form data of a NEW ${k.what}: the PTs the caller may create it in (PT switcher selection)${k.what === 'vendor' ? ' and the active banks' : ''}. 403 when there is none`,
      security: h.security,
      responses: h.res(200, 'Detail', k.detail, [401, 403]),
    })
    registry.registerPath({
      method: 'get',
      path: `${k.path}/{${k.param}}`,
      summary: `Form data of one ${k.what}: ${k.read}. Unknown / unreadable / other PT → 404`,
      security: h.security,
      request: { params },
      responses: h.res(200, 'Detail', k.detail, [401, 404]),
    })
    registry.registerPath({
      method: 'post',
      path: k.path,
      summary: `Create ${k.parts} in ONE transaction (all-or-nothing). Collection rules apply unchanged (PT scoping ADR 0016, audit). Errors name the field: errors[].path = ${k.what}.* / contacts.<i>.* ${k.what === 'vendor' ? '/ bankAccounts.<j>.* ' : ''}/ reason`,
      security: h.security,
      request: { body: body(k.create) },
      responses: h.res(201, 'Created', k.result, write),
    })
    registry.registerPath({
      method: 'patch',
      path: `${k.path}/{${k.param}}`,
      summary: `Edit ${k.parts} in ONE transaction (only what is sent changes; contacts = the whole list). Deactivation needs a reason. Errors as for create`,
      security: h.security,
      request: { params, body: body(k.update) },
      responses: h.res(200, 'Saved', k.result, write),
    })
  }
}
