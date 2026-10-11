/** DRMS 10/10 8e: pure helpers of BankAccountPreview (unit-tested). */

/** `/api/v1/bank-account-preview` query for the current form; null = nothing to show (no account picked / unsaved after submit). */
export function previewQuery(input: { requestId: number | null; accountId: number | null; draft: boolean; reveal?: boolean }): string | null {
  const q = new URLSearchParams()
  if (input.draft) {
    // draft / new form: the picker value (an emptied picker shows "none", not the saved account)
    if (input.accountId === null) return null
    if (input.requestId !== null) q.set('request', String(input.requestId))
    q.set('account', String(input.accountId))
  } else {
    // after submit: the snapshot taken at submit
    if (input.requestId === null) return null
    q.set('request', String(input.requestId))
  }
  if (input.reveal) q.set('reveal', '1')
  return `/api/v1/bank-account-preview?${q.toString()}`
}

/** "1234567890" → "1234 5678 90" (readability of the revealed number). */
export const groupDigits = (no: string) => no.replace(/(\d{4})(?=\d)/g, '$1 ')

