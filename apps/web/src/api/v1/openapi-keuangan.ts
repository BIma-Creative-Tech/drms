import type { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

import * as K from './schemas-keuangan'

type Helpers = {
  security: Array<Record<string, string[]>>
  deviceHeader: z.ZodObject
  res: (code: number, description: string, schema: z.ZodType, errors: number[]) => RouteConfig['responses']
}

const ids = z.string().regex(/^\d+(,\d+)*$/).optional()

/** User 2026-10-19 (APK ↔ web parity, phase 3): read models of the web Keuangan pages. Pure (bundled by scripts/gen-openapi.mjs). */
export function registerKeuanganPaths(registry: OpenAPIRegistry, h: Helpers): void {
  registry.registerPath({
    method: 'get',
    path: '/kas/book',
    summary:
      'Finance / Direktur (pk-owner): the web "Buku kas" page — balance tiles, lookups of the shown PTs, lock date per PT and one page of the ledger (newest business date first) with the edit / void rights of the caller per row. Query = the web query string; invalid values are dropped. Actions: POST /cash-entries, PATCH /cash-entries/{id}, POST /cash-entries/{id}/void.',
    security: h.security,
    request: {
      headers: h.deviceHeader,
      query: z.object({
        akun: ids,
        periode: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        project: ids,
        pusat: ids,
        arah: z.string().optional().meta({ description: 'masuk,keluar' }),
        status: z.string().optional().meta({ description: 'posted,void' }),
        sumber: z.string().optional().meta({ description: 'transfer,settlement_refund,manual,reversal,opening,intercompany' }),
        pt: z.string().regex(/^\d+$/).optional().meta({ description: 'One Kas PT (a PT without Kas rights is ignored).' }),
        site: z.string().regex(/^\d+$/).optional(),
        q: z.string().max(100).optional(),
        per: z.enum(['20', '50', '100']).optional(),
        hal: z.string().regex(/^\d+$/).optional(),
      }),
    },
    responses: h.res(200, 'Buku kas', K.KasBook, [401, 403, 426, 429]),
  })
  registry.registerPath({
    method: 'get',
    path: '/kas/periods',
    summary:
      'Finance / Direktur (pk-owner): the web "Tutup buku" page of ONE PT — 13 recent months with their sums and close / re-open rights, and the history. Without `company` and several Kas PTs: `company` null + `pts` (pick one). Actions: POST /period-closings, POST /period-closings/{period}/reopen?company=.',
    security: h.security,
    request: { headers: h.deviceHeader, query: z.object({ company: z.string().regex(/^\d+$/).optional() }) },
    responses: h.res(200, 'Tutup buku', K.KasPeriods, [400, 401, 403, 426, 429]),
  })
  registry.registerPath({
    method: 'get',
    path: '/transfers/voidable',
    summary:
      'Finance / Direktur (pk-owner): recorded transfers that can still be voided (request "Sudah Ditransfer"), web Antrian Transfer › Transfer tercatat. Void: POST /expense-requests/{id}/transfers/{tid}/void (Finance of the request PT).',
    security: h.security,
    request: {
      headers: h.deviceHeader,
      query: z.object({ q: z.string().max(100).optional(), pt: ids, jenis: z.string().optional().meta({ description: 'advance,reimburse' }), page: z.string().regex(/^\d+$/).optional(), per: z.enum(['20', '50', '100']).optional() }),
    },
    responses: h.res(200, 'Transfers', K.VoidableTransferList, [401, 403, 426, 429]),
  })
  const collection = z.object({ collection: z.string().meta({ description: 'Whitelisted collection slug (receipts, transfers, settlements, expense-line-snapshots, receipt-flags, period-closings, project-loan-repayments, cash-entries, cash-accounts, cash-in-sources); other → 404.' }) })
  registry.registerPath({
    method: 'get',
    path: '/data/{collection}',
    summary: 'Read-only web collection list ("Data …" menu items): the default columns of the web list as display text, with the web list\'s access (collection + field level, PT selection).',
    security: h.security,
    request: { headers: h.deviceHeader, params: collection, query: z.object({ q: z.string().max(100).optional(), page: z.string().regex(/^\d+$/).optional(), limit: z.string().regex(/^\d+$/).optional().meta({ description: '1–50, default 20' }) }) },
    responses: h.res(200, 'Page', K.DataList, [401, 404, 426, 429]),
  })
  registry.registerPath({
    method: 'get',
    path: '/data/{collection}/{id}',
    summary: 'Read-only detail of one document of a whitelisted collection: every readable field as display text.',
    security: h.security,
    request: { headers: h.deviceHeader, params: collection.extend({ id: z.string().regex(/^\d+$/) }) },
    responses: h.res(200, 'Document', K.DataDetail, [401, 404, 426, 429]),
  })
}
