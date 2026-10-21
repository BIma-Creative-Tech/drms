import { APIError, type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'

import { denyAll, hasRoleAny, relId } from '@/access/roles'
import { byRole, fieldRoles, rolesAllowed } from '@/access/policies'
import { reasonOnChange, reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, rupiahField, uuidField } from '@/fields/common'

import { businessDateField } from './fields-f2'
import { companyField, companyHook, lockedUntilCompany, pickerSameCompany, siteOptions } from '@/fields/company'
import { validationError } from '@/lib/validation'

/**
 * S3b / E11 (ADR 0005 "As implemented (S3b)"): the opening balance is final once a period on or after
 * its date is closed — `openingBalance` and `openingBalanceDate` are then locked (correction = manual
 * cash entry). Accounts without `openingBalanceDate` keep the F2 rule (change with reason). Mirrors
 * the DB trigger pk_cash_accounts_opening_lock (migration s3b_data_import) with a readable message.
 */
const openingBalanceLock: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  if (operation !== 'update' || !originalDoc?.openingBalanceDate) return data
  const changed = (['openingBalance', 'openingBalanceDate'] as const).some((f) => f in data && (data[f] ?? null) !== (originalDoc[f] ?? null))
  if (!changed) return data
  const month = String(originalDoc.openingBalanceDate).slice(0, 7)
  // ADR 0016 §4: closings are per PT — only a closing of the ACCOUNT's PT locks it (same as the DB trigger)
  const company = relId((originalDoc as { company?: unknown }).company)
  const closed = await req.payload.find({
    collection: 'period-closings',
    where: { and: [{ status: { equals: 'closed' } }, { period: { greater_than_equal: month } }, ...(company !== undefined ? [{ company: { equals: company } }] : [])] },
    limit: 1,
    depth: 0,
    pagination: false,
    overrideAccess: true, // SYSTEM-READ: lock check
    req,
  })
  const period = (closed.docs[0] as { period?: string } | undefined)?.period
  if (period) {
    throw new APIError(
      `Saldo awal terkunci: periode ${period} sudah ditutup. Koreksi saldo lewat kas masuk/keluar manual (dengan alasan).`,
      409,
      { errors: [{ path: 'openingBalance', message: 'Saldo awal terkunci setelah tutup buku.' }] },
      true,
    )
  }
  return data
}

/**
 * ADR 0028 "Rekening penerimaan antar-PT": the designated account of the PT that receives payments from the other PTs
 * of the group (the automatic Kas Masuk is posted on it). Only an ACTIVE BANK account with bank, number and holder; at
 * most one per PT (DB: CHECK cash_accounts_ic_receiving + partial unique index cash_accounts_ic_receiving_uq). A
 * deactivated account loses the designation (the PT is then no longer offered as payee until another one is set).
 */
const intercompanyReceivingRules: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  const d = data as Record<string, unknown>
  const prev = (originalDoc ?? {}) as Record<string, unknown>
  const pick = (k: string) => (k in d ? d[k] : prev[k])
  if (pick('active') === false && pick('intercompanyReceiving') === true) {
    d.intercompanyReceiving = false // deactivated → no longer the receiving account (audited with the deactivation reason)
    return data
  }
  if (pick('intercompanyReceiving') !== true) return data
  const errors: Array<{ path: string; message: string }> = []
  if (pick('kind') !== 'bank') errors.push({ path: 'intercompanyReceiving', message: 'Rekening penerimaan antar-PT harus akun jenis Bank.' })
  if (relId(pick('bank')) === undefined || !String(pick('accountNo') ?? '').trim() || !String(pick('accountHolder') ?? '').trim()) {
    errors.push({ path: 'intercompanyReceiving', message: 'Lengkapi bank, nomor rekening dan atas nama sebelum menetapkan rekening penerimaan antar-PT.' })
  }
  const company = relId(pick('company'))
  if (errors.length === 0 && company !== undefined) {
    const other = await req.payload.find({
      collection: 'cash-accounts',
      where: { and: [{ company: { equals: company } }, { intercompanyReceiving: { equals: true } }, { active: { not_equals: false } }, ...(operation === 'update' && prev.id !== undefined ? [{ id: { not_equals: prev.id as number } }] : [])] },
      limit: 1,
      depth: 0,
      overrideAccess: true, // SYSTEM-READ: one designated account per PT (DB unique index is the final guard)
      req,
    })
    const o = other.docs[0] as { name?: string } | undefined
    if (o) errors.push({ path: 'intercompanyReceiving', message: `PT ini sudah punya rekening penerimaan antar-PT (${o.name ?? 'akun lain'}). Lepas tanda di akun itu dulu.` })
  }
  if (errors.length > 0) throw validationError(req, { collection: 'cash-accounts' }, errors)
  return data
}

