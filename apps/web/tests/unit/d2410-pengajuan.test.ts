import { describe, expect, it } from 'vitest'

import { filterTicks, filterValue, multiSummary, tickState } from '@/admin/components/list/MultiSelect'
import { actionBarProps } from '@/admin/components/request/action-bar'
import { buildPkListConfig } from '@/admin/pk-list/config'
import { parsePkQuery, pkWhere, type VirtualWheres } from '@/admin/pk-list/query'
import { AUDIT_ACTIONS } from '@/audit/writer'
import { SELF_PROCESSED_NOTE, selfProcessedAudit } from '@/domain/expense/common'
import { REIMBURSE_ATTACHMENT_MESSAGE } from '@/domain/expense/drafts'
import { FINANCE_SELF_PROCESSED } from '@/domain/expense/state'
import { PENDING_OWNER, splitStatusFilter, withPendingOwner } from '@/domain/expense/status-filter'
import { OWNER_WAITING_LABEL, REQUEST_STATUSES, STATUS_LABELS } from '@/domain/expense/types'
import { ACTION_LABELS, historyEntry } from '@/domain/history-format'
import type { HistoryRow } from '@/domain/history'
import { migrations } from '@/migrations'

/**
 * D2410 (client feedback 24/10, stream "pengajuan"): Lampiran wajib untuk Reimburse (point 6), filter "Semua" = semua
 * dicentang (point 7), status filter "Menunggu persetujuan Owner" (point 8), "Batalkan" hanya di tahap Finance (point
 * 13; state machine in expense-flow.test.ts) and Finance processing the LPJ / receipts of its own request (audited).
 */

describe('point 7: filter "Semua" = every option ticked', () => {
  const opts = [
    { value: 'a', label: 'Pengajuan Baru' },
    { value: 'r', label: 'Reimburse' },
    { value: 'v', label: 'Pembayaran vendor' },
  ]
  it('no filter opens with every option ticked; ticking all (or none) applies as no filter', () => {
    expect(filterTicks(opts, [])).toEqual(['a', 'r', 'v'])
    expect(filterTicks(opts, ['r'])).toEqual(['r'])
    expect(filterValue(opts, ['a', 'r', 'v'])).toEqual([])
    expect(filterValue(opts, ['v', 'a', 'r'])).toEqual([])
    expect(filterValue(opts, [])).toEqual([])
    // unticking one from "all" keeps the others, in option order
    expect(filterValue(opts, ['v', 'a'])).toEqual(['a', 'v'])
  })
  it('tri-state of the "Semua" box; the button reads "Semua" for all / none', () => {
    expect(tickState(opts, ['a', 'r', 'v'])).toBe('all')
    expect(tickState(opts, ['r'])).toBe('some')
    expect(tickState(opts, [])).toBe('none')
    expect(multiSummary(opts, [])).toBe('Semua')
    expect(multiSummary(opts, ['a', 'r', 'v'])).toBe('Semua')
    expect(multiSummary(opts, ['a', 'r'])).toBe('2 dipilih')
  })
})

