import { z } from 'zod'

/**
 * DRMS 16/10 — "Klien" / "Vendor" tabbed pages (owner 2026-10-16): ONE save of a client (detail + Kontak PIC) or a
 * vendor (detail + Kontak PIC + bank accounts).
 * `GET /client-form` (new) · `GET /client-form/{clientId}` · `POST /client-form` · `PATCH /client-form/{clientId}`, the
 * same four for `/vendor-form`. Pure module (bundled by scripts/gen-openapi.mjs). Messages are Indonesian (shown as-is
 * by the web form); required fields are checked by domain/partners/rules.ts so every message names the field.
 */
const id = z.number().int().positive()
const optText = (max: number, label: string) => z.string().trim().max(max, `${label} maksimal ${max} karakter.`)

export const PartnerContactInput = z
  .object({
    id: z.string().max(64).optional().meta({ description: 'Stored row id (keeps the row). Omitted = a new row.' }),
    name: optText(128, 'Nama kontak').optional().meta({ description: 'Required.' }),
    position: optText(128, 'Jabatan').nullable().optional(),
    phone: optText(32, 'No. HP').nullable().optional(),
    email: optText(254, 'Email').nullable().optional(),
    notes: optText(500, 'Catatan').nullable().optional(),
    isPrimary: z.boolean().optional().meta({ description: 'Primary contact ("Utama"). Exactly one per record: the first flagged row, none flagged = the first row. Its name / phone fill the single Kontak / No. HP columns.' }),
  })
  .strict()
  .meta({ id: 'PartnerContactInput' })

const contacts = z
  .array(PartnerContactInput)
  .max(20, 'Maksimal 20 kontak PIC.')
  .optional()
  .meta({ description: 'The WHOLE list of contact persons (replaces the stored rows; an empty list removes them). Omitted = unchanged.' })

const reason = z.string().trim().max(1000, 'Alasan maksimal 1000 karakter.').optional().meta({
  description: 'Change reason for the audit rows. Required (≥ 3 characters) when a collection rule asks for it: deactivating the record or a bank account, changing a bank account\'s number, holder or bank.',
})

const detailFields = {
  name: optText(160, 'Nama').optional(),
  address: optText(500, 'Alamat').nullable().optional(),
  active: z.boolean().optional().meta({ description: 'false = deactivate (reason required).' }),
}

const company = id.optional().meta({ description: 'Create only: the PT (must be selected in the PT switcher and allow the create). Omitted = the caller\'s only such PT.' })

export const ClientDetailInput = z.object({ company, ...detailFields }).strict()
export const VendorDetailInput = z.object({ company, ...detailFields, npwp: optText(32, 'NPWP').nullable().optional() }).strict()

export const VendorBankAccountInput = z
  .object({
    id: id.optional().meta({ description: 'Existing account of THIS vendor (update). Omitted = new account (bank, accountNo, accountHolder required).' }),
    bank: id.optional(),
    accountNo: optText(40, 'Nomor rekening').optional().meta({ description: 'Digits only after removing spaces, dots and dashes (5–34).' }),
    accountHolder: optText(128, 'Atas nama').optional(),
    isDefault: z.boolean().optional(),
    verificationStatus: z.enum(['unverified', 'verified']).optional().meta({ description: 'Admin / Finance only (collection field access).' }),
    active: z.boolean().optional(),
  })
  .strict()
  .meta({ id: 'VendorBankAccountInput' })

export const ClientFormCreate = z.object({ client: ClientDetailInput, contacts, reason }).strict().meta({ id: 'ClientFormCreate' })
export const ClientFormUpdate = z
  .object({ client: ClientDetailInput.omit({ company: true }).strict().optional().meta({ description: 'Only the fields to change.' }), contacts, reason })
  .strict()
  .meta({ id: 'ClientFormUpdate' })

const bankAccounts = z
  .array(VendorBankAccountInput)
  .max(20, 'Maksimal 20 rekening per simpan.')
  .optional()
  .meta({ description: 'Bank accounts of THIS vendor, written after the vendor (a new vendor gets them). Rows omitted = unchanged; never deleted — deactivate instead. Admin / Finance of the vendor\'s PT.' })

export const VendorFormCreate = z.object({ vendor: VendorDetailInput, contacts, bankAccounts, reason }).strict().meta({ id: 'VendorFormCreate' })
export const VendorFormUpdate = z
  .object({ vendor: VendorDetailInput.omit({ company: true }).strict().optional().meta({ description: 'Only the fields to change.' }), contacts, bankAccounts, reason })
  .strict()
  .meta({ id: 'VendorFormUpdate' })

const Contact = z.object({ id: z.string(), name: z.string(), position: z.string().nullable(), phone: z.string().nullable(), email: z.string().nullable(), notes: z.string().nullable(), isPrimary: z.boolean() })

const Company = z.object({
  id,
  shortCode: z.string(),
  name: z.string(),
  canManageBankAccounts: z.boolean().meta({ description: 'Admin / Finance role in this PT (vendor bank accounts + their verification).' }),
})

const partner = {
  id,
  company: id.nullable(),
  name: z.string(),
  address: z.string().nullable(),
  odooPartnerRef: z.string().nullable().meta({ description: 'Filled by the Odoo sync (read-only here).' }),
  active: z.boolean(),
  contacts: z.array(Contact),
}

const canEdit = z.boolean().meta({ description: 'May the caller save the form (create: always true — the PTs listed allow it; edit: the collection update rule for this record).' })
const companies = z.array(Company).meta({ description: 'Create: the PTs the caller may create in (PT switcher selection). Edit: the record\'s PT.' })

export const ClientFormDetail = z
  .object({
    client: z.object(partner).nullable(),
    companies,
    canEdit,
    projects: z.array(z.object({ id, code: z.string().nullable(), name: z.string(), status: z.string().nullable() })).meta({ description: 'Projects of this client the caller can read.' }),
    canCreateProject: z.boolean().meta({ description: 'Project create rule in the client\'s PT (Direktur / Admin / PM) — "+ Proyek baru" opens /admin/collections/projects/create?client=<id>.' }),
  })
  .meta({ id: 'ClientFormDetail' })

export const VendorFormDetail = z
  .object({
    vendor: z.object({ ...partner, npwp: z.string().nullable() }).nullable(),
    companies,
    canEdit,
    bankAccounts: z.array(
      z.object({
        id,
        bank: id.nullable(),
        bankName: z.string().nullable(),
        accountNo: z.string(),
        accountHolder: z.string(),
        isDefault: z.boolean(),
        verificationStatus: z.enum(['unverified', 'verified']),
        active: z.boolean(),
      }),
    ),
    banks: z.array(z.object({ id, name: z.string() })),
  })
  .meta({ id: 'VendorFormDetail' })

export const ClientFormResult = z.object({ id, created: z.boolean(), detail: ClientFormDetail }).meta({ id: 'ClientFormResult' })
export const VendorFormResult = z.object({ id, created: z.boolean(), detail: VendorFormDetail }).meta({ id: 'VendorFormResult' })

export type ClientFormCreateBody = z.infer<typeof ClientFormCreate>
export type ClientFormUpdateBody = z.infer<typeof ClientFormUpdate>
export type VendorFormCreateBody = z.infer<typeof VendorFormCreate>
export type VendorFormUpdateBody = z.infer<typeof VendorFormUpdate>
