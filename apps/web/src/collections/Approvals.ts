import type { Access, CollectionConfig, Where } from 'payload'

import { kasFigureRead, moneyRead } from '@/access/money'
import { denyAll } from '@/access/roles'
import { visibleAddendumIds } from '@/domain/addendum/access'
import { visibleLoanIds } from '@/domain/loans/access'
import { byVisibleRequest, denyDeleteLogged } from '@/domain/expense/access'
import { inIds } from '@/access/scope'
import { APPROVAL_DECISIONS, APPROVAL_POSITIONS } from '@/domain/expense/types'
import { companyField, companyHook } from '@/fields/company'
import { USER_NAME_VIEW } from '@/fields/users'
import { COMPANY_SIGNATURE_SOURCE } from '@/domain/direktur-rules'

const ro = { readOnly: true }
const budgetPctRead = moneyRead('approvals')
const fundRead = kasFigureRead('approvals')

/**
 * T2 Approval & tanda tangan (requirements v1.1 §7 T2, US-26/US-40…US-43, architecture G1/G2).
 * One row per signature position and decision. CLASS A (ADR 0006 §2): FLAT, append-only — no
 * UPDATE/DELETE/TRUNCATE for the app role, reject triggers, `decided_at` forced to the DB clock.
 * DB backstops (security migration): one decision per (request, cycle, position, level); one
 * decision position per person per cycle (G1); requester/creator can never hold a decision row.
 * Written only by the domain service (create access false).
 * E5 (T12): rows of budget addenda carry docType `budget_addendum` + `addendum` (no `request`); a DB
 * CHECK keeps exactly one owner per docType and the G1 trigger reads the addendum's creator.
 * QA-06 / ADR 0019: rows of an LPJ shortfall re-approval carry docType `expense_shortfall` + `settlement`
 * (no `request` — the request's own approval cycles stay untouched); G1 = requester/creator of the
 * settlement's request. Office roles read them through the `company` predicate of byVisibleRequest.
 * ADR 0022: rows of an inter-project loan carry docType `project_loan` + `loan` (one Direktur decision; G1 = the
 * loan's creator, except the recorded `direktur_self` case).
 * 2026-10-24 (DRMS 24/10 #10/#12): a loan has TWO levels (1 Direktur, 2 Owner); a repayment request of a cash-backed
 * loan carries docType `project_loan_repayment` + `loanRepayment` (same two levels, G1 = its submitter, no exception).
 * ADR 0025: a designated representative deciding a Direktur step signs with the PT's definitive Direktur signature
 * (`signatureSource = company`, `representedDirektur` snapshot, `actorName` = the Direktur); `actor` = the real user.
 */
const readAccess: Access = async (args) => {
  const { req } = args
  if (!req.user) return false
  // office roles: rows of their PTs (inside byVisibleRequest); others: visible requests / addenda
  const byRequest = await byVisibleRequest('request')(args)
  const byAddendum = inIds('addendum', await visibleAddendumIds(req))
  const loans = await visibleLoanIds(req)
  const byLoan = inIds('loan', loans) // ADR 0022: Direktur decisions on inter-project loans
  const byRepayment = inIds('loanRepayment.loan', loans) // 2026-10-24 (#12): decisions on repayment requests of those loans
  const or = [byRequest, byAddendum, byLoan, byRepayment].filter((w): w is Where => typeof w === 'object' && w !== null)
  if (byRequest === true) return true
  return or.length === 0 ? false : or.length === 1 ? or[0]! : { or }
}

