import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import React from 'react'

/**
 * "PENGAJUAN BIAYA" — replica of the client's paper form (requirements v1.1 US-46, ADR 0008 §4):
 * A4 portrait, 10 mm margins; header (kop + logo), title, company name, subtitle, TGL/NO, item
 * table (No, Uraian, Jumlah, Satuan, Harga Satuan, Total, Keterangan) with empty spacer rows like
 * the form, highlighted GRAND TOTAL, 4 signature boxes (Diajukan Oleh — several names joined with
 * ", " — Dibuat Oleh, Diketahui Oleh, Approval) with signature image, name and server time, the
 * transfer box, then the receipt photos 2 per page (internal variant: validation flags).
 * Built-in Helvetica (PDF standard font, WinAnsi — covers Indonesian Latin text; ADR 0008 §6
 * fallback): no font file to ship or license, least RAM. All text is server data (no HTML).
 */
import type { PdfImage } from './images'

export type { PdfImage }

export type PdfSignature = {
  label: 'Diajukan Oleh' | 'Dibuat Oleh' | 'Diketahui Oleh' | 'Approval'
  names: string
  images: PdfImage[]
  time: string
  note?: string
}

export type PdfReceipt = {
  heading: string
  details: string
  status: string
  image: PdfImage | null
  flags: string[]
}

export type PdfData = {
  companyName: string
  companyCode: string
  kop: string[]
  logo: PdfImage | null
  subtitle: string
  dateText: string
  docNo: string
  typeLabel: string
  statusLabel: string
  lines: Array<{ no: number; description: string; qty: string; uom: string; unitPrice: string; total: string; notes: string }>
  grandTotal: string
  signatures: PdfSignature[]
  transfer: { bankName: string; accountHolder: string; accountNo: string } | null
  receipts: PdfReceipt[]
  internal: boolean
  printedText: string
}

const MIN_ROWS = 8
const BORDER = '#000000'
const HIGHLIGHT = '#ffe082'

const s = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 36, paddingHorizontal: 28, fontFamily: 'Helvetica', fontSize: 9, color: '#000000' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  kop: { flexGrow: 1, flexShrink: 1, paddingRight: 8 },
  kopName: { fontFamily: 'Helvetica-Bold', fontSize: 11 },
  kopLine: { fontSize: 8, color: '#333333' },
  logoBox: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 64, height: 64, objectFit: 'contain' },
  logoPlaceholder: { width: 60, height: 60, borderRadius: 30, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  logoPlaceholderText: { fontFamily: 'Helvetica-Bold', fontSize: 12 },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 16, textAlign: 'center', marginTop: 2 },
  company: { fontFamily: 'Helvetica-Bold', fontSize: 11, textAlign: 'center', marginTop: 2 },
  subtitle: { fontSize: 9, textAlign: 'center', marginTop: 3, marginBottom: 8 },
  meta: { flexDirection: 'row', marginBottom: 1 },
  metaLabel: { width: 34, fontFamily: 'Helvetica-Bold' },
  metaSep: { width: 8 },
  table: { borderWidth: 1, borderColor: BORDER, marginTop: 6 },
  row: { flexDirection: 'row', borderBottomWidth: 0.75, borderColor: BORDER, minHeight: 16 },
  rowLast: { flexDirection: 'row', minHeight: 16 },
  th: { fontFamily: 'Helvetica-Bold', textAlign: 'center', backgroundColor: '#eeeeee' },
  cell: { paddingHorizontal: 3, paddingVertical: 3, borderRightWidth: 0.75, borderColor: BORDER },
  cellLast: { paddingHorizontal: 3, paddingVertical: 3 },
  cNo: { width: '6%', textAlign: 'center' },
  cDesc: { width: '30%' },
  cQty: { width: '8%', textAlign: 'center' },
  cUom: { width: '10%', textAlign: 'center' },
  cPrice: { width: '14%', textAlign: 'right' },
  cTotal: { width: '16%', textAlign: 'right' },
  cNotes: { width: '16%' },
  gtLabel: { width: '68%', fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  gtValue: { width: '16%', fontFamily: 'Helvetica-Bold', textAlign: 'right', backgroundColor: HIGHLIGHT },
  sigRow: { flexDirection: 'row', marginTop: 12, borderWidth: 1, borderColor: BORDER },
  sigBox: { width: '25%', borderRightWidth: 0.75, borderColor: BORDER },
  sigBoxLast: { width: '25%' },
  sigHead: { fontFamily: 'Helvetica-Bold', textAlign: 'center', paddingVertical: 3, borderBottomWidth: 0.75, borderColor: BORDER, backgroundColor: '#eeeeee' },
  sigArea: { height: 58, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', paddingHorizontal: 2 },
  sigImg: { height: 52, maxWidth: 120, objectFit: 'contain' },
  sigName: { textAlign: 'center', fontFamily: 'Helvetica-Bold', paddingHorizontal: 2, borderTopWidth: 0.75, borderColor: BORDER, paddingTop: 2 },
  sigTime: { textAlign: 'center', fontSize: 7, color: '#333333', paddingBottom: 2 },
  sigNote: { textAlign: 'center', fontSize: 7, color: '#333333' },
  transfer: { marginTop: 10, borderWidth: 1, borderColor: BORDER, padding: 5, width: '60%' },
  transferHead: { fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  transferRow: { flexDirection: 'row' },
  transferLabel: { width: 70 },
  footer: { position: 'absolute', bottom: 14, left: 28, right: 28, fontSize: 7, color: '#555555', flexDirection: 'row', justifyContent: 'space-between' },
  rHead: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginBottom: 6 },
  receipt: { height: 360, marginBottom: 8, borderWidth: 0.75, borderColor: '#999999', padding: 4 },
  receiptImgBox: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  receiptImg: { maxHeight: 300, maxWidth: 520, objectFit: 'contain' },
  receiptHeading: { fontFamily: 'Helvetica-Bold' },
  receiptFlag: { color: '#b00020', fontSize: 8 },
})

