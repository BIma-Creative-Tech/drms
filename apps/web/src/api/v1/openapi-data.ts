import type { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

import * as D from './schemas-data'
import * as K from './schemas-keuangan'

type Helpers = {
  security: Array<Record<string, string[]>>
  deviceHeader: z.ZodObject
  idem: z.ZodObject
  res: (code: number, description: string, schema: z.ZodType, errors: number[]) => RouteConfig['responses']
}

const jsonBody = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } })

/** User 2026-10-19 (APK ↔ web parity, phase 5): the generic edit form of the Proyek collections. Pure (gen-openapi). */
export function registerDataFormPaths(registry: OpenAPIRegistry, h: Helpers): void {
  const collection = z.object({
    collection: z.string().meta({ description: 'Writable slug (cost-centers, team-assignments, project-stages, stage-templates, resource-types, service-types, budget-lines, rap-templates, contract-units); other → 404.' }),
  })
  registry.registerPath({
    method: 'get',
    path: '/data/{collection}/form',
    summary: 'The web admin edit form of a writable collection: editable fields with the caller\'s field-level access (Payload docAccess), current values (with `id`) or defaults, and the audit reason rules.',
    security: h.security,
    request: { headers: h.deviceHeader, params: collection, query: z.object({ id: z.string().regex(/^\d+$/).optional() }) },
    responses: h.res(200, 'Form', D.DataForm, [401, 404, 426, 429]),
  })
  registry.registerPath({
    method: 'get',
    path: '/data/{collection}/options',
    summary: 'Picker of one relationship field of the form: the target collection with the caller\'s access and the field\'s filterOptions (form state = the stored doc of `id`, overlaid by `data[<key>]=` parameters), search on its title, 30 rows.',
    security: h.security,
    request: { headers: h.deviceHeader, params: collection, query: z.object({ field: z.string(), q: z.string().max(60).optional(), id: z.string().regex(/^\d+$/).optional() }) },
    responses: h.res(200, 'Options', D.DataOptions, [401, 404, 426, 429]),
  })
  registry.registerPath({
    method: 'post',
    path: '/data/{collection}',
    summary: 'Create through the collection (payload.create as the caller: access, hooks, validation, audit as the web form). Unknown / read-only keys → 400.',
    security: h.security,
    request: { headers: h.idem, params: collection, body: jsonBody(D.DataWriteBody) },
    responses: h.res(201, 'Created (the detail)', K.DataDetail, [400, 401, 403, 404, 409, 422, 426, 429]),
  })
  registry.registerPath({
    method: 'patch',
    path: '/data/{collection}/{id}',
    summary: 'Update through the collection (payload.update as the caller). A required audit reason missing → 400 at path changeReason.',
    security: h.security,
    request: { headers: h.idem, params: collection.extend({ id: z.string().regex(/^\d+$/) }), body: jsonBody(D.DataWriteBody) },
    responses: h.res(200, 'Updated (the detail)', K.DataDetail, [400, 401, 403, 404, 409, 422, 426, 429]),
  })
}
