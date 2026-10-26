import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CollectionConfig, Field } from 'payload'
import { describe, expect, it } from 'vitest'

import { capFor, entityOfPath, fieldNameOfId, oversizeFiles, oversizeMessage, sizeLabel, slugByAccept, slugOfField, uploadTargets } from '@/admin/components/media/upload-guard'
import { CashEntries } from '@/collections/CashEntries'
import { ExpenseRequests } from '@/collections/ExpenseRequests'
import { MEDIA_COLLECTIONS } from '@/collections/media'
import { imageLimitError } from '@/collections/media/factory'
import { MAX_UPLOAD_BYTES, MEDIA_LIMITS, type MediaSlug } from '@/collections/media/limits'
import { Transfers } from '@/collections/Transfers'

/**
 * D2610 (user 2026-10-26, prod Reimburse #125): a 6–7 MB PDF in "Lampiran" was refused (413, PDF cap 5 MB) and
 * Payload's drawer then re-sent the file to the admin Server Action → WAF 403 → no file, no message. The admin now
 * checks every file in the browser with the server's caps (UploadSizeGuard), and the attachment fields say
 * "maks. 5 MB per file" (decision: the cap stays 5 MB).
 */
const root = fileURLToPath(new URL('../../', import.meta.url))
const src = (p: string) => readFileSync(join(root, p), 'utf8')
const MB = 1024 * 1024
const file = (name: string, size: number, type: string) => ({ name, size, type })

describe('limits.ts is the single source of the media caps', () => {
  it('every media collection takes its mimeTypes from MEDIA_LIMITS', () => {
    expect(MEDIA_COLLECTIONS.map((c) => c.slug).sort()).toEqual(Object.keys(MEDIA_LIMITS).sort())
    for (const c of MEDIA_COLLECTIONS) {
      const upload = c.upload as { mimeTypes?: string[] }
      expect(upload.mimeTypes, c.slug).toEqual(MEDIA_LIMITS[c.slug as MediaSlug].mimeTypes)
    }
  })

  it('caps unchanged: attachment PDF 5 MB, transfer-proof PDF 2 MB, logo / signature 2 MB, the rest 8 MB', () => {
    expect(capFor('media-attachments', 'application/pdf')).toBe(5 * MB)
    expect(capFor('media-attachments', 'image/jpeg')).toBe(MAX_UPLOAD_BYTES)
    expect(capFor('media-transfer-proofs', 'application/pdf')).toBe(2 * MB)
    expect(capFor('media-company', 'image/png')).toBe(2 * MB)
    expect(capFor('media-signatures', 'image/png')).toBe(2 * MB)
    expect(capFor('media-receipts', 'image/webp')).toBe(MAX_UPLOAD_BYTES)
    expect(MAX_UPLOAD_BYTES).toBe(8 * MB)
  })

  it("the server's 413 text is the same as before", () => {
    expect(imageLimitError(MEDIA_LIMITS['media-attachments'], 'application/pdf', 7_220_913)).toEqual({ status: 413, message: 'File terlalu besar (maks. 5 MB).' })
    expect(imageLimitError(MEDIA_LIMITS['media-attachments'], 'application/pdf', 5 * MB)).toBeNull()
  })
})