type ViewStyle = React.ComponentProps<typeof View>['style']

function Cell({ style, last, children }: { style: ViewStyle; last?: boolean; children?: React.ReactNode }) {
  const extra = Array.isArray(style) ? style : style ? [style] : []
  return (
    <View style={[last ? s.cellLast : s.cell, ...extra]}>
      <Text>{children}</Text>
    </View>
  )
}

function Signature({ sig, last }: { sig: PdfSignature; last?: boolean }) {
  return (
    <View style={last ? s.sigBoxLast : s.sigBox} wrap={false}>
      <Text style={s.sigHead}>{sig.label}</Text>
      <View style={s.sigArea}>
        {sig.images.map((img, i) => (
          // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt
          <Image key={i} style={s.sigImg} src={img} />
        ))}
      </View>
      <Text style={s.sigName}>{sig.names || ' '}</Text>
      {sig.note ? <Text style={s.sigNote}>{sig.note}</Text> : null}
      <Text style={s.sigTime}>{sig.time || ' '}</Text>
    </View>
  )
}

function Footer({ d }: { d: PdfData }) {
  return (
    <View style={s.footer} fixed>
      <Text>
        {d.docNo} · {d.typeLabel} · {d.statusLabel}
        {d.internal ? ' · SALINAN INTERNAL' : ''}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `${d.printedText} · Hal. ${pageNumber}/${totalPages}`} />
    </View>
  )
}

