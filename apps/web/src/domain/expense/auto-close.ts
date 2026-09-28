import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import { withSystemTransaction } from '@/lib/system-tx'
import { getRequestTx } from '@/lib/tx'

import { activeCompanyIds } from '@/domain/companies'

import { lockRequest, loadRaw, settings, today, updateRequest } from './common'
import { addDays } from './types'

/**
 * Reimburse "Ditransfer" → "Selesai" automatically N days after the (latest posted) transfer
 * (architecture §5.2 "requester confirms receipt OR auto after N days (setting)";
 * company-settings.reimburseAutoCloseDays, default 30). Run daily by the worker (jobs/tasks.ts,
 * process TZ Asia/Makassar). Each request closes in its own transaction with a row lock and a
 * status re-check (idempotent; a concurrent manual "complete" wins). Audit source = `job`, reason
 * states the rule. Returns the closed request ids.
 * MC2 (ADR 0016 §7): one pass per ACTIVE PT with that PT's `reimburseAutoCloseDays` (or `companyId`
 * only); a failing PT is logged, the others continue.
 */
export async function autoCloseReimburse(payload: Payload, opts: { companyId?: number } = {}): Promise<number[]> {
  const ids = opts.companyId !== undefined ? [opts.companyId] : await activeCompanyIds(payload)
  const closed: number[] = []
  for (const cid of ids) {
    try {
      closed.push(...(await autoCloseCompany(payload, cid)))
    } catch (err) {
      payload.logger.error({ msg: 'reimburse auto-close failed for a PT', companyId: cid, err: (err as Error).message })
    }
  }
  return closed
}

async function autoCloseCompany(payload: Payload, companyId: number): Promise<number[]> {
  const candidates = await withSystemTransaction(
    payload,
    null,
    async (req) => {
      const s = await settings(req, companyId)
      const days = s.reimburseAutoCloseDays ?? 30
      const cutoff = addDays(await today(req, companyId), -days)
      const tx = await getRequestTx(req)
      const r = (await tx.execute(sql`
        SELECT e.id FROM expense_requests e
        WHERE e.type = 'reimburse' AND e.status = 'transferred' AND e.company_id = ${companyId}
          AND (SELECT max(t.transfer_date) FROM transfers t WHERE t.request_id = e.id AND t.status = 'posted') <= ${cutoff}
        ORDER BY e.id`)) as unknown as { rows: Array<{ id: number }> }
      return { ids: r.rows.map((x) => Number(x.id)), days }
    },
    { auditSource: 'job' },
  )
  const closed: number[] = []
  for (const id of candidates.ids) {
    try {
      const ok = await withSystemTransaction(
        payload,
        null,
        async (req) => {
          await lockRequest(req, id)
          const doc = await loadRaw(req, id)
          if (doc.type !== 'reimburse' || doc.status !== 'transferred') return false
          await updateRequest(req, id, { status: 'completed' }, `otomatis selesai ${candidates.days} hari setelah transfer (setting reimburseAutoCloseDays)`)
          return true
        },
        { auditSource: 'job' },
      )
      if (ok) closed.push(id)
    } catch (err) {
      payload.logger.error({ msg: 'reimburse auto-close failed', requestId: id, err: (err as Error).message })
    }
  }
  return closed
}
