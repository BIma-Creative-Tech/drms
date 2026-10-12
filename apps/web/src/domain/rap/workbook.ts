import { normHeader, parseDecimal, parseMoney } from '@/import/parse'
import { readXlsx, writeXlsx, type CellValue, type WriteSheet } from '@/import/xlsx-io'

import { isQty, normUom, RAP_KINDS, round2, type RapKind } from './rules'

/**
 * P3 RAP Excel (owner decision 2026-10-10): one sheet "RAP" with the columns below + a "Petunjuk"
 * sheet; `jenis` and `satuan` are dropdowns. Pure: bytes in/out, no Payload. DRMS 10/10 D4 (2026-10-11): RAP for
 * every project kind with a RAB → `tahapan` may be empty here; the service requires it for konstruksi only.
 */
export const RAP_SHEET = 'RAP'
export const RAP_COLUMNS = ['kode', 'uraian', 'tahapan', 'jenis', 'satuan', 'volume', 'harga_satuan', 'bobot'] as const
const REQUIRED = new Set(['kode', 'uraian', 'jenis', 'satuan', 'volume'])

export type RapRow = {
  row: number
  code: string
  description: string
  stageName: string
  kind: RapKind
  uomCode: string
  volume: number
  unitPrice: number | null
  weightPct: number | null
}
export type RapIssue = { row?: number; column?: string; message: string }

const KIND_ALIASES: Record<string, RapKind> = { pekerjaan: 'pekerjaan', work: 'pekerjaan', material: 'material', bahan: 'material' }

/** Empty template (or with `rows` filled, e.g. "unduh RAP project"). */
export function buildRapWorkbook(uomCodes: readonly string[], rows: ReadonlyArray<Omit<RapRow, 'row'>> = []): Uint8Array {
  const header = RAP_COLUMNS.map((c) => ({ v: REQUIRED.has(c) ? `${c}*` : c, s: REQUIRED.has(c) ? ('headerRequired' as const) : ('header' as const) }))
  const sheet: WriteSheet = {
    name: RAP_SHEET,
    freezeHeader: true,
    cols: [{ width: 12, text: true }, { width: 44 }, { width: 24 }, { width: 12 }, { width: 10, text: true }, { width: 12 }, { width: 16 }, { width: 9 }],
    rows: [header, ...rows.map((r) => [r.code, r.description, r.stageName || null, r.kind, r.uomCode, r.volume, r.unitPrice ?? null, r.weightPct ?? null])],
    validations: [
      { col: 3, rule: { kind: 'list', source: RAP_KINDS.join(','), prompt: 'pekerjaan = jasa/pekerjaan (konstruksi: dihitung ke progress); material = barang/bahan' } },
      { col: 4, rule: { kind: 'list', source: uomCodes.join(','), allowOther: true, prompt: 'Kode satuan (m³ → M3, m² → M2 juga diterima)' } },
      { col: 5, rule: { kind: 'decimal', min: 0.01, prompt: 'Volume RAP, maks. 2 desimal' } },
      { col: 6, rule: { kind: 'whole', min: 0, prompt: 'Rupiah bulat, boleh kosong (tidak terlihat oleh Staff)' } },
      { col: 7, rule: { kind: 'decimal', min: 0, max: 100, prompt: 'Opsional' } },
    ],
    validationRows: 2000,
  }
  const help: WriteSheet = {
    name: 'Petunjuk',
    cols: [{ width: 110 }],
    rows: [
      [{ v: 'Template RAP — RR Teams', s: 'title' }],
      ['Satu baris = satu item RAP. Kolom bertanda * wajib.'],
      ['kode: unik per project (mis. A.1, B.2.3). Impor ulang dengan kode yang sama MENGUBAH item itu; item yang tidak ada di file dinonaktifkan.'],
      ['tahapan: project konstruksi WAJIB — nama tahapan project; tahapan yang belum ada dibuat, bobotnya diusulkan dari porsi nilai (volume × harga).'],
      ['tahapan: project jenis lain (umum, trading, kontrak unit, aftersales) boleh kosong; bila diisi harus tahapan yang sudah ada di project.'],
      ['jenis: pekerjaan (jasa/pekerjaan; konstruksi: dihitung ke progress tahapan) atau material (barang/bahan; masuk / terpakai / stok, TIDAK dihitung ke progress).'],
      ['Project yang punya RAB wajib punya RAP: pengajuan baru bisa dikirim setelah RAP terisi, dan setiap baris pengajuan memilih item RAP.'],
      ['satuan: kode satuan (M, M1, M2, M3, KG, SAK, ZAK, BTG, LBR, BH, …). m³ / m² juga dikenali.'],
      ['harga_satuan: Rupiah bulat (boleh kosong). Progress tahapan dibobot nilai bila semua pekerjaan berharga, selain itu rata.'],
      ['Setelah ada laporan harian (realisasi), RAP terkunci: perubahan hanya oleh Direktur dengan alasan.'],
    ],
  }
  return writeXlsx([sheet, help])
}

