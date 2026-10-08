import { formatRupiah } from '@/lib/money'

/**
 * QA-04 / QA-17: dialog content of a confirmable 409 (pure; unit-tested). Used by OverrideDialog,
 * CashEntryForm and MoneyForm.
 */
export type OverrideFlag = 'confirmOverdraft' | 'confirmUnverifiedAccount'

export type OverridePrompt = { flag: OverrideFlag; title: string; lines: string[] }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/** Dialog content of a confirmable 409 (null for every other response). */
export function overridePromptOf(status: number, data: unknown): OverridePrompt | null {
  if (status !== 409 || data === null || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (d.code === 'CASH_OVERDRAFT_CONFIRM_REQUIRED') {
    const balance = num(d.balance)
    const after = num(d.after)
    return {
      flag: 'confirmOverdraft',
      title: 'Saldo akun kas akan minus',
      lines: [
        balance !== null && after !== null ? `Saldo saat ini ${formatRupiah(balance)}; sesudah transaksi ini ${formatRupiah(after)}.` : (str(d.title) ?? 'Saldo akun akan menjadi minus.'),
        'Pastikan dana memang tersedia (mis. setoran belum dicatat). Konfirmasi Anda tercatat di audit log.',
      ],
    }
  }
  if (d.code === 'BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED') {
    const acct = [str(d.bankName), str(d.accountNo), str(d.accountHolder)].filter(Boolean).join(' · ')
    return {
      flag: 'confirmUnverifiedAccount',
      title: 'Rekening tujuan belum diverifikasi',
      lines: [
        `Rekening ${acct || 'tujuan'} berstatus "Belum diverifikasi".`,
        'Periksa nomor rekening dan nama pemilik dengan karyawan sebelum mentransfer. Konfirmasi Anda tercatat di audit log.',
      ],
    }
  }
  return null
}
