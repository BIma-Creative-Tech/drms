import type { Access, CollectionConfig, Where } from 'payload'

import { denyAll, hasRole } from '@/access/roles'
import { visibleAddendumIds } from '@/domain/addendum/access'
import { byVisibleRequest, denyDeleteLogged } from '@/domain/expense/access'
import { inIds } from '@/access/scope'
import { APPROVAL_DECISIONS, APPROVAL_POSITIONS } from '@/domain/expense/types'

const ro = { readOnly: true }

/**
 * T2 Approval & tanda tangan (requirements v1.1 §7 T2, US-26/US-40…US-43, architecture G1/G2).
 * One row per signature position and decision. CLASS A (ADR 0006 §2): FLAT, append-only — no
 * UPDATE/DELETE/TRUNCATE for the app role, reject triggers, `decided_at` forced to the DB clock.
 * DB backstops (security migration): one decision per (request, cycle, position, level); one
 * decision position per person per cycle (G1); requester/creator can never hold a decision row.
 * Written only by the domain service (create access false).
 * E5 (T12): rows of budget addenda carry docType `budget_addendum` + `addendum` (no `request`); a DB
 * CHECK keeps exactly one owner per docType and the G1 trigger reads the addendum's creator.
 */
const readAccess: Access = async (args) => {
  const { req } = args
  if (!req.user) return false
  if (hasRole(req, 'pk-finance', 'pk-owner', 'pk-admin')) return true
  const byRequest = await byVisibleRequest('request')(args)
  const byAddendum = inIds('addendum', await visibleAddendumIds(req))
  const or = [byRequest, byAddendum].filter((w): w is Where => typeof w === 'object' && w !== null)
  if (byRequest === true) return true
  return or.length === 0 ? false : or.length === 1 ? or[0]! : { or }
}

export const Approvals: CollectionConfig = {
  slug: 'approvals',
  labels: { singular: 'Approval & tanda tangan', plural: 'Approval & tanda tangan' },
  admin: { group: 'Keuangan', defaultColumns: ['request', 'position', 'level', 'actorName', 'decision', 'decidedAt'] },
  access: { read: readAccess, create: denyAll, update: denyAll, delete: denyDeleteLogged('approval') },
  lockDocuments: false,
  fields: [
    { name: 'docType', type: 'select', required: true, defaultValue: 'expense_request', options: ['expense_request', 'budget_addendum'].map((v) => ({ label: v, value: v })), admin: ro },
    { name: 'request', type: 'relationship', relationTo: 'expense-requests', label: 'Pengajuan', index: true, admin: ro },
    { name: 'addendum', type: 'relationship', relationTo: 'budget-addenda', label: 'Addendum RAB', index: true, admin: ro },
    { name: 'cycle', type: 'number', label: 'Siklus', required: true, admin: ro },
    { name: 'position', type: 'select', label: 'Posisi', required: true, options: APPROVAL_POSITIONS.map((v) => ({ label: v, value: v })), admin: ro },
    { name: 'level', type: 'number', label: 'Level', required: true, defaultValue: 0, admin: ro },
    { name: 'actor', type: 'relationship', relationTo: 'users', label: 'User', index: true, admin: ro },
    { name: 'employee', type: 'relationship', relationTo: 'employees', label: 'Karyawan (Diajukan Oleh)', admin: ro },
    { name: 'actorName', type: 'text', label: 'Nama tampil', admin: ro },
    { name: 'onBehalf', type: 'checkbox', label: 'Diwakili pembuat (Q-10/Q-28)', defaultValue: false, admin: ro },
    { name: 'decision', type: 'select', label: 'Keputusan', required: true, options: APPROVAL_DECISIONS.map((v) => ({ label: v, value: v })), admin: ro },
    { name: 'reason', type: 'text', label: 'Alasan', admin: ro },
    { name: 'decidedAt', type: 'date', label: 'Waktu server', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
    { name: 'budgetPctBefore', type: 'number', label: '% anggaran sebelum', admin: ro },
    { name: 'budgetPctAfter', type: 'number', label: '% anggaran sesudah', admin: ro },
    { name: 'openFlags', type: 'number', label: 'Flag terbuka saat keputusan', admin: ro },
    { name: 'signature', type: 'upload', relationTo: 'media-signatures', label: 'Tanda tangan', admin: ro },
    { name: 'signatureSha256', type: 'text', label: 'SHA-256 tanda tangan', admin: ro },
    { name: 'signatureSource', type: 'select', label: 'Sumber tanda tangan', options: ['profile', 'captured', 'none'].map((v) => ({ label: v, value: v })), admin: ro },
    { name: 'deviceId', type: 'text', label: 'Perangkat', admin: ro },
    { name: 'source', type: 'select', label: 'Sumber', options: ['web', 'apk', 'system', 'job'].map((s) => ({ label: s, value: s })), admin: ro },
  ],
}
