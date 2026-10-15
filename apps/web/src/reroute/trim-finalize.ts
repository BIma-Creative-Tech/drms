/**
 * d1510 in-flight trim, case 3 (owner decision 2026-10-15): a request whose only undecided level was Finance's, after
 * the Owner approved, becomes "Disetujui" through the SAME code as the last approval (`approve` in workflow.ts):
 * the ADR 0029 fund check of the final decision, then `finalizeApproved` (approved_at / approved_amount, status audit
 * row, Class A snapshot, RAP flags, notifications + Finance transfer queue via the status hook). Bound to the
 * migration's Payload `req` — `payload migrate` runs every migration in ONE transaction and hands the migration the
 * `req` of that transaction (@payloadcms/drizzle migrate.js), so these Local API calls join the trim's SQL.
 * No user on the req: audit source `system`; a refused fund check writes no detached audit row (writer.ts) — the
 * request is kept and listed by the migration instead.
 */
import type { PayloadRequest } from 'payload'

import { CodedError } from '@/domain/coded-error'
import { loadRaw } from '@/domain/expense/common'
import { finalizeApproved } from '@/domain/expense/receipts'
import { FUND_INSUFFICIENT } from '@/domain/fundcheck/rules'
import { checkFundsForApproval } from '@/domain/fundcheck/service'

import type { Finalizer } from './trim-db'

export function payloadFinalizer(req: PayloadRequest): Finalizer {
  return {
    async check(id) {
      const doc = await loadRaw(req, id)
      try {
        return { ok: true, fund: await checkFundsForApproval(req, doc, 'approve') }
      } catch (err) {
        if (err instanceof CodedError && err.pkCode === FUND_INSUFFICIENT) return { ok: false, reason: `cek dana (ADR 0029) menolak persetujuan akhir: ${err.message} — tetap menunggu, putuskan manual` }
        throw err
      }
    },
    async approve(id, reason) {
      const doc = await loadRaw(req, id)
      if (doc.status !== 'pending_approval') return doc.status
      try {
        return (await finalizeApproved(req, doc, reason)).status
      } finally {
        delete req.context.auditReason // the reason belongs to this request's rows only (shared migration req)
      }
    },
  }
}
