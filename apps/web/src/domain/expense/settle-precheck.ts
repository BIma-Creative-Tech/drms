import type { PayloadRequest } from 'payload'

import { relId } from '@/access/roles'

import { actorContext, fail, loadRaw, loadVisible, requireAction } from './common'
import { settlementOf, type SettlementType } from './settlement-rules'

/** The system cash-in source of the LPJ refund (seed/data.ts, company-defaults.ts SYSTEM_CASH_IN_SOURCES). */
export const LPJ_SOURCE_CODE = 'LPJ'
export const LPJ_SOURCE_MISSING = 'Sumber kas masuk "Pengembalian LPJ" (kode LPJ) belum ada di master.'

/** Id of PT `companyId`'s "Pengembalian LPJ" cash-in source, or null. */
export async function lpjRefundSource(req: PayloadRequest, companyId: number | undefined): Promise<number | null> {
  if (companyId === undefined) return null
  const res = await req.payload.find({
    collection: 'cash-in-sources',
    where: { and: [{ company: { equals: companyId } }, { code: { equals: LPJ_SOURCE_CODE } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true, // SYSTEM-READ: master "Pengembalian LPJ" of the request's PT (existence only)
    req,
  })
  return (res.docs[0] as { id: number } | undefined)?.id ?? null
}

export type SettlePrecheck = { ready: true; settlementType: SettlementType; amount: number }

/**
 * QA-11: GET …/settle/precheck — the settlement's configuration checks BEFORE the client uploads the
 * proof file (the admin form uploaded first, so a 409 at settle left an orphan media row). Read-only,
 * nothing is written; the same rules are enforced again by POST …/settle:
 * - caller may settle this request now (403 / 409 like settle; not audited — nothing was attempted);
 * - refund (surplus): the PT's cash-in source "Pengembalian LPJ" (code LPJ) exists → else 409;
 * - shortfall: the request carries the bank snapshot of the transfer → else 409.
 */
export async function settlePrecheck(req: PayloadRequest, id: number): Promise<SettlePrecheck> {
  const doc = await loadVisible(req, id)
  requireAction(await actorContext(req, doc), 'settle')
  const res = await req.payload.find({
    collection: 'settlements',
    where: { request: { equals: id } },
    limit: 1,
    depth: 0,
    overrideAccess: true, // SYSTEM-READ: LPJ of a request the caller may settle (checked above)
    req,
  })
  const s = res.docs[0] as unknown as { status: string; transferredTotal?: number | null; verifiedReceiptsTotal?: number | null } | undefined
  if (!s) fail(409, 'LPJ belum dibuat untuk pengajuan ini.')
  if (s.status !== 'verified') fail(409, `LPJ berstatus ${s.status}; aksi tidak dapat dilakukan.`)
  const st = settlementOf(s.transferredTotal ?? 0, s.verifiedReceiptsTotal ?? 0)
  const raw = await loadRaw(req, id)
  if (st.type === 'refund' && (await lpjRefundSource(req, relId((raw as { company?: unknown }).company))) === null) {
    fail(409, `${LPJ_SOURCE_MISSING} Minta Admin/Finance menambahkannya di Master → Sumber kas masuk sebelum mencatat pengembalian.`)
  }
  if (st.type === 'shortfall' && !raw.bankSnapshot?.accountNo) fail(409, 'Rekening tujuan belum tersimpan pada pengajuan.')
  return { ready: true, settlementType: st.type, amount: st.amount }
}
