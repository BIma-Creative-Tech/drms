import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'

import { withHeavySlot } from '@/lib/heavy-gate'

import { setupPdfFonts } from './render'
import { ReportPdf, type ReportPdfData } from './ReportPdf'

/** Report PDF render (F3): same shared semaphore as the F2 document PDF and XLSX (lib/heavy-gate). */
export async function renderReportPdf(data: ReportPdfData): Promise<Buffer> {
  setupPdfFonts()
  return withHeavySlot(() => renderToBuffer(React.createElement(ReportPdf, { d: data }) as Parameters<typeof renderToBuffer>[0]))
}
