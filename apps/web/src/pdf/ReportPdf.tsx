import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import React from 'react'

import { formatAmount, pdfSafe } from './format'
import type { PdfImage } from './images'

/**
 * Report PDF (F3, Q-F3-5: Rekap Kas, Pengeluaran per Kategori, Anggaran Project): A4 landscape,
 * company header, title + active filters + "Dibuat oleh … · waktu WITA", one or more summary tables
 * (≤ 500 rows each — larger data goes to XLSX/CSV), notes. Header row repeats on every page;
 * page numbers in the footer. Built-in Helvetica (ADR 0008 §6); every string through pdfSafe().
 * MC4: the letterhead logo (PT logo, or the group logo on a consolidated report) left of the kop
 * lines on the first page — one image ≤ 3 MiB, JPEG/PNG, loaded by `pdf/images.ts` (ADR 0008 §2).
 */
export type PdfColumn = { label: string; type: 'text' | 'money' | 'int' | 'date' | 'datetime' | 'pct'; width: number }
export type PdfTable = { title: string; columns: PdfColumn[]; rows: string[][]; totals?: string[] }
export type ReportPdfData = {
  kop: string[]
  title: string
  meta: string[]
  tables: PdfTable[]
  notes: string[]
  /** MC2: PT list (PDF Subject metadata). */
  subject?: string
  /** MC4: letterhead logo (PT logo / group logo), null = text letterhead only. */
  logo?: PdfImage | null
}

const s = StyleSheet.create({
  page: { paddingTop: 24, paddingBottom: 32, paddingHorizontal: 24, fontFamily: 'Helvetica', fontSize: 8, color: '#000000' },
  kopRow: { flexDirection: 'row', alignItems: 'center' },
  kopText: { flexGrow: 1, flexShrink: 1 },
  logo: { width: 40, height: 40, objectFit: 'contain', marginRight: 8 },
  kopName: { fontFamily: 'Helvetica-Bold', fontSize: 11 },
  kopLine: { fontSize: 8, color: '#333333' },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 14, marginTop: 8 },
  meta: { fontSize: 8, color: '#333333', marginTop: 1 },
  tableTitle: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginTop: 10, marginBottom: 3 },
  table: { borderTopWidth: 0.75, borderLeftWidth: 0.75, borderColor: '#000000' },
  row: { flexDirection: 'row' },
  cell: { borderRightWidth: 0.75, borderBottomWidth: 0.75, borderColor: '#000000', paddingHorizontal: 3, paddingVertical: 2 },
  th: { fontFamily: 'Helvetica-Bold', backgroundColor: '#eeeeee' },
  total: { fontFamily: 'Helvetica-Bold', backgroundColor: '#f5f5f5' },
  right: { textAlign: 'right' },
  note: { fontSize: 7.5, color: '#333333', marginTop: 2 },
  footer: { position: 'absolute', bottom: 14, left: 24, right: 24, fontSize: 7, color: '#555555', flexDirection: 'row', justifyContent: 'space-between' },
})

const numeric = (t: PdfColumn['type']) => t === 'money' || t === 'int' || t === 'pct'

function Row({ cells, columns, style }: { cells: string[]; columns: PdfColumn[]; style?: (typeof s)[keyof typeof s] }) {
  return (
    <View style={s.row} wrap={false}>
      {columns.map((c, i) => (
        <Text key={i} style={[s.cell, { width: `${c.width}%` }, ...(numeric(c.type) ? [s.right] : []), ...(style ? [style] : [])]}>
          {pdfSafe(cells[i] ?? '')}
        </Text>
      ))}
    </View>
  )
}

export function ReportPdf({ d }: { d: ReportPdfData }) {
  return (
    <Document title={pdfSafe(d.title)} author={pdfSafe(d.kop[0] ?? '')} subject={d.subject ? pdfSafe(d.subject) : undefined} creator="RR Teams" producer="RR Teams">
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.kopRow}>
          {d.logo ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt
            <Image style={s.logo} src={d.logo} />
          ) : null}
          <View style={s.kopText}>
            {d.kop.map((l, i) => (
              <Text key={i} style={i === 0 ? s.kopName : s.kopLine}>
                {pdfSafe(l)}
              </Text>
            ))}
          </View>
        </View>
        <Text style={s.title}>{pdfSafe(d.title)}</Text>
        {d.meta.map((m, i) => (
          <Text key={i} style={s.meta}>
            {pdfSafe(m)}
          </Text>
        ))}
        {d.tables.map((t, ti) => (
          <View key={ti}>
            <Text style={s.tableTitle}>{pdfSafe(t.title)}</Text>
            <View style={s.table}>
              <View fixed>
                <Row cells={t.columns.map((c) => c.label)} columns={t.columns} style={s.th} />
              </View>
              {t.rows.length === 0 ? <Row cells={['Tidak ada data.']} columns={[{ label: '', type: 'text', width: 100 }]} /> : null}
              {t.rows.map((r, ri) => (
                <Row key={ri} cells={r} columns={t.columns} />
              ))}
              {t.totals ? <Row cells={t.totals} columns={t.columns} style={s.total} /> : null}
            </View>
          </View>
        ))}
        {d.notes.map((n, i) => (
          <Text key={i} style={s.note}>
            {pdfSafe(`* ${n}`)}
          </Text>
        ))}
        <View style={s.footer} fixed>
          <Text>{pdfSafe(`${d.title} — ${d.kop[0] ?? ''}`)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Halaman ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

export { formatAmount }
