import type { RelationshipField } from 'payload'

import { ACTIVE_ONLY, andCompany, lockedUntilCompany, pickerSameCompany } from './company'

/**
 * ADR 0031 (DRMS 21/10): "Pusat Biaya" IS a cash / bank account of the same PT (the `cost-centers` master is retired).
 * Label used everywhere a document names its Pusat Biaya (project, vehicle, request detail, transfer, reports).
 */
export const PUSAT_BIAYA_LABEL = 'Pusat biaya (akun kas)'

/** Message of a transfer / disbursement refused because the project has no Pusat Biaya yet. */
export const PROJECT_WITHOUT_PB = 'Project ini belum dipetakan ke Pusat Biaya (akun kas). Minta Direktur, Admin, atau PM project memilih Pusat Biaya di data project.'

/**
 * Picker of a Pusat Biaya: ACTIVE cash accounts of the document's PT (an inactive one stays when stored), disabled until
 * the PT is known. Same-PT is enforced by the collection's `companyHook` check + DB trigger `pk_same_company`.
 */
export function pusatBiayaField(field: Omit<RelationshipField, 'type' | 'relationTo' | 'hasMany'> & { name: string }): RelationshipField {
  return lockedUntilCompany({
    label: PUSAT_BIAYA_LABEL,
    index: true,
    ...pickerSameCompany(),
    filterOptions: andCompany(ACTIVE_ONLY),
    ...field,
    type: 'relationship',
    relationTo: 'cash-accounts',
    admin: { placeholder: 'Pilih akun kas…', ...field.admin },
  } as RelationshipField)
}
