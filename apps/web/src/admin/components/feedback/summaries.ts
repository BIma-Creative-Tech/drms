import { formatRupiah } from '@/lib/money'

import type { Summary } from './feedback'

/**
 * DRMS 24/10: summary rows of the confirmation / reason popups for the common documents — one place, so the web
 * panels and lists say the same thing (document number, amount, person, project, date). Pure (server + client).
 */
const rp = (v: number | null | undefined) => (v === null || v === undefined ? null : formatRupiah(v))
const nameOf = (x: unknown): string => (x && typeof x === 'object' && 'name' in x ? String((x as { name?: unknown }).name ?? '') : '')

/** Expense request (Pengajuan / Reimburse / Pembayaran vendor). */
export function expenseRequestSummary(d: { id: number; docNo?: string | null; typeLabel?: string | null; title?: string | null; grandTotal?: number | null; requesters?: unknown[] | null; project?: unknown; statusLabel?: string | null }): { object: string; summary: Summary } {
  const object = d.docNo ?? `Draft #${d.id}`
  const requesters = (d.requesters ?? []).map(nameOf).filter(Boolean).join(', ')
  return {
    object,
    summary: [
      [d.typeLabel ?? 'Pengajuan', object],
      ['Judul', d.title ?? null],
      ['Pemohon', requesters || null],
      ['Proyek', nameOf(d.project) || null],
      ['Total', rp(d.grandTotal)],
      ['Status', d.statusLabel ?? null],
    ],
  }
}

/** Generic money document (transfer, kas, pinjaman, LPJ): number, amount, counterpart, date. */
export function moneyDocSummary(kind: string, d: { docNo?: string | null; amount?: number | null; party?: string | null; partyLabel?: string; date?: string | null; note?: string | null; noteLabel?: string }): { object: string | null; summary: Summary } {
  return {
    object: d.docNo ?? null,
    summary: [
      [kind, d.docNo ?? null],
      ['Nominal', rp(d.amount)],
      [d.partyLabel ?? 'Pihak', d.party ?? null],
      ['Tanggal', d.date ?? null],
      [d.noteLabel ?? 'Keterangan', d.note ?? null],
    ],
  }
}
