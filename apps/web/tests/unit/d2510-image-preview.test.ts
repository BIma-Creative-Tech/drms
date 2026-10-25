import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CollectionConfig, Field } from 'payload'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SelfieThumb } from '@/admin/components/absensi/AttendanceActions'
import { collect } from '@/admin/components/lightbox/gallery'
import { LpjPhotoGrid } from '@/admin/components/lpj/LpjPhotoGrid'
import { ImageThumb, ThumbList } from '@/admin/components/media/ImageThumb'
import { isNonImage, MEDIA_KIND_OF, mediaFileUrl, mediaThumbSource, selfieSource, uploadId, uploadIds, uploadMime } from '@/admin/components/media/media-url'
import { THUMB_STYLE } from '@/admin/components/media/thumb-style'
import { isMediaUpload, UPLOAD_CELL, UPLOAD_PREVIEW_FIELD, withDisplayCells } from '@/admin/display-cells'
import { FileCollectionEnum } from '@/api/v1/schemas-flow'

/**
 * D2510 image preview (web 0.21.1, user 2026-10-25: "untuk setiap link image atau detail yang memiliki image link
 * buatkan previewnya dan clickable dalam popup"): the shared thumbnail (URLs, markup, hooks, fallbacks), the selfie
 * and LPJ thumbnails, the lightbox caption, the Payload upload wiring and a guard against plain image links.
 */
const h = createElement
const root = fileURLToPath(new URL('../../', import.meta.url))
const src = (p: string) => readFileSync(join(root, p), 'utf8')

describe('media URLs (media-url.ts): the authorized endpoints the links used', () => {
  it('thumb variant only where the collection has one; PDF-capable kinds fall back to a file link', () => {
    expect(mediaThumbSource('receipts', 5)).toEqual({ href: '/api/v1/media/receipts/5/file', thumb: '/api/v1/media/receipts/5/file?variant=thumb', fallback: 'full' })
    expect(mediaThumbSource('transfer-proofs', '7')).toEqual({ href: '/api/v1/media/transfer-proofs/7/file', thumb: '/api/v1/media/transfer-proofs/7/file?variant=thumb', fallback: 'file' })
    expect(mediaThumbSource('attachments', 8)?.fallback).toBe('file')
    expect(mediaThumbSource('progress-photos', 9)?.thumb).toBe('/api/v1/media/progress-photos/9/file?variant=thumb')
    // no generated size: the stored (already resized) file
    expect(mediaThumbSource('selfies', 3)).toEqual({ href: '/api/v1/media/selfies/3/file', thumb: '/api/v1/media/selfies/3/file', fallback: 'full' })
    expect(mediaThumbSource('signatures', 3)?.thumb).toBe(mediaFileUrl('signatures', 3))
    expect(mediaThumbSource('company', 3)?.thumb).toBe(mediaFileUrl('company', 3))
    expect(selfieSource(42)).toEqual({ href: '/api/v1/attendance/42/selfie', thumb: '/api/v1/attendance/42/selfie', fallback: 'full' })
  })

  it('malformed ids never build a URL', () => {
    expect(mediaThumbSource('receipts', '../x')).toBeNull()
    expect(mediaThumbSource('receipts', '1?a=b')).toBeNull()
    expect(selfieSource('12345678901')).toBeNull()
  })

  it('every media collection maps to a kind of GET /api/v1/media/{collection}/{id}/file', () => {
    expect(new Set(Object.values(MEDIA_KIND_OF))).toEqual(new Set(FileCollectionEnum.options))
  })

  it('upload values: ids of has-one / has-many / populated / polymorphic values; MIME of a populated one', () => {
    expect(uploadId(4)).toBe(4)
    expect(uploadId('4')).toBe(4)
    expect(uploadId({ id: 4, filename: 'x.jpg' })).toBe(4)
    expect(uploadId({ relationTo: 'media-receipts', value: 6 })).toBe(6)
    expect(uploadId(0)).toBeNull()
    expect(uploadId('x')).toBeNull()
    expect(uploadId(null)).toBeNull()
    expect(uploadIds([1, { id: 2 }, 2, null, 'z'])).toEqual([1, 2])
    expect(uploadIds(null)).toEqual([])
    expect(uploadIds(9)).toEqual([9])
    expect(uploadMime({ id: 1, mimeType: 'application/pdf' })).toBe('application/pdf')
    expect(uploadMime(1)).toBeNull()
    expect(isNonImage('application/pdf')).toBe(true)
    expect(isNonImage('image/jpeg')).toBe(false)
    expect(isNonImage(null, 'bukti.PDF')).toBe(true)
    expect(isNonImage(null, 'a.jpg')).toBe(false)
  })
})

