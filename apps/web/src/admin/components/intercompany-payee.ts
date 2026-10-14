/** ADR 0028: pure helpers of IntercompanyPayeeField (unit-tested). */

export type PayeeOption = { companyId: number; shortCode: string; name: string; bankName: string | null; accountNoMasked: string; accountHolder: string }

/** Payee directory query of the form's (paying) PT. */
export const payeesQuery = (company: number): string => `/api/v1/intercompany/payees?company=${encodeURIComponent(String(company))}`

/** "LAS — PT Contoh Las · Bank Mandiri ••••7890 a.n. PT Contoh Las" */
export function intercompanyOptionLabel(p: PayeeOption): string {
  const account = [p.bankName, p.accountNoMasked, p.accountHolder ? `a.n. ${p.accountHolder}` : null].filter(Boolean).join(' ')
  return `${p.shortCode} — ${p.name}${account ? ` · ${account}` : ''}`
}
