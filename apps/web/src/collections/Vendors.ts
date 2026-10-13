import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { byRole, rolesAllowed } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, odooRefField, uuidField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'

/**
 * Vendor (opsional; duplikat nota). Admin/Finance C/R/U, Owner R/U, PM R.
 * ADR 0025 (DRMS 13/10 Wave 4): tab "Rekening" lists the vendor's bank accounts (`vendor-bank-accounts`, join — no
 * column) — the destination of a vendor payment ("Pembayaran vendor"). Unnamed tabs: no schema change.
 */
export const Vendors: CollectionConfig = withAudit(
  {
    slug: 'vendors',
    labels: { singular: 'Vendor', plural: 'Vendor' },
    admin: { useAsTitle: 'name', group: 'Master Data', defaultColumns: ['name', 'contact', 'npwp', 'active'] },
    access: {
      read: byRole({ 'pk-admin': true, 'pk-owner': true, 'pk-finance': true, 'pk-pm': true }),
      create: rolesAllowed('pk-admin', 'pk-finance'),
      update: byRole({ 'pk-admin': true, 'pk-finance': true, 'pk-owner': true }),
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('vendors')] },
    fields: [
      // PT stays a top-level field (PT column / chip / filter of the list wrappers, ADR 0016)
      companyField(),
      {
        type: 'tabs',
        tabs: [
          {
            label: 'Vendor',
            fields: [
              { name: 'name', type: 'text', label: 'Nama', required: true, maxLength: 160 },
              { name: 'contact', type: 'text', label: 'Kontak', maxLength: 128 },
              {
                name: 'npwp',
                type: 'text',
                label: 'NPWP',
                maxLength: 32,
                validate: (v: unknown) =>
                  v === null || v === undefined || v === '' || (typeof v === 'string' && /^[0-9.\-]{15,20}$/.test(v))
                    ? true
                    : 'NPWP hanya angka, titik dan minus (15–20 karakter).',
              },
              { name: 'address', type: 'textarea', label: 'Alamat', maxLength: 500 },
              odooRefField('odooPartnerRef', 'Ref. partner Odoo'),
              activeField(),
              uuidField(),
            ],
          },
          {
            label: 'Rekening',
            description: 'Rekening tujuan pembayaran vendor. Tambah / ubah rekening di sini atau di Master Data → Rekening vendor; verifikasi oleh Finance / Admin.',
            fields: [
              {
                name: 'bankAccounts',
                type: 'join',
                collection: 'vendor-bank-accounts',
                on: 'vendor',
                label: 'Rekening vendor',
                defaultSort: '-isDefault',
                admin: { defaultColumns: ['bank', 'accountNo', 'accountHolder', 'isDefault', 'verificationStatus', 'active'] },
              },
            ],
          },
        ],
      },
    ],
  },
  { docType: 'vendor', reasonRules: [reasonOnDeactivate] },
)