describe('upload-guard.ts', () => {
  it("a Payload file input's accept (mimeTypes.join(', ')) names exactly one collection", () => {
    const accepts = Object.values(MEDIA_LIMITS).map((l) => l.mimeTypes.join(', '))
    expect(new Set(accepts).size).toBe(accepts.length - 1) // selfies + progress photos share 'image/jpeg' (same caps)
    expect(slugByAccept('application/pdf, image/jpeg, image/png')).toBe('media-attachments')
    expect(slugByAccept('image/jpeg, image/png, application/pdf')).toBe('media-transfer-proofs')
    expect(capFor(slugByAccept('image/jpeg'), 'image/jpeg')).toBe(MAX_UPLOAD_BYTES)
    // the app's own forms (accept without ", ") are not Payload inputs
    expect(slugByAccept('application/pdf,image/jpeg,image/png')).toBeNull()
    expect(slugByAccept('')).toBeNull()
    expect(slugByAccept(null)).toBeNull()
  })

  it('unknown collection: the largest cap of any collection taking that type (never stricter than the server)', () => {
    expect(capFor(null, 'application/pdf')).toBe(5 * MB)
    expect(capFor(null, 'image/png')).toBe(MAX_UPLOAD_BYTES)
    expect(capFor(null, 'text/plain')).toBeNull()
    expect(capFor('media-signatures', 'image/jpeg')).toBeNull()
  })

  it('prod case 26/10: 6.0 / 6.9 MB PDFs in Lampiran are stopped, smaller files pass', () => {
    const big = oversizeFiles([file('scan-a.pdf', 6_255_427, 'application/pdf'), file('nota.jpg', 6 * MB, 'image/jpeg'), file('scan-b.pdf', 7_220_913, 'application/pdf'), file('ok.pdf', 430_135, 'application/pdf')], 'media-attachments')
    expect(big).toEqual([
      { name: 'scan-a.pdf', bytes: 6_255_427, cap: 5 * MB },
      { name: 'scan-b.pdf', bytes: 7_220_913, cap: 5 * MB },
    ])
    expect(oversizeFiles([file('x.pdf', 5 * MB, 'application/pdf')], 'media-attachments')).toEqual([])
    // type unknown to the browser: the global cap
    expect(oversizeFiles([file('x', 9 * MB, '')], null)).toEqual([{ name: 'x', bytes: 9 * MB, cap: MAX_UPLOAD_BYTES }])
    expect(oversizeFiles([file('x.txt', 9 * MB, 'text/plain')], 'media-attachments')).toEqual([])
  })

  it('popup text: file, size, cap per file and what to do', () => {
    expect(sizeLabel(7_220_913)).toBe('6,9 MB')
    expect(sizeLabel(300 * 1024)).toBe('300 KB')
    const msg = oversizeMessage([{ name: 'scan-b.pdf', bytes: 7_220_913, cap: 5 * MB }])
    expect(msg).toContain('scan-b.pdf — 6,9 MB (maks. 5 MB per file)')
    expect(msg).toMatch(/File belum diunggah\. Kompres atau perkecil file/)
  })

  it('field name of a Payload upload field wrapper id', () => {
    expect(fieldNameOfId('field-attachments')).toBe('attachments')
    expect(fieldNameOfId('field-representatives__0__signature')).toBe('signature')
    expect(fieldNameOfId('attachments')).toBeNull()
    expect(fieldNameOfId(undefined)).toBeNull()
  })

  it('collection of an upload field: current document first, then a unique match anywhere', () => {
    expect([...uploadTargets(ExpenseRequests.fields, 'attachments')]).toEqual(['media-attachments'])
    expect(slugOfField('attachments', ExpenseRequests, [])).toBe('media-attachments')
    expect(slugOfField('invoiceFile', null, [ExpenseRequests])).toBe('media-attachments')
    // "proof" is a cash-entry attachment AND a transfer proof: only the current document decides
    expect(slugOfField('proof', null, [CashEntries, Transfers])).toBeNull()
    expect(slugOfField('proof', Transfers, [CashEntries, Transfers])).toBe('media-transfer-proofs')
    const nested: Field[] = [{ type: 'tabs', tabs: [{ label: 'A', fields: [{ type: 'row', fields: [{ name: 'logo', type: 'upload', relationTo: 'media-company' }] }] }] }]
    expect(slugOfField('logo', { fields: nested } as Pick<CollectionConfig, 'fields'>, [])).toBe('media-company')
  })

  it('entity of an admin URL', () => {
    expect(entityOfPath('/admin/collections/expense-requests/125', '/admin')).toEqual({ collectionSlug: 'expense-requests' })
    expect(entityOfPath('/admin/collections/expense-requests/create', '/admin/')).toEqual({ collectionSlug: 'expense-requests' })
    expect(entityOfPath('/admin/globals/company-settings', '/admin')).toEqual({ globalSlug: 'company-settings' })
    expect(entityOfPath('/admin/dashboard', '/admin')).toBeNull()
    expect(entityOfPath('/unduh', '/admin')).toBeNull()
  })
})

describe('wiring', () => {
  it('UploadSizeGuard is an admin provider (config + import map) and listens in the capture phase', () => {
    expect(src('src/payload.config.ts')).toContain("'@/admin/components/media/UploadSizeGuard#UploadSizeGuard'")
    expect(src('src/app/(payload)/admin/importMap.js')).toContain('"@/admin/components/media/UploadSizeGuard#UploadSizeGuard": UploadSizeGuard_')
    const guard = src('src/admin/components/media/UploadSizeGuard.tsx')
    for (const ev of ['change', 'drop', 'paste']) expect(guard).toContain(`window.addEventListener('${ev}', `)
    expect(guard).toContain('stopImmediatePropagation()')
  })

  it('the attachment fields say "maks. 5 MB per file"', () => {
    type F = { name?: string; admin?: { description?: unknown }; fields?: unknown; tabs?: Array<{ fields?: unknown }> }
    const flat = (fs: unknown): F[] => (Array.isArray(fs) ? (fs as F[]).flatMap((f) => [f, ...flat(f.fields), ...(f.tabs ?? []).flatMap((t) => flat(t.fields))]) : [])
    for (const name of ['attachments', 'invoiceFile']) {
      const f = flat(ExpenseRequests.fields).find((x) => x.name === name)
      expect(String(f?.admin?.description), name).toContain('maks. 5 MB per file')
    }
    expect(src('src/admin/components/RequesterActions.tsx')).toContain('lampiran (foto/PDF, maks. 5 MB per file)')
  })
})
