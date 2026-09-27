import { Font, renderToBuffer } from '@react-pdf/renderer'
import React from 'react'

import { withHeavySlot } from '@/lib/heavy-gate'

import { PengajuanBiaya, type PdfData } from './PengajuanBiaya'

/**
 * Single-document render in the web process (ADR 0008 §2): shared in-process semaphore (lib/heavy-gate,
 * also used by F3 report PDF/XLSX exports), max 2 concurrent renders; a third request waits up to
 * 10 s, then `PdfBusyError` (endpoint → 503 + Retry-After).
 * Hyphenation disabled: react-pdf's default English hyphenation splits Indonesian words wrongly.
 */
let hyphenationSet = false
export function setupPdfFonts() {
  if (hyphenationSet) return
  Font.registerHyphenationCallback((word) => [word])
  hyphenationSet = true
}

/** Kept for callers of F2 (same class as the shared gate's error). */
export { BusyError as PdfBusyError } from '@/lib/heavy-gate'

export async function renderPengajuanBiaya(data: PdfData): Promise<Buffer> {
  setupPdfFonts()
  return withHeavySlot(() => renderToBuffer(React.createElement(PengajuanBiaya, { d: data }) as Parameters<typeof renderToBuffer>[0]))
}