const cellStr = (v: CellValue): string => (v === null || v === undefined ? '' : String(v).trim())

/** Parses the RAP sheet: rows + issues (errors only; an empty file is an error). */
export function parseRapWorkbook(bytes: Uint8Array): { rows: RapRow[]; issues: RapIssue[] } {
  const issues: RapIssue[] = []
  let wb
  try {
    wb = readXlsx(bytes)
  } catch (err) {
    return { rows: [], issues: [{ message: `File tidak dapat dibaca sebagai Excel (.xlsx): ${(err as Error).message}` }] }
  }
  const sheet = wb.sheets.find((s) => s.name.trim().toUpperCase() === RAP_SHEET) ?? wb.sheets.find((s) => s.name !== 'Petunjuk')
  if (!sheet || sheet.rows.length === 0) return { rows: [], issues: [{ message: `Sheet "${RAP_SHEET}" tidak ditemukan atau kosong.` }] }
  const head = (sheet.rows[0] ?? []).map(normHeader)
  const idx = Object.fromEntries(RAP_COLUMNS.map((c) => [c, head.indexOf(c)])) as Record<(typeof RAP_COLUMNS)[number], number>
  for (const c of RAP_COLUMNS) if (REQUIRED.has(c) && idx[c] < 0) issues.push({ column: c, message: `Kolom "${c}" tidak ada di baris judul.` })
  if (issues.length) return { rows: [], issues }

  const rows: RapRow[] = []
  const seen = new Map<string, number>()
  sheet.rows.slice(1).forEach((r, i) => {
    const row = i + 2
    const get = (c: (typeof RAP_COLUMNS)[number]) => (idx[c] >= 0 ? (r[idx[c]] ?? null) : null)
    if (RAP_COLUMNS.every((c) => cellStr(get(c)) === '')) return
    const err = (column: string, message: string) => issues.push({ row, column, message })
    const code = cellStr(get('kode'))
    const description = cellStr(get('uraian'))
    const stageName = cellStr(get('tahapan'))
    const kind = KIND_ALIASES[cellStr(get('jenis')).toLowerCase()]
    const uomCode = normUom(cellStr(get('satuan')))
    const volRaw = parseDecimal(get('volume'))
    const priceCell = get('harga_satuan')
    const unitPrice = cellStr(priceCell) === '' ? null : parseMoney(priceCell)
    const weightCell = get('bobot')
    const weightPct = cellStr(weightCell) === '' ? null : parseDecimal(weightCell)
    if (!code || code.length > 32) err('kode', 'Kode wajib, maks. 32 karakter.')
    else if (seen.has(code.toUpperCase())) err('kode', `Kode ${code} ganda (baris ${seen.get(code.toUpperCase())}).`)
    else seen.set(code.toUpperCase(), row)
    if (!description || description.length > 300) err('uraian', 'Uraian wajib, maks. 300 karakter.')
    if (stageName.length > 128) err('tahapan', 'Tahapan maks. 128 karakter.')
    if (!kind) err('jenis', 'Jenis harus "pekerjaan" atau "material".')
    if (!uomCode) err('satuan', 'Satuan wajib.')
    const volume = volRaw === null ? null : round2(volRaw)
    if (volume === null || !isQty(volume) || Math.abs(volume - (volRaw as number)) > 1e-9) err('volume', 'Volume harus angka > 0, maks. 2 desimal.')
    if (unitPrice === null && cellStr(priceCell) !== '') err('harga_satuan', 'Harga satuan harus Rupiah bulat.')
    if (unitPrice !== null && unitPrice < 0) err('harga_satuan', 'Harga satuan tidak boleh negatif.')
    if (weightPct !== null && (weightPct < 0 || weightPct > 100)) err('bobot', 'Bobot 0–100.')
    if (code && description && stageName.length <= 128 && kind && uomCode && volume !== null && isQty(volume)) {
      rows.push({ row, code, description, stageName, kind, uomCode, volume, unitPrice, weightPct })
    }
  })
  if (rows.length === 0 && issues.length === 0) issues.push({ message: 'Tidak ada baris item RAP.' })
  return { rows, issues }
}