describe('point 8: "Menunggu persetujuan Owner" status filter', () => {
  it('the virtual option sits right after "Menunggu persetujuan Direktur"; split into plain + the two waiting halves', () => {
    const base = REQUEST_STATUSES.map((s) => ({ value: s as string, label: STATUS_LABELS[s] }))
    const opts = withPendingOwner(base, (o) => ({ value: o.value, label: o.label }))
    const i = opts.findIndex((o) => o.value === 'pending_approval')
    expect(opts[i]!.label).toBe('Menunggu persetujuan Direktur')
    expect(opts[i + 1]).toEqual({ value: PENDING_OWNER, label: OWNER_WAITING_LABEL })
    expect(opts).toHaveLength(base.length + 1)
    expect(withPendingOwner(opts, (o) => ({ value: o.value, label: o.label }))).toHaveLength(opts.length) // idempotent
    expect(splitStatusFilter(['draft', 'pending_approval', PENDING_OWNER])).toEqual({ plain: ['draft'], direktur: true, owner: true })
    expect(splitStatusFilter(['approved'])).toEqual({ plain: ['approved'], direktur: false, owner: false })
  })
  it('pk-list: the Pengajuan Biaya status filter offers it; resolved values replace the plain match', () => {
    const cfg = buildPkListConfig({
      slug: 'expense-requests',
      fields: [{ name: 'status', type: 'select', options: REQUEST_STATUSES.map((s) => ({ label: STATUS_LABELS[s], value: s })) }],
      admin: { defaultColumns: ['status'] },
    } as never)
    const status = cfg.filters.find((f) => f.name === 'status')!
    expect(status.kind === 'select' && status.options.map((o) => o.value)).toContain(PENDING_OWNER)
    const q = parsePkQuery({ 'f.status': `approved,${PENDING_OWNER}` }, cfg)
    expect(q.filters.status).toEqual(['approved', PENDING_OWNER])
    const virtual: VirtualWheres = { status: { [PENDING_OWNER]: { id: { in: [7, 9] } }, pending_approval: { and: [{ status: { equals: 'pending_approval' } }, { id: { not_in: [7, 9] } }] } } }
    expect(pkWhere(q, cfg, { selected: null, virtual })).toEqual({ and: [{ or: [{ status: { in: ['approved'] } }, { id: { in: [7, 9] } }] }] })
    expect(pkWhere(parsePkQuery({ 'f.status': 'pending_approval' }, cfg), cfg, { selected: null, virtual })).toEqual({ and: [virtual.status!.pending_approval] })
    expect(pkWhere(parsePkQuery({ 'f.status': 'draft' }, cfg), cfg, { selected: null, virtual })).toEqual({ and: [{ status: { in: ['draft'] } }] })
    // another collection never gets it
    const other = buildPkListConfig({ slug: 'budget-addenda', fields: [{ name: 'status', type: 'select', options: [{ label: 'x', value: 'pending_approval' }] }], admin: {} } as never)
    expect(other.filters[0]!.kind === 'select' && other.filters[0]!.options.map((o) => o.value)).toEqual(['pending_approval'])
  })
})

describe('point 6 + 13: attachment rule text, one "Batalkan" button', () => {
  it('the Reimburse attachment message (web, APK and API share it)', () => {
    expect(REIMBURSE_ATTACHMENT_MESSAGE).toBe('Lampiran wajib untuk Reimburse: unggah minimal 1 lampiran (foto/PDF).')
  })
  it('the action bar carries "Batalkan pengajuan" whenever the server allows cancel — also for a Finance requester', () => {
    const d = { id: 3, type: 'advance', docNo: 'PB/1', status: 'approved', allowedActions: ['transfer', 'cancel'] } as never
    expect(actionBarProps({ d, office: true, own: true, canDuplicate: true, decision: null }).canCancel).toBe(true)
  })
})

describe('Finance self LPJ / receipts: audited self_processed', () => {
  it('audit action + history label "diproses oleh pemohon sendiri"; migration enum then guard drop', () => {
    expect(AUDIT_ACTIONS).toContain('self_processed')
    expect(ACTION_LABELS.self_processed).toBe('diproses oleh pemohon sendiri')
    const names = migrations.map((m) => m.name)
    expect(names.indexOf('20261024_300100_d2410_finance_self_lpj')).toBe(names.indexOf('20261024_300000_d2410_self_processed_enum') + 1)
    expect([...FINANCE_SELF_PROCESSED].sort()).toEqual(['lpj_request_revision', 'lpj_verify', 'receipt_reject', 'receipt_verify', 'review_flag', 'settle', 'settle_reverse', 'verify_receipts'])
  })
  it('the audit row records the action, the status and requester / creator', () => {
    const row = selfProcessedAudit({ status: 'lpj_submitted', isCreator: false, isRequester: true }, 'lpj_verify', { id: 12, docNo: 'PB/12' })
    expect(row).toEqual({
      action: 'self_processed',
      docType: 'expense_request',
      docId: '12',
      docNo: 'PB/12',
      field: 'lpj_verify',
      newValue: { action: 'lpj_verify', status: 'lpj_submitted', selfProcessed: true, asRequester: true, asCreator: false },
      reason: SELF_PROCESSED_NOTE,
    })
    const h: HistoryRow = { id: 1, serverTime: '2026-10-24T01:00:00.000Z', docType: 'expense_request', docId: '12', docNo: 'PB/12', action: 'self_processed', field: 'lpj_verify', lineNo: null, oldValue: null, newValue: row.newValue, statusFrom: null, statusTo: null, reason: row.reason, userId: 5, userName: 'Fina', userRoles: null, source: 'web', appVersion: null, deviceId: null }
    expect(historyEntry(h, 'Asia/Makassar')).toMatchObject({ action: 'diproses oleh pemohon sendiri', reason: SELF_PROCESSED_NOTE })
  })
})