describe('ImageThumb (SSR markup)', () => {
  it('a real link opening the lightbox: lazy fixed-size thumbnail, alt, title + caption, hooks forwarded', () => {
    const html = renderToStaticMarkup(h(ImageThumb, { src: mediaThumbSource('receipts', 5), group: 'receipts-1', title: 'Nota N-1 · Rp 10.000', caption: 'Toko A · 2026-10-24', alt: 'Nota N-1', 'data-pk-receipt-thumb': 5 }))
    expect(html).toMatch(/^<a class="pk-thumb" style="--pk-thumb:64px" href="\/api\/v1\/media\/receipts\/5\/file" target="_blank" rel="noopener noreferrer"/)
    expect(html).toContain('aria-label="Perbesar Nota N-1 · Rp 10.000"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('data-pk-lightbox="receipts-1"')
    expect(html).toContain('data-pk-lightbox-title="Nota N-1 · Rp 10.000"')
    expect(html).toContain('data-pk-lightbox-caption="Toko A · 2026-10-24"')
    expect(html).toContain('data-pk-receipt-thumb="5"')
    expect(html).toContain('data-pk-thumb="image"')
    expect(html).toContain('<img src="/api/v1/media/receipts/5/file?variant=thumb" alt="Nota N-1" loading="lazy" decoding="async" width="64" height="64"')
    expect(html).toMatch(/referrer-?policy="no-referrer"/i)
  })

  it('size "fill" (galleries), no caption → no caption attribute', () => {
    const html = renderToStaticMarkup(h(ImageThumb, { src: { href: '/a', thumb: '/a?variant=thumb', fallback: 'full' }, group: 'g', title: 'Foto 1', size: 'fill' }))
    expect(html).toMatch(/^<a class="pk-thumb fill" href="\/a"/)
    expect(html).not.toContain('style=')
    expect(html).not.toContain('data-pk-lightbox-caption')
    expect(html).not.toContain('width=')
  })

  it('a known PDF is a file link (never the lightbox); no source → nothing', () => {
    const html = renderToStaticMarkup(h(ImageThumb, { src: mediaThumbSource('attachments', 3), group: 'g', title: 'Invoice', file: true, fileLabel: 'inv-3.pdf' }))
    expect(html).toContain('href="/api/v1/media/attachments/3/file"')
    expect(html).toContain('data-pk-thumb="file"')
    expect(html).toContain('inv-3.pdf')
    expect(html).not.toContain('data-pk-lightbox')
    expect(html).not.toContain('<img')
    expect(renderToStaticMarkup(h(ImageThumb, { src: null, group: 'g', title: 'x' }))).toBe('')
  })

  it('ThumbList: one group for the record, tag lines under the thumbnails', () => {
    const html = renderToStaticMarkup(
      h(ThumbList, {
        group: 'rec-1',
        label: 'Foto laporan',
        size: 48,
        'data-pk-x': 1,
        items: [
          { key: 1, src: mediaThumbSource('progress-photos', 1), title: 'Foto 1', tag: 'Masuk' },
          { key: 2, src: mediaThumbSource('progress-photos', 2), title: 'Foto 2' },
        ],
      }),
    )
    expect(html).toMatch(/^<ul class="pk-thumb-list" aria-label="Foto laporan" data-pk-x="1">/)
    expect(html.match(/data-pk-lightbox="rec-1"/g)).toHaveLength(2)
    expect(html).toContain('<small>Masuk</small>')
    expect(html).toContain('width="48"')
  })
})

describe('attendance selfie + LPJ thumbnails', () => {
  it('SelfieThumb: the audited selfie endpoint as a thumbnail, the old data-pk hooks kept', () => {
    const html = renderToStaticMarkup(h(SelfieThumb, { attendanceId: 9, label: 'masuk 24 Okt', available: true, group: 'att-3-2026-10-24', caption: 'Masuk 07:58 · P1 Proyek' }))
    expect(html).toContain('href="/api/v1/attendance/9/selfie"')
    expect(html).toContain('src="/api/v1/attendance/9/selfie"')
    expect(html).toContain('data-pk-action="selfie"')
    expect(html).toContain('data-pk-attendance="9"')
    expect(html).toContain('data-pk-selfie-img=""')
    expect(html).toContain('aria-label="Lihat selfie masuk 24 Okt"')
    expect(html).toContain('data-pk-lightbox="att-3-2026-10-24"')
    expect(html).toContain('data-pk-lightbox-caption="Masuk 07:58 · P1 Proyek"')
    expect(html).not.toContain('<button')
    const gone = renderToStaticMarkup(h(SelfieThumb, { attendanceId: 9, label: 'x', available: false }))
    expect(gone).toContain('data-pk-selfie-removed="9"')
    expect(gone).toContain('Selfie dihapus')
    expect(gone).not.toContain('/selfie"')
  })

  it('LpjPhotoGrid: receipt thumbnails of one LPJ group, hook + children kept', () => {
    const html = renderToStaticMarkup(h(LpjPhotoGrid, { ids: [11, 12], group: 'lpj-photos-5', label: 'Foto LPJ', children: (id: number) => h('button', { type: 'button' }, `Hapus ${id}`) }))
    expect(html).toContain('data-pk-lpj-photos="2"')
    expect(html).toContain('href="/api/v1/media/receipts/11/file"')
    expect(html).toContain('src="/api/v1/media/receipts/12/file?variant=thumb"')
    expect(html.match(/data-pk-lightbox="lpj-photos-5"/g)).toHaveLength(2)
    expect(html).toContain('data-pk-lightbox-title="Foto LPJ 2/2"')
    expect(html).toContain('<button type="button">Hapus 11</button>')
  })

  it('views: Absensi (today board + rekap) and the LPJ / receipt screens render the shared thumbnail', () => {
    const absensi = src('src/admin/views/Absensi.tsx')
    expect(absensi.match(/<SelfieThumb\b/g)).toHaveLength(2)
    expect(absensi).not.toContain('SelfieButton')
    expect(absensi).toContain('data-pk-member-selfies={m.employee.id}')
    expect(absensi).toContain('selfies: await selfieState(req, stampIds)')
    const lpj = src('src/admin/views/LpjVerification.tsx')
    expect(lpj.match(/<ImageThumb src=\{mediaThumbSource\('receipts', r\.imageId\)\}/g)).toHaveLength(2)
    for (const f of ['src/admin/components/ReimburseReceiptReview.tsx', 'src/admin/components/ReviewDetails.tsx', 'src/admin/components/RequesterActions.tsx', 'src/admin/components/WorkflowPanel.tsx', 'src/admin/views/Kas.tsx', 'src/admin/views/IntercompanyLoans.tsx', 'src/admin/components/request/RequestSummary.tsx', 'src/admin/components/kas/CashEntryForm.tsx']) {
      expect(src(f), f).toContain('<ImageThumb')
    }
  })
})

describe('no plain image links left in the web admin', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.tsx')) files.push(p)
    }
  }
  walk(join(root, 'src/admin'))

  it('every link to a media file / selfie goes through ImageThumb (the lightbox + preview)', () => {
    const plain = /<a\b[^>]*\bhref=\{`\/api\/v1\/(media|attendance)\//
    const urlField = /<a\b[^>]*\bhref=\{[a-zA-Z.]+\.url\}/
    const offenders = files.filter((f) => !f.endsWith('/media/ImageThumb.tsx')).filter((f) => plain.test(readFileSync(f, 'utf8')) || urlField.test(readFileSync(f, 'utf8')))
    expect(offenders.map((f) => f.slice(root.length))).toEqual([])
  })
})

describe('lightbox caption + styles', () => {
  it('collect keeps the caption of a thumbnail, nothing else changes', () => {
    expect(collect([{ href: 'a', title: 'A', caption: 'Masuk 07:58' }, { href: 'b', title: 'B', caption: null }], 'a')).toEqual({ items: [{ src: 'a', title: 'A', caption: 'Masuk 07:58' }, { src: 'b', title: 'B' }], index: 0 })
  })

  it('thumbnail + lightbox styles: tokens only, long text wraps (no ellipsis), touch targets', () => {
    expect(THUMB_STYLE).not.toMatch(/#[0-9a-f]{3,6}\b/i)
    expect(THUMB_STYLE).not.toContain('text-overflow')
    expect(THUMB_STYLE).toContain('object-fit: cover')
    expect(THUMB_STYLE).toContain('@media (pointer: coarse) { .pk-thumb { min-width: 44px; min-height: 44px; } }')
    const lb = src('src/admin/components/lightbox/LightboxProvider.tsx')
    expect(lb).not.toContain('text-overflow')
    expect(lb).toContain('<style>{STYLE + THUMB_STYLE}</style>')
    expect(lb).toContain('caption: x.dataset.pkLightboxCaption')
  })

  it('CSP unchanged: img-src stays self + blob/data (no new origin for the previews)', () => {
    expect(src('src/lib/csp.ts')).toContain(`"img-src 'self' blob: data:"`)
  })
})

describe('Payload upload fields (display-cells.ts)', () => {
  type F = Field & { admin?: { components?: { Cell?: unknown; Field?: unknown } } }
  const wired = (fields: Field[]) => withDisplayCells([{ slug: 'x', fields } as CollectionConfig])[0]!.fields as F[]

  it('media upload fields: list cell always, preview field only when read-only, own components kept', () => {
    const [ro, editable, own, other] = wired([
      { name: 'selfie', type: 'upload', relationTo: 'media-selfies', admin: { readOnly: true } },
      { name: 'image', type: 'upload', relationTo: 'media-receipts' },
      { name: 'photos', type: 'upload', relationTo: 'media-receipts', hasMany: true, admin: { readOnly: true, components: { Field: '@/x#Own' } } },
      { name: 'doc', type: 'upload', relationTo: 'users' } as unknown as Field,
    ])
    expect(ro!.admin?.components).toEqual({ Cell: UPLOAD_CELL, Field: UPLOAD_PREVIEW_FIELD })
    expect(editable!.admin?.components).toEqual({ Cell: UPLOAD_CELL })
    expect(own!.admin?.components).toEqual({ Field: '@/x#Own', Cell: UPLOAD_CELL })
    expect(other!.admin?.components).toBeUndefined()
    expect(isMediaUpload({ name: 'a', type: 'relationship', relationTo: 'media-receipts' } as Field)).toBe(false)
  })

  it('the import map resolves both components', () => {
    const map = src('src/app/(payload)/admin/importMap.js')
    expect(map).toContain(`"${UPLOAD_CELL}"`)
    expect(map).toContain(`"${UPLOAD_PREVIEW_FIELD}"`)
  })
})