export const Approvals: CollectionConfig = {
  slug: 'approvals',
  labels: { singular: 'Approval & tanda tangan', plural: 'Approval & tanda tangan' },
  admin: { group: 'Keuangan', defaultColumns: ['request', 'position', 'level', 'actorName', 'decision', 'decidedAt'] },
  access: { read: readAccess, create: denyAll, update: denyAll, delete: denyDeleteLogged('approval') },
  lockDocuments: false,
  hooks: { beforeChange: [companyHook('approvals', { derive: [{ field: 'request', collection: 'expense-requests' }, { field: 'addendum', collection: 'budget-addenda' }, { field: 'settlement', collection: 'settlements' }, { field: 'loan', collection: 'project-loans' }, { field: 'loanRepayment', collection: 'project-loan-repayments' }] })] },
  fields: [
    companyField({ derived: true }),
    { name: 'docType', type: 'select', required: true, defaultValue: 'expense_request', options: ['expense_request', 'budget_addendum', 'expense_shortfall', 'project_loan', 'project_loan_repayment'].map((v) => ({ label: v, value: v })), admin: ro },
    { name: 'request', type: 'relationship', relationTo: 'expense-requests', label: 'Pengajuan', index: true, admin: ro },
    { name: 'addendum', type: 'relationship', relationTo: 'budget-addenda', label: 'Addendum RAB', index: true, admin: ro },
    { name: 'settlement', type: 'relationship', relationTo: 'settlements', label: 'LPJ (persetujuan kekurangan)', index: true, admin: ro },
    { name: 'loan', type: 'relationship', relationTo: 'project-loans', label: 'Pinjaman antar project', index: true, admin: ro },
    { name: 'loanRepayment', type: 'relationship', relationTo: 'project-loan-repayments', label: 'Pengembalian pinjaman', index: true, admin: ro },
    { name: 'cycle', type: 'number', label: 'Siklus', required: true, admin: ro },
    { name: 'position', type: 'select', label: 'Posisi', required: true, options: APPROVAL_POSITIONS.map((v) => ({ label: v, value: v })), admin: ro },
    { name: 'level', type: 'number', label: 'Level', required: true, defaultValue: 0, admin: ro },
    // ADR 0025: on a decision signed as the PT's definitive Direktur the real user stays in the row (FK, G1, DB guards,
    // forensics: audit log user id) but is not displayed — the form shows the Direktur (`actorName`) only
    {
      name: 'actor',
      type: 'relationship',
      relationTo: 'users',
      label: 'User',
      index: true,
      admin: { ...ro, components: USER_NAME_VIEW, condition: (data) => (data as { signatureSource?: unknown } | undefined)?.signatureSource !== COMPANY_SIGNATURE_SOURCE },
    },
    { name: 'employee', type: 'relationship', relationTo: 'employees', label: 'Karyawan (Diajukan Oleh)', admin: ro },
    { name: 'actorName', type: 'text', label: 'Nama tampil', admin: ro },
    { name: 'onBehalf', type: 'checkbox', label: 'Diwakili pembuat (Q-10/Q-28)', defaultValue: false, admin: ro },
    { name: 'decision', type: 'select', label: 'Keputusan', required: true, options: APPROVAL_DECISIONS.map((v) => ({ label: v, value: v })), admin: ro },
    { name: 'reason', type: 'text', label: 'Alasan', admin: ro },
    { name: 'decidedAt', type: 'date', label: 'Waktu server', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
    // owner 2026-10-11: % of the RAB (with the request total it reveals the RAB) — money roles of the row's PT only
    { name: 'budgetPctBefore', type: 'number', label: '% anggaran sebelum', access: { read: budgetPctRead }, admin: ro },
    { name: 'budgetPctAfter', type: 'number', label: '% anggaran sesudah', access: { read: budgetPctRead }, admin: ro },
    { name: 'openFlags', type: 'number', label: 'Flag terbuka saat keputusan', admin: ro },
    // ADR 0029: the PT's available funds at a checked final decision (evidence; null without a fund check) — Kas roles only
    { name: 'fundBalance', type: 'number', label: 'Saldo dana PT saat disetujui', access: { read: fundRead }, admin: ro },
    { name: 'fundCommitments', type: 'number', label: 'Komitmen PT saat disetujui', access: { read: fundRead }, admin: ro },
    { name: 'fundAvailable', type: 'number', label: 'Dana tersedia saat disetujui', access: { read: fundRead }, admin: ro },
    { name: 'signature', type: 'upload', relationTo: 'media-signatures', label: 'Tanda tangan', admin: ro },
    { name: 'signatureSha256', type: 'text', label: 'SHA-256 tanda tangan', admin: ro },
    // ADR 0025: `company` = the PT's definitive Direktur signature, used by a designated representative on a Direktur step
    { name: 'signatureSource', type: 'select', label: 'Sumber tanda tangan', options: ['profile', 'captured', 'none', COMPANY_SIGNATURE_SOURCE].map((v) => ({ label: v, value: v })), admin: ro },
    {
      // ADR 0025: snapshot of the PT's definitive Direktur at decision time (signature = `signature` + `signatureSha256`);
      // never changes when the PT later edits its Direktur data (Class A row). DB: set ⇔ signatureSource = company.
      name: 'representedDirektur',
      type: 'group',
      label: 'Ditandatangani sebagai Direktur definitif PT',
      admin: { condition: (data) => (data as { signatureSource?: unknown } | undefined)?.signatureSource === COMPANY_SIGNATURE_SOURCE },
      fields: [
        { name: 'name', type: 'text', label: 'Nama Direktur', admin: ro },
        { name: 'title', type: 'text', label: 'Jabatan', admin: ro },
      ],
    },
    { name: 'deviceId', type: 'text', label: 'Perangkat', admin: ro },
    { name: 'source', type: 'select', label: 'Sumber', options: ['web', 'apk', 'system', 'job'].map((s) => ({ label: s, value: s })), admin: ro },
  ],
}