export function PengajuanBiaya({ d }: { d: PdfData }) {
  const spacer = Math.max(0, MIN_ROWS - d.lines.length)
  const pairs: PdfReceipt[][] = []
  for (let i = 0; i < d.receipts.length; i += 2) pairs.push(d.receipts.slice(i, i + 2))
  return (
    <Document title={`Pengajuan Biaya ${d.docNo}`} author={d.companyName} creator="RR Teams" producer="RR Teams" language="id-ID">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View style={s.kop}>
            <Text style={s.kopName}>{d.companyName}</Text>
            {d.kop.map((l, i) => (
              <Text key={i} style={s.kopLine}>
                {l}
              </Text>
            ))}
          </View>
          <View style={s.logoBox}>
            {d.logo ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt
              <Image style={s.logo} src={d.logo} />
            ) : (
              <View style={s.logoPlaceholder}>
                <Text style={s.logoPlaceholderText}>{d.companyCode}</Text>
              </View>
            )}
          </View>
        </View>
        <Text style={s.title}>PENGAJUAN BIAYA</Text>
        <Text style={s.company}>{d.companyName.toUpperCase()}</Text>
        <Text style={s.subtitle}>{d.subtitle}</Text>
        <View style={s.meta}>
          <Text style={s.metaLabel}>TGL.</Text>
          <Text style={s.metaSep}>:</Text>
          <Text>{d.dateText}</Text>
        </View>
        <View style={s.meta}>
          <Text style={s.metaLabel}>NO.</Text>
          <Text style={s.metaSep}>:</Text>
          <Text>{d.docNo}</Text>
        </View>

        <View style={s.table}>
          <View style={s.row} fixed>
            <Cell style={[s.cNo, s.th]}>No</Cell>
            <Cell style={[s.cDesc, s.th]}>Uraian</Cell>
            <Cell style={[s.cQty, s.th]}>Jumlah</Cell>
            <Cell style={[s.cUom, s.th]}>Satuan</Cell>
            <Cell style={[s.cPrice, s.th]}>Harga Satuan</Cell>
            <Cell style={[s.cTotal, s.th]}>Total</Cell>
            <Cell style={[s.cNotes, s.th]} last>
              Keterangan
            </Cell>
          </View>
          {d.lines.map((l) => (
            <View key={l.no} style={s.row} wrap={false}>
              <Cell style={s.cNo}>{l.no}</Cell>
              <Cell style={s.cDesc}>{l.description}</Cell>
              <Cell style={s.cQty}>{l.qty}</Cell>
              <Cell style={s.cUom}>{l.uom}</Cell>
              <Cell style={s.cPrice}>{l.unitPrice}</Cell>
              <Cell style={s.cTotal}>{l.total}</Cell>
              <Cell style={s.cNotes} last>
                {l.notes}
              </Cell>
            </View>
          ))}
          {Array.from({ length: spacer }, (_, i) => (
            <View key={`sp${i}`} style={s.row}>
              <Cell style={s.cNo}> </Cell>
              <Cell style={s.cDesc}> </Cell>
              <Cell style={s.cQty}> </Cell>
              <Cell style={s.cUom}> </Cell>
              <Cell style={s.cPrice}> </Cell>
              <Cell style={s.cTotal}> </Cell>
              <Cell style={s.cNotes} last>
                {' '}
              </Cell>
            </View>
          ))}
          <View style={s.rowLast} wrap={false}>
            <Cell style={s.gtLabel}>GRAND TOTAL</Cell>
            <Cell style={s.gtValue}>{d.grandTotal}</Cell>
            <Cell style={s.cNotes} last>
              {' '}
            </Cell>
          </View>
        </View>

        <View style={s.sigRow} wrap={false}>
          {d.signatures.map((sig, i) => (
            <Signature key={sig.label} sig={sig} last={i === d.signatures.length - 1} />
          ))}
        </View>

        {d.transfer ? (
          <View style={s.transfer} wrap={false}>
            <Text style={s.transferHead}>Info Transfer</Text>
            <View style={s.transferRow}>
              <Text style={s.transferLabel}>Transfer via</Text>
              <Text>: {d.transfer.bankName}</Text>
            </View>
            <View style={s.transferRow}>
              <Text style={s.transferLabel}>Atas nama</Text>
              <Text>: {d.transfer.accountHolder}</Text>
            </View>
            <View style={s.transferRow}>
              <Text style={s.transferLabel}>No. rekening</Text>
              <Text>: {d.transfer.accountNo}</Text>
            </View>
          </View>
        ) : null}
        <Footer d={d} />
      </Page>

      {pairs.map((pair, pi) => (
        <Page key={`r${pi}`} size="A4" style={s.page}>
          <Text style={s.rHead}>
            Lampiran Nota — {d.docNo} ({pi * 2 + 1}
            {pair.length > 1 ? `–${pi * 2 + 2}` : ''} dari {d.receipts.length})
          </Text>
          {pair.map((r, ri) => (
            <View key={ri} style={s.receipt} wrap={false}>
              <View style={s.receiptImgBox}>
                {r.image ? (
                  // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt
                  <Image style={s.receiptImg} src={r.image} />
                ) : (
                  <Text>(foto nota tidak tersedia)</Text>
                )}
              </View>
              <Text style={s.receiptHeading}>{r.heading}</Text>
              <Text>
                {r.details} · {r.status}
              </Text>
              {d.internal
                ? r.flags.map((f, fi) => (
                    <Text key={fi} style={s.receiptFlag}>
                      ! {f}
                    </Text>
                  ))
                : null}
            </View>
          ))}
          <Footer d={d} />
        </Page>
      ))}
    </Document>
  )
}