/** ADR 0031: bank details, opening balance and Kas settings — the Kas roles of the account's PT only (not the PM). */
const kasDetails = { read: fieldRoles('pk-admin', 'pk-finance', 'pk-owner') }

/**
 * Akun kas/bank perusahaan. Finance C/R/U, Owner R/U, Admin C/R/U (requirements §4 "Master data").
 * ADR 0031 (DRMS 21/10): an account is also a project's "Pusat biaya" — the PM reads the ACTIVE accounts of his PT
 * (name / kind / site only, `kasDetails`) to map his project; balances stay behind the Kas endpoints (Finance / Direktur).
 */
export const CashAccounts: CollectionConfig = withAudit(
  {
    slug: 'cash-accounts',
    labels: { singular: 'Akun kas/bank', plural: 'Akun kas/bank' },
    admin: {
      useAsTitle: 'name',
      group: 'Keuangan',
      defaultColumns: ['name', 'kind', 'accountNo', 'site', 'intercompanyReceiving', 'active'],
      // ADR 0031: the PM reads accounts only as the project's Pusat Biaya picker — no menu entry
      hidden: ({ user }) => !hasRoleAny({ user } as never, 'pk-admin', 'pk-finance', 'pk-owner'),
    },
    hooks: { beforeChange: [companyHook('cash-accounts', { check: [{ field: 'site', collection: 'sites' }] }), openingBalanceLock, intercompanyReceivingRules] },
    access: {
      read: byRole({ 'pk-admin': true, 'pk-finance': true, 'pk-owner': true, 'pk-pm': () => ({ active: { not_equals: false } }) }),
      create: rolesAllowed('pk-admin', 'pk-finance'),
      update: byRole({ 'pk-admin': true, 'pk-finance': true, 'pk-owner': true }),
      delete: denyAll,
    },
    fields: [
      companyField(),
      { name: 'name', type: 'text', label: 'Nama akun', required: true, index: true, maxLength: 128 },
      {
        name: 'kind',
        type: 'select',
        label: 'Jenis',
        required: true,
        defaultValue: 'bank',
        options: [
          { label: 'Kas', value: 'cash' },
          { label: 'Bank', value: 'bank' },
        ],
      },
      { name: 'bank', type: 'relationship', relationTo: 'banks', label: 'Bank', access: kasDetails },
      { name: 'accountNo', type: 'text', label: 'Nomor rekening', maxLength: 34, access: kasDetails },
      { name: 'accountHolder', type: 'text', label: 'Atas nama', maxLength: 128, access: kasDetails },
      { ...rupiahField('openingBalance', 'Saldo awal (Rp)'), access: kasDetails },
      businessDateField('openingBalanceDate', 'Tanggal saldo awal', {
        access: kasDetails,
        admin: {
          description:
            'Tanggal go-live akun ini. Transaksi kas sebelum tanggal ini ditolak; saldo awal terkunci setelah periode sejak tanggal ini ditutup. Kosong = tanpa kunci.',
        },
      }),
      // ADR 0023 (Q-S7): petty cash of a branch office — filter of the cash book / K-01 balances and the per-site balance
      // on the dashboards. Cash rules are unchanged (still a PT account).
      lockedUntilCompany({
        name: 'site',
        type: 'relationship',
        relationTo: 'sites',
        label: 'Site',
        index: true,
        ...pickerSameCompany(),
        filterOptions: siteOptions,
        admin: { placeholder: 'Pilih site…', description: 'Opsional: kas kecil / rekening kantor cabang ini (saldo per site di dashboard).' },
      }),
      {
        // ADR 0028: payments from the other PTs of the group arrive here (automatic Kas Masuk "Antar PT")
        name: 'intercompanyReceiving',
        type: 'checkbox',
        label: 'Rekening penerimaan antar-PT',
        defaultValue: false,
        access: kasDetails,
        admin: {
          description: 'Tandai satu rekening bank aktif per PT. PT lain di grup hanya dapat membayar PT ini (Pengajuan "PT grup") bila rekening ini ditetapkan; kas masuknya tercatat otomatis di sini.',
          components: { Cell: '@/admin/components/IntercompanyReceivingCell#IntercompanyReceivingCell' },
        },
      },
      { name: 'odooJournalCode', type: 'text', label: 'Kode jurnal Odoo', maxLength: 16, access: kasDetails },
      activeField(),
      uuidField(),
    ],
  },
  {
    docType: 'cash_account',
    reasonRules: [
      reasonOnDeactivate,
      reasonOnChange(['openingBalance', 'openingBalanceDate'], 'Alasan wajib diisi saat mengubah saldo awal.'),
      // ADR 0028: (un)designating the intercompany receiving account changes where other PTs' payments arrive
      reasonOnChange(['intercompanyReceiving'], 'Alasan wajib diisi saat mengubah rekening penerimaan antar-PT.'),
    ],
  },
)
